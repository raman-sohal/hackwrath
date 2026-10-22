import { useEffect, useState } from 'react'
import { useAppStore } from '@renderer/state/store'
import { formatMs } from '@renderer/lib/utils'
import { CameraIcon, EyeIcon, EyeOffIcon, LockIcon, MicIcon, ShieldIcon, WaveIcon, WifiOffIcon } from './Icons'

export function TopBar(): React.JSX.Element {
  const active = useAppStore((s) => s.active)
  const listening = useAppStore((s) => s.listening)
  const paused = useAppStore((s) => s.paused)
  const privacy = useAppStore((s) => s.privacy)
  const shield = useAppStore((s) => s.shield)
  const setShield = useAppStore((s) => s.setShield)
  const cameraActive = useAppStore((s) => s.cameraActive)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) return
    const tick = (): void => setElapsed(Date.now() - active.startedAt)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [active])

  const micOn = Boolean(active) && listening && !paused

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">
          <span className="brand-mark">
            <WaveIcon size={20} />
          </span>
          <span className="brand-name">EchoClass</span>
        </div>
        <span className="topbar-divider" />
        <div className="session-heading">
          <span className="session-title">{active ? active.title : 'No active session'}</span>
          {active && <span className="session-timer">{formatMs(elapsed)}</span>}
        </div>
      </div>

      <div className="topbar-right">
        <span className={`status-pill ${micOn ? 'is-live' : ''}`} title="Microphone state">
          <MicIcon size={14} />
          {micOn ? 'Mic on' : 'Mic off'}
        </span>
        {cameraActive && (
          <span className="status-pill is-live" title="Camera is processing frames on this device">
            <CameraIcon size={14} />
            Camera on
          </span>
        )}
        <span className="status-pill" title="All processing happens on this device">
          <ShieldIcon size={14} />
          On-device
        </span>
        <span className="status-pill" title="Outbound HTTP requests blocked this session">
          <WifiOffIcon size={14} />
          {privacy?.blockedRequests ? `${privacy.blockedRequests} blocked` : '0 requests'}
        </span>
        <span className={`status-pill ${privacy?.encryption === 'keychain' ? 'is-good' : 'is-warn'}`} title="Transcript storage">
          <LockIcon size={14} />
          {privacy?.encryption === 'keychain' ? 'Encrypted' : privacy?.encryption === 'file-permissions' ? 'Key file' : 'No key'}
        </span>
        <button
          type="button"
          className={`icon-button ${shield ? 'is-active' : ''}`}
          onClick={() => setShield(!shield)}
          aria-label={shield ? 'Disable privacy shield' : 'Enable privacy shield'}
          title="Privacy shield (⌘⇧S)"
        >
          {shield ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
        </button>
      </div>
    </header>
  )
}
