import { describe, expect, it } from 'vitest'
import { applyGlossary, cleanTranscript } from '../src/shared/text'

describe('glossary correction', () => {
  it('repairs split words', () => {
    expect(applyGlossary('the eigen value is real', ['eigenvalue'])).toBe('the eigenvalue is real')
  })

  it('repairs hyphenation and keeps the canonical spelling', () => {
    expect(applyGlossary('the spectrum is non degenerate', ['non-degenerate'])).toBe('the spectrum is non-degenerate')
  })

  it('is case-insensitive but preserves the canonical term', () => {
    expect(applyGlossary('The HAMILTONIAN is conserved', ['Hamiltonian'])).toBe('The Hamiltonian is conserved')
  })

  it('leaves unrelated text alone', () => {
    expect(applyGlossary('please open the window', ['eigenvalue'])).toBe('please open the window')
  })

  it('ignores terms shorter than three characters', () => {
    expect(applyGlossary('a b c', ['a', 'b'])).toBe('a b c')
  })
})

describe('transcript cleaning', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(cleanTranscript('hello\u0000   world\n\nagain')).toBe('hello world again')
  })

  it('caps length', () => {
    expect(cleanTranscript('x'.repeat(50), 10)).toHaveLength(10)
  })
})
