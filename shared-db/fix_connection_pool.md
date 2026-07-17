# DesignFlow database connection-pool remediation plan (v2.1 — corrected)

**Date:** 2026-07-17

**Status:** Plan only; supersedes the original 2026-07-17 version. Implementation not started.

**Provenance:** Root cause re-ranked and scope corrected after critique, then independently
reviewed by two separate engines (Kimi K2 and GPT-5.6/Codex at medium effort). v2.1 folds in
Codex's corrections — most importantly that an `AcquireTimeout` does **not** prove local pool
contention (the acquire clock also covers slow connection creation), so latency and contention
are treated as interacting causes to be disambiguated by measurement (§2, §5 A0).

**Scope:** Local DesignFlow development (affected workstation in India) and the deployed Cloud
Run services, all against the shared hosted Supabase project `qsllyeztdwjgirsysgai`.

**Schema impact:** Exactly one sanctioned schema workstream: relocating `designflow-backend`'s
inline startup DDL into `u2giants/shared-db` migrations (Workstream S, §4). No other database
object, data, role, policy, or Supabase setting may change.

## 1. Incident summary

After starting the DesignFlow services locally, the first login's `getUserLoginInfo` query fails
with `SequelizeConnectionAcquireTimeoutError: Operation timeout`. Credentials are valid, a manual
connection succeeds, `pg_stat_activity` shows no leaked/blocked DesignFlow sessions, and warm
retries succeed. A fresh connection from the developer's location (India) to AWS `us-east-1`
takes ~11–12 s.

Success is a repeatable cold-start test — login **and** the first authenticated page load (the
Angular app fans out to several services at once, not just the backend) — with no acquire
timeout, no `EMAXCONNSESSION`, no session termination, and measured connections inside the
documented shared budget.

## 2. Root cause (corrected ranking — read first)

The original plan named the 11–12 s cold handshake the primary root cause and ranked everything
else as an amplifier. That was too simple — but the opposite claim ("contention, not latency")
is **also wrong**, and an earlier draft of this section asserted it. `SequelizeConnectionAcquireTimeoutError`
does **not** prove a connection existed but was busy. Sequelize's acquire timer is armed before
connection creation and clears only when `factory.create()` delivers a usable connection, so it
covers the *entire* creation of a new connection — not just the raw handshake, but node-postgres
auth, Sequelize post-connect setup (`SET client_min_messages`, timezone, type/OID discovery),
**and** Supavisor session-mode queueing, which Supabase documents can stall a new client for up
to ~60 s when backend capacity is occupied. A single cold connection against an empty,
*uncontended* local pool can therefore exceed the 20 s acquire budget and throw this exact error.
(If instead the raw node-postgres handshake exceeds `connectTimeout=15000`, the usual result is a
connection error, not an acquire timeout — so the presence of an *acquire* timeout points at
total resource-creation time and/or pool waiting, not the bare TCP/TLS handshake.)

The corrected model is **slow cold resource-creation and contention interacting**, not one to the
exclusion of the other. A0 (§5) must measure which dominates before rollout; the fix addresses
both (remove the DDL churn, gate readiness, bound the timeouts, protect the shared budget). The
mechanisms below are ranked most-to-least likely from current evidence, but the ranking is a
hypothesis A0's A/B matrix (§5, A0-1) must confirm — "backend alone reproduces" narrows the cause
but does **not** by itself separate the DDL burst from slow connection creation, since both occur
in the same cold start.

### 2.1 Mechanism (a): backend startup DDL burst saturating its own max-5 pool

Strong candidate (reproduces with the backend ALONE), to be confirmed by A0. After
`authenticate()` succeeds, `designflow-backend/models/db.js:103-295` fires `sequelize.sync()`
plus **43 fire-and-forget `sequelize.query()` statements** (counted 2026-07-17; inventory in
§4.1) with no `await`. Sequelize does **not** globally serialize separate `sequelize.query()`
calls: each acquires a pooled connection, the pool opens up to 5 concurrently, and the remainder
queue. From India each *new* connection pays the ~11–12 s handshake, and the burst contains
`ALTER TABLE` / `CREATE INDEX` / a backfill `UPDATE` / a `DROP` / `sequelize.sync()` catalog work
that can take real time or hold locks that serialize other statements on the same tables. Forty-four
units of work churning a 5-connection pool can queue the first login's acquire past 20 s —
matching the symptom (auth OK, next query acquire-timeout, warm retry OK). **Caveat:** if these
are all already-applied no-ops, five established connections might drain them in a few seconds; so
mechanism (a) is *plausible and must be removed regardless*, but its actual sufficiency is an A0
finding (G3), not an assumption.

### 2.2 Mechanism (b): cross-service cold-start burst against the Supavisor session ceiling

All four services connect to the same role/database via Supavisor **session mode :5432**, whose
last observed ceiling was **15** (`EMAXCONNSESSION`, 2026-07-09). Starting four services together
demands up to 5+5+22+22 = 54 concurrent sessions from local defaults alone — the 2026-07-09
failure path. Session-mode queueing at Supavisor (above) means this contention is felt *during
connection establishment*, consuming the acquire budget rather than appearing as a busy local
pool.

### 2.3 Mechanism (c): cold resource-creation itself (can be sufficient alone)

