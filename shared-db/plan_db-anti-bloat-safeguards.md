# Plan: database anti-bloat safeguards and ColdLion change-history rotation (popcre/shared-db#5758)

Handoff for this plan: [HANDOFF.d/20261105T2111Z-edge-dev3-claude-db-anti-bloat-plan.md](HANDOFF.d/20261105T2111Z-edge-dev3-claude-db-anti-bloat-plan.md).
Sibling plan (read its STATUS, never redo its work): [plan_assets-bloat-permanent-fix.md](plan_assets-bloat-permanent-fix.md) (#5747) owns everything on `public.assets`, including its no-op writers, its index audit, its repack and its count fix.

## STATUS (plan written 2026-11-05 4:11 PM EST; no step executed)

| Step | State | Evidence |
|---|---|---|
| 0 Baseline | ⬜ open | — |
| 1 Stop ColdLion description flapping | ⬜ open | — |
| 1v Vendor bug report + paging-order check | ⬜ open | — |
| 2 ColdLion change_log rotation | ⬜ open | — |
| 3 Skip-unchanged writers (4 targets) | ⬜ open | — |
| 4 Move queue/lease state off wide rows | ⬜ open | — |
| 5 Index audit on busy tables | ⬜ open | — |
| 6 Weekly bloat/churn check | ⬜ open | — |
| 7 Governed automatic compaction | ⬜ open | — |
| 8 After-measurement and live proof | ⬜ open | — |

**Fresh session starts at:** Step 0. Steps 1, 3 and 5 can run in parallel after Step 0; Step 2 needs Step 1 merged first; Step 7 needs Step 6.

---

## Part 1 — Why

### 1. Ultimate goal

Albert (owner, POP Creations) wants the shared database to **stay small and fast on its own**, for every app, without anyone noticing a slowdown first. Today one table (PopDAM `assets`) grew to 8–10× its real size and slowed search; the fix for that table is in its own plan. This plan makes the same failure hard to repeat anywhere else, by:

1. never rewriting a row when nothing in it changed;
2. keeping fast-changing bookkeeping (queue leases, "last checked" stamps) off big, heavily indexed rows;
3. not carrying indexes nobody uses;
4. a weekly automatic check that notices a table drifting and compacts it online without anyone asking;
5. rotating ColdLion change history the way Albert asked: everything for 7 days, one version per record per day for the 2 months before that, one per week for the rest of the year, nothing older.

**If a step conflicts with this goal, the goal wins — stop and flag it on #5758.** No step may lose current data, lock a busy table for more than a few seconds, or make any app return different answers.

### 2. What this application is

`popcre/shared-db` is the single source of truth for the structure of one shared Supabase Postgres database used by every POP app: PopDAM (`u2giants/popdam3`, art asset search), PopSG (style-guide search, also served from popdam3), DesignFlow PLM (`popcre/designflow-*`, product lifecycle, also owns the HTS tariff-ruling pipeline), and the ColdLion ERP landing (this repo's `tools/coldlion-landing/`, nightly workflows `.github/workflows/coldlion-*.yml`). Production project `qsllyeztdwjgirsysgai` (Medium compute, 4 GB RAM, 1 GB shared buffers). Schema changes only ever ship as migrations in `supabase/migrations/` that promote automatically (preview rehearsal → production). There is no app deploy from this repo.

### 3. What triggered this work

- #5747 (2026-11-05): `public.assets` heap 2,024 MB for ~184 MB of live rows; broad PopDAM search 41 s.
- Albert asked (2026-11-05 3:44 PM EST) which code is *structured* so the problem can return elsewhere, and asked to "go further" than skip-unchanged; and asked for the ColdLion rotation (exact words on #5758).
- Read-only production survey 2026-11-05 3:45–4:10 PM EST (statistics since last stats reset; counts are today's order of magnitude, re-measure in Step 0):

| Table | Updates (+deletes) | HOT % | Indexes | Writer |
|---|---|---|---|---|
| `public.style_guide_search_documents` | 87,829 upd | 0 | 14 | embedding lease/result/error functions, `supabase/migrations/20261027012301_popsg_semantic_search_foundation.sql:515,550,587,656` |
| `hts_rag.hts_rag_rulings` | 16,248 upd | ~0 | 10 | DesignFlow backend: `designflow-backend/services/hts-ruling-extract.service.js`, `hts-ruling-structure.service.js`, `helpers/hts-rag/ruling-source.js`, `scripts/hts-ruling-extract-to-disk.js` |
| `hts_rag.hts_rag_ruling_ingest_jobs` | 10,554 upd | 0 | 4 | DesignFlow backend model `models/db/HtsRagRulingIngestJob.js` (a job queue; 2 updates per job is by design) |
| `plm.style_tracker_item_bridge` | 16,225 upd on 16,265 rows | 16 | 10 | `u2giants/popdam3` `scripts/refresh-style-tracker-rows.py:204-211` |
| `plm.item`, `plm.item_import`, `ingest.raw_record` | ~5,100 each per nightly sweep | 13–16 | 2–6 | `plm.import_item_master_data(jsonb)`, last body `supabase/migrations/20261002224520_item_master_import_no_churn_ep001_retirement.sql` |
| `plm.item_import_unresolved` | 26,504 ins + 26,471 del per sweep | — | 2 | same function; "per-sweep quarantine snapshot (rebuilt each run by design)" |
| `coldlion.change_log` | append-only, 1,009 MB, ~990k rows | — | 4 | `tools/coldlion-landing/lib/{load-masters,item-detail-delta,prepack-detail,prod-details}.mjs` |

### 4. Scope

In: the tables above; the weekly check across **all** user tables; the governed compaction route generalised beyond `assets`.

**NOT in this plan:**
- Anything on `public.assets` (owned by #5747's plan, including its Step 6 daily monitor — Step 6 here supersedes that monitor only after both are live; coordinate on #5747, don't delete it unilaterally).
- `dam_search_documents` fillfactor (#2196 owns it).
- Append-only history/audit tables other than `coldlion.change_log` (`*.AuditLog`, `hts_rag_*` evidence). They grow by design; retention for them is a separate owner question.
- Autovacuum global settings, compute upgrades, partitioning.
- Changing what any app displays.

---

## Part 2 — What we already know

### 5. Current state

- On `main` (2026-11-05): `pg_repack` 1.5.2 install migration `supabase/migrations/20261105201736_install_pg_repack.sql` and the governed runner `scripts/table_repack_maintenance.py` (kind `table-repack/v1`, `TABLES=frozenset(['public.assets'])` at line 20, sha256-pinned client, preview first, production needs a preview completion receipt) — merged via PR #5744. Operations are declared in `config/nontransactional-index-maintenance.json`.
- `plm.import_item_master_data` already skips unchanged `plm.item`/`plm.item_import`/`ingest.raw_record` rows (#3910). The ~5,100 updates per sweep therefore are either real ERP changes or a residual always-changing column — unknown; Step 0 decides.
- `coldlion.change_log` has no retention. Defined in `supabase/migrations/20260818232639_coldlion_raw_landing_spine.sql:279-356`; indexes `(table_name, changed_at desc)`, `(run_id)`, GIN `natural_key jsonb_path_ops`; RLS on, service_role only.
- Nothing in this plan is implemented.

### 6. Key findings

- **F1 — ColdLion change_log is ~90% description flapping, not real change.** Of 989k rows, 807,622 are `item_merch_group` `updated` (249k keys, ~10k/day) and 135,134 `item_header` `updated`. Sampling 3,000 recent `item_merch_group` updates: **every one** changes only `mg_desc` (plus `source_hash`/`id`); values alternate between a real label ("Framed", "DISNEY", "Canvas"…) and null. `item_header` shows the same on `merchGroup01Desc…08Desc` (value ↔ ""). Both directions come from the **same** endpoint and parameters (`/items`, `fullSnapshot: true`, EDGEHOME, pages 0–9) on different nights — so the ColdLion API intermittently omits merch-group descriptions. `mg_desc` is read from `source[merchGroup${suffix}Desc]` and included in the source hash at `tools/coldlion-landing/lib/project-masters.mjs:62-65`. Each flap rewrites the current-state row too.
- **F2 — change_log has readers that need the latest entry per key.** `load-masters.mjs:28-32` takes `distinct on (natural_key) … order by changed_at desc` over the whole table every run (this full scan gets slower as the log grows); `prod-details.mjs:217` takes the latest `new_raw` per key. So rotation must **always keep each key's newest entry**, whatever its age.
- **F3 — a live proof reads change_log by run.** `.github/live-proofs/2863.sql:15,25,38` treats "no change_log row for this run" as proof a run changed nothing. Pruning old entries would make old runs look change-free. That proof must be limited to runs inside the 7-day full-detail window (or count from `sync_run.rows_updated`).
- **F4 — queue state on wide search rows.** `style_guide_search_documents` keeps embedding lease, error, attempt and the 768-dim vector on the same row as the search text, with 14 indexes; every lease claim/release rewrites the whole wide row with 0% HOT. `hts_rag_rulings` gets `fetched_at`-only updates (931) and unconditional `raw_json`/`pdf_url` (9,236) and extraction (8,635) rewrites.
- **F5 — bridge refresh rewrites equal values.** `refresh-style-tracker-rows.py:204-211` builds `patch` from `prior` values whenever the source field is unchanged, without comparing to the bridge's current value — so nearly every row is rewritten every run.

### 7. Approaches rejected

- **Delete change_log rows older than N days (flat cutoff).** Rejected: breaks F2 (loses latest entry for quiet keys) and isn't what Albert asked.
- **Rotate change_log without fixing flapping first.** Rejected as the only fix: daily/weekly thinning would keep one flap per day forever; the real cure is not logging non-changes. Rotation still ships (Albert asked), after Step 1.
- **Treat blank description as "description removed" (status quo).** Rejected: same snapshot request returns both states; a blank here is the API omitting data, not ERP truth.
- **Carry forward the last non-blank description, accept blank after 7 nights** (first draft of this plan). Rejected in Muse debate 2026-11-05: adds state and a timer, still logs one flap per real clear, and duplicates a label the `/merchGroupDetails` master already owns. Codes-only + join is simpler and exact.
- **`suppress_redundant_updates_trigger` everywhere.** Rejected for tables whose writers stamp `updated_at`/`fetched_at` on every write (the row is never byte-equal); writer-side diffing is required. Fine as a belt-and-braces guard only where writers don't stamp.
- **Lower fillfactor across the board.** Rejected: only helps HOT when updated columns are unindexed; decide per table after Step 4.
- **`VACUUM FULL`/`CLUSTER` for compaction.** Rejected: exclusive lock for minutes.
- **Fully automatic production repack with no PR.** Rejected: standing rule that production changes go through the governed promotion route. "Automatic" here = the weekly check opens and lands the config PR itself; nobody needs to do anything.
- **Partitioning `coldlion.change_log` by month.** Rejected for now: rotation is per-key thinning, not whole-month drops; partitioning adds moving parts for no gain at ~1 GB.

### 8. Decisions

Locked (2026-11-05, Albert's words on #5758 unless noted):
- D1 Rotation tiers: all entries < 7 days; 7 days–2 months keep the **last entry per natural key per calendar day (America/New_York)**; 2 months–1 year keep the last per key per ISO week; older than 1 year deleted; **the newest entry of every key is never deleted** (F2, planner decision).
- D2 Skip-unchanged writes are mandatory for every writer in §3 (Albert: "0 downside").
- D3 Compaction is online (`pg_repack` via `table-repack/v1`) only.
- D4 (revised 2026-11-05 after Muse debate): merch-group **descriptions are not item data**. Item-slot rows and hashes carry merch-group **codes only**; labels come by join to `coldlion.merch_group_detail` (the `/merchGroupDetails` master). Label flapping on `/items` therefore can never log. The earlier "7 blank nights = cleared" carry-forward rule is withdrawn; no business question remains.

Open (implementer judgment, criteria given in steps): exact thresholds in Step 6; which indexes to drop in Step 5; side-table vs. split-column design in Step 4.

---

## Part 3 — How to build it

Phase A (one session): Steps 0–3. Phase B (new session; re-read STATUS and Steps 4–8 first): Steps 4–8.

**Step 0 — Baseline (read-only).** Using the Supabase MCP `execute_sql` (SELECT only) on production, record into `docs/verification/db-anti-bloat-5758/<UTC>/baseline.md`: for every user table > 50 MB, heap bytes, estimated live bytes (`reltuples × (28 + sum(pg_stats.avg_width))`), index bytes, `n_tup_upd`, `n_tup_hot_upd`, `n_tup_del`, index count, the `pg_stat_database.stats_reset` time; top 30 UPDATE/INSERT statements from `extensions.pg_stat_statements` by rows; for `coldlion.change_log` the count by `(table_name, change_kind)` and the fraction of `updated` rows whose only changed keys are descriptions (query in §6 F1). For `plm.import_item_master_data`, diff `previous_raw`/new payloads of `ingest.raw_record` rewrites on the last sweep to learn whether the ~5,100 updates are real. Done when the file exists and is committed.

**Step 1 — Stop ColdLion description flapping (codes only, labels by join).** Files: `tools/coldlion-landing/lib/project-masters.mjs:55-70` (`item_merch_group` row and `sourceHash({ slotNo, mgCode, mgDesc })`) and the item-header projection carrying `merchGroup0NDesc` (`git grep -n 'merchGroup' tools/coldlion-landing/lib`). Behaviour: remove `mg_desc` from the `item_merch_group` row and its hash; exclude `merchGroup01Desc…08Desc` from the `item_header` source hash and stored columns (keep `merchGroup0N` codes). Where a reader needs the label, join `coldlion.merch_group_detail` on the four-part key (company, division, mg_type_code, mg_code — see the table comment on `coldlion.change_log`: mgCode collides across types). Migration drops the description column(s) only after a grep of this repo, popdam3 and designflow repos shows no reader, or replaces them with a view doing the join. The first run after deploy will rewrite every row once (hash changes) — write that run's change_log rows with `change_kind='rehashed'` or skip change_log for hash-only rehash (implementer's choice; must not produce ~250k `updated` rows). Gate: tests pass; on the second nightly run after deploy (`coldlion-landing-sync.yml`, cron `20 5 * * *` UTC = 12:20 AM EST), `item_merch_group` and `item_header` `updated` change_log rows drop by > 90% vs the Step 0 nightly average, and every label shown to users still resolves (count of item slots with code but no `merch_group_detail` match = Step 0 count).

**Step 1v — Vendor bug report and paging-order check (parallel with Step 1).** Write `docs/verification/db-anti-bloat-5758/coldlion-items-desc-flap-report.md` for ColdLion support, from read-only queries: (1) at least three item keys where two consecutive successful `/items` full-snapshot `sync_run`s return the same `merchGroupNN` code with `merchGroupNNDesc` valued in one and null/blank in the other; (2) for each: both runs' ids, timestamps (EST), HTTP and body status, `totalElements`/`totalPages`, and the exact request params per page — `tools/coldlion-landing/lib/master-http.mjs:23` sends only `companyCode`, `page`, `size`; (3) the raw JSON pair for that item (from `change_log.previous_raw`/`new_raw`, redacting nothing secret — these are product labels); (4) the matching `/merchGroupDetails` (`coldlion.merch_group_detail`) row, showing the description non-null at both times. Also note **`/items` paging sends no sort parameter**: add a check (in the report and as a loader guard in `fetchPagedMaster`) that the set of item keys across all pages equals `totalElements` with no duplicates and no gaps; if it fails, page boundaries are unstable and that is a second vendor bug. Gate: report committed; the duplicate/gap guard has a unit test and runs on every sync. Sending the report to ColdLion is out of scope for this plan (owner sends vendor mail); the file is the deliverable.

**Step 2 — change_log rotation (needs Step 1 merged and one night observed).** New migration `supabase/migrations/<ts>_coldlion_change_log_rotation.sql`: function `coldlion.rotate_change_log(p_dry_run boolean default true) returns table(tier text, deleted bigint)` (SECURITY DEFINER, `search_path` pinned, execute granted to service_role only) that deletes, in batches of ≤ 20,000 with `lock_timeout 2s`, every row that is (a) older than 1 year, or (b) between 2 months and 1 year and not the last per `(table_name, natural_key, ISO week)`, or (c) between 7 days and 2 months and not the last per `(table_name, natural_key, NY calendar day)` — and never a row that is the newest for its `(table_name, natural_key)`. Schedule weekly via `pg_cron` (pattern: grep `cron.schedule` in `supabase/migrations/20261105165947_style_cron_timeout_retry_loops.sql`), Sunday 3:00 AM EST. Also update `.github/live-proofs/2863.sql` to only consider runs with `started_at > now() - interval '7 days'` (F3) and update the `change_log` table comment and `docs/coldlion-raw-landing-schema-design.md` to state the retention. Freed space is reused by later inserts; first run's freed space is reclaimed by Step 7 only if Step 6 flags it. Gate: contract test passes; dry run on preview returns per-tier counts; first production run deletes and `load-masters` still finds the latest entry for every key (query: count of distinct keys before = after).

**Step 3 — Skip-unchanged writers.** Each in its owning repo, each its own PR:
- 3a `public.style_guide_search_documents` embedding functions (`20261027012301…sql:515-664`; check later redefinitions with `git grep -n 'function public.upsert_sg_search_embedding\|mark_sg_search_embedding_error\|reset_sg_search_embedding_errors' supabase/migrations`): add `WHERE … IS DISTINCT FROM` guards so a repeat result/error with equal values writes nothing. New migration in this repo.
- 3b `hts_rag.hts_rag_rulings` (DesignFlow backend, files in §3): `raw_json`/`pdf_url` update only `WHERE raw_json IS DISTINCT FROM $1 OR pdf_url IS DISTINCT FROM $2`; extraction update only when `category`/`hs_era`/`extract_version` differ; `fetched_at`-only updates move to Step 4. DesignFlow rules: identity `popcre`, branch from `sandbox-albert`, PR to `develop`, never self-merged.
- 3c `plm.style_tracker_item_bridge` (`popdam3/scripts/refresh-style-tracker-rows.py:204-211`): only add a column to `patch` when `prior[column]` differs from the bridge's current value; skip the UPDATE when `patch` is empty after that.
- 3d `plm.import_item_master_data`: only if Step 0 shows a residual always-changing column; fix that column's comparison. `plm.item_import_unresolved` delete-all/insert-all → replace with diff (insert new, delete gone, leave equal rows) in the same migration.
Gate per target: a repeat run with identical input performs 0 updates (measured by `n_tup_upd` delta over that run in preview, or the function's returned counts).

**Step 4 — Move fast-changing state off wide rows.** For `style_guide_search_documents`: new narrow table `public.style_guide_search_embedding_jobs(style_guide_file_id pk/fk, lease_expires_at, claimed_by, attempt_count, error, error_category, updated_at)` holding lease/attempt/error; the search document keeps only the result (`embedding`, `embedding_model`). Migrate the functions in 3a to read/write the job table; backfill in the migration; keep column names on the document as a view for one release only if any app reads them (grep popdam3 `src/` and `supabase/functions/`). For `hts_rag_rulings.fetched_at`: move to `hts_rag.hts_rag_ruling_fetch_state(ruling_number pk, fetched_at)` only if Step 0 shows `fetched_at` writes are still > 10% of updates after 3b; otherwise record N/A. For `hts_rag_ruling_ingest_jobs`: add retention of `completed` jobs older than 30 days (same weekly cron as Step 2) — a queue should not hold history forever. Judgment criterion: do the split only where post-Step-3 updates/day > 10% of rows/day on a table with ≥ 6 indexes. Gate: HOT % on the moved table ≥ 70% over 7 days, and PopSG search results identical on the Search test set.

**Step 5 — Index audit on busy tables (excluding `assets`).** For each table in §3 plus any Step 6 flags: list indexes with `idx_scan`, size, constraint backing; take a snapshot now and again ≥ 14 days later (counters since `stats_reset`); drop only indexes with zero scans in that window, no constraint role, and no reference in any function/view/policy (`git grep` the index name and its leading columns across this repo, popdam3, designflow-backend). One migration, `-- evidence:` comment per index. Gate: migration promotes; contract suites stay green; or audit doc records "no safe drops".

**Step 6 — Weekly bloat/churn check.** New workflow `.github/workflows/db-bloat-weekly.yml` (owner: shared-db maintainers; supersedes #5747 plan's Step 6 `assets` monitor once both run — retire that one with a note on #5747), Monday 6:00 AM EST, read-only role. Script `scripts/db_bloat_check.py`: for every user table > 100 MB, compute heap/live ratio (prefer `pgstattuple_approx` if installed; else the estimate in Step 0), HOT %, updates per row per day, change since last week (store the last reading as a workflow artifact or in a small `ops.table_health_readings` table — implementer's choice, fewest moving parts). Flag when: ratio > 2.0, or index/heap ratio grew > 50% week-over-week, or HOT < 50% with > 0.2 updates/row/day. Output: one comment on a standing issue (create "Weekly database health" issue, pin its number in the script) listing flagged tables and the likely writer (top `pg_stat_statements` statement for the table). Gate: dry run posts a correct reading matching Step 0.

**Step 7 — Governed automatic compaction.** Generalise `scripts/table_repack_maintenance.py`: replace the hard-coded `TABLES` set with an allowlist file `config/table-repack-allowlist.json` (each entry: table, max heap MB, reason, source issue) and keep every existing refusal. Extend `db_bloat_check.py`: for a flagged table that is on the allowlist, heap/live > 2.5, and free disk ≥ heap+indexes+1 GB, it opens a PR adding a `table-repack/v1` operation to `config/nontransactional-index-maintenance.json` and queues it to merge (`gh pr merge --auto`); the existing route then runs preview then production. Initial allowlist: tables from §3 except append-only ones. Never two repacks at once (check for an active operation first). Gate: a test-mode run against preview flags a fixture table, opens the PR, and the route completes on preview with unchanged index/trigger/constraint/ACL counts.

**Step 8 — After-measurement and live proof.** Repeat Step 0 into `.../after.md` 7 days after Steps 1–4 land and again at 30 days. Done when §13 checks pass.

### 10. Tests

- Step 1: `tools/coldlion-landing-masters-codes-only.test.mjs` — (a) same code, desc valued then null → identical hash, no change_log row; (b) code changes → one `updated` row; (c) label resolves via `merch_group_detail` join using all four key parts (two types sharing one mgCode resolve differently).
- Step 1v: `tools/coldlion-master-http-paging.test.mjs` — duplicate key across pages → refusal; missing keys vs `totalElements` → refusal; clean pages → pass. Existing `tools/*.test.mjs` stay green (`node --test tools/`).
- Step 2: `supabase/tests/coldlion_change_log_rotation_contract.sql` — fixture key with entries every hour for 400 days → after rotation: all < 7 days kept; exactly one per day 7d–2mo; one per week 2mo–1y; none > 1y; a key whose only entry is 3 years old is kept; dry run deletes nothing; function not executable by anon/authenticated.
- Step 3a/4: `supabase/tests/sg_search_embedding_no_churn_contract.sql` — same result twice → `n_tup_upd` delta 0 on the document table; lease claim does not update `style_guide_search_documents`.
- Step 3b: DesignFlow backend unit tests next to the services — unchanged payload issues no UPDATE.
- Step 3c: `popdam3/scripts/test-refresh-style-tracker-rows.py` case — identical sheet twice → zero bridge UPDATEs.
- Step 3d: extend `supabase/tests/item_master_import_no_churn_contract.sql` — repeat sweep → `item_import_unresolved` rows untouched.
- Step 7: `scripts/test_table_repack_maintenance.py` stays green; add cases: non-allowlisted table refused; allowlist entry missing fields refused; second concurrent operation refused.

### 11. Constraints and gotchas

- Declare `ai-task-gates start --class shared-db` before migrations; `reviewer-safety` for plan/doc edits. Claim exact objects on #5758 first (claim-first).
- Production is read-only by hand; migrations reach production only through automatic promotion. Never run `rotate_change_log(false)` or a repack by hand.
- Don't hand-edit `types/database.types.ts`.
- DesignFlow repos: `popcre` identity only, `sandbox-albert` → `develop`, never self-merged. PopDAM: `u2giants` identity.
- F2/F3 are traps: never drop a key's newest change_log entry; fix 2863 proof in the same PR as rotation.
- `pg_stat_*` counters reset with stats; always record `stats_reset` beside a reading.
- Deleting many change_log rows creates free space (not bloat growth); don't let Step 6 flag it as a writer problem.
- Times to humans in EST/EDT.

### 12. Access

Supabase MCP (`mcp__supabase__execute_sql`) is authenticated to production read-only use; preview via the repo's preview tooling (see `AGENTS.md`). `gh` authenticated as `u2giants` (shared-db, popdam3) and `popcre` (DesignFlow). No secrets needed beyond what the existing workflows hold; any new one goes in 1Password `vibe_coding`.

---

## Part 4 — Landing

### 13. Definition of done, risks, open questions

Done: every STATUS row done with an artifact; ColdLion `updated` rows/night down > 90% (Step 1); change_log within D1 tiers and smaller after a week; repeat runs of every §3 writer show ~0 no-op updates; weekly check running with two consecutive correct readings; one automatic compaction completed end-to-end on preview; all PRs merged and migrations promoted; after.md at 7 and 30 days; #5758 closed with live proof.

Risks and rollback: Step 1's one-time rehash must not flood change_log (handled in Step 1); rotation deletes something a reader needed (mitigated by newest-entry rule; rollback = none for deleted rows, so dry-run on preview first and keep the first production run's deleted rows exported to a private artifact); side-table move breaks a reader (keep compatibility view one release); auto-compaction fills disk (free-disk precondition, one at a time).

Open: whether `*.AuditLog` and HTS evidence tables need retention (Albert, later; out of scope).

## Self-audit (2026-11-05)

1. Could a brand-new session execute this without asking? Yes — goal (§1), app and environments (§2), evidence with file:line (§3, §5, §6), steps with files and gates (§9), tests by name (§10), traps (§11). Gap found and fixed during drafting: readers of change_log (F2/F3) were missing; added with the newest-entry rule and the 2863 proof fix.
2. Does it carry all background, including what was ruled out? Yes — §7 lists flat cutoff, rotate-only, blank-as-removed, generic trigger, fillfactor, VACUUM FULL, PR-less automation, partitioning, each with why.
3. Is the goal clear enough for judgment calls? Yes — §1 states the outcome and the "goal wins" rule; open decisions in §8 each carry a criterion in their step.
