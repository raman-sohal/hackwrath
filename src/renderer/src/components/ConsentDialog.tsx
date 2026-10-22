import { useState } from 'react'
import { useAppStore } from '@renderer/state/store'
import { CameraIcon, CheckIcon, LockIcon, MicIcon, ShieldIcon, WaveIcon } from './Icons'

export function ConsentDialog(): React.JSX.Element {
  const acceptConsent = useAppStore((s) => s.acceptConsent)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const [mic, setMic] = useState(true)
  const [camera, setCamera] = useState(false)
  const [storage, setStorage] = useState(true)
  const [busy, setBusy] = useState(false)

  const accept = async (): Promise<void> => {
    if (!storage || busy) return
    setBusy(true)
    try {
      await acceptConsent({ microphone: mic, camera, storage })
      if (!mic) await patchSettings({ engine: 'demo' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="consent-screen">
      <div className="consent-card" role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <div className="consent-brand">
          <span className="brand-mark brand-mark-lg">
            <WaveIcon size={26} />
          </span>
          <div>
            <p className="eyebrow">Welcome to EchoClass</p>
            <h1 id="consent-title">Your classroom, captioned. Your data, yours.</h1>
          </div>
        </div>

        <p className="consent-lead">
          EchoClass turns lecture speech into live captions on this laptop. Before you start, here is exactly what
          happens to your data.
        </p>

        <div className="consent-facts">
          <div className="fact">
            <ShieldIcon size={18} />
            <div>
              <strong>Everything runs on this device</strong>
              <p>No account, no cloud, no telemetry. Outbound requests are blocked and counted.</p>
            </div>
          </div>
          <div className="fact">
            <LockIcon size={18} />
            <div>
              <strong>Audio and video are never recorded</strong>
              <p>Only text is saved, encrypted, and deleted after seven days by default.</p>
            </div>
          </div>
        </div>

        <div className="consent-options">
          <label className="consent-option">
            <span className="consent-option-icon"><MicIcon size={18} /></span>
            <span className="consent-option-text">
              <strong>Microphone</strong>
              <small>Required for live captions. Audio is processed in memory and discarded.</small>
            </span>
            <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
            <span className="switch" aria-hidden="true" />
          </label>

          <label className="consent-option">
            <span className="consent-option-icon"><CameraIcon size={18} /></span>
            <span className="consent-option-text">
              <strong>Camera <em>optional</em></strong>
              <small>Only for ASL fingerspelling. Off by default. 224×224 frames are classified locally and discarded.</small>
            </span>
            <input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} />
            <span className="switch" aria-hidden="true" />
          </label>

          <label className="consent-option">
            <span className="consent-option-icon"><LockIcon size={18} /></span>
            <span className="consent-option-text">
              <strong>Encrypted local storage <em>required</em></strong>
              <small>Transcripts are encrypted with a key held by your operating system.</small>
            </span>
            <input type="checkbox" checked={storage} onChange={(e) => setStorage(e.target.checked)} />
            <span className="switch" aria-hidden="true" />
          </label>
        </div>

        <div className="consent-note">
          <CheckIcon size={16} />
          <span>
            You can pause captions, export or delete everything at any time from the Privacy Center. If you turn the
            microphone off, the demo lecture still works.
          </span>
        </div>

        <div className="consent-actions">
          <p>By continuing you agree to this local processing. Consent version 1.0.</p>
          <button type="button" className="button button-primary button-lg" onClick={accept} disabled={!storage || busy}>
            {busy ? 'Starting…' : 'Start with these choices'}
          </button>
        </div>
      </div>
    </div>
  )
}
