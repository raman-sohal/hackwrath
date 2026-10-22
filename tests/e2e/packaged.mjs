import { _electron as electron } from 'playwright-core'
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

if (process.platform !== 'darwin') {
  console.log('Skipping: packaged smoke test is macOS-only in this build.')
  process.exit(0)
}

const executablePath = join(
  process.cwd(),
  'release/mac-arm64/EchoClass.app/Contents/MacOS/EchoClass'
)
const tmp = mkdtempSync(join(tmpdir(), 'echoclass-pkg-'))
const aiff = join(tmp, 'speech.aiff')
const wav = join(tmp, 'speech.wav')
execFileSync('say', ['-o', aiff, 'The Hamiltonian is non-degenerate, so the eigenvalues are distinct.'])
execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', aiff, wav])
const bytes = readFileSync(wav)
const dataIndex = bytes.indexOf(Buffer.from('data'))
const dataSize = bytes.readUInt32LE(dataIndex + 4)
const pcm16 = new Int16Array(bytes.buffer, bytes.byteOffset + dataIndex + 8, dataSize / 2)
const pcm = Float32Array.from(pcm16, (v) => v / 32768)
const base64 = Buffer.from(pcm.buffer).toString('base64')

const userData = mkdtempSync(join(tmpdir(), 'echoclass-pkg-profile-'))
const app = await electron.launch({
  executablePath,
  env: { ...process.env, ECHOCLASS_USER_DATA: userData },
  timeout: 30_000
})
const win = await app.firstWindow()
await win.getByText('Your classroom, captioned').waitFor({ timeout: 15_000 })
await win.locator('.consent-option').nth(1).click()
await win.getByRole('button', { name: /Start with these choices/i }).click()
await win.getByText('Follow every word.').waitFor({ timeout: 10_000 })

const result = await win.evaluate(async (b64) => {
  const binary = atob(b64)
  const raw = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i)
  return window.api.asr.transcribe(new Float32Array(raw.buffer).buffer, 16000)
}, base64)

const sign = await win.evaluate(async () => {
  await window.api.media.grant('camera', true)
  try {
    const rgb = new Uint8Array(224 * 224 * 3)
    rgb.fill(128)
    return window.api.sign.classify(rgb, 224, 224)
  } finally {
    await window.api.media.grant('camera', false)
  }
})

const privacy = await win.evaluate(() => window.api.privacy.status())
assert.equal(privacy.modelPresent, true, 'packaged Whisper model missing')
assert.equal(privacy.signModelPresent, true, 'packaged sign model missing')
assert.equal(privacy.encryption, 'keychain', 'OS keychain not used')
assert.ok(result.text.length > 0, 'packaged Whisper returned no text')
assert.equal(privacy.asrReady, true, 'local ASR server not ready')
assert.equal(sign.predictions.length, 5, 'packaged ONNX Runtime returned no predictions')
assert.ok(sign.ms > 0, 'packaged ONNX inference did not run')

await win.screenshot({ path: join(process.cwd(), 'docs', 'packaged.png') })
await app.close()

const dataDir = join(userData, 'data')
assert.equal(statSync(join(dataDir, 'key.bin')).mode & 0o077, 0, 'key file too permissive')
assert.deepEqual(
  readdirSync(dataDir).filter((f) => /\.(wav|webm|mp3|flac|ogg|mp4|mov|y4m|png|jpe?g)$/i.test(f)),
  [],
  'packaged app left raw media'
)

console.log(
  JSON.stringify(
    {
      ok: true,
      packaged: true,
      text: result.text,
      ms: result.ms,
      modelPresent: privacy.modelPresent,
      signModelPresent: privacy.signModelPresent,
      signPrediction: sign.predictions[0],
      signMs: sign.ms,
      encryption: privacy.encryption,
      asrReady: privacy.asrReady,
      blockedRequests: privacy.blockedRequests
    },
    null,
    2
  )
)
