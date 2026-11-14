// A text box with a list of suggestions: pick one, or type anything else.
//
// Unlike a browser <datalist>, the full list shows whenever the box is opened,
// even when it already holds a value — a datalist only offers entries matching
// what is typed, so editing a saved "Office" showed nothing else to choose.
// The list narrows only once the person starts typing.
//
// The list is placed with `position: fixed`, so a table's scroll area
// (`.table-wrap` scrolls) cannot clip it — and rendered into <body> through a
// portal, because a page's `.fade-in` transform would otherwise become the
// containing block for anything fixed inside it (see Modal.test.jsx).

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const fold = (text) => String(text || '').toLocaleLowerCase().normalize('NFC')

export function SuggestInput({
  value, onChange, options, placeholder, maxLength, disabled, style, ...rest
}) {
  const listId = `${useId()}-list`
  const input = useRef(null)
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState(false)
  const [active, setActive] = useState(-1)
  const [place, setPlace] = useState(null)

  const matches = useMemo(() => {
    const q = fold(value)
    if (!typed || !q) return options
    return options.filter((o) => fold(o).includes(q))
  }, [options, value, typed])

  // Keep the list under the box while the page or the table scrolls.
  useEffect(() => {
    if (!open) return undefined
    const follow = () => {
      const r = input.current?.getBoundingClientRect()
      if (r) setPlace({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 160) })
    }
    follow()
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [open])

  function close() { setOpen(false); setTyped(false); setActive(-1) }

  function choose(option) {
    onChange(option)
    close()
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault(); choose(matches[active])
    } else if (e.key === 'Escape') {
      close()
    }
  }

  return (
    <>
      <input
        ref={input} className="input" value={value} placeholder={placeholder}
        maxLength={maxLength} disabled={disabled} style={style} autoComplete="off"
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        onFocus={() => { setOpen(true); setTyped(false); setActive(-1) }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setTyped(true); setActive(-1) }}
        onKeyDown={onKeyDown}
        {...rest}
      />
      {open && !disabled && place && matches.length > 0 && createPortal(
        <ul className="search-select-list" id={listId} role="listbox"
          style={{ position: 'fixed', left: place.left, top: place.top, width: place.width, right: 'auto' }}>
          {matches.map((o, i) => (
            <li key={o} role="option" aria-selected={o === value}
              className={`${i === active ? 'active' : ''}${o === value ? ' chosen' : ''}`}
              // mousedown, not click: it lands before the box's blur closes the list.
              onMouseDown={(e) => { e.preventDefault(); choose(o) }}
              onMouseEnter={() => setActive(i)}>
              {o}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  )
}
