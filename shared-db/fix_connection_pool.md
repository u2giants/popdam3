# DesignFlow database connection-pool remediation plan

**Date:** 2026-07-17

**Status:** Implementation-ready plan; application changes not yet started

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
for AI chat is unrelated and must not be changed for this incident. None of the four database
services reads `BFF_PROXY_TIMEOUT_MS`; the implementation therefore validates its database
timeouts against a documented 30,000 ms normal-route contract in its own configuration module.

### 3.3 Exact failing request path

The affected local password-login path is now mapped. It does **not** traverse the BFF:

```text
designflow-frontend/src/app/pages/auth/login/login.component.ts
  -> ItemService.getUserLoginInfo()
  -> MainService POST http://localhost:5000/findUserLoginInfo
  -> designflow-backend/routes/lib.router.js
  -> controllers/main.controller.js
  -> models/lib.model.js Customer.getUserLoginInfo()
  -> sql.users.findOne(...)
```

The key source locations on `sandbox-albert` are:

- frontend `src/app/pages/auth/login/login.component.ts:82`;
- frontend `src/app/helpers/services/main.service.ts:199-200`;
- backend `routes/lib.router.js:81`;
- backend `controllers/main.controller.js:267-270`; and
- backend `models/lib.model.js:1344` and the following `sql.users.findOne` call.

The frontend's local environment uses direct ports: Backend `5000`, Data Syncing `5001`,
Tracking `5002`, and Item Master `5003`. In deployed environments the analogous core call is
proxied through BFF `/api/core`, so the BFF's 30-second normal-route timeout remains a deployment
safety ceiling even though it is not part of the local reproduction path.

### 3.4 Verified endpoint and deployed pool budget facts

The following were verified from the active Google Cloud and Supabase configurations on
2026-07-17, without recording credentials:

- all four sandbox database services use the same Supabase endpoint, database, and role;
- that endpoint is Supavisor **session mode on port 5432**, so per-service/per-instance maxima
  are additive against one session allowance;
- Supabase's Management API reports the separate transaction endpoint on port `6543`, but its
  `default_pool_size` and `max_client_conn` fields are currently unset/platform-managed;
- the last observed effective session-mode ceiling was `15`, from the verified
  `EMAXCONNSESSION` incident on 2026-07-09; treat 15 as a safety warning, not an assurance that
  the present limit is unchanged;
- Backend and Item Master deploy with `DB_POOL_MAX=5` and `DB_AUTH_RETRIES=5`;
- Tracking and Data Syncing do not deploy pool overrides and currently inherit the unsafe code
  default of `22`;
- Cloud Run concurrency is `100` for each database service; sandbox maximum instances are `10`;
  Core and Item Master have minimum instances `1`, while Tracking and Data Syncing have `0`.

