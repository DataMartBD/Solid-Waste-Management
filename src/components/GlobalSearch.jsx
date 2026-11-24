import { useMemo, useRef, useState } from 'react'
import { users as usersApi } from '../api/endpoints.js'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { canAccess } from '../access.js'
import { useLang } from '../i18n/index.jsx'
import { fold } from './DataTable.jsx'
import { IconSearch } from './Icons.jsx'

// The top-bar search. It looks through what the app already holds in memory —
// holdings, households, collectors, vans, complaints and agencies the user can
// see — so it answers as you type. Users are not kept in memory (only an
// admin may read them), so their list is fetched once, the first time the box
// is used, and only for someone allowed to open Users. Each hit opens the page it
// belongs to; groups whose page the user cannot open are left out.

const PER_GROUP = 5
const MIN_CHARS = 2

const hit = (q, ...values) => fold(values.filter(Boolean).join(' ')).includes(q)

export default function GlobalSearch() {
  const { t } = useLang()
  const { user } = useAuth()
  const { holdings = [], households = [], collectors = [], vans = [], complaints = [], agencies = [] } = useData()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const [users, setUsers] = useState([])
  const usersAsked = useRef(false)

  function loadUsers() {
    if (usersAsked.current || !canAccess('/app/users', user)) return
    usersAsked.current = true
    usersApi.list()
      .then((data) => setUsers(Array.isArray(data) ? data : data?.results || []))
      .catch(() => { usersAsked.current = false })
  }

  const groups = useMemo(() => {
    const q = fold(query).trim()
    if (q.length < MIN_CHARS) return []
    const take = (rows, test, toItem) => {
      const out = []
      for (const r of rows) {
        if (test(r)) out.push(toItem(r))
        if (out.length === PER_GROUP) break
      }
      return out
    }
    const all = [
      {
        key: 'holdings', path: '/app/holdings',
        items: take(holdings, (h) => hit(q, h.holdingNo, h.ownerName, h.ownerPhone, h.road, h.id),
          (h) => ({ id: h.id, title: h.holdingNo, sub: [h.ownerName, h.ownerPhone, h.road].filter(Boolean).join(' · '),
            to: `/app/holdings/${h.id}/households` })),
      },
      {
        key: 'households', path: '/app/holdings',
        items: take(households, (h) => hit(q, h.id, h.head, h.phone, h.altPhone, h.holdingNo),
          (h) => ({ id: h.id, title: h.head || h.id, sub: [h.phone, h.holdingNo, h.road].filter(Boolean).join(' · '),
            to: `/app/holdings/${h.holding}/households` })),
      },
      {
        key: 'collectors', path: '/app/collectors',
        items: take(collectors, (c) => hit(q, c.name, c.dspId, c.phone),
          (c) => ({ id: c.id, title: c.name, sub: [c.dspId, c.phone].filter(Boolean).join(' · '),
            to: `/app/collectors?q=${encodeURIComponent(c.phone || c.name)}` })),
      },
      {
        key: 'vans', path: '/app/fleet',
        items: take(vans, (v) => hit(q, v.id, v.plate) || hit(q.replace(/[\s-]+/g, ''), String(v.plate || '').replace(/[\s-]+/g, '')),
          (v) => ({ id: v.id, title: v.id, sub: v.plate, to: `/app/fleet?van=${encodeURIComponent(v.id)}` })),
      },
      {
        key: 'complaints', path: '/app/complaints',
        items: take(complaints, (c) => hit(q, c.id, c.head, c.holdingNo, c.reporterPhone, c.description),
          (c) => ({ id: c.id, title: c.id, sub: [c.head, c.holdingNo, c.description].filter(Boolean).join(' · '),
            to: `/app/complaints?id=${encodeURIComponent(c.id)}` })),
      },
      {
        key: 'agencies', path: '/app/agencies',
        items: take(agencies, (a) => hit(q, a.id, a.name, a.nameBn, a.shortCode, a.contactPerson, a.phone),
          (a) => ({ id: a.id, title: a.name, sub: [a.shortCode, a.contactPerson, a.phone].filter(Boolean).join(' · '),
            to: `/app/agencies?q=${encodeURIComponent(a.shortCode || a.name)}` })),
      },
      {
        key: 'users', path: '/app/users',
        items: take(users, (u) => hit(q, u.name, u.phone, u.altPhone, u.email, u.nid),
          (u) => ({ id: u.id, title: u.name, sub: [u.phone, u.email].filter(Boolean).join(' · '),
            to: `/app/users?q=${encodeURIComponent(u.phone || u.name)}` })),
      },
    ]
    return all.filter((g) => g.items.length && canAccess(g.path, user))
  }, [query, holdings, households, collectors, vans, complaints, agencies, users, user])

  const flat = groups.flatMap((g) => g.items)

  function go(item) {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
    navigate(item.to)
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!flat.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % flat.length) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + flat.length) % flat.length) }
    if (e.key === 'Enter') { e.preventDefault(); go(flat[Math.min(active, flat.length - 1)]) }
  }

  const showList = open && fold(query).trim().length >= MIN_CHARS
  let index = -1

  return (
    <div className="topbar-search" role="search">
      <IconSearch size={17} />
      <input
        ref={inputRef}
        placeholder={t('nav.searchPlaceholder')}
        aria-label={t('nav.searchPlaceholder')}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); loadUsers() }}
        onFocus={() => { setOpen(true); loadUsers() }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <div className="global-search-list" role="listbox">
          {groups.length === 0 && <div className="global-search-empty">{t('common.noMatch')}</div>}
          {groups.map((g) => (
            <div key={g.key}>
              <div className="global-search-group">{t(`nav.search.${g.key}`)}</div>
              {g.items.map((item) => {
                index += 1
                const i = index
                return (
                  <button key={`${g.key}-${item.id}`} type="button" role="option" aria-selected={i === active}
                    className={`global-search-item${i === active ? ' on' : ''}`}
                    // mousedown, not click: the input's blur would close the list first.
                    onMouseDown={(e) => { e.preventDefault(); go(item) }}
                    onMouseEnter={() => setActive(i)}>
                    <span className="global-search-title">{item.title}</span>
                    {item.sub && <span className="global-search-sub">{item.sub}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
