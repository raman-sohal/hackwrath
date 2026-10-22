import { useAppStore } from '@renderer/state/store'
import { CheckIcon, XIcon } from './Icons'

export function Toast(): React.JSX.Element | null {
  const toast = useAppStore((s) => s.toast)
  const dismiss = useAppStore((s) => s.dismissToast)
  if (!toast) return null
  return (
    <div className={`toast toast-${toast.kind}`} role="status" aria-live="polite">
      <span className="toast-icon">{toast.kind === 'ok' ? <CheckIcon size={16} /> : <XIcon size={16} />}</span>
      <span className="toast-message">{toast.message}</span>
      <button type="button" className="toast-close" onClick={dismiss} aria-label="Dismiss notification">
        <XIcon size={14} />
      </button>
    </div>
  )
}
