# Smart Preordering & Billing – Food Court

Modern cafeteria orchestration for large campuses: streamline employee ordering, give vendors real-time control, and power procurement/analytics with Redis streams and OLAP storage.

---

## 📌 Overview

This monorepo hosts a production-style demo that simulates Infosys campus food courts. It combines:

- **Employee experience** – menu browsing, scheduled pickups, wallet/UPI/cards, loyalty streaks, SOS alerts, grievances, and historical orders.
- **Vendor cockpit** – live order queue management, prep-time extensions, menu editor, combo/offer builders, feedback loops, and procurement automation.
- **Analytics hub** – Redis-backed streaming pipeline emitting to InfluxDB and DuckDB for real-time dashboards, forecasting, and restock alerts.

Key personas supported today:

1. **Employees** – browse shops, add to cart, schedule pickup, pay, review orders, raise issues, and earn Infy streak coins.
2. **Vendors** – authenticate, manage live orders, tune inventory, publish menus/offers, run analytics, and trigger procurement tasks.
3. **Campus Admins** – curate vendor roster, monitor SOS signals, review analytics, and orchestrate cross-vendor operations.

---

## 🏗️ Architecture Snapshot

- **Frontend (React + Vite)**
  - Component-driven UI (Menu, Cart, PaymentPage, Analytics, ProcurementManager, AdminControl, etc.).
  - React Toastify for notifications, custom sounds for order/SOS alerts, dynamic routing via view state.

- **Backend (Node.js & Express)**
  - REST APIs for auth, menu/order lifecycle, feedback, grievances, procurement, analytics, SOS, loyalty points, and bulk orders.
  - WebSocket gateway (`ws`) pushing live analytics snapshots to vendors.
  - Scheduler suite (`node-cron`, nightly jobs) for archival, forecasting refresh, and procurement insights.

- **Realtime & Analytics Pipeline**
  - `analyticsEvents` emit order/inventory updates to a Redis Stream (`analytics.events`).
  - `analyticsIngestor` consumes streams, writing to **InfluxDB** (time-series metrics) and **DuckDB** (OLAP snapshots) for procurement forecasting.
  - `realtimeAnalyticsService` hydrates Redis-backed state and serves WebSocket subscribers with second-level updates.

- **Data Storage**
  - JSON fixtures (`backend/data/`) for menu, users, points, and operational records.
  - DuckDB warehouse (`analytics.duckdb`) for historical aggregation, rolling demand features, and forecasting.
  - Redis 4.x for caching, rate limiting, pub/sub notifications, and analytics stream persistence.

---

## ✨ Current Capabilities

- OTP-based login with saved mobiles, countdown resend, and audio cues.
- Fine-grained cart management with variant pricing, inventory guards, and flexible scheduling to **today or tomorrow** (08:00–22:30, 5-minute resolution).
- Section-based ordering windows ensure breakfast/lunch/snacks items are surfaced only when available; UI guides employees to valid pickup times.
- Real-time inventory overlays (SOLD OUT, FEW LEFT, RESTOCKED) with per-item caps ensure orders never exceed current stock.
- Sold-out and low-stock items expose a “Show Interest” action so employees can request restock; interest counts persist to analytics and auto-trigger vendor restock notifications when thresholds are crossed.
- Employees can flag low-stock holdings directly to vendors and receive lock-stock notifications when inventory stabilizes.
- Dedicated **PaymentPage** handling cards, UPI apps, wallets, cash, and vendor wallet balance with inline validation.
- Favorites, inline ratings/reviews, grievances, and SOS panic button with campus broadcast.
- Wallet ledger + Infy streak coins loyalty accrual via `pointsService`.
- Rich order history supporting cancellations (policy-aware) and instant refunds to wallets/cards, plus reorder shortcuts and profile management.

- Role-based JWT login with hashed credentials (`bcrypt`).
- Live order board (Current/Ready/Completed) with timers, bulk prep extensions, audio alerts, and one-click parcel/takeaway toggles.
- Real-time inventory console synced with Redis to adjust stock, respond to rising interest demand, and view depletion trends.
- Vendor notifications for lock-stock scenarios and low-stock alerts surface ahead of outages.
- Menu editor, combo builder, offer preview service, and grievance/feedback workflows.
- Procurement Manager: template catalogs, automated task generation, vendor archives, and headcount planning.
- Historic data import/export (CSV, XLSX) for analytics bootstrapping via `multer`, `csv-parse`, `exceljs`.
- Refund dashboard highlights cancellation events, auto-calculates refund channel (wallet/card), and logs adjustments for audits.

