# RETRACTED — DesignFlow database connection architecture (v3.0)

> **Do not implement or use this document as current architecture.** It was
> written from sandbox assumptions without first inventorying the production
> database provider and connection contract. On 2026-07-17, following this plan
> led an AI session to change the unsuffixed production `DB_PORT` secret from
> Cloud SQL port `5432` to hosted-Supabase pooler port `6543`, which broke the
> live DesignFlow site. The four open application PRs are on hold pending a
> provider-by-environment inventory and fail-closed deployment controls.
>
> Production DesignFlow remains on Cloud SQL. No part of this document authorizes
> a production database-provider change or any production secret mutation.
> Unsuffixed GCP DB secrets are production-only and must not be read or changed
> without Albert's explicit production approval. Current remediation belongs in
> `popcre/infrastructure`, the four affected service repositories, and the
> incident record maintained for this outage.
> See [`docs/incidents/20260717-designflow-production-db-port.md`](docs/incidents/20260717-designflow-production-db-port.md).
>
> **Remediation update, 2026-07-20:** production is healthy on Cloud SQL/`5432`
> with numeric secret-version pins; all four automatic production triggers are
> disabled; infrastructure validation and application startup guards reject the
> incident combination; 109 suites / 741 tests passed; scoped writer identities
> and two critical alerts are live. The four corrected PRs are green and assigned
> to Uma (`devopswithkube`) for review. The final hard IAM Deny + PAM approval
> gate remains blocked because GCP project `lithe-breaker-323913` has no Google
> Cloud organization parent. Do not follow this document's old production
> rollout, rollback, or `DB_PORT` instructions.

**Date:** 2026-07-17
**Status:** Historical/retracted architecture artifact. The schema migration is
live, but the production-provider portions below are invalid. Corrected guarded
application PRs await Uma's review; production remains Cloud SQL/`5432`.

This document supersedes v2.1. The solution is deliberately based on database ownership,
Cloud Run's auto-scaling execution model, and Supabase connection semantics. It has no
workstation- or geography-specific acceptance gate.

## 1. What this fixes

The four Node.js/Express/Sequelize services—Core Backend, Item Master, Tracking, and Data
Syncing—share application data, but their connection provider is environment-specific:
sandbox/develop/staging use hosted Supabase and production uses Cloud SQL. The old design
combined several problems:

- Core application startup ran `sequelize.sync()` plus 43 unawaited DDL/data statements.
- Backend schema evolution therefore depended on application boot order and runtime permissions.
- All Cloud Run instances used Supavisor session mode, allowing an idle client connection to
  reserve a database backend for its whole session.
- Tracking and Data Syncing defaulted to pools of 22 connections per process while Cloud Run
  could create multiple instances.
- Pool values were loosely parsed, services had inconsistent readiness, and shutdown did not
  explicitly drain owned connections.
- Connections were not consistently attributable to a service/revision.

The result was an unsafe schema control plane and an unnecessarily large connection envelope.

## 2. Final architecture

### 2.1 Schema control plane: shared-db only

`u2giants/shared-db` is the only schema authority. Applications never run DDL, schema sync,
seeds, or backfills during startup.

Migration
`supabase/migrations/20260717163500_reconcile_dflow_backend_startup_contract.sql`:

- asserts every table, critical column, and index required by the Sequelize models;
- performs only restart-safe reconciliation for the factory-country backfill and buyer-margin
  UI seed;
- fails loudly if the historical lowercase orphan column exists;
- makes no destructive drop;
- was applied preview-first, then production;
- is compatible with both the old and new Backend boot paths.

