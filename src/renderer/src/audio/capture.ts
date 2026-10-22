const TARGET_RATE = 16_000
const CHUNK_SECONDS = 4

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input
  const ratio = from / to
  const length = Math.floor(input.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return out
}

/**
 * Captures microphone audio as 4-second 16 kHz mono chunks.
 * Audio lives only in these buffers and is discarded after transcription.
 */
export class AudioCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: ScriptProcessorNode | null = null
  private sink: GainNode | null = null
  private buffers: Float32Array[] = []
  private samples = 0
  private stopped = false

  async start(onChunk: (pcm: Float32Array, sampleRate: number) => void, onLevel: (level: number) => void): Promise<void> {
    this.stopped = false
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    })
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctor()
    await this.ctx.resume()
    const rate = this.ctx.sampleRate
    const targetSamples = Math.round(rate * CHUNK_SECONDS)

    this.source = this.ctx.createMediaStreamSource(this.stream)
    this.node = this.ctx.createScriptProcessor(4096, 1, 1)
    this.sink = this.ctx.createGain()
    this.sink.gain.value = 0

    this.node.onaudioprocess = (event) => {
      if (this.stopped) return
      const input = event.inputBuffer.getChannelData(0)
      this.buffers.push(new Float32Array(input))
      this.samples += input.length

      let sum = 0
      for (let i = 0; i < input.length; i += 16) sum += input[i] * input[i]
      const rms = Math.sqrt(sum / (input.length / 16))
      onLevel(Math.min(1, rms * 14))

      if (this.samples >= targetSamples) {
        const merged = new Float32Array(this.samples)
        let offset = 0
        for (const b of this.buffers) {
          merged.set(b, offset)
          offset += b.length
        }
        this.buffers = []
        this.samples = 0
        const pcm = downsample(merged, rate, TARGET_RATE)
        // Drop near-silence so we do not transcribe fan noise or silence.
        let energy = 0
        for (let i = 0; i < pcm.length; i += 8) energy += pcm[i] * pcm[i]
        if (Math.sqrt(energy / (pcm.length / 8)) > 0.006) onChunk(pcm, TARGET_RATE)
      }
    }

    this.source.connect(this.node)
    this.node.connect(this.sink)
    this.sink.connect(this.ctx.destination)
  }

  stop(): void {
    this.stopped = true
    this.node?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()
    this.ctx = null
    this.stream = null
    this.node = null
    this.source = null
    this.sink = null
    this.buffers = []
    this.samples = 0
  }
}