- Extensive admin control center for onboarding vendors, managing user accounts/roles, and configuring section windows across shops.
- Bulk order orchestration: HR/events teams raise large requests with vendor coordination, pricing hooks, and custom pickup windows.
- Central grievance desk: employees raise concerns directly to management; admins route/resolve and maintain audit logs.
- SOS monitoring with resolve workflows and push-toasts across logged-in clients.
- Metrics endpoint (`/metrics`) enabling Prometheus-compatible scraping via `metricsRegistry`.

### 4. Analytics, Forecasting & Procurement Intelligence
- Redis-driven stream ingestion to **InfluxDB** and **DuckDB** for OLAP queries.
- `analyticsQueryService` surfaces vendor summaries, status breakdowns, consumption trends, and rolling demand features.
- WebSocket updates to frontend dashboards for live charts (orders, revenue, prep extensions, inventory adjustments).
- Nightly snapshot archiving (`archiveScheduler`, `nightlyScheduler`) and forecasting evaluation (`forecastingService`, `forecastingModel`).
- Procurement automation creating restock tasks once inventory thresholds/interest counts trigger.

---

## 🧰 Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | React 18, Vite, Recharts, React-Toastify | SPA UI, analytics charts, notifications |
| Backend | Node.js 18, Express 4, ws | REST + WebSocket APIs, scheduling, orchestration |
| Security | bcrypt, JSON Web Tokens | Vendor authentication, role enforcement |
| Data Imports | multer, csv-parse, exceljs | Historic/menu uploads, analytics bootstraps |
| Streaming | Redis 4 Streams | Analytics event bus, caching, pub/sub |
| OLAP & Time Series | DuckDB, InfluxDB | Procurement snapshots, forecasting, KPI queries |
| Scheduling | node-cron, nightlyScheduler | Jobs for analytics refresh & archival |
| Testing | Jest, Supertest | Backend integration & API tests |

---

## 🔁 Key Workflows

### Employee Order Flow
1. Login via OTP (`EmployeeLogin.jsx`) → tokens cached per session.
2. Browse menu (`Menu.jsx`) with inventory overlays using normalized `shopInventoryMap`.
3. Add to cart (`Cart.jsx`), schedule pickup, attach notes, choose payment method.
4. Checkout on `PaymentPage.jsx`, triggering `placeOrder` API call and loyalty point accrual.
5. Receive live status toasts + sounds; track history in `OrderHistory.jsx` & rate items.

### Vendor Fulfilment Loop
1. Authenticate via `/auth/vendor` → JWT decoded in `App.jsx`.
2. Manage queues in `AdminDashboard.jsx`, extend ETAs, mark ready/completed.
3. Adjust inventory (`MenuEditor.jsx`), create combos/offers, or trigger procurement tasks.
4. Review grievances/feedback, respond, and archive records as needed.
5. Monitor analytics in `Analytics.jsx` fed by WebSocket snapshots (`realtimeAnalyticsService`).

### Procurement & Analytics Pipeline
1. Order/inventory events → `analyticsEvents` publishes to Redis Stream.
2. Employee interest for sold-out/low-stock items is captured, aggregated per vendor, and stored in DuckDB for AI restock scoring.
3. `analyticsIngestor` consumes, enriches context (holidays/weather), writes to InfluxDB & DuckDB.
4. `analyticsQueryService` aggregates KPIs, time series, inventory depletion, interest trends, and rolling demand features.
5. Forecasting + procurement automation generate vendor tasks, notify when interest exceeds thresholds, broadcast low-stock alerts, and recommend restocks.
6. Vendors export snapshots or download trend reports via analytics endpoints.

---

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9
- Local Redis instance (default `redis://127.0.0.1:6379`)
- Optional: InfluxDB + DuckDB (created automatically)

### Installation

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### Environment setup

Copy the example environment files before running or building:

```bash
copy backend\.env.example backend\.env        # Windows PowerShell/CMD
copy frontend\.env.example frontend\.env

# macOS/Linux equivalent
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Update the newly created `.env` files with production secrets (JWT, Redis, Influx, etc.) and store the real values in your secret manager for deployment.

### Running Locally

```bash
# Backend (http://localhost:3001)
cd backend
npm start

