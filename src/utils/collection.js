// Daily collection round — the pure helpers that survive the move to the API.
//
// Building a round used to happen here: `stopsForCollector` stitched households,
// visits, routes and assignments together in the browser, which meant the
// supervisor's Routes view and the collector's own Collection round could only
// agree by accident. `GET /api/collection/round/` owns that now (and resolving a
// scan, and writing a visit), so what is left is the small arithmetic the pages
// still do over arrays they already hold.

export const VISIT_STATUS = { collected: 'collected', skipped: 'skipped', pending: 'pending' }

// Why a stop was left. These ids travel to the server as `Visit.reason`, so the
// list has to stay in step with `SkipReason` in server/swms/fieldops/models.py;
// each one also resolves as an i18n key, `collection.skip.<id>`.
export const SKIP_REASONS = ['noOne', 'noWaste', 'locked', 'access', 'refused']

// Order stops so completed ones lead (in visit-time order), then pending by
// holding — this reads as forward progress along the route.
export function orderStops(stops) {
  const rank = (s) => (s.visitStatus === 'pending' ? 1 : 0)
  // One total order: rank, then time (untimed sorts last, never "equal to
  // everything"), then holding. Switching keys mid-comparison made this
  // intransitive and the result depended on the input order.
  const time = (s) => (s.at ? new Date(s.at).getTime() : Number.POSITIVE_INFINITY)
  return [...stops].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (time(a) !== time(b)) return time(a) - time(b)
    return String(a.holding).localeCompare(String(b.holding), undefined, { numeric: true })
  })
}

export const dayOf = (iso) => String(iso || '').slice(0, 10)
export const today = () => new Date().toISOString().slice(0, 10)

// A household may only be planned into a round once its location has been
// verified on site — an unverified holding has no confirmed coordinates, so
// nobody can be sent to it. The server refuses one too, naming it; this keeps
// the planner's picker from offering a holding it knows will be rejected.
export const isRoutable = (h) => Boolean(h?.verified)

export const assignmentFor = (collectorId, assignments = []) =>
  assignments.find((a) => a.collector === collectorId && a.active !== false) || null

// The routes a collector holds, in the order they were assigned.
export function routesForCollector(collectorId, { routes = [], assignments = [] }) {
  const plan = assignmentFor(collectorId, assignments)
  if (!plan) return []
  return (plan.routes || [])
    .map((id) => routes.find((r) => r.id === id))
    .filter((r) => r && r.active !== false)
}

// Which collector, if any, walks a given route.
export const collectorForRoute = (routeId, assignments = []) =>
  assignments.find((a) => a.active !== false && (a.routes || []).includes(routeId))?.collector || null

// The three buckets always sum to `all`: anything not collected or skipped is
// still waiting, whatever it calls itself. The round endpoint returns the same
// three numbers; this still runs over a locally assembled list of stops.
export const countByStatus = (stops) => {
  const collected = stops.filter((s) => s.visitStatus === VISIT_STATUS.collected).length
  const skipped = stops.filter((s) => s.visitStatus === VISIT_STATUS.skipped).length
  return { all: stops.length, collected, skipped, pending: stops.length - collected - skipped }
}
