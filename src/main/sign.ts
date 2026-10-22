import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { SignPrediction, SignResult, SignStatus } from '@shared/types'

/**
 * Int8 ONNX export of prithivMLmods/Alphabet-Sign-Language-Detection.
 * Pinned to the exact bytes produced by scripts/convert-sign-model.py.
 * Update this digest only after re-running the converter.
 */
const MODEL_SHA256 = '22efbe5e390bbbca1f3c6be528a7d8e583a7740abed1613c5187a1d32d6a2045'
const INPUT_SIZE = 224
const FALLBACK_LABELS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))

type OrtModule = typeof import('onnxruntime-node')
type OrtSession = import('onnxruntime-node').InferenceSession

/**
 * On-device ASL fingerspelling classifier. The renderer sends one 224x224 RGB
 * frame at a time; this service preprocesses it in memory, runs the local ONNX
 * graph, and returns labels. Frames are never written to disk or sent anywhere.
 */
export class SignService {
  readonly modelPath: string
  readonly labelsPath: string
  readonly metadataPath: string

  private ort: OrtModule | null = null
  private session: OrtSession | null = null
  private starting: Promise<boolean> | null = null
  private inputName = 'pixel_values'
  private outputName = 'logits'
  private labels: string[] = FALLBACK_LABELS
  private verified = false
  private busy = false
  private lastError: string | null = null

  constructor() {
    const root = app.isPackaged ? process.resourcesPath : app.getAppPath()
    const dir = join(root, 'models', 'sign')
    this.modelPath = join(dir, 'model.onnx')
    this.labelsPath = join(dir, 'labels.json')
    this.metadataPath = join(dir, 'model.json')
  }

  get modelPresent(): boolean {
    return existsSync(this.modelPath)
  }

  get ready(): boolean {
    return this.session !== null
  }

  get error(): string | null {
    return this.lastError
  }

  getStatus(): SignStatus {
    return {
      modelPresent: this.modelPresent,
      ready: this.ready,
      error: this.lastError,
      labels: this.labels
    }
  }

  /** Refuses to load swapped bytes into the native ONNX parser. */
  private verifyModel(): boolean {
    if (this.verified) return true
    try {
      const digest = createHash('sha256').update(readFileSync(this.modelPath)).digest('hex')
      if (digest !== MODEL_SHA256) {
        this.lastError = 'Sign model checksum mismatch. Re-run scripts/convert-sign-model.py.'
        return false
      }
      this.verified = true
      return true
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Could not read the sign model.'
      return false
    }
  }

  private loadLabels(): void {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.labelsPath, 'utf8'))
      if (
        Array.isArray(parsed) &&
        parsed.length === 26 &&
        parsed.every((label): label is string => typeof label === 'string' && /^[A-Z]$/.test(label))
      ) {
        this.labels = parsed
      }
    } catch {
      // Keep the compile-time A-Z fallback; labels are not security-sensitive.
    }
  }

  async start(): Promise<boolean> {
    if (this.session) return true
    if (!this.modelPresent) {
      this.lastError = 'Sign model not installed. Run the converter in scripts/convert-sign-model.py.'
      return false
    }
    if (this.starting) return this.starting
    this.starting = this.load()
    const ok = await this.starting
    this.starting = null
    return ok
  }

  private async load(): Promise<boolean> {
    const started = Date.now()
    try {
      if (!this.verifyModel()) return false
      this.loadLabels()
      const ort = (await import('onnxruntime-node')) as unknown as OrtModule
      const session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all'
      })
      this.inputName = session.inputNames[0] ?? 'pixel_values'
      this.outputName = session.outputNames[0] ?? 'logits'
      this.ort = ort
      this.session = session
      this.lastError = null
      console.info(`[echoclass] sign model ready in ${Date.now() - started}ms`)
      return true
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Could not initialise the sign model.'
      console.error('[echoclass] sign model failed:', err instanceof Error ? err.name : 'unknown')
      return false
    }
  }

  async classify(rgb: Uint8Array, width: number, height: number): Promise<SignResult> {
    if (width !== INPUT_SIZE || height !== INPUT_SIZE || rgb.byteLength !== INPUT_SIZE * INPUT_SIZE * 3) {
      throw new Error('expected a 224x224 RGB frame')
    }
    const started = Date.now()
    if (this.busy) return { predictions: [], ms: 0, skipped: true }
    this.busy = true
    try {
      if (!(await this.start()) || !this.session || !this.ort) {
        return { predictions: [], ms: Date.now() - started, skipped: false, error: this.lastError ?? undefined }
      }

      const area = INPUT_SIZE * INPUT_SIZE
      const input = new Float32Array(area * 3)
      for (let i = 0; i < area; i++) {
        // SiglipImageProcessor: rescale 1/255, mean 0.5, std 0.5 => x/127.5 - 1.
        input[i] = rgb[i * 3] / 127.5 - 1
        input[area + i] = rgb[i * 3 + 1] / 127.5 - 1
        input[area * 2 + i] = rgb[i * 3 + 2] / 127.5 - 1
      }

      const tensor = new this.ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE])
      const output = await this.session.run({ [this.inputName]: tensor })
      const logits = output[this.outputName]?.data
      if (!(logits instanceof Float32Array) || logits.length !== this.labels.length) {
        return { predictions: [], ms: Date.now() - started, skipped: false, error: 'unexpected model output' }
      }

      // Numerically stable softmax.
      let max = -Infinity
      for (const value of logits) if (value > max) max = value
      let sum = 0
      const probs = new Float32Array(logits.length)
      for (let i = 0; i < logits.length; i++) {
        const p = Math.exp(logits[i] - max)
        probs[i] = p
        sum += p
      }
      const predictions: SignPrediction[] = []
      for (let i = 0; i < probs.length; i++) {
        predictions.push({ label: this.labels[i], score: probs[i] / sum })
      }
      predictions.sort((a, b) => b.score - a.score)
      return { predictions: predictions.slice(0, 5), ms: Date.now() - started, skipped: false }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Sign inference failed.'
      return { predictions: [], ms: Date.now() - started, skipped: false, error: this.lastError }
    } finally {
      this.busy = false
    }
  }

  stop(): void {
    const session = this.session
    this.session = null
    this.ort = null
    if (session) {
      void session.release().catch(() => {
        /* already closed */
      })
    }
  }
}

export const SIGN_INPUT_SIZE = INPUT_SIZE
