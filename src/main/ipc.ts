import { writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import type { Consent, ExportResult, PrivacyStatus, Settings, Speaker } from '@shared/types'
import { CONSENT_VERSION } from '@shared/types'
import type { SecureStore } from './store'
import { ASR_SAMPLE_RATE, type WhisperService } from './asr'
import { SIGN_INPUT_SIZE, type SignService } from './sign'
import type { VideoLibrary } from './video'

export class MediaPermissions {
  private granted = new Set<'microphone' | 'camera'>()

  set(kind: 'microphone' | 'camera', allowed: boolean): void {
    if (allowed) this.granted.add(kind)
    else this.granted.delete(kind)
  }

  has(kind: 'microphone' | 'camera'): boolean {
    return this.granted.has(kind)
  }

  any(): boolean {
    return this.granted.size > 0
  }

  clear(): void {
    this.granted.clear()
  }
}

interface Deps {
  store: SecureStore
  asr: WhisperService
  sign: SignService
  media: MediaPermissions
  videos: VideoLibrary
  getWindow: () => BrowserWindow | null
  getBlocked: () => number
}

function assertTrusted(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  if (!url.startsWith('file:') && !url.startsWith('http://localhost:5173')) {
    throw new Error('untrusted IPC sender')
  }
}

const str = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const bool = (v: unknown): v is boolean => typeof v === 'boolean'
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function registerIpc(deps: Deps): void {
  const { store, asr, sign, media } = deps

  ipcMain.handle('app:info', (e) => {
    assertTrusted(e)
    return {
      version: '0.1.0',
      platform: process.platform,
      isPackaged: process.env.NODE_ENV !== 'development'
    }
  })

  ipcMain.handle('consent:get', (e) => {
    assertTrusted(e)
    return store.getConsent()
  })

  ipcMain.handle('consent:set', (e, raw: unknown) => {
    assertTrusted(e)
    if (!raw || typeof raw !== 'object') throw new Error('invalid consent')
    const r = raw as Record<string, unknown>
    if (!bool(r.microphone) || !bool(r.camera) || !bool(r.storage)) throw new Error('invalid consent fields')
    const consent: Consent = {
      version: CONSENT_VERSION,
      acceptedAt: Date.now(),
      microphone: r.microphone,
      camera: r.camera,
      storage: r.storage
    }
    // Consent is permission to ask; it is not a running capture grant. Only a
    // false choice revokes immediately. The capture path calls media:grant and
    // the main process checks the stored consent again.
    if (!consent.microphone) media.set('microphone', false)
    if (!consent.camera) media.set('camera', false)
    return store.setConsent(consent)
  })

  ipcMain.handle('settings:get', (e) => {
    assertTrusted(e)
    return store.getSettings()
  })

  ipcMain.handle('settings:update', (e, patch: unknown) => {
    assertTrusted(e)
    if (!patch || typeof patch !== 'object') throw new Error('invalid settings')
    return store.updateSettings(patch as Partial<Settings>)
  })

  ipcMain.handle('session:create', (e, title: unknown) => {
    assertTrusted(e)
    return store.createSession(str(title, 200) ? title : undefined)
  })

  ipcMain.handle('session:list', (e) => {
    assertTrusted(e)
    return store.listSessions()
  })

  ipcMain.handle('session:get', (e, id: unknown) => {
    assertTrusted(e)
    if (!str(id, 100)) throw new Error('invalid session id')
    return store.getSession(id)
  })

  ipcMain.handle('session:end', (e, id: unknown) => {
    assertTrusted(e)
    if (!str(id, 100)) throw new Error('invalid session id')
    return store.endSession(id)
  })

  ipcMain.handle('session:append', (e, raw: unknown) => {
    assertTrusted(e)
    if (!raw || typeof raw !== 'object') throw new Error('invalid segment')
    const r = raw as Record<string, unknown>
    if (!str(r.sessionId, 100) || !str(r.text, 4000)) throw new Error('invalid segment fields')
    const speaker: Speaker = r.speaker === 'Student' ? 'Student' : r.speaker === 'Unknown' ? 'Unknown' : 'Teacher'
    if (!num(r.startMs) || !num(r.endMs)) throw new Error('invalid segment timing')
    return store.appendSegment(r.sessionId, {
      text: r.text,
      speaker,
      startMs: r.startMs,
      endMs: r.endMs,
      confidence: num(r.confidence) ? r.confidence : 0.9
    })
  })

  ipcMain.handle('session:bookmark', (e, sessionId: unknown, segmentId: unknown) => {
    assertTrusted(e)
    if (!str(sessionId, 100) || !str(segmentId, 100)) throw new Error('invalid ids')
    return store.toggleBookmark(sessionId, segmentId)
  })

  ipcMain.handle('session:delete', (e, id: unknown) => {
    assertTrusted(e)
    if (!str(id, 100)) throw new Error('invalid session id')
    return store.deleteSession(id)
  })

  ipcMain.handle('session:delete-all', (e) => {
    assertTrusted(e)
    store.deleteAll()
    return true
  })

  ipcMain.handle('session:seed-demo', (e) => {
    assertTrusted(e)
    return store.seedDemo()
  })

  ipcMain.handle('session:export', async (e, id: unknown, opts: unknown) => {
    assertTrusted(e)
    if (!str(id, 100)) throw new Error('invalid session id')
    const o = (opts ?? {}) as Record<string, unknown>
    const built = store.buildExport(id, {
      anonymize: bool(o.anonymize) ? o.anonymize : true,
      timestamps: bool(o.timestamps) ? o.timestamps : true,
      bookmarksOnly: bool(o.bookmarksOnly) ? o.bookmarksOnly : false
    })
    if (!built) return { saved: false }
    const result = await saveFile(deps, built.filename, built.content, [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Text', extensions: ['txt'] }
    ])
    if (result.saved) store.updateSettings({})
    return result
  })

  ipcMain.handle('export:all', async (e) => {
    assertTrusted(e)
    const built = store.buildExportAll()
    return saveFile(deps, built.filename, built.content, [{ name: 'JSON', extensions: ['json'] }])
  })

  ipcMain.handle('privacy:status', (e): PrivacyStatus => {
    assertTrusted(e)
    return store.getPrivacyStatus({
      modelPresent: asr.modelPresent,
      asrServerPresent: asr.serverPresent,
      asrReady: asr.ready,
      signModelPresent: sign.modelPresent,
      blockedRequests: deps.getBlocked()
    })
  })

  ipcMain.handle('privacy:open-data-folder', (e) => {
    assertTrusted(e)
    return shell.openPath(store.dir)
  })

  ipcMain.handle('media:grant', (e, kind: unknown, allowed: unknown) => {
    assertTrusted(e)
    if (kind !== 'microphone' && kind !== 'camera') throw new Error('invalid media kind')
    if (!bool(allowed)) throw new Error('invalid permission value')
    if (allowed) {
      // A runtime grant is only valid on top of a stored, explicit consent.
      const consent = store.getConsent()
      const permitted = kind === 'microphone' ? consent?.microphone : consent?.camera
      if (!permitted) return false
    }
    media.set(kind, allowed)
    return true
  })

  ipcMain.handle('asr:status', (e) => {
    assertTrusted(e)
    return {
      modelPresent: asr.modelPresent,
      serverPresent: asr.serverPresent,
      ready: asr.ready,
      error: asr.error
    }
  })

  ipcMain.handle('sign:status', (e) => {
    assertTrusted(e)
    return sign.getStatus()
  })

  ipcMain.handle('video:open', async (e) => {
    assertTrusted(e)
    return deps.videos.open(deps.getWindow())
  })

  ipcMain.handle('video:close', (e, token: unknown) => {
    assertTrusted(e)
    if (!str(token, 64)) return false
    return deps.videos.close(token)
  })

  ipcMain.handle('sign:classify', async (e, raw: unknown) => {
    assertTrusted(e)
    if (!raw || typeof raw !== 'object') throw new Error('invalid frame')
    const r = raw as Record<string, unknown>

    const source = r.source === undefined ? 'camera' : r.source
    if (source !== 'camera' && source !== 'video') throw new Error('invalid frame source')
    if (source === 'camera') {
      if (!media.has('camera')) throw new Error('camera permission not granted')
    } else if (!deps.videos.has(r.token)) {
      throw new Error('video source is not open')
    }

    const frame = r.rgb
    const bytes =
      frame instanceof Uint8Array ? frame : frame instanceof ArrayBuffer ? new Uint8Array(frame) : null
    if (!bytes) throw new Error('frame must be RGB bytes')
    const width = num(r.width) ? r.width : 0
    const height = num(r.height) ? r.height : 0
    if (width !== SIGN_INPUT_SIZE || height !== SIGN_INPUT_SIZE) throw new Error('unexpected frame size')
    if (bytes.byteLength !== SIGN_INPUT_SIZE * SIGN_INPUT_SIZE * 3) throw new Error('frame length out of range')
    return sign.classify(bytes, width, height)
  })

  ipcMain.handle('asr:transcribe', async (e, raw: unknown) => {
    assertTrusted(e)
    if (!raw || typeof raw !== 'object') throw new Error('invalid audio')
    const r = raw as Record<string, unknown>
    const buf = r.pcm
    if (!(buf instanceof ArrayBuffer)) throw new Error('pcm must be an ArrayBuffer')
    const maxBytes = ASR_SAMPLE_RATE * 12 * 4
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) throw new Error('audio chunk out of range')
    const pcm = new Float32Array(buf)
    const result = await asr.transcribe(pcm, num(r.sampleRate) ? r.sampleRate : ASR_SAMPLE_RATE)
    return { text: result.text, confidence: 0.9, ms: result.ms }
  })
}

async function saveFile(
  deps: Deps,
  suggested: string,
  content: string,
  filters: Electron.FileFilter[]
): Promise<ExportResult> {
  const win = deps.getWindow()
  if (!win) return { saved: false }
  const safeName = basename(suggested).replace(/[/\\?%*:|"<>]/g, '-')
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: safeName,
    filters,
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (canceled || !filePath) return { saved: false }
  writeFileSync(filePath, content, { mode: 0o600 })
  return { saved: true, path: filePath, bytes: Buffer.byteLength(content) }
}
