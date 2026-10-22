import { useState } from 'react'
import { useAppStore } from '@renderer/state/store'
import { formatDate } from '@renderer/lib/utils'
import { CaptionsIcon, ClockIcon, DownloadIcon, LockIcon, StarIcon, TrashIcon } from './Icons'
import { Modal } from './Modal'

export function SessionsView(): React.JSX.Element {
  const sessions = useAppStore((s) => s.sessions)
  const openSession = useAppStore((s) => s.openSession)
  const exportSession = useAppStore((s) => s.exportSession)
  const removeSession = useAppStore((s) => s.removeSession)
  const seedDemo = useAppStore((s) => s.seedDemo)
  const settings = useAppStore((s) => s.settings)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const target = sessions.find((s) => s.id === pendingDelete)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">On this device only</p>
          <h1>Sessions</h1>
          <p className="page-sub">
            Encrypted transcripts expiring after {settings.retentionDays === 0 ? 'you delete them' : `${settings.retentionDays} days`}.
            Audio and video are never stored.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="button button-ghost" onClick={() => void seedDemo()}>
            <CaptionsIcon size={16} /> Load demo
          </button>
        </div>
      </header>

      {sessions.length === 0 ? (
        <div className="empty-page">
          <div className="empty-icon"><ClockIcon size={28} /></div>
          <h2>No sessions yet</h2>
          <p>Start captions in a lecture, or load the demo to see how a saved session looks.</p>
          <button type="button" className="button button-primary" onClick={() => void seedDemo()}>
            Try the demo lecture
          </button>
        </div>
      ) : (
        <div className="session-grid">
          {sessions.map((session) => (
            <article key={session.id} className="session-card">
              <header>
                <span className="session-card-icon"><CaptionsIcon size={18} /></span>
                <div className="session-card-title">
                  <h2>{session.title}</h2>
                  <p>{formatDate(session.startedAt)}</p>
                </div>
                <span className={`retention-tag ${session.endedAt ? '' : 'is-live'}`}>
                  {session.endedAt ? `${session.retentionDays || '∞'}d` : 'Open'}
                </span>
              </header>
              <p className="session-preview">{session.preview || 'No captions captured yet.'}</p>
              <div className="session-stats">
                <span><CaptionsIcon size={14} /> {session.segmentCount} segments</span>
                <span><StarIcon size={14} /> {session.bookmarkCount}</span>
                <span><LockIcon size={14} /> Encrypted</span>
              </div>
              <footer>
                <button type="button" className="button button-small" onClick={() => void openSession(session.id)}>
                  Open
                </button>
                <button type="button" className="icon-button" onClick={() => void exportSession(session.id)} aria-label="Export session">
                  <DownloadIcon size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button icon-danger"
                  onClick={() => setPendingDelete(session.id)}
                  aria-label="Delete session"
                >
                  <TrashIcon size={16} />
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}

      {target && (
        <Modal
          title="Delete this session?"
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button type="button" className="button button-ghost" onClick={() => setPendingDelete(null)}>
                Keep it
              </button>
              <button
                type="button"
                className="button button-danger"
                onClick={() => {
                  void removeSession(target.id)
                  setPendingDelete(null)
                }}
              >
                Delete permanently
              </button>
            </>
          }
        >
          <p><strong>{target.title}</strong></p>
          <p className="muted">
            {target.segmentCount} segments and {target.bookmarkCount} bookmarks will be removed from the encrypted store.
            Exported files outside the app are not affected.
          </p>
        </Modal>
      )}
    </div>
  )
}
