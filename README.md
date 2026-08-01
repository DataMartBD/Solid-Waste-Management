# Smart Sweep — SWMS

Solid Waste Management System for the Khulna City Corporation pilot: a **React 18
frontend** and a **Django 5.2 + DRF backend on PostgreSQL 18**. Login is by mobile
number, with either an SMS code or a 4-digit PIN.

The frontend was originally a mock-data prototype. It now runs entirely against
the API — the mock dataset was ported to a database seed command, so the demo
looks the same but every figure is real, computed from PostgreSQL.

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

## Logging in (demo)

Tap a **demo account** chip on the sign-in screen, or type a number. First sign-in
uses a 4-digit SMS code — with no SMS gateway configured the login screen shows
the code, which the server only reveals while `DEBUG` is on. After that you can
set a PIN and use it instead, which is what field collectors do where coverage is
unreliable.

| Mobile | Role | Scope | Sees |
|---|---|---|---|
| 01711000042 | Collector | Ward 14 | Their own round, customers, complaints |
| 01700112233 | Supervisor | Zone 03 | Full operational control of that zone's wards |
| 01900445566 | Agency Admin | All zones | Everything, including staff, fleet and billing runs |
| 01800778899 | KCC Viewer | City-wide | Read-only oversight and reports |

Roles are enforced server-side and the sidebar only offers pages the signed-in
role can actually open. `seed_demo` prints the PINs and the `/admin` superuser it
creates.

## Modules

| Route | What it shows |
|---|---|
| `/app/dashboard` | KPI scorecard, 7-day trend, waste by zone, complaint counts — one server aggregate |
| `/app/live` | Leaflet map of Khulna with real vehicle telemetry, pushed over a websocket |
| `/app/households` | Customer register: search, filter, QR tags, GPS verification, survey conversion |
| `/app/collection` | A collector's round for the day: QR scan, collect, skip with a reason, offline queue |
| `/app/routes` | Progressive route view — stop-by-stop timeline and a live map of the walk |
| `/app/route-plan` | Build routes, order stops, assign them to collectors |
| `/app/complaints` | Ticket lifecycle with SLA timers, audit trail and photo evidence |
| `/app/billing` | Monthly billing runs, payments (including partial), collection rate |
| `/app/fleet` | Vans, document expiry, maintenance, fuel logs, availability |
| `/app/collectors` | DSP staff, licensing, van assignment, performance |
| `/app/reports` | Service delivery, revenue, bill status and reconciliation, with server-side CSV/Excel/PDF export |
| `/app/reports-customer` | Per-household billing and "who has not paid" |

## Key features

- **Two customer types.** Households *under service* (billed, QR-tagged) and
  surveyed *potential* customers — "ghost homes" not yet paying. Converting a
  survey creates the household and keeps the survey, so the conversion funnel has
  history.
- **Location verification gates routing.** Only a household with a confirmed GPS
  pin can be put on a route; the server enforces it.
- **Offline-tolerant collection.** A round recorded without connectivity queues
  locally and uploads in bulk; a partial failure is reported per row rather than
  silently dropping work.
- **Realtime live map.** Vehicle positions arrive over a websocket, falling back
  to polling where websockets are unavailable.
- **Sweep AI.** The floating assistant answers from a live, ward-scoped snapshot
  of the database via the Claude API, and falls back to rule-based answers when no
  API key is configured.
- **Bangla and English** throughout, Bangla by default, including Bangla numerals.
- **Dark mode**, persisted.

## Tech

**Frontend** — React 18, React Router 6, Vite 5, Recharts, Leaflet, qrcode.react,
a custom CSS design system with light and dark themes, and Vitest.

**Backend** — Django 5.2, Django REST Framework, SimpleJWT, Channels (websockets),
PostgreSQL 18 via psycopg 3, drf-spectacular (OpenAPI), openpyxl and ReportLab for
exports, and the Anthropic SDK for the assistant.

## Structure

```
src/
  api/          client.js (fetch, JWT refresh, error envelope) · endpoints.js
  context/      AuthContext (OTP/PIN/JWT) · DataContext (server mirror) · ThemeContext
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
| [API reference](docs/API-REFERENCE.md) | Every endpoint, error codes, auth, ward scoping |
| [Workflows](docs/WORKFLOWS.md) | How work moves through the system, and the rules the server enforces |
| [User manual](docs/USER-MANUAL.md) | Every screen, by role, in plain language |
| [User manual (Word)](docs/Smart-Sweep-User-Manual.docx) | The same manual as a formatted 24-page `.docx`, for printing and circulation |

A ready-to-run **Postman collection** (148 requests, with JWT capture built in)
is in [docs/api/](docs/api/) alongside the generated OpenAPI schema. See
[docs/README.md](docs/README.md) to get started.

## Tests

```bash
npm test                                   # frontend (Vitest)
cd server && .venv\Scripts\python.exe manage.py test   # backend
```
