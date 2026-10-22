import type { Session } from 'electron'
import { app, shell } from 'electron'

/**
 * Blocks every outbound HTTP(S)/WS request from the renderer except loopback.
 * The app needs no network to caption, so anything else is a bug or an attack.
 */
export function installNetworkGuard(session: Session, isDev: boolean, onBlocked: (count: number) => void): void {
  let blocked = 0
  session.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    // The renderer never needs HTTP, not even loopback: ASR goes through IPC.
    // Development additionally needs the Vite server and its HMR socket.
    const viteDev = isDev && /^(https?|ws):\/\/(localhost|127\.0\.0\.1):5173(\/|$)/.test(url)
    const allowed =
      url.startsWith('file:') ||
      url.startsWith('devtools:') ||
      url.startsWith('blob:') ||
      url.startsWith('data:') ||
      url.startsWith('echoclass-media:') ||
      viteDev
    if (allowed) {
      callback({})
      return
    }
    blocked += 1
    onBlocked(blocked)
    callback({ cancel: true })
  })
}

/** Strict CSP. Development adds only the Vite dev server origins. */
export function installCsp(session: Session, isDev: boolean): void {
  const dev = "http://localhost:5173 ws://localhost:5173"
  const policy = [
    "default-src 'self'",
    isDev ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${dev}` : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: echoclass-media:",
    "font-src 'self' data:",
    isDev ? `connect-src 'self' ${dev}` : "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'"
  ].join('; ')

  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer']
      }
    })
  })
}

/** Denies navigation, popups, webviews and untrusted external opens. */
export function hardenWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (url !== contents.getURL()) event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      // Only a deliberate https link from our own UI may leave the app.
      if (url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}
