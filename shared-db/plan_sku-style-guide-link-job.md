# Plan: make the nightly SKU -> style guide link job finish

Handoff: [HANDOFF.d/20261105T0203Z-edge-dev3-claude-supabase-assessment-plans.md](HANDOFF.d/20261105T0203Z-edge-dev3-claude-supabase-assessment-plans.md)
Owning issue: popcre/shared-db#popcre/shared-db#5608. Related history: #5141 (closed; the same 120 s cap rolled back this migration's inline backfill). Sibling plans: [plan_dam-embedding-claim-speed.md](plan_dam-embedding-claim-speed.md), [plan_database_efficiency_and_api_security.md](plan_database_efficiency_and_api_security.md).

## STATUS (2026-11-04 8:54 PM EST)

| Step | State | Evidence |
|---|---|---|
| 0 Re-measure baseline per arm | ⬜ open | — |
| 1 Migration: persisted extracted-label + norm-key columns | ⬜ open | — |
| 2 Migration: incremental, batched resolver | ⬜ open | — |
| 3 Tests (SQL contract + node static test) | ⬜ open | — |
| 4 Preview rehearsal + timing gate | ⬜ open | — |
| 5 Land via automatic promotion | ⬜ open | — |
| 6 Live proof: 3 consecutive nightly successes | ⬜ open | — |

Fresh session starts at step 0.

## 1. Ultimate goal

POP DAM shows, for each product (SKU), which licensor style guide its artwork came from. That list is supposed to refresh every night, but the nightly refresh has failed every single night since it was installed on 2026-10-30, so the list is frozen at what a one-time manual run produced on 2026-10-30 ~6:24 PM EDT. New licensing sheets and newly scraped licensor portals never show up. Done means: the nightly job succeeds every night well inside its time budget, produces the same links the current logic would produce if it had unlimited time, and costs the shared database a small, bounded amount of work per night. **If a step conflicts with this goal, the goal wins — stop and flag it on #popcre/shared-db#5608.**

## 2. The application

`popcre/shared-db` owns the shared Supabase Postgres (production project ref `qsllyeztdwjgirsysgai`) used by DesignFlow, POP DAM, PIM, CRM. Schema changes are SQL migrations under `supabase/migrations/`; they reach production only via the automatic promotion workflow after a preview-branch rehearsal (`AGENTS.md` line ~213; skill `shared-db-change`). There is no app deploy from this repo.

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

- Nothing changed; no branch, no PR.
- `sku_style_guide_links.last_seen_at` max = 2026-10-30 6:23 PM EDT — the only successful run was the manual post-promotion run from #5141 / `HANDOFF.d/20261030T0640Z-EDGE-DEV…`.
- Existing tests that pin the current text: `scripts/sku-style-guide-links.test.mjs` (regex-asserts grants and the exact cron schedule/command) and `supabase/tests/sku_style_guide_links_contracts.sql`. Both must be updated in step 3, not deleted.
- Indexes on `pdf_text_samples`: pkey, `asset_id` (two, one unique), `sampled_at desc`, a GIN tsvector. Nothing helps a regex filter.

## 6. Findings (read-only, production, 2026-11-04 ~8:45 PM EST)

- Every run dies at exactly 120.0 s with `canceling statement due to statement timeout`. The 120 s comes from the function's own `proconfig` (`statement_timeout=120s`); the server default is also 120000 ms; the `postgres` role has no override. The cap applies to the whole outer call, i.e. all three arms together, in one transaction — so a failure rolls back Arm 1's work too.
- Error context alternates between Arm 2 (`with raw_decl as …`) and Arm 3 (`with decl as …`, once inside `style_guide_label_norm`), meaning Arm 1 completes and the budget runs out in Arms 2/3.
- 12,821 of 27,915 samples match `style\s+guide\s+used\s*:`. Arms 2 and 3 each re-run that case-insensitive regex plus a multiline `regexp_match` over full extracted text (avg ~3.4 kB) for every sample, and call `is_style_guide_source_pdf` per joined asset — every night, for unchanged rows.
- Arm 3's `guides` CTE reads the 553.6k-row view (which runs `file_name_norm` regex 553.6k times across 8 arms) then `style_guide_label_norm` (two regexes) per row before `DISTINCT`. Arm 1 also reads the full view. The view is the dominant cost; nothing is cached between nights.
- EXPLAIN could not be captured: the MCP role lacks EXECUTE on `style_guide_label_norm` (granted only to service_role/postgres/authenticated). Step 0 captures it in preview/as an allowed role.
- Consumers: POP DAM UI reads `sku_style_guide_links` (table comment, line 244); no repo code calls the resolver besides cron.