The ~11–12 s India→us-east-1 handshake plus Sequelize post-connect init and any Supavisor session
queue is not merely a "regression amplifier" — per the acquire semantics above it can *by itself*
push a single connection's creation past the 20 s acquire budget. It also multiplies mechanism
(a) (every connection in the churn pays it) and makes every post-eviction cold acquire slow
(`pool.min=0` + `idle=10000` + `evict=5000` means later requests can legitimately be cold again).
It warrants bounded headroom **and an investigation into its cause** (§5, A0-5/A3): a ~12 s
handshake to us-east-1 is abnormal, so "buy headroom" is the fallback, not the default fix.

### 2.4 Contributing factor: missing readiness gates

Backend, Tracking, and Data Syncing call `app.listen()` without awaiting a retried
database-readiness promise, so the first user request pays the cold acquire. Gating `listen()`
on `db.ready` is a real symptom fix — **with one subtlety**: if `db.ready` wraps today's
`initialize()`, it resolves right after `authenticate()`, *before* the fire-and-forget DDL
block finishes, so readiness gating alone does **not** stop mechanism (a). That is a second
reason Workstream S (§4) is required, not optional.

### 2.5 What is not a root cause

- Credentials, schema defects, query plans, abandoned server sessions (evidence §1). Note that
  `pg_stat_activity` alone cannot exonerate the pooler: a client queued at Supavisor may never
  appear as a backend Postgres session, so "no leaked/blocked sessions" does not rule out
  session-mode capacity queueing (§3.3, A0-3).
- BFF timeouts: local login hits the backend direct port 5000, not the BFF; the 30 s
  normal-route ceiling (`designflow-bff/routes/api.js:11`) is only a deployed safety bound.
- `pool.min=0` + idle eviction and TCP keep-alive: kept, but they are **two different
  protections, not one** — `min=0`+eviction conserves scarce shared sessions, while keep-alive
  only keeps a live socket's health detectable. Neither prevents the other's failure mode, and
  keep-alive does **not** stop an idle pool member being evicted after 10 s. The stale
  half-open-socket protection they jointly provide is intentional (see
  `docs/verification/supabase-pooler-idle-connection-drop-20260623.md`); it stays.

## 3. Verified current state (2026-07-17, all repos on `sandbox-albert`)

### 3.1 Services, pools, readiness

All four Sequelize services share identical `buildPoolOptions`/`buildDialectOptions`:
`min=0`, `acquire=20000`, `idle=10000`, `evict=5000`, `connectTimeout=15000`, `keepAlive=true`,
`keepAliveInitialDelayMillis=10000`.

| Service | `pool.max` default | Retried `authenticate()` | `db.ready` | Awaits readiness before `listen()` |
|---|---:|---|---|---|
| Backend (`models/db.js`, `index.js:43-54`) | 5 | Yes (`models/db.js:51-68`, linear `min(1000·n,5000)`) | No | **No** |
| Item Master (`models/db.js:67`, `index.js:42-56`) | 5 | Yes (`models/db.js:42-65`, linear `1000·n`; classifier matches `EMAXCONNSESSION`) | Yes | Yes, `process.exit(1)` on failure — **the reference** |
| Tracking (`models/db.js`, `index.js:42-109`) | **22** | **No** (single `authenticate()`) | No | No — runs 4 startup cache `findAll()`s (LicenseFeedBacks, LicensingTime, merchGroup, FactoryTime) then `listen()` |
| Data Syncing (`models/db.js`, `index.js:44-53`) | **22** | **No** | No | **No** — `listen()` immediately |

None of the four has `config/database-pool.js`, `helpers/graceful-shutdown.js`,
`helpers/db-pool-observability.js`, or any SIGINT/SIGTERM handler.

BFF: `BFF_PROXY_TIMEOUT_MS` default **30000** (normal routes), `BFF_AI_PROXY_TIMEOUT_MS` default
**120000** (AI chat only), `routes/api.js:11,21`; existing `tests/unit/proxyTimeout.test.js`.
No DB code; not in the local failing path.

### 3.2 Backend inline startup DDL inventory (the critical finding)

`designflow-backend/models/db.js:103-295`, all fire-and-forget after `authenticate()`:

| Group | Count | Lines | Objects |
|---|---:|---|---|
| `sequelize.sync()` | 1 | 103 | probes/creates for every registered model, every boot |
| `ADD COLUMN IF NOT EXISTS` | 31 | 108-294 | `RFQItem` ×21 (incl. 16 buyer target/margin cols, 176-207), `customers.customers_logo` (110), `users` ×3 (144-153), `vendor.vendor_profile_photo` (156), `RFQVendor` ×3 (237-253), `Factory.factory_country` (257), `GridViewState.column_group_state` (294) |
| `ALTER COLUMN TYPE` | 1 | 115 | `comments.comment` → `VARCHAR(500)` |
| `CREATE TABLE IF NOT EXISTS` | 3 | 117, 121, 276 | `app_settings`, `ai_cache_events`, `grid_cell_notes` |
| `CREATE INDEX IF NOT EXISTS` | 4 | 140, 142, 287, 289 | `ai_cache_events` ×2, `grid_cell_notes` ×2 |
| Seed `INSERT` | 2 | 211, 218 | `UIElements` 'rfq_buyer_margin'; `RolePermissions` grant for Adam Dweck (`adweck@popcre.com`) |
| Data backfill `UPDATE` | 1 | 261 | `Factory.factory_country` from majority `vendor_country` |
| `DROP COLUMN IF EXISTS` | 1 | 232 | orphan lowercase `RFQItem."rfqitem_price_sales_snapshots"` |

