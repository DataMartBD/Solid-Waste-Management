// Pure helpers over the reference lists the server serves from /api/catalog/.
//
// The lists themselves used to be hard-coded arrays in mockData.js; they now come
// from the database, so anything that needs them takes them as an argument
// instead of importing a module-level constant. DataContext binds these to the
// loaded catalog and re-exports them, which is what pages actually use.

// Every option row carries both `key` (the i18n lookup) and `label` (English
// fallback), because the Bangla dictionaries resolve `key` and fall back to `label`.
export function optLabel(list, id) {
  if (!id) return '—'
  const found = (list || []).find((row) => row.id === id)
  return found?.label || id
}

export function optKey(list, id) {
  return (list || []).find((row) => row.id === id)?.key || null
}

export const tierLabel = (tiers, id) => optLabel(tiers, id)

export function tierCharge(tiers, id) {
  return (tiers || []).find((row) => row.id === id)?.charge || 0
}

// A negotiated per-household charge overrides the tier's standard charge.
// `estTier` covers potential customers, which have no agreed charge yet.
export function effectiveCharge(tiers, holding) {
  if (!holding) return 0
  const negotiated = Number(holding.charge)
  if (negotiated > 0) return negotiated
  return tierCharge(tiers, holding.tier || holding.estTier)
}

export function wardName(wards, id) {
  return (wards || []).find((row) => row.id === id)?.name || id || '—'
}

// 'Ward 14 — Sonadanga' -> 'Ward 14', for tight columns and badges.
export function wardShort(wards, id) {
  const name = wardName(wards, id)
  return String(name).split('—')[0].trim()
}

export function zoneName(zones, id) {
  return (zones || []).find((row) => row.id === id)?.name || id || '—'
}

// The empty catalog used before the first fetch resolves, so components can
// render their frame without guarding every list access.
export const EMPTY_CATALOG = {
  zones: [],
  wards: [],
  roadsByWard: {},
  tiers: [],
  bloodGroups: [],
  customerTypes: [],
  holdingTypes: [],
  storageTypes: [],
  suitableTimes: [],
  paymentModes: [],
  potentialReasons: [],
  timeGaps: [],
  currentPractices: [],
}
