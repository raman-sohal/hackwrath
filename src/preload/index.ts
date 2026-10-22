import { contextBridge, ipcRenderer } from 'electron'

const api = {
  app: {
    info: () => ipcRenderer.invoke('app:info')
  },
  consent: {
    get: () => ipcRenderer.invoke('consent:get'),
    set: (consent: { microphone: boolean; camera: boolean; storage: boolean }) =>
      ipcRenderer.invoke('consent:set', consent)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:update', patch)
  },
  sessions: {
    create: (title?: string) => ipcRenderer.invoke('session:create', title),
    list: () => ipcRenderer.invoke('session:list'),
    get: (id: string) => ipcRenderer.invoke('session:get', id),
    end: (id: string) => ipcRenderer.invoke('session:end', id),
    append: (segment: {
      sessionId: string
      text: string
      speaker: string
      startMs: number
      endMs: number
      confidence?: number
    }) => ipcRenderer.invoke('session:append', segment),
    bookmark: (sessionId: string, segmentId: string) =>
      ipcRenderer.invoke('session:bookmark', sessionId, segmentId),
    remove: (id: string) => ipcRenderer.invoke('session:delete', id),
    removeAll: () => ipcRenderer.invoke('session:delete-all'),
    seedDemo: () => ipcRenderer.invoke('session:seed-demo'),
    export: (id: string, opts: { anonymize: boolean; timestamps: boolean; bookmarksOnly: boolean }) =>
      ipcRenderer.invoke('session:export', id, opts)
  },
  exportAll: () => ipcRenderer.invoke('export:all'),
  privacy: {
    status: () => ipcRenderer.invoke('privacy:status'),
    openDataFolder: () => ipcRenderer.invoke('privacy:open-data-folder')
  },
  media: {
    grant: (kind: 'microphone' | 'camera', allowed: boolean) =>
      ipcRenderer.invoke('media:grant', kind, allowed)
  },
  asr: {
    status: () => ipcRenderer.invoke('asr:status'),
    transcribe: (pcm: ArrayBuffer, sampleRate: number) =>
      ipcRenderer.invoke('asr:transcribe', { pcm, sampleRate })
  },
  sign: {
    status: () => ipcRenderer.invoke('sign:status'),
    classify: (rgb: Uint8Array, width: number, height: number, source: 'camera' | 'video' = 'camera', token?: string) =>
      ipcRenderer.invoke('sign:classify', { rgb, width, height, source, token })
  },
  video: {
    open: () => ipcRenderer.invoke('video:open'),
    close: (token: string) => ipcRenderer.invoke('video:close', token)
  },
  events: {
    onBlocked: (cb: (count: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, count: number) => cb(count)
      ipcRenderer.on('net:blocked', handler)
      return () => ipcRenderer.removeListener('net:blocked', handler)
    },
    onPurged: (cb: (count: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, count: number) => cb(count)
      ipcRenderer.on('retention:purged', handler)
      return () => ipcRenderer.removeListener('retention:purged', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type EchoApi = typeof api
