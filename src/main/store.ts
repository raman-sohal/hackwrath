import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type {
  AuditEntry,
  Consent,
  PrivacyStatus,
  Session,
  SessionSummary,
  Settings,
  Segment,
  Speaker
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { decryptJson, encryptJson, generateKey } from './crypto'

interface DB {
  version: 1
  consent: Consent | null
  settings: Settings
  sessions: Session[]
  audit: AuditEntry[]
}

const EMPTY_DB: DB = {
  version: 1,
  consent: null,
  settings: { ...DEFAULT_SETTINGS },
  sessions: [],
  audit: []
}

export class SecureStore {
  readonly dir: string
  readonly dataPath: string
  private readonly keyPath: string
  private key!: Buffer
  private db!: DB
  private encryption: PrivacyStatus['encryption'] = 'unavailable'

  private constructor(dir = join(app.getPath('userData'), 'data')) {
    this.dir = dir
    this.dataPath = join(dir, 'store.bin')
    this.keyPath = join(dir, 'key.bin')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  static async create(dir?: string): Promise<SecureStore> {
    const store = new SecureStore(dir)
    store.key = await store.loadOrCreateKey()
    store.db = store.load()
    return store
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    try {
      if (existsSync(this.keyPath)) {
        const raw = readFileSync(this.keyPath)
        const mode = raw.subarray(0, 2).toString('ascii')
        if (mode === 'S1') {
          this.encryption = 'keychain'
          const decrypted = await safeStorage.decryptStringAsync(raw.subarray(2))
          if (decrypted.shouldReEncrypt) {
            const rewrapped = await safeStorage.encryptStringAsync(decrypted.result)
            writeFileSync(this.keyPath, Buffer.concat([Buffer.from('S1'), rewrapped]), { mode: 0o600 })
          }
          return Buffer.from(decrypted.result, 'base64')
        }
        if (mode === 'P1') {
          this.encryption = 'file-permissions'
          return raw.subarray(2)
        }
        // Legacy/keyless file: replace it rather than trusting unknown bytes.
        throw new Error('unrecognised key format')
      }
    } catch {
      // Fall through and create a new key. Existing data will be unreadable,
      // which is safer than silently using a weak key.
    }

    const key = generateKey()
    if (await safeStorage.isAsyncEncryptionAvailable()) {
      const wrapped = await safeStorage.encryptStringAsync(key.toString('base64'))
      writeFileSync(this.keyPath, Buffer.concat([Buffer.from('S1'), wrapped]), { mode: 0o600 })
      this.encryption = 'keychain'
    } else {
      writeFileSync(this.keyPath, Buffer.concat([Buffer.from('P1'), key]), { mode: 0o600 })
      this.encryption = 'file-permissions'
    }
    return key
  }

  private load(): DB {
    try {
      if (!existsSync(this.dataPath)) return structuredClone(EMPTY_DB)
      const raw = readFileSync(this.dataPath)
      const parsed = decryptJson<DB>(this.key, raw)
      if (parsed.version !== 1) return structuredClone(EMPTY_DB)
      return {
        ...structuredClone(EMPTY_DB),
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...parsed.settings }
      }
    } catch {
      // Corrupt or tampered data is never rendered. Move it aside and start clean.
      try {
        if (existsSync(this.dataPath)) renameSync(this.dataPath, `${this.dataPath}.corrupt-${Date.now()}`)
      } catch {
        /* ignore */
      }
      return structuredClone(EMPTY_DB)
    }
  }

  private persist(): void {
    const payload = encryptJson(this.key, this.db)
    const tmp = `${this.dataPath}.tmp`
    writeFileSync(tmp, payload, { mode: 0o600 })
    renameSync(tmp, this.dataPath)
  }

  private audit(event: AuditEntry['event'], meta = ''): void {
    this.db.audit.push({ id: randomUUID(), ts: Date.now(), event, meta })
    // Metadata only. Keep the log small.
    if (this.db.audit.length > 500) this.db.audit.splice(0, this.db.audit.length - 500)
  }

  // ---- consent & settings ----

  getConsent(): Consent | null {
    return this.db.consent
  }

  setConsent(consent: Consent): Consent {
    this.db.consent = consent
    this.audit('consent', `v${consent.version}`)
    this.persist()
    return consent
  }

  getSettings(): Settings {
    return this.db.settings
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const clean: Partial<Settings> = {}
    if (patch.fontSize && ['sm', 'md', 'lg', 'xl'].includes(patch.fontSize)) clean.fontSize = patch.fontSize
    if (patch.theme && ['dark', 'contrast', 'light'].includes(patch.theme)) clean.theme = patch.theme
    if (typeof patch.retentionDays === 'number' && [0, 1, 7, 30].includes(patch.retentionDays)) {
      clean.retentionDays = patch.retentionDays
    }
    if (Array.isArray(patch.glossary)) {
      clean.glossary = [...new Set(patch.glossary.map((t) => String(t).trim()).filter(Boolean))].slice(0, 50)
    }
    if (typeof patch.showSpeakerLabels === 'boolean') clean.showSpeakerLabels = patch.showSpeakerLabels
    if (patch.engine && ['whisper', 'demo', 'webspeech'].includes(patch.engine)) clean.engine = patch.engine
    if (typeof patch.anonymizeExport === 'boolean') clean.anonymizeExport = patch.anonymizeExport
    if (typeof patch.reduceMotion === 'boolean') clean.reduceMotion = patch.reduceMotion
    this.db.settings = { ...this.db.settings, ...clean }
    this.audit('settings')
    this.persist()
    return this.db.settings
  }

  // ---- sessions ----

  createSession(title?: string): Session {
    const now = Date.now()
    const session: Session = {
      id: randomUUID(),
      title: title?.trim() || `Lecture — ${new Date(now).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
      startedAt: now,
      endedAt: null,
      retentionDays: this.db.settings.retentionDays,
      segments: []
    }
    this.db.sessions.unshift(session)
    this.audit('session_start', session.id)
    this.persist()
    return session
  }

  listSessions(): SessionSummary[] {
    return this.db.sessions.map((s) => ({
      id: s.id,
      title: s.title,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      retentionDays: s.retentionDays,
      segmentCount: s.segments.length,
      bookmarkCount: s.segments.filter((x) => x.isBookmark).length,
      preview: s.segments.slice(0, 1).map((x) => x.text).join(' ').slice(0, 140)
    }))
  }

  getSession(id: string): Session | null {
    return this.db.sessions.find((s) => s.id === id) ?? null
  }

  endSession(id: string): Session | null {
    const session = this.getSession(id)
    if (!session) return null
    session.endedAt = Date.now()
    this.audit('session_end', id)
    this.persist()
    return session
  }

  appendSegment(
    sessionId: string,
    input: { text: string; speaker: Speaker; startMs: number; endMs: number; confidence?: number }
  ): Segment | null {
    const session = this.getSession(sessionId)
    if (!session) return null
    const text = input.text.trim()
    if (!text) return null
    const segment: Segment = {
      id: randomUUID(),
      sessionId,
      speaker: input.speaker,
      startMs: Math.max(0, Math.round(input.startMs)),
      endMs: Math.max(0, Math.round(input.endMs)),
      text: text.slice(0, 4000),
      confidence: typeof input.confidence === 'number' ? Math.min(1, Math.max(0, input.confidence)) : 0.9,
      isBookmark: false
    }
    session.segments.push(segment)
    this.persist()
    return segment
  }

  toggleBookmark(sessionId: string, segmentId: string): Segment | null {
    const session = this.getSession(sessionId)
    const segment = session?.segments.find((s) => s.id === segmentId)
    if (!segment) return null
    segment.isBookmark = !segment.isBookmark
    this.persist()
    return segment
  }

  deleteSession(id: string): boolean {
    const before = this.db.sessions.length
    this.db.sessions = this.db.sessions.filter((s) => s.id !== id)
    if (this.db.sessions.length === before) return false
    this.audit('delete', id)
    this.persist()
    return true
  }

  deleteAll(): void {
    this.db.sessions = []
    this.db.audit = []
    this.audit('delete_all')
    this.persist()
  }

  seedDemo(): Session {
    const now = Date.now()
    const session: Session = {
      id: randomUUID(),
      title: 'Demo — Introduction to Quantum Mechanics',
      startedAt: now - 6 * 60_000,
      endedAt: now - 60_000,
      retentionDays: this.db.settings.retentionDays,
      segments: []
    }
    const script: Array<[Speaker, string]> = [
      ['Teacher', 'Good morning. Today we are going to talk about the Hamiltonian and why it matters.'],
      ['Teacher', 'The Hamiltonian is the operator that represents the total energy of the system.'],
      ['Teacher', 'For a simple harmonic oscillator, the Hamiltonian is the sum of kinetic and potential energy.'],
      ['Student', 'Sorry, could you repeat the part about the eigenvalues?'],
      ['Teacher', 'Of course. The eigenvalues of the Hamiltonian are the allowed energy levels.'],
      ['Teacher', 'When we say the spectrum is non-degenerate, we mean each eigenvalue has exactly one eigenstate.'],
      ['Teacher', 'Degeneracy appears when two or more states share the same energy.'],
      ['Student', 'So degeneracy is a kind of symmetry, right?'],
      ['Teacher', 'Exactly. Symmetry usually implies degeneracy, and that connection is deeply useful.'],
      ['Teacher', 'Let us write the time-independent Schrodinger equation on the board.'],
      ['Teacher', 'Remember, the wavefunction must be normalisable for a bound state.'],
      ['Teacher', 'We will revisit this with the hydrogen atom next week.'],
      ['Teacher', 'Before you leave, read the first two sections of the notes.'],
      ['Teacher', 'And please bring one question about the spectrum to the next class.']
    ]
    let t = 0
    for (const [speaker, text] of script) {
      const dur = Math.min(9000, Math.max(2500, text.length * 55))
      session.segments.push({
        id: randomUUID(),
        sessionId: session.id,
        speaker,
        startMs: t,
        endMs: t + dur,
        text,
        confidence: 0.92,
        isBookmark: false
      })
      t += dur + 800
    }
    session.segments[5].isBookmark = true
    session.segments[9].isBookmark = true
    this.db.sessions.unshift(session)
    this.audit('session_start', 'demo')
    this.audit('session_end', 'demo')
    this.persist()
    return session
  }

  // ---- retention ----

  purgeExpired(now = Date.now()): number {
    const before = this.db.sessions.length
    this.db.sessions = this.db.sessions.filter((s) => {
      if (s.endedAt === null) return true
      if (s.retentionDays === 0) return true
      return now - s.endedAt < s.retentionDays * 86_400_000
    })
    const removed = before - this.db.sessions.length
    this.db.audit = this.db.audit.filter((a) => now - a.ts < 30 * 86_400_000)
    if (removed > 0) {
      this.audit('delete', `retention:${removed}`)
      this.persist()
    }
    return removed
  }

  // ---- privacy ----

  getPrivacyStatus(extra: {
    modelPresent: boolean
    asrServerPresent: boolean
    asrReady: boolean
    signModelPresent: boolean
    blockedRequests: number
  }): PrivacyStatus {
    let bytes = 0
    try {
      bytes = existsSync(this.dataPath) ? statSync(this.dataPath).size : 0
    } catch {
      bytes = 0
    }
    return {
      encryption: this.encryption,
      dataPath: this.dir,
      blockedRequests: extra.blockedRequests,
      sessionCount: this.db.sessions.length,
      bytes,
      retentionDays: this.db.settings.retentionDays,
      modelPresent: extra.modelPresent,
      asrServerPresent: extra.asrServerPresent,
      asrReady: extra.asrReady,
      signModelPresent: extra.signModelPresent
    }
  }

  // ---- export ----

  buildExport(sessionId: string, opts: { anonymize: boolean; timestamps: boolean; bookmarksOnly: boolean }): {
    filename: string
    content: string
  } | null {
    const session = this.getSession(sessionId)
    if (!session) return null
    const lines: string[] = []
    lines.push(`# ${session.title}`)
    lines.push('')
    lines.push(`- Date: ${new Date(session.startedAt).toLocaleString()}`)
    lines.push(`- Segments: ${session.segments.length}`)
    lines.push('- Captured with EchoClass. Audio and video were never recorded.')
    lines.push('')
    lines.push('---')
    lines.push('')
    const segments = opts.bookmarksOnly ? session.segments.filter((s) => s.isBookmark) : session.segments
    for (const s of segments) {
      const speaker = opts.anonymize ? '' : `**${s.speaker}** · `
      const stamp = opts.timestamps ? `[${formatMs(s.startMs)}] ` : ''
      const mark = s.isBookmark ? '★ ' : ''
      lines.push(`${mark}${stamp}${speaker}${escapeMarkdown(s.text)}`)
      lines.push('')
    }
    const safeTitle =
      session.title
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 60) || 'echoclass-session'
    return { filename: `${safeTitle}.md`, content: lines.join('\n') }
  }

  buildExportAll(): { filename: string; content: string } {
    const payload = {
      app: 'EchoClass',
      exportedAt: new Date().toISOString(),
      note: 'Contains text transcripts and metadata only. No audio or video was ever stored.',
      consent: this.db.consent,
      settings: this.db.settings,
      sessions: this.db.sessions
    }
    return { filename: `echoclass-export-${new Date().toISOString().slice(0, 10)}.json`, content: JSON.stringify(payload, null, 2) }
  }
}

export function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!>|])/g, '\\$1')
}

export function unlinkQuiet(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    /* ignore */
  }
}
