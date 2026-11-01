// A dropdown you can type into: the list narrows as you type, then click or
// press Enter to choose. For long lists — 64 districts — where scrolling a
// plain <select> is slow, especially on a phone.
//
// `options` are { value, label, keywords? }. Matching ignores case and looks at
// the label, the value and the keywords, so a district can be found by its
// English or its Bangla name whichever language the screen is in.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { FIELD_SIZES, FieldLabel } from './Modal.jsx'

const fold = (text) => String(text || '').toLocaleLowerCase().normalize('NFC')

export function SearchSelect({
  label, value, options, onChange, placeholder, disabled, hint, emptyText, half, size, mark, clearable = true,
}) {
  const id = useId()
  const listId = `${id}-list`
  const selected = options.find((o) => o.value === value) || null
  const [text, setText] = useState(selected?.label || '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef(null)

  // Follow the value when it changes from outside (a record loading).
  useEffect(() => { if (!open) setText(selected?.label || '') }, [selected?.label, open])

  const matches = useMemo(() => {
    const q = fold(text)
    if (!q || (selected && text === selected.label)) return options
    return options.filter((o) => [o.label, o.value, ...(o.keywords || [])].some((k) => fold(k).includes(q)))
  }, [options, text, selected])

  function choose(option) {
    onChange(option ? option.value : '')
    setText(option ? option.label : '')
    setOpen(false)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (matches[active]) choose(matches[active]) }
    else if (e.key === 'Escape') { setOpen(false); setText(selected?.label || '') }
  }

  // A click outside puts the chosen label back, so half-typed text never lingers.
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => {
      if (box.current && !box.current.contains(e.target)) { setOpen(false); setText(selected?.label || '') }
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open, selected?.label])

  const width = size ? FIELD_SIZES[size] : half ? { flex: '1 1 45%', minWidth: 160 } : undefined

  return (
    <div className="field search-select" ref={box} style={width}>
      <FieldLabel htmlFor={id} label={label} mark={mark} />
      <div className="search-select-box">
        <input
          id={id} className="input" value={text} placeholder={placeholder} disabled={disabled}
          role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          autoComplete="off"
          onFocus={(e) => { setOpen(true); setActive(0); e.target.select() }}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0) }}
          onKeyDown={onKeyDown}
        />
        {clearable && value && !disabled && (
          <button type="button" className="search-select-clear" aria-label="×" onClick={() => choose(null)}>×</button>
        )}
      </div>
      {open && !disabled && (
        <ul className="search-select-list" id={listId} role="listbox">
          {matches.length === 0 && <li className="search-select-empty">{emptyText || '—'}</li>}
          {matches.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value}
              className={`${i === active ? 'active' : ''}${o.value === value ? ' chosen' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); choose(o) }}
              onMouseEnter={() => setActive(i)}>
              {o.label}
            </li>
          ))}
        </ul>
      )}
      {hint && <div className="tiny muted-3">{hint}</div>}
    </div>
  )
}
