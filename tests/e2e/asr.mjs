import { _electron as electron } from 'playwright-core'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

if (process.platform !== 'darwin') {
  console.log('Skipping: this ASR smoke test uses macOS `say` to generate speech.')
  process.exit(0)
}

// 1. Generate a deterministic 16 kHz mono WAV with macOS speech synthesis.
const tmp = mkdtempSync(join(tmpdir(), 'echoclass-asr-'))
const aiff = join(tmp, 'speech.aiff')
const wav = join(tmp, 'speech.wav')
execFileSync('say', ['-o', aiff, 'The Hamiltonian is non-degenerate, so the eigenvalues are distinct.'])
execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', aiff, wav])

// 2. Parse the WAV data chunk into float PCM.
const bytes = readFileSync(wav)
const dataIndex = bytes.indexOf(Buffer.from('data'))
assert.ok(dataIndex > 0, 'WAV data chunk not found')
const dataSize = bytes.readUInt32LE(dataIndex + 4)
const pcm16 = new Int16Array(bytes.buffer, bytes.byteOffset + dataIndex + 8, dataSize / 2)
const pcm = Float32Array.from(pcm16, (v) => v / 32768)
const base64 = Buffer.from(pcm.buffer).toString('base64')

// 3. Launch the real app and call the same IPC the UI uses.
const userData = mkdtempSync(join(tmpdir(), 'echoclass-asr-profile-'))
const app = await electron.launch({
  args: ['.', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  cwd: process.cwd(),
  env: { ...process.env, ECHOCLASS_USER_DATA: userData },
  timeout: 30_000
})
const win = await app.firstWindow()
await win.getByRole('button', { name: /Start with these choices/i }).click()
await win.getByText('Follow every word.').waitFor({ timeout: 10_000 })

// Verify the permission gate and capture path with Chromium's fake microphone.
const mic = await win.evaluate(async () => {
  await window.api.media.grant('microphone', true)
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const kinds = stream.getTracks().map((track) => track.kind)
    stream.getTracks().forEach((track) => track.stop())
    return kinds
  } finally {
    await window.api.media.grant('microphone', false)
  }
})
assert.deepEqual(mic, ['audio'], 'microphone stream was not granted through the IPC gate')

const result = await win.evaluate(async (b64) => {
  const binary = atob(b64)
  const raw = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i)
  const floats = new Float32Array(raw.buffer)
  return window.api.asr.transcribe(floats.buffer, 16000)
}, base64)

await app.close()

assert.ok(result.text.length > 0, 'Whisper returned no text')
assert.match(result.text.toLowerCase(), /hamiltonian|eigen/, `unexpected transcript: ${result.text}`)
assert.ok(result.ms < 30_000, `transcription took too long: ${result.ms}ms`)

// 4. The server path must not leave raw audio in the app profile.
const dataDir = join(userData, 'data')
const leftovers = readdirSync(dataDir).filter((f) => /\.(wav|webm|mp3|flac|ogg)$/i.test(f))
assert.deepEqual(leftovers, [], 'no raw audio files may be stored')

console.log(
  JSON.stringify(
    { ok: true, micTracks: mic, text: result.text, ms: result.ms, rawAudioFiles: leftovers.length },
    null,
    2
  )
)
