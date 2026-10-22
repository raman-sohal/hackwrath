import { randomUUID } from 'node:crypto'
import { createReadStream, lstatSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { Readable } from 'node:stream'
import { BrowserWindow, dialog, protocol } from 'electron'
import type { VideoFile } from '@shared/types'

const MAX_BYTES = 2 * 1024 * 1024 * 1024
const MAX_OPEN_FILES = 4

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg'
}

interface Entry {
  path: string
  size: number
  mime: string
  openedAt: number
}

/**
 * Local video file access. The renderer never receives a filesystem path: it
 * gets an opaque token URL served by the app's own protocol. The handler
 * supports byte ranges so the video element can seek for frame sampling.
 */
export class VideoLibrary {
  private readonly entries = new Map<string, Entry>()
  private opening = false

  /** Must be called before app.whenReady. */
  static registerScheme(): void {
    protocol.registerSchemesAsPrivileged([
      {
        scheme: 'echoclass-media',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
          corsEnabled: true
        }
      }
    ])
  }

  /** Must be called after app.whenReady. */
  registerProtocol(): void {
    protocol.handle('echoclass-media', (request) => this.handle(request))
  }

  async open(parent: BrowserWindow | null): Promise<VideoFile | null> {
    if (this.opening) return null
    this.opening = true
    try {
      const options: Electron.OpenDialogOptions = {
        title: 'Choose a sign-language video',
        buttonLabel: 'Open video',
        properties: ['openFile'],
        filters: [
          { name: 'Video', extensions: ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'ogg'] },
          { name: 'All files', extensions: ['*'] }
        ]
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null

      const path = result.filePaths[0]
      const extension = extname(path).toLowerCase()
      const mime = MIME_BY_EXT[extension]
      if (!mime) throw new Error('Unsupported video type. Use MP4, M4V, WebM, MOV, OGV or OGG.')

      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not supported for video import.')
      if (!stat.isFile()) throw new Error('That path is not a regular file.')
      if (stat.size <= 0) throw new Error('That video is empty.')
      if (stat.size > MAX_BYTES) throw new Error('Video is larger than the 2 GB local import limit.')

      const token = randomUUID()
      this.entries.set(token, { path, size: stat.size, mime, openedAt: Date.now() })
      this.prune()

      return {
        token,
        name: basename(path),
        sizeBytes: stat.size,
        mime,
        url: `echoclass-media://${token}`
      }
    } finally {
      this.opening = false
    }
  }

  has(token: unknown): boolean {
    return typeof token === 'string' && this.entries.has(token)
  }

  close(token: unknown): boolean {
    return typeof token === 'string' && this.entries.delete(token)
  }

  closeAll(): void {
    this.entries.clear()
  }

  private prune(): void {
    if (this.entries.size <= MAX_OPEN_FILES) return
    const oldest = [...this.entries.entries()].sort((a, b) => a[1].openedAt - b[1].openedAt)
    for (const [token] of oldest.slice(0, this.entries.size - MAX_OPEN_FILES)) {
      this.entries.delete(token)
    }
  }

  private async handle(request: Request): Promise<Response> {
    let token = ''
    try {
      const url = new URL(request.url)
      token = url.hostname || url.pathname.replace(/^\/+/, '')
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    const entry = this.entries.get(token)
    if (!entry) return new Response('Not found', { status: 404 })

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }

    const baseHeaders: Record<string, string> = {
      'Content-Type': entry.mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // The renderer draws frames to a canvas, so the media response must be
      // readable cross-origin. The token is unguessable and local-only.
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
    }

    const rangeHeader = request.headers.get('range')
    if (!rangeHeader) {
      return this.stream(entry, 0, entry.size - 1, 200, {
        ...baseHeaders,
        'Content-Length': String(entry.size)
      }, request.method === 'HEAD')
    }

    const range = parseRange(rangeHeader, entry.size)
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${entry.size}` }
      })
    }

    const length = range.end - range.start + 1
    return this.stream(entry, range.start, range.end, 206, {
      ...baseHeaders,
      'Content-Length': String(length),
      'Content-Range': `bytes ${range.start}-${range.end}/${entry.size}`
    }, request.method === 'HEAD')
  }

  private stream(
    entry: Entry,
    start: number,
    end: number,
    status: number,
    headers: Record<string, string>,
    headOnly: boolean
  ): Response {
    if (headOnly) return new Response(null, { status, headers })
    const nodeStream = createReadStream(entry.path, { start, end })
    return new Response(Readable.toWeb(nodeStream) as unknown as ReadableStream, {
      status,
      headers
    })
  }
}

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const rawStart = match[1]
  const rawEnd = match[2]
  if (!rawStart && !rawEnd) return null

  let start: number
  let end: number
  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  start = Math.max(0, Math.floor(start))
  end = Math.min(size - 1, Math.floor(end))
  if (start > end || start >= size) return null
  return { start, end }
}
