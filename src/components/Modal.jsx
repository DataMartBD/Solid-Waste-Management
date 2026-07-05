import { useEffect } from 'react'

// Generic centered modal dialog.
export function Modal({ title, subtitle, onClose, children, width = 520 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3 style={{ fontSize: 17 }}>{title}</h3>
            {subtitle && <div className="tiny muted-3 mt-4">{subtitle}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// Labeled form control. `as` = 'input' | 'select' | 'textarea'
export function Field({ label, as = 'input', options, children, half, ...props }) {
  return (
    <div className="field" style={half ? { flex: '1 1 45%', minWidth: 160 } : undefined}>
      {label && <label>{label}</label>}
      {as === 'select' ? (
        <select className="select" {...props}>{children || options?.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
        ))}</select>
      ) : as === 'textarea' ? (
        <textarea className="input" rows={3} {...props} />
      ) : (
        <input className="input" {...props} />
      )}
    </div>
  )
}

export function FormRow({ children }) {
  return <div className="row gap-12 wrap" style={{ alignItems: 'flex-start' }}>{children}</div>
}

export function ModalActions({ children }) {
  return <div className="row gap-8 mt-24" style={{ justifyContent: 'flex-end' }}>{children}</div>
}
