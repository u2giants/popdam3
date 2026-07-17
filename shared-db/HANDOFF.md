# HANDOFF — shared-db current state

Date: 2026-07-17
Repo: `u2giants/shared-db`
Branch: `main` (matches `origin/main`, clean tree)

This file is the top-level "where are we" pointer for the next session. It is written
for a developer with **zero** prior context. Read it, then read the linked plan.

---

## Active workstream — DesignFlow local database connection-pool remediation

### What this is

DesignFlow is POP Creations' product-lifecycle-management system used by staff to manage RFQs,
items, licensing/tracking, and ERP synchronization. Its Angular frontend and BFF call four Node.js
/ Express / Sequelize services (Core Backend, Item Master, Tracking, and Data Syncing), deployed
to Google Cloud Run. The app repos are the six `popcre/designflow-*` repositories under
`C:/repos/dflow`; their sandbox branches serve `https://sandbox-albert.designflow.app`. All four
services share the hosted Supabase PostgreSQL project governed by this `u2giants/shared-db` repo.

DesignFlow developers connecting from India can authenticate successfully but then receive
`SequelizeConnectionAcquireTimeoutError: Operation timeout` on the first database-backed
request after a cold local startup. The measured new-connection handshake to the shared
Supabase pooler in AWS `us-east-1` is roughly 11–12 seconds. This is an application connection
lifecycle and local configuration problem, not a schema defect or a reason to terminate shared
database sessions.

### What we set out to do, and why

Implement [`fix_connection_pool.md`](fix_connection_pool.md) v2.1 without masking the failure
with arbitrary larger timeouts or killing shared sessions. Slice A moves Core's legacy startup
DDL under shared-db ownership, gates traffic on database readiness, makes retries safe under a
hard session ceiling, and adds sanitized telemetry for the remaining runtime budgets. Slice B
hardening is intentionally later.

### Current state

Workstream S and the code portion of Slice A are complete; runtime acceptance is not.

