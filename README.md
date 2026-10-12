# Smart Sweep — SWMS

Solid Waste Management System for city corporations and pourashovas, piloted at
Khulna City Corporation: a **React 18 frontend** and a **Django 5.2 + DRF backend
on PostgreSQL 18**. Login is by mobile number and password; field collectors can
also use a 4-digit PIN where coverage is unreliable.

One deployment serves several cities. The geography is **City → Zone → Ward →
Block/Area → Road**, and an **agency** — a contractor, NGO or the city's in-house
service — collects the waste. **Every operation is holding-wise**: the service
charge, bill, payment, daily collection visit, QR tag and complaint all belong to
the holding (the building); households are the families living in it.

The frontend began as a mock-data prototype. It now runs entirely against the
API — the mock dataset was ported to a database seed command, so the demo looks
the same but every figure is real, computed from PostgreSQL.

## Quick start

Two processes. Backend first:

```bash
cd server
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env
```

Edit `server/.env` with your PostgreSQL password — **quote it if it contains
`#`** — then create the database and load the demo data:

```bash
.venv\Scripts\python.exe manage.py migrate
.venv\Scripts\python.exe manage.py seed_demo --flush
.venv\Scripts\python.exe manage.py runserver
```

Frontend, from the repository root:

```bash
npm install
npm run dev      # http://localhost:5173
```

Vite proxies `/api`, `/media` and `/ws` to `127.0.0.1:8000`, so the browser sees a
single origin in development. See [server/README.md](server/README.md) for backend
detail and [`server/.env.example`](server/.env.example) for every setting.

