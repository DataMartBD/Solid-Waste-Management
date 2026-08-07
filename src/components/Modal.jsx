import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '../i18n/index.jsx'

// Generic centered modal dialog.
//
// Rendered into <body> rather than where it is written in the tree. Every page
// wraps itself in `.fade-in`, whose animation touches `transform`; a filling
// transform animation makes that wrapper the containing block for any
// `position: fixed` descendant. The scrim's `inset: 0` then resolves to the
// page's own box instead of the viewport, so on a short page — an empty table,
// say — the dialog is cut off at the end of the content. A portal escapes that,
// and any future ancestor overflow or stacking context along with it.
export function Modal({ title, subtitle, onClose, children, width = 520 }) {
  const { t } = useLang()

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3 style={{ fontSize: 17 }}>{title}</h3>
            {subtitle && <div className="tiny muted-3 mt-4">{subtitle}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// Labeled form control. `as` = 'input' | 'select' | 'textarea'
// `half` / `third` set the width when the field sits inside a <FormRow>.
export function Field({ label, hint, as = 'input', options, children, half, third, id, ...props }) {
  const width = third ? { flex: '1 1 29%', minWidth: 130 } : half ? { flex: '1 1 45%', minWidth: 160 } : undefined
  // The label was previously bare, so clicking it did nothing and screen readers
  // announced "edit, blank" for every control. useId gives each field a stable
  // unique id; callers can still pass an explicit `id` to override.
  const autoId = useId()
  const fieldId = id || autoId
  const hintId = hint ? `${fieldId}-hint` : undefined
  const described = { 'aria-describedby': hintId }
  return (
    <div className="field" style={width}>
      {label && <label htmlFor={fieldId}>{label}</label>}
      {as === 'select' ? (
        <select id={fieldId} className="select" {...described} {...props}>{children || options?.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
        ))}</select>
      ) : as === 'textarea' ? (
        <textarea id={fieldId} className="input" rows={3} {...described} {...props} />
      ) : (
        <input id={fieldId} className="input" {...described} {...props} />
      )}
      {hint && <div id={hintId} className="tiny muted-3">{hint}</div>}
    </div>
  )
}

export function FormRow({ children }) {
  return <div className="row gap-12 wrap" style={{ alignItems: 'flex-start' }}>{children}</div>
}

// Groups related fields under a small heading inside a long form.
export function FormSection({ title, hint, children, first }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: first ? '0 0 4px' : '18px 0 4px' }}>
      <legend style={{ padding: 0, marginBottom: 10, fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
        {title}
      </legend>
      {hint && <div className="tiny muted-3" style={{ marginTop: -6, marginBottom: 10 }}>{hint}</div>}
      <div className="col gap-12" style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
    </fieldset>
  )
}

export function ModalActions({ children }) {
  return <div className="row gap-8 mt-24" style={{ justifyContent: 'flex-end' }}>{children}</div>
}
