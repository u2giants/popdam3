# DesignFlow database connection-pool remediation plan

**Date:** 2026-07-17

**Status:** Proposed implementation plan; application changes not yet started

**Incident scope:** Local DesignFlow development against the shared hosted Supabase database

**Schema impact:** None. This work must not create or alter database objects, data, roles, policies, or Supabase settings.

## 1. What the affected system is

DesignFlow is POP Creations' product-lifecycle-management application. Its Angular frontend
calls a Node.js BFF, which proxies requests to four Node.js/Express services that use Sequelize
to query the shared hosted Supabase Postgres database:

| Repository | Responsibility | Direct PostgreSQL pool? |
|---|---|---|
| `popcre/designflow-frontend` | Angular browser application | No |
| `popcre/designflow-bff` | Authentication and reverse proxy | No |
| `popcre/designflow-backend` | Main/core PLM API, including login follow-up queries | Yes |
| `popcre/designflow-item-master` | Item Library API | Yes |
| `popcre/designflow-tracking` | Licensing and sample-tracking API | Yes |
| `popcre/designflow-data-syncing` | DesignFlow synchronization API | Yes |

The shared production Supabase project is `qsllyeztdwjgirsysgai`. It is also used by CRM,
DAM, and PM/PIM. A connection operation performed without identifying its owner can therefore
affect applications outside DesignFlow.

The DesignFlow repositories live under `C:\repos\dflow` on the Windows development machines.
DesignFlow work is performed only on `sandbox-albert`, with PRs to `develop` for Uma to review
and merge. Never merge DesignFlow PRs into `develop` or `main` without Uma.

## 2. What this work must accomplish

After starting the DesignFlow services locally, the first login and its immediate
`getUserLoginInfo` query must succeed without a
`SequelizeConnectionAcquireTimeoutError: Operation timeout`. The fix must:

1. address slow cold connection establishment and simultaneous service startup at the clients;
2. keep the shared Supabase connection budget safe;
3. preserve protection against stale half-open pooler sockets;
4. fail startup clearly if the database is unavailable instead of accepting doomed requests;
5. make every DesignFlow database session attributable to its service;
6. close pools cleanly on local restart and Cloud Run shutdown;
7. stay within the BFF's normal-route timeout; and
8. require no manual database cleanup before login.

Success is not "login works after retrying". Success is a repeatable cold-start test with no
acquire timeout, no broad session termination, and evidence that total connections remain
inside the measured shared-pool budget.

## 3. Confirmed current state

The following was verified in the local `sandbox-albert` checkouts on 2026-07-17.

### 3.1 Existing common settings

All four Sequelize services currently have:

- `pool.min = 0`;
- `pool.acquire = 20,000 ms`;
- `pool.idle = 10,000 ms`;
- `pool.evict = 5,000 ms`;
- `dialectOptions.connectTimeout = 15,000 ms`;
- `keepAlive = true`; and
- `keepAliveInitialDelayMillis = 10,000 ms`.

These settings were introduced to avoid the previously verified failure where Supabase's
pooler closed an idle socket but Sequelize retained the half-open client socket. The next
request then stalled for 10–26 seconds. That history and the required guardrails are recorded
in `docs/verification/supabase-pooler-idle-connection-drop-20260623.md`.

Do not solve the new cold-start incident by setting `pool.min > 0`, removing eviction, or
raising timeouts beyond the BFF limit. Those changes would reintroduce the older stale-socket
failure.

### 3.2 Differences that must be reconciled

| Service | Default `pool.max` | Retried `authenticate()` | Exposes `db.ready` | Waits for readiness before `listen()` |
|---|---:|---|---|---|
| Backend | 5 | Yes | No | No |
| Item Master | 5 | Yes | Yes | Yes |
| Tracking | 22 | No | No | Indirectly performs cache queries, but does not await initialization explicitly |
| Data Syncing | 22 | No | No | No |

Relevant source locations:

- `designflow-backend/models/db.js` and `index.js`
- `designflow-item-master/models/db.js` and `index.js`
- `designflow-tracking/models/db.js` and `index.js`
- `designflow-data-syncing/models/db.js` and `index.js`
- `designflow-bff/routes/api.js`

