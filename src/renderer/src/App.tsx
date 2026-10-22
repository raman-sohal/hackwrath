import { useEffect } from 'react'
import { useAppStore } from '@renderer/state/store'
import { useCaptionEngine } from '@renderer/hooks/useCaptionEngine'
import { ConsentDialog } from '@renderer/components/ConsentDialog'
import { TopBar } from '@renderer/components/TopBar'
import { Sidebar } from '@renderer/components/Sidebar'
import { CaptionStage, ControlBar } from '@renderer/components/Captions'
import { SignView } from '@renderer/components/SignView'
import { ToolsPanel } from '@renderer/components/ToolsPanel'
import { SessionsView } from '@renderer/components/SessionsView'
import { PrivacyCenter } from '@renderer/components/PrivacyCenter'
import { Toast } from '@renderer/components/Toast'
import { EyeOffIcon, WaveIcon } from '@renderer/components/Icons'

export default function App(): React.JSX.Element {
  const booted = useAppStore((s) => s.booted)
  const consent = useAppStore((s) => s.consent)
  const view = useAppStore((s) => s.view)
  const settings = useAppStore((s) => s.settings)
  const shield = useAppStore((s) => s.shield)

  useEffect(() => {
    void useAppStore.getState().init()
    const offBlocked = window.api.events.onBlocked((n) => useAppStore.getState().setBlocked(n))
    const offPurged = window.api.events.onPurged((n) =>
      useAppStore.getState().showToast(`${n} expired session${n === 1 ? '' : 's'} purged automatically.`, 'ok')
    )
    return () => {
      offBlocked()
      offPurged()
    }
  }, [])

  useCaptionEngine()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey
      const store = useAppStore.getState()
      if (event.key === 'Escape' && store.shield) {
        store.setShield(false)
        return
      }
      if (!meta) return
      if (event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        store.setListening(!store.listening)
      } else if (event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        const last = store.segments[store.segments.length - 1]
        if (last) void store.toggleBookmark(last.id)
      } else if (event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        store.setShield(!store.shield)
      } else if (event.key === '1') {
        event.preventDefault()
        store.setView('captions')
      } else if (event.key === '2') {
        event.preventDefault()
        store.setView('sign')
      } else if (event.key === '3') {
        event.preventDefault()
        store.setView('sessions')
      } else if (event.key === '4') {
        event.preventDefault()
        store.setView('privacy')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!booted) {
    return (
      <div className="splash">
        <span className="brand-mark brand-mark-xl">
          <WaveIcon size={30} />
        </span>
        <h1>EchoClass</h1>
        <p>Opening your local workspace…</p>
      </div>
    )
  }

  if (!consent) return <ConsentDialog />

  return (
    <div
      className="app"
      data-theme={settings.theme}
      data-size={settings.fontSize}
      data-motion={settings.reduceMotion ? 'reduced' : 'full'}
    >
      <TopBar />
      <div className={`shell ${view === 'captions' ? '' : 'shell-no-tools'}`}>
        <Sidebar />
        <main className="main">
          {view === 'captions' && (
            <div className="caption-view">
              <CaptionStage />
              <ControlBar />
            </div>
          )}
          {view === 'sign' && <SignView />}
          {view === 'sessions' && <SessionsView />}
          {view === 'privacy' && <PrivacyCenter />}
        </main>
        {view === 'captions' && <ToolsPanel />}
      </div>

      {shield && (
        <button
          type="button"
          className="shield-overlay"
          onClick={() => useAppStore.getState().setShield(false)}
          aria-label="Privacy shield active. Click to reveal captions."
        >
          <span className="shield-icon">
            <EyeOffIcon size={34} />
          </span>
          <strong>Privacy shield on</strong>
          <span>The transcript is hidden. Press Esc or click to reveal.</span>
        </button>
      )}

      <Toast />
    </div>
  )
}
