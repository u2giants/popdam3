# Plan: make the nightly SKU -> style guide link job finish

Historical assessment handoff (write-once, 2026-11-04): [original assessment](HANDOFF.d/20261105T0203Z-edge-dev3-claude-supabase-assessment-plans.md). Its “None is started” statement records that earlier assessment only. Current custody and remaining work: [#5608](https://github.com/popcre/shared-db/issues/5608); delivered preview evidence: [post-apply record](docs/verification/database-efficiency/20261105T074139Z/sku-style-guide-preview-live.md).
Owning issue: #5608. Related history: #5141 (closed; the same 120 s cap rolled back this migration's inline backfill). Sibling plans: [plan_dam-embedding-claim-speed.md](plan_dam-embedding-claim-speed.md), [plan_database_efficiency_and_api_security.md](plan_database_efficiency_and_api_security.md).

## STATUS (2026-11-05 03:03 AM EST)

| Step | State | Evidence |
|---|---|---|
| 0 Real per-arm baseline | complete | Original per-arm plans and failed real-preview runtime retained in forward evidence |
| 1 Persisted keys | merged; preview complete | #5619 / version 20261105044255; zero pending keys across 17 sources |
| 2 Batched snapshot resolver | merged; preview complete | #5649 / version 20261105061627; real full 8.103889s, no-change 3.247662s |
| 3 Contracts and recovery | passed | Full required CI, SQL contracts, eight-portal/NULL/duplicate parity, post-DML cancellation and 17 proof cases |
| 4 Governed preview + exact output | complete | Run 41987714096; 0/0 EXCEPT ALL, unchanged 334-row output and input fingerprints |
| 5 Automatic production delivery | open | Base 20261105044255 absent; automatic run 41988158724 refused and skipped production apply |
| 6 Three source-tagged nightly successes | open | Actual preview acceptance probe is false; production not yet applied |

- [ ] Implementation complete: automatic production delivery and production catchup remain required.
- [ ] live proof: three genuine consecutive source-tagged nights and freshness remain required on #5608.

Current evidence: [actual preview proof and separate pre-production references](docs/verification/database-efficiency/20261105T074139Z/sku-style-guide-preview-live.md). The authoritative preview artifact is **13397091481**, `preview-migration-apply-51c366fa534a7182e3318405e0aa49398c6ba827`, digest `sha256:91730b63c6eb13a26dab411c4f654af30812f9f7eb1f40371707fd91f2033727`; automatic review artifact 13397176861 is separate. Generated types landed via #5645 (official producer 41973827983, unchanged artifact).

Accepted implementation: plain persisted keys with narrow source-sensitive triggers and committed key backfill; no generated-column rewrites. A complete portal multiset is materialized once per invocation, reused by all batches, and invalidated with a versioned dual-seed typed-record fingerprint. Two measured covering indexes remove wide NBCU/Warner heap reads. Prior real-preview timeouts are retained as negative evidence; only the post-key resolver full/no-change calls passed the final runtime gate. Production reference components were captured as three separately timestamped read-only snapshots, not atomic production parity. Original coordinator owns delivery; no manual production apply is authorized.

## 1. Ultimate goal

POP DAM shows, for each product (SKU), which licensor style guide its artwork came from. That list is supposed to refresh every night, but the nightly refresh has failed every single night since it was installed on 2026-10-30, so the list is frozen at what a one-time manual run produced on 2026-10-30 ~6:24 PM EDT. New licensing sheets and newly scraped licensor portals never show up. Done means: the nightly job succeeds every night well inside its time budget, produces the same links the current logic would produce if it had unlimited time, and costs the shared database a small, bounded amount of work per night. **If a step conflicts with this goal, the goal wins — stop and flag it on #5608.**

## 2. The application (original assessment context, 2026-11-04)

`popcre/shared-db` owns the shared Supabase Postgres (production target resolved from protected configuration) used by DesignFlow, POP DAM, PIM, CRM. Schema changes are SQL migrations under `supabase/migrations/`; they reach production only via the automatic promotion workflow after a preview-branch rehearsal (`AGENTS.md` line ~213; skill `shared-db-change`). There is no app deploy from this repo.

Objects involved (all defined in `supabase/migrations/20261030043848_sku_style_guide_links.sql`):
- `public.pdf_text_samples` — OCR/extracted text per PDF asset (unique on `asset_id`). ~27.9k rows, 94 MB; ~18.8k rows sampled in the last 7 days (it churns heavily).
- `public.assets` — DAM assets (~152k rows); `sku`, `file_type`, `filename`.
- `public.sku_files_used` — "FILES USED" names parsed from licensing sheets (~11.6k rows), written by `parse_pdf_files_used_v2` (line 351).
- `plm.asset_file_style_guide_index` — a plain **view** (line 63), 8 `UNION ALL` arms over licensor-portal scrape tables, ~553.6k rows, computing `public.file_name_norm()` (regex) per row on every read.
- `public.sku_style_guide_links` — the output (line 191), ~10.7k rows: filename_normalized 3,769 / filename_exact 1,747 / sheet_declared 4,512 / sheet_label_match 652. Quarantine model: upsert only, never deleted. Read by POP DAM UI as `authenticated`.
- `public.resolve_sku_style_guide_links()` (line 544) — SECURITY DEFINER, `set statement_timeout to '120s'`, three arms (filename match, sheet-declared label, declared label matched to portal label).
- pg_cron job 17 `resolve-sku-style-guide-links-nightly`, `30 4 * * *` UTC (11:30 PM EST / 12:30 AM EDT), runs as `postgres`, command `select public.resolve_sku_style_guide_links()` (line 733).

## 3. Trigger

Supabase technician report (`/home/ahazan/Dropbox/ai/analysis-detail.md` §3, private, not in repo): job "never once succeeded", timeout on a regex-heavy CTE join of `pdf_text_samples` against `assets`, no batching. Verified 2026-11-04: 5 of 5 logged runs failed. Reproduce: `select status, start_time, end_time - start_time, left(return_message,300) from cron.job_run_details where jobid = 17 order by start_time;`

## 4. Scope

In: one or two forward migrations that (a) persist the extracted declared label and normalised keys so they are computed once per row change, and (b) replace the resolver body with an incremental, batched version; tests; preview rehearsal; live proof.
NOT in: changing match rules or confidence math; adding/removing portal arms of the index view; the PopSG matview refresh timeouts (§3 of the same report, separate jobs); `work_mem`/`shared_buffers` tuning; POP DAM UI changes; deleting or re-scoring existing links; `core_style_guide_id` promotion.

## 5. Current state

- Base/forward implementation is merged through #5619 and #5649; generated types through #5645; preview evidence and the current plan through #5654. The original assessment handoff above is historical, not an unstarted-work instruction.
- Governed preview run 41987714096 and subsequent leased calls passed: full 8.103889s, unchanged 3.247662s, exact EXCEPT ALL 0/0 on unchanged 334-row output and unchanged inputs. The recorded final preview state has zero pending keys across 17 sources, 754 v3 progress rows and no catchup job.
- Production delivery/catchup and three genuine source-tagged nightly successes remain open on #5608 with the original coordinator. The separate production reference snapshots recorded both migrations absent; automatic run 41988158724 refused the absent base and skipped apply. No production success is claimed.
- Existing SQL/Node contracts and guarded eight-portal, cancellation, native cron and acceptance-probe fixtures passed. Published evidence includes the unsuccessful setup/resolver invocations rather than treating them as a zero-timeout bootstrap.

## 6. Findings (read-only, production, 2026-11-04 ~8:45 PM EST)

- Every run dies at exactly 120.0 s with `canceling statement due to statement timeout`. The 120 s comes from the function's own `proconfig` (`statement_timeout=120s`); the server default is also 120000 ms; the `postgres` role has no override. The cap applies to the whole outer call, i.e. all three arms together, in one transaction — so a failure rolls back Arm 1's work too.
- Error context alternates between Arm 2 (`with raw_decl as …`) and Arm 3 (`with decl as …`, once inside `style_guide_label_norm`), meaning Arm 1 completes and the budget runs out in Arms 2/3.
- 12,821 of 27,915 samples match `style\s+guide\s+used\s*:`. Arms 2 and 3 each re-run that case-insensitive regex plus a multiline `regexp_match` over full extracted text (avg ~3.4 kB) for every sample, and call `is_style_guide_source_pdf` per joined asset — every night, for unchanged rows.
- Arm 3's `guides` CTE reads the 553.6k-row view (which runs `file_name_norm` regex 553.6k times across 8 arms) then `style_guide_label_norm` (two regexes) per row before `DISTINCT`. Arm 1 also reads the full view. The view is the dominant cost; nothing is cached between nights.
- EXPLAIN could not be captured: the MCP role lacks EXECUTE on `style_guide_label_norm` (granted only to service_role/postgres/authenticated). Step 0 captures it in preview/as an allowed role.
- Consumers: POP DAM UI reads `sku_style_guide_links` (table comment, line 244); no repo code calls the resolver besides cron.

## 7. Rejected approaches

- **Just raise the timeout (e.g. 30 min).** Hides the cost: it would burn many minutes of full-scan regex work nightly on the shared DB, growing with every scrape and sheet, and still is one all-or-nothing transaction. Report §7 explicitly says fix design first. The existing outer call cap remains; batches are bounded by row count and measured execution. A function SET does not independently enforce a per-batch timer.
- **Trigram / GIN index for the regex.** Only narrows the `~*` filter; the expensive part is the 553k-row view normalisation and re-extracting labels that haven't changed. Doesn't remove the repeat work.
- **Materialized view for `asset_file_style_guide_index`.** Plausible but needs its own refresh job — exactly the class of job already timing out (report §3, `refresh-style-guide-*`). Persisted per-row keys plus incrementality give the same benefit without a new refresh. Revisit only if step 4 misses the gate.
- **Split the three arms into three cron jobs.** Each still full-scans; just splits the failure.
- **Drop Arm 3.** Changes business output (652 links). Out of scope.

## 8. Decisions

Locked (2026-11-04): output semantics identical to the current function (same rows, methods, confidence, counts given unlimited time); upsert-only quarantine model stays; delivered as forward-only migrations; job name and schedule stay (`30 4 * * *`); no manual production SQL.
Delivered choices (2026-11-05): plain persisted keys and narrow source-sensitive triggers, with empty-key NULL sentinels; 1,000-row committed key batches and 100-SKU resolver batches; durable per-SKU input/output fingerprints plus exact active-link membership; a once-per-invocation complete portal snapshot and v3 typed-record multiset fingerprint instead of timestamp/last_seen watermarks. Two nonunique covering indexes remove the measured wide-heap reads. The forward migration adds only an inert source-version tag to the base migration's CALL command, retaining its ID/schedule/owner/active state.
Open outcomes: normal automatic production delivery/catchup and three real post-forward nightly successes. Storage, watermark and batch-size implementation choices above are no longer unstarted decisions.

## 9. Steps

**Step 0 — Baseline.** On the preview branch (or production as service_role via an approved read path), time each arm's SELECT separately with `explain (analyze, buffers)`, copying CTEs from the function (drop the `insert … returning`). Record in `docs/verification/database-efficiency/<UTC>/sku-style-guide-links-baseline.md` with the commands. Gate: three per-arm timings and plans recorded.

**Step 1 — Persist keys (implemented).** Migration `20261105044255_sku_style_guide_resolution_incremental.sql` adds plain nullable PDF declared-label/key and portal filename/guide-label keys. NULL denotes pending; an empty stored key denotes a computed NULL normalization. Seventeen narrow BEFORE triggers maintain the exact original expressions. Key-only bounded backfill commits up to 1,000 rows per batch without reassigning source columns or rewriting all tables under exclusive locks. Existing filename-index readers retain pending normalization fallbacks. Preview now has zero pending keys and exact ready/pending/multiset equality was tested.

**Step 2 — Incremental, batched resolver (implemented; production pending).** The base plus forward `20261105061627_sku_style_guide_resolution_snapshot.sql`:
1. Compute per-SKU file/eligible declared-sheet input fingerprints, including changed and deleted evidence. Track exact active link IDs and semantic output fingerprints so independent parser changes converge while quarantine timestamps remain untouched.
2. Materialize every portal observation once in a secure session-local snapshot, preserving duplicates, exact spelling, NULLs and guide/core identity. The v3 count/two-seeded numeric-sum fingerprint and all matching batches consume that same frozen relation. Rebuild each invocation; build nonunique temporary indexes only when work remains.
3. Preserve all three original arms, including arm 2 plausibility filtering versus arm 3's broader label match, exact/normalized confidence, minimum labels, asset counts and arm 3's existing core-ID behavior. Commit at most 100 SKUs per resolver batch and advance durable progress only with successful writes. A canceled second batch rolls back its 100 progress/link writes while the first 100 remain committed; same/fresh sessions resume correctly.
4. Retain a top-level invoker procedure without a SET clause, session mutual exclusion across commits, explicit cancellation/error unlock, and a compatibility function. A function SET does **not** enforce a per-batch timeout on an already-running outer statement; the existing outer cron cap remains unchanged. Final actual preview calls used isolated, verified 60s/5s session caps without changing role/global/cron settings.
5. Keep the existing nightly job ID/schedule/owner/active state; only an inert source-version comment is added with `cron.alter_job`, after requiring exactly one named job. A hash-bound typed sidecar verifies the exact job row. Select the latest three ALL audit runs first and require each to carry that source tag; never filter untagged failures away.

Gate: one-time persisted-key bootstrap is explicitly resumable, and five observed ~120s failed catchup invocations are retained, spanning initial setup and resolver work. The last two begin after zero-pending-key checkpoints; the exact phase allocation of the first three is not retained. See the [native-history subset](docs/verification/database-efficiency/20261105T074139Z/catchup-run-history.json). They are not described as five key-bootstrap-only interruptions or a zero-timeout bootstrap. After keys finish, actual full resolver <60s, unchanged resolver <5s, and exact original-output EXCEPT ALL counts both ways must pass. These preview gates passed at 8.103889s / 3.247662s / 0-and-0 differences on unchanged inputs. No writing old resolver or raised timeout is used to produce the comparison oracle. Production delivery and genuine nightly acceptance remain open.

**Step 3 — Tests.** See §10. Gate: all green locally and in CI.

**Step 4 — Preview rehearsal.** Required checks precede merge; the supported merged-main workflow applies to the configured preview. Do not persist a pre-merge migration manually. Gate: actual post-apply full/no-change calls and exact aggregate-only output proof are recorded in the verification folder. Completed by run 41987714096 and the subsequent leased proof.

**Step 5 — Land.** Merge when required checks pass; automatic promotion applies to production. Never run migrations or the catch-up by hand on production; if the catch-up must run once, schedule it via the migration (e.g. one-shot `cron.schedule` that unschedules itself) so it goes through promotion.

**Step 6 — Live proof (still open).** After three post-forward source-tagged nights: `cron.job_run_details` for jobid 17 shows the latest three ALL runs each match the exact tagged command and are consecutive `succeeded`, each nonnegative and <60s; current job must remain active/postgres-owned/on its unchanged schedule and the forward ledger must exist; `max(last_seen_at)` advances nightly; link counts ≥ the 2026-11-04 baseline per method. Record in the verification folder; tick `- [ ] live proof` on #5608.

## 10. Tests (implemented and passed)

- `supabase/tests/sku_style_guide_links_contracts.sql` covers persisted label/key extraction, unchanged freshness, old-sheet/new-guide and new-file matches, quarantine, external parser changes, duplicate/NULL preservation, snapshot convergence, repeated calls and hostile temporary relations. The existing nine Node contracts retain grant/schedule assertions.
- Guarded fixtures under `supabase/tests/fixtures/5608/` prove all eight portal arms in ready/pending/sentinel states, exact three-arm output parity, concurrent source changes, actual post-DML batch-two cancellation with 100 durable then 201 resumed SKU/link pairs, and real pg_cron command tagging without changing job identity.
- Seventeen cases execute the actual source-bound acceptance SQL, including historical/untagged/failed/nullable records, current job state and invalid duration negatives. The complete required database suite and WB/NBCU/Sesame/SKU contracts passed; genuine production nights remain a separate open acceptance item.

## 11. Constraints and gotchas

- Future structural work: load `shared-db-change`, read [current-workflow.md](docs/agents/current-workflow.md), document exact object scope on the existing issue and use the surviving reservation tooling and [lock/promotion CLI](scripts/manage-migration-coordination.mjs). Start the shared-db task class. Retired author-claim/admission commands are not a delivery step; historical ownership comments remain evidence only.
- CI harness re-applies the pre-adoption baseline after replaying migrations (`database-contract-tests.yml` steps 12-14): `create or replace` on a baseline-defined routine is silently reverted in tests. The resolver is migration-owned (not in baseline) so it is fine; if you touch `parse_pdf_files_used`, use a new `_v3` name (see migration line 344).
- #5141: a migration that does heavy data work inline can exceed the migration's own budget and roll back; keep backfills out of the migration body.
- Production is read-only except via automatic promotion. Current workflow holds, including the existing closed NOT_PLANNED expiry and absent-base dependency, remain binding; no manual production override.
- Never hand-edit `types/database.types.ts`; regenerate if columns are added.
- Licensed licensor values must not appear in migrations or test fixtures — use synthetic names.
- Times quoted to humans in EST.

## 12. Access

The production read-only MCP attempt refused private `file_name_norm` EXECUTE (42501); no grant changed. The explicitly approved protected Management API operator route can run aggregate-only SELECTs inside BEGIN READ ONLY/ROLLBACK under the unchanged 55s cap, with fresh intended-target proof and strict sanitized output. The three production references are separately timestamped snapshots, not atomic parity. `gh` authenticated as the repo AI identity. Preview credentials: 1Password vault `vibe_coding`, preview DB item (address by item ID per `AGENTS.md`), never values. No other secrets.

## 13. Done, risks, open questions

Done criteria, not current status: migrations merged and promoted; tests green; catch-up completed; 3 consecutive nightly successes with artifact paths; STATUS table and same-issue continuity updated; #5608 live-proof box ticked.
Risks: two ordinary covering index builds block portal writers while held; preview measured 10.363s combined, with 5s lock acquisition and no raised outer cap. Plain keys avoid the rejected generated-column rewrite. View rewrite could change output — guarded by exact multiset/output tests; procedure-with-commit under pg_cron must not be wrapped in a transaction — verify in preview. Rollback overall: re-apply the old function body via a forward migration.
Resolved: reliable timestamps are absent across the complete source set; deterministic exact portal fingerprints replace timestamp watermarks. Open: automatic production delivery/catchup and three genuine post-forward nightly successes. The original coordinator owns those remaining outcomes on #5608.

## Self-audit

1. Fresh session executes without asking? Yes — §2 names every object and file line, §6 gives the evidence and reproduction query, §9 gives step-by-step SQL shape and gates, §11 gotchas, §12 access. Gap found and fixed: EXPLAIN unavailable from MCP — step 0 says where to get it.
2. Background and ruled-out ideas carried? Yes — §3 trigger, §5 delivered-state correction, §6 why it fails (arms 2/3, one transaction, 553k view), §7 five rejected approaches with reasons, #5141 history in §11.
3. Goal clear enough for judgment calls? Yes — §1 (nightly success, identical output, bounded cost) and §8 locks output semantics and records the delivered storage, fingerprint and batching choices; production/nightly acceptance remains open.
