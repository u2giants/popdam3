# HANDOFF — shared-db current state

Date: 2026-07-17
Repo: `u2giants/shared-db`
Branch: `main` (matches `origin/main`, clean tree)

This file is the top-level "where are we" pointer for the next session. It is written
for a developer with **zero** prior context. Read it, then read the linked plan.

---

## Active workstream — DesignFlow database connection architecture

### What this is

DesignFlow is POP Creations' product-lifecycle-management system used by staff to manage RFQs,
items, licensing/tracking, and ERP synchronization. Its Angular frontend and BFF call four Node.js
/ Express / Sequelize services (Core Backend, Item Master, Tracking, and Data Syncing), deployed
to Google Cloud Run. The app repos are the six `popcre/designflow-*` repositories under
`C:/repos/dflow`; their sandbox branches serve `https://sandbox-albert.designflow.app`. All four
services share the hosted Supabase PostgreSQL project governed by this `u2giants/shared-db` repo.

The durable design now separates schema control from runtime connections: shared-db migrations
own all DDL, while auto-scaling Cloud Run services use Supavisor transaction mode and small,
validated per-process pools. The architecture is based on the deployed platform, not any one
developer workstation or network path.

### What we set out to do, and why

Implement [`fix_connection_pool.md`](fix_connection_pool.md) v3.0: move Core's legacy startup
DDL under shared-db ownership, use transaction pooling for Cloud Run, bound and validate every
client pool, gate traffic on readiness, label connections, and drain owned connections cleanly.

### Current state

Schema, code, automated tests, transaction-mode compatibility, and sandbox acceptance are
complete. Uma's normal PR review/merge and post-merge production verification remain.

