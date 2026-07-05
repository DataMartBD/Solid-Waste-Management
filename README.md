# Smart Sweep — SWMS Frontend

React frontend for the **Solid Waste Management System** described in the Smart Sweep spec
(Khulna City Corporation pilot). Login is by **mobile number + OTP**. Runs entirely on a
mock data layer — no backend required.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

## Logging in (demo)

Enter any registered mobile number, or tap a **demo account** chip on the sign-in screen.
Login is a **4-digit OTP**. Since there's no SMS gateway, the OTP screen shows the code
(demo mode only). Demo accounts:

| Mobile        | Role         | Scope       |
|---------------|--------------|-------------|
| 01711000042   | Collector    | Ward 14     |
| 01700112233   | Supervisor   | Zone 03     |
| 01900445566   | Agency Admin | All zones   |
| 01800778899   | KCC Viewer   | City-wide   |

The 6-digit code is deterministic per number, so the same number always yields the same code.
The session persists in `localStorage`; use the sign-out button in the top bar to clear it.

## Modules (mapped to the spec)

| Route              | Spec section | What it shows |
|--------------------|--------------|----------------|
| `/app/dashboard`   | §11 KPIs     | Efficiency, charge rate, coverage, fleet gauges; 7-day trend; live visit stream |
| `/app/live`        | §4.6 / §3    | **Real interactive map** (Leaflet + OpenStreetMap/CARTO tiles) of Khulna with live collector pins and household markers; theme-aware tiles; click a collector to fly to them |
| `/app/households`  | §4.1         | Household register, search/filter, QR detail drawer |
| `/app/routes`      | §4.3         | **Progressive routes** — expand a route for a **Timeline** (stop-by-stop: collected / skipped / next / pending, from live scans) or a **Live map** view (real Leaflet streets) that draws the collection path between households — solid = collected, dashed = still to collect — with an animated collector marker moving along the route |
| `/app/complaints`  | §4.4         | Ticket lifecycle (Open→…→Closed) with SLA timers |
| `/app/billing`     | §4.5         | Billing, reconciliation (billed vs collected), mark-paid |
| `/app/fleet`       | §4.8         | Van registry, docs w/ expiry, maintenance, fuel logs, alerts |
| `/app/drivers`     | §4.8.2       | DSP database, licensing, van assignment, performance |
| `/app/reports`     | §4.7 / §11   | KPI scorecard, trends, scheduled report exports |

## Key features

- **Two household types** — the Households module manages both:
  - **Under service** — homes currently giving waste to a collector (billed, QR-tagged).
  - **Potential** — surveyed "ghost homes" not yet under service (future customers).
  Filter by type, and use **Bring under service** (the → action) to convert a potential
  home into a serviced customer — it generates a household ID, QR tag and ledger.
- **View + multi-format export** — every list has a **View / Export** menu:
  **View report** (styled, printable preview), **Export PDF** (via browser print/Save-as-PDF),
  **Export Excel** (`.xls`), and **Export CSV**.
- **Editable database** — every module (households, drivers, vans, complaints, billing,
  maintenance, fuel) supports **add / edit / delete** with **detail views**. All data lives
  in `DataContext` and persists to `localStorage` (survives refresh). Delete the
  `swms.db.v1` key to reset to seed data.
- **Working buttons** — Register/Add forms open modals; Record payment, Log maintenance,
  Add fuel, advance complaint, mark paid all mutate the store. **Export CSV** and
  **Print / PDF** (via browser print) work on every list and report.
- **Reports** (`/app/reports`), three tabs:
  - **Service Collection** — Daily / Weekly / Monthly aggregated reports (households served,
    efficiency, billed, collected, charge rate) with chart + CSV + printable PDF.
  - **Customers** — **Existing customers** and **potential (ghost-home) customers**, each
    grouped **by ward** or **by road**, with revenue/dues rollups and detail registers.
  - **KPI Scorecard** — targets vs current, exportable.
- **Dark mode** — toggle in the top bar (moon/sun); persists. The dark-green sidebar stays
  branded in both themes.
- **Floating AI assistant** — bottom-right button opens *Sweep AI*, which answers questions
  about dues, fleet, complaints and collection from live store data and deep-links to the
  right page. Wire `FloatingAI.answer()` to a real LLM endpoint to make it fully conversational.

## Tech

- **React 18** + **React Router 6** (SPA routing, auth guards)
- **Vite 5** build tooling · **Recharts** for charts/gauges
- **Leaflet + react-leaflet** for the real Live Map (OpenStreetMap/CARTO tiles) · **qrcode.react** for scannable QR tags
- Custom CSS design system with **light + dark themes** (`src/styles/`, `data-theme` attr)
- Contexts: `AuthContext` (OTP + RBAC), `DataContext` (editable store), `ThemeContext` (dark mode)

## Structure

```
src/
  context/AuthContext.jsx   OTP request/verify, session, role→home mapping
  data/mockData.js          simulated SWMS API data (households, vans, bills…)
  components/                Layout, Icons, reusable UI (StatCard, Status, Section…)
  pages/                     one file per module (Login, Dashboard, Fleet, …)
  styles/                    index.css (design system), login.css, app.css
```

## Wiring to a real backend

`AuthContext.requestOtp` / `verifyOtp` are the SMS-gateway seams — replace their bodies with
calls to `POST /auth/otp` and `POST /auth/verify`. Each page imports from `src/data/mockData.js`;
swap those imports for `fetch` calls against the API surface in §6 of the spec (the shapes match).
