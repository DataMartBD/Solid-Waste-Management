// Locale-aware formatting helpers.
// Bangla uses its own digits and the lakh/crore grouping (১,২৩,৪৫৬), so numbers
// are grouped with the en-IN rules and then transliterated digit by digit. Doing
// the digits ourselves keeps output identical everywhere, including in jsdom,
// where the bn-BD locale data may not be present.

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯']

export const toBnDigits = (value) => String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)])

// The reverse, for input. A Bangla keyboard emits ০-৯ (U+09E6–U+09EF), which a
// plain /\D/ strip would throw away — so every numeric field normalizes first
// and a collector can type their PIN in the digits they actually see.
export const toLatinDigits = (value) => String(value ?? '').replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))

// Keeps only digits, accepting either script.
export const digitsOnly = (value) => toLatinDigits(value).replace(/\D/g, '')

// Grouped number — 1234567 → "12,34,567" (bn) / "1,234,567" (en)
export function formatNumber(value, lang) {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  const grouped = n.toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US')
  return lang === 'bn' ? toBnDigits(grouped) : grouped
}

// Any string that may contain digits — ids, holdings, phone numbers, ৳ amounts.
export const formatDigits = (value, lang) => (lang === 'bn' ? toBnDigits(value ?? '') : String(value ?? ''))

// Money, always with the taka sign.
export function formatTaka(value, lang) {
  const text = formatNumber(value, lang)
  if (text === '') return '—'
  // The sign belongs in front of the currency mark, not between it and the digits.
  return text.startsWith('-') ? `-৳${text.slice(1)}` : `৳${text}`
}

const BN_MONTHS = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
]
const EN_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const BN_DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার']
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const asDate = (value) => {
  if (value instanceof Date) return value
  if (value == null || value === '') return null
  // ECMAScript parses a bare date as UTC midnight but a full timestamp as local.
  // Reading date-only values as local keeps a day from slipping backwards for
  // anyone west of UTC.
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function monthName(index, lang, short = false) {
  const name = (lang === 'bn' ? BN_MONTHS : EN_MONTHS)[index] || ''
  return short && lang !== 'bn' ? name.slice(0, 3) : name
}

export function dayName(index, lang, short = false) {
  const name = (lang === 'bn' ? BN_DAYS : EN_DAYS)[index] || ''
  return short ? (lang === 'bn' ? name.replace('বার', '') : name.slice(0, 3)) : name
}

// "5 July 2026" / "৫ জুলাই ২০২৬"
export function formatDate(value, lang) {
  const d = asDate(value)
  if (!d) return '—'
  const day = formatNumber(d.getDate(), lang)
  const year = formatDigits(d.getFullYear(), lang)
  return `${day} ${monthName(d.getMonth(), lang)} ${year}`
}

// "5 July 2026, 6:14 am"
export function formatDateTime(value, lang) {
  const d = asDate(value)
  if (!d) return '—'
  const h = d.getHours()
  const hour12 = h % 12 || 12
  const minute = String(d.getMinutes()).padStart(2, '0')
  const suffix = lang === 'bn' ? (h < 12 ? 'পূর্বাহ্ণ' : 'অপরাহ্ণ') : (h < 12 ? 'am' : 'pm')
  return `${formatDate(d, lang)}, ${formatDigits(`${hour12}:${minute}`, lang)} ${suffix}`
}

// "6:14 am" — used in route timelines where the date is already known.
export function formatTime(value, lang) {
  const d = asDate(value)
  if (!d) return '—'
  const h = d.getHours()
  const hour12 = h % 12 || 12
  const minute = String(d.getMinutes()).padStart(2, '0')
  const suffix = lang === 'bn' ? (h < 12 ? 'পূর্বাহ্ণ' : 'অপরাহ্ণ') : (h < 12 ? 'am' : 'pm')
  return `${formatDigits(`${hour12}:${minute}`, lang)} ${suffix}`
}

// "2026-07" → "July 2026" / "জুলাই ২০২৬"
export function formatPeriod(period, lang) {
  const [y, m] = String(period || '').split('-')
  const name = monthName(Number(m) - 1, lang)
  // Fall back to the raw value rather than emitting a stray leading space.
  if (!y || !m || !name) return formatDigits(period, lang)
  return `${name} ${formatDigits(y, lang)}`
}

export function formatPercent(value, lang) {
  const text = formatNumber(value, lang)
  return text === '' ? '—' : `${text}%`
}
