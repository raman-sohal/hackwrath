import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

const SAMPLE_RATE = 16_000
const MAX_CHUNK_SECONDS = 12

/** SHA-256 of ggml-tiny.en.bin from the official whisper.cpp repository. */
const TINY_EN_SHA256 = '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f'

/**
 * Encodes mono float PCM as a 16-bit WAV buffer.
 * Audio is kept in memory; the server path never writes it to disk.
 */
export function encodeWav(pcm: Float32Array, sampleRate = SAMPLE_RATE): Buffer {
  const data = Buffer.alloc(pcm.length * 2)
  for (let i = 0; i < pcm.length; i++) {
    const clamped = Math.max(-1, Math.min(1, pcm[i]))
    data.writeInt16LE(Math.round(clamped * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

function firstExisting(paths: string[]): string | null {
  for (const p of paths) if (p && existsSync(p)) return p
  return null
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 8178
      server.close(() => resolve(port))
    })
  })
}

function waitForPort(port: number, timeoutMs = 20_000): Promise<void> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = connect({ port, host: '127.0.0.1' })
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - started > timeoutMs) reject(new Error('whisper server did not start'))
        else setTimeout(attempt, 200)
      })
    }
    attempt()
  })
}

export class WhisperService {
  private child: ChildProcess | null = null
  private port = 0
  private starting: Promise<boolean> | null = null
  private lastError: string | null = null
  private verifiedModel = false

  readonly modelPath: string
  readonly serverPath: string | null
  readonly cliPath: string | null

  constructor() {
    const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
    this.modelPath = join(root, 'models', 'ggml-tiny.en.bin')
    const binRoot = app.isPackaged ? join(process.resourcesPath, 'bin') : ''
    this.serverPath =
      process.env.WHISPER_SERVER ??
      firstExisting([join(binRoot, 'whisper-server'), '/opt/homebrew/bin/whisper-server', '/usr/local/bin/whisper-server'])
    this.cliPath =
      process.env.WHISPER_CLI ??
      firstExisting([join(binRoot, 'whisper-cli'), '/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'])
  }

  get modelPresent(): boolean {
    return existsSync(this.modelPath)
  }

  get serverPresent(): boolean {
    return Boolean(this.serverPath)
  }

  get ready(): boolean {
    return Boolean(this.child && !this.child.killed && this.port > 0)
  }

  get error(): string | null {
    return this.lastError
  }

  /**
   * Refuses to execute a model file that does not match the pinned digest.
   * Prevents a swapped or corrupted binary blob from being parsed by native code.
   */
  private verifyModel(): boolean {
    if (this.verifiedModel) return true
    try {
      const digest = createHash('sha256').update(readFileSync(this.modelPath)).digest('hex')
      if (digest !== TINY_EN_SHA256) {
        this.lastError = 'Whisper model checksum mismatch. Re-run npm run fetch-model.'
        return false
      }
      this.verifiedModel = true
      return true
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Could not read the Whisper model.'
      return false
    }
  }

  async start(): Promise<boolean> {
    if (this.ready) return true
    if (!this.modelPresent || !this.serverPath) return false
    if (!this.verifyModel()) return false
    if (this.starting) return this.starting
    this.starting = this.spawnServer()
    const ok = await this.starting
    this.starting = null
    return ok
  }

  private async spawnServer(): Promise<boolean> {
    try {
      this.port = await freePort()
      const child = spawn(
        this.serverPath as string,
        ['-m', this.modelPath, '-l', 'en', '--host', '127.0.0.1', '--port', String(this.port), '-t', '4'],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      )
      this.child = child
      child.stderr?.on('data', (d: Buffer) => {
        const line = d.toString()
        if (line.toLowerCase().includes('error')) this.lastError = line.trim().slice(0, 300)
      })
      child.once('exit', () => {
        this.child = null
        this.port = 0
      })
      await waitForPort(this.port)
      return true
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.child?.kill()
      this.child = null
      this.port = 0
      return false
    }
  }

  async transcribe(pcm: Float32Array, sampleRate = SAMPLE_RATE): Promise<{ text: string; ms: number }> {
    if (pcm.length === 0) return { text: '', ms: 0 }
    if (!this.verifyModel()) return { text: '', ms: 0 }
    if (pcm.length > SAMPLE_RATE * MAX_CHUNK_SECONDS) pcm = pcm.subarray(0, SAMPLE_RATE * MAX_CHUNK_SECONDS)
    const started = Date.now()
    const wav = encodeWav(pcm, sampleRate)

    if (await this.start()) {
      try {
        const form = new FormData()
        form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'chunk.wav')
        form.append('temperature', '0')
        form.append('response_format', 'json')
        form.append('language', 'en')
        const res = await fetch(`http://127.0.0.1:${this.port}/inference`, {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(30_000)
        })
        if (res.ok) {
          const json = (await res.json()) as { text?: string }
          return { text: (json.text ?? '').trim(), ms: Date.now() - started }
        }
        this.lastError = `server returned ${res.status}`
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err)
      }
    }

    // Fallback: one-shot CLI. This briefly writes PCM to a private temp file.
    if (this.cliPath && this.modelPresent) {
      const dir = mkdtempSync(join(tmpdir(), 'echoclass-'))
      const file = join(dir, 'chunk.wav')
      try {
        writeFileSync(file, wav, { mode: 0o600 })
        const text = await new Promise<string>((resolve, reject) => {
          execFile(
            this.cliPath as string,
            ['-m', this.modelPath, '-f', file, '-l', 'en', '-nt', '-np', '-t', '4'],
            { timeout: 30_000, maxBuffer: 1024 * 1024 },
            (err, stdout) => (err ? reject(err) : resolve(stdout))
          )
        })
        return { text: text.trim(), ms: Date.now() - started }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }

    return { text: '', ms: Date.now() - started }
  }

  stop(): void {
    this.child?.kill()
    this.child = null
    this.port = 0
  }
}

export const ASR_SAMPLE_RATE = SAMPLE_RATE
