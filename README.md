# CommuteAble NYC (CS546)

An accessibility-focused NYC transit companion. This project ingests multiple NYC/MTA open-data datasets into MongoDB and provides a map-first UI for exploring “actually accessible” transit infrastructure (stations, elevators, APS intersections, curb ramps), plus community reporting and station bookmarking.

---

## Features

- **Explore page** (`GET /explore`)
  - Leaflet map + list-view alternative (keyboard/screen-reader friendly).
  - **Map layers** (AJAX via `GET /explore/api`):
    - All Stations
    - Accessible Stations (ADA)
    - Elevators
    - APS Intersections
    - Curb Ramps
  - **Station filters** (AJAX; computed at seed time, fast to filter):
    - **Low outage risk** (availability ≥ 95% by default)
    - **Has APS within 250 meters**
  - Sidebar **search** (`q`) for station name/ID, APS ID, or ramp ID.

- **Station detail page** (`GET /station/:stationId`)
  - Station metadata + nearby accessibility features.
  - Bookmark (follow/unfollow) controls when logged in.

- **Crossing detail page** (`GET /crossing/:id`)
  - Details for APS intersections and curb ramps (and related nearby features).

- **Community Reports** (AJAX, CSRF-protected)
  - Logged-in users can submit obstacle reports directly from map popups:
    - `POST /api/reports`

- **Follow / Unfollow Stations** (AJAX, CSRF-protected)
  - Logged-in users can bookmark stations from station popups:
    - `POST /api/stations/:stationId/follow`
    - `POST /api/stations/:stationId/unfollow`

- **User Dashboard** (`GET /dashboard`, requires login)
  - Followed stations (bookmarks)
  - User’s submitted reports

- **Admin Dashboard** (`GET /admin`, requires admin)
  - **Sync Data**: runs `seedAll()` to refresh all open-data collections
  - **Report moderation**: Hide / Unhide / Delete (CSRF-protected)

- **Auth + Security**
  - Register / Login / Logout with sessions
  - CSRF protection for both form POSTs and AJAX POSTs

---

## Tech Stack

- **Node.js** (ESM) — **Node >= 20** required (enforced by `scripts/checkNode.js`)
- **Express**
- **MongoDB**
- **express-handlebars**
- **Leaflet**
- **express-session**
- **bcryptjs**
- **node-fetch** + **csv-parse** (seed ingestion)

---

## Datasets (Open Data)

The seed script downloads and imports 4 public CSV datasets:

- MTA Subway Stations (metadata + ADA + routes)  
  https://data.ny.gov/api/views/39hk-dx4f/rows.csv?accessType=DOWNLOAD
- MTA Elevator & Escalator Availability (monthly availability)  
  https://data.ny.gov/api/views/rc78-7x78/rows.csv?accessType=DOWNLOAD
- NYC DOT Accessible Pedestrian Signals (APS)  
  https://data.cityofnewyork.us/api/views/de3m-c5p4/rows.csv?accessType=DOWNLOAD
- NYC Curb Ramp Locations  
  https://data.cityofnewyork.us/api/views/ufzp-rrqu/rows.csv?accessType=DOWNLOAD

### Derived fields computed during seed

Because some open-data tables are not “ready to map” as-is, the seed step computes a few additional fields:

- **Elevator coordinates**
  - The availability dataset does not provide reliable point coordinates per equipment.
  - We **approximate elevator locations** by joining an elevator row to a station and using the station’s GTFS coordinates (primarily **Station MRN → Station ID**).

- **Elevator risk score** (`elevators.riskScore`)
  - Computed from availability percentage: `riskScore = round(100 - availabilityPct)` (clamped 0–100).
  - Missing availability → `riskScore = null` (treated as “unknown risk”).
  - The Explore **Low outage risk** filter defaults to `maxRiskScore = 5` (≈ availability ≥ 95%).

- **Station “APS nearby” flag** (`stations.hasNearbyAPS`)
  - `true` if any APS point is within **250 meters** of the station coordinates (Haversine distance), otherwise `false`.

