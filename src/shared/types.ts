export type Speaker = 'Teacher' | 'Student' | 'Unknown'
export type FontSize = 'sm' | 'md' | 'lg' | 'xl'
export type Theme = 'dark' | 'contrast' | 'light'
export type EngineId = 'whisper' | 'demo' | 'webspeech'
export type View = 'captions' | 'sign' | 'sessions' | 'privacy'

export interface Segment {
  id: string
  sessionId: string
  speaker: Speaker
  startMs: number
  endMs: number
  text: string
  confidence: number
  isBookmark: boolean
}

export interface Session {
  id: string
  title: string
  startedAt: number
  endedAt: number | null
  retentionDays: number
  segments: Segment[]
}

export interface SessionSummary {
  id: string
  title: string
  startedAt: number
  endedAt: number | null
  retentionDays: number
  segmentCount: number
  bookmarkCount: number
  preview: string
}

export interface Settings {
  fontSize: FontSize
  theme: Theme
  retentionDays: number
  glossary: string[]
  showSpeakerLabels: boolean
  engine: EngineId
  anonymizeExport: boolean
  reduceMotion: boolean
}

export interface Consent {
  version: string
  acceptedAt: number
  microphone: boolean
  camera: boolean
  storage: boolean
}

export interface AuditEntry {
  id: string
  ts: number
  event: 'consent' | 'session_start' | 'session_end' | 'export' | 'delete' | 'delete_all' | 'settings'
  meta: string
}

export interface PrivacyStatus {
  encryption: 'keychain' | 'file-permissions' | 'unavailable'
  dataPath: string
  modelPresent: boolean
  asrServerPresent: boolean
  asrReady: boolean
  signModelPresent: boolean
  blockedRequests: number
  sessionCount: number
  bytes: number
  retentionDays: number
}

export interface AppInfo {
  version: string
  platform: string
  isPackaged: boolean
}

export interface TranscribeResult {
  text: string
  confidence: number
  ms: number
}

export interface SignPrediction {
  label: string
  score: number
}

export interface SignResult {
  predictions: SignPrediction[]
  ms: number
  skipped: boolean
  error?: string
}

export interface SignStatus {
  modelPresent: boolean
  ready: boolean
  error: string | null
  labels: string[]
}

/** A file the user explicitly chose. `url` is an opaque app-protocol token. */
export interface VideoFile {
  token: string
  name: string
  sizeBytes: number
  mime: string
  url: string
}

export interface VideoCaption {
  text: string
  startMs: number
  endMs: number
  confidence: number
}

export interface ExportResult {
  saved: boolean
  path?: string
  bytes?: number
}

export const CONSENT_VERSION = '1.0'

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 'lg',
  theme: 'dark',
  retentionDays: 7,
  glossary: ['eigenvalue', 'Hamiltonian', 'non-degenerate', 'entropy', 'mitochondria'],
  showSpeakerLabels: true,
  engine: 'whisper',
  anonymizeExport: true,
  reduceMotion: false
}

export const RETENTION_OPTIONS = [
  { value: 0, label: 'Keep until I delete' },
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' }
] as const
