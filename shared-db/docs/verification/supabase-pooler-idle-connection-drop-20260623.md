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

- `pool.min = 0` — never hold an idle connection that can go stale.
- short `pool.idle` (~10s) + a `pool.evict` sweep (~5s) — close idle connections before the
  pooler does.
- `keepAlive: true` (+ `keepAliveInitialDelayMillis`) — OS TCP keep-alive so dead sockets are
  detected, not stalled on.
- `pool.acquire` and `connectTimeout` capped **below the caller's upstream timeout** (the BFF
  proxy is 30s) so a genuine connection problem fails fast instead of hanging for minutes.

Avoid the inverse (`min >= 1` without keepAlive, multi-minute `acquire`/`connectTimeout`) — it
reintroduces the stall.

## Affected apps
- Confirmed: **designflow-tracking** (PM/PIM tracking service). Implementation:
  `models/db.js`; guarded by `tests/unit/db.migration.test.js`; app commit `6d22d93` on
  `sandbox-albert`.
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
