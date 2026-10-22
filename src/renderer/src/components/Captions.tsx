import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@renderer/state/store'
import { formatMs, speak } from '@renderer/lib/utils'
import {
  CaptionsIcon,
  DownloadIcon,
  LockIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  ShieldIcon,
  SparkIcon,
  StarIcon,
  TrashIcon,
  UsersIcon,
  WaveIcon
} from './Icons'
import { Modal } from './Modal'

export function Welcome(): React.JSX.Element {
  const createSession = useAppStore((s) => s.createSession)
  const seedDemo = useAppStore((s) => s.seedDemo)
  const startLiveDemo = useAppStore((s) => s.startLiveDemo)
  const privacy = useAppStore((s) => s.privacy)
  const [busy, setBusy] = useState(false)

  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      await createSession()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <span className="welcome-badge">
          <SparkIcon size={14} /> Built for the front row, not the back
        </span>
        <h1>
          Follow every word.
          <br />
          <span className="gradient-text">Leave no trace.</span>
        </h1>
        <p className="welcome-lead">
          Live, on-device captions for deaf and hard-of-hearing students. Speaker labels, camera fingerspelling, a
          course glossary, and a study transcript — with no cloud, no account, and no recording.
        </p>

        <div className="welcome-actions">
          <button type="button" className="button button-primary button-lg" onClick={start} disabled={busy}>
            <MicIcon size={18} /> {busy ? 'Starting…' : 'Start live captions'}
          </button>
          <button type="button" className="button button-ghost button-lg" onClick={() => void seedDemo()}>
            <CaptionsIcon size={18} /> Try the demo lecture
          </button>
          <button type="button" className="button button-ghost button-lg" onClick={() => void startLiveDemo()}>
            <PlayIcon size={17} /> Play it live
          </button>
        </div>

        <div className="welcome-features">
          <div className="feature">
            <span className="feature-icon"><WaveIcon size={18} /></span>
            <h3>1.5s caption latency</h3>
            <p>Whisper runs locally on this laptop. No audio ever leaves it.</p>
          </div>
          <div className="feature">
            <span className="feature-icon"><UsersIcon size={18} /></span>
            <h3>Know who is speaking</h3>
            <p>Teacher and student turns are labelled, not merged into a wall of text.</p>
          </div>
          <div className="feature">
            <span className="feature-icon"><LockIcon size={18} /></span>
            <h3>Encrypted by default</h3>
            <p>Transcripts expire in 7 days and delete in two clicks. Zero network requests.</p>
          </div>
        </div>

        <div className="welcome-status">
          <span className={privacy?.modelPresent ? 'dot dot-good' : 'dot dot-warn'} />
          {privacy?.modelPresent ? 'On-device Whisper ready' : 'Whisper model not installed — demo mode available'}
          <span className="welcome-status-sep" />
          <ShieldIcon size={14} /> {privacy?.encryption === 'keychain' ? 'Keychain encryption' : 'Local key file'}
        </div>
      </div>
    </div>
  )
}

