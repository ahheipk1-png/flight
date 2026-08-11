# SmartFlighter — MVP 1

Map-first flexible travel search. This is MVP 1 ("Prove Flexible Discovery")
per [`Plan/SMARTFLIGHTER_FINAL_SPEC.md`](Plan/SMARTFLIGHTER_FINAL_SPEC.md)
§51: flexible departure window + trip length, destination regions, the
Toronto airport group with nearby-airport savings, map-first results,
indicative fare discovery, live verification of finalists, and connection
min/max filters.

## Current environment status

- **Node.js and Python are installed. Docker Desktop is installed but not
  yet usable** — its install enabled WSL2/Virtual Machine Platform, which
  need a Windows **reboot** to finish taking effect (`wsl --status` won't
  work until then). Until you reboot and run `docker compose up -d`, the
  backend runs against **SQLite** and an **in-process fake Redis** — same
  code paths as the Postgres/Redis target, just swapped via `.env`. See
  `.env.example` for both configurations.
- **Every account brings its own SerpApi key — there is no shared/site-wide
  fallback.** `SERPAPI_API_KEY` in `.env` only matters for the dev CLI's
  `probe` command; it is never used to serve a real user's search. See
  "Accounts" below before trying to actually use the site.

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
DB/Redis/provider status. You'll land on a login/request-account screen —
see "Accounts" below to actually get in.

## Accounts

No fallback: every search runs on the logged-in user's own SerpApi key,
never a shared one — "it's their problem to use up their limits," not
yours (see `app/api/deps.py:get_search_provider`). New accounts need
admin approval before they can log in at all (no self-serve signup, no
self-serve password reset — an admin sets a new password instead).

**First time only** — bootstrap your own admin account:

```bash
cd backend
.venv\Scripts\python -m app.cli make-admin YOUR_USERNAME
```

Prompts for a password (hidden input) and creates an already-approved
admin account. Run it again with an existing username to just promote/
approve that account instead (e.g. if you registered normally first).

**Then:** log in at the site, click **🛠️ Admin** in the header, and
approve/deny whoever else requests an account from there. Each approved
user adds their own SerpApi key under **Settings** before they can search.

This all depends on `API_KEY_ENCRYPTION_KEY` being set in `.env` (a real
Fernet key — `.env.example` explains how to generate one). Startup fails
loudly if it's missing. Never rotate it in a deployment that has real
stored keys — every one of them becomes permanently undecryptable the
moment the key changes.

## Tests

```bash
cd backend && .venv\Scripts\python -m pytest -q      # 73 tests
cd frontend && npm test                                # 6 tests (vitest)
cd frontend && npm run build                            # type-check + build
cd frontend && npm run lint
```

## Going live with a real fare provider

**SerpApi is the chosen provider for this project** — see "SerpApi" below.
Two providers are supported either way, sharing one abstraction
(`app/providers/base.py`) and one budget guard with independent
per-provider spend pools (`app/providers/budget.py`). `FARE_PROVIDER=auto`
(the current setting) picks **Duffel if `DUFFEL_API_KEY` is set, else
SerpApi if `SERPAPI_API_KEY` is set, else mock** — since `DUFFEL_API_KEY`
is intentionally left blank, adding just `SERPAPI_API_KEY` is enough to
activate SerpApi under `auto`; no need to also set `FARE_PROVIDER=serpapi`
explicitly (and setting it explicitly with no key present would make
every search error instead of falling back to mock — leave it on `auto`).

### SerpApi (chosen provider — real-time Google Flights, ~$0.01-0.025/search)

1. Get a SerpApi key, add it to `.env` as `SERPAPI_API_KEY=...`.
2. **Before running any real UI search**, validate the response-shape
   assumptions in `app/providers/serpapi_google_flights.py` against a
   single real call, capped:
   ```bash
   cd backend
   .venv\Scripts\python -m app.cli probe YYZ KIX 2026-09-18 2026-10-02 --live --provider serpapi
   ```
   This costs exactly one SerpApi call. Compare the printed options against
   what you'd expect; if the shape has drifted, fix the parser (and add a
   fixture in `tests/fixtures/serpapi/`) before doing anything else.
