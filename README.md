# SmartFlighter — MVP 1

Map-first flexible travel search. This is MVP 1 ("Prove Flexible Discovery")
per [`Plan/SMARTFLIGHTER_FINAL_SPEC.md`](Plan/SMARTFLIGHTER_FINAL_SPEC.md)
§51: flexible departure window + trip length, destination regions, the
Toronto airport group with nearby-airport savings, map-first results,
indicative fare discovery, live verification of finalists, connection
min/max filters — plus (post-MVP-1 additions) round-trip/one-way/manual
multi-city trip types and full Traditional Chinese / Simplified Chinese /
English i18n.

## Two modes: lightweight (deployed) vs. full backend

**Lightweight — the deployed product.** The entire search pipeline runs
in the visitor's browser (`frontend/src/lib/engine/`, a TS port of the
Python pipeline, pinned to it by parity-golden tests); the server is one
Cloudflare Worker (`worker/`) with two jobs: **accounts on D1** and the
**SerpApi proxy** (SerpApi deliberately blocks browser CORS). No Python
at runtime, still $0 hosting (D1 is on the Workers free tier):

- **Accounts with admin approval**: request an account (supplying your
  own SerpApi key at signup — there is no shared key), an admin approves
  it, then you can search. The key is stored server-side encrypted
  (AES-GCM; `API_KEY_ENCRYPTION_KEY` Worker secret) and is editable
  later from the account menu's Settings. Passwords are PBKDF2-hashed
  (100k iterations — workerd's hard cap, documented in
  `worker/src/lib/crypto.ts`). Sessions are 30-day bearer tokens in D1.
- **Admin dashboard** (account menu → Admin): approve/deny/disable,
  set a user's password, set/remove a user's API key, and per-user
  usage — API-call counts (90-day window) and a per-account search
  history, logged by the Worker per proxied (paid) SerpApi call.
- Searches send the session token; the Worker decrypts that user's own
  key server-side and attaches it — the key never reaches the browser,
  and the old client-supplied-key path is gone (it would bypass the
  approval gate).
- Fare history and the query cache remain per-browser (localStorage);
  "degraded to indicative" means a live call failed (bad key, quota,
  network).
- Hosting: Cloudflare Pages/Workers static frontend + the one Worker —
  free tier for both, no domain required.
- First admin: `cd worker && npm run make-admin -- <username>` (add
  `--local` for the dev database) — registration alone can never mint
  an admin.
- Local dev: `worker/.dev.vars` (gitignored) holds the dev encryption
  key; `[secrets] required` in `wrangler.toml` is what makes wrangler
  load it and makes deploys warn if the production secret is missing.

**Full backend — kept intact and green.** The FastAPI/SQLAlchemy backend
(accounts with admin approval, encrypted per-user keys, shared
cross-user fare history in Postgres/SQLite, Redis caching, budget
guards) still lives in `backend/`, passes its full test suite, and
remains deployable via [`render.yaml`](render.yaml). The old frontend
wiring for it (login UI, HTTP polling) was removed from the deployed
frontend but is one `git revert` away. Choose this mode if you want the
approval gate or shared fare history back.

## Current environment status

- Node.js and Python are installed; Docker Desktop + WSL2 are installed
  (post-reboot) if you want the full-backend mode's Postgres/Redis via
  `docker compose up -d` — otherwise the backend's SQLite/fakeredis
  fallback works with zero infra. The lightweight mode needs neither.
- `SERPAPI_API_KEY` in `.env` only matters for the dev CLI's `probe`
  command and the golden-dump script; it is never baked into the
  frontend or the Worker.

## One-time setup

```bash
# Frontend (lightweight mode -- this is the whole app)
cd frontend
npm install
# frontend/.env.local:
#   NEXT_PUBLIC_PROXY_BASE=http://localhost:8787
#   NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty

# Backend (optional -- full-backend mode / running its tests)
cd ../backend
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"        # Windows
cp ../.env.example ../.env                    # first time only
```

## Running it (lightweight mode)

```bash
# Terminal 1 -- the SerpApi proxy Worker
cd worker
npx wrangler dev          # serves http://localhost:8787, no login needed locally

# Terminal 2 -- frontend
cd frontend
npm run dev
```

Open http://localhost:3000. Paste a SerpApi key at the gate — or type
`demo` to explore on the built-in mock with no key and no cost. Your key
lives in your browser's localStorage only; **Settings** replaces or
removes it. (The Worker is only contacted for real-key searches; demo
mode never leaves the browser.)