> Important: if you change seed logic, **re-run the seed** so these computed fields exist in MongoDB.

---

## Prerequisites

- Node.js **>= 20**
- MongoDB running locally (or a reachable Mongo connection string)
- npm

---

## Setup

### 1) Install dependencies

```bash
npm install
```

### 2) Create `.env`

Create a `.env` file in the project root:

```env
MONGO_URL=mongodb://127.0.0.1:27017
MONGO_DB_NAME=CommuteAbleNYC
SESSION_SECRET=change-me-to-a-long-random-string
```

Optional (only if your `routes/admin.js` supports Basic Auth fallback):

```env
ADMIN_USER=admin
ADMIN_PASS=change-me-too
```

### 3) Seed the database (required)

```bash
npm run seed
```

Optional: seed sample reports so the Admin moderation table has content:

```bash
node tasks/seedSampleReports.js
```

### 4) Start the server

```bash
npm start
```

Dev mode (nodemon):

```bash
npm run dev
```

Open:

- http://localhost:3000/explore

---

## Usage Guide

### Register / Login

- Register: `GET /register`
- Login: `GET /login`
- Logout: `POST /logout` (via UI button/form)

**Role bootstrap**: the **first** user created in an empty DB becomes `admin`. Later users default to `user`.

### Explore (Map + Filters)

- `GET /explore`
- The page fetches data from `GET /explore/api` via AJAX whenever filters/search change.

#### Map layers
- All Stations
- Accessible Stations
- Elevators
- APS Intersections
- Curb Ramps

#### Station filters
These filters apply to station results and will also show station markers/list items:
- **Low outage risk**: uses the computed `elevators.riskScore` field (default threshold ≈ availability ≥ 95%).
- **Has APS within 250m**: uses the computed `stations.hasNearbyAPS` field.

### Station / Crossing detail pages
- Station: `GET /station/:stationId`
- APS or Curb Ramp: `GET /crossing/:id`

### Community Reports (User Submission)

When logged in, markers include a **Report obstacle** button.
Submitting a report sends an AJAX request to:

- `POST /api/reports` (requires login, CSRF-protected)

Reports appear in the Admin moderation table (`/admin`) for Hide/Unhide/Delete.

### Follow / Unfollow Stations

When logged in, station popups include a **Follow station** / **Unfollow station** toggle.
This sends an AJAX request to:

- `POST /api/stations/:stationId/follow`
- `POST /api/stations/:stationId/unfollow`

Followed stations are stored in the user’s `bookmarks` array and displayed on `/dashboard`.

### Dashboard

- `GET /dashboard` (requires login)
- Shows:
  - Followed stations (bookmarks)
  - The user’s submitted reports

### Admin Dashboard

- `GET /admin`
- Requires an authenticated admin session (or Basic Auth fallback if enabled).
- Features:
  - **Sync Data**: runs `seedAll()` and refreshes stations/elevators/APS/ramps
  - **Moderate Reports**:
    - Hide (status → `hidden`)
    - Unhide (status → `open`)
    - Delete (remove document)

All mutating admin actions are protected by CSRF tokens.

---

## API Notes (for debugging)

### `GET /explore/api`

The backend expects the base layer toggles to be present on every request:

- `showStations=true|false`
- `onlyAccessible=true|false`
- `showElevators=true|false`
- `showAPS=true|false`
- `showRamps=true|false`

Optional filters:
- `onlyLowRisk=true|false`
- `maxRiskScore=0..100` (only read when `onlyLowRisk=true`)
- `onlyHasNearbyAPS=true|false`
- `q=<search string>`

Response:
- GeoJSON `FeatureCollection` with `properties.kind` in `{station, elevator, aps, ramp}`.

---

## Scripts

From `package.json`:

```bash
npm start          # Start server (node app.js)
npm run dev        # Start server with nodemon
npm run seed       # Run tasks/seed.js (imports open datasets)
```

Sanity-check scripts:

```bash
node tasks/testStations.js
node tasks/testElevators.js
node tasks/testLocations.js
node tasks/seedSampleReports.js
```

---

