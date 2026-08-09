# SmartFlighter — MVP 1

Map-first flexible travel search. This is MVP 1 ("Prove Flexible Discovery")
per [`Plan/SMARTFLIGHTER_FINAL_SPEC.md`](Plan/SMARTFLIGHTER_FINAL_SPEC.md)
§51: flexible departure window + trip length, destination regions, the
Toronto airport group with nearby-airport savings, map-first results,
indicative fare discovery, live verification of finalists, and connection
min/max filters.

## Current environment status

- **Node.js and Python are installed.** Docker Desktop is **not** — its
  installer requires an interactive admin UAC approval this environment
  cannot grant, and WSL2 is not installed for the same reason. Until you
  install Docker Desktop yourself (`winget install Docker.DockerDesktop`,
  approve the UAC prompt, ensure WSL2 is enabled, then `docker compose up -d`),
  the backend runs against **SQLite** and an **in-process fake Redis** —
  same code paths as the Postgres/Redis target, just swapped via `.env`.
  See `.env.example` for both configurations.
- **No `SERPAPI_API_KEY` has been supplied.** The backend runs entirely on
  the deterministic mock fare provider until you add one. See "Going live
  with SerpApi" below before spending real API credits.

## One-time setup

```bash
# Backend
cd backend
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"        # Windows
cp ../.env.example ../.env                    # first time only

# Frontend
cd ../frontend
npm install
# create frontend/.env.local:
#   NEXT_PUBLIC_API_BASE=http://localhost:8000
#   NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
```

If you later bring up Docker (`docker compose up -d` from the repo root),
edit `.env` and swap `DATABASE_URL`/`REDIS_URL` to the Postgres/Redis lines
already commented in `.env.example`.

## Running it

```bash
# Terminal 1 -- backend
cd backend
.venv\Scripts\python -m app.cli seed      # idempotent; re-run anytime
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000

# Terminal 2 -- frontend
cd frontend
npm run dev
```

Open http://localhost:3000. `GET http://localhost:8000/api/health` reports
DB/Redis/provider status.

## Tests

```bash
cd backend && .venv\Scripts\python -m pytest -q      # 38 tests
cd frontend && npm test                                # 6 tests (vitest)
cd frontend && npm run build                            # type-check + build
cd frontend && npm run lint
```

## Going live with SerpApi

1. Get a SerpApi key, add it to `.env` as `SERPAPI_API_KEY=...`.
2. Leave `FARE_PROVIDER=auto` (it switches to `serpapi` automatically once
   a key is present) or set it explicitly.
3. **Before running any real UI search**, validate the response-shape
   assumptions in `app/providers/serpapi_google_flights.py` against a
   single real call, capped:
   ```bash
   cd backend
   .venv\Scripts\python -m app.cli probe YYZ KIX 2026-09-18 2026-10-02 --live
   ```
   This costs exactly one SerpApi call. Compare the printed options against
   what you'd expect; if the shape has drifted, fix the parser (and add a
   fixture in `tests/fixtures/serpapi/`) before doing anything else.
4. For a first capped UI smoke test, tighten the budget in `.env` so a
   runaway search can't spend much:
   ```
   VERIFY_TOP_N=4
   LIVE_DISCOVERY_CALLS_PER_SEARCH=2
   SERPAPI_DAILY_BUDGET=8
   ```
   Run one narrow search (single region, short date window), then check
   `GET /api/health` → `budget` and confirm `api_call_log` row count
   (`SELECT COUNT(*) FROM api_call_log` in the DB) stayed within expectations.
5. Once satisfied, restore `VERIFY_TOP_N=16` and the normal budget values
   (see `.env.example`) for real use.

## Known issues / notes for whoever picks this up

- **maplibre-gl v6** dropped its default export — only named imports work
  (`import { Map, Marker, ... } from "maplibre-gl"`). Also, under
  Turbopack's dev server its worker script fails to auto-resolve (404s as
  HTML, MIME-type error in console, tiles never load though markers still
  render since they're plain DOM). Fixed via `setWorkerUrl()` pointing at
  `frontend/public/maplibre-gl-worker.mjs`, a direct copy of
  `node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs` — **re-copy that
  file any time you bump the maplibre-gl version.**
- The map was verified via DOM/event inspection (style loads cleanly, zero
  MapLibre `error` events, markers position correctly matching itinerary
  data) rather than a visual screenshot — the automated browser tool
  available during this build couldn't composite screenshots or simulate
  real clicks reliably in this sandbox (worked around with direct JS
  `.click()` calls). **Worth a quick manual look in a real browser** to
  confirm the basemap tiles themselves render as expected.
- Brand assets: the three source PNGs in `Plan/` are not transparent as
  the spec assumes (dark vignette on the logo, soft gradients on the
  illustrations). `scripts/process_assets.py` ships the two illustrations
  as-is (inside a card, per the spec's own fallback) and draws a small
  clean paper-plane mark programmatically for the header/favicon rather
  than fighting a real background-vs-highlight color conflict in the
  source art with flood-fill extraction (that attempt is described in the
  script's docstring). Re-run `scripts/process_assets.py` (via its own
  venv, `scripts/.assets-venv`) if source assets change.
- Two minor spec self-inconsistencies noted during planning, resolved in
  favor of §17/§31's own numeric definitions: §34's example calls a $112
  stopover "FREE CITY" though §17 caps that tier at $0 (GOOD VALUE is the
  correct label); `max_stops` is interpreted as counting ordinary
  connections only, separate from intentional stopovers.
- `search/jobs.py`'s job registry is single-process, in-memory-plus-Redis
  — fine for MVP 1 / local dev, not safe for a multi-worker deployment
  without a real task queue.