Shared-db PR [#97](https://github.com/u2giants/shared-db/pull/97) merged as
`293fd90697bb0a0024e196d6b4a2da2e298dbd15`. Production apply run
`29611459054` succeeded and the live contract was re-audited.

### 2.2 Sandbox runtime data plane: Supavisor transaction mode

Sandbox Cloud Run resolves its `_SANDBOX` port as `6543` and connects through
the hosted-Supabase transaction pooler. Transaction mode assigns a database
backend only while a query or transaction is active, so auto-scaling sandbox
clients do not reserve backends for entire idle sessions. **This is not the
production connection contract. Production remains Cloud SQL on `5432`, private
VPC, SSL off, and the complete unsuffixed tuple.**

This matches Supabase's documented guidance for serverless/auto-scaling workloads:

- [Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supavisor FAQ](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI)

Migrations, backups, `pg_dump`, and administrative operations do not use the application
transaction-pooler path. They continue through the canonical shared-db/Supabase CLI workflow.

### 2.3 Compatibility boundary

The four runtime codebases were audited for features that require session affinity. None uses:

- named/prepared statements;
- temporary tables;
- session-level `SET` state;
- advisory locks;
- `LISTEN`/`NOTIFY`;
- server-side cursors;
- cross-request connection affinity.

Core and Item Master contain explicit Sequelize transactions. Those are compatible: Sequelize
acquires one client connection for the transaction and all statements remain on that connection
until commit/rollback. A real `sequelize.transaction(...)` against preview port 6543 passed.

Any future feature that introduces one of the session-dependent mechanisms above must revisit
this contract before merge. It must not silently switch the whole platform back to session mode.

### 2.4 Bounded application-side pools

Every service owns a matching `config/database-pool.js`. It is the only parser for pool and
connection settings.

| Setting | Default/deployed value | Enforced rule |
|---|---:|---|
| `DB_POOL_MAX` | 5 | integer 1–10 |
| `DB_POOL_MIN` | 0 | exactly 0 |
| `DB_POOL_ACQUIRE` | 20,000 ms | 1–29,999 ms |
| `DB_POOL_IDLE` | 10,000 ms | 1–60 seconds |
| `DB_POOL_EVICT` | 5,000 ms | positive and no greater than idle |
| `DB_CONNECT_TIMEOUT` | 15,000 ms | 1–29,999 ms |
| `DB_AUTH_RETRIES` | 5 | integer 1–10 |
| `DB_APPLICATION_NAME` | service + environment | lowercase letters/digits/hyphens, max 63 |

The BFF normal-route timeout remains 30 seconds. Connect and acquire deadlines must stay below
that caller ceiling. Invalid configuration fails startup; it never silently falls back to zero,
NaN, an oversized pool, or an unlimited wait.

The theoretical maximum client envelope is still
`sum(pool.max × active service instances)`, but transaction mode decouples those clients from
one-to-one idle database backends. Supavisor's backend pool and PostgreSQL
`max_connections` remain shared platform budgets.

### 2.5 Readiness, retry, lifecycle, and attribution

- Models register synchronously, then each service authenticates with bounded retry.
- Session-ceiling and transient network failures use full-jitter exponential backoff.
- Credential, SSL/config, and programming failures fail fast.
- HTTP listen occurs only after `db.ready`.
- Tracking completes its startup cache queries before listening.
- `SIGINT`/`SIGTERM` stop HTTP intake, close idle owned connections, wait for request drain,
  close Sequelize once, and force only the process-owned pool after a 10-second deadline.
- No code reads or terminates other sessions; `pg_terminate_backend` is prohibited.
- Structured logs include service, revision/instance, validated `application_name`, connection
  creation time, slow acquire time, retry category, readiness time, and pool
  `size/using/available/waiting`.
- Logs never include database URLs, passwords, JWTs, SQL text/values, or user identity.

## 3. Delivered application changes

| Service | Head commit | PR | Passing tests | Sandbox build | Ready revision |
|---|---|---|---:|---|---|
| Item Master | `bca5f16` | [#37](https://github.com/popcre/designflow-item-master/pull/37) | 71 | `9197d6a4-5c22-48d1-87db-892c80a114da` | `popcre-albert-item-sandbox-00044-mhw` |
| Tracking | `a14afc1` | [#25](https://github.com/popcre/designflow-tracking/pull/25) | 144 | `d10b77b8-abdd-48e3-83ea-f608d04ee17e` | `popcre-albert-tracking-sandbox-00039-r28` |
| Data Syncing | `509c010` | [#16](https://github.com/popcre/designflow-data-syncing/pull/16) | 71 | `c612ec1e-1744-4cfe-aa05-1b9158293423` | `popcre-albert-sync-sandbox-00036-hdd` |
| Core Backend | `b4a015a` | [#62](https://github.com/popcre/designflow-backend/pull/62) | 407 | `804e1c4b-9bed-4445-b4d4-e1113b8c7ab0` | `popcre-albert-core-sandbox-00075-2b6` |

Total: 693 passing unit tests.

Historical warning: an unsuffixed GCP `DB_PORT` version containing `6543` was
created while following this plan. Unsuffixed means production; that mutation
was wrong and caused the outage. Current production revisions are pinned to the
known-good numeric version `1` and resolve Cloud SQL port `5432`. Sandbox uses
the separate `_SANDBOX` tuple.

## 4. Verification evidence

### 4.1 Preview compatibility

Against preview transaction mode port 6543:

- all four services authenticated on the first attempt;
- all four executed a real `select 1` through Sequelize;
- all four emitted validated application names;
- an explicit Sequelize transaction executed and committed successfully.

### 4.2 Sandbox deployment

All four Cloud Builds passed and all four latest revisions report ready. Each revision logged
`db_ready` before its HTTP-listening message.

Readiness timings:

| Service | `db_ready` |
|---|---:|
| Item Master | 2,897 ms |
| Tracking | 1,551 ms |
| Data Syncing | 1,052 ms |
| Core Backend | 2,463 ms |

Authenticated smoke through the sandbox BFF:

| Check | HTTP | Elapsed |
|---|---:|---:|
| Password login | 200 | 455 ms |
| Token verification | 200 | 127 ms |
| Item Library first page | 200 | 991 ms |
| Tracking first page | 200 | 969 ms |

Log review across the four new revisions found zero matches for
`SequelizeConnectionAcquireTimeoutError`, `EMAXCONNSESSION`, session-ceiling messages,
`db_startup_fatal`, or `application_startup_fatal`.

## 5. Failed paths and why

1. **Literal-port transition in one deploy.** The first rollout removed the Secret Manager
   `DB_PORT` binding and attempted to set literal 6543 in the same `gcloud run deploy`.
   Cloud Run rejected the type change. Healthy prior revisions kept serving.
2. **`--remove-secrets` plus deploy.** A second attempt used the supported removal flag, but
   Cloud Run still could not atomically replace the variable's source type while creating the
   revision. A two-revision removal would temporarily omit a required setting and was rejected
   as unsafe.
3. **Unsafe historical path—do not repeat.** An unsuffixed Secret Manager
   `DB_PORT` version containing `6543` was added while retaining the existing
   binding. New production revisions then resolved the wrong port. The correct
   sandbox route is the complete `_SANDBOX` tuple; production remains the
   unsuffixed Cloud SQL/`5432` tuple pinned to numeric versions.
4. **Custom sandbox API hostname.** `api.sandbox-albert.designflow.app` did not resolve from
   this machine. Verification used the canonical public Cloud Run BFF URL. Application checks
   passed, so this was unrelated DNS configuration, not a database failure.

## 6. Corrected production rollout

Uma reviews and merges the four corrected DesignFlow PRs to `develop`; the AI
does not self-merge them. These PRs may bring bounded pools, readiness, retry,
lifecycle, and provider-aware validation to production. They do **not** migrate
production to hosted Supabase. Production must remain Cloud SQL/`5432` with
private VPC, SSL off, the complete unsuffixed tuple, and numeric secret versions.

After each production rollout:

1. Confirm the latest revision is ready.
2. Confirm `db_pool_observability_started` carries the expected production application name.
3. Confirm `db_ready` precedes HTTP listen.
4. Run login, token, Item Library, and Tracking smoke checks.
5. Query logs for acquire timeouts, pooler ceilings, startup fatals, forced shutdowns, and 5xx.
6. Review pool snapshots and Supabase Observability for backend/client connection pressure.

The rollout is complete when all four production revisions pass those checks. No workstation
benchmark is a release gate.

## 7. Rollback

Each service is independently reversible:

1. Capture sanitized connection/readiness/error logs from the failed revision.
2. Route traffic to the prior known-good Cloud Run revision or deploy the prior commit.
3. Roll back by routing to the prior known-good Cloud SQL revision. Do not
   create a production secret version as an application rollback shortcut.
4. Keep the shared-db migration and keep application startup DDL removed. Reintroducing runtime
   schema mutation is not a valid rollback.
5. Never compensate by increasing pool maxima, setting `min>0`, raising the BFF timeout, or
   terminating shared sessions.

## 8. Constraints

- All schema/DDL changes begin in `u2giants/shared-db`, preview first.
- New migration files only; never edit an applied migration.
- Transaction mode is the Cloud Run default until a reviewed session-affinity requirement exists.
- Prepared/session-local features require an explicit architecture review.
- Pool min remains zero; max remains bounded and explicit.
- Application names and safe pool telemetry are mandatory.
- No direct production DDL, no app-startup DDL, and no broad session termination.
- DesignFlow work stays on `sandbox-albert`; Uma merges to `develop`.

## 9. Completion state

Schema reconciliation, corrected application implementation, automated tests,
preview compatibility, sandbox deployment verification, infrastructure
containment, production numeric pinning, scoped IAM foundations, and alerting
are complete. Remaining work is Uma's review/merge plus organization onboarding
for the final IAM Deny + PAM gate. See the incident record for exact evidence
and acceptance criteria.