## 7. Rejected approaches

- **Just raise the timeout (e.g. 30 min).** Hides the cost: it would burn many minutes of full-scan regex work nightly on the shared DB, growing with every scrape and sheet, and still is one all-or-nothing transaction. Report §7 explicitly says fix design first. A modest per-batch cap remains as a safety net.
- **Trigram / GIN index for the regex.** Only narrows the `~*` filter; the expensive part is the 553k-row view normalisation and re-extracting labels that haven't changed. Doesn't remove the repeat work.
- **Materialized view for `asset_file_style_guide_index`.** Plausible but needs its own refresh job — exactly the class of job already timing out (report §3, `refresh-style-guide-*`). Persisted per-row keys plus incrementality give the same benefit without a new refresh. Revisit only if step 4 misses the gate.
- **Split the three arms into three cron jobs.** Each still full-scans; just splits the failure.
- **Drop Arm 3.** Changes business output (652 links). Out of scope.

## 8. Decisions

Locked (2026-11-04): output semantics identical to the current function (same rows, methods, confidence, counts given unlimited time); upsert-only quarantine model stays; delivered as forward-only migrations; job name and schedule stay (`30 4 * * *`); no manual production SQL.
Open (implementer judgment, criteria given): batch size (target each batch < 10 s in preview); whether the portal-side key is a stored generated column on each scrape table or a small helper table (prefer generated columns where the source column is on the table itself; ASGARD/Warner arms may need the helper); whether the watermark lives in a one-row state table or is derived from `last_seen_at`.

## 9. Steps

**Step 0 — Baseline.** On the preview branch (or production as service_role via an approved read path), time each arm's SELECT separately with `explain (analyze, buffers)`, copying CTEs from the function (drop the `insert … returning`). Record in `docs/verification/database-efficiency/<UTC>/sku-style-guide-links-baseline.md` with the commands. Gate: three per-arm timings and plans recorded.

**Step 1 — Persist keys.** Migration `supabase/migrations/<UTC>_sku_style_guide_link_keys.sql`:
- `pdf_text_samples`: add `declared_style_guide_label text generated always as (btrim(btrim((regexp_match(extracted_text, '(?im)^\s*(?:core\s*/\s*)?style\s+guide\s+used\s*:\s*([^\r\n]{1,200})'))[1]), E' \t.,;:')) stored` and `declared_style_guide_key text generated always as (public.style_guide_label_norm(<same expr>)) stored`, plus a partial index on `(asset_id) where declared_style_guide_key is not null`. Both functions are `immutable`, so this is allowed. Note: adding a stored generated column rewrites the 94 MB table under an exclusive lock — measure in preview; if > a few seconds, use a plain column + trigger + batched backfill instead.
- Portal side: stored `file_name_norm` column on each scrape asset table used by the view (or helper table), with btree index; rewrite the view to read the stored column, same output columns. Add a btree on `style_guide_label_norm(label)` per guide table, or a stored key.
- Gate: in preview, `select count(*) from plm.asset_file_style_guide_index` and a join on `file_name_norm` are index-driven; view output row-for-row equal to the old definition (`except` both ways = 0 rows).

**Step 2 — Incremental, batched resolver.** Migration `<UTC>_resolve_sku_style_guide_links_incremental.sql`: replace the body (same name/signature/grants/cron) so it:
1. Arm 2: insert/upsert from `pdf_text_samples` where `declared_style_guide_key is not null` and `sampled_at > watermark` (join assets, `is_style_guide_source_pdf`), in `asset_id` batches.
2. Arm 3: join those changed rows' keys to portal guide keys via index; plus a full re-match only for portal guides scraped since the watermark (new portal data can match old sheets).
3. Arm 1: `sku_files_used` rows created since the watermark, plus all rows whose `file_name_norm` matches portal assets scraped since the watermark.
4. Convert to a `procedure` with `commit` per batch (pg_cron supports `call`) so progress survives; advance the watermark only after a batch commits. Keep `set statement_timeout = '60s'` per batch as safety net. Change cron command to `call public.resolve_sku_style_guide_links_run()` keeping the function as a thin wrapper if anything else calls it.
5. Provide `p_full boolean default false` for a one-time full catch-up (the 2026-10-30 → now backlog) that walks all rows in batches.
Gate: preview run of full catch-up finishes with zero timeouts; incremental run with no changes < 5 s; output equals old function's output on the same data (run old body under raised timeout in preview into a scratch table, `except` both ways = 0).

