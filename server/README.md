# Smart Sweep SWMS — backend

Django 5.2 + Django REST Framework on PostgreSQL 18, serving the React app in the
repository root.

One deployment serves several cities (Khulna City Corporation is the pilot). The
geography is **City → Zone → Ward → Block/Area → Road**, and an **agency** — a
contractor, NGO or the city's in-house service — collects the waste. **Every
operation is holding-wise**: the service charge, bill, payment, daily visit, QR
tag and complaint all belong to the holding (the building); households are the
families living in it.

## Quick start

```bash
cd server
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env          # then edit the DB password
.venv\Scripts\python.exe manage.py migrate
.venv\Scripts\python.exe manage.py seed_demo --flush
.venv\Scripts\python.exe manage.py runserver
```

Then, from the repository root, `npm run dev`. Vite proxies `/api`, `/media` and
`/ws` to `127.0.0.1:8000`, so the browser sees a single origin and there is no
CORS preflight in development.

`manage.py runserver` speaks ASGI (daphne is first in `INSTALLED_APPS`), so the
live-map websocket works without a separate process.

### Configuration

Everything environment-specific is in `server/.env` — see `.env.example`. Two
things to watch:

- **Quote a database password containing `#`.** The settings module reads
  discrete `DB_*` variables rather than a `DATABASE_URL` precisely because `#` is
  a fragment separator in a URL; unquoted in a dotenv file it also starts a
  comment, and authentication then fails with no obvious cause.
- **`OTP_EXPOSE_CODE`** returns the login code in the API response so the login
  screen can show it as a demo hint. It is additionally gated on `DEBUG`, so it
  can never leak from a production build. With it off, the login screen simply
  renders no hint and the code must arrive by SMS.

`REDIS_URL` is optional in development; set it when running more than one ASGI
process so live-map events reach every browser.

`ANTHROPIC_API_KEY` is optional. Without it the Sweep AI endpoint answers from a
rule-based fallback instead of the Claude API, so the panel works either way.

## Layout

```
config/            settings, root urls, ASGI/WSGI entrypoints
swms/common/       shared base models, text-key ids, roles and permissions,
                   error envelope, websocket layer, the seed command
swms/accounts/     User (phone-based, ward/zone/agency/city scope), OTP codes,
                   PIN credentials, JWT auth
swms/catalog/      cities, zones, wards, blocks, roads, dumping points, tiers,
                   city/agency types and the other setup lists
swms/agencies/     agencies, collector employment history, remittances
swms/customers/    holdings (service terms, QR, dues), households, potential
                   customers, the Excel/CSV bulk importer
swms/surveys/      door-to-door survey forms, surveys, convert-to-holding
swms/fieldops/     collectors, routes, route stops, assignments, visits, the
                   collection-day close and its daily summary
swms/fleet/        vans (ward, dumping point), maintenance, fuel logs, GPS
swms/complaints/   complaints, their audit trail, photo evidence
swms/billing/      billing runs, bills, payments, collector cash deposits
swms/reports/      aggregates, the city collection report, CSV/XLSX/PDF export
                   (no models)
swms/ai/           Sweep AI assistant
```

Interactive API docs: `http://127.0.0.1:8000/api/docs/`. Admin:
`http://127.0.0.1:8000/admin/`. The written reference, workflows, Postman
collection and OpenAPI file are in [`../docs`](../docs/README.md).

## Design decisions worth knowing

**Text primary keys.** `Holding.id` really is `'HLD-KCC-000123'`, its QR tag is
`'SS-…'`, and `Route.id` is `'RT-W-14-01'`, because the UI displays those
identifiers and field staff read them off stickers. Ids come from
`swms/common/ids.py`, which allocates from a sequence table rather than a
timestamp so they stay short and collision-free under concurrency. Zone and ward
codes are shared by every city, so a new city prefixes its own (`SCC-W22`).

**Reference data is in the database, with both `key` and `label`.** Every option
row keeps the i18n key the Bangla dictionaries resolve *and* an English fallback,
because the frontend needs both. `GET /api/catalog/` returns the whole set in one
call. City types and agency types are setup lists too — added on the Setup page,
not in code — and a type in use can only be hidden, never deleted. Cities, zones,
wards, agencies and dumping points carry a `name_bn` beside their English name.