The BFF currently allows 30,000 ms for ordinary proxied requests. Its separate long timeout
for AI chat is unrelated and must not be changed for this incident.

### 3.3 Incident evidence supplied by the developer

- Credentials were accepted and a manual connection succeeded.
- `pg_stat_activity` did not show leaked or blocked DesignFlow sessions.
- A new connection from the developer's location in India to AWS `us-east-1` took about
  11–12 seconds.
- Login authentication succeeded, but the next query timed out waiting for Sequelize to
  acquire a connection.
- Warm retries succeeded.

This evidence points to cold connection creation plus a startup burst, not bad credentials,
schema defects, query-plan defects, or abandoned server sessions. Phase 0 below must reproduce
and timestamp the behavior before changing code so the final comparison is objective.

## 4. What was tried and why it is not the fix

The developer used this read-only diagnostic:

```sql
SELECT pid, usename, application_name, client_addr, state, wait_event_type,
       now() - state_change AS idle_for, left(query, 80) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
ORDER BY state_change;
```

Reading `pg_stat_activity` is acceptable when performed through an approved authenticated
path. However, most current DesignFlow connections lack a useful `application_name`, so the
result cannot reliably assign a session to a service.

The developer then terminated every idle session older than five minutes:

```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND state = 'idle'
  AND now() - state_change > interval '5 minutes';
```

This is not an approved remediation and must not be built into a runbook, script, startup
hook, migration, cron job, or application endpoint. It is unsafe because it:

- does not identify DesignFlow, the developer's machine, or a specific service;
- can kill legitimate sessions belonging to CRM, DAM, PM/PIM, Supabase services, or another
  developer;
- destroys reusable connections and therefore forces more slow cold handshakes;
- treats a symptom after it occurs rather than fixing application startup; and
- can interrupt valid work even when a session is merely idle between requests.

If an exceptional incident ever requires termination, an operator must first identify exact
PIDs by service label, user, client, state, and query history; confirm they are abandoned; and
terminate only those explicit PIDs. That is break-glass incident response, not part of this
implementation.

## 5. Root causes and key findings

### 5.1 Primary root cause

`pool.min=0` correctly means a newly started service has no established connection. A first
request may therefore pay DNS, TCP, TLS, pooler, and PostgreSQL authentication costs. From the
affected location, the measured 11–12 second handshake consumes most of the 15-second TCP
connect timeout and a large part of the 20-second acquire timeout.

### 5.2 Amplifiers

1. Backend, Tracking, and Data Syncing can begin listening without an explicitly awaited,
   retried database-readiness promise.
2. Tracking and Data Syncing permit up to 22 client connections per process by default.
3. Starting multiple services together can create a burst of connection attempts against the
   same Supavisor role/database connection allowance.
4. The BFF's normal 30-second request timeout includes both pool wait and query execution.
   Raising `acquire` above that boundary only turns a clear database error into a BFF timeout.
5. Connections are not consistently labeled, limiting safe diagnosis.
6. The services do not consistently perform graceful pool shutdown, so rapid local restarts
   can temporarily overlap old and new clients.

### 5.3 What is not a root cause

- No schema/table/view/RPC/RLS change is required.
- No database migration is required.
- No Supabase-side pool purge is required.
- No login credential change is required.
- No BFF timeout increase is justified by the current evidence.
- `pool.min=0` is intentional and remains required because idle pooler sockets have already
  caused production-like failures.

## 6. Target design

Use one consistent connection lifecycle in all four Sequelize services:

```text
load and validate config
        ↓
construct Sequelize + register models synchronously
        ↓
assign db.ready = initializeDatabase()
        ↓
authenticate with bounded retry and measured logging
        ↓
start service-specific caches/tasks
        ↓
listen for HTTP traffic
        ↓
on SIGINT/SIGTERM: stop HTTP, sequelize.close(), exit
```

The common target values are:

