import { describe, it, expect } from 'vitest'
import { DICT, LANGUAGES, translate } from './index.jsx'
import {
  toBnDigits, toLatinDigits, digitsOnly, formatNumber, formatDigits, formatTaka,
  formatDate, formatDateTime, formatTime, formatPeriod, formatPercent,
  monthName, dayName,
} from './format.js'
// The option lists live in the database now and reach the app through
// /api/catalog/, so this suite cannot import them. What it actually guards is
// unchanged: every option id the server can send must have a dictionary entry in
// both languages. The ids are duplicated here deliberately — this is the
// contract between the seed (server/swms/common/management/commands/_seed) and
// the dictionaries, and a test that fetched them from the same place it checks
// would verify nothing.
const OPTION_KEYS = {
  tiers: ['residential_standard', 'residential_premium', 'commercial_small', 'commercial_large'],
  customerTypes: ['residential', 'commercial', 'institutional', 'industrial'],
  holdingTypes: ['single_storey', 'multi_storey', 'apartment', 'tin_shed', 'shop', 'office'],
  storageTypes: ['covered_bin', 'open_bin', 'segregated', 'sack', 'none'],
  suitableTimes: ['morning', 'midday', 'afternoon', 'evening', 'any'],
  paymentModes: ['cash', 'bkash', 'nagad', 'rocket', 'bank'],
  potentialReasons: ['never_approached', 'refused_charge', 'own_arrangement', 'vacant', 'past_dispute', 'other'],
  timeGaps: ['never', 'lt_3m', '3_6m', '6_12m', 'gt_1y'],
  currentPractices: ['private_collector', 'roadside_dump', 'community_bin', 'burns', 'composts', 'none'],
}

// The i18n key each list uses, matching the `key` column the server serves.
const KEY_PREFIX = {
  tiers: 'opt.tier',
  customerTypes: 'opt.customerType',
  holdingTypes: 'opt.holdingType',
  storageTypes: 'opt.storage',
  suitableTimes: 'opt.suitableTime',
  paymentModes: 'opt.paymentMode',
  potentialReasons: 'opt.reason',
  timeGaps: 'opt.timeGap',
  currentPractices: 'opt.practice',
}

