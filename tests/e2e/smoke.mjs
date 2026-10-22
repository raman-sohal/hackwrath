import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const userData = mkdtempSync(join(tmpdir(), 'echoclass-e2e-'))
mkdirSync(join(root, 'docs'), { recursive: true })

const app = await electron.launch({
  args: ['.'],
  cwd: root,
  env: { ...process.env, ECHOCLASS_USER_DATA: userData },
  timeout: 30_000
})

const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')

const dismissToast = async () => {
  const close = win.locator('.toast-close')
  if ((await close.count()) > 0) {
    await close.first().click()
    await win.waitForTimeout(150)
  }
}

// 1. Consent screen
await win.getByText('Your classroom, captioned').waitFor({ timeout: 15_000 })
await win.screenshot({ path: join(root, 'docs', 'consent.png') })

// 2. Accept defaults (mic on, camera off, storage on)
await win.getByRole('button', { name: /Start with these choices/i }).click()
await win.getByText('Follow every word.').waitFor({ timeout: 10_000 })
await win.screenshot({ path: join(root, 'docs', 'welcome.png') })

// 3. Live demo engine: segments arrive, pause works, session ends cleanly
await win.getByRole('button', { name: /Play it live/i }).click()
await win.waitForSelector('.segment', { timeout: 15_000 })
await win.waitForFunction(() => document.querySelectorAll('.segment').length >= 2, null, { timeout: 15_000 })
await dismissToast()
await win.screenshot({ path: join(root, 'docs', 'live.png') })
await win.getByRole('button', { name: /Pause captions/i }).click()
assert.match(await win.locator('.control-primary-label').textContent(), /Paused/)
await win.getByRole('button', { name: /^End$/ }).click()
await win.getByRole('button', { name: /End and save/i }).click()
await win.getByText('Follow every word.').waitFor({ timeout: 10_000 })

// 4. Seeded demo lecture for a full transcript
await win.getByRole('button', { name: /Try the demo lecture/i }).click()
await win.waitForSelector('.segment', { timeout: 10_000 })
await win.waitForTimeout(1200)
await dismissToast()
await win.screenshot({ path: join(root, 'docs', 'captions.png') })

// 5. Bookmark the first segment
await win.locator('.segment').first().hover()
await win.locator('.segment').first().locator('.bookmark-button').click()
await win.waitForTimeout(300)

// 6. Privacy center
await win.getByRole('button', { name: /Privacy center/i }).click()
await win.getByText('Nothing leaves this laptop.').waitFor({ timeout: 10_000 })
await win.waitForTimeout(400)
await dismissToast()
await win.screenshot({ path: join(root, 'docs', 'privacy.png') })

// 7. Renderer isolation checks
const isolation = await win.evaluate(() => ({
  require: typeof window.require,
  process: typeof window.process,
  module: typeof window.module,
  api: typeof window.api
}))
assert.equal(isolation.require, 'undefined', 'window.require must be undefined')
assert.equal(isolation.process, 'undefined', 'window.process must be undefined')
assert.equal(isolation.module, 'undefined', 'window.module must be undefined')
assert.equal(isolation.api, 'object', 'preload API must be exposed')

// 8. Sessions page
await win.getByRole('button', { name: /Sessions/i }).click()
await win.getByRole('heading', { name: 'Demo — Introduction to Quantum Mechanics', exact: true }).waitFor({ timeout: 10_000 })
assert.match(await win.locator('.nav-item.is-active').textContent(), /Sessions/)
await dismissToast()
await win.screenshot({ path: join(root, 'docs', 'sessions.png') })

await app.close()

// 9. Data at rest checks
const dataDir = join(userData, 'data')
const store = readFileSync(join(dataDir, 'store.bin'))
assert.ok(store.length > 0, 'store must exist')
assert.ok(!store.toString('utf8').includes('Hamiltonian'), 'store must not contain plaintext transcript')
assert.ok(!readdirSync(dataDir).some((f) => /\.(wav|webm|mp3|png|jpg)$/i.test(f)), 'no raw media files')

const keyStat = statSync(join(dataDir, 'key.bin'))
assert.equal(keyStat.mode & 0o077, 0, 'key file must not be group/world readable')

console.log(
  JSON.stringify(
    {
      ok: true,
      userData,
      screenshots: ['consent.png', 'welcome.png', 'live.png', 'captions.png', 'privacy.png', 'sessions.png'],
      isolation,
      storeBytes: store.length,
      keyMode: (keyStat.mode & 0o777).toString(8)
    },
    null,
    2
  )
)