| Setting | Code default | Local India override | Rule |
|---|---:|---:|---|
| `DB_POOL_MAX` | 5 | 2 initially | Recalculate before increasing; local total must fit the measured shared budget |
| `DB_POOL_MIN` | 0 | 0 | Must remain zero |
| `DB_POOL_IDLE` | 10,000 ms | 10,000 ms | Preserve stale-socket protection |
| `DB_POOL_EVICT` | 5,000 ms | 5,000 ms | Preserve active eviction sweep |
| `DB_CONNECT_TIMEOUT` | 15,000 ms | 20,000 ms | Local override gives measured 12s handshakes safe headroom |
| `DB_POOL_ACQUIRE` | 20,000 ms | 25,000 ms | Must remain below normal BFF timeout |
| `DB_AUTH_RETRIES` | 3 | 5 | Retry only transient connection errors, with bounded backoff |
| `DB_APPLICATION_NAME` | service-specific default | same | Must identify service and environment without secrets |

The local override is deliberately not the production default. It is bounded under the
30-second BFF limit and is paired with readiness, reduced local concurrency, and measurement.
If a normal login query itself needs more than the remaining five seconds after a 25-second
acquire, that query is a separate performance defect; increasing the BFF timeout is not the
first remedy.

Official Supabase guidance distinguishes persistent IPv4 clients using Supavisor session mode
on port 5432 from temporary/serverless clients using transaction mode on port 6543. Do not
switch connection mode as part of the first fix. First identify the endpoint currently used,
measure it, and validate ORM compatibility. Transaction mode does not support prepared
statements and requires explicit compatibility testing. Current reference:
<https://supabase.com/docs/guides/database/connecting-to-postgres>.

## 7. Detailed implementation phases

### Phase 0 — establish a safe baseline

**Repositories changed:** none.

1. Sync all six DesignFlow repositories according to the DesignFlow session-start procedure:
   merge current `origin/develop` into `sandbox-albert`, push, then pull locally. Stop if any
   repo contains unrelated uncommitted work.
2. Confirm which four services are running for the failing local flow. Record service name,
   Git SHA, Node version, start command, `NODE_ENV`, and whether it is one process or multiple
   workers. Do not record secret values.
3. Record only the database endpoint category: direct, Supavisor session `:5432`, or
   Supavisor transaction `:6543`. Do not copy the connection string or password into evidence.
4. Determine the current Supavisor client/session limit and current baseline usage from the
   Supabase dashboard/Management API and read-only `pg_stat_activity`. Keep at least 20% of the
   measured allowance free for Supabase and non-DesignFlow clients.
5. Reproduce from a fully stopped state five times:
   - stop all local DesignFlow Node processes cleanly;
   - confirm no old connections remain for the developer's future application labels;
   - start the required services together using the normal developer command;
   - submit one login immediately after the frontend becomes available;
   - record per-service database-ready time, login response status, BFF duration, acquire
     timeout count, and total DesignFlow sessions;
   - repeat the same request while warm.
6. Save sanitized evidence in the implementing DesignFlow repo's `qa-artifacts` or docs area.

**Verification gate:** five cold runs and five warm runs are recorded, the failure is reproduced
at least once or the original logs provide equivalent timing evidence, and no backend was
terminated during measurement.

### Phase 1 — standardize connection configuration and validation

**Repositories changed:** Backend, Item Master, Tracking, Data Syncing.

For each `models/db.js`:

1. Replace permissive integer parsing with one small bounded parser. Invalid, negative, zero
   where prohibited, or out-of-range values must fail startup with the variable name and safe
   expected range. Never log connection strings, usernames, or passwords.
2. Standardize the code defaults from the target table above. Specifically change Tracking
   and Data Syncing `DB_POOL_MAX` from 22 to 5.
3. Enforce configuration relationships:
   - `DB_POOL_MIN` must be 0;
   - `DB_POOL_MAX >= 1`;
   - `DB_POOL_EVICT > 0` and `DB_POOL_EVICT <= DB_POOL_IDLE`;
   - `DB_CONNECT_TIMEOUT < BFF_PROXY_TIMEOUT_MS`; and
   - `DB_POOL_ACQUIRE < BFF_PROXY_TIMEOUT_MS`.
