import type {
  AppInfo,
  Consent,
  ExportResult,
  PrivacyStatus,
  Segment,
  Session,
  SessionSummary,
  Settings,
  SignResult,
  SignStatus,
  TranscribeResult,
  VideoFile
} from '../shared/types'

export interface EchoApi {
  app: { info: () => Promise<AppInfo> }
  consent: {
    get: () => Promise<Consent | null>
    set: (consent: { microphone: boolean; camera: boolean; storage: boolean }) => Promise<Consent>
  }
  settings: {
    get: () => Promise<Settings>
    update: (patch: Partial<Settings>) => Promise<Settings>
  }
  sessions: {
    create: (title?: string) => Promise<Session>
    list: () => Promise<SessionSummary[]>
    get: (id: string) => Promise<Session | null>
    end: (id: string) => Promise<Session | null>
    append: (segment: {
      sessionId: string
      text: string
      speaker: string
      startMs: number
      endMs: number
      confidence?: number
    }) => Promise<Segment | null>
    bookmark: (sessionId: string, segmentId: string) => Promise<Segment | null>
    remove: (id: string) => Promise<boolean>
    removeAll: () => Promise<boolean>
    seedDemo: () => Promise<Session>
    export: (
      id: string,
      opts: { anonymize: boolean; timestamps: boolean; bookmarksOnly: boolean }
    ) => Promise<ExportResult>
  }
  exportAll: () => Promise<ExportResult>
  privacy: {
    status: () => Promise<PrivacyStatus>
    openDataFolder: () => Promise<string>
  }
  media: { grant: (kind: 'microphone' | 'camera', allowed: boolean) => Promise<boolean> }
  asr: {
    status: () => Promise<{ modelPresent: boolean; serverPresent: boolean; ready: boolean; error: string | null }>
    transcribe: (pcm: ArrayBuffer, sampleRate: number) => Promise<TranscribeResult>
  }
  sign: {
    status: () => Promise<SignStatus>
    classify: (
      rgb: Uint8Array,
      width: number,
      height: number,
      source?: 'camera' | 'video',
      token?: string
    ) => Promise<SignResult>
  }
  video: {
    open: () => Promise<VideoFile | null>
    close: (token: string) => Promise<boolean>
  }
  events: {
    onBlocked: (cb: (count: number) => void) => () => void
    onPurged: (cb: (count: number) => void) => () => void
  }
}

declare global {
  interface Window {
    api: EchoApi
  }
}

export {}