export function CaptionStage(): React.JSX.Element {
  const active = useAppStore((s) => s.active)
  const segments = useAppStore((s) => s.segments)
  const interim = useAppStore((s) => s.interim)
  const listening = useAppStore((s) => s.listening)
  const paused = useAppStore((s) => s.paused)
  const latency = useAppStore((s) => s.latencyMs)
  const engineError = useAppStore((s) => s.engineError)
  const announcement = useAppStore((s) => s.announcement)
  const showSpeakerLabels = useAppStore((s) => s.settings.showSpeakerLabels)
  const toggleBookmark = useAppStore((s) => s.toggleBookmark)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const setEngineError = useAppStore((s) => s.setEngineError)
  const clearAnnouncement = useAppStore((s) => s.clearAnnouncement)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    if (!stick.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [segments.length, interim])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90
  }

  if (!active) return <Welcome />

  return (
    <section className="stage" aria-label="Live captions">
      <div className="stage-head">
        <div>
          <p className="eyebrow">Live transcript</p>
          <h1 className="stage-title">{active.title}</h1>
        </div>
        <div className="stage-meta">
          {listening && !paused ? (
            <span className="live-badge"><span className="live-dot" /> LIVE</span>
          ) : paused ? (
            <span className="quiet-badge">Paused</span>
          ) : (
            <span className="quiet-badge">Session open</span>
          )}
          {latency !== null && <span className="metric-badge">~{(latency / 1000).toFixed(1)}s</span>}
          <span className="metric-badge muted">{segments.length} segments</span>
        </div>
      </div>

      {engineError && (
        <div className="inline-alert" role="alert">
          <div>
            <strong>Caption engine needs attention</strong>
            <p>{engineError}</p>
          </div>
          <div className="inline-alert-actions">
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                setEngineError(null)
                void patchSettings({ engine: 'demo' })
              }}
            >
              Use demo mode
            </button>
            <button type="button" className="button button-small button-ghost" onClick={() => setEngineError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {announcement && (
        <div className="announcement" role="status">
          <span>{announcement}</span>
          <button type="button" className="announcement-close" onClick={clearAnnouncement} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}

      <div className="stage-body" ref={scrollRef} onScroll={onScroll}>
        <div role="log" aria-live="polite" aria-label="Caption transcript" className="segments">
          {segments.map((segment) => (
            <article key={segment.id} className={`segment ${segment.isBookmark ? 'is-bookmarked' : ''}`}>
              <div className="segment-rail">
                <span className={`speaker-dot speaker-${segment.speaker.toLowerCase()}`} />
                <span className="segment-time">{formatMs(segment.startMs)}</span>
              </div>
              <div className="segment-content">
                {showSpeakerLabels && (
                  <span className={`speaker-label speaker-${segment.speaker.toLowerCase()}`}>{segment.speaker}</span>
                )}
                <p>{segment.text}</p>
              </div>
              <button
                type="button"
                className="bookmark-button"
                onClick={() => void toggleBookmark(segment.id)}
                aria-label={segment.isBookmark ? 'Remove bookmark' : 'Bookmark this moment'}
                aria-pressed={segment.isBookmark}
              >
                <StarIcon size={17} filled={segment.isBookmark} />
              </button>
            </article>
          ))}

          {interim && (
            <div className="segment segment-interim" aria-live="polite">
              <div className="segment-rail">
                <span className="speaker-dot speaker-teacher" />
                <span className="segment-time">now</span>
              </div>
              <div className="segment-content">
                {showSpeakerLabels && <span className="speaker-label speaker-teacher">Teacher</span>}
                <p>
                  {interim}
                  <span className="caret" />
                </p>
              </div>
            </div>
          )}
        </div>

        {listening && segments.length === 0 && !interim && (
          <div className="listening-state">
            <div className="listening-orb">
              <MicIcon size={30} />
              <span className="pulse-ring" />
            </div>
            <h2>Listening for the lecture…</h2>
            <p>Speak normally. Captions appear here within a couple of seconds.</p>
          </div>
        )}
      </div>
    </section>
  )
}

export function ControlBar(): React.JSX.Element {
  const active = useAppStore((s) => s.active)
  const listening = useAppStore((s) => s.listening)
  const paused = useAppStore((s) => s.paused)
  const level = useAppStore((s) => s.level)
  const settings = useAppStore((s) => s.settings)
  const segments = useAppStore((s) => s.segments)
  const speaker = useAppStore((s) => s.speaker)
  const setSpeaker = useAppStore((s) => s.setSpeaker)
  const shield = useAppStore((s) => s.shield)
  const setListening = useAppStore((s) => s.setListening)
  const setPaused = useAppStore((s) => s.setPaused)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const setShield = useAppStore((s) => s.setShield)
  const toggleBookmark = useAppStore((s) => s.toggleBookmark)
  const createSession = useAppStore((s) => s.createSession)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const endSession = useAppStore((s) => s.endSession)

  if (!active) return <></>

  const sizes: Array<typeof settings.fontSize> = ['sm', 'md', 'lg', 'xl']
  const cycleSize = (): void => {
    const idx = sizes.indexOf(settings.fontSize)
    void patchSettings({ fontSize: sizes[(idx + 1) % sizes.length] })
  }

  const micAction = (): void => {
    if (!listening) setListening(true)
    else setPaused(!paused)
  }

  const last = segments[segments.length - 1]

  return (
    <>
      <div className="control-bar" role="toolbar" aria-label="Caption controls">
        <div className="control-group">
          <button
            type="button"
            className={`mic-button ${listening && !paused ? 'is-on' : ''} ${paused ? 'is-paused' : ''}`}
            onClick={micAction}
            aria-label={!listening ? 'Start captions' : paused ? 'Resume captions' : 'Pause captions'}
          >
            {listening && !paused ? <PauseIcon size={22} /> : <MicIcon size={22} />}
            <span className="mic-bars" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  style={{
                    transform: `scaleY(${listening && !paused ? 0.25 + level * (1 - Math.abs(i - 2) * 0.18) : 0.15})`
                  }}
                />
              ))}
            </span>
          </button>
          <div className="control-labels">
            <span className="control-primary-label">
              {!listening ? 'Start captions' : paused ? 'Paused' : 'Captions live'}
            </span>
            <span className="control-secondary-label">
              {settings.engine === 'whisper' ? 'On-device Whisper' : settings.engine === 'demo' ? 'Demo stream' : 'Browser speech'}
            </span>
          </div>
        </div>

        <div className="control-group control-center">
          <button
            type="button"
            className="control-button"
            onClick={() => last && void toggleBookmark(last.id)}
            disabled={!last}
            title="Bookmark last segment (⌘⇧B)"
          >
            <StarIcon size={18} filled={Boolean(last?.isBookmark)} />
            <span>Bookmark</span>
          </button>

          <div className="speaker-switch" role="group" aria-label="Who is speaking">
            {(['Teacher', 'Student'] as const).map((sp) => (
              <button
                key={sp}
                type="button"
                className={speaker === sp ? 'is-active' : ''}
                onClick={() => {
                  setSpeaker(sp)
                  void patchSettings({ showSpeakerLabels: true })
                }}
                aria-pressed={speaker === sp}
              >
                {sp}
              </button>
            ))}
          </div>

          <button type="button" className="control-button" onClick={cycleSize} title="Cycle caption size">
            <span className="aa">Aa</span>
            <span>{settings.fontSize.toUpperCase()}</span>
          </button>

          <button
            type="button"
            className={`control-button ${shield ? 'is-active' : ''}`}
            onClick={() => setShield(!shield)}
            title="Privacy shield (⌘⇧S)"
          >
            <ShieldIcon size={18} />
            <span>Shield</span>
          </button>
        </div>

        <div className="control-group control-right">
          <button
            type="button"
            className="button button-small button-ghost"
            onClick={() => void createSession()}
            title="Start a new session"
          >
            New session
          </button>
          <button type="button" className="button button-small button-danger-ghost" onClick={() => setConfirmEnd(true)}>
            End
          </button>
        </div>
      </div>

      {confirmEnd && (
        <Modal
          title="End this session?"
          onClose={() => setConfirmEnd(false)}
          footer={
            <>
              <button type="button" className="button button-ghost" onClick={() => setConfirmEnd(false)}>
                Keep captioning
              </button>
              <button
                type="button"
                className="button button-danger"
                onClick={() => {
                  setConfirmEnd(false)
                  void endSession()
                }}
              >
                End and save
              </button>
            </>
          }
        >
          <p>The transcript stays encrypted on this device and expires after {settings.retentionDays || '—'} days.</p>
          <p className="muted">Audio and video were never recorded, so there is nothing else to delete.</p>
        </Modal>
      )}
    </>
  )
}

