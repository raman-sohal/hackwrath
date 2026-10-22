import { useState } from 'react'
import { useAppStore } from '@renderer/state/store'
import { speak } from '@renderer/lib/utils'
import type { EngineId } from '@shared/types'
import {
  CaptionsIcon,
  DownloadIcon,
  LockIcon,
  SendIcon,
  SparkIcon,
  StarIcon,
  TrashIcon,
  WaveIcon
} from './Icons'
import { BookmarkList, QuickResponses } from './Captions'

export function ToolsPanel(): React.JSX.Element {
  const [tab, setTab] = useState<'tools' | 'notes'>('tools')
  const settings = useAppStore((s) => s.settings)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const privacy = useAppStore((s) => s.privacy)
  const active = useAppStore((s) => s.active)
  const segments = useAppStore((s) => s.segments)
  const endSession = useAppStore((s) => s.endSession)
  const exportSession = useAppStore((s) => s.exportSession)
  const addGlossary = async (term: string): Promise<void> => {
    const clean = term.trim()
    if (!clean) return
    await patchSettings({ glossary: [...settings.glossary, clean].slice(0, 50) })
  }
  const removeGlossary = async (term: string): Promise<void> => {
    await patchSettings({ glossary: settings.glossary.filter((t) => t !== term) })
  }

  return (
    <aside className="tools" aria-label="Classroom tools">
      <div className="tabs" role="tablist" aria-label="Tools">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tools'}
          className={tab === 'tools' ? 'is-active' : ''}
          onClick={() => setTab('tools')}
        >
          Classroom
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'notes'}
          className={tab === 'notes' ? 'is-active' : ''}
          onClick={() => setTab('notes')}
        >
          Notes {segments.filter((s) => s.isBookmark).length > 0 && <em>{segments.filter((s) => s.isBookmark).length}</em>}
        </button>
      </div>

      {tab === 'tools' ? (
        <div className="tools-scroll">
          <section className="panel">
            <header className="panel-head">
              <SparkIcon size={16} />
              <h2>Caption engine</h2>
            </header>
            <select
              className="select"
              value={settings.engine}
              onChange={(e) => void patchSettings({ engine: e.target.value as EngineId })}
              aria-label="Caption engine"
            >
              <option value="whisper">On-device Whisper</option>
              <option value="demo">Demo lecture (no mic)</option>
              <option value="webspeech">Browser speech (cloud)</option>
            </select>
            <p className="panel-note">
              {settings.engine === 'whisper' &&
                (privacy?.modelPresent
                  ? privacy.asrReady
                    ? 'Local model loaded. Audio never leaves this laptop.'
                    : 'Local model ready. It starts on the first caption.'
                  : 'Model not installed. Run npm run fetch-model, or switch to demo.')}
              {settings.engine === 'demo' && 'Plays a scripted lecture. Useful when the mic or model is unavailable.'}
              {settings.engine === 'webspeech' &&
                'Uses Chromium speech recognition, which may send audio to a vendor. Off by default; use only with consent.'}
            </p>
          </section>

          <section className="panel">
            <header className="panel-head">
              <CaptionsIcon size={16} />
              <h2>Quick responses</h2>
            </header>
            <p className="panel-note">Speaks the phrase aloud and shows it on the classroom display.</p>
            <QuickResponses />
          </section>

          <section className="panel">
            <header className="panel-head">
              <SendIcon size={16} />
              <h2>Type to speak</h2>
            </header>
            <ComposeSpeak />
          </section>

          <section className="panel">
            <header className="panel-head">
              <WaveIcon size={16} />
              <h2>Course glossary</h2>
            </header>
            <p className="panel-note">Names and jargon the captions should spell correctly.</p>
            <div className="chips">
              {settings.glossary.map((term) => (
                <span key={term} className="chip">
                  {term}
                  <button type="button" onClick={() => void removeGlossary(term)} aria-label={`Remove ${term}`}>
                    ×
                  </button>
                </span>
              ))}
              {settings.glossary.length === 0 && <span className="muted">No terms yet.</span>}
            </div>
            <GlossaryInput onAdd={addGlossary} />
          </section>
        </div>
      ) : (
        <div className="tools-scroll">
          <section className="panel">
            <header className="panel-head">
              <StarIcon size={16} />
              <h2>Bookmarked moments</h2>
            </header>
            <BookmarkList />
          </section>

          <section className="panel">
            <header className="panel-head">
              <LockIcon size={16} />
              <h2>This session</h2>
            </header>
            {active ? (
              <>
                <dl className="meta-list">
                  <div><dt>Segments</dt><dd>{segments.length}</dd></div>
                  <div><dt>Bookmarks</dt><dd>{segments.filter((s) => s.isBookmark).length}</dd></div>
                  <div><dt>Stored</dt><dd>Encrypted, {settings.retentionDays || '∞'} days</dd></div>
                </dl>
                <div className="panel-actions">
                  <button type="button" className="button button-small" onClick={() => void exportSession(active.id)}>
                    <DownloadIcon size={15} /> Export .md
                  </button>
                  <button type="button" className="button button-small button-ghost" onClick={() => void endSession()}>
                    End session
                  </button>
                </div>
              </>
            ) : (
              <p className="panel-note">Start a session to capture notes.</p>
            )}
          </section>

          <section className="panel panel-quiet">
            <header className="panel-head">
              <TrashIcon size={16} />
              <h2>Nothing hidden</h2>
            </header>
            <p className="panel-note">
              Audio and video are never written to disk. Only the text above is stored, encrypted, and deleted on the
              schedule you choose.
            </p>
          </section>
        </div>
      )}
    </aside>
  )
}

function GlossaryInput({ onAdd }: { onAdd: (term: string) => Promise<void> }): React.JSX.Element {
  const [value, setValue] = useState('')
  return (
    <form
      className="inline-form"
      onSubmit={(e) => {
        e.preventDefault()
        void onAdd(value).then(() => setValue(''))
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add a term…"
        maxLength={40}
        aria-label="New glossary term"
      />
      <button type="submit" className="button button-small" disabled={!value.trim()}>
        Add
      </button>
    </form>
  )
}

function ComposeSpeak(): React.JSX.Element {
  const [text, setText] = useState('')
  const announce = useAppStore((s) => s.announce)
  const send = (): void => {
    const clean = text.trim()
    if (!clean) return
    announce(clean)
    speak(clean)
    setText('')
  }
  return (
    <form
      className="compose"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a question for the class…"
        rows={3}
        maxLength={280}
        aria-label="Message to speak aloud"
      />
      <div className="compose-foot">
        <span className="muted">{text.length}/280 · speaks aloud</span>
        <button type="submit" className="button button-small button-primary" disabled={!text.trim()}>
          <SendIcon size={15} /> Speak
        </button>
      </div>
    </form>
  )
}
