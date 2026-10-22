/**
 * Repairs the splits and hyphenation that ASR commonly introduces for course
 * terms. "eigen value" -> "eigenvalue", "non degenerate" -> "non-degenerate".
 * Deliberately conservative: only terms explicitly added by the user.
 */
export function applyGlossary(text: string, terms: string[]): string {
  let out = text
  for (const term of terms) {
    const clean = term.trim()
    if (clean.length < 3) continue
    // Multi-word or hyphenated terms match on word boundaries; single words
    // allow internal splits ("eigen value").
    const tokens = clean.split(/[^a-zA-Z0-9]+/).filter(Boolean)
    const pattern =
      tokens.length > 1
        ? tokens.map(escapeRegExp).join('[\\s-]*')
        : clean
            .split('')
            .map((ch) => escapeRegExp(ch))
            .join('[\\s-]*')
    try {
      out = out.replace(new RegExp(pattern, 'gi'), clean)
    } catch {
      // A malformed term must never break captioning.
    }
  }
  return out
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Strips control characters and normalises whitespace before storage. */
export function cleanTranscript(text: string, max = 4000): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}
