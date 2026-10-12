import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import {
  formatNumber, formatDigits, formatTaka, formatDate, formatDateTime,
  formatTime, formatPeriod, formatPercent, monthName, dayName, digitsOnly,
} from './format.js'

export { digitsOnly, toLatinDigits } from './format.js'

// Namespace files are discovered automatically, so adding a page's strings is a
// matter of dropping a new file into ./dict — no registry to keep in sync.
const modules = import.meta.glob('./dict/*.js', { eager: true })

export const DICT = { en: {}, bn: {} }
for (const path of Object.keys(modules).sort()) {
  const ns = modules[path].default
  if (!ns) continue
  Object.assign(DICT.en, ns.en)
  Object.assign(DICT.bn, ns.bn)
}

export const LANGUAGES = [
  { id: 'bn', label: 'বাংলা', short: 'বাং', english: 'Bangla' },
  { id: 'en', label: 'English', short: 'EN', english: 'English' },
]

const STORAGE_KEY = 'swms.lang'
const DEFAULT_LANG = 'bn'

// Fills {placeholders} from a vars object.
function interpolate(text, vars) {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
}

// Look up a key, falling back to English and finally to the key itself so a
// missing string is visible in the UI rather than rendering as blank.
export function translate(lang, key, vars) {
  const text = DICT[lang]?.[key] ?? DICT.en?.[key] ?? key
  return interpolate(text, vars)
}

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'bn' || saved === 'en') return saved
    } catch { /* ignore */ }
    return DEFAULT_LANG
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
    document.documentElement.lang = lang
    document.documentElement.setAttribute('data-lang', lang)
  }, [lang])

  const value = useMemo(() => {
    const t = (key, vars) => translate(lang, key, vars)
    return {
      lang,
      isBn: lang === 'bn',
      setLang,
      toggle: () => setLang((l) => (l === 'bn' ? 'en' : 'bn')),
      t,
      // Label for one option object from a mockData list ({ id, key, label }).
      tOpt: (option) => (option?.key ? t(option.key) : option?.label || '—'),
      // …and the same by id, for records that store only the id.
      optLabel: (list, id) => {
        const found = list.find((o) => o.id === id)
        if (!found) return id || '—'
        // A row added in setup has no dictionary entry yet: show its own label
        // rather than the raw key.
        const text = t(found.key)
        return text === found.key ? found.label || id : text
      },
      // Ward display name from a ward id — "W-14" → "ওয়ার্ড ১৪ — সোনাডাঙ্গা".
      wardName: (id) => {
        if (!id) return '—'
        const key = `opt.ward.${id}`
        const text = t(key)
        if (text !== key) return text
        // No dictionary entry: the ward's own name, in Bangla when it has one.
        const own = wardFallback.get(id)
        if (!own) return id
        return (lang === 'bn' && own.nameBn) || own.name || id
      },
      // The display name of a record carrying `name` and `nameBn` (a city, a
      // zone, a ward): the Bangla one in Bangla mode when it has one.
      localName: (row) => (row ? (lang === 'bn' && row.nameBn) || row.name || row.id : '—'),
      // Zone display name from a zone id: its Bangla name in Bangla mode when it
      // has one, else its English name. Zones carry their names in the catalog.
      zoneName: (id) => {
        if (!id) return '—'
        const own = zoneNames.get(id)
        if (!own) return id
        return (lang === 'bn' && own.nameBn) || own.name || id
      },
      // strips to Latin digits, accepting Bangla numerals as input
      digitsOnly,
      // formatting bound to the active language
      n: (v) => formatNumber(v, lang),
      digits: (v) => formatDigits(v, lang),
      taka: (v) => formatTaka(v, lang),
      date: (v) => formatDate(v, lang),
      dateTime: (v) => formatDateTime(v, lang),
      time: (v) => formatTime(v, lang),
      period: (v) => formatPeriod(v, lang),
      percent: (v) => formatPercent(v, lang),
      month: (i, short) => monthName(i, lang, short),
      day: (i, short) => dayName(i, lang, short),
    }
  }, [lang])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

// Names for wards that have no dictionary entry — every ward of a city added
// from the Setup page. DataContext fills this from the catalog, so `wardName`
// shows that ward's own name (Bangla in Bangla mode, when it has one) instead
// of the raw key.
const wardFallback = new Map()
export function setWardFallbackNames(wards) {
  wardFallback.clear()
  ;(wards || []).forEach((w) => wardFallback.set(w.id, { name: w.name, nameBn: w.nameBn }))
}

// Zone names in both languages, filled from the catalog by DataContext.
const zoneNames = new Map()
export function setZoneNames(zones) {
  zoneNames.clear()
  ;(zones || []).forEach((z) => zoneNames.set(z.id, { name: z.name, nameBn: z.nameBn }))
}

export const useLang = () => useContext(LanguageContext)