## Project Structure (Key Files)

- `app.js` — Express bootstrap, middleware, session, error handling
- `config/routes.js` — route registration
- `config/mongoConnection.js` — Mongo connection helper
- `routes/`
  - `home.js` — `GET /` and search helper routes (if enabled)
  - `explore.js` — Explore page + GeoJSON API
  - `stationPage.js` — Station detail page (`/station/:id`)
  - `crossingPage.js` — Crossing detail page (`/crossing/:id`)
  - `reports.js` — Community report API (`/api/reports`)
  - `stationsApi.js` — Follow/unfollow API (`/api/stations/...`)
  - `dashboard.js` — User dashboard (`/dashboard`)
  - `admin.js` — Admin dashboard + moderation + sync
  - `auth.js` — Register/Login/Logout + CSRF helpers
- `data/`
  - `stations.js`, `elevators.js`, `aps.js`, `curbRamps.js`, `locations.js`
  - `reports.js`, `reportsAdmin.js`
  - `users.js`, `search.js`
- `tasks/`
  - `seed.js` — downloads and imports the 4 datasets (and computes derived fields)
  - `seedSampleReports.js` — inserts demo reports
  - `testStations.js`, `testElevators.js`, `testLocations.js`
- `views/`
  - `layouts/main.handlebars`
  - `home.handlebars`, `explore.handlebars`, `admin.handlebars`, `dashboard.handlebars`
  - `station.handlebars`, `crossing.handlebars`
  - `register.handlebars`, `login.handlebars`
- `public/`
  - `js/explore.js` — client map + list refresh + report submit + follow/unfollow
  - `js/theme.js` — theme toggle
  - `css/main.css`
  - `img/Poster1.jpg`

---

## Troubleshooting

### 1) “Elevators = 0” on Explore

- Re-run seed:
  ```bash
  npm run seed
  ```
- Confirm elevators have coordinates in Mongo:
  ```js
  db.elevators.countDocuments({ "location.lat": { $ne: null }, "location.lng": { $ne: null } })
  ```
- If it’s still 0, verify join keys:
  - Availability dataset uses **Station MRN**
  - Stations dataset uses **Station ID** as MRN

### 2) Low outage risk returns no stations/elevators

- Re-run seed (riskScore is computed during seed):
  ```bash
  npm run seed
  ```
- Confirm riskScore exists:
  ```js
  db.elevators.countDocuments({ riskScore: { $type: "number" } })
  ```
- Note: elevators with missing availability get `riskScore = null` and are not considered “low risk”.

### 3) “Has APS within 250m” shows no stations

- Re-run seed (hasNearbyAPS is computed during seed):
  ```bash
  npm run seed
  ```
- Confirm field exists:
  ```js
  db.stations.countDocuments({ hasNearbyAPS: true })
  ```

### 4) 403 Forbidden (CSRF)

This project uses double-submit cookie CSRF tokens.

- For **form POSTs** (register/login/logout/admin actions), ensure the form includes:
  - `<input type="hidden" name="csrfToken" value="{{csrfToken}}">`

- For **AJAX POSTs** (`/api/reports`, `/api/stations/...`), ensure:
  - the page includes `<meta name="csrf-token" content="{{csrfToken}}">`
  - the client sends header: `x-csrf-token: <token from meta>`

### 5) Cannot access `/admin` in incognito

Expected. `/admin` is protected.

- Log in as an **admin** user (first registered user on a fresh DB is admin), or
- If Basic Auth fallback is enabled, provide `ADMIN_USER/ADMIN_PASS`.

### 6) Node version errors

Use Node >= 20. The project runs `scripts/checkNode.js` before start/dev/seed.

---

## Security Notes (Coursework Scope)

- Passwords are hashed with bcrypt (`bcryptjs`).
- Sessions via `express-session`.
- Mutating requests are protected with CSRF tokens (form + AJAX).
- Admin routes are protected via session role checks (and optionally Basic Auth fallback, depending on configuration).

---

## License / Attribution

This is a coursework project. Data sources are public NYC/MTA open datasets listed above.