The old full-backend run instructions (uvicorn + seed + accounts +
admin approval) still apply if you revert to that mode — see git history
for the frontend wiring and "Deploying the full backend" below for the
server side. `API_KEY_ENCRYPTION_KEY` and the `make-admin` bootstrap are
full-backend-mode concepts only.

## Tests

```bash
cd backend && .venv\Scripts\python -m pytest -q      # 125 tests (Python pipeline)
cd frontend && npm test                                # 27 tests (engine + parity goldens)
cd worker && npm test                                   # 41 tests (crypto, auth gating, admin dashboard)
cd frontend && npm run build                            # type-check + static export
cd frontend && npm run lint
```

The frontend suite includes **parity goldens**: the TS engine's SerpApi
parsers are asserted byte-identical to the Python parsers over the same
recorded fixtures. Regenerate after changing either side:

```bash
backend\.venv\Scripts\python scripts\dump_parser_goldens.py
```

## Going live with a real fare provider (full-backend mode)

Lightweight mode needs none of this — its live smoke is just: run
`npx wrangler dev`, paste a real key in the UI, and run one narrow
search (know-where + a single-airport region + know-when exact + "same
airport" = exactly 1 SerpApi call; this was done once against a real
response during development and the parser checked out). Everything
below applies to the Python backend only.

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

## Deploying (lightweight mode — Cloudflare Pages + one Worker, $0)

Everything is free tier; no domain purchase needed (`*.pages.dev` and
`*.workers.dev` URLs are permanent). A custom domain can be attached to
both later without config changes.

1. Create a free Cloudflare account.
2. **Worker first** (from a machine with this repo):
   ```bash
   cd worker
   npx wrangler login       # opens the browser for you to approve
   npx wrangler deploy
   ```
   Note the printed `https://smartflighter-proxy.<you>.workers.dev` URL.
3. **Pages**: Cloudflare dashboard → Workers & Pages → Create → Pages →
   connect this GitHub repo. Settings: root directory `frontend`, build
   command `npm run build`, output directory `out`. Add env var
   `NEXT_PUBLIC_PROXY_BASE` = the Worker URL from step 2. Deploy → you
   get `https://<project>.pages.dev`.
4. Allow the Pages origin to call the Worker: edit
   [`worker/wrangler.toml`](worker/wrangler.toml)'s `ALLOWED_ORIGINS`
   to include the pages.dev origin, then `npx wrangler deploy` again.
5. Share the pages.dev link. Each friend pastes their own SerpApi key
   (or `demo` to look around first). No accounts, no approval step —
   anyone with the link and a key can search, which is the accepted
   tradeoff of this mode.

The local dev proxy (`npx wrangler dev`) and the deployed Worker are the
same code; the live smoke test in this repo's history validated the
Worker + parsers against a real SerpApi response.

## Deploying the full backend instead (Render — optional alternative)

[`render.yaml`](render.yaml) still provisions the FastAPI backend +
Postgres + Redis (web service and Redis free indefinitely; **Postgres
free for 30 days**, then ~$6-7/mo or deleted after a grace period).
Steps: Render → New → Blueprint → this repo; enter the `sync: false`
env vars it prompts for (`API_KEY_ENCRYPTION_KEY` required — generate
fresh, never reuse the local one); migrations + seed run in the build
command; bootstrap an admin via the Shell tab
(`python -m app.cli make-admin YOUR_USERNAME`). Requires reverting the
frontend to the backend-wired version (git history) and pointing
`NEXT_PUBLIC_API_BASE` at the Render URL.

Neither deploy has been run end-to-end from this machine — account
creation and dashboard steps need a human; the configs are prepared and
locally verified, but **treat the first real deploy as unverified until
it's been run once.**

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
  as-is (inside a card, per the spec's own fallback) and extracts the
  plane mascot for the header/favicon with `rembg` (a trained
  salient-object segmenter — a plain color-distance flood-fill was tried
  first and rejected, since the background gradient overlaps the
  character's own highlights; see the script's docstring). Re-run
  `scripts/process_assets.py` (via its own venv, `scripts/.assets-venv`;
  `pip install -r scripts/requirements-assets.txt` first if the venv is
  new) if source assets change, then LOOK at the output before trusting
  it, per the script's own docstring.
- Two minor spec self-inconsistencies noted during planning, resolved in
  favor of §17/§31's own numeric definitions: §34's example calls a $112
  stopover "FREE CITY" though §17 caps that tier at $0 (GOOD VALUE is the
  correct label); `max_stops` is interpreted as counting ordinary
  connections only, separate from intentional stopovers.
- `search/jobs.py`'s job registry is single-process, in-memory-plus-Redis
  — fine for MVP 1 / local dev, not safe for a multi-worker deployment
  without a real task queue.
