import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const fixture = join(root, 'build', 'sign-a.mp4')
const userData = mkdtempSync(join(tmpdir(), 'echoclass-video-debug-'))
const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: { ...process.env, ECHOCLASS_USER_DATA: userData },
  timeout: 30_000
})
const win = await app.firstWindow()
win.on('console', (msg) => console.log('console:', msg.type(), msg.text()))
win.on('pageerror', (err) => console.log('pageerror:', err.message))
await win.waitForLoadState('domcontentloaded')
await win.getByText('Your classroom, captioned').waitFor({ timeout: 15_000 })
await win.getByRole('button', { name: /Start with these choices/i }).click()
await win.getByText('Follow every word.').waitFor({ timeout: 10_000 })
await win.getByRole('button', { name: /Fingerspelling/i }).click()
await win.getByText('Camera access is off').waitFor({ timeout: 15_000 })
await win.getByRole('tab', { name: /Video file/i }).click()
await win.getByText('Caption a local video').waitFor({ timeout: 10_000 })
await app.evaluate(({ dialog }, filePath) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
}, fixture)
await win.getByRole('button', { name: /Choose a video/i }).click()
await win.waitForTimeout(3000)
const state = await win.evaluate(() => {
  const v = document.querySelector('.video-frame video')
  return {
    src: v?.src,
    readyState: v?.readyState,
    networkState: v?.networkState,
    error: v?.error ? { code: v.error.code, message: v.error.message } : null,
    duration: v?.duration,
    videoWidth: v?.videoWidth,
    videoHeight: v?.videoHeight,
    crossOrigin: v?.crossOrigin,
    alert: document.querySelector('.inline-alert')?.textContent,
    meta: document.querySelector('.video-file-meta')?.textContent,
    progress: document.querySelector('.video-progress + .confidence-meta')?.textContent
  }
})
console.log(JSON.stringify(state, null, 2))
await win.screenshot({ path: join(root, 'docs', 'debug-video.png') })
await app.close()
