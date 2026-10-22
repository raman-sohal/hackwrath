import { join } from 'node:path'
import { app, BrowserWindow, session, shell } from 'electron'
import { SecureStore } from './store'
import { WhisperService } from './asr'
import { SignService } from './sign'
import { MediaPermissions, registerIpc } from './ipc'
import { hardenWebContents, installCsp, installNetworkGuard } from './security'
import { VideoLibrary } from './video'

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let store: SecureStore | null = null
let asr: WhisperService | null = null
let sign: SignService | null = null
let videos: VideoLibrary | null = null
let blockedRequests = 0
let purgeTimer: NodeJS.Timeout | null = null

app.setName('EchoClass')

// Must be declared before `ready`. The scheme only ever serves files the user
// explicitly selected through the native dialog.
VideoLibrary.registerScheme()

// Test/QA isolation: lets an end-to-end test use a throwaway profile without
// touching the user's real encrypted store.
if (process.env.ECHOCLASS_USER_DATA) {
  app.setPath('userData', process.env.ECHOCLASS_USER_DATA)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#070b14',
    title: 'EchoClass',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: isDev
    }
  })

  win.once('ready-to-show', () => win.show())

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })

  return win
}

app.whenReady().then(async () => {
  const secureStore = await SecureStore.create()
  store = secureStore
  asr = new WhisperService()
  sign = new SignService()
  videos = new VideoLibrary()
  videos.registerProtocol()
  const media = new MediaPermissions()

  const defaultSession = session.defaultSession
  installCsp(defaultSession, isDev)
  installNetworkGuard(defaultSession, isDev, (count) => {
    blockedRequests = count
    mainWindow?.webContents.send('net:blocked', count)
  })
  defaultSession.setSpellCheckerEnabled(false)

  defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const trusted = wc === mainWindow?.webContents
    if (!trusted) return callback(false)
    if (permission === 'media') {
      const types = (details as { mediaTypes?: string[] }).mediaTypes ?? []
      const wantsAudio = types.includes('audio') || types.length === 0
      const wantsVideo = types.includes('video')
      return callback((wantsAudio && media.has('microphone')) || (wantsVideo && media.has('camera')))
    }
    return callback(false)
  })

  defaultSession.setPermissionCheckHandler((wc, permission) => {
    if (wc !== mainWindow?.webContents) return false
    return permission === 'media' && media.any()
  })

  hardenWebContents()

  mainWindow = createWindow()

  registerIpc({
    store: secureStore,
    asr,
    sign,
    media,
    videos,
    getWindow: () => mainWindow,
    getBlocked: () => blockedRequests
  })

  const removed = secureStore.purgeExpired()
  if (removed > 0) mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.send('retention:purged', removed)
  })
  purgeTimer = setInterval(() => {
    const n = store?.purgeExpired() ?? 0
    if (n > 0) mainWindow?.webContents.send('retention:purged', n)
  }, 60 * 60 * 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (purgeTimer) clearInterval(purgeTimer)
  asr?.stop()
  sign?.stop()
  videos?.closeAll()
})

process.on('uncaughtException', (err) => {
  // Never print transcript content, only the error class.
  console.error('[echoclass] uncaught:', err.name)
})

// The app has no external links except explicit https links opened by the UI.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
})
