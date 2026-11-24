// The agencies a picker offers: active ones only. A suspended, expired or
// terminated agency takes no new buildings or accounts. The one a record is
// already saved with stays listed, so opening that record does not silently
// blank its agency.
export function pickableAgencies(agencies, current = '') {
  return (agencies || []).filter((a) => (a.status || 'active') === 'active' || a.id === current)
}
