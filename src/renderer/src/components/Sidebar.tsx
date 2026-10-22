import { useAppStore } from '@renderer/state/store'
import type { View } from '@shared/types'
import { CaptionsIcon, ClockIcon, HandIcon, LockIcon, ShieldIcon } from './Icons'

const items: Array<{ id: View; label: string; icon: React.JSX.Element; hint: string }> = [
  { id: 'captions', label: 'Live captions', icon: <CaptionsIcon size={19} />, hint: '⌘1' },
  { id: 'sign', label: 'Fingerspelling', icon: <HandIcon size={19} />, hint: '⌘2' },
  { id: 'sessions', label: 'Sessions', icon: <ClockIcon size={19} />, hint: '⌘3' },
  { id: 'privacy', label: 'Privacy center', icon: <ShieldIcon size={19} />, hint: '⌘4' }
]

export function Sidebar(): React.JSX.Element {
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const sessions = useAppStore((s) => s.sessions)
  const privacy = useAppStore((s) => s.privacy)

  return (
    <aside className="sidebar">
      <nav aria-label="Main navigation" className="nav">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${view === item.id ? 'is-active' : ''}`}
            onClick={() => setView(item.id)}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.id === 'sessions' && sessions.length > 0 && <span className="nav-count">{sessions.length}</span>}
            <kbd>{item.hint}</kbd>
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />

      <div className="local-card">
        <div className="local-card-head">
          <LockIcon size={16} />
          <span>Local only</span>
        </div>
        <p>Audio, video and transcripts stay on this laptop. No account, no cloud, no telemetry.</p>
        <div className="local-stats">
          <span>{privacy?.sessionCount ?? 0} session{privacy?.sessionCount === 1 ? '' : 's'}</span>
          <span>{privacy?.blockedRequests ?? 0} blocked</span>
        </div>
      </div>

      <p className="sidebar-foot">EchoClass 0.1 · HACKERWRATH 3.0</p>
    </aside>
  )
}
