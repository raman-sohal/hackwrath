import { describe, expect, it } from 'vitest'
import { decryptJson, encryptJson, generateKey } from '../src/main/crypto'

describe('encrypted store crypto', () => {
  it('round-trips a JSON value', () => {
    const key = generateKey()
    const value = { sessions: [{ text: 'the Hamiltonian is non-degenerate' }], n: 3 }
    const payload = encryptJson(key, value)
    expect(payload.subarray(0, 1)[0]).toBe(1)
    expect(decryptJson(key, payload)).toEqual(value)
  })

  it('produces a different ciphertext each time (fresh IV)', () => {
    const key = generateKey()
    const a = encryptJson(key, { text: 'same' })
    const b = encryptJson(key, { text: 'same' })
    expect(a.equals(b)).toBe(false)
  })

  it('rejects a tampered ciphertext', () => {
    const key = generateKey()
    const payload = encryptJson(key, { text: 'secret lecture' })
    payload[payload.length - 1] ^= 0xff
    expect(() => decryptJson(key, payload)).toThrow()
  })

  it('rejects the wrong key', () => {
    const payload = encryptJson(generateKey(), { text: 'secret' })
    expect(() => decryptJson(generateKey(), payload)).toThrow()
  })

  it('does not reveal the plaintext in the file bytes', () => {
    const payload = encryptJson(generateKey(), { text: 'confidential student transcript' })
    expect(payload.toString('utf8')).not.toContain('confidential')
  })
})
