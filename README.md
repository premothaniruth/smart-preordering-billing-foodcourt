# Smart Preordering & Billing – Food Court

A full‑stack demo for a cafeteria/food court experience with vendor and employee flows:

- Employee: Browse menu, add to cart, schedule pickup for current day within hours, place orders, view order history.
- Vendor: Live orders dashboard (current/ready/completed), low‑stock view, menu editor, analytics, grievances, feedbacks.

## Tech Stack
- Frontend: React (Vite/CRA style), recharts, react‑toastify
- Backend: Node.js + Express (in‑memory/mock data)

## Monorepo Structure
- backend/
  - index.js – Express API server
  - data/ – mock data
- frontend/
  - src/ – React app

## Quick Start

Prerequisites
- Node.js 18+
- npm 9+

Install dependencies
- Backend
  - cd backend
  - npm install
- Frontend
  - cd frontend
  - npm install

Run (two terminals)
- Backend (default http://localhost:3001)
  - cd backend
  - npm start
- Frontend (default http://localhost:3000)
  - cd frontend
  - npm start

Build
- Frontend production build
  - cd frontend
  - npm run build

## Environment
- The app uses local mock API, no external DB.
- Ports: frontend 3000, backend 3001 (configurable in package/start scripts if needed).

## Core Features
- Menu and Cart
  - Shop switcher (no icons), Veg‑only toggle, price “+” shown only when variants add cost.
  - Inventory overlays: SOLD OUT (0), FEW LEFT (1–10), RESTOCKED (same day and not sold out).
  - Prevent adding more than inventory; inline message when limit reached.
  - “Schedule for Later (optional)”:
    - Date locked to today only; no calendar navigation.
    - Time restricted to 08:00–22:00 via dropdown in 5‑minute steps.
- Employee Login
  - Mobile OTP flow with recent mobile suggestions and Clear option.
  - OTP toast shown on request (pre‑login). Resend OTP enabled after 45 seconds with countdown.
  - Successful login: no toast; a sound plays once.
- Vendor Login
  - Successful login shows a toast only once ever (stored via localStorage) and plays a sound.
- Vendor Admin Dashboard
  - Tabs: Current, Ready, Completed. Countdown turns overdue and plays a one‑time alert (if unmuted).
  - Extend prep time per order and in bulk; “Revoke Extension” hidden if order already overdue.
  - Low stock panel (threshold default 10) with quick navigation to menu editor.
- Analytics
  - Compact KPI tiles themed by shop color with period‑over‑period trends (if API provides `prev`).
  - Tightened Summary vs Breakdown spacing.
  - “Top Items” bar chart shows all labels (including first item).

## API Overview (mock)
- GET /menu – list shops and items
- POST /orders – place order
- GET /orders?user=… – user orders
- POST /auth/vendor – vendor login
- POST /auth/employee/request-otp – request OTP
- POST /auth/employee/verify-otp – verify OTP
- GET /analytics?period=… – analytics data
- Various vendor endpoints for order status, ETA extend/revoke, and menu updates

Note: See backend/index.js for exact shapes. Authentication is simplified (demo‑only JWTs).

## Configuration & Customization
- Scheduling window: edit MIN_HM/MAX_HM in `frontend/src/components/Cart.js`.
- Resend OTP delay: update `resendSeconds` in `EmployeeLogin.js`.
- Shop accent palette: `Analytics.js` `palette` array.

## Known Limits
- In‑memory data resets on server restart.
- No persistent user database; OTP is for demo only and surfaced in server logs.

## Scripts (frontend)
- npm start – dev server
- npm run build – production build
- npm run preview – preview build (if configured)

## Scripts (backend)
- npm start – start API server

## License
Demo code for educational purposes. Replace mocks and hardcoded values before production use.

## File Structure

```
smart-preordering-billing-foodcourt/
├─ backend/
│  ├─ data/
│  │  ├─ menu.json                # Mock menu and shops
│  │  ├─ orders.json              # Mock orders store (if present)
│  │  └─ ...
│  ├─ index.js                    # Express API (auth, menu, orders, analytics)
│  ├─ package.json
│  └─ package-lock.json
│
├─ frontend/
│  ├─ public/                     # Static assets (if any)
│  ├─ package.json
│  └─ src/
│     ├─ api.js                   # Client API calls (fetchMenu, placeOrder, etc.)
│     ├─ App.js                   # Root: routes/views, state, sounds, toasts
│     ├─ components/
│     │  ├─ AdminDashboard.js     # Vendor live orders (tabs, extend/revoke)
│     │  ├─ Analytics.js          # KPI tiles, summary/breakdown, top items chart
│     │  ├─ Cart.js               # Cart, schedule (today only, 08:00–22:00, 5‑min slots)
│     │  ├─ EmployeeLogin.js      # OTP flow with suggestions and resend timer
│     │  ├─ Login.js              # Vendor login (silent success; toast once in App)
│     │  ├─ Menu.js               # Menu grid, inventory overlays, add controls
│     │  ├─ MenuEditor.js         # Vendor menu editor
│     │  ├─ OrderHistory.js       # User orders with actions
│     │  ├─ RatingModal.js        # Ratings
│     │  ├─ GrievanceModal.js     # Complaints
│     │  └─ VendorFeedbacks.js    # Feedback list
│     ├─ assets/                  # Images/SVG (if any)
│     └─ styles/                  # CSS (if any)
│
├─ docs/
│  └─ media/                      # Placeholder for images/GIFs (optional)
│
├─ README.md
└─ .git/
```

### Key notes
- Scheduling window: configure in `Cart.js` (`MIN_HM`, `MAX_HM`, slots).
- OTP resend delay: `EmployeeLogin.js` (`resendSeconds`).
- Vendor login success toast (once): `App.js` (`vendorLoginToastShown` flag).
- Analytics theming and trends: `Analytics.js` (palette and `prev` fields).