- Migration `20260717163500_reconcile_dflow_backend_startup_contract.sql` was checked,
  dry-run/applied to preview, proven compatible with the old Core boot, merged in shared-db PR
  [#97](https://github.com/u2giants/shared-db/pull/97), applied to production by successful run
  `29611459054`, and audited live. Merge SHA: `293fd90697bb0a0024e196d6b4a2da2e298dbd15`.
- App heads are pushed on `sandbox-albert`: Item Master `bca5f16`
  ([PR #37](https://github.com/popcre/designflow-item-master/pull/37)), Tracking `a14afc1`
  ([PR #25](https://github.com/popcre/designflow-tracking/pull/25)), Data Syncing `509c010`
  ([PR #16](https://github.com/popcre/designflow-data-syncing/pull/16)), and Core `b4a015a`
  ([PR #62](https://github.com/popcre/designflow-backend/pull/62)). Uma has not merged them;
  the AI must not merge DesignFlow PRs.
- All four full unit suites passed: 693 tests. Preview port-6543 checks passed for all four
  services, including a real Sequelize transaction.
- GCP Secret Manager `DB_PORT` version 2 is 6543. The four new sandbox builds succeeded and
  deployed ready transaction-mode revisions. Each emitted a validated application name and
  `db_ready` before HTTP listen. Login, token, Item Library, and Tracking checks returned 200;
  logs had zero acquire-timeout, ceiling, or startup-fatal matches.
- Exact builds, revisions, and timings are in
  [`docs/verification/supabase-pooler-idle-connection-drop-20260623.md`](docs/verification/supabase-pooler-idle-connection-drop-20260623.md).

### Everything tried that did not work

- `api.sandbox-albert.designflow.app` did not resolve from this machine. The deployed smoke test
  used the canonical public Cloud Run BFF URL instead; all checks passed. This was a DNS-name
  issue, not an application failure.
- A local preview `supabase db push --dry-run` listed ten migrations because preview lagged
  production. The GitHub preview workflow applied the backlog plus reconciliation cleanly. No
  applied migration was edited.
- Cloud Run rejected two attempts to change `DB_PORT` from a secret reference to a literal in
  the same revision. A two-revision removal would temporarily omit a required setting, so the
  final atomic path retained the binding and added secret version 2 with value 6543. Healthy old
  revisions remained live throughout.

### Root causes and key findings

- Core boot previously launched `sequelize.sync()` plus 43 unawaited DDL/data statements against
  its max-5 pool. That block is gone and a regression test prevents its return.
- Session-mode clients unnecessarily reserved database backends across idle Cloud Run sessions.
  Transaction mode now shares backends only while queries/transactions are active.
- Live preview/production audit found every expected Core model table, column, and index already
  present, no lowercase orphan, and no pending factory-country backfill. The migration therefore
  reconciles/asserts canonical state without a destructive drop.
- All services now use validated max-5/min-0 pools, bounded deadlines, application labels,
  readiness gates, ceiling-aware retry, and graceful owned-pool shutdown. The code audit found no
  prepared statements or session-local features that would require session affinity.

### Exact next steps

1. Give Uma the four PRs and the v3 evidence for normal review. **Pass when** Uma merges each to
   `develop`; the AI does not merge them.
2. Watch each normal production deployment. **Pass when** the latest revision is ready, carries
   its production application name, and logs `db_ready` before HTTP listen.
3. Run production login, token, Item Library, and Tracking smoke checks. **Pass when** all return
   200 and logs contain no acquire timeout, ceiling, startup fatal, forced shutdown, or relevant
   5xx.
4. Review Supabase/Cloud Run connection telemetry after real traffic. **Pass when** backend/client
   pressure stays within platform capacity and pool snapshots show no sustained waiters.

### Constraints and gotchas

Keep transaction mode for auto-scaling application traffic, pool max 5/min 0, idle 10s, evict
5s, keep-alive, and BFF normal timeout 30s. Never add app-repo/startup DDL, broad session
termination, unbounded pools, or session-local features without an architecture review.

### Access and environment

`gh`, `gcloud`, `supabase`, and `op` were exercised successfully on this Windows machine.
Secrets and the test login are in 1Password vault `vibe_coding`; no value was logged or
committed. shared-db is on `main`; DesignFlow repos are on `sandbox-albert`. Preview ref:
`xjcyeuvzkhtzsheknaiu`; production ref: `qsllyeztdwjgirsysgai`; Cloud project:
`lithe-breaker-323913`, region `us-east4`.

### Open questions and risks

The only delivery risk is a future feature silently depending on session affinity (prepared
statements, temp tables, session `SET`, advisory locks, LISTEN/NOTIFY, or cross-request state).
Such a feature must trigger an explicit connection-architecture review. No schema rollback is
needed: the reconciliation migration is additive/assertive.

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

## Active workstream — Coldlion customer/vendor hub cleanup + extension-table design (2026-07-17)

### What this is
The Coldlion ERP customers (836) and vendors (539) were imported into the shared hubs, then the
**customer** side was de-duplicated and status-curated. `core.customer` is now 859 rows
(**140 active / 12 potential / 707 inactive**) with short `display_name`s, a `core.customer_alias`
table, and `core.merge_customer()`. Status is app-owned (survives Coldlion re-pulls). CRM pickers
now show `display_name` and hide inactive customers.

### Reference docs (read these before continuing)
- **[`docs/coldlion-customer-dedupe-review.md`](docs/coldlion-customer-dedupe-review.md)** — the
  full customer dedup ruling ledger + final state (what merged, statuses, aliases, the Amazon
  1P/3P split, defects found).
- **[`docs/coldlion-customers-vendors-20260715.md`](docs/app-migration-notes/coldlion-customers-vendors-20260715.md)**
  — the import/pipeline app-migration note.
- **[`fix_vendor_review.md`](fix_vendor_review.md)** (repo root) — detailed cold-start handoff to do
  the **vendor** (`core.factory`) equivalent (NOT STARTED: 529 rows, all active, no
  alias/merge_factory/display_name yet).
- **[`docs/per-app-extension-tables-plan.md`](docs/per-app-extension-tables-plan.md)** —
  implementation plan for per-app extension tables (`crm/pim/dam/plm.customer_ext` etc.) so
  app-specific attributes never bloat the shared `core.*` tables. Decision made 2026-07-17,
  reviewed by Kimi K3.

### Status
- **Customers: DONE + merged** (shared-db PRs #83, #84, #85, #86, #88, #91, #94, #96; all applied
  to prod). CRM picker frontend in **popcrm-web PR #3** (open, unmerged, awaiting review — merging
  deploys the live CRM).
- **Vendors: NOT STARTED** — follow `fix_vendor_review.md`.
- **Extension tables: PLAN ONLY** — `docs/per-app-extension-tables-plan.md`; no migration written.
- Frontend "hide inactive" for **poppim-web / popdam3** pickers: not started (same pattern as
  popcrm-web PR #3).

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