# Frontend (http://localhost:3000)
cd frontend
npm run dev
```

By default the backend uses local JSON data. Enable Redis/Influx/DuckDB by running the services and setting environment variables (see below).

### Building the Frontend

```bash
cd frontend
npm run build
npm run preview   # optional production preview
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Backend HTTP port |
| `JWT_SECRET` | `MySuperSecretKeyForJWT` | Vendor token signing key |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection for caching + streams |
| `ANALYTICS_STREAM` | `analytics.events` | Redis stream channel |
| `ANALYTICS_STREAM_MAX_LEN` | `25000` | Max analytics backlog size |
| `ANALYTICS_CONSUMER_GROUP` | `analytics-ingestors` | Redis consumer group name |
| `ANALYTICS_CONSUMER_NAME` | `analytics-worker-${pid}` | Worker identifier |
| `ANALYTICS_INGESTOR_BATCH_SIZE` | `100` | Stream batch size |
| `ANALYTICS_INGESTOR_BLOCK_MS` | `5000` | Stream block interval |
| `ANALYTICS_INGESTOR_RETRY_MS` | `3000` | Retry backoff |
| `INFLUX_URL` | `http://localhost:8086` | InfluxDB endpoint |
| `INFLUX_TOKEN` | `influx-dev-token` | Influx auth token (dev only) |
| `INFLUX_ORG` | `smart-foodcourt` | Influx org |
| `INFLUX_BUCKET` | `vendor_metrics` | Influx bucket |
| `DUCKDB_PATH` | `backend/data/analytics.duckdb` | DuckDB warehouse location |
| `ANALYTICS_IMPORT_MAX_SIZE` | `15MB` | Upload limit for historic files |

Create a `.env` inside `backend/` to override defaults.

---

## ✅ Testing

```bash
cd backend
npm test
```

Jest + Supertest cover API behavior (order flow, payment edge cases, etc.). Extend under `backend/__tests__/` for new endpoints.

---

## 📂 Repository Layout

```
smart-preordering-billing-foodcourt/
├─ backend/
│  ├─ __tests__/                 # Jest + Supertest integration specs
│  ├─ data/                      # Mock JSON stores, archives, analytics bootstrap
│  ├─ lib/                       # Analytics, forecasting, procurement, points, etc.
│  ├─ uploads/                   # Vendor-uploaded files (CSV/XLSX, images)
│  ├─ index.js                   # Express entry point + WebSocket server
│  ├─ package.json
│  └─ package-lock.json
│
├─ frontend/
│  ├─ public/                    # Static HTML and favicons
│  ├─ src/
│  │  ├─ components/             # UI modules (Menu, Cart, PaymentPage, Admin tools)
│  │  ├─ api.js                  # Client fetch helpers
│  │  ├─ App.jsx                 # Root orchestration and state machine
│  │  ├─ main.jsx                # React/Vite bootstrap
│  │  └─ style.css               # Global styles
│  ├─ package.json
│  └─ package-lock.json
│
├─ docs/                         # Additional documentation/media hooks
├─ infra/                        # Local infra artifacts (Redis persistence dir)
├─ scripts/                      # Automation scripts (e.g., start-redis.ps1)
└─ README.md
```

---

## 🔮 Roadmap & Planned Enhancements
- Voice-driven menu search and image-based item recognition to speed discovery.
- Partnerships with additional payment providers (Cred, Simpl Pay Later, and similar wallets).
- Ingredient transparency per item, including allergen highlights and sourcing details.
- Curated diet combos and a dedicated healthy-eating section.
- Birthday reminders and celebratory offers for employees.
- Infosys SSO employee login with optional biometric factors (fingerprint and facial recognition).
- Engagement notifications nudging users when it's mealtime.
- Offline-ready fallback page featuring a food-themed mini game.
- Parcel/takeaway checkout mode with vendor handoff tracking.
- Split billing workflows across multiple payment methods and gateways.
- Public food reviews and star ratings surfaced per menu item.
- AI-driven restock predictions leveraging historic sales trends.
- Book-a-table reservations for dine-in experiences.
- Theme customization so shops can switch seasonal/brand skins dynamically.
- Manager-driven coupons and gifting so team leads can issue meal credits to staff.
- Exclusive recipe submission flow allowing signature dishes to be featured across restaurants.

---

## 📄 License

Demo-grade reference implementation. Replace mock data, secrets, and simplified flows before any production deployment.

