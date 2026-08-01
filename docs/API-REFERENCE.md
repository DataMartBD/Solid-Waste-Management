# Smart Sweep SWMS — API reference

Django 5.2 + Django REST Framework on PostgreSQL 18. Every endpoint lives under
`/api/`. Interactive schema at `http://127.0.0.1:8000/api/docs/`, raw OpenAPI at
`/api/schema/` (a dump is checked in at [docs/api/openapi.yml](api/openapi.yml)).

A ready-to-run Postman collection covering all 148 requests is in
[docs/api/](api/) — see [Using the Postman collection](#using-the-postman-collection).

---

## Contents

- [Conventions](#conventions) — auth, errors, pagination, scoping, ids
- [Authentication](#authentication)
- [Catalog and reference data](#catalog-and-reference-data)
- [Customers](#customers)
- [Collectors](#collectors)
- [Routes and assignments](#routes-and-assignments)
- [The collection round](#the-collection-round)
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
whole in memory (households, routes, collectors). Large tables (visits, bills,
payments) should stay paginated.

Every list also accepts `?search=` over that resource's search fields and
`?ordering=field` (prefix `-` to reverse).

### Ward scoping

**Scoping is applied on the server from the caller's role and cannot be widened
by a query parameter.** A viewset declares a `ward_scope_field` and the queryset
is filtered by the caller's visible wards. A ward supervisor asking for the
reconciliation report gets their wards whatever they pass; an agency admin or
KCC viewer gets the city.

Verified live: signed in as the agency admin, `GET /api/households/` counts 28
rows; as the Ward 14 collector, 8.

Two deliberate exceptions:

- **Deposits are not ward-scoped.** A cash hand-in is a fact about a collector
  and a month, not about a ward — scoping it would hide hand-ins from the very
  supervisor reconciling them.
- **Billing runs are not ward-scoped.** A run covers the whole city for a month.

### Ids are text and meaningful

`Household.id` really is `HH-KCC-0012840` and `Route.id` is `RT-W-14-01`,
because field staff read those identifiers off bin stickers and the UI displays
them. Ids are allocated from a sequence table rather than a timestamp, so they
stay short and collision-free under concurrency.

| Resource | Pattern | Example |
|---|---|---|
| Household | `HH-KCC-…` | `HH-KCC-0012840` |
| Potential customer | `POT-…` | `POT-3006` |
| Collector | `C-…` | `C-042` |
| Route | `RT-<ward>-<n>` | `RT-W-14-01` |
| Assignment | `AS-<collector>` | `AS-C-042` |
| Visit | `V-…` | `V-000001` |
| Complaint | `CMP-…` | `CMP-20698` |
| Bill | `B-<period>-…` | `B-2026-07-0009050` |
| Payment | `PAY-<period>-…` | `PAY-2026-07-00015` |
| Deposit | `DEP-<period>-…` | `DEP-2026-07-0002` |
| Van | `VAN-KCC-…` | `VAN-KCC-017` |
| Maintenance | `MNT-…` | `MNT-3341` |
| Fuel log | `FUEL-…` | `FUEL-5521` |
| Zone / Ward | `Z-…` / `W-…` | `Z-03` / `W-14` |

Roads, tiers and the option lists use integer or slug ids (`170`,
`residential_standard`, `cash`).

### Roles

| Role key | Label | May |
|---|---|---|
| `collector` | Collector | Their own round; record visits, take payments, work complaints in their ward, correct customer details, verify locations |
| `supervisor` | Supervisor | Full operational control within their zone's wards |
| `agency_admin` | Agency Admin | Everything, including staff, fleet, tiers and billing runs |
| `kcc_viewer` | KCC Viewer | Read-only, city-wide |

Write permissions are grouped: `OPERATIONAL_WRITERS` = supervisor + agency
admin; `ADMIN_WRITERS` = agency admin only. Two endpoints deliberately depart
from the grouping — see [Billing](#billing-payments-and-cash).

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
zones · wards · roadsByWard · tiers · bloodGroups
customerTypes · holdingTypes · storageTypes · suitableTimes
paymentModes · potentialReasons · timeGaps · currentPractices
```

Every option row carries **both** `key` (the i18n key the Bangla dictionary
resolves) and `label` (the English fallback), because the frontend needs both.
`roadsByWard` is `{wardId: [roadName, …]}`, indexed the way the Households form
consumes it.

### CRUD on the lists

`/api/zones/`, `/api/wards/`, `/api/roads/`, `/api/tiers/` — standard REST,
**agency admin only for writes**. These exist so the lists can be maintained;
day-to-day the app reads `/api/catalog/`.

Zone and ward ids are **supplied, not generated** — they appear on printed
material. A ward carries `lat`/`lng`, the centre the live map uses.

> Changing a tier's `charge` does **not** restate bills already issued. A bill
> records the amount at the moment it was raised.

---

## Customers

Two customer types, deliberately kept apart:

- **Households** — under service, billed, QR-tagged.
- **Potential customers** — surveyed "ghost homes" not yet paying.

Converting a survey creates the household and **keeps the survey**, so the
conversion funnel has history.

### `GET /api/households/`

Filters: `ward`, `zone`, `road`, `tier`, `status`, `customer_type`, `verified`,
`located`, `hasDues`, `unplanned` — plus `search`, `ordering`, paging.

Rows carry derived fields alongside the stored ones:

| Field | Meaning |
|---|---|
| `lastVisit` | **Computed from the visit log, never stored.** The mock carried a seed value that recording a collection never updated |
| `effectiveCharge` | The charge actually applied, tier default included |
| `routable` | Whether this holding may be put on a route |
| `routeId` | The route it currently sits on, if any |
| `dues` | Outstanding money, derived from bills and payments |

### `POST /api/households/`

Required: `ward`, `road`, `holding`, `head`, `tier`, `paymentMode`,
`customerType`, `storage`, `holdingType`, `suitableTime`. `charge` defaults from
the tier. The id is allocated by the server.

### `POST /api/households/{id}/verify/`

```json
{ "lat": 22.8452, "lng": 89.5405, "accuracy": 8, "placedByHand": false }
```

Confirms the holding's GPS pin. **This is the gate for routing** — the server
refuses to put an unverified holding on a route, so this is not advisory.

`placedByHand: true` records that an office user dropped the pin on a map rather
than a collector standing at the door with a GPS fix. The distinction is kept
because the two have very different accuracy.

### `GET /api/households/by-qr/{tag}/`

Resolves a scanned bin sticker to a household. Use
[`/api/collection/scan/`](#post-apicollectionscan) instead when the scan happens
during a round — that one also answers *whether this stop belongs to this
collector today*.

### `GET /api/households/unplanned/`

The route planner's to-do list, split the way the planner presents it:

```json
{ "routable": [...], "unverified": [...], "total": 12 }
```

`routable` could go on a route now; `unverified` is blocked until someone
confirms its location.

### `/api/potential-customers/`

Survey records. Filters: `ward`, `zone`, `converted`, `reason`, `time_gap`,
`current_practice`, `verified`.

Required on create: the holding fields above plus `estTier`, `surveyedAt`,
`reason`, `timeGap`, `currentPractice`.

### `POST /api/potential-customers/{id}/convert/`

```json
{ "tier": "residential_standard", "charge": 100,
  "paymentMode": "cash", "paymentDay": 5, "qr": "" }
```

Signs the holding up for service. **Every field is optional** — omitted ones
fall back to the survey's estimates (`estTier` becomes `tier`).

Returns **both** records:

```json
{ "household": { "id": "HH-KCC-…", … }, "potential": { "converted": true, … } }
```

The survey is closed, not deleted. Converting twice fails with
`already_converted`.

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

Create with `name`, `ward`, `windowStart`, `windowEnd`, `stops`. **Every
household in `stops` must have a verified location** or the request fails.

### Stop-list edits

These are actions rather than field writes because each enforces a rule:

| Endpoint | Body | Behaviour |
|---|---|---|
| `POST /routes/{id}/stops/` | `{"stops": ["HH-…", "HH-…"]}` | **Replaces the whole ordered list in one call**, so a drag-reorder is atomic — the route is never briefly half-ordered. Use this when the user reorders |
| `POST /routes/{id}/add-stop/` | `{"hh": "HH-…"}` | Appends to the end. A holding already on another route **moves** here rather than being refused — that is what dragging it across routes means |
| `POST /routes/{id}/remove-stop/` | `{"hh": "HH-…"}` | Removes it and **closes the gap in the numbering** |

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
  "stops": [ { "hh": "HH-KCC-05003", "seq": 1, "qr": "SS-05003",
               "head": "…", "road": "…", "holding": "…", "phone": "…",
               "lat": 22.8452, "lng": 89.5405, "accuracy": null,
               "routeId": "RT-W-14-01", "routeName": "…",
               "visitId": null, "visitStatus": null, "synced": true,
               "suitableTime": "morning", "tier": "…", "dues": 0,
               "at": null, "by": null, "ward": "W-14" } ],
  "counts": { "all": 5, "collected": 0, "skipped": 0, "pending": 5 },
  "routes": [ … ]
}
```

`day` defaults to today. `stops` are in walking order; `counts` drives the
screen's three tabs; `routes` supplies the headings.

> **A collector-role caller is pinned to their own round** whatever they pass —
> a round names households and phone numbers. Verified live: the Ward 14
> collector requesting `?collector=C-058` gets **200 with their own C-042
> round**, not a 403. Supervisors and admins may look in on anyone, which is how
> a round gets reviewed from a desk.

### `POST /api/collection/scan/`

```json
{ "raw": "SS-05003", "collector": "C-042", "day": "2026-07-29" }
```

Resolves a QR payload against the round. **Answers 200 in every case** — a
wrong-round or worn-label scan is something the collector acts on, not a failed
request. The four failures are distinct on purpose:

| Response | Meaning | What the collector does |
|---|---|---|
| `{"ok": true, "stop": {…}}` | A stop on this round | Collect it |
| `{"ok": false, "reason": "alreadyCollected", "stop": {…}}` | Already recorded today | Nothing — this stops a double entry |
| `{"ok": false, "reason": "otherRoute", …}` | Belongs to a different round | A mistake fixable on the spot |
| `{"ok": false, "reason": "unknown", "code": "…"}` | Unregistered or damaged tag | Needs the office |
| `{"ok": false, "reason": "unreadable"}` | The camera got nothing | Re-scan |

`collector` and `day` matter when a supervisor previews someone else's round;
for a collector-role caller the server pins both.

### `POST /api/visits/` — record a collection or a skip

```json
{ "hh": "HH-KCC-0012840", "collector": "C-042", "status": "collected",
  "at": "2026-07-29T07:12:00Z", "source": "scan",
  "lat": 22.8452, "lng": 89.5405, "accuracy": 6, "note": "" }
```

`status` is `collected` or `skipped`; a skip needs a `reason`. `source` is
`scan` or `manual`.

> **One visit per household per day**, enforced by a unique constraint on
> `(household, served_on)`. Re-posting for the same day **updates that row**
> rather than inserting a second one — which is exactly what correcting a skip
> to a collection, and the offline queue, rely on.

The tag and route are taken from the plan, not from the request, and the live
map is notified.

### `POST /api/visits/bulk/` — flush the offline queue

```json
{ "rows": [ { "hh": "…", "status": "collected", "at": "…", … },
            { "hh": "…", "status": "skipped", "reason": "gate_locked", … } ] }
```

What a device uploads when it regains connectivity.

> **Answers with per-row outcomes rather than one status code.** The device has
> to know which rows it may drop and which to keep retrying, so a single bad row
> never rejects the batch.

`POST /api/visits/{id}/sync/` acknowledges that a queued record reached the
server.

---

## Complaints

Ticket lifecycle with SLA timers, an immutable audit trail and photo evidence.

### `GET /api/complaints/`

Filters: `status`, `priority`, `type`, `channel`, `assigned`, `hh`, `ward`,
`zone`, `active`, `breached`, `opened_after`, `opened_before`.

Rows carry the derived `slaState`, `priorityRank` and `nextStatus`, plus the
household's `head`, `holding`, `road` and `phone`, so the list needs no second
lookup.

`type`: `missed_collection` | `overflow` | `billing_dispute` | `staff_behaviour`
| `other`.
`channel`: `sms` | `app` | `phone` | `counter`.
`priority`: `urgent` | `high` | `medium` | `low`.
`status`: `open` | `assigned` | `in_progress` | `resolved` | `closed`.

### `POST /api/complaints/`

Required `hh` and `type`. `note` is **write-only** — it becomes the first entry
in the audit trail. `sla` defaults from the priority.

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

- **Only an agency admin issues charges.** A supervisor collects, but cannot
  invent a bill.
- **Collectors record payments**, because they are the people who take the money
  at the door.
- **Only an agency admin voids one**, because that is the single operation that
  can make money on record disappear.

### The central rule

> **Recording a payment is the only way a bill's status changes.**
>
> The mock UI could flip a bill to "paid" without writing a payment row, which
> is why its totals disagreed with its own reports. `Bill.status` is now a cache
> that `Bill.recalculate()` derives from the payments that actually exist, and
> `Household.dues` follows from that.

Consequently, **filter on `settlement`, not `status`**. `status` is only ever as
fresh as the last `recalculate()`; `settlement` is derived in SQL from the
annotated payment total, so it can never disagree with the `received` and
`outstanding` figures shown beside it.

### `GET /api/bills/`

Filters: `period`, `hh`, `ward`, `zone`, `run`, `status`, **`settlement`**,
`hasOutstanding`.

Each row carries `received`, `outstanding` and `settlement`, computed from the
payments that exist — one subquery for the whole page, not one query per row.

### `POST /api/bills/generate/` — the billing run

```json
{ "period": "2026-07", "issuedOn": "2026-07-01", "dueDays": 10, "dryRun": true }
```

**Agency admin only.** With `dryRun: true` it returns the same summary without
writing anything (200); with `false` it issues the bills and writes a
`BillingRun` audit row (201).

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
stop describing the month, and a household could quietly end up charged twice
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

Filters: `period`, `collector`, `hh`, `bill`, `method`, `undeposited`,
`at_after`, `at_before`.

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
{ "at": "…", "centre": {…}, "counts": {…}, "vans": [...], "households": [...] }
```

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
| `/reports/kpis/` | `period` | The six-figure scorecard |
| `/reports/waste-collection/` | `mode`, `from`, `to`, `collector`, `overall`, `format` | Rounds walked per period and collector, cover work called out |
| `/reports/service-series/` | `days`, `end`, `format` | Day-by-day scheduled / served / skipped / billed / collected |
| `/reports/ward-collection/` | `period`, `format` | Per-ward service and revenue |
| `/reports/bill-collection/` | `mode`, `from`, `to`, `overall`, `format` | Billed against received |
| `/reports/bill-status/` | `period`, `format` | Paid / partial / unpaid / overdue per collector |
| `/reports/customer-collection/` | `mode`, `from`, `to`, `hh`, `format` | Per household — the "who has not paid" list |
| `/reports/customer-bill-status/` | `period`, `format` | One row per bill, settlement derived |
| `/reports/reconciliation/` | `period`, `format` | Service vs revenue, cash taken vs handed in |
| `/reports/waste-by-zone/` | `period` | Estimated tonnage per zone |
| `/reports/complaint-summary/` | `period` | Ticket counts |
| `/reports/customer-funnel/` | — | Survey-to-customer conversion |

`mode` is `daily` | `weekly` | `monthly` | `yearly`. `period` is `YYYY-MM` and
must look like it — anything else fails with `bad_period`. `overall=true`
collapses to one row per period, dropping the collector column.

The dashboard bundle exists because the panels must be **consistent with each
other**: they are all computed from the same ward scope at the same instant.

### Two things worth knowing

> **Tonnage is labelled as estimated.** Nothing weighs the waste.
> `waste-by-zone` multiplies collected stops by per-customer-type averages and
> returns `"estimated": true` on **every** row. Show it as an estimate wherever
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
| `already_converted` | 400 | This survey is already a household |
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
| [`docs/api/SmartSweep-SWMS.postman_collection.json`](api/SmartSweep-SWMS.postman_collection.json) | 148 requests in 12 folders |
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
| `01800778899` | KCC Viewer | City-wide |

Re-running as a different role is the quickest way to see ward scoping and the
permission rules in action — the same `GET /api/households/` returns 28 rows for
the agency admin and 8 for the Ward 14 collector.

**Variables** are pre-filled with ids that exist in the `seed_demo` dataset
(`householdId`, `routeId`, `billId`, `complaintId`, `vanId`, `qrTag` …), so most
requests run as-is. `{{today}}`, `{{period}}` and `{{nowIso}}` are refreshed
before every request by a collection pre-request script, so example bodies never
go stale.

A collection-level test script prints the error envelope's `code` and `detail`
to the Postman console on any 4xx, so you rarely need to open the response body
to see what went wrong.

**Two requests are documented refusals** and are expected to fail: *Create bill
directly* (`use_billing_run`) and, when run as a non-admin, *Recalculate
performance metrics* (`permission_denied`). They are in the collection because
the refusal is part of the contract.
