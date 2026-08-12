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
  // The property register sits alongside Households and answers to the same
  // roles. It was reachable by every signed-in user until this entry existed —
  // a path absent from this map is open, which is easy to miss when adding one.
  '/app/holdings': ['collector', ...OFFICE],
  // Registering or editing a building is a write, so it is narrower than the
  // list it sits behind. `:id` is matched as a parameter — see `canAccess`.
  '/app/holdings/new': OFFICE,
  '/app/holdings/:id/edit': OFFICE,
  // A building's families. Collectors read it on the doorstep, so it matches
  // the register it hangs off rather than the narrower editor.
  '/app/holdings/:id/households': ['collector', ...OFFICE],
  // A collector's own round. Read-only roles have nothing to do here.
  '/app/collection': ['collector', ...OFFICE],
  '/app/routes': ['collector', ...OFFICE],
  // Planning who walks what is a supervisor's job.
  '/app/route-plan': OFFICE,
  // Door-to-door surveys. Collectors are the ones holding the clipboard, so
  // they need it as much as the office does.
  '/app/surveys': ['collector', ...OFFICE],
  // Recording a survey is the collector's own job, so it matches the list.
  '/app/surveys/new': ['collector', ...OFFICE],
  '/app/complaints': ['collector', ...OFFICE],
  '/app/billing': OFFICE,
  '/app/fleet': OFFICE,
  '/app/collectors': OFFICE,
  // Contracts, licences and remittances. Writes are agency-admin only on the
  // server, so the page is too — showing a supervisor buttons that 403 would
  // be worse than not offering the page.
  '/app/agencies': ['agency_admin'],
  // City-wide oversight is exactly what the KCC viewer exists for.
  '/app/reports': ['kcc_viewer', ...OFFICE],
  '/app/reports-customer': ['kcc_viewer', ...OFFICE],
  '/app/profile': ALL,
}

// `/app/holdings/:id/edit` has to match `/app/holdings/HLD-KCC-000001/edit`.
// An exact-key lookup would miss it, and a path absent from the map is open —
// so the entry would have looked like a rule while enforcing nothing.
function matches(pattern, path) {
  if (!pattern.includes(':')) return pattern === path
  const want = pattern.split('/')
  const got = path.split('/')
  if (want.length !== got.length) return false
  return want.every((part, i) => part.startsWith(':') ? got[i] !== '' : part === got[i])
}

export function canAccess(path, user) {
  if (!user) return false
  // Longest pattern first, so a specific rule beats a general one and a literal
  // segment beats a parameter.
  const pattern = Object.keys(ROUTE_ACCESS)
    .filter((p) => matches(p, path))
    .sort((a, b) => b.split('/').filter((s) => !s.startsWith(':')).length
                  - a.split('/').filter((s) => !s.startsWith(':')).length)[0]
  if (!pattern) return true
  return ROUTE_ACCESS[pattern].includes(user.roleKey)
}

// Where to send a user who has no business on the page they asked for. The server
// supplies `home` per role; fall back to the first page they can actually open.
export function homeFor(user) {
  if (!user) return '/login'
  if (user.home && canAccess(user.home, user)) return user.home
  // Only real landing pages: sending somebody to a blank "register a building"
  // form because it happens to be the first thing they may open would be an
  // odd place to land.
  return Object.keys(ROUTE_ACCESS)
    .filter((path) => !path.includes(':') && !path.endsWith('/new'))
    .find((path) => canAccess(path, user)) || '/app/profile'
}