These statements violate Albert's standing rule (shared-db `AGENTS.md` §0): **every** schema/DDL
change to `qsllyeztdwjgirsysgai` is authored in `u2giants/shared-db`, never inline in an app
repo. They are also the likely primary root cause (§2.1a). Both point to the same fix:
Workstream S.

### 3.3 Platform and deployment facts

- Endpoint: Supavisor **session mode :5432**, same role/database, shared with CRM/DAM/PIM.
  (A separate dflow Cloud SQL path exists for ERP enrichment; it is not these services.)
- Supabase Management API does **not** expose the platform-managed session allowance; last
  observed effective ceiling **15** (2026-07-09). Treat as warning, not assurance. The "15" is
  itself unclassified — it could be max Supavisor client connections, the session-mode allowance
  for this tenant/role, the Supavisor backend pool size, or raw database backend capacity. These
  are different constraints with different remedies; A0-3/G2 must determine which it is, using
  Supabase pooler-client observability (not only `pg_stat_activity`, which does not see clients
  queued at the pooler).
- Cloud Build: backend and item-master set `DB_POOL_MAX=5`, `DB_AUTH_RETRIES=5`
  (`cloudbuild.yaml` substitutions). **Tracking and Data Syncing set neither** — production
  inherits the code default 22. `_CONCURRENCY`/`_MAX_INSTANCES` come from trigger substitutions
  (per prior verified state: concurrency 100, max-instances 10; min-instances: core/item-master
  1, tracking/data-syncing 0). Deployed `SCHEMA` also comes from a trigger substitution
  (`_DB_SCHEMA`), not from the repo.
- Scale-out envelope vs ceiling: per-process pool limits are only half the calculation. The
  full potential-client count is
  `Σ(pool.max × active instances) + local developers + migrations/operators + other apps sharing
  this role/pooler tenant + platform services`. Even at max=5, 5×10 instances = 50 sessions **per
  service**; at tracking/data-syncing's 22×10 it is 220 per service; even the local override of
  max=2 across four services × 10 instances is 80 — all far above the ~15 shared ceiling before
  adding the other terms. Lazy `min=0` pools make real usage far lower, but the envelope is not a
  capacity guarantee. Explicitly lowering 22 is necessary but **not sufficient**: this math must
  be documented and escalated as an environment-capacity risk (§5, A4) — not silently ignored and
  not "fixed" by changing scaling limits inside this incident.

## 4. Workstream S — relocate the backend startup DDL into shared-db

First-class workstream, executed under the shared-db protocol (`C:/repos/shared-db/AGENTS.md`).
Per `AGENTS.md` §1–§2 the **AI owns all git mechanics in shared-db**: it branches, opens the PR,
runs the §5 checklist, and **merges the shared-db PR itself** — Albert does not merge here.
Escalate to Albert only for the destructive `DROP` sign-off (anti-collision rule) and to confirm
the production-apply window. Preview always before prod.

### S0 — protocol constraints (before writing any SQL)

- **One schema change in flight at a time.** The ERP mirror relocation is currently in flight
  (`fix_schema_for_api.md`, phase 1 live, phases 2–5 pending). Run the §6 checks
  (`gh pr list`, `git branch -a && git ls-remote`, `ls supabase/migrations`,
  `git status --short`) and serialize: land or explicitly coordinate with Albert before opening
  this one.
- Branch + PR in `u2giants/shared-db`; `scripts/check-sql.sh` passes;
  `supabase db push --dry-run` clean on preview branch `xjcyeuvzkhtzsheknaiu`; apply to preview
  and verify; the AI merges to `main` per §5 (auto-syncs `shared-db/` into consumers); promote to
  production `qsllyeztdwjgirsysgai` in an approved window.
- New timestamped migration file(s) only. Never edit an applied migration.
- Additive by default. The single `DROP COLUMN IF EXISTS` (orphan
  `rfqitem_price_sales_snapshots`) is a drop — handle it **separately** from the additive work:
  identify why the orphan exists, confirm no consumer reads it, and require explicit owner
  sign-off per anti-collision rule 3. If S1 shows production already lacks the column, prefer an
  **assertion documenting the intended absence** over replaying a destructive `DROP`. It is
  cleanup, not required for the fix: defer it to a later migration unless Albert explicitly
  approves it in the PR.
- Do not modify mirrored `shared-db/` folders inside DesignFlow repos.

### S1 — inventory and live-state reconciliation

1. Enumerate every statement from §3.2 with target object, idempotence, and a verification
   query (`information_schema.columns/tables/indexes`, `pg_indexes`) against production through
   an approved authenticated path.
2. **Do not stop at the 43 explicit statements — hunt the whole startup surface.** Grep all four
   services for `sync`, raw `query(` DDL, model hooks that create objects, and startup
   seed/backfill code, so nothing that mutates shared schema is left behind. `sequelize.sync()`
   (backend `models/db.js:103`) is explicitly in scope for this inventory (it probes/creates for
   every registered model), even though its *removal* is a separately gated follow-up (S4.2).
3. Record the non-secret deployed `SCHEMA` value (trigger substitution `_DB_SCHEMA`; also
   visible in service startup logs and `docs/unified-supabase-schema-map.md`). Migrations must
   qualify that schema. Never record credentials.
4. **Verify actual live state per object — do not assume it exists.** The statements are
   fire-and-forget with `.catch()` swallowing failures, so an object may have *failed silently*
   on past boots; live state cannot be inferred from source. Inspect **preview and production
   independently**. For each object confirm it exists **with the exact intended definition**
   (types, defaults, nullability, constraints, indexes, ownership/grants, and for indexes the
   full definition, not just the name). Any object that is missing, or whose live definition
   differs from the inline DDL (e.g. a column widened manually since), is a **finding to resolve
   with Albert before authoring** — not something to paper over with `IF NOT EXISTS`, which can
   hide incorrect state.

