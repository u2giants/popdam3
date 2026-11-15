---
issue: 6325
status: OPEN
owner: mimo/dflow-snapshot-demolition
---

# dflow snapshot demolition - shared-db design decision, then execute

## 0. Business decisions only the owner can make

**None - nothing in this workstream needs the owner.** The remaining choice (below) is technical and belongs to the executing session.

Already settled - do NOT re-ask (Albert Hazan, chat):
- 2026-11-13 verbatim "drop the empty shelf" and "approved"/"do it": the stale-image cleanup and the empty `dflow_prod_old` shelf are DONE (see https://github.com/popcre/designflow-data-syncing/issues/126).
- 2026-11-14 verbatim "moot": the historical MG01-MG03 reclassification (https://github.com/popcre/shared-db/issues/1984) is dead - never run, never revive it; its helper `api.resolve_item_mg_category` retires.
- 2026-11-14: the owner was shown the implications and asked for this workstream to proceed ("say 'moot' and I finish the snapshot cleanup" -> "moot").
- 2026-11-14: Muse (second opinion) independently recommended demolition after the reader move; the only caveat (a future live-list category fix) was surfaced to the owner and does not block.

## 1. What this application is

DesignFlow PLM is POP Creations' product-lifecycle system (Angular -> BFF -> Express + Sequelize; six repos under https://github.com/popcre/designflow-*). It and three sibling apps (PIM/CRM/DAM frontends) share ONE Supabase project (`qsllyeztdwjgirsysgai`, the "shared POP database") holding schemas `dflow_prod` (DesignFlow production, single-schema), `plm` (shared item master + licensor scrape catalogs), `core`/`app`/`crm`/`pim`/`dam`/`api`/`public` (shared company data and API surface), and `dflow` - the subject of this workstream. All structural database work is authored in https://github.com/popcre/shared-db (claim-first; see its AGENTS.md).

## 2. What we set out to do, and why

After the stale-image cleanup (255,358 rows deleted; empty shelf `dflow_prod_old` dropped - all done and live-verified), the last cleanup item is the production `dflow` schema: a 547 MB FROZEN SEED TWIN left behind by the Cloud SQL -> Supabase migration. The DesignFlow app never reads it (it runs single-schema `dflow_prod`; app roles are denied on `dflow`). Goal: move its two readers onto live objects, then demolish it, per owner rulings above.

## 3. Current state - what is true right now

DONE and live-verified:
- All 255,358 stale image rows deleted (four `itemAttachment` copies); `dflow_prod_old` dropped from production (ledger version 20261114022200; pg_namespace count 0; health 200). Evidence trail: https://github.com/popcre/designflow-data-syncing/issues/126 and https://github.com/popcre/shared-db/issues/6301.
- Reader audit of production `dflow` (2026-11-15, pg_depend + definition scans): exactly TWO outside readers - `public.style_tracker_rows_with_bridge` (view; joins `dflow."RFQItem"/"RFQGroup"`) and `api.resolve_item_mg_category(integer)` (SQL function; reads `dflow."itemHeader"`).
- Full snapshot backup: `gs://designflow-storage/backups/dflow-stale-cleanup-2026-11-12/prod_dflow_full_schema.dump` (53 MB compressed, 1140 TOC entries, `pg_restore --list` verified).
- Owner "moot" ruling recorded; the MG reclassification will never run.

NOT done (this workstream):
- The demolition migration was authored, admitted and CI'd as PR https://github.com/popcre/shared-db/pull/6327 (branch `mimo/dflow-snapshot-demolition`, version 20261115022159: repoint the view to `dflow_prod` RFQ tables byte-identically -> drop the helper -> TOAST-aware dependent guard -> `drop schema if exists dflow cascade`). WITHDRAWN - see section 4. Work issue https://github.com/popcre/shared-db/issues/6325 remains open; claim https://github.com/popcre/shared-db/issues/6326 released; nothing was applied.

## 4. Everything we tried that did NOT work

1. **PR #6327 as one migration (the main lesson).** The shared-db ephemeral contract suite replays every migration from empty and then runs ~359 contract tests. Dropping schema `dflow` breaks a family of them (`dflow_factory_artist_identity_bridge_contracts.sql`, `dflow_identity_permissions_comments_bridges_contracts.sql`, `designflow_workflow_action_handoff_integrity_contracts.sql`, `canonical_notification_timestamp_and_unread_index_contracts.sql`, `designflow_item_assignment_action_history_contracts.sql`, `designflow_trusted_backend_actor_contracts.sql` and others). Verified differential: every other open PR passed those tests; only this PR failed them, twice. Conclusion: **the `dflow` schema is a SUPPORTED FIXTURE of the shared-db landscape** (the non-production app schema: identity bridges, sample workflow, notifications), even though production's copy holds only the frozen seed. Demolition is a shared-db DESIGN decision, not a cleanup. PR closed with rationale: https://github.com/popcre/shared-db/pull/6327#issuecomment-6888320024.
2. Earlier tonight (the shelf drop, kept for lane lore): a PR-head preview APPLY strands a version - the production gate's producer pin compares `scripts/production_migration_guard.py` at run dispatch (pre-merge main) vs at the merge commit; only a post-merge apply dispatched at the exact merge-commit tip produces conforming evidence. Two versions were stranded that way before the working pattern was found (20261113150753, 20261113175425 - both retired in the guard file).
3. A live dependent guard that counts pg_toast internals as "outside dependents" false-positives on 101 objects; the working guard excludes `pg_toast%`/`pg_temp%` namespaces (see the v4 migration of the shelf drop, version 20261114022200).
4. New migrations that replace an object an earlier migration replaced MUST carry `-- derived-from: <version>` in the header (`scripts/migration_derivation.py` mandate), and each new version must be reserved via `node scripts/check-dispatch-collision.mjs --reserve-version --json`, with the claim block's `version:` matching.
5. Merge queue + promotion-freeze interlock: merges stall while `refs/db-coordination/promotion-freeze` is set; a crashed holder leaves it - the lane tool's `--release-promotion-freeze --pr <n>` recovers a stale one. A merge-group entry that trips the backdating guard is ejected; re-reserve a fresh version and re-enqueue.

## 5. Root causes and key findings

- Production `dflow` is a pre-migration seed twin ("historical/staging copy... treat its rows as untrusted" - https://github.com/popcre/designflow-data-syncing/blob/sandbox-albert/docs/production-supabase-host-cutover.md). The app runs single-schema `dflow_prod`; app roles get permission denied on `dflow`.
- BUT the shared-db migration set and its contract suite treat `dflow` as a first-class schema (the non-production app schema per the multi-schema maps: "Sample Tracking stays on dflow", "Keep writable in dflow: Factory, users"). Same name, two lives: production leftover vs replay-target fixture.
- The two readers are safe to move: the view body is byte-identical after swapping `dflow."RFQItem"/"RFQGroup"` -> `dflow_prod."RFQItem"/"RFQGroup"` (target columns verified present); the helper is moot per the owner and simply retires.
- Full backups exist for everything ever touched (image tables, `dflow_prod_old`, the whole `dflow` snapshot) under `gs://designflow-storage/backups/dflow-stale-cleanup-2026-11-12/`.
- The line of decision records is: https://github.com/popcre/designflow-data-syncing/issues/126 (original problem + evidence + results), https://github.com/popcre/shared-db/issues/6239 #6243 #6240 #6265 #6266 #6267 #6286 #6287 #6288 #6301 #6302 #6303 (the shelf-drop lane, four authorings) and #6325 #6326 #6327 (this workstream).

## 6. Exact next steps

1. Decide the approach with evidence (this is the design decision):
   (a) **Production-seed-only retirement** - a mechanism that removes production's leftover copy without changing what the replay targets build (e.g. an operational runbook action outside the migration set, or a migration whose effect is scoped to the production project), OR
   (b) **Retarget/retire the dflow contracts first** - change shared-db's contract expectations so `dflow` is no longer asserted, then demolish via a normal migration.
   You'll know the decision is ready when it explicitly states what the ephemeral contract suite will assert AFTER the change, and why that is correct for every replay target (preview included).
2. If (b): land the contract changes first (own claim, own PR, all checks green), then re-author the demolition migration. If (a): land whatever shared-db machinery (a) needs (runbook, tooling, or scoped DDL), with its own evidence trail.
3. Re-use the proven demolition SQL shape from PR #6327 (view repoint byte-identical, helper drop, TOAST-aware guard, `drop schema if exists dflow cascade`) with `-- derived-from: 20261029162652` and a freshly reserved version.
4. Lane choreography that works (proven tonight): PR-head DRY-RUN only (never apply at the PR head); merge via the queue; post-merge `merged_preview_source_pr` preview apply at the EXACT merge-commit tip; let "Automatic production qualification and dispatch" drive production. Verify with `pg_namespace` + `https://alsand.designflow.app/api/health`.
   You'll know it worked when: pg_namespace no longer lists `dflow` on `qsllyeztdwjgirsysgai`, the shared-db contract suite is green (its verdict is the design gate), the style-tracker view returns rows from live data, and health returns 200.
5. Retire this handoff file in the same PR that closes #6325 (Handoff Contract Guard rule).

## 7. Constraints and gotchas in force

- Structure changes are authored in `popcre/shared-db` first, claim-first (its AGENTS.md §0.0-D), worktree-only per its §2.1-W; row-level data work is NOT (owner ruling §0.0-B). Never direct DDL at the shared database outside the lane.
- Reserve migration versions via `scripts/check-dispatch-collision.mjs --reserve-version`; never reuse or backdate; if the merge queue ejects for backdating, re-reserve a pure rename and update the claim block.
- A migration replacing an object another migration replaced needs `-- derived-from: <version>` in its header.
- `db-work-scope` block fields: status/work_type/route/priority/service_class/change_type/writes/application_return_to/live_assertion/generated_types (structural requires application_return_to + live_assertion + generated_types in {required, not-applicable}); claims are SEPARATE issues titled with the work issue number, carrying `db-claim` + `db-author-lease` fences and the `db-claim` label.
- The claim owner field must EQUAL `SHARED_DB_SESSION_ID`. Sign every GitHub post: `Posted by MiMo chat <session-id> on <machine>`.
- Never flip `MERCH_GROUP_SYNC_WRITES` (merch-group incident brake). Never delete storage objects still referenced by surviving rows (not relevant to this workstream's remaining steps, but standing).
- Production applies are never re-run; the queue dispatches fresh runs. Promotion freeze (`refs/db-coordination/promotion-freeze`) blocks merges while set; recover stale ones via the lane tool.
- ai-task-gates: `start --class shared-db` in the worktree before the lane; `check --before shared-db-promotion` before launching merged-preview applies.

## 8. Access and environment

- Machine edge-dev (Windows). `gh` authenticated as `u2giants`. `node`, `psql`/`pg_dump`/`pg_restore` (18.x), `gcloud` (project `lithe-breaker-323913`), `supabase` CLI all present.
- Secrets (values never in text; 1Password vault `vibe_coding`): `Supabase CLI Personal Access Token` (Management API; field SUPABASE_ACCESS_TOKEN), `Supabase DB Password - shared POP database` (production pooler `aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.qsllyeztdwjgirsysgai`), `Supabase Preview Branch Credentials...` (preview project `mvpkijzfmfcxhnzqogzs`, pooler `aws-0-...` - NOT the same pooler host as production!). GCP Secret Manager (project `lithe-breaker-323913`) holds `DB_*` / `DB_*_SANDBOX` for psql access to both app databases.
- WARNING: `GET https://api.supabase.com/v1/projects/<ref>/postgrest` returns the project JWT secret in its response body. Never print it; filter output if you must call it.
- Backup bucket: `gs://designflow-storage/backups/dflow-stale-cleanup-2026-11-12/`.

## 9. Open questions and risks

- The design decision (section 6 step 1) is genuinely open: (a) keeps shared-db's contract suite untouched but needs a sanctioned production-only mechanism; (b) is cleaner long-term but edits shared-db's asserted contracts - a wider blast radius. Neither is wrong; the evidence to prefer one is the suite's intent (is `dflow` meant to remain the non-prod app schema indefinitely, or is it being phased out by the multi-schema plan? Read https://github.com/popcre/shared-db/blob/main/docs/designflow-cloudsql-to-supabase-plan.md and the multi-schema docs before choosing).
- The merch-group parity plan (designflow-item-master `plan_merch-group-environment-parity.md`, open, "Nothing built") stages its own retirements of `dflow.merchGroup` copies (its §3.2). Whatever approach is chosen should not collide with it; note the decision on #6325 and that plan's tracker.
- If (b) is chosen, the live-list category-fix question may resurface (owner said "moot" for the SNAPSHOT run; a live-list retarget was flagged as a possible future task). Do not reopen it without the owner.
- Preview and production share the migration set; whatever lands affects both. The snapshot exists ONLY in production (sandbox's `dflow` is the LIVE sandbox app schema - never touch it).