describe('dictionary integrity', () => {
  it('ships both languages', () => {
    expect(LANGUAGES.map((l) => l.id).sort()).toEqual(['bn', 'en'])
    expect(Object.keys(DICT.en).length).toBeGreaterThan(200)
  })

  // The whole point of this suite: a key present in one language and missing in
  // the other is a half-translated screen, which is worse than an English one.
  it('every English key has a Bangla translation and vice versa', () => {
    const en = Object.keys(DICT.en).sort()
    const bn = Object.keys(DICT.bn).sort()
    const missingBn = en.filter((k) => !(k in DICT.bn))
    const missingEn = bn.filter((k) => !(k in DICT.en))
    expect(missingBn, `keys missing a Bangla translation: ${missingBn.join(', ')}`).toEqual([])
    expect(missingEn, `keys missing an English translation: ${missingEn.join(', ')}`).toEqual([])
  })

  it('no value is empty in either language', () => {
    for (const lang of ['en', 'bn']) {
      for (const [key, value] of Object.entries(DICT[lang])) {
        expect(typeof value, `${lang}.${key}`).toBe('string')
        expect(value.trim().length, `${lang}.${key} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('the two languages actually differ — Bangla is not a copy of English', () => {
    // Some strings are the same in both languages by design: symbols, brand
    // names, and input-format hints the operator types in Latin regardless of
    // the reading language.
    const allowedIdentical = new Set([
      'common.none',
      'nav.switchToBangla', 'nav.switchToEnglish',
      'households.ph.email',                             // an email is typed in Latin
    ])
    // Placeholder names are code, not prose — {value} must not read as English.
    const prose = (s) => s.replace(/\{\w+\}/g, '')
    const identical = Object.keys(DICT.en).filter(
      (k) => !allowedIdentical.has(k) && DICT.en[k] === DICT.bn[k] && /[a-zA-Z]{4}/.test(prose(DICT.en[k])),
    )
    expect(identical, `untranslated Bangla values: ${identical.join(', ')}`).toEqual([])
  })

  it('placeholders match between the two languages', () => {
    const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(DICT.en)) {
      expect(names(DICT.bn[key]), `placeholders differ for ${key}`).toEqual(names(DICT.en[key]))
    }
  })
})

describe('option lists are fully translated', () => {
  const lists = Object.fromEntries(
    Object.entries(OPTION_KEYS).map(([name, ids]) => [
      name,
      ids.map((id) => ({ id, key: `${KEY_PREFIX[name]}.${id}` })),
    ]),
  )

  it('every option carries an i18n key that resolves in both languages', () => {
    for (const [name, list] of Object.entries(lists)) {
      for (const option of list) {
        expect(option.key, `${name}.${option.id} has no i18n key`).toBeTruthy()
        expect(DICT.en[option.key], `missing en for ${option.key}`).toBeTruthy()
        expect(DICT.bn[option.key], `missing bn for ${option.key}`).toBeTruthy()
      }
    }
  })

  it('option keys are unique across every list', () => {
    const keys = Object.values(lists).flat().map((o) => o.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('translate()', () => {
  it('returns the requested language', () => {
    expect(translate('en', 'common.save')).toBe('Save')
    expect(translate('bn', 'common.save')).toBe('সংরক্ষণ')
  })

  it('falls back to English, then to the key itself', () => {
    expect(translate('bn', 'definitely.not.a.key')).toBe('definitely.not.a.key')
  })

  it('interpolates named placeholders', () => {
    expect(translate('en', 'common.shown', { count: 12 })).toBe('12 shown')
    expect(translate('en', 'common.shown')).toBe('{count} shown')
  })
})

describe('number formatting', () => {
  it('transliterates digits', () => {
    expect(toBnDigits('2026-07')).toBe('২০২৬-০৭')
  })

  // A Bangla keyboard emits ০-৯; every numeric input normalizes before parsing,
  // otherwise a collector typing their PIN in Bangla gets an empty box.
  it('reads Bangla numerals back as Latin', () => {
    expect(toLatinDigits('৪৯০৭')).toBe('4907')
    expect(toLatinDigits('০১৭১১০০০০৪২')).toBe('01711000042')
    expect(toLatinDigits('already-7')).toBe('already-7')
  })

  it('digitsOnly keeps digits from either script and drops the rest', () => {
    expect(digitsOnly('৪৯০৭')).toBe('4907')
    expect(digitsOnly('+88 ০১৭১১-০০০০৪২')).toBe('8801711000042')
    expect(digitsOnly('abc')).toBe('')
    expect(digitsOnly(null)).toBe('')
  })

  it('groups by thousands in English and by lakh/crore in Bangla', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567')
    expect(formatNumber(1234567, 'bn')).toBe('১২,৩৪,৫৬৭')
  })

  it('handles non-numbers without throwing', () => {
    expect(formatNumber(undefined, 'bn')).toBe('')
    expect(formatNumber('abc', 'en')).toBe('')
  })

  it('formats money, percentages and free-form digits', () => {
    expect(formatTaka(100, 'en')).toBe('৳100')
    expect(formatTaka(100, 'bn')).toBe('৳১০০')
    expect(formatPercent(93, 'bn')).toBe('৯৩%')
    expect(formatDigits('HH-042', 'bn')).toBe('HH-০৪২')
  })
})

describe('date formatting', () => {
  const iso = '2026-07-05T06:14:00'

  it('names months and weekdays in both languages', () => {
    expect(monthName(6, 'en')).toBe('July')
    expect(monthName(6, 'bn')).toBe('জুলাই')
    expect(dayName(0, 'en')).toBe('Sunday')
    expect(dayName(0, 'bn')).toBe('রবিবার')
  })

  it('formats a full date', () => {
    expect(formatDate(iso, 'en')).toBe('5 July 2026')
    expect(formatDate(iso, 'bn')).toBe('৫ জুলাই ২০২৬')
  })

  it('formats time with a localized meridiem', () => {
    expect(formatTime(iso, 'en')).toBe('6:14 am')
    expect(formatTime(iso, 'bn')).toBe('৬:১৪ পূর্বাহ্ণ')
    expect(formatDateTime(iso, 'en')).toBe('5 July 2026, 6:14 am')
  })

  it('formats a billing period', () => {
    expect(formatPeriod('2026-07', 'en')).toBe('July 2026')
    expect(formatPeriod('2026-07', 'bn')).toBe('জুলাই ২০২৬')
  })

  it('renders an em dash for a missing or invalid date', () => {
    expect(formatDate(null, 'en')).toBe('—')
    expect(formatDate('not-a-date', 'bn')).toBe('—')
    expect(formatDateTime('', 'en')).toBe('—')
  })
})
