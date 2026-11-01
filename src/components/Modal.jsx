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

// Widths sized to what a field holds, for <FormRow>s that wrap: each grows to
// share the row but never shrinks below what its content needs.
//   xs   a count (floors, flats)          md   a dropdown (district, ward, type)
//   sm   a phone, a number, a date        lg   a name, a road, a lane
//   full the whole row (notes)
export const FIELD_SIZES = {
  xs: { flex: '1 1 100px', minWidth: 90 },
  sm: { flex: '1 1 150px', minWidth: 130 },
  md: { flex: '2 1 210px', minWidth: 170 },
  lg: { flex: '3 1 300px', minWidth: 220 },
  full: { flex: '1 1 100%' },
}

// A label, with a red asterisk when the field must be filled in.
export function FieldLabel({ htmlFor, label, mark }) {
  if (!label) return null
  return (
    <label htmlFor={htmlFor}>
      {label}{mark && <span className="req-mark" aria-hidden="true"> *</span>}
    </label>
  )
}

// Labeled form control. `as` = 'input' | 'select' | 'textarea'
// `half` / `third` / `narrow` or `size` set the width inside a <FormRow>;
// `mark` shows the field is mandatory.
export function Field({ label, hint, as = 'input', options, children, half, third, narrow, size, mark, id, ...props }) {
  // `narrow` is for a value that is short and always will be — a blood group,
  // a day of the month, a floor. Giving those the same width as an email
  // address wastes a row and makes the form look longer than it is.
  //
  // The minimum matters as much as the basis: a <FormRow> wraps, so a min that
  // is wider than its share of a narrow column pushes the field onto a line of
  // its own — which is the whole thing `narrow` exists to avoid. "AB+" and a
  // dropdown arrow need very little.
  const width = size ? FIELD_SIZES[size] : narrow
    ? { flex: '0 1 130px', minWidth: 104 }
    : third ? { flex: '1 1 29%', minWidth: 130 }
      : half ? { flex: '1 1 45%', minWidth: 160 } : undefined
  // The label was previously bare, so clicking it did nothing and screen readers
  // announced "edit, blank" for every control. useId gives each field a stable
  // unique id; callers can still pass an explicit `id` to override.
  const autoId = useId()
  const fieldId = id || autoId
  const hintId = hint ? `${fieldId}-hint` : undefined
  const described = { 'aria-describedby': hintId }
  return (
    <div className="field" style={width}>
      <FieldLabel htmlFor={fieldId} label={label} mark={mark} />
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
      {title && (
        <legend style={{ padding: 0, marginBottom: 10, fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
          {title}
        </legend>
      )}
      {hint && <div className="tiny muted-3" style={{ marginTop: -6, marginBottom: 10 }}>{hint}</div>}
      <div className="col gap-12" style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
    </fieldset>
  )
}

export function ModalActions({ children }) {
  return <div className="row gap-8 mt-24" style={{ justifyContent: 'flex-end' }}>{children}</div>
}
