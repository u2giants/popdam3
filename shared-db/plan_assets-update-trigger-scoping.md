# Plan: stop `public.assets` updates from re-running work nothing asked for

Historical planning handoff (write-once record, not current execution state): [original assessment handoff](HANDOFF.d/20261105T0203Z-edge-dev3-claude-supabase-assessment-plans.md).
Current state: [owning issue #5609](https://github.com/popcre/shared-db/issues/5609), the STATUS below, and [production/recovery evidence](docs/verification/database-efficiency/20261105T033714Z/assets-trigger-scoping-production-live.md). The remaining acceptance is not complete.
Owning issue: popcre/shared-db#5609. Overlaps and references: [plan_database_efficiency_and_api_security.md](plan_database_efficiency_and_api_security.md) (its §6 items 2, 7 and "delete/reinsert" note name `sync_asset_effective_tags()` and trigger write amplification on `assets`; this plan is the concrete fix for the `assets` part), #2421 (style-group change watermark; owns `stamp_style_group_asset_change()` — do not touch it), #1966 (unused-index evidence on `assets` / `dam_search_documents` — no index drops here). Sibling: [plan_dam-embedding-claim-speed.md](plan_dam-embedding-claim-speed.md) (the search-document rewrites this plan removes are also what re-queue embedding work).

## STATUS (2026-11-06 12:04 PM EST opening — full acceptance NOT met)

| Step | State | Evidence |
|---|---|---|
| 0 Re-measure baseline | complete | `docs/verification/database-efficiency/20261105T033714Z/assets-trigger-scoping-baseline.md`; exact query IDs recorded as text |
| 1 Claim objects, open branch | complete | #5609 signed ownership comment; reserved version 20261105033827 |
| 2 Contract tests | complete | Original definitions fail no-op ctid assertion; new passes locally and full PR/merge-group ephemeral database suite |
| 3 Migration: re-scope triggers | merged | PR #5618; immutable migration 20261105033827 |
| 4 Preview rehearsal + equivalence check | partial; hosted WAL target NOT met | Hosted behavior matches except legitimate wall-clock metadata; fixed representative trials improve mean runtime 74.20%, WAL 33.08%, not the required 50%. All trials retained in `assets-trigger-scoping-hosted-preview.md` |
| 5 Land via automatic promotion | VERIFIED complete | Run 41974228042 committed 20261105033827. After PR #5642, verification-only recovery 41979854831 succeeded with enforcing=true, errors=[], exact contract actual1/expected1, original hash/ledger bindings preserved; no SQL replay |
| 6 Live proof on production | New first healthy window selected; full target NOT accepted | Both prior windows invalidated. [Second-restart opening](docs/verification/issue-5609-trigger-acceptance/20261106-second-restart-opening.md): Nov6 12:04:19.556744PM EST,50tuples, strict original targets unchanged; earliest Nov7 same time only if all controls/traffic/functional criteria pass. Hosted and prior interim WAL deficits remain |
| 7 Cross-repo follow-up filed | complete | https://github.com/u2giants/popdam3/issues/753 |

Current application delivery: the existing [follow-up753](https://github.com/u2giants/popdam3/issues/753) is CLOSED and implemented by [app825](https://github.com/u2giants/popdam3/pull/825), merge `5e222ef452226de50103d49e499ce0b7b20f47d3`; do not refile or redo it. A separate selected-primary cache-writer omission was corrected and deployed by [app841](https://github.com/u2giants/popdam3/pull/841); root confirmed1,214 bounded cache repairs with preserved selected primary/non-cache fields. [Published app receipt](https://github.com/u2giants/popdam3/blob/5f6bc7191794355d59f63806dbd23a61ba8510e8/docs/verification/5609-primary-cache-repair.md) retains failed/partial/final attempts. These deliveries do not establish the unmet hosted or full-day WAL targets.

Search timestamp judgment: omit asset `updated_at` from the predicate; catalog inspection found no staleness detector reading the search document timestamp. All original functions remain unchanged. Derived thumbnail-cache writers were confirmed; reconciliation updates only differing cache fields for the existing primary asset. Image embedding, group clocks, counts and effective-tag functions remain intact. Optional cheap BEFORE-trigger changes were omitted because no per-trigger evidence justified expanding scope.

The isolated 1,000-asset fixture improved runtime 90.45% and total WAL 56.52%; this is not hosted or live acceptance. The actual hosted diagnostic found only `style_group_changed_at` different between repeated mixed workloads; all business fields and document checksums matched. Later production-shaped, predeclared OLD/NEW/OLD/NEW trials used aggregate-only measured lengths and synthetic 768-dimensional vectors, with all results and size/sample/physical-state limitations retained. They **did not** establish the 50% hosted WAL target. Additional synthetic repeats were stopped rather than selecting a favorable pair or suppressing legitimate writes. The required real 24-hour production interval remains decisive and pending; Step 4 is not marked complete.

Canonical POP DAM repository verified as `u2giants/popdam3`; earlier organization references in this plan were incorrect. The filed application follow-up is a separate owned need; no application implementation is claimed here.

## 1. Ultimate goal

Albert asked to cut how much compute the shared database uses. The single biggest write cost is the photo library (POP DAM) re-saving every file it re-scans: each save rewrites about 30 fields and then sets off a chain of follow-on work (rebuilding the file's search entry, re-checking its style group's cover picture, recounting the group) even when nothing about the file actually changed. Done means a re-scan of an unchanged file costs a small fraction of today's time and log volume, and **every outcome stays the same**: search results, group covers, group counts, tags, render and embedding queues all end up exactly as they would today. **If a step conflicts with this goal, the goal wins — stop and flag it on popcre/shared-db#5609.**

## 2. The application

- `popcre/shared-db` owns the shared Supabase Postgres (production target resolved from protected configuration) used by DesignFlow, POP DAM, PIM, CRM. Schema changes are SQL migrations under `supabase/migrations/`, reach production only via the automatic promotion workflow (`.github/workflows/shared-supabase-migrations.yml`) after preview rehearsal, tests, and no open `review-finding` issue (owner ruling 2026-10-29, `docs/owner-rulings.md`). No manual production command, ever.
- `public.assets` (~150k live rows, ~3.4 GB with 46 indexes) is POP DAM's file catalogue. POP DAM lives in `u2giants/popdam3` (local clone `/home/ahazan/repos/popdam3`). Its Bridge Agent (`apps/bridge-agent/src/index.ts`, ~line 1221-1290) scans the NAS and posts each file to the `agent-api` edge function (`supabase/functions/agent-api/index.ts`, `handleIngest` at line 950), which writes `assets` through PostgREST as `service_role`.

## 3. Trigger

Supabase technician report `/home/ahazan/Dropbox/ai/analysis-detail.md` §2 (top load drivers) and §5 (bloat): a PostgREST PATCH on `assets` setting ~29 columns — 88,904 calls, 255 ms mean, 4.57 GB WAL, ~9% of DB time in their window — plus 12+ AFTER UPDATE triggers firing regardless of which column changed; `assets` at 17.8% dead tuples.

Re-measured 2026-11-04 ~9:00 PM EST (`extensions.pg_stat_statements`, reset 2026-11-04 12:52 PM EST): the 30-column variant (division/mg01-03/size/sku/sku_sequence included) has 18,440 calls, 131.9 ms mean, 2,432 s total, 1.13 GB WAL; an 18-column variant (no SKU fields) 6,217 calls, 109.6 ms, 313 MB WAL. `pg_stat_user_tables`: 15,508 dead / 150,106 live (~10% right after an autovacuum at 6:35 PM EST); 85,156 updates of which only 45,185 were HOT.

## 4. Scope

In:
- One forward migration that replaces trigger *definitions* on `public.assets` (timing/events/`UPDATE OF`/`WHEN`) for the triggers listed in §9 step 3, plus, only if step 3's judgment call requires it, a no-op short-circuit inside `public.refresh_dam_search_asset_document(uuid)`.
- A one-time reconcile of the derived `style_groups.primary_thumbnail_url/_error` cache (see §6 finding F5) inside the same migration.
- New contract test file `supabase/tests/assets_update_trigger_scoping_contracts.sql`.
- Filing the app-side follow-up issue in `u2giants/popdam3` (§9 step 7). Not implementing it.

NOT in this plan:
- Any POP DAM code change (belongs to `u2giants/popdam3`).
- `stamp_style_group_asset_change()` / `assets_style_group_change_clock` (owned by #2421).
- `sync_asset_effective_tags()` body (already scoped `UPDATE OF style_group_id, is_deleted` and diff-based since #2213).
- Index drops (#1966), autovacuum reloptions on `assets` (separate decision; the report itself says vacuum only mitigates), Realtime/publication changes.
- Changing what the search document contains or how embeddings are prioritised.

## 5. Historical pre-change state (production catalog, read 2026-11-04 ~8:55 PM EST)

This is the original 19-trigger baseline, not the installed post-change catalog. Current delivered definitions and verification are recorded in [production/recovery evidence](docs/verification/database-efficiency/20261105T033714Z/assets-trigger-scoping-production-live.md) and the STATUS above; do not redo the delivered migration from this table. Baseline query: `select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.assets'::regclass and not tgisinternal`.

| Trigger | Timing / level | Events (column list, WHEN) | Function | Fired on the pre-change scan PATCH? |
|---|---|---|---|---|
| `set_assets_updated_at` | BEFORE row | UPDATE | `set_assets_updated_at()` sets `updated_at=now()` | yes (trivial, keep) |
| `assets_style_group_change_clock` | BEFORE row | INSERT, UPDATE | `stamp_style_group_asset_change()` (ROW compare; lock only on change) | yes (cheap; #2421 owns) |
| `redirect_retired_wb_licensor` | BEFORE row | INSERT, UPDATE OF licensor_id | `plm.redirect_retired_wb_licensor()` | yes (one PK lookup on `core.licensor`) |
| `trg_compute_primary_sort_tier` | BEFORE row | INSERT, UPDATE OF filename, relative_path, file_type, thumbnail_url, thumbnail_error | `compute_primary_sort_tier()` (pure string logic) | yes (cheap) |
| `trg_set_path_attrs` | BEFORE row | INSERT, UPDATE OF relative_path | `trg_set_asset_path_attrs()` | no |
| `assets_effective_tags_sync` | AFTER row | INSERT, DELETE, UPDATE OF style_group_id, is_deleted | `sync_asset_effective_tags()` | only on revive (`is_deleted` in body) |
| **`trg_dam_search_assets_refresh`** | AFTER row | INSERT, DELETE, UPDATE OF filename, relative_path, cover_description, ai_description, scene_description, customer, program, licensor_name, property_name, product_category, thumbnail_url, file_type, asset_type, workflow_status, is_licensed, style_group_id, is_deleted, updated_at, modified_at | `trg_refresh_dam_asset_search_document()` → `refresh_dam_search_asset_document(uuid)` | **yes, every call** (filename, file_type, modified_at, is_licensed, workflow_status are always in the SET list) |
| **`trg_sync_primary_on_thumbnail`** | AFTER row | INSERT, UPDATE (no column list, no WHEN) | `sync_primary_asset_on_thumbnail()` | **yes, every call** |
| `trg_auto_queue_render` | AFTER row | INSERT, UPDATE OF thumbnail_error, thumbnail_url | `auto_queue_render()` | when thumbnail fields sent |
| `trg_assets_enqueue_image_embed` | AFTER row | INSERT, UPDATE OF thumbnail_url | `dam.assets_enqueue_image_embed_trg_fn()` (already checks distinct) | when thumbnail_url sent |
| `trg_sync_cover_description_to_style_group` | AFTER row | INSERT, UPDATE OF cover_description, style_group_id | `sync_cover_description_to_style_group()` | no (AI-tagging PATCH yes) |
| `trg_sync_designer_to_style_group` | AFTER row | INSERT, UPDATE OF designer_name, technical_designer_name, freelancer_name, style_group_id | `sync_designer_to_style_group()` (unconditional `UPDATE style_groups`) | no |
| `trg_assets_sync_pdf_rich_extraction_group` | AFTER row | UPDATE OF style_group_id WHEN old≠new | `dam.sync_pdf_rich_extraction_style_group()` | no (already scoped) |
| `trg_assets_rollup_pdf_rich_extraction_groups` | AFTER statement | UPDATE OF style_group_id | `dam.rollup_moved_pdf_rich_extraction_groups()` | no |
| `trg_refresh_primary_on_asset_soft_delete` | AFTER row | UPDATE OF is_deleted WHEN true←false | `refresh_primary_on_asset_soft_delete()` | no (already scoped) |
| `trg_refresh_sg_counts_on_update` | AFTER statement, transition tables | UPDATE | `refresh_style_group_counts_on_asset_change()` (joins old/new tables, acts only if is_deleted/style_group_id changed) | yes (join of 1-row tables; cannot take a column list — see §7) |
| `trg_refresh_sg_counts_on_insert` / `_on_delete` | AFTER statement | INSERT / DELETE | same | n/a |
| `trg_refresh_group_on_asset_hard_delete` | AFTER row | DELETE | `refresh_group_on_asset_hard_delete()` | n/a |

Historical source lineage includes `20260713221518_dam_hybrid_search_foundation.sql` and `20260723113000_dam_core_licensor_property_cutover.sql`. The delivered change is [immutable migration 20261105033827](supabase/migrations/20261105033827_assets_update_trigger_scoping.sql); its actual installed definitions are preserved in the production/recovery evidence above. Before any further change, re-read the **live** body via `pg_get_functiondef` / `pg_get_triggerdef` rather than copying this baseline or an old migration.

Caller (u2giants/popdam3 `origin/main` c5c501b5, 2026-11-04): `supabase/functions/agent-api/index.ts:1216-1234` builds `updateFields` for an existing-path file — filename, file_type, file_size, width, height, modified_at, file_created_at, quick_hash, quick_hash_version, `last_seen_at: new Date()`, workflow_status, is_licensed, optional pdf_page2_url, `...thumbnailFields`, `...skuFields` (division/mg/size/sku/licensor/property) — and sends it unconditionally via `db.from("assets").update(updateFields).eq("id", existingByPath.id)`. Same pattern for moves at `index.ts:1156` (`moveUpdates`). `last_seen_at` changes every scan, so the row write itself is legitimate; the follow-on work is not.

## 6. Key findings and root cause

- **F1 — `UPDATE OF` is "column named in SET", not "column changed".** Postgres fires an `UPDATE OF` trigger when the column appears in the statement's target list, even with an identical value. Because PostgREST sends every field in the JSON body, `trg_dam_search_assets_refresh` fires on 100% of scan PATCHes.
- **F2 — the search refresh always writes.** `refresh_dam_search_asset_document(uuid)` rebuilds the full search text (joins `style_groups`, `pdf_text_samples`, `asset_tags`, `style_group_tags`, `asset_characters`, `core.character`), hashes it, then **unconditionally** upserts `dam_search_documents` with `indexed_at=now()`, `source_updated_at=greatest(updated_at, modified_at)` and clears lease fields. Every scan therefore creates a new `dam_search_documents` tuple plus index entries (WAL and dead tuples on a second table), even when `content_sha256` is unchanged (embedding is preserved in that case, so outcome-wise it is a no-op except `indexed_at`/`source_updated_at`).
- **F3 — the search trigger's column list is incomplete.** The function reads `content_type`, `product_material`, `product_dimensions` which are NOT in its `UPDATE OF` list; today those changes refresh the document only incidentally (when some other listed column is also in the SET). A correct `WHEN` must include them — this preserves today's incidental behaviour and closes the gap.
- **F4 — `UPDATE OF` misses BEFORE-trigger rewrites; `WHEN` does not.** `customer`/`program` are set by `trg_set_path_attrs` from `relative_path`; `licensor_id` can be rewritten by `redirect_retired_wb_licensor`. An AFTER trigger's `WHEN (OLD.x IS DISTINCT FROM NEW.x)` sees the final row, so value-based `WHEN` is strictly more correct than column lists.
- **F5 — `trg_sync_primary_on_thumbnail` has no scope and silently heals drift.** It does a `style_groups` lookup/update on every asset update. Its effect depends only on `NEW.thumbnail_url`, `NEW.thumbnail_error`, `NEW.style_group_id`, `NEW.id`, `NEW.asset_type` and (case 1) `OLD.thumbnail_url`. But production has **57** style groups whose cached `primary_thumbnail_url/_error` differ from their primary asset (`select count(*) from style_groups sg join assets a on a.id=sg.primary_asset_id where sg.primary_thumbnail_url is distinct from a.thumbnail_url or sg.primary_thumbnail_error is distinct from a.thumbnail_error`, 2026-11-04 ~9:00 PM EST). Today a re-scan of that primary asset would fix the cache incidentally; scoping removes that. Hence the one-time reconcile in step 3 so outcome is preserved (cache correct) rather than regressed.
- **F6 — `updated_at` defeats a naive value-based WHEN.** `set_assets_updated_at` makes `NEW.updated_at` differ on every update, so `updated_at` cannot be in the search trigger's `WHEN` without making it fire always. `updated_at` only feeds `dam_search_documents.source_updated_at`. Readers of `source_updated_at` (catalog grep 2026-11-04): `refresh_sku_human_description()`, `refresh_dam_search_asset_document`, `rebuild_dam_search_documents()`, `plm.peanuts_publish_lifecycle(uuid)`, `refresh_dam_search_style_group_document(uuid)`; POP DAM app code only has it in generated `src/integrations/supabase/types.ts`. Step 3's judgment call depends on what those readers do with it.
- **F7 — HOT ratio ~53%.** Half the updates are non-HOT, meaning some indexed column value really changes (likely `last_seen_at` is not indexed; `modified_at`, `thumbnail_*`, `workflow_status` are). App-side "send only changed fields" does not change HOT eligibility (Postgres decides HOT by value), so HOT improvement is not a goal of this plan.

## 7. Approaches considered and REJECTED

- **`suppress_redundant_updates_trigger()` (skip identical rows).** Never matches: `last_seen_at` changes every scan and `updated_at` is bumped. Zero effect.
- **Column lists only (`UPDATE OF`) without `WHEN`.** Does not help: PostgREST names every column (F1). And misses BEFORE-trigger rewrites (F4).
- **Scope `trg_refresh_sg_counts_on_update` with a column list.** Postgres forbids transition tables (`REFERENCING ... TABLE`) on triggers with a column list. Its function already filters rows; on a 1-row PATCH the cost is a join of two 1-row tuplestores. Leave as is; revisit only if step 0 shows it in the top costs.
- **Turn the search refresh into an async queue.** Changes timing of search freshness (an outcome). Out of scope.
- **Drop `updated_at`/`modified_at` from the search trigger entirely without checking readers.** Could make `source_updated_at` stale where something relies on it. Handled as a gated judgment call (§9 step 3b).
- **Fix only in the app (send changed fields).** Helps, but every other writer (admin handlers, AI tagging, helper-api, future code) keeps the trigger fan-out, and F3/F4 correctness gaps stay. DB-side scoping is the durable fix; app side is a follow-up.
- **Autovacuum tuning / bigger instance.** Treats the symptom; the report itself says bloat re-accumulates until the write pattern changes.

## 8. Design decisions

Locked (2026-11-04):
- Every trigger keeps firing whenever any column its function actually reads changes **in value**, including values rewritten by BEFORE triggers. Scoping is by `WHEN (ROW(OLD.cols) IS DISTINCT FROM ROW(NEW.cols))` on an AFTER UPDATE trigger; INSERT/DELETE move to a separate trigger with the same function and no `WHEN` (a `WHEN` referencing `OLD` is illegal on INSERT, `NEW` on DELETE).
- Function bodies were kept unchanged; step 3b's optional short-circuit was not needed. Trigger names are preserved for the UPDATE half (append `_ins_del` for the split-off half) so greps and docs still match.
- Delivered as one forward-only migration in this repo; app change is a cross-repo follow-up.
- `assets_style_group_change_clock`, `assets_effective_tags_sync`, the sg-count statement triggers, and already-scoped triggers are untouched.

Resolved during implementation: step 3b omits `updated_at` from the search predicate because the reader audit found no asset-staleness detector relying on that search timestamp; `modified_at` remains included and function bodies are unchanged. The cheap BEFORE triggers (`redirect_retired_wb_licensor`, `trg_compute_primary_sort_tier`) were left unchanged because no per-trigger measurement justified expanding scope. These are delivered decisions, not open design work; see [the baseline audit](docs/verification/database-efficiency/20261105T033714Z/assets-trigger-scoping-baseline.md) and the STATUS above. The still-pending production acceptance remains on #5609 and is not claimed here.

## 9. Steps

**Step 0 — Re-measure baseline (read-only).** On production via Supabase MCP `execute_sql`: (a) the §3 `pg_stat_statements` query (`where query ilike 'with pgrst_source as (update "public"."assets"%'`, calls/mean/total/wal_bytes) and its reset time from `extensions.pg_stat_statements_info`; (b) `n_dead_tup, n_live_tup, n_tup_upd, n_tup_hot_upd` for `public.assets` and `public.dam_search_documents`; (c) the F5 drift count; (d) the §5 trigger listing. Optional: `explain (analyze, buffers)` is not possible on a write in production — skip it. Record in `docs/verification/database-efficiency/<UTC>/assets-trigger-scoping-baseline.md` with exact queries. Gate: file exists with numbers and queries; quote times in EST.

**Step 1 — Ownership and branch (completed historical evidence).** Load `shared-db-change`; declare `ai-task-gates start --class shared-db`; the signed scope on popcre/shared-db#5609 named exact objects: triggers `trg_dam_search_assets_refresh`, `trg_sync_primary_on_thumbnail`, `trg_sync_designer_to_style_group`, `trg_sync_cover_description_to_style_group`, `trg_auto_queue_render`, `trg_assets_enqueue_image_embed` on `public.assets`; function `public.refresh_dam_search_asset_document(uuid)` (only if 3b needs it); data `public.style_groups.primary_thumbnail_url/_error` (reconcile). Own worktree from `origin/main`. Delivered evidence: scope comment posted and signed; owned branch exists. Future work follows current-workflow.md and the surviving locks/reservations, not retired author-admission commands.

**Step 2 — Contract tests first** (`supabase/tests/assets_update_trigger_scoping_contracts.sql`; repo style is plain SQL in `begin; ... do $$ ... raise exception ... $$; rollback;`, see `supabase/tests/admin_config_apply_counters_contracts.sql`; CI runs every file via `.github/workflows/database-contract-tests.yml` against an ephemeral DB). Build fixtures: one style group, two assets (A primary with thumbnail, B non-primary), tags. Cases (each = one assertion block):
1. *Catalog*: each re-scoped trigger exists with expected `tgtype` and a non-null `WHEN` (`pg_get_triggerdef` contains `IS DISTINCT FROM`); `_ins_del` siblings exist.
2. *No-op PATCH is quiet*: record `dam_search_documents.indexed_at` and `xmin` for A; `update assets set filename=filename, file_type=file_type, modified_at=modified_at, is_licensed=is_licensed, workflow_status=workflow_status, last_seen_at=now() where id=A`; assert search row `xmin` unchanged and `style_groups` row `xmin` unchanged. (Fails on old triggers — proves the gain.)
3. Regression rows in §10 table, each asserting the downstream effect still happens.
Gate: file runs in CI; case 2 fails before step 3 and passes after; all §10 rows pass both before and after (except where noted "new").

**Step 3 — Migration** `supabase/migrations/<UTC>_assets_update_trigger_scoping.sql`. For each trigger: `drop trigger if exists ... ; create trigger ...` in one transaction (both are fast catalog ops taking a brief `SHARE ROW EXCLUSIVE` lock on `assets`).

3a. Search document — replace `trg_dam_search_assets_refresh` with:
```sql
create trigger trg_dam_search_assets_refresh_ins_del
  after insert or delete on public.assets
  for each row execute function public.trg_refresh_dam_asset_search_document();
create trigger trg_dam_search_assets_refresh
  after update on public.assets
  for each row when (
    row(old.id, old.filename, old.relative_path, old.content_type, old.cover_description, old.ai_description,
        old.scene_description, old.customer, old.program, old.licensor_name, old.property_name,
        old.product_category, old.product_material, old.product_dimensions, old.thumbnail_url,
        old.file_type, old.asset_type, old.workflow_status, old.is_licensed, old.style_group_id,
        old.is_deleted, old.modified_at)
    is distinct from
    row(new.id, new.filename, new.relative_path, new.content_type, new.cover_description, new.ai_description,
        new.scene_description, new.customer, new.program, new.licensor_name, new.property_name,
        new.product_category, new.product_material, new.product_dimensions, new.thumbnail_url,
        new.file_type, new.asset_type, new.workflow_status, new.is_licensed, new.style_group_id,
        new.is_deleted, new.modified_at))
  execute function public.trg_refresh_dam_asset_search_document();
```
Re-derive the column set from the live `refresh_dam_search_asset_document` body before writing (every `a.<col>` it reads). 3b judgment (F6): read the five `source_updated_at` readers. If none uses it to detect staleness against `assets.updated_at` (i.e., it's informational / ordering only), omit `updated_at` from the WHEN (as above) and document that `source_updated_at` now reflects the last search-relevant change. If any reader *does* rely on it, instead keep the trigger firing on any update but add to the function an early exit: compute `v_hash` and the metadata jsonb; if both equal the stored row's, `update dam_search_documents set source_updated_at = ... where ... and source_updated_at is distinct from ...` and return (smaller write, no search_text/lease churn). Record which branch was taken and why in the migration header.

3c. `trg_sync_primary_on_thumbnail` → `_ins_del`-style split (INSERT only, no DELETE) plus UPDATE with `when (row(old.thumbnail_url, old.thumbnail_error, old.style_group_id, old.asset_type) is distinct from row(new.thumbnail_url, new.thumbnail_error, new.style_group_id, new.asset_type))`. Then the one-time reconcile, the same assignment as function case 2:
```sql
update public.style_groups sg set primary_thumbnail_url = a.thumbnail_url, primary_thumbnail_error = a.thumbnail_error, updated_at = now()
from public.assets a where a.id = sg.primary_asset_id
  and (sg.primary_thumbnail_url is distinct from a.thumbnail_url or sg.primary_thumbnail_error is distinct from a.thumbnail_error);
```
Judgment: before writing it, sample 5 of the 57 drifted groups on production (read-only) to confirm drift is genuinely stale cache and not an intentional override path (grep migrations/popdam3 for writers of `primary_thumbnail_url`). If an intentional writer exists, drop the reconcile, keep the trigger unscoped, and flag on popcre/shared-db#5609.

3d. Already-column-listed AFTER triggers whose functions write unconditionally — add value `WHEN` (keep `UPDATE OF` lists too, harmless): `trg_sync_designer_to_style_group` on `(designer_name, technical_designer_name, freelancer_name, style_group_id, is_deleted)` (its aggregate filters `is_deleted=false`, so `is_deleted` must be added — F3-type gap); `trg_sync_cover_description_to_style_group` on `(cover_description, style_group_id, is_deleted)` (fallback query filters `is_deleted`); `trg_auto_queue_render` on `(thumbnail_error, thumbnail_url, filename)`; `trg_assets_enqueue_image_embed` already checks distinct inside — leave.
Gate: migration applies cleanly on a fresh DB in CI; `pg_get_triggerdef` output matches intent.

**Step 4 — Preview rehearsal.** Open PR; CI applies to the preview branch. In preview: run a 1,000-row synthetic "re-scan" (`update assets set <the 30 PATCH columns> = themselves, last_seen_at=now() where id in (...)`) before and after, comparing `pg_stat_statements` mean and `pg_current_wal_lsn()` delta. Equivalence check: snapshot `dam_search_documents (entity_id, content_sha256, metadata, embedding is null)` and `style_groups (id, primary_asset_id, primary_thumbnail_url, asset_count…)` before, run a mixed workload (rename, thumbnail change, regroup, soft-delete, revive, designer change, cover description change, no-op), compare after against the same workload run on the pre-migration preview state. Gate: no-op batch WAL and time down ≥50%; mixed-workload snapshots identical (except `indexed_at` and, under 3b-branch-1, `source_updated_at` for no-op rows). Record in the verification folder.

**Step 5 — Land.** Merge when required checks pass; the automatic promotion workflow applies it. Never apply manually. Reviews are advice only.

**Step 6 — Live proof (NOT accepted).** Both prior windows remain invalid and preserved. After5896 corrected the producer-supported retained-lease protocol and a fresh functional read passed, root selected the FIRST complete healthy post-restart capture: **November6,2026 12:04:19.556744PM EST**, earliest **November7 at that same EST time**, conditional on all original and stricter family targets. The new50-tuple vector is independently hash-verified; no role/LIMIT/cost filtering, generated traffic, relaxed threshold or favorable recapture. [The new receipt](docs/verification/issue-5609-trigger-acceptance/20261106-second-restart-opening.md) preserves both failed sources, reset identities, exact selection and baseline. The hosted33.08%/required50% and previous genuine interim WAL deficit remain unresolved. Keep the same issue OPEN and live proof unchecked until the complete actual period passes.

**Step 7 — Cross-repo follow-up** (file, do not implement): issue in `u2giants/popdam3`, title "agent-api ingest: send only changed asset fields", body: in `supabase/functions/agent-api/index.ts` `handleIngest`, the existing-path branch (`updateFields`, ~line 1216) and move branch (`moveUpdates`, ~line 1156) should diff against the already-fetched row (extend the `existingByPath` select to the compared columns) and send only changed fields plus `last_seen_at`; reference `apps/bridge-agent/src/index.ts:~1265` (`api.ingest`) and this plan. Gate: issue URL recorded on popcre/shared-db#5609.

## 10. Tests required — adversarial / regression table

All in `supabase/tests/assets_update_trigger_scoping_contracts.sql`; existing suite (`database-contract-tests.yml`, every `supabase/tests/*.sql`) must stay green — in particular any existing file touching these triggers (`grep -l "trg_dam_search_assets_refresh\|sync_primary_asset_on_thumbnail\|sync_designer_to_style_group" supabase/tests/*.sql`).

| # | Hostile / edge input | Expected | Assertion |
|---|---|---|---|
| R1 | Rename A (`filename`) | search doc `title`/hash change | `dam_search_documents.title = new filename` |
| R2 | `relative_path` change only → BEFORE sets `customer/program` | search doc `path`, `customer` updated | doc.customer = infer_path_attrs result |
| R3 | `content_type` / `product_material` / `product_dimensions` change alone (new, F3) | doc metadata updated | metadata->>'content_type' = new |
| R4 | `licensor_id` set to retired DC/HP id; `licensor_name` changed | redirect still applies; doc licensor_name updated | `assets.licensor_id = WB`; doc text contains name |
| R5 | `is_deleted` true then false (revive) | doc deleted then re-created; effective tags removed then restored; sg counts refresh | row counts |
| R6 | `style_group_id` A→other group | both groups' docs refreshed; effective tags re-derived; designer/cover re-synced for new group | per-table asserts |
| R7 | Thumbnail appears on asset in group with no primary | group primary assigned | `style_groups.primary_asset_id = A` |
| R8 | Primary asset's `thumbnail_error` changes only | cache updated | `primary_thumbnail_error = new` |
| R9 | `thumbnail_error` set, `thumbnail_url` null | `render_queue` row pending | exists |
| R10 | `thumbnail_url` → new .jpg | embed job enqueued (when `dam.image_embed_enabled()`) | job exists |
| R11 | `designer_name` change; and non-primary soft-delete with distinct designer (new is_deleted case) | `style_groups.designer_*`/`designer_conflict` recomputed | values |
| R12 | `cover_description` change on primary; primary soft-deleted → fallback | `style_groups.cover_description` correct | value |
| R13 | No-op PATCH (all 30 columns = same, `last_seen_at=now()`) | no write to `dam_search_documents` or `style_groups` | `xmin` unchanged (fails pre-migration) |
| R14 | NULL→NULL and NULL→value on every WHEN column | NULL→NULL quiet, NULL→value fires | `IS DISTINCT FROM` semantics |
| R15 | Multi-row UPDATE (statement touching 3 assets, one changed) | only changed row's doc rewritten; sg-count statement trigger still correct | xmin per row |
| R16 | INSERT and hard DELETE | doc created / deleted; sg counts | via `_ins_del` triggers |

## 11. Constraints, standing rules, gotchas

- Any further structural work: load `shared-db-change`, read [current-workflow.md](docs/agents/current-workflow.md), retain exact scope on popcre/shared-db#5609, start the shared-db task class and use an owned current-upstream worktree plus surviving reservation/lock tooling. Retired author-claim/admission commands are not a delivery step. Production read-only; promotion only through the workflow; no open `review-finding` issue at promotion.
- Never hand-edit `types/database.types.ts` (no type change expected anyway).
- `WHEN` cannot reference `OLD` on INSERT or `NEW` on DELETE — that is why triggers are split. Transition-table triggers cannot have column lists.
- AFTER row triggers fire in name order; renaming changes order. Keep UPDATE-half names identical; check no function depends on another trigger's side effect ordering (search refresh reads `style_groups` that designer/cover triggers write — names `trg_dam_…` < `trg_sync_…`, unchanged).
- Do not disturb #1966 counters (`pg_stat_reset` forbidden) or #2421's clock trigger.
- Sign GitHub posts with `$AI_GH_SIGNATURE`. Times in EST.

## 12. Access and environment

Supabase MCP `execute_sql` (read-only use on production; `pg_stat_statements` in schema `extensions`). `gh` authenticated for `popcre/shared-db` and `u2giants/popdam3`. Preview ref via `ai-private-config value supabase_shared_preview_ref` (never paste the value). No secrets needed beyond CI-held ones.

## 13. Done, risks, open questions

Done: tests + migration merged; promoted; step 6 artifact shows targets met; drift 0; popdam3 follow-up filed; this STATUS updated with artifact paths; handoff updated; live-proof checkbox ticked on popcre/shared-db#5609.
Risks: a missed column in a `WHEN` silently stops a refresh (mitigated by re-deriving columns from live bodies + R1-R16); the reconcile touches up to ~57 `style_groups` rows (rollback = re-run the old trigger definitions from the prior migration; cache rows self-correct). Rollback of triggers: a forward migration restoring the previous definitions verbatim (capture them in the migration header comment).
Open: 3b branch (decided by reading `source_updated_at` readers); whether to scope BEFORE triggers (step 0 data); cause of the 57 drifted groups (step 3c sampling).

## Self-audit

1. Fresh session executes without asking? Yes — §2/§5 name every object, file and live definition source; §9 gives SQL, judgment criteria and gates; §12 access. Gap found and fixed: originally no rule for `updated_at` (F6) — now step 3b has a two-branch decision.
2. Background and ruled-out ideas carried? Yes — §6 F1-F7 with measured evidence and times, §7 seven rejections with reasons, §4 out-of-scope with owners (#2421, #1966, popdam3).
3. Goal clear enough for judgment calls? Yes — §1 "same outcomes, less work", §8 locked rule "fire on any value change of any column read", and every judgment step says to stop and flag on popcre/shared-db#5609 when the goal is at risk.

Production application and the exact post-apply baseline are preserved in `docs/verification/database-efficiency/20261105T033714Z/assets-trigger-scoping-production-live.md`. The coordinator independently found zero thumbnail drift; separate catalog reads verified every installed trigger definition and the unchanged embedding trigger. The catalog verifier was repaired through its supported hash-bound contract/recovery route: successful run 41979854831 verifies the exact applied source without replaying SQL. The original failed catalog run remains in the record. The 24-hour performance/correctness acceptance remains unchecked.