4. Add `DB_APPLICATION_NAME` to the PostgreSQL dialect options with these safe defaults:
   - `designflow-backend-${NODE_ENV}`;
   - `designflow-item-master-${NODE_ENV}`;
   - `designflow-tracking-${NODE_ENV}`; and
   - `designflow-data-syncing-${NODE_ENV}`.
   Sanitize the value to a short service/environment label. Do not put user email, hostname,
   token, or credential data into it.
5. Keep SSL and existing UTF-8 settings unchanged.
6. Add the complete variable set, descriptions, and local recommended values to each repo's
   `.env.example` and relevant `docs/configuration.md` or README. Commit names only, never
   values from a real `.env` file.

Do not extract a new cross-repo npm package during this incident. Four small, matching modules
are easier to review and roll back than a new package/release dependency. A shared package may
be evaluated later after the behavior is stable.

**Unit tests in each database service:**

- defaults equal the approved values;
- local overrides parse correctly;
- malformed and out-of-range values fail loudly;
- `min` cannot become positive;
- acquire/connect timeouts cannot meet or exceed the normal BFF timeout;
- keep-alive, idle, and eviction protections remain enabled; and
- the generated application name identifies the correct service/environment.

**Verification gate:** all four suites pass, source search finds no remaining default
`DB_POOL_MAX=22`, and no database/schema files changed.

### Phase 2 — make database readiness a hard startup gate

**Repositories changed:** Backend, Tracking, Data Syncing. Item Master is the reference
implementation and may receive only consistency/test cleanup.

1. In each `models/db.js`, assign the initialization promise to `db.ready` before export,
   following Item Master's existing pattern. Preserve the required boot order:
   register models and assign `db.sequelize` before the first `await`.
2. Use one consistent `authenticateWithRetry()` implementation across the four services.
   It must retry only transient connection conditions such as acquire/connect timeout,
   `EAUTHTIMEOUT`, `ECONNRESET`, connection termination, PostgreSQL class `08` connection
   failures, and `EMAXCONNSESSION`. Invalid credentials, invalid SSL configuration, or schema
   programming errors must fail immediately.
3. Use bounded backoff, for example 1s, 2s, 3s, 4s, 5s, with no unbounded loop.
4. Log attempt number, elapsed milliseconds, safe error code/category, and final outcome.
   Never log the password or connection URL.
5. In each `index.js`, await `db.ready` before `app.listen()`.
6. In Tracking, await `db.ready` before loading `LicenseFeedBacks`, `LicensingTime`, merch-group,
   and factory caches. Preserve its synchronous model-registration requirement.
7. If readiness exhausts its retries, log one clear fatal message and exit nonzero. The service
   must not remain alive while unable to query the database.

Item Master's existing sequence is the reference behavior:

```javascript
db.ready = initialize();
// ...
await db.ready;
app.listen(...);
```

Do not add `sequelize.sync()`, DDL, session-killing SQL, or a database mutation to the readiness
path. Existing legacy Backend startup DDL is separate technical debt and must not be expanded
or refactored in this pool incident.

**Unit tests:**

- models are registered before the first asynchronous wait;
- `listen()` cannot run until `db.ready` resolves;
- transient failure then success starts the service once;
- permanent authentication failure performs no retry and never listens;
- exhausted transient retries exit/fail clearly; and
- Tracking cache queries run only after readiness.

**Verification gate:** with an intentionally unreachable safe test host, every service fails
before listening; with valid local configuration, every service logs database readiness before
its HTTP-listening message.

### Phase 3 — add graceful shutdown

**Repositories changed:** Backend, Item Master, Tracking, Data Syncing.

1. Keep the `http.Server` returned by `app.listen()`.
2. Install one idempotent shutdown handler for `SIGINT` and `SIGTERM`.
3. On shutdown:
   - stop accepting HTTP requests;
   - allow a short bounded period for in-flight requests;
   - call `db.sequelize.close()` exactly once;
   - log success or a loud bounded-timeout warning; and
   - exit with an appropriate status.
4. Ensure nodemon/local Ctrl+C and Cloud Run termination use the same path.

