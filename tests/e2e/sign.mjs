import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const fixture = join(root, 'build', 'sign-a.y4m')
if (!existsSync(fixture)) {
  console.log(
    'Skipping camera E2E: build/sign-a.y4m is missing. Generate a 640x480 Y4M fixture (see docs/sign.png) and rerun.'
  )
  process.exit(0)
}
const userData = mkdtempSync(join(tmpdir(), 'echoclass-sign-e2e-'))
mkdirSync(join(root, 'docs'), { recursive: true })

const app = await electron.launch({
  args: [
    '.',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-video-capture=${fixture}`
  ],
  cwd: root,
  env: { ...process.env, ECHOCLASS_USER_DATA: userData },
  timeout: 30_000
})

try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  // Camera starts off. Enable it from the dedicated page, then start capture.
  await win.getByText('Your classroom, captioned').waitFor({ timeout: 15_000 })
  await win.getByRole('button', { name: /Start with these choices/i }).click()
  await win.getByText('Follow every word.').waitFor({ timeout: 10_000 })

  const before = await win.evaluate(() => window.api.sign.status())
  assert.equal(before.modelPresent, true, 'sign model missing from models/sign')
  assert.deepEqual(before.labels.slice(0, 3), ['A', 'B', 'C'])
  assert.equal(before.labels.length, 26)

  await win.getByRole('button', { name: /Fingerspelling/i }).click()
  await win.getByRole('heading', { name: 'Fingerspell to text.' }).waitFor({ timeout: 10_000 })
  await win.getByText('Camera access is off').waitFor({ timeout: 10_000 })
  await win.getByRole('button', { name: /Enable camera access/i }).click()
  await win.getByRole('button', { name: /Turn on camera/i }).click()
  await win.getByRole('button', { name: /Stop camera/i }).waitFor({ timeout: 20_000 })

  // Wait for the first real inference over the camera pipeline.
  await win.waitForFunction(
    () => {
      const glyph = document.querySelector('.detected-glyph')?.textContent ?? ''
      return glyph.trim() !== '' && glyph.trim() !== '—'
    },
    null,
    { timeout: 30_000 }
  )
  const detected = (await win.locator('.detected-glyph').textContent())?.trim()
  const confidence = (await win.locator('.confidence-meta').first().textContent())?.trim()
  await win.waitForTimeout(1600)
  await win.screenshot({ path: join(root, 'docs', 'sign.png') })

  // A synthetic frame verifies the IPC boundary, checksum and ONNX graph.
  const direct = await win.evaluate(async () => {
    const rgb = new Uint8Array(224 * 224 * 3)
    rgb.fill(128)
    return window.api.sign.classify(rgb, 224, 224)
  })
  assert.equal(direct.predictions.length, 5, 'expected top-5 predictions')
  assert.ok(direct.ms > 0, 'inference did not run')
  const top5Mass = direct.predictions.reduce((n, p) => n + p.score, 0)
  assert.ok(top5Mass > 0.2 && top5Mass <= 1.00001, `top-5 scores are not a distribution (${top5Mass})`)
  assert.equal(direct.skipped, false)

  const privacy = await win.evaluate(() => window.api.privacy.status())
  assert.equal(privacy.signModelPresent, true)
  assert.ok(detected && detected !== '—', 'camera pipeline produced no letter')

  await win.getByRole('button', { name: /Stop camera/i }).click()
  await win.getByRole('button', { name: /Turn on camera/i }).waitFor({ timeout: 10_000 })

  // The recognised word can be appended to a session and opened as captions.
  await win.getByRole('button', { name: /Add to transcript/i }).click()
  await win.locator('.sign-saved').waitFor({ timeout: 10_000 })
  await win.getByRole('button', { name: /Open transcript/i }).click()
  await win.locator('.segment').first().waitFor({ timeout: 10_000 })
  const transcript = await win.locator('.segment').first().textContent()
  assert.match(transcript ?? '', new RegExp(detected ?? 'A'))
  const sessions = await win.evaluate(() => window.api.sessions.list())
  assert.equal(sessions.length, 1, 'signed text did not create a local session')

  // Revoking consent in the Privacy Center closes the feature again.
  await win.getByRole('button', { name: /Privacy center/i }).click()
  await win.getByRole('button', { name: /^Turn camera access off$/ }).click()
  await win.getByRole('button', { name: /Fingerspelling/i }).click()
  await win.getByText('Camera access is off').waitFor({ timeout: 10_000 })
  const finalConsent = await win.evaluate(() => window.api.consent.get())
  assert.equal(finalConsent?.camera, false, 'camera consent was not revoked')

  await app.close()

  const dataDir = join(userData, 'data')
  assert.deepEqual(
    readdirSync(dataDir).filter((file) => /\.(wav|webm|mp4|mov|png|jpg|jpeg|y4m)$/i.test(file)),
    [],
    'camera or audio data was written to the profile'
  )
  assert.equal(statSync(join(dataDir, 'key.bin')).mode & 0o077, 0, 'key permissions are too broad')

  console.log(
    JSON.stringify(
      {
        ok: true,
        model: 'int8 ONNX · prithivMLmods/Alphabet-Sign-Language-Detection',
        detected,
        confidence,
        inferenceMs: direct.ms,
        top5: direct.predictions.map((p) => `${p.label} ${(p.score * 100).toFixed(1)}%`),
        cameraStreamStopped: true,
        rawMediaFiles: 0,
        signModelPresent: privacy.signModelPresent
      },
      null,
      2
    )
  )
} catch (error) {
  await app.close().catch(() => {})
  throw error
}
