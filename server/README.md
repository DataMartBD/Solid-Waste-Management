# Smart Sweep SWMS — backend

Django 5.2 + Django REST Framework on PostgreSQL 18, serving the React app in the
repository root.

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

`ANTHROPIC_API_KEY` is optional. Without it the Sweep AI endpoint answers from a
rule-based fallback instead of the Claude API, so the panel works either way.

## Layout

```
config/            settings, root urls, ASGI/WSGI entrypoints
swms/common/       shared base models, text-key ids, permissions, error envelope,
                   websocket layer, the seed command
swms/accounts/     User (phone-based), OTP codes, PIN credentials, JWT auth
swms/catalog/      zones, wards, roads, tiers and the eight dropdown lists
swms/customers/    households and surveyed potential customers
swms/fieldops/     collectors, routes, route stops, assignments, visits
swms/fleet/        vans, maintenance, fuel logs, GPS positions
swms/complaints/   complaints, their audit trail, photo evidence
swms/billing/      billing runs, bills, payments, collector cash deposits
swms/reports/      aggregates and CSV/XLSX/PDF export (no models)
swms/ai/           Sweep AI assistant
```

Interactive API docs: `http://127.0.0.1:8000/api/docs/`. Admin:
`http://127.0.0.1:8000/admin/`.

## Design decisions worth knowing

**Text primary keys.** `Household.id` really is `'HH-KCC-0012840'` and
`Route.id` is `'RT-W-14-01'`, because the UI displays those identifiers and field
staff read them off bin stickers. Ids come from `swms/common/ids.py`, which
allocates from a sequence table rather than a timestamp so they stay short and
collision-free under concurrency.

**Reference data is in the database, with both `key` and `label`.** Every option
row keeps the i18n key the Bangla dictionaries resolve *and* an English fallback,
because the frontend needs both. `GET /api/catalog/` returns the whole set in one
call.

**Recording a payment is the only way a bill's status changes.** The mock UI could
flip a bill to "paid" without writing a payment row, which is why its totals
disagreed with its own reports. `Bill.status` is now a cache that
`Bill.recalculate()` derives from the payments that actually exist, and
`Household.dues` follows from that.

**A complaint's status is not a writable field.** Each lifecycle move is an action
endpoint that also appends an immutable `ComplaintActivity` row, so a ticket
cannot change hands without a trail.

**`lastVisit` is derived, not stored.** The mock carried a seed value that
recording a collection never updated. It is now computed from `Visit` rows.

**One visit per household per day**, enforced by a unique constraint on
`(household, served_on)`. Correcting a skip to a collection updates that row
rather than inserting a second one — which is what the offline queue upload
relies on.

**Ward scoping is applied server-side.** A viewset declares `ward_scope_field` and
the queryset is filtered by `request.user.visible_ward_ids()`. It cannot be
widened from the client, so a ward supervisor's reports are their wards whatever
they ask for.

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
| `collector` | Their own round; record visits, take payments, add complaint notes, correct customer details, verify locations |
| `supervisor` | Full operational control within their zone's wards |
| `agency_admin` | Everything, including staff, fleet and billing runs |
| `kcc_viewer` | Read-only, city-wide |

## Commands

| Command | Purpose |
|---|---|
| `manage.py seed_demo [--flush] [--today YYYY-MM-DD]` | Load the demo dataset — the Python port of the frontend's old `mockData.js` |
| `manage.py migrate` | Apply schema changes |
| `manage.py test` | Run the backend test suite |
| `manage.py spectacular --file schema.yml` | Dump the OpenAPI schema |

## Tests

```bash
.venv\Scripts\python.exe manage.py test
```