Do not query or terminate `pg_stat_activity` during shutdown. Each process owns its Sequelize
pool and can close its own sessions safely.

**Unit tests:** repeated signals do not double-close, HTTP closes before Sequelize, a close
failure is reported, and the process does not hang indefinitely.

**Verification gate:** after Ctrl+C, labeled sessions for that one local service disappear
without affecting other service labels; restarting does not temporarily double the expected
session count.

### Phase 4 — apply safe local-only overrides

**Repositories changed:** local example/development documentation only; real local `.env` files
remain untracked.

For each database service on the affected India workstation, set through the existing local
environment mechanism:

```text
DB_POOL_MAX=2
DB_POOL_MIN=0
DB_CONNECT_TIMEOUT=20000
DB_POOL_ACQUIRE=25000
DB_POOL_IDLE=10000
DB_POOL_EVICT=5000
DB_AUTH_RETRIES=5
DB_APPLICATION_NAME=<the documented service-specific local label>
```

`DB_POOL_MAX=2` is the initial local recommendation, not a universal production value. Four
services at two connections each produce a theoretical local ceiling of eight clients. Confirm
that this ceiling plus all deployed services and Supabase's baseline stays within the measured
allowance from Phase 0. If the actual allowance cannot safely fit eight, lower per-service
values or run only the services required for the task. Do not raise Supabase limits blindly.

Start the database services first and wait for their explicit ready messages before opening the
frontend/login flow. If a developer launcher starts all services, update it to wait for child
readiness and print a summary instead of treating "process spawned" as "service ready."

**Verification gate:** configuration logs show only safe, non-secret setting summaries; all
required services reach ready; and the measured session ceiling stays within budget.

### Phase 5 — add proof-oriented observability

**Repositories changed:** the four database services.

Use Sequelize's connection/pool hooks or an equivalent small wrapper to record:

- service/application name;
- startup authentication elapsed time;
- successful pool-acquire elapsed time in coarse milliseconds;
- acquire timeout count;
- transient startup retry count; and
- graceful shutdown duration.

Do not log SQL text, bound values, connection strings, passwords, JWTs, or user identity. Log
normal successful acquisition only when it exceeds a useful threshold (for example 1 second)
to avoid noisy logs. Always log timeouts and exhausted retries.

Use this read-only diagnostic after application labels exist:

```sql
SELECT pid,
       usename,
       application_name,
       client_addr,
       state,
       wait_event_type,
       now() - backend_start AS connection_age,
       now() - state_change AS state_age
FROM pg_stat_activity
WHERE datname = current_database()
  AND backend_type = 'client backend'
  AND application_name LIKE 'designflow-%'
ORDER BY application_name, backend_start;
```

This query observes only labeled DesignFlow clients and does not expose query text. It remains
diagnostic only; do not append `pg_terminate_backend`.

**Verification gate:** a cold test produces attributable timing evidence for all four services
and no secrets or user data appear in logs.

### Phase 6 — repeat the cold-start acceptance test

Run at least ten fully cold cycles from the affected India workstation:

1. stop all services using their graceful shutdown path;
2. verify their labeled sessions close;
3. start the required services together;
4. wait for explicit ready messages;
5. perform login and the first page load;
6. record HTTP status and timings for login, `getUserLoginInfo`, and initial API calls;
7. record acquire/retry counts and peak labeled sessions; and
8. run the same page load warm.

Acceptance criteria:

- 10/10 cold logins succeed on the first user attempt;
- no `SequelizeConnectionAcquireTimeoutError` occurs;
- no BFF normal-route timeout or relevant 5xx occurs;
- no `EMAXCONNSESSION` occurs;
- every service listens only after database readiness;
- peak local DesignFlow connections remain within the Phase 0 budget;
- warm behavior does not regress materially;
- Ctrl+C/restart removes only the stopping service's sessions; and
- no session-termination query is used.

If failures remain, classify them from evidence:

- **TCP connect reaches 20s:** investigate the developer's DNS/network route and compare session
  pooler versus a controlled transaction-pooler test; do not simply raise timeouts.
- **Acquire waits while connects are fast:** inspect pool demand, slow/in-transaction work, and
  the cross-service connection budget.
