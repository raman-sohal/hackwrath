import { create } from 'zustand'
import type {
  Consent,
  PrivacyStatus,
  Segment,
  Session,
  SessionSummary,
  Settings,
  Speaker,
  VideoCaption,
  View
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { applyGlossary, cleanTranscript } from '@shared/text'

type ToastKind = 'ok' | 'warn' | 'error'

interface AppState {
  booted: boolean
  consent: Consent | null
  settings: Settings
  sessions: SessionSummary[]
  active: Session | null
  segments: Segment[]
  privacy: PrivacyStatus | null
  view: View
  listening: boolean
  paused: boolean
  interim: string
  level: number
  latencyMs: number | null
  speaker: Speaker
  engineError: string | null
  toast: { message: string; kind: ToastKind } | null
  announcement: string | null
  shield: boolean
  busy: boolean
  cameraActive: boolean

  init: () => Promise<void>
  acceptConsent: (c: { microphone: boolean; camera: boolean; storage: boolean }) => Promise<void>
  enableCamera: () => Promise<void>
  disableCamera: () => Promise<void>
  setCameraActive: (v: boolean) => void
  insertSignedText: (text: string, confidence: number) => Promise<boolean>
  insertVideoCaptions: (sourceName: string, captions: VideoCaption[]) => Promise<boolean>
  setView: (v: View) => void
  patchSettings: (patch: Partial<Settings>) => Promise<void>
  refreshSessions: () => Promise<void>
  refreshPrivacy: () => Promise<void>
  setBlocked: (n: number) => void
  createSession: (title?: string) => Promise<void>
  openSession: (id: string) => Promise<void>
  endSession: () => Promise<void>
  setListening: (v: boolean) => void
  setPaused: (v: boolean) => void
  setInterim: (t: string) => void
  setLevel: (n: number) => void
  setLatency: (n: number) => void
  setSpeaker: (s: Speaker) => void
  setEngineError: (e: string | null) => void
  commitSegment: (
    text: string,
    startMs: number,
    endMs: number,
    confidence?: number,
    speaker?: Speaker
  ) => Promise<void>
  toggleBookmark: (segmentId: string) => Promise<void>
  removeSession: (id: string) => Promise<void>
  removeAll: () => Promise<void>
  seedDemo: () => Promise<void>
  startLiveDemo: () => Promise<void>
  exportSession: (id: string) => Promise<void>
  exportAll: () => Promise<void>
  announce: (message: string) => void
  clearAnnouncement: () => void
  setShield: (v: boolean) => void
  showToast: (message: string, kind?: ToastKind) => void
  dismissToast: () => void
}

let announcementTimer: ReturnType<typeof setTimeout> | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useAppStore = create<AppState>()((set, get) => ({
  booted: false,
  consent: null,
  settings: { ...DEFAULT_SETTINGS },
  sessions: [],
  active: null,
  segments: [],
  privacy: null,
  view: 'captions',
  listening: false,
  paused: false,
  interim: '',
  level: 0,
  latencyMs: null,
  speaker: 'Teacher',
  engineError: null,
  toast: null,
  announcement: null,
  shield: false,
  busy: false,
  cameraActive: false,

  init: async () => {
    try {
      const [consent, settings, sessions, privacy] = await Promise.all([
        window.api.consent.get(),
        window.api.settings.get(),
        window.api.sessions.list(),
        window.api.privacy.status()
      ])
      set({ consent, settings, sessions, privacy, booted: true })
    } catch (err) {
      set({ booted: true, engineError: err instanceof Error ? err.message : 'Failed to initialise' })
    }
  },

  acceptConsent: async (c) => {
    const consent = await window.api.consent.set(c)
    set({ consent, settings: await window.api.settings.get() })
    await get().refreshPrivacy()
  },

  enableCamera: async () => {
    const c = get().consent
    if (!c) return
    const consent = await window.api.consent.set({
      microphone: c.microphone,
      camera: true,
      storage: c.storage
    })
    set({ consent })
    await get().refreshPrivacy()
  },

  disableCamera: async () => {
    const c = get().consent
    if (!c) return
    const consent = await window.api.consent.set({
      microphone: c.microphone,
      camera: false,
      storage: c.storage
    })
    set({ consent, cameraActive: false })
    await window.api.media.grant('camera', false)
    await get().refreshPrivacy()
  },

  setCameraActive: (cameraActive) => set({ cameraActive }),

  insertSignedText: async (text, confidence) => {
    const clean = text.trim()
    if (!clean) return false
    let active = get().active
    if (!active) {
      const session = await window.api.sessions.create('Fingerspelled notes')
      set({ active: session, segments: [], listening: false, paused: false })
      active = session
      await get().refreshSessions()
      await get().refreshPrivacy()
    }
    const now = Date.now() - active.startedAt
    await get().commitSegment(clean, Math.max(0, now - 1500), now, confidence, 'Student')
    return true
  },

  insertVideoCaptions: async (sourceName, captions) => {
    const clean = captions
      .map((caption) => ({ ...caption, text: caption.text.trim() }))
      .filter((caption) => caption.text.length > 0)
    if (clean.length === 0) return false

    let active = get().active
    if (!active) {
      const title = `Video — ${sourceName}`.slice(0, 100)
      const session = await window.api.sessions.create(title)
      set({ active: session, segments: [], listening: false, paused: false })
      active = session
      await get().refreshSessions()
      await get().refreshPrivacy()
    }

    // Append after anything already in the session so timestamps stay ordered.
    const baseMs = get().segments.reduce((latest, segment) => Math.max(latest, segment.endMs), 0)
    for (const caption of clean) {
      const startMs = baseMs + Math.max(0, Math.round(caption.startMs))
      const endMs = Math.max(startMs + 250, baseMs + Math.round(caption.endMs))
      await get().commitSegment(caption.text.slice(0, 4000), startMs, endMs, caption.confidence, 'Student')
    }
    return true
  },

  setView: (view) => set({ view }),

  patchSettings: async (patch) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    const saved = await window.api.settings.update(patch)
    set({ settings: saved })
    await get().refreshPrivacy()
  },

  refreshSessions: async () => {
    set({ sessions: await window.api.sessions.list() })
  },

  refreshPrivacy: async () => {
    set({ privacy: await window.api.privacy.status() })
  },

  setBlocked: (n) =>
    set((s) => (s.privacy ? { privacy: { ...s.privacy, blockedRequests: n } } : {})),

  createSession: async (title) => {
    const session = await window.api.sessions.create(title)
    set({
      active: session,
      segments: [],
      view: 'captions',
      listening: true,
      paused: false,
      interim: '',
      latencyMs: null,
      engineError: null
    })
    await get().refreshSessions()
    await get().refreshPrivacy()
  },

  openSession: async (id) => {
    const session = await window.api.sessions.get(id)
    if (!session) return
    set({
      active: session,
      segments: session.segments,
      view: 'captions',
      listening: false,
      paused: false,
      interim: ''
    })
  },

  endSession: async () => {
    const { active } = get()
    if (!active) return
    await window.api.sessions.end(active.id)
    set({ active: null, segments: [], listening: false, paused: false, interim: '', latencyMs: null })
    await get().refreshSessions()
    await get().refreshPrivacy()
    get().showToast('Session saved locally. Audio and video were never recorded.', 'ok')
  },

  setListening: (listening) => set({ listening, paused: false, engineError: null }),
  setPaused: (paused) => set({ paused }),
  setInterim: (interim) => set({ interim }),
  setLevel: (level) => set({ level }),
  setLatency: (latencyMs) => set({ latencyMs }),
  setSpeaker: (speaker) => set({ speaker }),
  setEngineError: (engineError) => set({ engineError }),

  commitSegment: async (text, startMs, endMs, confidence, speakerOverride) => {
    const { active, speaker, settings } = get()
    if (!active) return
    const repaired = applyGlossary(cleanTranscript(text), settings.glossary)
    if (!repaired) return
    const segment = await window.api.sessions.append({
      sessionId: active.id,
      text: repaired,
      speaker: speakerOverride ?? speaker,
      startMs,
      endMs,
      confidence
    })
    if (!segment) return
    set((s) => ({ segments: [...s.segments, segment], interim: '' }))
  },

  toggleBookmark: async (segmentId) => {
    const { active } = get()
    if (!active) return
    const updated = await window.api.sessions.bookmark(active.id, segmentId)
    if (!updated) return
    set((s) => ({
      segments: s.segments.map((seg) => (seg.id === updated.id ? updated : seg))
    }))
    await get().refreshSessions()
  },

  removeSession: async (id) => {
    await window.api.sessions.remove(id)
    if (get().active?.id === id) {
      set({ active: null, segments: [], listening: false, paused: false })
    }
    await get().refreshSessions()
    await get().refreshPrivacy()
    get().showToast('Session deleted.', 'ok')
  },

  removeAll: async () => {
    await window.api.sessions.removeAll()
    set({ active: null, segments: [], listening: false, paused: false })
    await get().refreshSessions()
    await get().refreshPrivacy()
    get().showToast('All local data deleted.', 'ok')
  },

  seedDemo: async () => {
    const session = await window.api.sessions.seedDemo()
    set({ active: session, segments: session.segments, view: 'captions', listening: false, paused: false })
    await get().refreshSessions()
    await get().refreshPrivacy()
    get().showToast('Demo lecture loaded. No microphone needed.', 'ok')
  },

  startLiveDemo: async () => {
    await get().patchSettings({ engine: 'demo' })
    await get().createSession('Live demo — Introduction to Quantum Mechanics')
    set({ listening: true, paused: false })
    get().showToast('Live demo running. No microphone needed.', 'ok')
  },

  exportSession: async (id) => {
    const { settings } = get()
    const result = await window.api.sessions.export(id, {
      anonymize: settings.anonymizeExport,
      timestamps: true,
      bookmarksOnly: false
    })
    if (result.saved) get().showToast(`Exported to ${result.path}`, 'ok')
  },

  exportAll: async () => {
    const result = await window.api.exportAll()
    if (result.saved) get().showToast('All data exported as JSON.', 'ok')
  },

  announce: (message) => {
    if (announcementTimer) clearTimeout(announcementTimer)
    set({ announcement: message })
    announcementTimer = setTimeout(() => set({ announcement: null }), 5000)
  },

  clearAnnouncement: () => set({ announcement: null }),
  setShield: (shield) => set({ shield }),

  showToast: (message, kind = 'ok') => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: { message, kind } })
    toastTimer = setTimeout(() => set({ toast: null }), 4200)
  },

  dismissToast: () => set({ toast: null })
}))
