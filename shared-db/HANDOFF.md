# HANDOFF — shared-db current state

Date: 2026-07-17
Repo: `u2giants/shared-db`
Branch: `main` (matches `origin/main`, clean tree)

This file is the top-level "where are we" pointer for the next session. It is written
for a developer with **zero** prior context. Read it, then read the linked plan.

---

## Active workstream — DesignFlow local database connection-pool remediation

### What this is

DesignFlow developers connecting from India can authenticate successfully but then receive
`SequelizeConnectionAcquireTimeoutError: Operation timeout` on the first database-backed
request after a cold local startup. The measured new-connection handshake to the shared
Supabase pooler in AWS `us-east-1` is roughly 11–12 seconds. This is an application connection
lifecycle and local configuration problem, not a schema defect or a reason to terminate shared
database sessions.

### Current state

Planning is complete and its implementation gaps were closed with verified request-path,
environment, Supavisor, and Cloud Run evidence on 2026-07-17; application implementation has
not started. The comprehensive,
street-newcomer-ready implementation plan is
**[`fix_connection_pool.md`](fix_connection_pool.md)**. It records the verified configuration
differences across all six DesignFlow repositories, rejected approaches, target values,
file-by-file changes, exact helper contracts and test filenames, exact local launch procedure,
unit and cold-start acceptance tests, rollout/rollback, access, risks, and completion gates.

Critical decisions already made:

- Do not run broad `pg_terminate_backend` cleanup. It can kill unrelated CRM, DAM, PM/PIM,
  Supabase, or developer sessions and forces more cold connections.
- Do not create a shared-db migration or change any schema/data/Supabase setting.
- Keep `pool.min=0`, short idle eviction, and TCP keep-alive to preserve the existing
  stale-socket protection.
- Keep the normal BFF timeout at 30 seconds.
- Standardize startup readiness/retry, connection labels, safe pool budgets, local timeout
  headroom, and graceful shutdown across the four Sequelize services.

### Exact next action

Start at Phase 0 of `fix_connection_pool.md`: sync all six DesignFlow `sandbox-albert`
branches from `develop`, record five sanitized cold/warm baselines from the affected India
workstation, re-confirm the platform-managed session allowance (the endpoint is already verified
as shared Supavisor session mode `:5432`), then
implement the four service PRs in the documented order. Uma reviews and merges DesignFlow PRs;
the AI must not self-merge them.

**Verification gate:** implementation is complete only after 10/10 cold logins pass on the first
attempt, no acquire timeout/connection-limit/BFF error occurs, connection counts stay within the
measured budget, graceful shutdown removes only the owning service's labeled sessions, and the
final PR/SHA/timing evidence is added to the shared-db verification note.

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