- **Query time dominates after acquire:** optimize that query separately.
- **Supavisor client/session limit appears:** recalculate all service × instance pools before
  changing any limit.

### Phase 7 — controlled pooler-mode comparison only if Phase 6 fails

This is conditional and is not part of the initial rollout.

1. Use a non-production/sandbox environment and the same read-only login-follow-up workload.
2. Compare the current endpoint with Supavisor transaction mode `:6543` under the same network.
3. Confirm Sequelize/node-postgres uses no named prepared statements or session-dependent state
   incompatible with transaction mode.
4. Run the complete unit, integration, transaction, and cold-start tests.
5. Measure latency and pool/client counts; do not infer improvement from one successful login.
6. Document the result and obtain architecture approval before changing committed deployment
   configuration.

Do not use production as the experiment and do not change Supabase pooler configuration merely
to solve one workstation's latency.

## 8. Repository-by-repository implementation checklist

### `designflow-backend`

- `models/db.js`: expose `db.ready`, standardize validation/labeling/retry, preserve synchronous
  model registration, and do not add or expand legacy startup DDL.
- `index.js`: await readiness before listening and add graceful shutdown.
- `.env.example`, `docs/configuration.md`, `docs/development.md`: document variables and the
  India-local profile.
- Tests: add focused pool configuration/readiness/shutdown tests. Existing migration tests must
  remain green.
- Deployment: preserve committed `DB_POOL_MAX=5` and `DB_AUTH_RETRIES=5` in `cloudbuild.yaml`.

### `designflow-item-master`

- Keep the existing `db.ready`/retry/listen ordering as the reference.
- Add bounded configuration validation, application labeling, observability, and graceful
  shutdown.
- Extend tests and documentation; preserve Cloud Build values of 5 retries and max pool 5.

### `designflow-tracking`

- Reduce the code default from 22 to 5.
- Add retry and `db.ready`.
- Await readiness before all startup cache queries.
- Preserve the existing boot-order and connection-resilience regression tests.
- Add shutdown, labeling, observability, and local profile docs/tests.

### `designflow-data-syncing`

- Reduce the code default from 22 to 5.
- Add retry and `db.ready`; wait before listening.
- Add shutdown, labeling, observability, and local profile docs/tests.
- Do not mix this work with Coldlion synchronization or schema relocation changes.

### `designflow-bff`

- No database code changes.
- Keep normal `BFF_PROXY_TIMEOUT_MS=30000`.
- Add or retain a unit assertion that ordinary routes remain at 30 seconds.
- Use the BFF only as the end-to-end observation point for status and duration.

### `designflow-frontend`

- No connection-pool code changes.
- Use the real login plus first authenticated page as the end-to-end acceptance flow.
- Do not mask failures with automatic login retries or a generic success toast.

### `shared-db`

- Keep this plan and the existing pooler operational guidance.
- No migration, Edge Function, cron, RPC, schema, or data change.
- Update the verification note after the app PRs are tested and merged, including commit/PR
  links and sanitized timing evidence.

## 9. Delivery sequence, PRs, and rollout

1. Implement Item Master consistency changes first because it already has the correct readiness
   structure; use it to validate tests and shutdown behavior.
2. Implement Backend next because it owns the observed post-login query.
3. Implement Tracking, preserving its startup cache order.
4. Implement Data Syncing last, separately from any Coldlion feature work.
5. Push each repo's `sandbox-albert` branch and create/update a PR to `develop`.
6. Never self-merge DesignFlow PRs. Give Uma the four PR URLs, test results, local cold-start
   evidence, and explicit statement that no database schema changed.
7. Verify the Albert sandbox after deploy:
   - login page returns 200;
   - `/api/core/verifyToken` returns 200 for a valid test login;
   - initial Item Library and Tracking calls succeed;
   - Cloud Run logs show readiness before traffic; and
   - there are no fresh acquire timeouts, `EMAXCONNSESSION`, or relevant 5xx errors.
8. After Uma merges and sandbox evidence is clean, repeat production smoke checks during the
   normal deployment flow. No Supabase production apply is needed.
