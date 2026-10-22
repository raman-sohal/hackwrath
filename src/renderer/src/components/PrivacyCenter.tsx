import { useState } from 'react'
import { useAppStore } from '@renderer/state/store'
import { RETENTION_OPTIONS } from '@shared/types'
import { formatBytes, formatDate } from '@renderer/lib/utils'
import {
  CheckIcon,
  DownloadIcon,
  EyeOffIcon,
  FolderIcon,
  HandIcon,
  LockIcon,
  ShieldIcon,
  TrashIcon,
  WaveIcon,
  WifiOffIcon
} from './Icons'
import { Modal } from './Modal'

export function PrivacyCenter(): React.JSX.Element {
  const privacy = useAppStore((s) => s.privacy)
  const settings = useAppStore((s) => s.settings)
  const consent = useAppStore((s) => s.consent)
  const patchSettings = useAppStore((s) => s.patchSettings)
  const enableCamera = useAppStore((s) => s.enableCamera)
  const disableCamera = useAppStore((s) => s.disableCamera)
  const exportAll = useAppStore((s) => s.exportAll)
  const removeAll = useAppStore((s) => s.removeAll)
  const shield = useAppStore((s) => s.shield)
  const setShield = useAppStore((s) => s.setShield)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const encryptionLabel =
    privacy?.encryption === 'keychain'
      ? 'OS keychain'
      : privacy?.encryption === 'file-permissions'
        ? 'Local key file'
        : 'Unavailable'

  return (
    <div className="page privacy-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Privacy & data security</p>
          <h1>Nothing leaves this laptop.</h1>
          <p className="page-sub">
            EchoClass has no account, no cloud and no telemetry. This page shows exactly what is stored and lets you
            delete it.
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className={`button button-ghost ${shield ? 'is-active' : ''}`}
            onClick={() => setShield(!shield)}
          >
            <EyeOffIcon size={16} /> Privacy shield
          </button>
        </div>
      </header>

      <section className="privacy-grid">
        <StatusCard
          icon={<WifiOffIcon size={18} />}
          label="Network"
          value={privacy?.blockedRequests ? `${privacy.blockedRequests} blocked` : '0 requests'}
          tone="good"
          detail="All outbound HTTP(S) from the interface is blocked and counted."
        />
        <StatusCard
          icon={<LockIcon size={18} />}
          label="Encryption"
          value={encryptionLabel}
          tone={privacy?.encryption === 'keychain' ? 'good' : 'warn'}
          detail="AES-256-GCM per record. The data key is wrapped by the operating system."
        />
        <StatusCard
          icon={<WaveIcon size={18} />}
          label="Speech engine"
          value={privacy?.asrReady ? 'Whisper loaded' : privacy?.modelPresent ? 'Whisper ready' : 'Not installed'}
          tone={privacy?.modelPresent ? 'good' : 'warn'}
          detail="whisper.cpp listens only on 127.0.0.1 and is terminated on quit."
        />
        <StatusCard
          icon={<HandIcon size={18} />}
          label="Fingerspelling"
          value={privacy?.signModelPresent ? 'Int8 ONNX ready' : 'Not installed'}
          tone={privacy?.signModelPresent ? 'good' : 'warn'}
          detail="ASL A–Z frames are classified locally at 224×224. Frames are discarded after inference."
        />
        <StatusCard
          icon={<ShieldIcon size={18} />}
          label="Capture"
          value={consent?.camera ? 'Audio + camera' : 'Audio only'}
          tone="good"
          detail="Raw audio is discarded after transcription. Camera frames are classified in memory at 224×224 and discarded. Nothing is recorded."
        />
      </section>

      <section className="privacy-block">
        <header>
          <h2>Retention</h2>
          <p>How long finished sessions stay encrypted on disk.</p>
        </header>
        <div className="retention-row">
          <select
            className="select"
            value={settings.retentionDays}
            onChange={(e) => void patchSettings({ retentionDays: Number(e.target.value) })}
            aria-label="Retention period"
          >
            {RETENTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="retention-hint">
            {settings.retentionDays === 0
              ? 'Sessions are kept until you delete them.'
              : `Finished sessions are purged automatically after ${settings.retentionDays} day${settings.retentionDays === 1 ? '' : 's'}.`}
          </span>
        </div>
      </section>

      <section className="privacy-block">
        <header>
          <h2>Data inventory</h2>
          <p>Every field EchoClass can store. There is no hidden analytics schema.</p>
        </header>
        <table className="data-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Purpose</th>
              <th>Retention</th>
              <th>Leaves device</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Transcript text</td>
              <td>Captions, study notes</td>
              <td>{settings.retentionDays || '∞'} days</td>
              <td>Only when you export</td>
            </tr>
            <tr>
              <td>Speaker labels</td>
              <td>Who said what</td>
              <td>{settings.retentionDays || '∞'} days</td>
              <td>No (excluded from export by default)</td>
            </tr>
            <tr>
              <td>Session metadata</td>
              <td>Session list, retention</td>
              <td>{settings.retentionDays || '∞'} days</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Consent record</td>
              <td>Proof of your choices</td>
              <td>Until withdrawn</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Audio / video</td>
              <td>Captioning / fingerspelling only</td>
              <td className="good-cell">Never stored</td>
              <td className="good-cell">Never</td>
            </tr>
            <tr>
              <td>Camera frames</td>
              <td>Classified in memory at 224×224</td>
              <td className="good-cell">Discarded per frame</td>
              <td className="good-cell">Never</td>
            </tr>
            <tr>
              <td>Analytics / telemetry</td>
              <td className="muted">Not collected</td>
              <td>—</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="privacy-block">
        <header>
          <h2>Your data, your controls</h2>
          <p>
            {privacy
              ? `${privacy.sessionCount} session${privacy.sessionCount === 1 ? '' : 's'} · ${formatBytes(privacy.bytes)} encrypted`
              : 'Loading…'}
          </p>
        </header>
        <div className="privacy-actions">
          <button type="button" className="button" onClick={() => void exportAll()}>
            <DownloadIcon size={16} /> Export everything (JSON)
          </button>
          <button type="button" className="button" onClick={() => void window.api.privacy.openDataFolder()}>
            <FolderIcon size={16} /> Open data folder
          </button>
          <button type="button" className="button button-danger-ghost" onClick={() => setConfirmDelete(true)}>
            <TrashIcon size={16} /> Delete all data
          </button>
        </div>
        {privacy && <p className="path-hint">Stored at {privacy.dataPath}</p>}
      </section>

      <section className="privacy-block">
        <header>
          <h2>Consent record</h2>
          <p>What you agreed to, and when.</p>
        </header>
        {consent ? (
          <div className="consent-record">
            <span><CheckIcon size={16} /> Version {consent.version} · {formatDate(consent.acceptedAt)}</span>
            <div className="consent-tags">
              <span className={consent.microphone ? 'tag-on' : 'tag-off'}>Microphone {consent.microphone ? 'on' : 'off'}</span>
              <span className={consent.camera ? 'tag-on' : 'tag-off'}>Camera {consent.camera ? 'on' : 'off'}</span>
              <span className={consent.storage ? 'tag-on' : 'tag-off'}>Storage {consent.storage ? 'on' : 'off'}</span>
            </div>
          </div>
        ) : (
          <p className="muted">No consent recorded.</p>
        )}
        <div className="consent-actions-row">
          <button
            type="button"
            className={`button button-small ${consent?.camera ? 'button-danger-ghost' : 'button-ghost'}`}
            onClick={() => void (consent?.camera ? disableCamera() : enableCamera())}
          >
            {consent?.camera ? 'Turn camera access off' : 'Enable camera access'}
          </button>
        </div>
        <p className="fine-print">
          Designed to DPDP Act principles: notice, consent, minimisation, retention limits, encryption, and deletion
          rights. This is engineering documentation, not legal advice. A real classroom deployment needs institutional
          review and a student opt-out.
        </p>
      </section>

      {confirmDelete && (
        <Modal
          title="Delete all local data?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button type="button" className="button button-ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="button button-danger"
                onClick={() => {
                  void removeAll()
                  setConfirmDelete(false)
                }}
              >
                Delete everything
              </button>
            </>
          }
        >
          <p>This removes every session, transcript, bookmark and the consent record from the encrypted store.</p>
          <ul className="danger-list">
            <li>Exported .md and .json files outside the app are not deleted.</li>
            <li>OS backups may retain a copy until they expire.</li>
            <li>The encryption key is kept so future sessions can be written; delete the data folder to remove it.</li>
          </ul>
        </Modal>
      )}
    </div>
  )
}

function StatusCard({
  icon,
  label,
  value,
  detail,
  tone
}: {
  icon: React.ReactNode
  label: string
  value: string
  detail: string
  tone: 'good' | 'warn'
}): React.JSX.Element {
  return (
    <article className={`status-card tone-${tone}`}>
      <div className="status-card-top">
        <span className="status-card-icon">{icon}</span>
        <span className="status-card-label">{label}</span>
        <span className={`status-dot ${tone}`} />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  )
}
