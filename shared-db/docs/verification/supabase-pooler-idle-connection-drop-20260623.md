# Supabase pooler drops idle client connections — app connection-pool requirement (2026-06-23)

## What
The shared Supabase Postgres is reached by app backends **over TCP through the pooler** (no Cloud
SQL unix socket). The pooler **silently closes idle client connections**. Any app that keeps a
long-lived connection pool (Sequelize / node-`pg`, etc.) can end up holding a **half-open dead
socket**; the next query on it stalls on TCP retransmission for ~10–25s before the OS reports the
socket dead and the pool reconnects.

## Why this matters (incident)
In `designflow-tracking`, the `/sample/list` endpoint showed bimodal latency in Cloud Run logs —
~0.02s when warm, **10–26s on the first request after an idle gap**. The BFF proxy times out at
30s, so the slow first-hit intermittently returned 502 and surfaced as "Failed to load samples".
A bad query plan would be slow *every* time; the warm/cold split is the signature of connection
staleness, not the query.

## Required client pool settings (verified fix)
For any app backend connecting to the shared Supabase over TCP with a persistent pool:

- `pool.max` must be sized against the Supabase pooler's configured session limit. For the
  Designflow sandbox services using the shared Supabase pooler, keep app defaults at `5` unless
  the pooler plan/config is changed and a cross-service connection budget is recalculated.
- `pool.min = 0` — never hold an idle connection that can go stale.
- short `pool.idle` (~10s) + a `pool.evict` sweep (~5s) — close idle connections before the
  pooler does.
- `keepAlive: true` (+ `keepAliveInitialDelayMillis`) — OS TCP keep-alive so dead sockets are
  detected, not stalled on.
- `pool.acquire` and `connectTimeout` capped **below the caller's upstream timeout** (the BFF
  proxy is 30s) so a genuine connection problem fails fast instead of hanging for minutes.

Avoid the inverse (`min >= 1` without keepAlive, multi-minute `acquire`/`connectTimeout`) — it
reintroduces the stall.

## Follow-up incident: Designflow sandbox session-pool exhaustion (2026-07-09)

The Albert sandbox at `https://alsand.designflow.app/login` intermittently showed the SPA's
generic 503 banner and then loaded successfully on retry. This was not a shared database schema
problem and no database DDL or data migration was required.

Observed evidence:

- Public frontend HTML and BFF `/api/core/verifyToken` were usually healthy.
- Cloud Run logs showed `popcre-albert-item-sandbox` crashing during the first login/load burst.
- The item-master service logged:
  `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15`.
- The affected item-master revision was running `npm test && ... nodemon index.js` at Cloud Run
  container startup, so live traffic could arrive while Jest/nodemon startup work and DB auth were
  competing for the same Supabase pooler session budget.
- A rollout revision of core also logged skipped startup migrations with the same
  `EMAXCONNSESSION` message before the final runtime cleanup landed.

App-level remediation applied in the Designflow app repos:

- `designflow-item-master`
  - Cloud Run container now starts with `node index.js`, not `yarn start:$NODE_ENV`.
  - Cloud Build now runs unit tests before image build/deploy; tests are not run inside the
    Cloud Run runtime container.
  - `models/db.js` defaults `DB_POOL_MAX` to `5`, keeps `pool.min=0`, and retries transient DB
    auth failures such as `EMAXCONNSESSION`.
  - `index.js` waits for `db.ready` before `app.listen`, so the service does not accept traffic
    before DB authentication succeeds.
  - `cloudbuild.yaml` persists `DB_POOL_MAX=5` and `DB_AUTH_RETRIES=5` through future deploys.
- `designflow-backend` (core)
  - Cloud Run container now starts with `node index.js`, not `yarn start:$NODE_ENV`.
  - `models/db.js` defaults `DB_POOL_MAX` to `5`.
  - `cloudbuild.yaml` persists `DB_POOL_MAX=5` and `DB_AUTH_RETRIES=5`.
- `designflow-bff` and `designflow-data-syncing`
  - Cloud Run containers now start directly with `node`.
  - Unit tests moved to Cloud Build so runtime cold starts do not run Jest.
- Live Albert sandbox Cloud Run mitigation:
  - `popcre-albert-bff-sandbox`, `popcre-albert-core-sandbox`, and
    `popcre-albert-item-sandbox` have `minScale=1`.
  - Core and item-master Cloud Run env includes `DB_POOL_MAX=5` and `DB_AUTH_RETRIES=5`.

Shared-db governance conclusion:

