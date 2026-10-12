# Smart Sweep SWMS — API reference

Django 5.2 + Django REST Framework on PostgreSQL 18. Every endpoint lives under
`/api/`. Interactive schema at `http://127.0.0.1:8000/api/docs/`, raw OpenAPI at
`/api/schema/` (a dump is checked in at [docs/api/openapi.yml](api/openapi.yml)).

A ready-to-run Postman collection covering all 226 requests is in
[docs/api/](api/) — see [Using the Postman collection](#using-the-postman-collection).

---

## Contents

- [Conventions](#conventions) — auth, errors, pagination, scoping, ids
- [Authentication](#authentication)
- [Catalog and reference data](#catalog-and-reference-data)
- [Setup: cities, geography and dumping points](#setup-cities-geography-and-dumping-points)
- [Holdings and households](#holdings-and-households)
- [Agencies and remittances](#agencies-and-remittances)
- [Door-to-door surveys](#door-to-door-surveys)
- [Users](#users)
- [Collectors](#collectors)
- [Routes and assignments](#routes-and-assignments)
- [The collection round](#the-collection-round)
- [The collection day: collected unless complained](#the-collection-day-collected-unless-complained)
- [Complaints](#complaints)
- [Billing, payments and cash](#billing-payments-and-cash)
- [Fleet](#fleet)
- [Live map and realtime](#live-map-and-realtime)
- [Reports and exports](#reports-and-exports)
- [Sweep AI](#sweep-ai)
- [Error codes](#error-codes)
- [Using the Postman collection](#using-the-postman-collection)

---

## Conventions

### Authentication

Bearer JWT on every request except the login endpoints:

```
Authorization: Bearer <access token>
```

Access tokens last **60 minutes**, refresh tokens **7 days**. When an access
token expires the server answers **401** with `code: "token_invalid"`; post the
refresh token to `/api/auth/refresh/` to get a new pair. Refresh tokens rotate
and the old one is blacklisted, so always store the refresh token the server
returns.

### Rate limits

Three scoped throttles, per client:

| Scope | Rate | Applies to |
|---|---|---|
| `otp` | 10/hour | `/auth/otp/request/`, `/auth/otp/verify/` |
| `pin` | 20/hour | `/auth/pin/login/` |
| `ai` | 30/hour | `/ai/ask/` |

Exceeding one answers **429** with `code: "throttled"` and a `detail` naming the
wait. During development this bites quickly — prefer PIN login
(`/auth/pin/login/`, 20/hour) over repeated OTP round trips when testing.

### The error envelope

**Every** failure has one shape, so a client has one thing to render:

```json
{
  "detail": "Some fields need attention.",
  "code": "domain_error",
  "fields": { "road": ["No such road in this ward."] }
}
```

`code` is a **stable key**, not prose — the UI maps it to a translated Bangla or
English string. `fields` is empty for whole-request failures and populated for
per-field validation errors. Do not parse `detail`; it is for humans and changes
with the language.

### Pagination

List endpoints answer:

```json
{ "count": 322, "page": 1, "pages": 7, "next": "…", "previous": null, "results": [...] }
```

`?page`, `?page_size` (max 5000). **`?page_size=all` returns a bare array**,
unpaginated — the React contexts use it for the small collections they hold
whole in memory (holdings, households, routes, collectors). Large tables
(visits, bills, payments) should stay paginated.

Every list also accepts `?search=` over that resource's search fields and
`?ordering=field` (prefix `-` to reverse).

### Ward scoping

**Scoping is applied on the server from the caller's role and cannot be widened
by a query parameter.** A viewset declares a `ward_scope_field` and the queryset
is filtered by the caller's visible wards. A ward supervisor asking for the
reconciliation report gets their wards whatever they pass; an agency admin gets
the city.

A **city-wide** account (`scopeKind: "city"`) with a `city` set sees only that
city's wards — that is how a City Viewer is confined to one city corporation or
pourashova. With no `city` it sees every city.

There is a second axis: an account bound to an **agency** sees only that
agency's holdings, routes, collectors, vans, bills and payments.

Two deliberate exceptions:

- **Deposits are not ward-scoped.** A cash hand-in is a fact about a collector
  and a month, not about a ward — scoping it would hide hand-ins from the very
  supervisor reconciling them.
- **Billing runs are not ward-scoped.** A run covers the whole city for a month.

### Ids are text and meaningful

`Holding.id` really is `HLD-KCC-000123` and `Route.id` is `RT-W-14-01`,
because field staff read those identifiers off building tags and the UI
displays them. Ids are allocated from a sequence table rather than a timestamp, so they
stay short and collision-free under concurrency.

| Resource | Pattern | Example |
|---|---|---|
| Holding | `HLD-KCC-…` | `HLD-KCC-000123` |
| Holding QR tag | `SS-…` | `SS-000123` |
| Household (occupant) | `HH-KCC-…` | `HH-KCC-0012840` |
| Potential customer | `POT-…` | `POT-3006` |
| Agency | `AGN-KCC-…` | `AGN-KCC-0001` |
| Collector | `C-…` | `C-042` |
| Route | `RT-<ward>-<n>` | `RT-W-14-01` |
| Assignment | `AS-<collector>` | `AS-C-042` |
| Visit | `V-…` | `V-000001` |
| Complaint | `CMP-…` | `CMP-20698` |
| Bill | `B-<period>-<holding>` | `B-2026-10-0000123` |
| Payment | `PAY-<period>-…` | `PAY-2026-07-00015` |
| Deposit | `DEP-<period>-…` | `DEP-2026-07-0002` |
| Remittance | `REM-<period>-…` | `REM-2026-10-0001` |
| Van | `VAN-KCC-…` | `VAN-KCC-017` |
| Maintenance | `MNT-…` | `MNT-3341` |
| Fuel log | `FUEL-…` | `FUEL-5521` |
| City | short code | `KCC` |
| Zone / Ward | supplied code | `Z-03` / `W-14`; a new city prefixes its own, e.g. `SCC-W22` |

Roads and dumping points use integer ids; tiers, city types, agency types and
the option lists use slugs (`residential_standard`, `city_corporation`, `cash`).

### Roles

| Role key | Label | May |
|---|---|---|
| `collector` | Collector | Their own round; record visits, take payments, work complaints in their ward, correct customer details, verify locations |
| `supervisor` | Supervisor | Full operational control within their zone's wards |
| `agency_admin` | Agency Admin | Everything **for one agency**: its staff, fleet, holdings, bills and users; bulk holding upload |
| `super_admin` | Super Admin | The corporation's administrator: every agency, plus setup (cities, zones, wards, type lists, dumping points, tiers) |
| `kcc_viewer` | City Viewer | Read-only oversight — the City Collection dashboard and reports. Confined to one city when the account has a `city` |

Write permissions are grouped: `OPERATIONAL_WRITERS` = supervisor + both admins;
`ADMIN_WRITERS` = agency admin + super admin; `SUPER_ADMINS` = super admin only
(setup data). Two endpoints deliberately depart from the grouping — see
[Billing](#billing-payments-and-cash).

---

## Authentication

Login is by **mobile number**, with either an SMS code or a 4-digit PIN.

### `GET /api/auth/pin/status/?phone=`

Does this number have a PIN, and is it locked out? The login screen calls this
first to choose between the PIN fast path and SMS. Unauthenticated.

```json
{ "phone": "01900445566", "known": true, "hasPin": true,
  "locked": false, "lockedUntil": null, "attemptsLeft": 5 }
```

### `POST /api/auth/otp/request/`

```json
{ "phone": "01900445566" }
```

Issues a 4-digit code. Throttled under the `otp` scope.

```json
{ "phone": "01900445566", "known": true, "hasPin": true,
  "pinLocked": false, "ttl": 300, "devCode": "9217" }
```

`known`, `hasPin` and `pinLocked` ride along so the login screen can branch
without a second round trip.

> **`devCode` is a demo affordance.** It appears only when
> `OTP_EXPOSE_CODE=True` **and** `DEBUG=True`, so it can never leak from a
> production build. With it off the code goes out by SMS and neither it nor the
> operator's identity appears in the response — returning the name would let
> anyone type a phone number and learn whose it is.

### `POST /api/auth/otp/verify/`

```json
{ "phone": "01900445566", "code": "9217" }
```

Returns the session:

```json
{
  "access": "eyJhbGciOi…",
  "refresh": "eyJhbGciOi…",
  "user": {
    "name": "Farhana Haque", "role": "Agency Admin", "roleKey": "agency_admin",
    "scope": "All zones", "scopeKind": "city", "scopeWards": [],
    "home": "/app/dashboard", "readOnly": false, "collector": null,
    "hasPin": true, "loginAt": "2026-07-29T09:14:02Z", "avatarUrl": null
  }
}
```

An **unknown number is provisioned** as a Collector-role "Field Operator", which
is how field staff are onboarded without a separate registration screen. A
successful OTP also **clears any PIN lockout** — OTP is the recovery path.

### `POST /api/auth/pin/login/`

```json
{ "phone": "01711000042", "pin": "1470" }
```

The fast path collectors use where mobile coverage is unreliable. Same response
body as OTP verification.

An unknown number and a wrong PIN **fail identically** (`wrong_pin`), so this
cannot be used to enumerate registered numbers. After `PIN_MAX_ATTEMPTS` misses
the account locks for `PIN_LOCKOUT_SECONDS` and answers `pin_locked`. Lockout is
enforced server-side, not in `localStorage` where a user could simply clear it.

### PIN management — `/api/auth/pin/`

| Method | Body | Effect |
|---|---|---|
| `POST` | `{"pin": "1470"}` | Set the signed-in operator's PIN |
| `PUT` | `{"currentPin": "1470", "pin": "2468"}` | Change it |
| `DELETE` | — | Remove it; the account falls back to OTP-only |

`seed_demo` sets every demo account's PIN to **`1470`** and prints it on
completion.

All three require a live access token. A PIN is set **after** an OTP sign-in,
never instead of one.

### `POST /api/auth/refresh/` · `POST /api/auth/logout/`

Refresh takes `{"refresh": "…"}` and rotates the pair. A dead token answers 401
in the app's envelope with `code: "token_invalid"` rather than SimpleJWT's own
shape.

Logout blacklists the refresh token and always answers `{"ok": true}` —
revoking an already-dead token is not an error.

### `GET` / `PATCH /api/auth/me/`

The session user, and self-service profile edit (`name`, `email`, `altPhone`,
`nid`, `bloodGroup`, `emergencyContact`, `avatar`). **Role and ward scope are
not writable here** — an agency admin sets those.

### `GET /api/auth/demo-operators/`

The four demo personas the login screen offers as shortcuts. Returns an empty
list when `DEBUG` is off — it would otherwise be an account-enumeration
endpoint.

---

## Catalog and reference data

### `GET /api/catalog/` — call this once after signing in

Everything the app needs for dropdowns, in one round trip:

```
cities · zones · wards · roadsByWard · districts · thanasByDistrict
tiers · bloodGroups · dumpingPoints · cityTypes · agencyTypes
customerTypes · holdingTypes · storageTypes · suitableTimes
paymentModes · potentialReasons · timeGaps · currentPractices
```

Every option row carries **both** `key` (the i18n key the Bangla dictionary
resolves) and `label` (the English fallback), because the frontend needs both.
A setup row added later may have no dictionary entry; show its `label` then.
Cities, zones, wards and dumping points carry `name` and `nameBn` — show
`nameBn` in Bangla when it is not empty. `roadsByWard` is
`{wardId: [roadName, …]}`. Only **active** rows are in the bundle.

### CRUD on the lists

`/api/zones/`, `/api/wards/`, `/api/roads/`, `/api/blocks/`, `/api/tiers/` —
standard REST, **super admin only for writes**. The setup lists that came with
multi-city support are described in the next section. Day-to-day the app reads
`/api/catalog/`.

Zone and ward ids are **supplied, not generated** — they appear on printed
material, and they are unique across every city. A ward carries `lat`/`lng`,
the centre the live map uses, and `active`.

> Changing a tier's `charge` does **not** restate bills already issued. A bill
> records the amount at the moment it was raised.

---

## Setup: cities, geography and dumping points

The service geography is **City → Zone → Ward → Block/Area → Road**, the same
administrative area a citizen app shows (City Corporation, Zone, Ward,
Address). A second city is new rows, not a second deployment. Everything here
is **super admin only for writes** and read by everyone signed in.

| Resource | Endpoint | Notes |
|---|---|---|
| Cities | `/api/cities/` | `id` (short code, e.g. `KCC`), `name`, `nameBn`, `cityType`, `district`, `lat`/`lng`, **`collectionCutoff`** (default `21:00`), **`complaintDeadline`** (default `12:00`, next day), `active`. Filter `city_type`, `active` |
| City types | `/api/city-types/` | Setup list: `city_corporation`, `pourashova`, … `{id, key, label, sortOrder, active}`. Add more without a release |
| Agency types | `/api/agency-types/` | Setup list: `private`, `ngo`, `cbo`, `cooperative`, `city_corporation` (in-house), `pourashova` (in-house), … |
| Zones | `/api/zones/` | `id`, `name`, `nameBn`, `city`. Filter `?city=` |
| Wards | `/api/wards/` | `id`, `name`, `nameBn`, `zone`, `city` (read-only, through the zone), `lat`/`lng`, `active`. Filter `?zone=`, `?zone__city=` |
| Blocks | `/api/blocks/` | Named divisions of a ward a surveyor walks. Filter `?ward=` |
| Dumping points | `/api/dumping-points/` | See below |

A type in use cannot be deleted (`PROTECT`); hide it with `active: false`
instead — it leaves the dropdowns and existing records keep it. An unknown type
id is refused with a field error.

### Dumping points

Where collected waste is taken.

```json
{ "name": "Rajbandh Landfill", "nameBn": "রাজবাঁধ ল্যান্ডফিল",
  "kind": "disposal_site", "city": "KCC", "wards": ["W-14", "W-15"],
  "lat": 22.79, "lng": 89.50, "capacityTonnes": 450, "active": true }
```

`kind` is `dumping_area` | `disposal_site` | `transfer_station`. A point serves
wards of **its own city** only — a ward from another city is refused under
`wards`. Filters: `city`, `kind`, `active`, `wards`.

---

## Holdings and households

**Every operation is holding-wise.** The service charge, the monthly bill, the
payment, the daily collection visit and the QR tag all belong to the
**holding** — the building. A **household** is a record of a family or unit
living in it, kept for the register and for the *households must equal units*
rule; it carries no money and no collection of its own.

A **potential customer** is a surveyed family not yet under service ("ghost
home"); converting one keeps the survey, so the funnel has history.

### `/api/holdings/`

Filters: `ward`, `zone`, `road`, `holdingType`, `status`, `verified`,
`located`, `serviceStatus` (`none` | `partial` | `full`), **`unitsMismatch`**
— plus `search` (holding no., owner, phone, road, district, thana, QR),
`ordering`, paging.

Fields:

| Group | Fields |
|---|---|
| Address | `district`, `thana`, `ward`, `road` (the road **name**; must exist in the ward), `holdingNo`, `address`, `holdingType`, `floors`, `unitsTotal` |
| Owner | `ownerName`, `ownerPhone`, `ownerAltPhone`, `ownerEmail` |
| Location | `lat`, `lng`, `accuracy`, `verified`, `verifiedAt`, `verifiedBy`, `placedByHand` — written only by `verify` |
| **Service charge** | `tier`, `charge` (0 = the tier's standard), `paymentMode`, `paymentDay` (1–28); read-only `effectiveCharge`, **`dues`** (from this holding's bills), **`qr`** (issued on create) |
| Derived | `routeId`, `serviceStatus`, `householdCount`, `activeHouseholdCount`, **`unitsMatch`** |
| Other | `agency`, `status`, `notes` |

A holding with no `tier` and no `charge` has not been signed up and is **not
billed**.

**Families on the same save.** `households` (write-only) is a list of family
rows; a row with an `id` updates that family (it must already belong to this
holding), a row without one creates it, and a family left out is **untouched**
— the list is never read as the complete set. `householdDefaults` supplies the
customer type, storage and collection time a new family falls back to.

**Households must equal units.** A holding may never have more **active**
households than `unitsTotal` — creating, editing, lowering `unitsTotal` or
adding a household that would exceed it is refused under `unitsTotal` (or
`holding` on `/households/`). Fewer is allowed — families are recorded over time
— and is flagged by `unitsMatch: false`; `?unitsMismatch=true` lists them.
`unitsMatch` is `null` when no unit count is declared. A household set inactive
frees its unit.

### `POST /api/holdings/{id}/verify/`

```json
{ "lat": 22.8452, "lng": 89.5405, "accuracy": 8, "placedByHand": false }
```

Confirms the building's GPS pin. **This is the gate for routing** — the server
refuses to put an unverified holding on a route. Latitude must be 20–27 and
longitude 87–93 (Bangladesh). `placedByHand: true` records that an office user
dropped the pin rather than a collector standing at the door.

### `GET /api/holdings/by-qr/{tag}/`

Resolves a building QR tag (`SS-…`) or holding id to the holding. During a
round use [`/api/collection/scan/`](#post-apicollectionscan) instead — that one
also answers whether the holding is on this collector's round today.

### `GET /api/holdings/unplanned/`

The route planner's to-do list: `{"routable": [...], "unverified": [...],
"total": 12}`.

### `GET /api/holdings/{id}/households/`

The families in the building.

### `POST /api/holdings/import/` — bulk upload from Excel or CSV

`multipart/form-data` with `file` (`.xlsx` or `.csv`, at most 5 MB and 5000
rows) and `commit` (`false` by default). **Admins only** (agency admin, super
admin).

| Column | Required | |
|---|---|---|
| Holding No | yes | |
| Name | yes | The owner |
| Mobile | | `01XXXXXXXXX`; `+880…` accepted |
| City | | Code or name; narrows the ward lookup |
| Ward | yes | Code (`W-14`), name, or number (`14`) |
| Area | yes | Road / mohalla in the ward — **a new one is added** |
| Address | | |
| Route | | Route code or name in the same ward; needs GPS |
| GPS Location | | `22.8456, 89.5403` — pins and verifies the building |
| Holding Type, Tier, Charge, Units, Agency | | Optional |

With `commit=false` every row is validated and nothing is written; with
`commit=true` the **valid rows are written in one transaction** and invalid ones
are skipped. A row matching an existing holding (ward + area + holding no.)
**updates** it. An agency admin can only import for their own agency.

```json
{ "dryRun": true,
  "summary": { "total": 3, "valid": 2, "invalid": 1, "toCreate": 1, "toUpdate": 1,
               "created": 0, "updated": 0 },
  "rows": [ { "row": 2, "holdingNo": "142/B", "name": "Abdul Karim", "ward": "W-14",
              "area": "KDA Avenue", "action": "create", "status": "ok",
              "errors": [], "warnings": [], "holding": null }, … ] }
```

A file that cannot be read at all (wrong type, missing columns, empty) fails
with `bad_import_file`.

`GET /api/holdings/import-template/` returns the `.xlsx` to fill in, with an
example row and a Notes sheet.

### `/api/households/`

Occupant records. Filters: `ward`, `zone`, `road`, `status`, `customer_type`,
`holding`, `verified`, `located`, `unplanned`.

Required on create: `holding`, `head`, `customerType`, `storage`,
`holdingType`, `suitableTime`. Address and pin are read through from the
holding. **No charge, payment, dues or QR fields** — those are the holding's.

### `/api/potential-customers/`

Survey records. Filters: `ward`, `zone`, `converted`, `reason`, `time_gap`,
`current_practice`, `verified`. Required on create: `holding`, the profile
fields, `estTier`, `surveyedAt`, `reason`, `timeGap`, `currentPractice`.

### `POST /api/potential-customers/{id}/convert/`

```json
{ "tier": "residential_standard", "charge": 0, "paymentMode": "cash", "paymentDay": 5 }
```

Creates the household in the holding and **puts the service terms on the
holding**. Every field is optional: a holding with no tier yet takes the survey's
`estTier`; one already under service keeps its terms unless new ones are sent.
Returns `{household, potential}`. Converting twice fails with
`already_converted`.

---

## Agencies and remittances

An **agency** is whoever collects the waste — the client's "customer": a
private contractor, an NGO, or the city's own in-house service.

### `/api/agencies/`

`name`, `nameBn`, `shortCode` (unique), `agencyType` (from the setup list),
**`city`**, `serviceWards`, registration (`tradeLicenceNo`, `registrationNo`,
`tin`, `bin`), contact, contract (`contractNo`, `contractStart`,
`contractEnd`), `status`, `active`, `notes`; derived `contractExpired`,
`collectorCount`, `holdingCount`. Filters: `status`, `active`, `city`, `ward`,
`agencyType`.

An agency serves wards of **its own city** only; moving an agency to another
city while it still has wards there is refused under `serviceWards`. One city
may have several agencies; one agency many wards and vans.

Writes are **super admin only** — registering a contractor is the
corporation's act.

| Endpoint | |
|---|---|
| `GET /agencies/{id}/collectors/` | Its collectors |
| `GET /agencies/{id}/employment-history/` | Who worked for it, when (`agencyName`, `agencyNameBn`, `fromDate`, `toDate`) |
| `POST /collectors/{id}/transfer/` | `{"agency": "AGN-…", "onDate": "2026-06-01"}` — moves a collector and keeps the history |

### Remittances — agency to corporation

`POST /api/remittances/record/`

```json
{ "agency": "AGN-KCC-0002", "period": "2026-10", "method": "bank",
  "amount": 120000, "ref": "TT-55821", "note": "" }
```

**Super admin only.** Several in a month are normal (each bank transfer is its
own document). `GET /api/remittances/cash-position/?period=YYYY-MM[&agency=]`
— collected → deposited → remitted, per agency. Rows carry `agencyName` and
`agencyNameBn`.

---

## Door-to-door surveys

`/api/survey-forms/` — the questionnaire definitions; `GET
/survey-forms/published/` lists the ones in use.

`/api/surveys/` — completed questionnaires. Filters: `form`, `ward`, `block`,
`surveyor`, `status`, `synced`, `gives_to_van`.

| Endpoint | |
|---|---|
| `POST /surveys/` | Record one questionnaire (answers per question) |
| `POST /surveys/bulk/` | A device's offline queue; per-row outcomes |
| `POST /surveys/{id}/sync/` | Acknowledge a queued record |
| `POST /surveys/{id}/review/` | `{"status": "reviewed" \| "rejected", "notes": "…"}` — nothing is promoted to the register before review |
| `GET /surveys/{id}/convert-preview/` | What converting would create: matched road, suggested holding type, owner, units, and any existing holding at that address |
| `POST /surveys/{id}/convert/` | **Agency admin only.** Puts a reviewed survey on the register as a holding |

---

## Users

`/api/users/` — operator accounts. **Admins only, for reading too** (the list
is every operator's phone number, national ID and next of kin).

`phone`, `name`, `role`, `scopeKind` (`ward` | `zone` | `agency` | `city`),
`scopeZone`, `scopeWards`, `agency`, **`city`**, `collector`, contact fields,
`isActive`, `password` (write-only; required on create). An admin cannot change
their own role, scope, agency, city or active flag.

A **City Viewer** is `role: "kcc_viewer"` with `scopeKind: "city"` and a
`city` — it then sees only that city, and lands on the City Collection
dashboard.

`POST /users/{id}/deactivate/` · `POST /users/{id}/activate/`. There is no
delete: visits, payments and complaints point at the user who recorded them.

---

## Collectors

`/api/collectors/` — DSP field staff. Filters: `ward`, `zone`, `status`
(`on_route` | `idle` | `off_route`), `attendance` (`checked_in` | `absent`),
`hasVan`, `active`.

Rows carry live `complaints`, `vanId` and `assignmentId` alongside the licensing
and performance fields.

> **`zone` on a collector holds a ward id.** The field keeps its
> JavaScript-era name so the frontend contract did not have to change when the
> backend arrived. It is a ward, not a zone.

### `POST /api/collectors/{id}/attendance/`

```json
{ "attendance": "checked_in" }
```

Depot check-in or absence for today.

### `POST /api/collectors/refresh-metrics/`

```json
{ "days": 30 }
```

Recomputes `coverage` and `onTime` for **every** collector from the visit log.

> **Agency admin only.** The figures feed staff reviews, so a supervisor cannot
> recalculate their own team's numbers on demand. A collector calling this gets
> 403 `permission_denied`.

---

## Routes and assignments

A **route** is an ordered walk through a ward. An **assignment** says who walks
which routes.

### `/api/routes/`

Filters: `ward`, `zone`, `collector`, `unassigned`, `active`.

Create with `name`, `ward`, `windowStart`, `windowEnd`, `stops`. **`stops`
are holding ids** — a stop is a building — and every one must have a verified
location and sit in the route's ward, or the request fails naming it.

### Stop-list edits

These are actions rather than field writes because each enforces a rule:

| Endpoint | Body | Behaviour |
|---|---|---|
| `POST /routes/{id}/stops/` | `{"stops": ["HLD-…", "HLD-…"]}` | **Replaces the whole ordered list in one call**, so a drag-reorder is atomic — the route is never briefly half-ordered. Use this when the user reorders |
| `POST /routes/{id}/add-stop/` | `{"hh": "HLD-…"}` (the key is still `hh`; the value is a holding id) | Appends to the end. A holding already on another route **moves** here rather than being refused — that is what dragging it across routes means |
| `POST /routes/{id}/remove-stop/` | `{"hh": "HLD-…"}` | Removes it and **closes the gap in the numbering** |

### `POST /assignments/{id}/routes/`

```json
{ "routes": ["RT-W-14-01", "RT-W-14-02"] }
```

Sets the routes this assignment covers. A route already held by somebody else is
**taken over** — the planner allows reassigning, and the conflicting link is
dropped rather than raising a conflict.

---

## The collection round

What a collector's device talks to.

### `GET /api/collection/round/?collector=&day=`

Everything the round screen renders in one call:

```json
{
  "day": "2026-07-29",
  "collector": "C-042",
  "stops": [ { "holding": "HLD-KCC-000123", "holdingNo": "142/B", "seq": 1,
               "qr": "SS-000123", "head": "<owner>", "phone": "<owner phone>",
               "road": "…", "ward": "W-14", "units": 4,
               "lat": 22.8452, "lng": 89.5405, "accuracy": null,
               "routeId": "RT-W-14-01", "routeName": "…",
               "visitId": null, "visitStatus": "pending", "synced": null,
               "tier": "…", "dues": 0, "at": null, "by": null } ],
  "counts": { "all": 5, "collected": 0, "skipped": 0, "pending": 5 },
  "routes": [ … ]
}
```

`day` defaults to today. **One stop per holding** — one scan, one visit,
however many families live there; `units` is how many active families that is.
`stops` are in walking order; `counts` drives the screen's three tabs; `routes`
supplies the headings.

> **A collector-role caller is pinned to their own round** whatever they pass —
> a round names holdings, owners' phone numbers and what they owe. Verified live: the Ward 14
> collector requesting `?collector=C-058` gets **200 with their own C-042
> round**, not a 403. Supervisors and admins may look in on anyone, which is how
> a round gets reviewed from a desk.

### `POST /api/collection/scan/`

```json
{ "raw": "SWMS|HLD-KCC-000123|SS-000123", "collector": "C-042", "day": "2026-07-29" }
```

Resolves a building QR payload (`SWMS|<holding id>|<tag>`, a bare `SS-…` tag
or a `HLD-…` id) against the round. **Answers 200 in every case** — a
wrong-round or worn-label scan is something the collector acts on, not a failed
request. The four failures are distinct on purpose:

| Response | Meaning | What the collector does |
|---|---|---|
| `{"ok": true, "stop": {…}}` | A stop on this round | Collect it |
| `{"ok": false, "reason": "alreadyCollected", "stop": {…}}` | Already recorded today | Nothing — this stops a double entry |
| `{"ok": false, "reason": "otherRoute", "holding": {…}}` | Belongs to a different round | A mistake fixable on the spot |
| `{"ok": false, "reason": "unknown", "code": "…"}` | Unregistered or damaged tag | Needs the office |
| `{"ok": false, "reason": "unreadable"}` | The camera got nothing | Re-scan |

`collector` and `day` matter when a supervisor previews someone else's round;
for a collector-role caller the server pins both.

### `POST /api/visits/` — record a collection or a skip

```json
{ "holding": "HLD-KCC-000123", "collector": "C-042", "status": "collected",
  "at": "2026-07-29T07:12:00Z", "source": "scan",
  "lat": 22.8452, "lng": 89.5405, "accuracy": 6, "note": "" }
```

`status` is `collected` or `skipped`; a skip needs a `reason`. `source` is
`scan` or `manual` (`auto` is written only by the day's cut-off — see below).

> **One visit per holding per day**, enforced by a unique constraint on
> `(holding, served_on)`. Re-posting for the same day **updates that row**
> rather than inserting a second one — which is exactly what correcting a skip
> to a collection, and the offline queue, rely on.

The tag and route are taken from the plan, not from the request, and the live
map is notified.

### `POST /api/visits/bulk/` — flush the offline queue

```json
{ "rows": [ { "holding": "HLD-…", "status": "collected", "at": "…", … },
            { "holding": "HLD-…", "status": "skipped", "reason": "locked", … } ] }
```

What a device uploads when it regains connectivity.

> **Answers with per-row outcomes rather than one status code.** The device has
> to know which rows it may drop and which to keep retrying, so a single bad row
> never rejects the batch.

`POST /api/visits/{id}/sync/` acknowledges that a queued record reached the
server. Visit filters: `holding`, `collector`, `route`, `ward`, `day`,
`dateFrom`, `dateTo`, `status`, `source`, `synced`.

---

## The collection day: collected unless complained

Agencies may confirm a holding by QR, app or web, but nobody has to. At the
city's **`collectionCutoff`** (default 21:00) every holding on an active route
with no visit yet is written a visit with `source: "auto"`:

- **collected**, if no missed-collection complaint names that day;
- **skipped, `reason: "complaint"`**, if one does.

A complaint arriving the next morning, before the city's
**`complaintDeadline`** (default 12:00), may still name yesterday and turns that
holding's auto visit into a missed one. A visit the agency confirmed itself (QR
scan, app, web) is never overwritten.

The close is run by a management command, which the server's scheduler calls
every 15 minutes. It is safe to repeat:

```
python manage.py close_collection_day [--city KCC] [--date YYYY-MM-DD] [--dry-run]
```

Without `--date` it closes yesterday (in case the server was down) and, once
past the cut-off, today. Each close — and each late complaint — rebuilds a
**daily summary** per city, ward and agency (`due`, `confirmed`, `auto`,
`missed`, `skipped`, `complaints`) that the
[City Collection report](#get-apireportscity-collection) reads.

---

## Complaints

Ticket lifecycle with SLA timers, an immutable audit trail and photo evidence.

### `GET /api/complaints/`

Filters: `status`, `priority`, `type`, `channel`, `assigned`, `holding`,
`household`, `ward`, `zone`, `active`, `breached`, `opened_after`,
`opened_before`.

Rows carry the derived `slaState`, `priorityRank` and `nextStatus`, plus
`holdingNo`, `road`, and `head`/`phone` (the reporting household's when there
is one, else the holding owner's), so the list needs no second lookup.

`type`: `missed_collection` | `overflow` | `billing_dispute` | `staff_behaviour`
| `other`.
`channel`: `sms` | `app` | `phone` | `counter`.
`priority`: `urgent` | `high` | `medium` | `low`.
`status`: `open` | `assigned` | `in_progress` | `resolved` | `closed`.

### `POST /api/complaints/`

```json
{ "holding": "HLD-KCC-000123", "household": "HH-KCC-0012840",
  "type": "missed_collection", "missedOn": "2026-10-10",
  "channel": "phone", "priority": "high", "description": "…", "note": "…" }
```

A complaint is about a **holding** (required, unless `household` is given — then
it is that family's holding). `household` is optional: which family reported it;
it must live in the holding (`household_not_in_holding`). `note` is
**write-only** — it becomes the first entry in the audit trail. `sla` defaults
from the priority.

For `missed_collection`, **`missedOn`** names the day missed: today by default,
or yesterday until the city's complaint deadline (`missed_on_too_late`,
`missed_on_out_of_range`). If that day has already closed, the holding's auto
visit becomes "not collected" immediately. `holding`, `household` and
`missedOn` cannot be changed afterwards.

### Lifecycle actions

> **`status` is not a writable field.** Each move is its own endpoint, and each
> one appends an immutable `ComplaintActivity` row, so a ticket cannot change
> hands without a trail. `PATCH` edits details only.

| Endpoint | Body | Effect |
|---|---|---|
| `POST /{id}/assign/` | `{"assigned": "C-042", "note": "…"}` | Hand over — or `"assigned": null` back to the pool |
| `POST /{id}/advance/` | `{"note": "…"}` | One step along the lifecycle. Read `nextStatus` to know where it lands |
| `POST /{id}/priority/` | `{"priority": "urgent", "note": "…"}` | Re-grade. **The SLA budget follows** — this changes the clock |
| `POST /{id}/resolve/` | `{"note": "…"}` | Resolve, recording how, and stop the clock |
| `POST /{id}/reopen/` | `{"note": "…"}` | The citizen says it is not fixed. Restart the clock |
| `POST /{id}/note/` | `{"note": "…"}` | Append to the trail without changing the ticket |

Write roles here are `OPERATIONAL_WRITERS | {COLLECTOR}` — **a collector may run
every action above**, not only `note`, because they progress the jobs on their
own round. Ward scoping already prevents them reaching another ward's tickets. A
KCC viewer is refused with `permission_denied`.

### `POST /api/complaints/{id}/photos/`

`multipart/form-data` with any number of `images` parts and an optional
`caption` — the collector app posts several at once from the camera roll.

> **Every file is validated before the first one is stored**, so a rejected
> batch leaves nothing behind.

### `GET /api/complaints/summary/`

KPI counts honouring the same filters as the list, so *"breached tickets in Ward
14 this month"* is one request rather than downloading the rows and counting
them in the browser.

```json
{ "total": 6, "active": 3, "settled": 3, "breached": 3, "urgent": 1,
  "byStatus": {…}, "byPriority": {…}, "byType": {…},
  "medianResolutionHours": 6.2, "resolvedCount": 3 }
```

---

## Billing, payments and cash

Three access rules shape this module, and they are deliberately different from
each other:

- **Only an admin (agency admin or super admin) issues charges.** A supervisor
  collects, but cannot invent a bill.
- **Collectors record payments**, because they are the people who take the money
  at the door.
- **Only an admin voids one**, because that is the single operation that can
  make money on record disappear.

### The central rule

> **Recording a payment is the only way a bill's status changes.**
>
> The mock UI could flip a bill to "paid" without writing a payment row, which
> is why its totals disagreed with its own reports. `Bill.status` is now a cache
> that `Bill.recalculate()` derives from the payments that actually exist, and
> `Holding.dues` follows from that.

Consequently, **filter on `settlement`, not `status`**. `status` is only ever as
fresh as the last `recalculate()`; `settlement` is derived in SQL from the
annotated payment total, so it can never disagree with the `received` and
`outstanding` figures shown beside it.

### `GET /api/bills/`

**One bill per holding per month.** Rows carry `holding`, `holdingNo` and
`head` (the holding owner). Filters: `period`, `holding`, `ward`, `zone`,
`run`, `status`, **`settlement`**, `hasOutstanding`.

Each row carries `received`, `outstanding` and `settlement`, computed from the
payments that exist — one subquery for the whole page, not one query per row.

### `POST /api/bills/generate/` — the billing run

```json
{ "period": "2026-07", "issuedOn": "2026-07-01", "dueDays": 10, "dryRun": true }
```

**Admins only.** Bills every **active holding that is on a route and has a
charge** (its `effectiveCharge`). With `dryRun: true` it returns the same
summary without writing anything (200); with `false` it issues the bills and
writes a `BillingRun` audit row (201).

```json
{ "period": "2026-08", "issuedOn": "2026-08-01", "dueOn": "2026-08-11",
  "created": 23, "skipped": 0, "amount": 6100,
  "dryRun": true, "billCount": 23, "totalAmount": 6100 }
```

Always dry-run first — there is no bulk undo. Re-running a period does not
double-charge; existing bills for the month are counted in `skipped`.

### `POST /api/bills/` is blocked on purpose

Answers **400 `use_billing_run`** for everyone but a superuser:

```json
{ "detail": "Bills are issued by a billing run. POST /api/bills/generate/ instead.",
  "code": "use_billing_run", "fields": {} }
```

A hand-made bill would have no `run`, so the month's `BillingRun` totals would
stop describing the month, and a holding could quietly end up charged twice
for reasons no audit trail explains. The superuser escape hatch exists for
backfilling a month the run missed.

### `POST /api/bills/{id}/pay/`

```json
{ "amount": 100, "method": "cash", "collector": "C-042",
  "at": "2026-07-29T09:14:02Z", "reference": "", "note": "" }
```

Returns the **restated** bill. Partial payments are normal — post several and
the bill moves unpaid → partial → paid on its own.

`collector` defaults to the signed-in collector and is left empty at the office
counter. **That difference is what makes the cash reconciliation meaningful**:
money attributed to a collector is money they must later hand in.

### `GET /api/payments/`

Filters: `period`, `collector`, `holding`, `bill`, `method`, `undeposited`,
`at_after`, `at_before`. A payment's `holding` is always its bill's.

> **A payment's `period` is the month it was *taken* in, in local time — not the
> month its bill covers.** A July bill settled in August is money received in
> August, and keeping the two apart is what makes a collection lag visible
> instead of invisible.

`?undeposited=true` is money a collector has taken but not yet handed in.

### `POST /api/payments/{id}/void/`

**Agency admin only.** Removes a mis-keyed payment and restates the bill from
what remains, returning the restated bill. Payments are otherwise immutable:
correct one by voiding it and re-recording.

### Deposits — collector cash hand-ins

`POST /api/deposits/record/`

```json
{ "collector": "C-042", "period": "2026-07", "method": "cash",
  "amount": 4500, "at": "…", "ref": "Depot slip 2291" }
```

**Upserts** this collector's hand-in for the month and links the payments it
covers. Posting again for the same collector and month updates the existing row.

`GET /api/deposits/cash-position/?period=YYYY-MM` — collected vs deposited vs
variance, per collector. Omitting `period` fails with `period_required`.

### `GET /api/billing-runs/`

The audit list, written by `generate`. Creating one directly fails with
`use_billing_run`.

---

## Fleet

`/api/vans/` — filters `status`, `type`, `fuel`, `ownership`, `driver`,
`unassigned`. Rows carry derived `expiringDocuments` and `serviceDueInKm`.

A van has a **`ward`** it works and a **`dumpingPoint`** it unloads at (from
[setup](#dumping-points)). The dumping point must be in the ward's city, or the
save is refused under `dumpingPoint`.

`type`: `compactor` | `pickup` | `rickshaw-van` | `tricycle`.
`fuel`: `diesel` | `petrol` | `cng` | `electric`.
`status`: `active` | `in_maintenance` | `idle` | `retired`.

### `POST /api/vans/{id}/assign-driver/`

`{"driver": "C-042"}` — or `null` to clear. **Releases the driver from any other
van**, so one person never appears to drive two.

### Telemetry

| Endpoint | Accepts |
|---|---|
| `POST /api/vans/{id}/position/` | **One** ping. The van comes from the URL, so the body does not repeat it. Posting an array fails with `single_ping_only` |
| `POST /api/positions/ingest/` | One ping **or an array** — where a tracker gateway posts. A device coming back from a dead spot flushes its whole queue in a single request, far cheaper than one round trip per stored point |

Both fan the position out to every live-map client over the websocket.

### Maintenance

`POST /api/maintenance/` — **opening a job may take the van off the road**: its
status moves to `in_maintenance` and it stops being available to assign.

`POST /api/maintenance/{id}/close/` — `{"closed": "…", "cost": 7800,
"downtime": 6.5}`. Signs the job off, computes downtime and **frees the van**.
Omit `downtime` to have it computed from the open and close timestamps.

### `GET /api/vans/alerts/` · `GET /api/vans/kpis/`

Expiring paperwork and service-due warnings, computed against **today**; and the
page's stat cards (availability, downtime, efficiency, spend).

---

## Live map and realtime

### `GET /api/live/`

Everything the map draws on first paint:

```json
{ "at": "…", "centre": {…}, "counts": { "vans": 5, "tracked": 3, "live": 3, "holdings": 34 },
  "vans": [...], "holdings": [ { "id": "HLD-…", "holdingNo": "142/B", "lat": …, "lng": …,
  "verified": true, "dues": 0, "ward": "W-14" } ] }
```

Pins are **holdings**: collection and dues are holding-wise.

### `ws://…/ws/live/`

One websocket carries every operational event the map and dashboard care about.
Authentication is by JWT (see `swms/common/ws_auth.py`); an unauthenticated
connection is closed with code **4401**.

On connect the server sends `{"event": "ready", "payload": {"role": "…"}}`.
Frames then arrive as:

```json
{ "event": "vehicle.position", "payload": { … }, "at": "2026-07-28T09:14:02Z" }
```

| Event | Emitted when |
|---|---|
| `vehicle.position` | A GPS ping is accepted |
| `visit.recorded` | A collection or skip is recorded |
| `complaint.opened` | A ticket is raised |
| `complaint.updated` | A ticket moves along its lifecycle |
| `collector.status` | A collector's state changes |

The only client message is a keepalive: send `{"event": "ping"}`, receive
`{"event": "pong"}`.

> **A dropped map update never fails the write that produced it.** Broadcast
> failures are swallowed and logged.

Clients that cannot use websockets fall back to polling `/api/live/`.

`manage.py runserver` speaks ASGI (daphne is first in `INSTALLED_APPS`), so the
websocket works without a separate process. Multi-process realtime needs
`REDIS_URL`; blank means an in-memory layer, single process only.

---

## Reports and exports

Every report is a `GET` returning JSON by default and a **file** when
`?format=csv|xlsx|pdf` is supplied — the same rows either way, so an exported
sheet can never disagree with the screen it came from.

All of them are ward-scoped to the caller, applied on the server rather than
trusted from a query parameter.

| Endpoint | Parameters | Returns |
|---|---|---|
| `/reports/dashboard/` | `period`, `trendDays` | `kpis`, `collectionTrend`, `wasteByZone`, `wardCollection`, `complaints`, `funnel` — everything the Dashboard renders, in one round trip |
| `/reports/kpis/` | `period` | The six-figure scorecard; coverage is `coveredHoldings` of `activeHoldings` |
| `/reports/waste-collection/` | `mode`, `from`, `to`, `collector`, `overall`, `format` | Rounds walked per period and collector, cover work called out |
| `/reports/service-series/` | `days`, `end`, `format` | Day-by-day scheduled / served / skipped / billed / collected |
| `/reports/ward-collection/` | `period`, `format` | Per-ward holdings, households, scheduled and served holdings, revenue |
| `/reports/bill-collection/` | `mode`, `from`, `to`, `overall`, `format` | Billed against received |
| `/reports/bill-status/` | `period`, `format` | Paid / partial / unpaid / overdue per collector |
| `/reports/customer-collection/` | `mode`, `from`, `to`, `holding`, `format` | Per holding — the "who has not paid" list (`holding`, `holdingNo`, `head` = owner) |
| `/reports/customer-bill-status/` | `period`, `format` | One row per bill, settlement derived |
| `/reports/reconciliation/` | `period`, `format` | Service vs revenue, cash taken vs handed in |
| `/reports/waste-by-zone/` | `period` | Estimated tonnage per zone |
| `/reports/complaint-summary/` | `period` | Ticket counts |
| `/reports/customer-funnel/` | — | Survey-to-customer conversion |
| `/reports/city-collection/` | `city`, `mode`, `from`, `to`, `format` | One city's collection — see below |

`mode` is `daily` | `weekly` | `monthly` | `yearly`. `period` is `YYYY-MM` and
must look like it — anything else fails with `bad_period`. `overall=true`
collapses to one row per period, dropping the collector column.

The dashboard bundle exists because the panels must be **consistent with each
other**: they are all computed from the same ward scope at the same instant.

### `GET /api/reports/city-collection/`

The City Corporation dashboard: one city's collection, keeping the three kinds
of "collected" apart — **confirmed** by the agency, **auto** at the cut-off,
**missed** by complaint.

```json
{ "city": { "id": "KCC", "name": "…", "nameBn": "…", "cutoff": "21:00", "complaintDeadline": "12:00" },
  "cities": [ … ],
  "today": { "date": "2026-10-11", "closed": false, "cutoff": "21:00",
             "due": 22, "confirmed": 5, "skipped": 0, "pending": 17, "complaints": 1 },
  "totals": { "due": 660, "confirmed": 120, "auto": 520, "missed": 20, "skipped": 0,
              "complaints": 21, "collected": 640, "collectedPct": 97, "confirmedPct": 18, "missedPct": 3 },
  "rows": [ { "period": "2026-10-01", … } ],
  "byAgency": [ { "agency": "AGN-…", "agencyName": "…", "agencyNameBn": "…", … } ],
  "byWard": [ { "ward": "W-14", "wardName": "…", … } ],
  "mode": "daily", "from": "2026-09-12", "to": "2026-10-11", "daysClosed": 30 }
```

Closed days come from the daily summary; `today` is counted live until its
cut-off. A City Viewer with a `city` always gets that city (`city` is ignored
and `cities` is empty); others may pick any city holding a ward they can see
(`no_city` otherwise). `from` defaults to 30 days, 12 weeks, a year or three
years back, by `mode`; `from` after `to` fails with `bad_range`. `format`
exports the period rows.

### Two things worth knowing

> **Tonnage is labelled as estimated.** Nothing weighs the waste.
> `waste-by-zone` multiplies each collected holding by its active families'
> per-customer-type averages and returns `"estimated": true` on **every** row. Show it as an estimate wherever
> it appears.

> **The reconciliation report's exception lists are the point of it.** An export
> flattens the cash rows into the sheet and returns the exceptions alongside in
> the JSON body, rather than dropping them.

---

## Sweep AI

### `POST /api/ai/ask/`

```json
{ "question": "How many complaints are breached?" }
```

```json
{ "answer": "3 complaints are open, 3 past SLA.",
  "go": "/app/complaints", "goLabel": "Open complaints", "source": "rules" }
```

Answers from a live, **ward-scoped** snapshot of the database. `go` is a
suggested destination the panel offers as a link — navigation is opt-in, not
automatic.

`source` tells you which engine answered: `claude` when `ANTHROPIC_API_KEY` is
configured, `rules` when it is not. **The endpoint works either way** — without
a key it falls back to rule-based answers rather than failing.

### `GET /api/ai/facts/`

The exact snapshot the assistant reasons over, returned as `{engine, model,
facts}`. Exposed so the UI can show the same numbers the assistant quotes — and
so its answers are auditable.

---

## Error codes

`code` is stable and translatable. The ones worth handling explicitly:

| Code | Status | Meaning |
|---|---|---|
| `token_invalid` | 401 | Access or refresh token expired — refresh, then retry |
| `permission_denied` | 403 | The role may not do this |
| `domain_error` | 400 | A rule of the domain was violated; read `detail` |
| `conflict` | 409 | Database constraint — usually a duplicate |
| `use_billing_run` | 400 | Bills come from `POST /bills/generate/` |
| `already_converted` | 400 | This survey is already a household / holding |
| `holding_required` | 400 | A complaint must name a holding |
| `household_not_in_holding` | 400 | The reporting household does not live in that holding |
| `missed_on_too_late` | 400 | Yesterday can only be reported until the city's complaint deadline |
| `missed_on_out_of_range` | 400 | A missed collection can only name today or yesterday |
| `unknown_holding` | 400 | No such holding (recording a visit) |
| `no_city` | 400 | No city visible to report on, or the one asked for is not visible |
| `bad_range` | 400 | `from` is after `to` |
| `file_required` | 400 | Bulk upload sent no file |
| `bad_import_file` | 400 | The upload cannot be read: wrong type, empty, too large or missing columns |
| `period_required` | 400 | A `?period=YYYY-MM` is needed |
| `bad_period` | 400 | `period` must look like `2026-07` |
| `bad_date` | 400 | A date must look like `2026-07-27` |
| `bad_number` | 400 | A numeric parameter was not a whole number |
| `bad_format` | 400 | `format` must be `csv`, `xlsx` or `pdf` |
| `single_ping_only` | 400 | Use `/positions/ingest/` for a batch |
| `wrong_pin` | 400 | Wrong PIN, or unknown number — the two are indistinguishable by design |
| `pin_locked` | 400 | Too many misses; wait out `PIN_LOCKOUT_SECONDS` or sign in by OTP |
| `no_pin` | 400 | No PIN set on this account |
| `account_disabled` | 400 | The account is inactive |

Field-level validation failures answer 400 with `code: "domain_error"` (or
`invalid`) and a populated `fields` map.

---

## Using the Postman collection

**Files**

| File | What it is |
|---|---|
| [`docs/api/SmartSweep-SWMS.postman_collection.json`](api/SmartSweep-SWMS.postman_collection.json) | 226 requests in 15 folders, one per module |
| [`docs/api/SmartSweep-SWMS.postman_environment.json`](api/SmartSweep-SWMS.postman_environment.json) | `baseUrl`, demo phone, PIN, token slots |
| [`docs/api/openapi.yml`](api/openapi.yml) | The generated OpenAPI 3.0.3 schema |

**Import** both JSON files into Postman (*Import → Files*), then select the
**Smart Sweep — Local** environment.

**Sign in.** Start the backend, then run, in order:

1. `00 · Auth & session → 1 · Request login code (OTP)` — with `DEBUG=True` and
   `OTP_EXPOSE_CODE=True` the response carries `devCode`, and the test script
   captures it into `{{otpCode}}`.
2. `2 · Verify code → JWT pair` — captures `accessToken`, `refreshToken`,
   `roleKey` and, for a collector, `collectorId`.

Every other request then authorises automatically from the collection-level
Bearer token. When one answers 401 `token_invalid`, run **Refresh access
token**.

**Switch personas** by changing `{{phone}}` and re-running the two OTP requests:

| Phone | Role | Scope |
|---|---|---|
| `01711000042` | Collector | Ward 14 |
| `01700112233` | Supervisor | Zone 03 |
| `01900445566` | Agency Admin | All zones |
| `01800778899` | City Viewer | City-wide |

Re-running as a different role is the quickest way to see ward scoping and the
permission rules in action — the same `GET /api/holdings/` returns every holding
for the agency admin and only Ward 14's for the Ward 14 collector.

**Variables** are pre-filled with ids that exist in the `seed_demo` dataset
(`holdingId`, `cityId`, `agencyId`, `routeId`, `billId`, `complaintId`, `vanId`,
`qrTag` …), so most requests run as-is. `{{today}}`, `{{period}}` and `{{nowIso}}` are refreshed
before every request by a collection pre-request script, so example bodies never
go stale.

A collection-level test script prints the error envelope's `code` and `detail`
to the Postman console on any 4xx, so you rarely need to open the response body
to see what went wrong.

**Two requests are documented refusals** and are expected to fail: *Create bill
directly* (`use_billing_run`) and, when run as a non-admin, *Recalculate
performance metrics* (`permission_denied`). They are in the collection because
the refusal is part of the contract.