- Migration `20260717163500_reconcile_dflow_backend_startup_contract.sql` was checked,
  dry-run/applied to preview, proven compatible with the old Core boot, merged in shared-db PR
  [#97](https://github.com/u2giants/shared-db/pull/97), applied to production by successful run
  `29611459054`, and audited live. Merge SHA: `293fd90697bb0a0024e196d6b4a2da2e298dbd15`.
- App commits are pushed on `sandbox-albert`: Item Master `142f88a`
  ([PR #37](https://github.com/popcre/designflow-item-master/pull/37)), Tracking `d8a1ac8`
  ([PR #25](https://github.com/popcre/designflow-tracking/pull/25)), Data Syncing `12a4d60`
  ([PR #16](https://github.com/popcre/designflow-data-syncing/pull/16)), and Core `ae86ffa`
  ([PR #62](https://github.com/popcre/designflow-backend/pull/62)). Uma has not merged them;
  the AI must not merge DesignFlow PRs.
- All four full unit suites passed: 645 tests total. A concurrent preview boot also passed on
  first attempt; its sanitized, explicitly non-A0 evidence is in Backend
  `qa-artifacts/connection-pool/baseline-20260717.md`.
- All four sandbox Cloud Builds succeeded and deployed ready revisions. Each emitted `db_ready`
  before HTTP listen. Deployed BFF checks returned 200 for login, token verification, Item
  Library first page, and Tracking first page. New-revision logs had zero acquire-timeout,
  session-ceiling, or startup-fatal matches and the latest snapshots had zero pool waiters.
- Exact builds, revisions, and timings are in
  [`docs/verification/supabase-pooler-idle-connection-drop-20260623.md`](docs/verification/supabase-pooler-idle-connection-drop-20260623.md).

### Everything tried that did not work

- `api.sandbox-albert.designflow.app` did not resolve from this machine. The deployed smoke test
  used the canonical public Cloud Run BFF URL instead; all checks passed. This was a DNS-name
  issue, not an application failure.
- A local preview `supabase db push --dry-run` listed ten migrations because preview lagged
  production. The GitHub preview workflow applied the backlog plus reconciliation cleanly. No
  applied migration was edited.
- This US workstation cannot reproduce or certify the India 11–12 second cold path. Its fast
  timings are implementation evidence only and must not substitute for A0/A5.
- Production Tracking/Data Syncing pool use is unknown. Their code default remains 22 and no
  Cloud Build override was guessed; changing it without G4 would violate v2.1.

### Root causes and key findings

- Core boot previously launched `sequelize.sync()` plus 43 unawaited DDL/data statements against
  its max-5 pool. That block is gone and a regression test prevents its return.
- Slow resource creation and cross-service/session contention can both consume Sequelize's
  acquire clock; an acquire timeout alone does not distinguish them. India A0 must classify it.
- Live preview/production audit found every expected Core model table, column, and index already
  present, no lowercase orphan, and no pending factory-country backfill. The migration therefore
  reconciles/asserts canonical state without a destructive drop.
- All four services use shared Supavisor session mode. The last observed ceiling is 15, but its
  exact meaning/current value remain unclassified. Pool maxima are per instance, so the aggregate
  max-instances envelope can exceed the limit even when idle pools are empty.

### Exact next steps

1. On the affected India workstation, check out the four commits above and append the A0 matrix
   to Backend `qa-artifacts/connection-pool/baseline-20260717.md`: ≥5 cold and ≥5 warm runs plus
   ≥50 cold factory connects. **Pass when** p99, error classification, peak pool state, and the
   DNS/TCP/TLS/pooler breakdown are recorded without secrets.
2. Classify the current Supavisor allowance using pooler-client observability or a controlled
   connection test; reserve at least 20%. **Pass when** G2 has a value and type, not merely 15.
3. Apply the untracked India `.env.localhost` profile only if G1 permits it, using A3's exact
   budget formula. **Pass when** it stays below the shared slot budget and is not committed.
4. Run A5 from India: ten fully cold login-plus-first-page cycles. **Pass when** 10/10 succeed on
   first attempt with zero acquire timeout, `EMAXCONNSESSION`, relevant 5xx, or BFF timeout.
5. Give Uma the four PRs and evidence for review/merge. **Pass when** Uma merges each to
   `develop` and its normal deployment is healthy; the AI does not merge them.
6. Measure real production Tracking/Data Syncing usage from the new pool snapshots, then add
   explicit measured `DB_POOL_MAX` Cloud Build substitutions in A4 follow-ups. **Pass when** G4
   and the service×instance envelope are documented and sandbox concurrency has no waits.
7. Only after A5 passes, implement Slice B as separate PRs and update this handoff. **Pass when**
   every §13 completion condition in v2.1 is true.

### Constraints and gotchas

Keep `pool.min=0`, idle 10s, evict 5s, keep-alive, and the BFF normal timeout at 30s. Never use
`pg_terminate_backend`, raise timeouts without G1, add app-repo DDL, guess production pool sizes,
or switch pooler mode without the plan's compatibility/approval gate. Slice B must not precede
A5.

### Access and environment

`gh`, `gcloud`, `supabase`, and `op` were exercised successfully on this Windows machine.
Secrets and the test login are in 1Password vault `vibe_coding`; no value was logged or
committed. shared-db is on `main`; DesignFlow repos are on `sandbox-albert`. Preview ref:
`xjcyeuvzkhtzsheknaiu`; production ref: `qsllyeztdwjgirsysgai`; Cloud project:
`lithe-breaker-323913`, region `us-east4`.

### Open questions and risks

G1/G2/G3/G4/G7/G8 remain open exactly as listed in v2.1. The principal risk is approving pool
or timeout values from fast US/sandbox evidence when the incident is on a slow India path. The
second risk is the instance×pool envelope exceeding a platform limit that is still unclassified.
No schema rollback is needed: the reconciliation migration is additive/assertive.

---

## Active workstream — ERP mirror relocation (`fix_schema_for_api.md`)

### What this is
The Coldlion ERP data (items + production orders) is pulled from an external API and
mirrored into this database. Today the mirror sits in seven `public.*` tables with an
`erp_*` / `prod_order_*` name prefix — the legacy PopDAM location. We are relocating it
into the database's designed layers: raw pulls → `ingest.*`, typed authoritative mirror →
`plm.*`, browser/read contracts → `api.*`. This mirrors the already-proven customer path
(`plm.customer_import` → `plm.import_master_data()` → `core.customer` → `api.crm_customer_list`).

**The complete, detailed, 5-phase plan is [`fix_schema_for_api.md`](fix_schema_for_api.md)
(repo root).** It contains: exact current state (tables, row counts, columns, every inbound
dependency), what is correct vs. incorrect about the current design, the target design and
why, and the phase-by-phase migration with reversibility and risk notes. **Do not start ERP
schema work without reading it, and continue the phases in order.**

### Status
| Phase | State |
|---|---|
| 1 — Serving layer (`api.plm_item_list` + repoint `style_tracker_rows_with_bridge`) | ✅ **DONE, live in production 2026-07-15** |
| 2 — Stand up `ingest.*` + `plm.item_import` / `plm.production_order_import` + resolver (additive, no cutover) | ⏳ not started |
| 3 — Dual-write + backfill items (**first phase that touches live data**) | ⏳ not started |
| 4 — Cutover reads + repoint bridge FK to `plm.item` | ⏳ not started |
| 5 — Retire legacy `public.erp_*`/`prod_order_*` + build prod-orders native | ⏳ not started |

### Phase 1 — what shipped (done)
- Migration `supabase/migrations/20260715193000_erp_phase1_api_plm_item_list.sql`, PR
  [#70](https://github.com/u2giants/shared-db/pull/70) (merged), applied to preview then
  production (prod apply run 29445431196, success).
- Added `api.plm_item_list` (`security_invoker` view over `public.erp_items_current`,
  `external_id` exposed as `source_id`). Repointed `public.style_tracker_rows_with_bridge`
  to read ERP columns through it. **No behavior change** — pure decoupling.
- **Intentionally NOT done:** `plm.refresh_style_tracker_item_bridge()` still reads
  `public.erp_items_current` directly (it writes the physical ERP `id` into FK
  `plm.style_tracker_item_bridge.erp_item_id`; a view buys no decoupling). It moves in Phase 4.
- Evidence: [`docs/verification/erp-phase1-api-plm-item-list-20260715.md`](docs/verification/erp-phase1-api-plm-item-list-20260715.md).

### Next action (Phase 2)
Author a new additive migration creating `plm.item_import` and `plm.production_order_import`
(typed ERP mirrors modeled field-for-field on the existing `plm.customer_import`), confirm
`ingest.raw_record` / `ingest.sync_run` cover the item payload, and write
`plm.import_item_master_data(p_sync_run_id uuid)` modeled on `plm.import_master_data()`.
Additive only — nothing reads the new tables yet. Follow the shared-db protocol below.
**Verification gate for Phase 2:** the new objects exist on preview, `check-sql.sh` passes,
preview dry-run lists only the new migration, and no existing reader changes behavior.

### Open decision that blocks Phase 3 (not Phase 2)
The live item pipeline is **Coldlion → dflow (Cloud SQL + enrichment) → dflow item API →
Supabase** (`source_system = 'designflow'`), **not** a direct Coldlion pull — the raw payload
is DesignFlow's shape, not Coldlion's `CLAPIServerEhp` shape. Phase 3 must choose: keep
sourcing through dflow (free merch-group → licensor/property enrichment) or pull Coldlion
`/items` directly (fresher, no dflow dependency, but re-implement enrichment). This also fixes
the `source_system` label choice. Analysis:
[`docs/coldlion-erp-to-supabase-field-mapping.md`](docs/coldlion-erp-to-supabase-field-mapping.md).

**DECIDED 2026-07-15 — Option B (direct Coldlion).** The full build plan, the item→taxonomy
wiring, and the taxonomy-table de-duplication analysis are in
**[`docs/coldlion-direct-sync-and-taxonomy-plan.md`](docs/coldlion-direct-sync-and-taxonomy-plan.md)**.
Highlights the next session must know:
- Sync becomes a Supabase **Edge Function in shared-db + `pg_cron`** (no Google Cloud), key in
  **Vault**, **data-only (no images — DesignFlow owns images)**, plus a new **weekly full
  reconciliation** to stop silent incremental drift.
- The strict parent-child **taxonomy already exists** in `core.*` (sourced from DesignFlow);
  the real work is wiring items to it with **FKs** (Coldlion `merchGroup05`=licensor,
  `merchGroup06`=property — confirmed). Coldlion does **not** expose the hierarchy.
- ⚠️ **Taxonomy "empty duplicate" cleanup is NOT a blind delete.** The empty snake_case tables
  (`core.merch_group`, `core.product_category/type/subtype`) are the *planned canonical target*
  per [`docs/unified-supabase-schema-map.md`](docs/unified-supabase-schema-map.md), not strays.
  The genuinely-redundant set is the `dflow.*` taxonomy island (0 external FKs), pending a
  Sequelize-model check in the 6 `designflow-*` repos. **Open decisions block build — see
  Part F of the plan.**

---

## How to ship a shared-db schema change (the sanctioned flow, proven this session)

Full rules in [`AGENTS.md`](AGENTS.md) §4–§9. The mechanics that worked on 2026-07-15:

1. New timestamped file under `supabase/migrations/`. Never edit an applied migration.
2. `bash scripts/check-sql.sh` — needs `rg` on PATH (Git Bash lacks it; a bundled ripgrep
   exists at `.../AppData/Local/OpenAI/Codex/bin/*/rg.exe` — prepend its dir to `PATH`).
3. Branch + PR to `main`. PR CI runs only static SQL checks.
4. Apply to **preview** first, via GitHub Actions:
   `gh workflow run shared-supabase-migrations.yml -r <branch> -f target=preview -f mode=dry-run`
   then `... -f mode=apply`. (There is no auto-apply on merge; apply is always a manual
   `workflow_dispatch`.)
5. Merge PR → `main` (auto-syncs `shared-db/` into all consumer repos).
6. Apply to **production**: `gh workflow run ... -r main -f target=production -f mode=apply`.
7. Verify on production (Supabase MCP is bound to prod `qsllyeztdwjgirsysgai`).

Project refs: preview `xjcyeuvzkhtzsheknaiu`, production `qsllyeztdwjgirsysgai`.

---

## Completed earlier workstream — production schema reconciliation (2026-07-10)

Done and verified. The eight `20260710135*_reconcile_*` migrations are confirmed present in
the **production** `supabase_migrations.schema_migrations` history (checked 2026-07-15), so the
prior handoff's "promote reconciliation to production" loose end is **resolved**. Durable audit
note: [`docs/verification/production-schema-reconciliation-20260710.md`](docs/verification/production-schema-reconciliation-20260710.md).

## Carried-forward security item (verify, then close)

**Production DB password possible exposure.** During the 2026-07-10 reconciliation audit, a
Supabase CLI command printed the production DB password into local tool output (never
committed). It was flagged for rotation. **Status unverified as of 2026-07-15.** Action: check
the 1Password item `Supabase DB Password - shared POP database` (vault `vibe_coding`)
last-changed date; if it predates 2026-07-10, rotate it and update the item. If already rotated
after 2026-07-10, delete this section. Do not rotate the 1Password service-account token.