3. For a first capped UI smoke test, tighten the budget in `.env` so a
   runaway search can't spend much:
   ```
   VERIFY_TOP_N=4
   LIVE_DISCOVERY_CALLS_PER_SEARCH=2
   SERPAPI_DAILY_BUDGET=8
   ```
   Run one narrow search (single region, short date window), then check
   `GET /api/health` → `budget` and confirm `api_call_log` row count
   (`SELECT COUNT(*) FROM api_call_log` in the DB) stayed within expectations.
4. Once satisfied, restore `VERIFY_TOP_N=16` and the normal budget values
   (see `.env.example`) for real use.

### Duffel (supported alternative — cheaper per search, not currently used)

Kept working and tested in case this changes later. Duffel bills
~$0.005/search once its search-to-book ratio is exceeded (this app has no
booking flow, so budget for every call at that rate — see
`app/providers/duffel.py`'s docstring for the full pricing mechanic and a
few unverified response-shape assumptions worth confirming against a real
response first).

1. Get a Duffel access token, add it to `.env` as `DUFFEL_API_KEY=...`.
2. **Before running any real UI search**, validate the parser against one
   real call:
   ```bash
   cd backend
   .venv\Scripts\python -m app.cli probe YYZ KIX 2026-09-18 2026-10-02 --live --provider duffel
   ```
   Compare the printed options against what you'd expect — especially
   `currency` (Duffel doesn't let you request one; see the docstring) and
   flight numbers. If the shape has drifted, fix the parser (and add a
   fixture in `tests/fixtures/duffel/`) before doing anything else.
3. For a first capped UI smoke test, tighten the budget in `.env`:
   ```
   VERIFY_TOP_N=4
   LIVE_DISCOVERY_CALLS_PER_SEARCH=2
   DUFFEL_DAILY_BUDGET=10
   ```
   Run one narrow search, then check `GET /api/health` → `budget` and
   `api_call_log` row count stayed within expectations.
4. Once satisfied, restore `VERIFY_TOP_N=16` and the normal budget values
   (see `.env.example`) for real use.

## Deploying (backend + Postgres + Redis on Render)

[`render.yaml`](render.yaml) is a Blueprint covering the backend web
service, a Postgres database, and a Redis (Key Value) instance — no
Dockerfile needed, Render's native Python runtime is used directly.

Cost reality, not just the free-tier headline: the web service and Redis
are free indefinitely (Redis is 25MB, in-memory only, wiped on restart —
fine here, since the app already tolerates that locally). **Postgres is
only free for 30 days**, then either upgrade (~$6-7/mo) or it's deleted
after a 14-day grace period.

1. Push this repo to GitHub (already done — `ahheipk1-png/flight`).
2. On Render: **New → Blueprint**, point it at the repo. It reads
   `render.yaml` and provisions all three resources.
3. Render will prompt for the `sync: false` env vars during setup —
   `API_KEY_ENCRYPTION_KEY` (**required**, see "Accounts" above),
   `SERPAPI_API_KEY` (dev-CLI-only, optional), `DUFFEL_API_KEY`, and
   `CORS_ORIGINS` (set to wherever the frontend ends up, e.g. a Vercel URL).
   These are entered directly in Render's dashboard, never committed to
   the repo.
4. Migrations + seed run automatically as part of the build command (see
   the comment in `render.yaml` for why — `preDeployCommand` needs a paid
   plan, so this runs there instead; both steps are idempotent).
5. Bootstrap your admin account the same way as local dev, just via
   Render's web Shell tab instead of a local terminal:
   `python -m app.cli make-admin YOUR_USERNAME` (from the `backend/`
   directory the shell opens into).
6. The frontend (Next.js) isn't part of this blueprint — Vercel is the
   simpler fit for it (auto-detects Next.js, genuinely free, no prep
   needed beyond setting `NEXT_PUBLIC_API_BASE` to the Render backend's
   URL once it's up).

I haven't run this deploy — I can't create the Render account myself
(same reason I couldn't do the SerpApi signup earlier). The config is
prepared and reasoned through, but **treat the first real deploy as
unverified until it's actually been run once.**

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