### S2 — author the migration(s)

- Prefer a **logical split**: structure (additive DDL) / seeds / backfill, so a slow index build
  or backfill is separable from quick additive changes and can carry its own timeouts. A
  reconciliation migration is **not** a blind replay of the inline SQL with `IF NOT EXISTS`: for
  each object, define the intended final schema, create what is missing, correct compatible
  differences **explicitly**, and **fail loudly on an incompatible existing definition** rather
  than silently accepting it.
- Apply appropriate `lock_timeout`/`statement_timeout` to operations that can take locks or real
  time (`ALTER TABLE`, `CREATE INDEX`, the backfill); do not let a reconciliation statement block
  live traffic unboundedly.
- **Indexes:** compare full definitions, not just names (a name match with a different definition
  is a finding).
- `comments.comment` widen becomes a plain one-time `ALTER COLUMN ... TYPE VARCHAR(500)`
  (verify live type is already 500 from S1; if so the statement is a no-op safeguard).
- **Data statements get explicit handling — never silently dropped:**
  - `Factory.factory_country` backfill (line 261): make it **restart-safe and bounded**, keep the
    NULL-guard so it cannot overwrite newer legitimate values, and record before/after row counts
    as verification. Include as a one-time data migration.
  - `UIElements` seed + `RolePermissions` grant for Adam Dweck (lines 211, 218): use a **stable
    unique key and deterministic upsert** (the existing `WHERE NOT EXISTS` guard qualifies).
    Albert decides at PR time whether user-specific grants belong in shared-db long-term; record
    the decision in the PR description. Do not drop them to "keep the migration clean."
- Gate: `scripts/check-sql.sh` passes; `supabase db push --dry-run` on preview shows only the
  intended statements.

### S3 — preview, then production

1. Apply to preview `xjcyeuvzkhtzsheknaiu`; verify every object exists with the intended
   definition and the app boots against preview with the inline block still present.
