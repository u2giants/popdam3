# Plan: make the HTS customs-ruling search fast

Handoff: [HANDOFF.d/20261102T1915Z-edge-dev3-claude-db-resource-plans.md](HANDOFF.d/20261102T1915Z-edge-dev3-claude-db-resource-plans.md)
Owning issue: popcre/shared-db#5483 (split out of #5188) (CBP ruling database reasoning layer). Sibling plan: [plan_dam-embedding-claim-speed.md](plan_dam-embedding-claim-speed.md).

## STATUS (2026-11-02 2:15 PM EST)

| Step | State | Evidence |
|---|---|---|
| 0 Re-measure after #5283 | ⬜ open | — |
| 1 Capture real call parameters | ⬜ open | — |
| 2 Trace the slow pass | ⬜ open | — |
| 3 Fix migration | ⬜ open | — |
| 4 Land + live proof | ⬜ open | — |

Fresh session starts at step 0. **Step 0 may show the problem is already solved — then stop and record that.**

## 1. Ultimate goal

**Why we're doing this, in one paragraph:** Albert asked on 2026-11-02 to cut how much compute the shared database uses. Profiling ruled out connection pooling (only 37 of 90 connections in use; apps already go through Supavisor). The load instead comes from a few slow queries, and this is one of the two biggest. Every second it wastes is a second of shared database capacity taken from every POP app, so fixing it lowers cost risk and keeps the other apps responsive.


Albert wants the shared database to use less compute. DesignFlow's customs-ruling search (finding past U.S. Customs rulings similar to a product, to suggest a tariff code) averaged ~24 s per call — one of the two largest consumers. Done means a typical search answers in under 1 s with the **same ranked results**. **If a step conflicts with this goal, the goal wins — stop and flag it on #5483.**

## 2. The application

`popcre/shared-db` owns the shared Supabase Postgres (production ref `qsllyeztdwjgirsysgai`). Schema `hts_rag` holds CBP rulings: `hts_rag_rulings` (one row per ruling, ~tens of thousands), `hts_rag_ruling_products` (103,381 product phrases), `hts_rag_ruling_codes`. Entry point `hts_rag.hts_rag_search_rulings(p_query, p_chapters, p_limit, p_query_embedding, p_min_pass1)` runs up to two passes of `hts_rag.hts_rag_search_rulings_pass(...)` — each pass combines full-text, trigram, and vector rankings — then fuses them. Called by DesignFlow backend HTS workers (`designflow_hts_prod_worker`, `designflow_hts_alsand_worker`) through Supavisor. Migrations land via preview rehearsal + automatic promotion (see `AGENTS.md`).

## 3. Trigger

2026-11-02 investigation: `extensions.pg_stat_statements` (reset 2026-10-31 7:07 PM EDT) showed ~24 s mean for this function.

## 4. Scope