9. Update `docs/verification/supabase-pooler-idle-connection-drop-20260623.md` with final evidence
   and mark this plan implemented.

## 10. Rollback

The change is application-only and can be rolled back independently per service.

1. Redeploy the previous known-good image/revision for any service that fails startup or shows
   request regression.
2. Keep `pool.min=0`, idle eviction, and keep-alive even during rollback; do not revert to the
   old stale-socket configuration.
3. Remove only the new local overrides if they cause a workstation-specific regression.
4. Do not compensate by increasing BFF timeout, setting `min=1`, raising pool maxima, or killing
   server sessions.
5. Capture the failed revision's safe readiness/acquire logs before rollback so the next attempt
   is evidence-based.

Rollback is successful when the previous revision serves its health/login smoke checks and no
new relevant 5xx or connection-limit errors appear.

## 11. Constraints and gotchas

- `shared-db` is the schema authority, but this incident requires no schema work.
- The database is shared across applications; never operate on anonymous idle sessions.
- Session-mode `:5432` and transaction-mode `:6543` are not interchangeable without testing.
- Transaction mode does not support prepared statements.
- `pool.max` is per process/instance. Calculate total as the sum of every service's maximum
  multiplied by its possible instance/process count.
- A process answering `--version` or a manual connection succeeding does not prove the
  multi-service cold-start flow works.
- `sequelize.authenticate()` proves connectivity but does not justify accepting HTTP traffic
  until its promise has completed.
- With `min=0` and 10-second idle eviction, a later request can legitimately be cold again.
  Timeout headroom must therefore handle a measured cold connection; readiness alone is not the
  entire fix.
- Do not log real `.env` contents, database URLs, usernames, passwords, or tokens.
- Do not modify mirrored `shared-db/` folders inside DesignFlow repos; change the canonical
  `u2giants/shared-db` repository only.

## 12. Access and environment

- GitHub CLI: use authenticated `gh` for `popcre/designflow-*` PRs and `u2giants/shared-db`.
- Google Cloud CLI: use the authenticated `gcloud` configuration for Cloud Build/Run log and
  revision verification.
- Supabase CLI/Management access: credentials live only in 1Password vault `vibe_coding`.
- DesignFlow test login: credentials live only in 1Password vault `vibe_coding`.
- Branches: `sandbox-albert` in all DesignFlow repos; PR base `develop`.
- Shared DB project: production `qsllyeztdwjgirsysgai`; no database apply is part of this work.

## 13. Open questions and risks

These must be answered with measurements during Phase 0; they do not block writing the code
plan.

1. Which pooler endpoint/mode is the affected workstation currently using?
2. What is the current Supavisor client/session allowance for the shared role/database?
3. Do all four local services use the same database role, making their session ceilings additive?
4. Is 11–12 seconds stable, or does cold handshake p95 exceed the proposed 20-second connect
   timeout?
5. Does the developer's launcher start services concurrently and declare them ready merely when
   their processes spawn?
6. Are any services run with multiple Node workers locally or multiple Cloud Run instances in an
   environment where the total pool budget must be recalculated?

Risk decisions made on 2026-07-17:

- Broad idle-session termination is rejected.
- No database/schema change will be made.
- `pool.min=0` and stale-socket protections remain.
- Normal BFF timeout remains 30 seconds.
- The first implementation keeps the current pooler mode.
- Local timeout headroom and smaller local pools are environment overrides, not blind global
  production changes.

## 14. Completion definition

This work is complete only when all of the following are true:

- four DesignFlow service PRs have passed tests and been reviewed/merged by Uma;
- 10/10 cold local login cycles pass from the affected workstation;
- sandbox login and first authenticated page calls pass;
- no acquire timeout, connection-limit error, or relevant 5xx appears in the verification window;
- connection counts remain inside the documented budget;
- graceful shutdown removes only the owning service's labeled sessions;
- shared-db verification documentation contains PRs, SHAs, tests, and sanitized timings; and
- no manual `pg_terminate_backend` cleanup is required.

Until those gates pass, the status at the top of this file must remain "implementation in
progress" or "plan only," never "resolved."