2. **Prove coexistence explicitly — do not just assert idempotence.** Between the migration
   deploy and the S4 app removal, an *old* backend can restart and replay the whole inline block
   against the newly reconciled schema. Confirm from the preview boot that this produces: no
   duplicate-column/definition failure, no conflicting index definition, no repeated destructive
   DML, no seed overwrite, no `sequelize.sync()` alteration conflicting with the migration, and
   no unhandled promise rejection (each statement's `.catch()` must actually absorb its error).
   If coexistence is *not* provably safe, insert an intermediate app version that disables the
   dangerous operations without assuming the new schema, before S4.
3. The AI merges the PR per the §5 checklist (auto-syncs `shared-db/` into consumers); Albert is
   looped in only for the production-apply window and any destructive-drop approval.
4. Promote to production in an approved window; re-run the S1 verification queries against
   production and record evidence.

### S4 — remove the inline block from the app (only after S3 is confirmed in prod)

1. Remove the 43-statement block from `designflow-backend/models/db.js:103-295` in the backend
   Slice-A PR. There must never be a window where **neither** side provides the schema:
   migrations confirmed in preview **and** prod first, app removal second. Brief overlap where
   **both** provide it is safe (idempotent).
2. `sequelize.sync()` (line 103) is part of the burst but covers every model, not just the
   inventoried objects. Removing it is a **separately gated follow-up**: only after table-level
   reconciliation proves every model's table exists in the shared-db-managed schema. Until
   then it stays, with its cost noted in the measurement baseline.
3. Regression guard: extend the backend's existing migration-ordering test
   (`tests/unit/db.migration.test.js`) so the inline block cannot silently return.

## 5. Slice A — the incident fix

Ordered: A0 measurement → Workstream S → A1/A2 app changes → A3/A4 budgets → A5 acceptance.

### A0 (Phase 0) — baseline measurement and runtime gates

**Repos changed:** none. Record evidence as `qa-artifacts/connection-pool/baseline-YYYYMMDD.md`
in Backend, one row per run (UTC timestamp, repo SHAs, node version, cold/warm, service-start
and db-ready times, login status/duration, `findUserLoginInfo` status/duration, handshake
duration, acquire-timeout count, `EMAXCONNSESSION` count, retry count, peak sessions, redacted
error category). Never record endpoints, usernames, or passwords.

1. **Reproduce, then isolate with an A/B matrix.** ≥5 fully cold runs (all Node processes
   stopped ≥15 s — longer than the 10 s idle eviction — then four terminals
   `$env:NODE_ENV='localhost'; node index.js`, frontend `npm start`, one immediate login, then
   the first authenticated page load) plus warm reruns. "Backend alone reproduces" narrows but
   does **not** separate the DDL burst from slow connection creation, so run a controlled matrix:
   - **backend startup DDL + `sync()` enabled** vs **disabled** (temporary local toggle);
   - each at pool `max = 1, 2, 5`;
   - for every run record: raw node-postgres connect duration, Sequelize factory duration through
     `afterConnect`, acquire wait, pool `size/using/available/waiting`, each startup statement's
     duration and result, and first-login duration + exact error.
   If disabling the DDL+`sync()` **eliminates** the failure across repeated cold starts while
   connect timings stay comparable, mechanism (a) is established (G3). Classification key:
   - failure disappears when DDL/`sync()` disabled, connect timings unchanged ⇒ mechanism (a).
   - failures only when ≥2 services start together, and/or any `EMAXCONNSESSION` ⇒ mechanism (b).
   - failure persists backend-alone with DDL disabled and slow factory/connect durations ⇒
     mechanism (c), cold resource-creation itself; pursue A0-5/A3, not just a timeout raise.
2. **Handshake tail gate.** Take a **large** cold sample (≥50 `authenticate()` cold connects; 20
   is a floor, not a target) from the India workstation and measure **p99**, not only p95 — the
   tail is what produces the intermittent failure, and the *full* factory-create time (handshake
   + Sequelize post-connect setup + any Supavisor session queue) is what consumes the acquire
   budget, so measure end-to-end factory time, not the bare TCP/TLS handshake. A 20 s local
   connect timeout is accepted **only if p99 ≤ 15 s** with margin. If not, stop before rollout;
   do not improvise a larger timeout (see §12).
3. **Session-allowance gate.** Re-confirm the Supavisor session allowance and **classify what the
   observed "15" actually is** (max Supavisor clients vs session-mode allowance vs Supavisor
   backend pool size vs database backend capacity — G2). Use Supabase **pooler-client
   observability**, not only `pg_stat_activity` (which cannot see clients queued at the pooler);
   a controlled connection test is a fallback. The Management API did not expose it on 2026-07-17
   — record that. Budget against the more conservative of the current value and 15, reserve ≥20%
   free. An unknown limit is never permission to consume it.
4. **Production pool-usage gate (for A4).** Measure tracking/data-syncing real concurrent pool
   usage under production load using the **A2b committed pool-snapshot instrumentation** (pool
   `size/using/available/waiting`), corroborated by Cloud Run metrics and read-only
   `pg_stat_activity` counts by role/client_addr (noting `pg_stat_activity` misses pooler-queued
   clients; full application-name labeling arrives in B1). This number is currently unknown — do
   not choose the production `DB_POOL_MAX` without it.
5. **Handshake-cause investigation (feeds A3).** Break the ~12 s into DNS / TCP / TLS /
   Supavisor-auth segments with a timed controlled connection; compare another network;
   check IPv6-vs-IPv4 fallback and resolver latency. Cause is currently unknown — record
   findings; "buy headroom" is the fallback, not the default.

**Gate:** ≥5 cold + ≥5 warm runs recorded; failure classified as (a), (b), or both; the three
runtime gates have recorded values.

### A1 — readiness gating (backend, tracking, data-syncing)

Follow the Item Master reference exactly; preserve synchronous model registration before the
first `await` (`Object.assign(db, require('./db/init-models')(sequelize))` ordering).

- **Backend** `models/db.js`: assign `db.ready = initialize()`; `index.js`: `await db.ready`
  before `app.listen()`; on readiness failure log one fatal line and exit nonzero. (After S4,
  `db.ready` covers authenticate only — that is correct and sufficient once the DDL burst is
  gone.)
- **Tracking** `models/db.js`: add `db.ready`; `index.js`: `await db.ready` **before** the four
  startup cache `findAll()`s, then `listen()`; keep the existing `process.exit(1)` path.
- **Data Syncing**: add `db.ready`; `await` before `listen()`; exit nonzero on failure.
- Do **not** add `sync()`, DDL, or any mutation to the readiness path. Retry standardization is
  Slice B; A1 adds only the minimal retry needed for tracking/data-syncing cold starts, using
  the A2 policy.

### A2 — retry policy must not amplify a ceiling burst

Small targeted change to the two existing retriers (backend `models/db.js:51-68`, item-master
`models/db.js:42-65`), and the policy the new tracking/data-syncing retries must follow:

- Classify **ceiling errors specifically** (`EMAXCONNSESSION`, or message
  `max clients reached in session mode`): **jittered exponential backoff with a longer initial
  delay** (base ≈5 s, full jitter, cap ≈60 s, bounded total startup budget ≈120 s, then exit
  nonzero). Never the tight 1/2/3/4/5 s linear pattern — four services booting together would
  retry in lockstep against a hard ~15-connection ceiling. Exact constants are implementation
  details within these bounds.
- Other transient errors (08xxx, `EAUTHTIMEOUT`, `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`):
  modest jittered backoff.
- Non-transient errors — `28P01` invalid credentials, SSL/config errors, programming/schema
  errors — fail fast, no retry.
- Bound the total retry budget within the platform startup allowance; ensure each failed
  connection attempt is actually cleaned up (no leaked half-open sockets accumulating against the
  ceiling); and remember authenticate retry does not fix a *query-time* pool-acquire backlog.
- After retries are exhausted, log the final classified cause and exit nonzero — but avoid
  synchronized exits and Cloud Run restart loops (the jitter above plus the documented startup
  stagger reduce lockstep restart storms across services).
- Never log passwords/URLs; log attempt, elapsed ms, safe error category.
- **Near-zero-cost mitigation to document for local dev:** stagger service starts — start the
  backend first, wait for its ready log, then start the rest. No launcher is added; this is a
  documented startup order only.

### A2b — minimal committed pool instrumentation (measurement cannot be fully deferred)

A4 chooses production pool sizes "from measurement" and A0 proves causation from pool state — but
the full observability framework is Slice B (B4). That is circular. Land a **lightweight,
committed** subset now (a strict, low-risk piece of B4, not the `WeakMap`/hook framework): a
periodic structured single-line log of pool `size/using/available/waiting`, connection-creation
and acquire elapsed ms, startup-step durations, and retry attempt + classified error, tagged with
service name, instance id, and (once A3/B1 labeling exists) `application_name`. No SQL text, bound
values, URLs, credentials, JWTs, or user identity. This is what makes A0's A/B matrix and A4's
production measurement real; B4 later replaces it with the full hook-based version.

### A3 — local timeout headroom (bounded, gated, workstation-only)

On the affected workstation, via untracked `.env.localhost` only (never committed):

```text
DB_POOL_MAX=2            # see budget formula below
DB_POOL_MIN=0
DB_CONNECT_TIMEOUT=20000 # only if A0 handshake p99 ≤ 15 s (G1)
DB_POOL_ACQUIRE=25000    # stays below the 30 s BFF normal-route ceiling
DB_POOL_IDLE=10000
DB_POOL_EVICT=5000
DB_AUTH_RETRIES=5
DB_APPLICATION_NAME=designflow-<service>-localhost   # if labeling lands early; otherwise Slice B
```

Local slot budget: `safe_client_slots = floor(current_allowance × 0.80) − observed_nonlocal_peak`.
Four services at max 2 need 8 slots; at 4–7 slots use max 1; below 4, run the backend plus one
service at a time and escalate the allowance as an environment-capacity risk. Never set max < 1
or exceed the formula. Production defaults do not change here. Record the A3 investigation
findings (why ~12 s) alongside; if the cause is fixable outside this incident (DNS, route,
edge), open it as its own follow-up.

### A4 — pool budgets as explicit, measured production decisions

- **Tracking and Data Syncing**: set the intended production `DB_POOL_MAX` **explicitly in each
  repo's `cloudbuild.yaml`** (same substitution pattern backend/item-master use), justified by
  the A0 item-4 measurement. Do **not** flip the code default 22→5 in the dark — the code
  default change is deferred to Slice B (B1), where it lands after production is pinned and
  measured. If measurement shows either service genuinely needs >5 under real request
  concurrency (100/instance), surface that to Albert with evidence instead of silently picking
  a number.
- **Document and escalate the envelope math** (§3.3): per-service max × max-instances vs the
  ~15 session ceiling breaches budget even at 5×10. Treat as an environment-capacity risk for
  Albert; structural answers (transaction-pooler evaluation for suitable workloads, scaling
  policy, pooler tuning) are architecture decisions outside this incident. This work changes no
  Cloud Run scaling or Supabase limit.
- Validate under real concurrency: sandbox soak shows tracking/data-syncing operate within the
  chosen max (no acquire timeouts, pool-wait evidence).

### A5 — Slice-A acceptance test

≥10 fully cold cycles from the affected workstation, each covering login **and** the first
authenticated page load (post-login fan-out to backend/item-master/tracking/data-syncing):

- 10/10 cold first-attempt successes; zero `SequelizeConnectionAcquireTimeoutError`; zero
  `EMAXCONNSESSION`; no relevant 5xx or BFF normal-route timeout in deployed checks.
- Every service logs database readiness before its HTTP-listening line.
- Peak local DesignFlow sessions inside the A0 budget; warm behavior not materially regressed.
- Backend boot logs show no inline DDL burst (post-S4).
- No session-termination query used anywhere.

Failure classification (from the original, kept): connect reaches 20 s → network-route/DNS
investigation + controlled pooler-mode comparison, not a timeout raise; acquire waits with fast
connects → pool demand/budget; query dominates after acquire → separate query defect; Supavisor
limit → recalculate all service × instance pools before touching any limit.

## 6. Slice B — hardening (after Slice A is verified; must not gate the fix)

Sequenced after A5 passes, as separate PRs so Uma's review stays small.

- **B1 — config module + bounded parser** (4 services): new `config/database-pool.js` is the
  only place pool env is parsed; bounded integer parser fails startup loudly on invalid /
  out-of-range values (variable name + safe range; no secrets). Invariants: `DB_POOL_MIN == 0`;
  `DB_POOL_MAX >= 1`; `0 < DB_POOL_EVICT <= DB_POOL_IDLE`; `DB_CONNECT_TIMEOUT <
  NORMAL_PROXY_TIMEOUT_MS`; `DB_POOL_ACQUIRE < NORMAL_PROXY_TIMEOUT_MS`;
  `NORMAL_PROXY_TIMEOUT_MS = 30000` documented as mirroring the BFF default (services must not
  read `BFF_*`). **Now** flip tracking/data-syncing code default `DB_POOL_MAX` 22→5 (production
  already pinned in A4). Add `DB_APPLICATION_NAME` to dialect options, default
  `designflow-<service>-${NODE_ENV}`, validated `^[a-z0-9-]{1,63}$`.
- **B2 — standardized retry module** (4 services): one consistent `authenticateWithRetry()` +
  exported `isTransientConnectionError()` implementing the A2 policy (ceiling-aware jittered
  backoff; fail-fast for 28P01/SSL/programming); inject sleep in tests. Four small matching
  modules, **no new cross-repo npm package** during this incident.
- **B3 — graceful shutdown** (4 services): `helpers/graceful-shutdown.js`,
  `installGracefulShutdown({ server, sequelize, logger, exit, timeoutMs })`; one handler for
  SIGINT+SIGTERM, single-run guard; order: `server.close()` → `closeIdleConnections?.()` →
  bounded drain → `sequelize.close()` once → exit 0; 10 s deadline → `closeAllConnections?.()`,
  exit 1; close rejection → exit 1. No `pg_stat_activity` reads or termination during shutdown.
- **B4 — observability + labels**: `helpers/db-pool-observability.js` using Sequelize v6
  `beforePoolAcquire`/`afterPoolAcquire` + `WeakMap` + `process.hrtime.bigint()`; structured
  single-line events (service label, auth elapsed, acquire elapsed ≥1000 ms only, retry count,
  shutdown duration, pool snapshot when exposed); never log SQL, bound values, URLs, passwords,
  JWTs, or user identity. Application-name labeling (B1) enables the labeled read-only
  `pg_stat_activity` diagnostic — diagnostic only, never with `pg_terminate_backend`.
- **B5 — tests** (~16 files): per service `tests/unit/db.pool.config.test.js`,
  `db.startup.test.js`, `graceful.shutdown.test.js`, `db.observability.test.js`; extend
  backend/tracking `db.migration.test.js` (source-order / cache-ordering safeguards); keep and
  extend BFF `tests/unit/proxyTimeout.test.js` (normal routes stay 30 s, AI route independent).
- **B6 — docs/env templates**: update backend & data-syncing `.env.example`; create
  placeholder-only `.env.example` in item-master & tracking; update backend & tracking
  `docs/configuration.md`; add a `Database connection pool` section to item-master &
  data-syncing `README.md`; document the India-local profile and the staggered startup order.
  Real `.env.localhost` files stay ignored; templates contain names/defaults/ranges only.

## 7. Per-repo checklist

**`u2giants/shared-db`** — Workstream S migrations (branch + PR, preview-first, **AI-merged per
§5**, approved-window prod promote); keep this plan; after app PRs merge, update the verification
note with PR/SHA links and sanitized timings. No other migration, RPC, cron, Edge Function,
schema, or data change.

**`designflow-backend`** — Slice A: remove inline DDL block (S4, after prod confirmation);
`db.ready` + await-before-`listen()` + fatal-exit; A2 retry fix; keep cloudbuild
`DB_POOL_MAX=5`/`DB_AUTH_RETRIES=5`. Slice B: config module, standardized retry, shutdown,
observability, labels, 4 unit-test files, `.env.example`/`docs/configuration.md`, extend
`db.migration.test.js` to guard against the inline block returning.

**`designflow-item-master`** — reference service. Slice A: A2 retry fix only (ceiling-aware
backoff in the existing retrier). Slice B: config module, shutdown, observability, labels,
4 unit-test files, placeholder `.env.example`, README pool section. Preserve cloudbuild values.

**`designflow-tracking`** — Slice A: `db.ready`, await-before-caches, await-before-`listen()`;
minimal A2-policy retry; set explicit production `DB_POOL_MAX` in `cloudbuild.yaml` (A4,
measured). Slice B: code default 22→5 via B1, standardized retry, shutdown, observability,
labels, 4 unit-test files + cache-ordering test, placeholder `.env.example`,
`docs/configuration.md`.

**`designflow-data-syncing`** — Slice A: `db.ready`, await-before-`listen()`; minimal A2-policy
retry; explicit production `DB_POOL_MAX` in `cloudbuild.yaml` (A4, measured). Slice B: code
default 22→5 via B1, standardized retry, shutdown, observability, labels, 4 unit-test files,
`.env.example`, README pool section. Keep this work separate from Coldlion sync / ERP
relocation work.

**`designflow-bff`** — no DB changes; keep `BFF_PROXY_TIMEOUT_MS=30000`; extend
`tests/unit/proxyTimeout.test.js`; used only for deployed verification, not the local repro.

**`designflow-frontend`** — no pool changes; real login + first authenticated page is the
end-to-end acceptance flow; no automatic login retries or masking toasts.

## 8. Delivery and PR sequence

1. **A0** measurement complete; gates recorded.
2. **S0–S3** in `u2giants/shared-db`: branch → `check-sql.sh` → preview dry-run → preview apply
   + verify → PR → **AI merges per §5** → production promote in approved window → prod
   verification. Serialize with the in-flight ERP mirror relocation (S0).
3. **DesignFlow Slice-A PRs** on `sandbox-albert` → base `develop`; **Uma reviews and merges;
   the AI never self-merges.** Order: item-master (retry fix; smallest) → tracking →
   data-syncing → backend (DDL removal + readiness; only after S3 prod confirmation). Hand Uma
   the PR URLs, test results, A0 evidence, and an explicit statement of exactly which shared-db
   migrations back the backend change.
4. Sandbox verification after merge/deploy: login 200, `/api/core/verifyToken` 200, first
   Item Library and Tracking calls succeed, Cloud Run logs show readiness before traffic, no
   fresh acquire timeouts / `EMAXCONNSESSION` / relevant 5xx.
5. **A5** cold acceptance from the affected workstation.
6. **Slice-B PRs** (per repo, small), same Uma flow; then update
   `docs/verification/supabase-pooler-idle-connection-drop-20260623.md` and this plan's status.

## 9. Rollback

- **App changes**: per-service, independent — redeploy the previous known-good Cloud Run
  revision. Keep `pool.min=0`, idle eviction, and keep-alive during rollback; never compensate
  with a BFF timeout raise, `min=1`, higher pool maxima, or session killing. Capture the failed
  revision's sanitized readiness/acquire logs first.
- **Inline-DDL removal (S4)**: safe to revert — the shared-db migrations are idempotent, so
  restoring the block creates harmless overlap. The dangerous window is neither-side coverage,
  which the S3→S4 ordering prevents.
- **shared-db migrations**: reconciliation/additive by design; the orphan-column DROP is
  deferred unless explicitly approved, so no drop rollback is needed. If a migration must come
  out, follow the shared-db contract (new corrective migration, preview-first, owner sign-off)
  — never edit the applied file.
- Rollback is successful when the previous revision passes its login smoke checks with no new
  5xx or connection-limit errors.

## 10. Constraints and guardrails (non-negotiable — preserved from v1)

- **Never** build `pg_terminate_backend` into any runbook, script, startup hook, migration,
  cron, or endpoint. Blanket idle-session termination is rejected: it cannot identify
  DesignFlow sessions, can kill CRM/DAM/PIM/Supabase/another developer's work, destroys
  reusable connections (more slow cold handshakes), and treats symptoms. Break-glass
  termination, if ever needed, is operator-only against explicitly identified PIDs.
- Keep `pool.min=0` + `idle=10000` + `evict=5000` + keep-alive (stale half-open pooler socket
  protection). No `min>0`, no eviction removal, no timeouts at/above the BFF normal ceiling.
- No schema change to the shared DB outside Workstream S's sanctioned migration path.
- Do not raise the BFF normal-route timeout; the AI-chat timeout is unrelated and untouched.
- Keep Supavisor session mode `:5432` for the first fix. A transaction-mode `:6543` comparison
  is a conditional, non-production, approval-gated fallback only if A5 fails or the capacity
  envelope forces it. It requires a real compatibility audit first, not just prepared statements:
  transaction mode does not support prepared statements and does not reliably preserve
  session-level state, so Sequelize/node-postgres query behaviour, transactions, temporary state,
  advisory locks, and per-connection initialization must all be tested before any switch.
- Application-name labeling for attributability; read-only diagnostics only; never log
  credentials, URLs, SQL values, JWTs, or user identity.
- `pool.max` is per process/instance; totals are Σ(service max × instances). A manual
  connection or `--version` succeeding proves nothing about the multi-service cold-start flow.
- Per-service rollback independence. DesignFlow PRs: `sandbox-albert` → `develop`, Uma merges.
  shared-db PRs: branch → preview → AI merges (§5).

## 11. Access and environment

- `gh` authenticated for `popcre/designflow-*` and `u2giants/shared-db`; `gcloud` for Cloud
  Build/Run evidence; Supabase credentials and the DesignFlow test login only from 1Password
  vault `vibe_coding` (shared-db `AGENTS.md` §9 runbook; `psql` is not installed on the Windows
  dev machines — use Node + `pg` via the pooler for any approved direct query).
- Branches: `sandbox-albert` (dflow), PR base `develop`; shared-db feature branches off `main`.
- Projects: production `qsllyeztdwjgirsysgai`; preview branch `xjcyeuvzkhtzsheknaiu`.

## 12. Measurement gates and risks (explicit unknowns)

| # | Unknown / gate | Rule |
|---|---|---|
| G1 | Handshake **p99** (India workstation), ≥50 cold samples, end-to-end factory-create time | Accept 20 s connect timeout **only** if p99 ≤ 15 s with margin; else stop, no larger timeout |
| G2 | Current Supavisor session allowance (not API-exposed) **and its classification** | Re-confirm via pooler observability (not just `pg_stat_activity`); classify (clients vs session allowance vs backend pool vs backend capacity); budget against min(current, 15); reserve ≥20%; never raise pool/instance maxima |
| G3 | Root-cause split: (a) DDL burst vs (b) cross-service burst | A0 counts AcquireTimeout vs EMAXCONNSESSION correlated with the DDL window; either can be present alone |
| G4 | Tracking/data-syncing real production pool usage | Measured (A0-4) before the explicit cloudbuild `DB_POOL_MAX` is chosen |
| G5 | Live definitions of the DDL objects — and whether each even exists | Fire-and-forget `.catch()` can have failed silently, so verify per-object in preview **and** prod (incl. `sync()` scope + a cross-service DDL/seed hunt); S1 reconciliation must match before migrations are authored |
| G6 | Deployed `SCHEMA` value (trigger substitution) | Record non-secret name in S1; migrations must qualify it |
| G7 | Cause of the ~12 s handshake (DNS/route/TLS/edge) | Investigated in A0-5/A3; headroom is the fallback, not the default |
| G8 | instances × pool envelope vs ceiling | Breach even at 5×10 per service → documented, escalated to Albert as environment-capacity risk; no scaling/limit change in this work |

If G1 or G2 fails, stop the rollout; the only sanctioned escalation is the conditional
non-production pooler-mode comparison (§10) with architecture approval.

## 13. Completion definition

All of the following, or the status stays "in progress":

- shared-db reconciliation migrations applied to preview **and** production (AI-merged PR per
  §5), with live-state verification evidence; inline DDL block removed from `designflow-backend`.
- Slice-A dflow PRs reviewed/merged by Uma; sandbox verification clean; **10/10** cold local
  cycles (login + first page load) pass from the affected workstation with zero acquire
  timeouts and zero `EMAXCONNSESSION`.
- Readiness logged before HTTP listen in all four services; tracking/data-syncing production
  `DB_POOL_MAX` explicit in cloudbuild and validated under real concurrency; envelope math
  documented and the capacity risk surfaced to Albert.
- Handshake-cause investigation findings recorded; runtime gates G1/G2 values documented.
- Peak connections inside the documented budget; no `pg_terminate_backend` anywhere; shared-db
  verification doc updated with PRs, SHAs, tests, sanitized timings.
- Slice B merged (or explicitly scheduled with Uma) without having gated the incident fix.