In: diagnosing and fixing the slow pass inside `hts_rag_search_rulings_pass` / `hts_rag_search_rulings` with index or query changes that preserve ranking.
NOT in: ranking formula changes, filling `phrase_embedding` (a data-load job under #5188), DesignFlow backend code, the reasoning layer itself.

## 5. Current state

- Being actively tuned by another lane: latest definition `supabase/migrations/20261102155541_hts_rag_ruling_search_trgm_scope.sql` (commit `59e873188`, merged 2026-11-02 10:57 AM EST, #5283), preceded by `20261101115125_..._bounded_fts.sql`, `20261101140727_..._cold_cap.sql`, `20261101143319_..._no_detoast.sql`. **The 24 s mean mostly predates these** — re-measure first.
- `phrase_embedding` is NULL on all 103,381 product rows (checked 2026-11-02). The vector step only runs when `p_query_embedding` is non-null (`...trgm_scope.sql:73`), and with an empty HNSW index (`hts_rag_ruling_products_phrase_hnsw_idx`, `20261029093702_hts_rag_cbp_ruling_database.sql:544`) it should return instantly — verify, don't assume.
- Open review findings on adjacent PRs: #5431 (fixer-failed), #5220. An open `review-finding` blocks promotion — check before landing.

## 6. Findings so far (read-only, 2026-11-02 ~2:10 PM EST, query "plastic toy figure")

- Full-text step: 87 ms. Trigram step (`<%` on `lower(subject)`, threshold 0.4): 529 ms, 3,392 blocks read — the heaviest measured piece, but nowhere near 24 s.
- A hand-written vector query did a 22,325-block sequential scan (880 ms) — **but that was my synthetic query, not the function's real path**, and it found zero rows because no embeddings exist. Not established as the cause.
- `hts_rag_search_rulings_pass` cannot be executed by the MCP read-only role (permission denied); tracing it needs `auto_explain` on preview or a role with EXECUTE.
- **Root cause of the 24 s is not yet identified.** Candidates: (a) pre-#5283 trigram behaviour (already fixed?), (b) pass 2 running unscoped across all rulings when pass 1 returns < `p_min_pass1`, (c) cold-cache reads under concurrent worker load.

## 7. Rejected / do-not-repeat

- Assuming the vector step is the cause — disproved above unless step 2 shows otherwise.
- Changing the OR-of-words tsquery to AND — deliberate recall choice (comment in function).
- Global `pg_trgm` threshold changes — affect other apps' searches.

## 8. Decisions

Locked: ranked output identical for the benchmark queries; forward-only migration; coordinate with whoever owns #5283 (comment on #5483 before editing the function).
Open: which fix, decided by step 2 evidence.

## 9. Steps

**Step 0 — Re-measure.** Query `extensions.pg_stat_statements` for `hts_rag_search_rulings` (calls, mean, max). Because stats predate #5283, compare against `pg_stat_statements_reset` time; if needed, read DesignFlow worker timings. Record in `docs/verification/database-efficiency/<UTC>/hts-ruling-baseline.md`. Gate: if post-#5283 mean < 1 s, mark plan done and stop.

**Step 1 — Real parameters.** Find representative `(p_query, p_chapters, p_query_embedding?)` from the DesignFlow HTS worker logs or the #5283 benchmark set (look in that PR for its benchmark file). Gate: ≥5 real queries saved in the verification folder.

**Step 2 — Trace.** On a preview branch (or production with `set local` + `auto_explain.log_nested_statements=on` via a role with EXECUTE — prefer preview with production-sized data), run `EXPLAIN (ANALYZE, BUFFERS)` per pass for each query. Gate: one named node accounts for most of the time, written in the verification file.

**Step 3 — Fix migration** `supabase/migrations/<UTC>_hts_rag_ruling_search_<fix>.sql`. Likely shapes: chapter-scoped trigram/FTS index (e.g. partial or composite on chapter), cap pass 2 candidates, or a covering index. Gate: preview EXPLAIN < 1 s for all saved queries and identical top-`p_limit` output vs. current function (diff both result sets).

**Step 4 — Land + live proof.** PR → required checks → automatic promotion. Then 24 h `pg_stat_statements` mean < 1 s; record; tick checkbox on #5483.

## 10. Tests

Add regression SQL test under `supabase/tests/` asserting result order for 3 fixed fixture queries (pass-1-only, pass-2 fallback, no chapters). Existing suite stays green.

## 11. Constraints

Load `shared-db-change`; claim `hts_rag.hts_rag_search_rulings*` on #5483; `ai-task-gates start --class shared-db`. Function is `security definer` with `search_path ''` — keep fully-qualified names. Regenerate types only via the repo's type workflow, never by hand.

## 12. Access

Supabase MCP `execute_sql` (read-only role; cannot EXECUTE the pass function). `gh` for issues/PRs. Preview branches come from CI.

## 13. Done, risks, open questions

Done: cause named with artifact, fix merged and promoted, 24 h mean < 1 s recorded, #5188 checkbox ticked, STATUS + handoff updated.
Risk: ranking drift — guarded by result diff. Rollback: re-apply previous function body in a new migration.
Open: whether the problem survives #5283 (step 0 decides).

## Self-audit

1. Fresh session executes without asking? Yes — §5 files/commits, §9 gates incl. early-stop, §12 access limits.
2. Background and ruled-out ideas carried? Yes — §6 says plainly what is and isn't proven; §7 rejections.
3. Goal clear for judgment? Yes — §1 "same ranking, < 1 s"; §8 locks ranking.