**Everything hangs off the holding.** `Bill`, `Payment`, `Visit` and `Complaint`
point at the holding; a complaint may also name the household that reported it.
A holding is charged its `effective_charge` (the agreed charge, else the tier's),
and one with neither is not billed. A holding may never have more active
households than `units_total`; fewer is allowed and flagged by `units_match`.

**Recording a payment is the only way a bill's status changes.** The mock UI could
flip a bill to "paid" without writing a payment row, which is why its totals
disagreed with its own reports. `Bill.status` is now a cache that
`Bill.recalculate()` derives from the payments that actually exist, and
`Holding.dues` follows from that.

**A complaint's status is not a writable field.** Each lifecycle move is an action
endpoint that also appends an immutable `ComplaintActivity` row, so a ticket
cannot change hands without a trail.

**`lastVisit` is derived, not stored.** The mock carried a seed value that
recording a collection never updated. It is now computed from `Visit` rows.

**One visit per holding per day**, enforced by a unique constraint on
`(holding, served_on)`. Correcting a skip to a collection updates that row
rather than inserting a second one — which is what the offline queue upload
relies on.

**A holding is collected unless someone complains.** At each city's
`collection_cutoff` (default 21:00), `fieldops/collection_day.py` writes an
`auto` visit for every due holding nobody confirmed and nobody complained about,
and rebuilds `DailyCollectionSummary` (due, confirmed, auto, missed, skipped,
complaints — per city, ward and agency). A missed-collection complaint names
`missed_on`; until the city's `complaint_deadline` (default 12:00 the next day)
it can still turn an auto visit into not collected. A visit the agency confirmed
is never overwritten.

**Scoping is applied server-side.** A viewset declares `ward_scope_field` and
`agency_scope_field`, and the queryset is filtered by
`request.user.visible_ward_ids()` and `visible_agency_id()`; `User.city` confines
a city-scope account to one city. None of it can be widened from the client, so a
ward supervisor's reports are their wards whatever they ask for. An agency's
service wards, and a van's dumping point, must be in the same city.

**Estimated tonnage is labelled as estimated.** Nothing weighs the waste, so
`reports.waste_by_zone` multiplies collected stops by per-customer-type averages
and returns `estimated: true` on every row.

## Errors

Every failure has one shape, so the frontend has one thing to render:

```json
{ "detail": "Some fields need attention.", "code": "domain_error", "fields": { "road": ["..."] } }
```

`code` is a stable key the UI maps to a translated string.

## Roles

| Role | Can |
|---|---|
| `collector` | Their own round; record visits, take payments, work complaints, record surveys, correct customer details, verify locations |
| `supervisor` | Full operational control within their zone's wards (`OPERATIONAL_WRITERS`) |
| `agency_admin` | Everything for **their agency** — holdings and bulk upload, staff, fleet, billing runs, payment voids, users (`ADMIN_WRITERS`) |
| `super_admin` | Every city and agency; setup (cities, zones, wards, type lists, dumping points), agencies and remittances (`SUPER_ADMINS`) |
| `kcc_viewer` | Shown as **City Viewer**. Read-only; with `scope_kind="city"` and a `city` it is confined to that city and lands on the City Collection dashboard |

The role sets live in `swms/common/roles.py`.

## Commands

| Command | Purpose |
|---|---|
| `manage.py seed_demo [--flush] [--today YYYY-MM-DD]` | Load the demo dataset — the Python port of the frontend's old `mockData.js` |
| `manage.py migrate` | Apply schema changes |
| `manage.py test` | Run the backend test suite |
| `manage.py spectacular --file ../docs/api/openapi.yml` | Regenerate the OpenAPI schema in `docs/api` |
| `manage.py close_collection_day [--city KCC] [--date YYYY-MM-DD] [--dry-run]` | Close the collection day: at each city's cut-off, due holdings with no complaint count as collected |
| `manage.py seed_blocks [--ward W-14] [--through F] [--names …] [--dry-run]` | Create Block rows under wards |
| `manage.py seed_survey_form [--form d2d] [--publish]` | Load a questionnaire definition into the survey engine |
| `manage.py load_geo_locations [--path …] [--dry-run]` | Load division/district/upazila/union rows |
| `manage.py backfill_agency [--agency AGN-KCC-0001] [--dry-run]` | Assign unassigned holdings and routes to an agency |

Holdings are bulk-loaded through the API rather than a command:
`POST /api/holdings/import/` takes an Excel or CSV file (validate with
`commit=false` first), and `GET /api/holdings/import-template/` returns the
template.

### Scheduled job

`close_collection_day` must run from the server's scheduler (cron, or Task
Scheduler on Windows) — the app does not start it. It is safe to repeat, so
every 15 minutes is enough to close each city within a quarter-hour of its
cut-off (default 21:00, set per city in Setup):

```
*/15 * * * *  cd /path/to/server && .venv/bin/python manage.py close_collection_day >> /var/log/swms-close-day.log 2>&1
```

## Tests

```bash
.venv\Scripts\python.exe manage.py test
```
