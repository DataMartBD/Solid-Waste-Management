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
        return t(found.key)
      },
      // Ward display name from a ward id — "W-14" → "ওয়ার্ড ১৪ — সোনাডাঙ্গা".
      wardName: (id) => (id ? t(`opt.ward.${id}`) : '—'),
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

export const useLang = () => useContext(LanguageContext)
