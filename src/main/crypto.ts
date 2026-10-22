import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * Encrypts a JSON-serialisable value with AES-256-GCM.
 * Layout: [version(1) | iv(12) | tag(16) | ciphertext]
 * A fresh random IV is used for every write.
 */
export function encryptJson(key: Buffer, value: unknown): Buffer {
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes')
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext])
}

/** Decrypts and authenticates a payload produced by encryptJson. */
export function decryptJson<T>(key: Buffer, payload: Buffer): T {
  if (payload.length < 1 + IV_BYTES + TAG_BYTES) throw new Error('ciphertext too short')
  const version = payload[0]
  if (version !== VERSION) throw new Error(`unsupported ciphertext version ${version}`)
  const iv = payload.subarray(1, 1 + IV_BYTES)
  const tag = payload.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES)
  const ciphertext = payload.subarray(1 + IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plaintext.toString('utf8')) as T
}

/** Generates a random 32-byte data key. */
export function generateKey(): Buffer {
  return randomBytes(32)
}
