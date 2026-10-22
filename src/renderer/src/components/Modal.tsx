import { useEffect, useRef } from 'react'
import { XIcon } from './Icons'

interface Props {
  title: string
  children: React.ReactNode
  onClose?: () => void
  footer?: React.ReactNode
  wide?: boolean
  labelledBy?: string
}

export function Modal({ title, children, onClose, footer, wide = false }: Props): React.JSX.Element {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>('button, input, select, [tabindex="0"]')
    first?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && onClose) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
              <XIcon size={18} />
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}
