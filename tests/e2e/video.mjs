import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const fixture = join(root, 'build', 'sign-a.mp4')
if (!existsSync(fixture)) {
  console.log(
    'Skipping video E2E: build/sign-a.mp4 is missing. Generate it from the fake-camera Y4M fixture (see scripts/make-test-video.swift).'
  )
  process.exit(0)
}
const userData = mkdtempSync(join(tmpdir(), 'echoclass-video-e2e-'))
mkdirSync(join(root, 'docs'), { recursive: true })

const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: { ...process.env, ECHOCLASS_USER_DATA: userData },
  timeout: 30_000
})

try {
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')

  await win.getByText('Your classroom, captioned').waitFor({ timeout: 15_000 })
  await win.getByRole('button', { name: /Start with these choices/i }).click()
  await win.getByText('Follow every word.').waitFor({ timeout: 10_000 })

  const consent = await win.evaluate(() => window.api.consent.get())
  assert.equal(consent?.camera, false, 'video import must not require camera consent')

  await win.getByRole('button', { name: /Fingerspelling/i }).click()
  await win.getByRole('heading', { name: 'Fingerspell to text.' }).waitFor({ timeout: 10_000 })
  await win.getByText('Camera access is off').waitFor({ timeout: 15_000 })

  // Video import is available without enabling the camera.
  await win.getByRole('tab', { name: /Video file/i }).click()
  await win.getByText('Caption a local video').waitFor({ timeout: 10_000 })
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, fixture)
  await win.getByRole('button', { name: /Choose a video/i }).click()

  await win.getByRole('button', { name: /Generate captions/i }).waitFor({ timeout: 20_000 })
  await win.waitForFunction(
    () => (document.querySelector('.video-file-meta')?.textContent ?? '').includes('00:02'),
    null,
    { timeout: 20_000 }
  )
  const fileMeta = (await win.locator('.video-file-meta').textContent())?.trim() ?? ''
  assert.match(fileMeta, /sign-a\.mp4/)
  assert.match(fileMeta, /00:02/)
  assert.equal(await win.getByText(/Ready · \d+ samples/).isVisible(), true)

  const token = await win.evaluate(() => {
    const video = document.querySelector('.video-frame video')
    return new URL(video.src).hostname
  })
  assert.match(token, /^[0-9a-f-]{36}$/, 'video URL is not an opaque token')

  // Frames are seeked, drawn to a canvas, and classified by the local ONNX model.
  await win.getByRole('button', { name: /Generate captions/i }).click()
  await win.waitForFunction(
    () => document.querySelectorAll('.video-captions li').length > 0,
    null,
    { timeout: 30_000 }
  )
  await win.locator('.video-progress + .confidence-meta').getByText(/Done · \d+ frames sampled/).waitFor({
    timeout: 30_000
  })

  const items = win.locator('.video-captions li')
  const captionCount = await items.count()
  assert.ok(captionCount >= 1, 'no captions were generated')
  const captionTexts = await items.locator('.video-caption-text').allTextContents()
  assert.match(captionTexts.join(' '), /A/, 'the imported A hand was not recognised')
  assert.equal(await win.locator('.video-captions li .video-time').first().textContent(), '00:00')

  await win.screenshot({ path: join(root, 'docs', 'video.png') })

  await win.getByRole('button', { name: /Add all to transcript/i }).click()
  await win.locator('.sign-saved').waitFor({ timeout: 10_000 })

  const sessions = await win.evaluate(() => window.api.sessions.list())
  assert.equal(sessions.length, 1, 'video captions did not create one local session')
  assert.match(sessions[0].title, /^Video — sign-a\.mp4/)
  const session = await win.evaluate((id) => window.api.sessions.get(id), sessions[0].id)
  assert.equal(session?.segments.length, captionCount, 'caption count does not match saved segments')
  assert.equal(session?.segments[0].speaker, 'Student')
  assert.match(session?.segments[0].text ?? '', /A/)

  await win.getByRole('button', { name: /Open transcript/i }).click()
  await win.locator('.segment').first().waitFor({ timeout: 10_000 })
  assert.match((await win.locator('.segment').first().textContent()) ?? '', /A/)

  // Leaving the import page revokes the opaque media token.
  await win.getByRole('button', { name: /Fingerspelling/i }).click()
  await win.waitForTimeout(600)
  const revoked = await win.evaluate(async (oldToken) => {
    try {
      await window.api.sign.classify(new Uint8Array(224 * 224 * 3), 224, 224, 'video', oldToken)
      return 'allowed'
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }, token)
  assert.match(revoked, /video source is not open/i, 'closed video token was still accepted')

  await app.close()

  const dataDir = join(userData, 'data')
  assert.deepEqual(
    readdirSync(dataDir).filter((file) => /\.(wav|webm|mp4|mov|png|jpg|jpeg|y4m)$/i.test(file)),
    [],
    'imported video or sampled frames were written to the profile'
  )
  assert.equal(statSync(join(dataDir, 'key.bin')).mode & 0o077, 0, 'key permissions are too broad')

  console.log(
    JSON.stringify(
      {
        ok: true,
        source: 'local MP4 · no camera permission',
        captions: captionTexts,
        captionCount,
        savedSegments: session?.segments.length,
        tokenRevoked: true,
        rawMediaFiles: 0
      },
      null,
      2
    )
  )
} catch (error) {
  await app.close().catch(() => {})
  throw error
}
