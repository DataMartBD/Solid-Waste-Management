// Which roles may reach which screen.
//
// The mock app gated on "is signed in" only, and the sidebar offered every page
// to everybody — a KCC Viewer could open the route planner and a collector could
// open the billing run. The server now enforces real permissions, so the UI has
// to agree with it: a page a role cannot use should not be reachable or listed,
// rather than loading and then failing on the first write.
//
// This map is the single source of truth, read by both the router (App.jsx) and
// the sidebar (Layout.jsx). Keys are `roleKey` values from the API.

export const ROLES = ['collector', 'supervisor', 'agency_admin', 'kcc_viewer']

const ALL = ROLES
const OFFICE = ['supervisor', 'agency_admin']

//: path -> roles allowed. A path absent from this map is open to any signed-in user.
export const ROUTE_ACCESS = {
  '/app/dashboard': ALL,
  '/app/live': ALL,
  '/app/households': ['collector', ...OFFICE],
  // A collector's own round. Read-only roles have nothing to do here.
  '/app/collection': ['collector', ...OFFICE],
  '/app/routes': ['collector', ...OFFICE],
  // Planning who walks what is a supervisor's job.
  '/app/route-plan': OFFICE,
  '/app/complaints': ['collector', ...OFFICE],
  '/app/billing': OFFICE,
  '/app/fleet': OFFICE,
  '/app/collectors': OFFICE,
  // City-wide oversight is exactly what the KCC viewer exists for.
  '/app/reports': ['kcc_viewer', ...OFFICE],
  '/app/reports-customer': ['kcc_viewer', ...OFFICE],
  '/app/profile': ALL,
}

export function canAccess(path, user) {
  if (!user) return false
  const allowed = ROUTE_ACCESS[path]
  if (!allowed) return true
  return allowed.includes(user.roleKey)
}

// Where to send a user who has no business on the page they asked for. The server
// supplies `home` per role; fall back to the first page they can actually open.
export function homeFor(user) {
  if (!user) return '/login'
  if (user.home && canAccess(user.home, user)) return user.home
  return Object.keys(ROUTE_ACCESS).find((path) => canAccess(path, user)) || '/app/profile'
}
