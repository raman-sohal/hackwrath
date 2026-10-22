import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const MODEL = process.argv[2] ?? 'tiny.en'
const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin`
const dir = join(process.cwd(), 'models')
const target = join(dir, `ggml-${MODEL}.bin`)

// Pinned digest for the model we ship and verify at runtime.
const CHECKSUMS = {
  'tiny.en': '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f'
}

async function sha256(path) {
  const hash = createHash('sha256')
  const { createReadStream } = await import('node:fs')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

if (existsSync(target)) {
  const digest = await sha256(target)
  const expected = CHECKSUMS[MODEL]
  if (expected && digest !== expected) {
    console.error(`Existing model has the wrong checksum:\n  expected ${expected}\n  got      ${digest}`)
    console.error(`Delete ${target} and run this script again.`)
    process.exit(1)
  }
  console.log(`Model already present: ${target} (${(statSync(target).size / 1e6).toFixed(1)} MB)`)
  process.exit(0)
}

mkdirSync(dir, { recursive: true })
console.log(`Downloading ${MODEL} from ${url}`)

const res = await fetch(url)
if (!res.ok || !res.body) {
  console.error(`Download failed: HTTP ${res.status}`)
  process.exit(1)
}

await pipeline(Readable.fromWeb(res.body), createWriteStream(target, { mode: 0o600 }))

const digest = await sha256(target)
const expected = CHECKSUMS[MODEL]
if (expected && digest !== expected) {
  console.error(`Checksum mismatch:\n  expected ${expected}\n  got      ${digest}`)
  unlinkSync(target)
  process.exit(1)
}
if (!expected) console.warn('No pinned checksum for this model; verify it manually before shipping.')

console.log(`Saved ${target} (${(statSync(target).size / 1e6).toFixed(1)} MB)`)
console.log(`SHA-256 ${digest}`)
console.log('Tip: base.en is more accurate but slower. Pass it as an argument to fetch that model.')