export function BookmarkList(): React.JSX.Element {
  const segments = useAppStore((s) => s.segments)
  const toggleBookmark = useAppStore((s) => s.toggleBookmark)
  const marks = segments.filter((s) => s.isBookmark)
  if (marks.length === 0) {
    return (
      <div className="empty-small">
        <StarIcon size={20} />
        <p>Star a caption to keep it for revision.</p>
      </div>
    )
  }
  return (
    <div className="bookmark-list">
      {marks.map((m) => (
        <div key={m.id} className="bookmark-item">
          <div className="bookmark-top">
            <span className={`speaker-label speaker-${m.speaker.toLowerCase()}`}>{m.speaker}</span>
            <span className="segment-time">{formatMs(m.startMs)}</span>
            <button
              type="button"
              className="bookmark-button is-on"
              onClick={() => void toggleBookmark(m.id)}
              aria-label="Remove bookmark"
            >
              <TrashIcon size={14} />
            </button>
          </div>
          <p>{m.text}</p>
          <button type="button" className="link-button" onClick={() => speak(m.text)}>
            Speak this line
          </button>
        </div>
      ))}
    </div>
  )
}

export function QuickResponses(): React.JSX.Element {
  const announce = useAppStore((s) => s.announce)
  const responses = ['I have a question', 'Please slow down', 'Can you repeat that?', 'Yes', 'No', 'Thank you']
  return (
    <div className="quick-grid">
      {responses.map((r) => (
        <button
          key={r}
          type="button"
          className="quick-button"
          onClick={() => {
            announce(r)
            speak(r)
          }}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

export function ExportButton({ sessionId }: { sessionId: string }): React.JSX.Element {
  const exportSession = useAppStore((s) => s.exportSession)
  return (
    <button type="button" className="button button-small" onClick={() => void exportSession(sessionId)}>
      <DownloadIcon size={16} /> Export
    </button>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div className="empty-small">
      <WaveIcon size={22} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}