On a server, schedule `manage.py close_collection_day` every 15 minutes — it
closes each city's collection day at its cut-off (see
[server/README.md](server/README.md#scheduled-job)).

## Logging in (demo)

Tap a **demo account** chip on the sign-in screen (served only in development),
or type a number and password. Every seeded operator has the password
`swms1234` and PIN `1470` (`DEMO_PASSWORD` / `DEMO_PIN` in the seed data);
`seed_demo` also prints the `/admin` superuser it creates.

| Mobile | Role | Scope | Sees |
|---|---|---|---|
| 01711000042 | Collector | Ward 14 | Their own round, holdings, surveys, complaints |
| 01700112233 | Supervisor | Zone 03 | Full operational control of that zone's wards |
| 01900445566 | Agency Admin | Their agency | Everything for their agency — holdings and bulk upload, staff, fleet, billing, users |
| 01800778899 | City Viewer | City | Read-only — lands on City Collection |
| 01900000000 | Superuser (Super Admin) | Every city | Setup, agencies, remittances, `/admin` |

Roles are enforced server-side and the sidebar only offers pages the signed-in
role can actually open.

## Modules

| Route | What it shows |
|---|---|
| `/app/dashboard` | KPI scorecard, 7-day trend, waste by zone, complaint counts — one server aggregate |
| `/app/city` | **City Collection** — the corporation's view: today live, then confirmed / auto / missed by day or month, by agency and ward, with Excel export |
| `/app/live` | Leaflet map with real vehicle telemetry and holdings, pushed over a websocket |
| `/app/holdings` | Holding register: service charge, QR tags, GPS verification, households = units check, **bulk upload from Excel/CSV** |
| `/app/holdings/:id/households` | The families living in a holding |
| `/app/surveys` | Door-to-door surveys: record, review, convert to a holding |
| `/app/collection` | A collector's round for the day — one stop per holding: QR scan, collect, skip with a reason, offline queue |
| `/app/routes` | Progressive route view — stop-by-stop timeline and a live map of the walk |
| `/app/route-plan` | Build routes, order stops, assign them to collectors |
| `/app/complaints` | Ticket lifecycle per holding, missed-collection day, SLA timers, audit trail and photos |
| `/app/billing` | Monthly billing runs per holding, payments (including partial), collection rate |
| `/app/fleet` | Vans (ward, dumping point), document expiry, maintenance, fuel logs |
| `/app/collectors` | Field staff, licensing, van assignment, performance, agency transfers |
| `/app/agencies` | Agency master — type, city, service wards, contract, remittances |
| `/app/users` | Operator accounts, roles and ward / zone / agency / city scope |
| `/app/setup` | Cities (cut-off, complaint deadline), zones, wards, dumping points, city and agency types |
| `/app/reports` | Service delivery, revenue, bill status and reconciliation, with server-side CSV/Excel/PDF export |
| `/app/reports-customer` | Per-holding billing and "who has not paid" |

## Key features

- **Multi-city, set up without code.** Cities, zones, wards, dumping points and the
  city/agency type lists are edited on the Setup page, with Bangla names beside
  the English ones. A City Viewer account is confined to its own city.
- **Holding-wise everything.** One charge, one monthly bill, one daily visit and
  one QR tag per building. A holding may never have more active households than
  units.
- **Collected unless complained.** At each city's cut-off (default 21:00) every
  due holding nobody confirmed and nobody complained about is recorded as
  collected automatically; a missed-collection complaint before the next day's
  deadline (default 12:00) reverses it. Confirmed and automatic collections are
  counted apart, by agency.
- **Bulk holding upload.** Excel or CSV — holding no., name, mobile, city, ward,
  area, address, route, GPS — validated row by row before anything is saved.
- **Surveys and potential customers.** Door-to-door surveys are reviewed and
  converted to holdings; surveyed families not yet paying ("ghost homes") are
  kept, so the conversion funnel has history.
- **Location verification gates routing.** Only a holding with a confirmed GPS
  pin can be put on a route; the server enforces it.
- **Offline-tolerant collection.** A round recorded without connectivity queues
  locally and uploads in bulk; a partial failure is reported per row rather than
  silently dropping work.
- **Cash traced end to end.** Payment at the door → collector deposit → agency
  remittance to the corporation, with reconciliation exceptions per holding.
- **Realtime live map.** Vehicle positions arrive over a websocket, falling back
  to polling where websockets are unavailable.
- **Sweep AI.** The floating assistant answers from a live, scope-limited snapshot
  of the database via the Claude API, and falls back to rule-based answers when no
  API key is configured.
- **Bangla and English** throughout, Bangla by default, including Bangla numerals.
- **Dark mode**, persisted.

## Tech

**Frontend** — React 18, React Router 6, Vite 5, Recharts, Leaflet, qrcode.react,
a custom CSS design system with light and dark themes, and Vitest.

**Backend** — Django 5.2, Django REST Framework, SimpleJWT, Channels (websockets),
PostgreSQL 18 via psycopg 3, drf-spectacular (OpenAPI), openpyxl (exports and
bulk upload) and ReportLab, and the Anthropic SDK for the assistant.

## Structure

```
src/
  api/          client.js (fetch, JWT refresh, error envelope) · endpoints.js
  context/      AuthContext (password/PIN/JWT) · DataContext (server mirror) · ThemeContext
  access.js     which roles may reach which screen
  data/         reference.js — pure helpers over the server's catalog
  components/   Layout, Icons, reusable UI, QR scanner, Sweep AI panel
  pages/        one file per module
  i18n/         bn + en dictionaries, formatters
  styles/       design system

server/
  config/       settings, urls, ASGI/WSGI
  swms/         one app per domain — see server/README.md
```

## API

Interactive docs at `http://127.0.0.1:8000/api/docs/` once the backend is running;
the OpenAPI schema is at `/api/schema/`.

## Documentation

| Document | Covers |
|---|---|
| [API reference](docs/API-REFERENCE.md) | Every endpoint, error codes, auth, scoping, the collection day |
| [Workflows](docs/WORKFLOWS.md) | How work moves through the system, from city setup to reconciled cash, and the rules the server enforces |
| [User manual](docs/USER-MANUAL.md) | Every screen, by role, in plain language |
| [User manual (Word)](docs/Smart-Sweep-User-Manual.docx) | The same manual as a formatted `.docx`, generated from the Markdown, for printing and circulation |

A ready-to-run **Postman collection** (226 requests in 15 folders, with JWT
capture built in) is in [docs/api/](docs/api/) alongside the generated OpenAPI
schema. See [docs/README.md](docs/README.md) to get started.

## Tests

```bash
npm test                                   # frontend (Vitest)
cd server && .venv\Scripts\python.exe manage.py test   # backend
```
