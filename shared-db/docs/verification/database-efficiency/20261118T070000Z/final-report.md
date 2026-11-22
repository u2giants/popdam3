---
summary: "Final report for #2326 database efficiency and Data API security: advisor claims dispositioned, before/after measured, access matrix closed"
kind: proof
status: done
read-when: closing #2326, auditing any Step 0-8 claim, or answering 'what did the program change and what remains'
---

# #2326 final report — database efficiency and Data API security

**Program:** [issue #2326](https://github.com/popcre/shared-db/issues/2326) · **Plan:** `plan_database_efficiency_and_api_security.md` (STATUS rows 0–8) · **Coordinator:** MiMo chat ses_ffe5e136dd083ffeY5NeNhRAz5 on edge-dev · **Owner direction:** Albert Hazan, 2026-11-16 — finish all remaining tasks from the three handoff-writing chats; one coordinator with parallel subagents; evidence gates honored.

Baseline capture: 2026-09-04 (`docs/verification/database-efficiency/20260904T212459Z/`). This report closes every original advisor claim, records the measured before/after over comparable windows, and names what remains open.

## 1. Original advisor/dashboard claims and final dispositions

The 2026-09-04 baseline confirmed 340 security findings rule-by-rule and the efficiency claims of the original advisor report. Dispositions (evidence artifacts in `docs/verification/database-efficiency/`):

| # | Original claim | Disposition | Evidence |
|---|---|---|---|
| 1 | `security_definer_view` / `materialized_view_in_api`: PopDAM viewer reads 826 CRM accounts, 826 CRM customers, 15,742 PLM style-tracker rows, 22,045 style-guide file-group rows across the application boundary | **Remediated.** Definer views caller-gated or grant-narrowed (#2662 batches, picker contracts, #3327/#3328 accepted with rationale); the two API matviews behind gated projections (#6418). Out-of-app reads now 0 rows (preview-proven 2026-11-18). | `20260910T002917Z/api-access-matrix.md`; `20261115T215045Z-step-6-contract-inventory/`; `20261116T040000Z-step6-6418-matview-census/`; #6418 proof comments 2026-11-18 |
| 2 | 133 trigger-returning functions carry superfluous `anon`/`authenticated` EXECUTE | **Revoked.** #6415 (migration `20261116013153`, reissued as `20261204000300` — applied). 0 in revocable scope; 26 named platform residuals (supabase_admin-owned) documented. | `20261116T023000Z-step6-6415-trigger-execute-revoke/` |
| 3 | 38 anon / 111 authenticated security-definer RPCs unmeasured (Step 2 NOT MEASURED) | **Measured and dispositioned.** #6416 matrix (201 SD functions): 17 revoked (#6455, `20261218031759` — 8-signature carve-out for deliberate `authenticated` grants, ownership-bound platform skip); `public.rls_auto_enable()` revoked (#6456, `20261218031754`, preview-proven 401-after/400-before); 107 revoke-candidates resolved **36-revoke/70-keep** (#6457) with the authenticated probe leg obtained. Version trail (2026-11-18/25): `20261218062459` retired by the #6657 review-finding path (never applied; its carve-out-fixed content preserved) and reissued as `20261225010205` per that retirement's own instruction ("deliver separately qualified grants under a fresh version"). | [`20261116T050000Z-step6-6416-sd-rpc-matrix/sd-rpc-matrix.md`](../20261116T050000Z-step6-6416-sd-rpc-matrix/sd-rpc-matrix.md); `20261117T040000Z-step6-6457-revoke-candidates/revoke-candidate-dispositions.md`; #6455/#6456/#6457 proof comments |
| 4 | RLS disabled on exposed tables / `rls_enabled_no_policy` / zero-policy grants | **Resolved.** Zero-policy grants revoked; `rls_enabled_no_policy` proven denied at count 0; #4421 RLS request-constant repair CLOSED live-proven 2026-11-05 (production certificate 40826924347). | `20260910T002917Z/api-access-matrix.md`; plan_rls_request_constant_checks.md STATUS |
| 5 | `function_search_path_mutable` on security-definer functions | **Closed** for security-definer functions in the Step 2 matrix. | `20260910T002917Z/api-access-matrix.md` |
| 6 | `unused_index`: 763 findings (739 after triage) | **Deferred with dated rationale** (Step 5 split): no drop issue opened without a measured driver; the dated index delta is Step 7's deliverable (see §6). One measured candidate became #6412. | `20261115T213745Z-step-5-split/step-5-split-triage.md` |
| 7 | Duplicate index twins (22 definition-identical pairs) | **Retired.** #6409 (18 unique twins) / #6410 (3 plain twins) / #6411 (pair-key constraint) — originals retired after keeper-assertion defects (findings #6445/#6448/#6458), corrected reissues `20261204000000`/`20261204000100`/`20261204000200` **applied to production**. Keeper table + rollback DDL in the Step 5 split triage. | `20261115T213745Z-step-5-split/`; PRs #6559/#6566 apply runs 44103933198/44106460484 |
| 8 | 426/433 unindexed foreign keys | **Measured answer (2026-11-15):** exactly one measured hot join (`style_groups.primary_asset_id`, ~954,427 calls/week ~1 ms) — implemented as #6412 (`20261116124002`, **applied**); one parent-delete churn (`auth.saml_relay_states`, 11 deletes, no action). Everything else: deferred, no measured driver. Application-side query-site census remains open as context. | Step 5 split triage §FK |
| 9 | Write amplification: rebuild/projection churn top cost | **Reduced (Step 4, app-owned).** #293 schedule coalescing (~28 h/week → ~1.3 h/week refresh cron), #294 serialize/coalesce (unserialized batch 0 calls), #295 skip-unchanged (`clear_style_group_batch` 287 calls @ 34.6 s → 0 calls). DB-side causes resolved by #2213/#2214/#2408/#2212. WAL: rebuild RPC 858.8 → 772.4 MiB/day (−10.1%), matview projection 14.24 → 1.13 MiB/day (−92.1%). | `20261113T180512Z-step4-closure-audit/`; `20261118T042200Z/wal-realtime-attribution.md` |
| 10 | Auth leaked-password protection | **DECLINED by owner** (Albert Hazan, 2026-11-16: "no leaked-password protection"). Never re-ask. | Owner ruling in #2326 comments / consolidated handoff §0 |
| 11 | Fillfactor / materialized-view refresh / unused-index families (Step 5 candidates) | **No change** with dated verdicts (no measured driver). Per-table maintenance tuning: **zero changes recommended** (repeated-missed-objective rule; 2026-11-18 run). | `20261115T213745Z-step-5-split/`; `20261118T034547Z/maintenance-comparison.md` |

## 2. Before/after over comparable windows

Measurement boundary: `pg_stat_statements` reset 2026-11-06 11:20:19 EST, `track=top` (nested statements invisible). Windows below are dated; where they are not comparable the text says so.

| Metric | Before | After | Window / source |
|---|---|---|---|
| Matview refresh cron time | ~28 h/week | ~1.3 h/week (job 9: 168/168 ok avg 3.75 s; job 12: 672/672 ok avg 5.96 s) | 7-day `cron.job_run_details` delta to 2026-11-13; first-week proof 2026-10-21 ~11.8 h/week |
| `clear_style_group_batch` | 287 calls @ 34.6 s mean | 0 calls | popdam3 #295 closure audit 2026-11-13 |
| Unserialized `refresh_style_group_counts_batch` callers | concurrent overlap | 0 unserialized calls (single-flight + serialized RPC live) | popdam3 #294 + shared-db PR #4178 |
| Rebuild RPC WAL | 858.8 MiB/day | 772.4 MiB/day (−10.1%; calls/day −18.6%; per-call cost +10.5%) | WAL attribution Windows A/B (reset 2026-11-06) |
| Matview projection WAL | 14.24 MiB/day | 1.13 MiB/day (−92.1%) | same |
| Whole-server WAL | 292.24 GiB since 2026-11-06 reset | rebuild/projection family = 3.23% share; dominant producers outside program (DAM tag/bulk-ops 38.23%, DesignFlow HTS RAG ingest 30.05%) | `20261118T042200Z/wal-realtime-attribution.md` — Step 8 must use per-family rates, not server totals |
| Loaded search-sync cost | — | 0.148 s/100 rows; 0.676 s/1,000; 3.122 s/5,000 | `20261113T163700Z-step3-residual/` + per-step matview timings `20261113T180242Z-` |
| Per-step matview refresh (preview) | — | file_groups 2.251 s · folders 0.325 s · search 0.020 s · all 2.686 s | `20261113T180242Z-perstep-matview-timings/` |
| Heap (assets) | 390 MB | 389.8 MiB (no repack recommended; governed route #5747/#5886) | #5747 auto-2 2026-11-16 + `20261118T034547Z/maintenance-comparison.md` |
| Planner estimates vs exact counts | — | within ±3.8% on 19/21 exact-count tables; ≤+5.7% on TABLESAMPLEd giants; one analyze-due drift +9.9% (`dam.dam_asset_image_vectors`, single observation) | `20261118T034547Z/maintenance-comparison.md` |
| Error/timeout rates | baseline `queries.md` 2026-09-04 | no program-attributable regression recorded; anon status code change 401→200/0-rows on gated views is documented (§3) | — |

Latency percentiles (p50/p95/p99) for the application journey were **not separately captured** per-request over a comparable window; the per-call means above are the measured cost records (Step 3). CPU/IO: not exposed through `supabase_read_only_user` beyond the WAL statistics recorded in the WAL report (boundary recorded there).

## 3. Access matrix — before/after (status codes and counts only)

Exposed schemas (unchanged): `public, graphql_public, api, crm, pim, core, app` (`dam` deliberately not exposed).

| Surface | Before (2026-09-10 / 2026-11-15 pins) | After (2026-11-18) | Proof |
|---|---|---|---|
| Matviews `style_guide_folders` / `style_guide_file_groups` via Data API | authenticated: full snapshot (384 / 22,045 rows to a CRM identity) | gated views: out-of-app **0 rows** (200, `*/0`); anon **0 rows**; in-app (dam) full snapshot (379 / 20,610); service_role on `*_snapshot` raw matviews | #6418 proof table + in-app addendum 2026-11-18 |
| Trigger-returning functions EXECUTE | 133 fns carry anon/authenticated EXECUTE | 0 in revocable scope; 26 platform-owned residuals named | #6415 proof (`20261116T023000Z-`) |
| Security-definer RPC EXECUTE (API roles) | 201 SD fns; `rls_auto_enable()` executable by anon (400); 107 revoke-candidates | 17 revoked (with 8-signature authenticated carve-out — see below); `rls_auto_enable()` 401-after; 36 of 107 revoked / 70 kept with per-function evidence | #6455/#6456/#6457 proofs; dispositions doc |
| `public.rls_auto_enable()` | anon: HTTP 400 (executes and errors) | anon: HTTP 401 (refused); postgres/service_role intact | #6456 proof 2026-11-17 |
| Definer views (CRM/PLM/PDM pickers) | cross-app row reads reproduced | caller-gated (`has_app_access` family) or grant-narrowed or explicitly accepted (#3327/#3328) | Step 6 contract inventory |
| Zero-policy tables | 3 RLS-disabled with authenticated DML | grants revoked; `rls_enabled_no_policy` count 0 on tested identities | `20260910T002917Z/` |
| Platform-owned (`net.http_get` / `net.http_post`) | anon/authenticated EXECUTE (supabase_admin grants) | **unchanged — named platform boundary** (REVOKE by `postgres` silently no-ops; ownership, not error code, is the classifier) | #6455 proof table |

Deliberate authenticated grants kept (not "superfluous"): 8 dam/plm signatures (`plm.set_source_resolution` overloads, `plm.coldlion_merch_group_candidates`, etc.) whose creating migrations grant `to authenticated, service_role` for `set local role authenticated` SQL consumers (issues #963, #2176 unit 6) — the #6416 mechanical rule missed that class; contract tests pin them.

Anon behavior note: on the gated views anon changed from 401 (no grant) to 200 with 0 rows (view granted, gate false). Security boundary preserved (0 rows); status-code difference documented.

## 4. Issue, PR, merge, apply, and verification ledger

### Program issues

| Issue | State | Closed with |
|---|---|---|
| #2326 (program) | OPEN → closes with this report | summary comment (plain close — program issue) |
| #6409 retire 18 unique-index twins | CLOSED | reissue `20261204000100` applied to production |
| #6410 retire 3 plain-index twins | CLOSED | reissue `20261204000000` applied |
| #6411 drop pair-key constraint | CLOSED | reissue `20261204000200` applied |
| #6412 FK covering index | CLOSED | `20261116124002` **applied as authored** |
| #6415 trigger EXECUTE revokes | CLOSED | `20261116013153` retired → reissue `20261204000300` applied |
| #6416 SD-RPC measurement | CLOSED | docs-only PR #6459; follow-ups #6455/#6456/#6457 all closed |
| #6418 matview API surface | CLOSED (auto-close at PR merge; proof completed after — coordinator verification comment 2026-11-18) | gated projections live on preview; proof table + in-app addendum |
| #6455 revoke 17 SD functions | CLOSED | `20261218031759` (fix-forward #6664) merged; preview proof posted |
| #6456 remediate `rls_auto_enable()` | CLOSED | `20261218031754` merged (PR #6650); preview proof 401-after |
| #6457 107 revoke-candidates | CLOSED | resolved 36 revoke / 70 keep (probe leg obtained); `20261218062459` retired (PR #6690, never applied) → reissued `20261225010205` |
| #6663 migration terminator defect | CLOSED | PR #6666 (retire `20261218025935` + reissue `20261218043336`) |
| #6658 post-apply catalog verification false-failure | OPEN — **carried** (new work item, owner: unassigned) | runs 44103933198/44106460484 applied-but-marked-failed |
| #6667 tooling gap (claim lifecycle flags) | CLOSED | PR #6668 |

### Migrations authored by the program (version → fate)

| Version | Issue | Fate |
|---|---|---|
| `20261116013153` | #6415 | **retired, never apply** (preview-applied pre-merge; qualification refuses) → content live as `20261204000300` |
| `20261116124002` | #6412 | **applied to production** |
| `20261117020001` | #6410 | **retired, never apply** (keeper defect #6448) → `20261204000000` applied |
| `20261117120000` | #6409 | **retired, never apply** (keeper defect #6445) → `20261204000100` applied |
| `20261118020001` | #6411 | **retired, never apply** (keeper defect #6458) → `20261204000200` applied |
| `20261118020000` → `20261218025935` | #6418 | **retired, never apply** (missing statement terminator; issue #6663; never applied anywhere — verified ledgers) → `20261218043336` |
| `20261218043336` | #6418 | merged (PR #6666); **on preview** (governed lane); awaits automatic production promotion |
| `20261218031754` | #6456 | merged (PR #6650); DB-level proof on preview (direct-SQL apply — deviation noted); awaits automatic production promotion |
| `20261218031759` | #6455 | merged (#6653) + fix-forward in place (#6664, ownership-bound revoke + 8-signature carve-out); preview proof posted; awaits automatic production promotion |
| `20261218062459` | #6457 | merged (PR #6655; Guard B re-date of `20261218035022`); **retired, never apply** (PR #6690 — #6657 review-finding path; carve-out-fixed content preserved on main) → reissued `20261225010205` (36 revokes / 70 keeps) |
| `20261225010205` | #6457 | reissue of the qualified revoke set (the retirement note's "fresh version"); awaits automatic production promotion |

### PRs merged (program work)

#6433 (#6415) · #6436 (#6412) · #6444 (#6409) · #6447 (#6410) · #6454 (#6411) · #6459 (#6416 docs) · #6451 (#6418 implementation, merged via merge queue 2026-11-18T03:31:47Z after Guard B re-date) · #6559/#6566 (retire+reissue of the four defective originals; production apply runs 44103933198 / 44106460484 — SQL applied and ledger rows inserted; run colors red from the #6658 verification defect) · #6650 (#6456) · #6653 + #6664 (#6455, fix-forward) · #6655 (#6457) · #6660 (maintenance report, closes #6659) · #6662 (WAL/Realtime report, closes #6661) · #6666 (terminator repair, closes #6663) · #6668 (tooling flags, closes #6667).

All merges through the merge queue (`gh pr merge --auto`); no `--squash`/`--admin`; required checks "SQL migration guards", "supabase/tests against an ephemeral database", "Destructive SQL outside migrations" green on every merge head. Reviews were advisory only (owner ruling 2026-10-29) and gated nothing.

### Preview / production applies

- **Preview (governed lane):** `20261116013153` (run 43789639543, historical — later retired), `20261218043336` (2026-11-18, dry-run 44244777054). Known dirt: orphan ledger row `20261116013153` (`preview-ledger-orphan-reconciliation` class).
- **Preview (named-measurement instrumentation writes, ledger not recorded — deviations documented):** the #6455/#6456 census revokes and the #6418 in-app fixture (`app.app_access` row + synthetic GoTrue identity `probe-6418-inapp@popcre.test`). Residue noted on the issues.
- **Production:** no manual SQL ever issued. Automatic promotion lane applied `20261116124002` and the four reissues `20261204000000/00100/00200/00300` (verified in the production ledger read-only 2026-11-18). The four 2026-11-18 versions await the same lane. Acceptance of #6409/#6410/#6411 ("governed promotion afterward") is satisfied **in substance by the reissues** — the original version numbers are retired by design and will never appear in the ledger (issue #6663/#6663-class retirements recorded in `RETIRED_VERSION_REASONS`).

### Independent review / live smoke

Advisory AI reviews ran on PRs and produced `review-finding` issues handled by the automatic fixer (never merge gates). Live smoke: the #6418 HTTP proof table (out-of-app 0 rows, in-app full snapshot) and the #6456 RPC refusal (401-after) are the representative live journeys; PopDAM's `PopSGLibraryPage` reads verified schema-identical with a synthetic in-app identity at full snapshot counts.

## 5. Step 3 named unknowns — explicit record

| Unknown | Status |
|---|---|
| Write-side query-plan bodies for the rebuild/projection paths | **Unobtainable** — Management API runs as `supabase_read_only_user`; write-side EXPLAIN refused 42501 (platform boundary, permanent). Recorded as absent, not measured. |
| Per-call `cleared_count` distribution (`clear_style_group_batch`) | **Not measured** — moot while the function is dormant (0 calls since 2026-10; 111,736 rows still carried `style_group_id` at 2026-11-13). |
| PDF-text cost in the loaded search path | **Not measured** — preview cannot host the PDF path. Absence recorded. |
| Application query-site census behind the 426 FK findings | **Partially answered** (Step 5 split: measured-cost half closed); full census remains open as context, no measured driver. |
| p50/p95/p99 per-request latency over a comparable window | **Not captured** as percentiles; per-call means recorded (§2). |

## 6. Step 7 — index, maintenance, WAL attribution

- **Maintenance comparison** (`20261118T034547Z/maintenance-comparison.md`): estimates within tolerance; analyze keeping up; zero per-table tuning recommended under the repeated-missed-objective rule; counters-unreliable tables named (`coldlion.change_log`, `public.style_guide_file_tags`, `plm.nbcu_*`, `dcp_metadata_asset`); freeze age max 46M xid (23% of limit); no repack (governed route).
- **WAL/Realtime attribution** (`20261118T042200Z/wal-realtime-attribution.md`): 292.24 GiB WAL since the 2026-11-06 reset; rebuild/projection family 3.23%; Realtime/CDC not a material generator (0.005%) and was not touched. Whole-server totals cannot serve as Step 8 proof — per-family rates are the comparable measure.
- **Dated index delta (#1966)** (`20261118T1441Z/index-delta-20260903-to-20261118.md`, PR #6687 / issue #6686): the 73-index baseline classed **39 used / 7 constraint-owned / 7 counters-unreliable / 5 not-observed / 10 candidates / 5 dropped** (the five dropped 2026-10-22 via `20261022191243`, #4643). Ten candidates (~264 MB; bulk: `idx_sgf_directory_path_trgm` 114 MB + `idx_sgf_style_guide_folder`) each carry a code-search result (popdam3 + shared-db) and a read-only EXPLAIN observation; **no drop issues opened** — the counter window (12 days since the 2026-11-06 restart) is below the ≥14-day gate and the earliest unchanged-candidate decision is 2026-11-20 11:25 AM EST under #5747/#5610's own gates. auto-3's assets re-check (46 indexes / 839 MB; heap 390 MB vs 225 MB live = 1.82; plateaued growth from post-repack non-HOT page splits) is absorbed as settled. **Ownership transfer:** residual candidate decisions and any future drop issues belong to #5747 (weekly health series) and #1966 — not this program.

## 7. Remaining accepted risks and deferred findings

1. **Four original migrations retired and never applied** — content live via reissues; the tombstone files remain in `supabase/migrations/` as historical record and are skipped by the production guard (`RETIRED_VERSION_REASONS`).
2. **Platform-owned function grants** (`net.http_get`/`net.http_post`, 26 trigger residuals) carry anon/authenticated EXECUTE under `supabase_admin` ownership — outside this repo's authority. Named, not fixable here. Landmine note: `net` is not exposed today; if it enters `pgrst.db_schemas` the grants become reachable.
3. **Permissive-policy consolidation (125 notices) and RLS-predicate indexes** — deferred with date, no measured driver after #4421.
4. **Anon status-code change** on gated views (401 → 200/0-rows) — boundary preserved, behavior documented.
5. **Preview ledger does not record named-measurement applies** (#6574 class) — evidence lives in issue comments, not the ledger.
6. **Post-apply catalog verification false-failure** (#6658, open) — apply runs can carry red run colors while delivery succeeded; ledger is the delivery record.
7. **New 2026-11-18 versions await automatic production promotion** — the lane owns it; no manual production SQL. Acceptance of the affected issues is complete in substance per §4.
8. **`unused_index` 739 remaining findings** — deferred to the dated index delta (§6) and the #5747 health-check series; any drop needs code search + representative plan testing.

## 8. Rollback record

No implemented change missed its acceptance threshold, so no rollback was executed. Named rollback paths exist for every migration (forward re-grant/re-create statements in each migration header; keeper tables + rollback DDL in `20261115T213745Z-step-5-split/step-5-split-triage.md`). The retired originals require no rollback — they never applied.

## 9. Verification gate (plan §9)

- Representative live application journeys pass — PopDAM style-guide browse schema-identical with full snapshot counts for an in-app identity (2026-11-18).
- No access regression — out-of-app/anonymous row access reduced to 0; in-app access preserved; contract tests green on every merge head.
- Resource goals met or changes rolled back — refresh cron ~28 h/week → ~1.3 h/week; rebuild/projection WAL −10.1%/−92.1% per-family; nothing rolled back.
- Each advisor item is closed, accepted, or separately owned — §1 table.