- No Supabase schema change was made.
- No migration SQL was required or applied.
- The fix belongs in app runtime/deploy configuration plus this shared DB operational guidance,
  because the observed failure was pooler session exhaustion and startup behavior against the
  existing shared Supabase database.

## Follow-up source and runtime audit (2026-07-17)

The July 9 entries above describe the mitigation that was applied then; they are not a claim
that all four services now share one complete lifecycle. A fresh `sandbox-albert` source audit
and live Albert sandbox configuration audit found:

| Service | Source default `pool.max` | Retried auth | `db.ready` + listen gate | Live sandbox override |
|---|---:|---|---|---|
| Backend | 5 | Yes | No | max 5, retries 5 |
| Item Master | 5 | Yes | Yes | max 5, retries 5 |
| Tracking | 22 | No | No | none; inherits source |
| Data Syncing | 22 | No | No | none; inherits source |

All four live sandbox services use the same Supavisor session-mode endpoint (`:5432`), role,
and database, so their per-instance maxima are additive. The Supabase Management API exposes
the separate transaction endpoint (`:6543`) but currently returns no explicit
`default_pool_size` or `max_client_conn` for this platform-managed project. The last observed
effective session ceiling remains the July 9 `EMAXCONNSESSION` value of 15 and must be
re-confirmed before any pool or instance maximum is increased.

The local password-login failure is frontend-direct: the Angular local environment posts
`/findUserLoginInfo` to Backend on port 5000. It does not traverse the BFF locally. The BFF's
30-second normal-route timeout remains relevant to deployed verification, not the local timing
measurement. The complete corrective implementation and evidence gates are in the repository
root [`fix_connection_pool.md`](../../fix_connection_pool.md).

## Affected apps
- Confirmed: **designflow-tracking** (PM/PIM tracking service). Implementation:
  `models/db.js`; guarded by `tests/unit/db.migration.test.js`; app commit `6d22d93` on
  `sandbox-albert`.
- Confirmed: **designflow-backend** and **designflow-item-master** need conservative pool defaults
  against the shared Supabase pooler. As of 2026-07-09, both use `DB_POOL_MAX=5` for the Albert
  sandbox and keep the same `pool.min=0`, short idle/evict, and keep-alive pattern.
- Audited 2026-06-23:
  - `u2giants/popcrm-web` is a static browser app. It uses `@supabase/supabase-js` in
    `src/lib/supabase.ts` and has no Sequelize/`pg` dependency or server-side Postgres pool in
    the app repo.
  - `u2giants/poppim-web` is a static browser app. It uses `@supabase/supabase-js` in
    `src/lib/supabase.ts` and has no Sequelize/`pg` dependency or server-side Postgres pool in
    the app repo.
  - `u2giants/popdam3` uses `@supabase/supabase-js` for the browser, Railway worker, bridge
    agent, Realtime watcher, and Supabase Edge Functions. No Sequelize/`pg` dependency or
    persistent direct-Postgres pool was found in the scanned PopDAM runtime packages.
  - `u2giants/directus` has one direct `pg` caller in `pm-system/sync-plm-masters.mjs`, but it
    creates a single `pg.Client`, connects to the local Directus Postgres URL from
    `pm-system/run-plm-sync.sh`, runs one transaction, and calls `client.end()`. It is not a
    long-lived shared-Supabase pool and is not exposed to this specific idle pooler failure mode.
- Still applicable to any future backend that uses a persistent Sequelize/`pg` pool against the
  shared Supabase pooler. Audit new workers/services against the settings above before deploying.

## Verification
- Diagnosed from Cloud Run `httpRequest.latency` logs (bimodal warm/cold pattern) on
  `popcre-albert-tracking-sandbox`.
- Fix deployed to sandbox tracking revision `…-00020-89v`; full unit suite green (89/89).
- Not yet observed in production for tracking because the `/sample` backend is not on `develop`
  yet (separate prod-merge handoff in the app repo).
- Cross-app audit performed from fresh local clones under `.audit-repos/` on 2026-06-23:
  `u2giants/popcrm-web`, `u2giants/poppim-web`, `u2giants/popdam3`, and `u2giants/directus`.
  Searches covered `sequelize`, `pg`, `new Pool`, `new Client`, `DATABASE_URL`, pool settings,
  keep-alive/timeouts, and Supabase clients in runtime source paths and package manifests.

## How to verify elsewhere
Pull the service's Cloud Run request logs and look for a rarely-hit endpoint whose latency is
fast when called in bursts but ~10–25s on the first call after an idle period. If present, audit
that service's DB pool config against the settings above.