**Step 3 — Tests.** See §10. Gate: all green locally and in CI.

**Step 4 — Preview rehearsal.** Open PR; CI applies to preview (`PREVIEW_PROJECT_REF`). Seed volume if preview lacks it. Gate: numbers from step 2 recorded in the verification folder.

**Step 5 — Land.** Merge when required checks pass; automatic promotion applies to production. Never run migrations or the catch-up by hand on production; if the catch-up must run once, schedule it via the migration (e.g. one-shot `cron.schedule` that unschedules itself) so it goes through promotion.

**Step 6 — Live proof.** After 3 nights: `cron.job_run_details` for jobid 17 shows 3 consecutive `succeeded`, each < 60 s; `max(last_seen_at)` advances nightly; link counts ≥ the 2026-11-04 baseline per method. Record in the verification folder; tick `- [ ] live proof` on #popcre/shared-db#5608.

## 10. Tests

- `supabase/tests/sku_style_guide_links_contracts.sql`: add cases — (a) a sample with `CORE/STYLE GUIDE USED: The Foo Guide` yields generated label `The Foo Guide` and key `foo guide`; (b) re-running the resolver with no changes inserts 0 and touches only `last_seen_at`; (c) a new portal guide whose label matches an *old* sheet produces a `sheet_label_match` link on the next incremental run; (d) a new `sku_files_used` row matching an existing portal file produces `filename_exact`; (e) no row is ever deleted; (f) batch interruption (simulate error mid-run) leaves watermark at last committed batch.
- `scripts/sku-style-guide-links.test.mjs`: update the cron-command regex to the new command; keep grant assertions.
- Existing CI database-contract suite stays green (note the baseline re-apply quirk below).

## 11. Constraints and gotchas

- Structural change: load `shared-db-change`, claim the exact objects on #popcre/shared-db#5608 first, `ai-task-gates start --class shared-db`.
- CI harness re-applies the pre-adoption baseline after replaying migrations (`database-contract-tests.yml` steps 12-14): `create or replace` on a baseline-defined routine is silently reverted in tests. The resolver is migration-owned (not in baseline) so it is fine; if you touch `parse_pdf_files_used`, use a new `_v3` name (see migration line 344).
- #5141: a migration that does heavy data work inline can exceed the migration's own budget and roll back; keep backfills out of the migration body.
- Production is read-only except via promotion; an open `review-finding` issue blocks promotion.
- Never hand-edit `types/database.types.ts`; regenerate if columns are added.
- Licensed licensor values must not appear in migrations or test fixtures — use synthetic names.
- Times quoted to humans in EST.

## 12. Access

Supabase MCP `execute_sql` is read-only on production and lacks EXECUTE on `style_guide_label_norm` (step 0 must use preview). `gh` authenticated as the repo AI identity. Preview credentials: 1Password vault `vibe_coding`, preview DB item (address by item ID per `AGENTS.md`), never values. No other secrets.

## 13. Done, risks, open questions

Done: migrations merged and promoted; tests green; catch-up completed; 3 consecutive nightly successes with artifact paths; STATUS table updated; handoff updated; #popcre/shared-db#5608 live-proof box ticked.
Risks: generated-column add locks `pdf_text_samples` (writer is the DAM PDF sampler) — rollback `alter table … drop column`; view rewrite could change output — guarded by the `except` gate; procedure-with-commit under pg_cron must not be wrapped in a transaction — verify in preview. Rollback overall: re-apply the old function body via a forward migration.
Open: whether incremental Arm 1/3 need a "portal scraped since" timestamp that every scrape table carries (check each source table for `captured_at`/`updated_at`; if one lacks it, re-match that portal fully each night, which is cheap once keys are indexed).

## Self-audit

1. Fresh session executes without asking? Yes — §2 names every object and file line, §6 gives the evidence and reproduction query, §9 gives step-by-step SQL shape and gates, §11 gotchas, §12 access. Gap found and fixed: EXPLAIN unavailable from MCP — step 0 says where to get it.
2. Background and ruled-out ideas carried? Yes — §3 trigger, §5 frozen-since date, §6 why it fails (arms 2/3, one transaction, 553k view), §7 five rejected approaches with reasons, #5141 history in §11.
3. Goal clear enough for judgment calls? Yes — §1 (nightly success, identical output, bounded cost) and §8 locks output semantics while leaving batch size and key storage open with criteria.