This proves why a deployment connection budget cannot be calculated from one process alone.
The implementing agent must not raise a pool maximum or Cloud Run instance ceiling in this
work. Official references: [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres),
[Supabase connection management](https://supabase.com/docs/guides/database/connection-management),
and the [Supabase Management API](https://supabase.com/docs/reference/api/introduction).

### 3.5 Incident evidence supplied by the developer

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
| `DB_APPLICATION_NAME` | service-specific default | `designflow-<service>-localhost` | Must identify service and environment without secrets |

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
2. Record the SHA and `node --version` for Backend, Item Master, Tracking, and Data Syncing.
   Local `npm start` sets `NODE_ENV=localhost`; each service loads the repository-root
   `.env.localhost`. There is no checked-in multi-service launcher and this fix must not invent
   one. Run one Node process per service in four PowerShell terminals.
3. Record the already-verified endpoint category as Supavisor session `:5432`, shared role, and
   shared database. Never record the endpoint, username, URL, or password itself.
4. Re-confirm the session allowance in Supabase Observability or with a controlled connection
   test. The Management API did not expose it on 2026-07-17; record that result and the last
   observed `EMAXCONNSESSION` ceiling of 15 if the dashboard also does not display a current
   value. Never treat an unknown limit as permission to consume it. Keep at least 20% free and
   use the more conservative of the current value and 15 until Supabase proves otherwise.
   Separately record `pool.max × max Cloud Run instances` for each deployed service. The current
   max-instance ceiling of 10 means the theoretical session envelope does not fit the last
   observed ceiling of 15; lazy pools make actual usage lower but do not make that envelope a
   valid capacity guarantee. Do not change scaling in this local incident. If observed sandbox
   peak breaches the 80% budget, block rollout and run the Phase 7 transaction-mode comparison;
   that is the permanent serverless architecture path, not a timeout increase.
5. Before labels exist, establish baseline usage with the shared role plus the four local
   process start/stop timestamps; do not terminate or claim ownership of anonymous sessions.
   After Phase 1 adds labels, repeat the count using `application_name LIKE 'designflow-%'`.
6. Reproduce from a fully stopped state five times:
   - stop all local DesignFlow Node processes cleanly;
   - wait 15 seconds (longer than the configured 10-second idle eviction), then record rather
     than terminate any remaining sessions;
   - in four terminals run `$env:NODE_ENV='localhost'; node index.js` from each service root;
   - run the frontend separately with `npm start`, submit one login immediately after Angular
     becomes available, and record the direct Backend request duration;
   - record per-service database-ready time where available, login status,
     `/findUserLoginInfo` duration, acquire-timeout count, and session count;
   - repeat the same request while warm.
7. Use one row per run with these exact columns: UTC timestamp, four repo SHAs, Node version,
   cold/warm, service-start times, database-ready times, login HTTP status, login duration ms,
   `findUserLoginInfo` status, `findUserLoginInfo` duration ms, handshake/authenticate duration
   ms, acquire timeout count, retry count, peak labeled sessions, and redacted error category.
   Save it as `qa-artifacts/connection-pool/baseline-YYYYMMDD.md` in Backend.
8. Calculate handshake p95 after at least 20 cold `authenticate()` samples from the affected
   India workstation. The proposed 20-second connect timeout is acceptable only when p95 is at
   most 15 seconds, leaving at least 5 seconds of headroom. If p95 is higher, stop before rollout
   and execute Phase 7; do not improvise a larger timeout.

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
3. Create `config/database-pool.js` in each service and make it the only place that parses these
   variables. Export the parser and constants so tests do not need to open a real connection.
   Enforce these relationships:
   - `DB_POOL_MIN` must be 0;
   - `DB_POOL_MAX >= 1`;
   - `DB_POOL_EVICT > 0` and `DB_POOL_EVICT <= DB_POOL_IDLE`;
   - `DB_CONNECT_TIMEOUT < NORMAL_PROXY_TIMEOUT_MS`; and
   - `DB_POOL_ACQUIRE < NORMAL_PROXY_TIMEOUT_MS`.

   Set exported `NORMAL_PROXY_TIMEOUT_MS = 30000` and document that it mirrors the BFF normal
   route default. Do not read `BFF_PROXY_TIMEOUT_MS` in database services, because that variable
   is not present there. A BFF unit test must protect its own 30-second default; the four service
   tests protect the inequalities.
4. Add `DB_APPLICATION_NAME` to the PostgreSQL dialect options with these safe defaults:
   - `designflow-backend-${NODE_ENV}`;
   - `designflow-item-master-${NODE_ENV}`;
   - `designflow-tracking-${NODE_ENV}`; and
   - `designflow-data-syncing-${NODE_ENV}`.
   Accept only lowercase letters, digits, and hyphens (`^[a-z0-9-]{1,63}$`) and fail startup on
   any other value. Use `designflow-backend-localhost`,
   `designflow-item-master-localhost`, `designflow-tracking-localhost`, and
   `designflow-data-syncing-localhost` on the affected workstation. Do not put user email,
   hostname, token, or credential data into it.
5. Keep SSL and existing UTF-8 settings unchanged.
6. Use this exact environment-template inventory:
   - update existing `.env.example` in Backend and Data Syncing;
   - create committed placeholder-only `.env.example` in Item Master and Tracking;
   - update Backend and Tracking `docs/configuration.md`;
   - add a `Database connection pool` section to Item Master and Data Syncing `README.md` because
     those repos do not currently have `docs/configuration.md`.
   Real `.env.localhost` files stay ignored and uncommitted. Templates contain variable names,
   safe defaults, ranges, and comments only—never copied values from a real environment.

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
   Implement and export `isTransientConnectionError(error)`. It returns true only for Sequelize
   names `SequelizeConnectionAcquireTimeoutError`, `SequelizeConnectionTimedOutError`,
   `SequelizeConnectionRefusedError`, and `SequelizeHostNotReachableError`; an `error.code`,
   `error.parent.code`, or `error.original.code` of `EAUTHTIMEOUT`, `ETIMEDOUT`, `ECONNRESET`,
   `ECONNREFUSED`, `EPIPE`, `ENETUNREACH`, `EHOSTUNREACH`, or `EMAXCONNSESSION`; or a five-character
   PostgreSQL code beginning `08`. Match the known Supavisor text `max clients reached in session
   mode` only as a fallback when no code is present. Everything else—including PostgreSQL
   `28P01` invalid credentials, SSL/configuration errors, and schema/programming errors—fails
   immediately.
3. `DB_AUTH_RETRIES` means retries after the initial attempt. With five retries, use exactly
   1s, 2s, 3s, 4s, then 5s delays. With three, use 1s, 2s, then 3s. Inject the sleep function in
   unit tests; never create an unbounded loop.
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

**Verification gate:** with test-only `DB_HOST=127.0.0.1` and `DB_PORT=1`, every service exhausts
the configured transient retries and fails before listening; with valid local configuration,
every service logs database readiness before its HTTP-listening message. Never place real
credentials in that negative test.

### Phase 3 — add graceful shutdown

**Repositories changed:** Backend, Item Master, Tracking, Data Syncing.

1. Add the same small `helpers/graceful-shutdown.js` module to each service. Export
   `installGracefulShutdown({ server, sequelize, logger, exit, timeoutMs })`; inject `exit` and
   timers in tests rather than terminating Jest.
2. Keep the `http.Server` returned by `app.listen()` and install one handler for both `SIGINT`
   and `SIGTERM`. Guard it with one shared promise so repeated signals cannot run it twice.
3. On the first signal, in this exact order:
   - call `server.close()` to stop accepting requests;
   - call `server.closeIdleConnections?.()` when available;
   - await the close callback so in-flight requests receive a bounded drain period;
   - call `db.sequelize.close()` exactly once; and
   - log sanitized duration and exit `0`.
4. Set the default hard deadline to 10,000 ms. If drain or Sequelize close exceeds it, log
   `db_shutdown_timeout`, call `server.closeAllConnections?.()`, and exit `1`. If close rejects,
   log `db_shutdown_failed` and exit `1`.
5. Register handlers only after a server exists. Nodemon/local Ctrl+C and Cloud Run SIGTERM use
   this identical path.

Do not query or terminate `pg_stat_activity` during shutdown. Each process owns its Sequelize
pool and can close its own sessions safely.

**Unit tests:** repeated signals do not double-close, HTTP closes before Sequelize, successful
drain exits `0`, close rejection exits `1`, the 10-second deadline forces exit `1`, and no real
signal handler or process exit leaks between tests.

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
DB_APPLICATION_NAME=designflow-<service>-localhost
```

`DB_POOL_MAX=2` is the initial local recommendation, not a universal production value. Calculate
`safe_client_slots = floor(current_session_allowance * 0.80) - observed_nonlocal_peak` from the
Phase 0 evidence. Four local services require eight slots at max 2. If `safe_client_slots >= 8`,
use max 2 for all four. If it is 4–7, use max 1 for all four. If it is below 4, do not start all
four together: run the Backend-only login acceptance plus one other database service at a time,
and escalate the insufficient shared allowance as an environment capacity risk. Never set max
below 1, silently exceed the formula, or raise a Supabase/Cloud Run limit in this work.

There is no checked-in developer launcher. Start the four database services in separate
PowerShell terminals with `$env:NODE_ENV='localhost'; node index.js`, wait for each explicit
database-ready and HTTP-listening message, then start the frontend with `npm start`. The BFF is
not needed for the verified local password-login path. Do not add a launcher in this fix.

**Verification gate:** configuration logs show only safe, non-secret setting summaries; all
required services reach ready; and the measured session ceiling stays within budget.

### Phase 5 — add proof-oriented observability

**Repositories changed:** the four database services.

Add `helpers/db-pool-observability.js` in each service. Its exported
`installPoolObservability(sequelize, { serviceName, logger, slowAcquireMs = 1000 })` must use
Sequelize v6 `beforePoolAcquire(options)` and `afterPoolAcquire(connection, options)` hooks plus
a `WeakMap` keyed by `options`. Use `process.hrtime.bigint()` for elapsed time. Register it once,
immediately after Sequelize construction. See the official
[Sequelize v6 hook API](https://sequelize.org/docs/v6/other-topics/hooks/).

Emit structured, single-line events with only these fields:

- service/application name;
- startup authentication elapsed time;
- successful pool-acquire elapsed time in integer milliseconds, logged only at or above 1,000 ms;
- transient startup retry count; and
- graceful shutdown duration;
- pool snapshot counts (`size`, `available`, `using`, `waiting`) when the installed pool exposes
  them, otherwise omit those fields rather than reaching into unsupported internals.

The startup retry wrapper owns `db_auth_retry` and `db_auth_failed` events; the shutdown helper
owns `db_shutdown_complete`, `db_shutdown_timeout`, and `db_shutdown_failed`. Do not add an
automatic retry at the HTTP layer.

Do not log SQL text, bound values, connection strings, passwords, JWTs, or user identity. The
1,000 ms threshold above is fixed for this implementation. Always log exhausted startup retries.
For request-time acquire failures, do not patch Sequelize or `sequelize-pool` internals: the
verified Backend `sendError` path already logs the error class. The acceptance evidence counts
`SequelizeConnectionAcquireTimeoutError` occurrences from service logs, and the unit test proves
that the classifier recognizes that exact name. Other unrelated error-handling consolidation is
outside this incident.

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
- Tests: add `tests/unit/db.pool.config.test.js`, `tests/unit/db.observability.test.js`,
  `tests/unit/db.startup.test.js`, and `tests/unit/graceful.shutdown.test.js`; extend
  `tests/unit/db.migration.test.js` only for its existing source-order safeguards.
- Deployment: preserve committed `DB_POOL_MAX=5` and `DB_AUTH_RETRIES=5` in `cloudbuild.yaml`.

### `designflow-item-master`

- Keep the existing `db.ready`/retry/listen ordering as the reference.
- Add bounded configuration validation, application labeling, observability, and graceful
  shutdown.
- Add the same four named unit-test files listed for Backend. Preserve Cloud Build values of 5
  retries and max pool 5.

### `designflow-tracking`

- Reduce the code default from 22 to 5.
- Add retry and `db.ready`.
- Await readiness before all startup cache queries.
- Preserve the existing boot-order and connection-resilience regression tests.
- Add the same four named unit-test files; extend `tests/unit/db.migration.test.js` for cache
  ordering. Add shutdown, labeling, observability, and local profile documentation.

### `designflow-data-syncing`

- Reduce the code default from 22 to 5.
- Add retry and `db.ready`; wait before listening.
- Add the same four named unit-test files. Add shutdown, labeling, observability, and local
  profile documentation.
- Do not mix this work with Coldlion synchronization or schema relocation changes.

### `designflow-bff`

- No database code changes.
- Keep normal `BFF_PROXY_TIMEOUT_MS=30000`.
- Retain and extend `tests/unit/proxyTimeout.test.js` so ordinary routes remain at 30 seconds
  while the separate AI route remains independent.
- Use the BFF only for deployed sandbox/production verification; it is not part of the local
  direct-port reproduction.

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

## 13. Remaining measured gates and risks

The architecture questions are closed: local login uses the Backend direct port, all four
services use one session-mode endpoint/role/database, there is no launcher, and local starts use
one Node process per service. Cloud Run's instance ceilings and current per-service overrides
are recorded in §3.4.

Two values are intentionally runtime gates, not missing design decisions:

1. The affected India workstation must supply at least 20 cold samples and prove handshake p95
   is at most 15 seconds before the 20-second connect timeout is accepted.
2. Supabase currently does not expose the platform-managed session allowance through the
   Management API. Re-confirm it in Observability or by a controlled test; until then, budget
   against the last observed effective ceiling of 15, reserve at least 20%, and never raise pool
   or instance maxima.

If either gate fails, stop the initial rollout and follow Phase 7. No implementing-agent choice
or owner decision is required to begin Phases 1–5.

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
