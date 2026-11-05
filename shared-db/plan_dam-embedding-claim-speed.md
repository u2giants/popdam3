# Plan: make the DAM search-embedding claim fast

Handoff: `HANDOFF.d/20261102T1915Z-edge-dev3-claude-db-resource-plans.md` (retired)
Owning issue: popcre/shared-db#5482 (split out of #4664) (DAM SigLIP2/768 embeddings). Sibling plan: [plan_hts-ruling-search-speed.md](plan_hts-ruling-search-speed.md).

## STATUS (2026-11-02 2:15 PM EST)

| Step | State | Evidence |
|---|---|---|
| 0 Re-measure baseline | ⬜ open | — |
| 1 Migration: matching partial index | ⬜ open | — |
| 2 Preview rehearsal + EXPLAIN gate | ⬜ open | — |
| 3 Land via automatic promotion | ⬜ open | — |
| 4 Live proof on production | ⬜ open | — |

Fresh session starts at step 0.

## 1. Ultimate goal

**Why we're doing this, in one paragraph:** Albert asked on 2026-11-02 to cut how much compute the shared database uses. Profiling ruled out connection pooling (only 37 of 90 connections in use; apps already go through Supavisor). The load instead comes from a few slow queries, and this is one of the two biggest. Every second it wastes is a second of shared database capacity taken from every POP app, so fixing it lowers cost risk and keeps the other apps responsive.


Albert wants the shared database to use less compute. The photo library (POP DAM) search-indexing worker is one of the two largest consumers: each batch pickup costs several seconds of disk reads that do no useful work. Done means each pickup costs milliseconds, the worker keeps indexing at the same rate, and nothing about *which* rows it picks changes. **If a step conflicts with this goal, the goal wins — stop and flag it on #5482.**

## 2. The application

`popcre/shared-db` owns the shared Supabase Postgres (production project ref `qsllyeztdwjgirsysgai`) used by DesignFlow, POP DAM, PIM, CRM. Schema changes are SQL migrations under `supabase/migrations/`; they reach production only via the automatic promotion workflow after a preview-branch rehearsal (see `AGENTS.md`). The DAM embedding worker (lives in the POP DAM app, not this repo) calls `public.claim_dam_search_embedding_documents(p_limit, p_worker_id, p_lease_seconds)` as `service_role` to lease up to N rows of `public.dam_search_documents` that still need an image embedding.

## 3. Trigger

2026-11-02 resource investigation (Albert asked to profile the heaviest queries). `extensions.pg_stat_statements` (reset 2026-10-31 7:07 PM EDT) ranked this function's claim query near the top: ~23 s mean per call.

## 4. Scope

In: one new migration adding an index (and, only if step 1's gate fails, a rewrite of the candidate query's `ORDER BY` that keeps identical ordering semantics).
NOT in: changing claim priority or retry rules, the worker code, embedding model work (#4664 proper), the semantic-anchor RPC (#4999), the backlog size itself.

## 5. Current state

- Function body: latest definition in `supabase/migrations/20261101074415_dam_embed_reset_complete.sql` (also touched by `20261101005850_dam_primary_artwork_first.sql`, which added the `(document_type = 'style_group') desc` priority).
- Only claim index: `dam_search_embedding_claim_idx on dam_search_documents(indexed_at, document_type, entity_id) where embedding is null` (`supabase/migrations/20260825031841_popdam_ai_search_forward_recovery.sql:165`).
- Nothing changed yet; no branch, no PR.

## 6. Findings (read-only EXPLAIN ANALYZE on production, 2026-11-02 ~2:10 PM EST, candidate SELECT without `FOR UPDATE`)

- ~30,659 rows have `embedding is null`; 26,060 pass the eligibility filters.
- Plan: bitmap index scan on the claim index → **heap scan of 21,074 blocks (20,850 read from disk)** → top-N sort to 100 rows. 6.4 s on a quiet run; under contention it reaches the 23 s mean.
- Root cause: the leading sort key `(document_type = 'style_group') desc` is an expression the index does not contain, so Postgres cannot walk the index in order and stop at 100; it must fetch every eligible row from the table first. The filter columns (`embedding_attempts`, `embedding_max_attempts`, retry/lease timestamps, `embedding_error_category`) are also not in the index, forcing the heap visit.

## 7. Rejected approaches

- **Raise `work_mem` / bigger instance** — the sort is already a 37 kB in-memory heapsort; cost is disk reads, not sort memory.
- **Drop the style_group priority** — that ordering is a deliberate business choice (#5268 lineage, migration `20261101005850`); changing it changes what gets indexed first. Out of scope.
- **Lower `p_limit`** — cost is independent of limit; it scans every eligible row regardless.

## 8. Decisions

Locked: claim ordering and eligibility semantics stay byte-for-byte equivalent; delivered as a forward-only migration in this repo.
Open (implementer's judgment): exact index shape — see step 1 criteria.

## 9. Steps

**Step 0 — Re-measure.** Run the read-only EXPLAIN in §6 (copy the candidate CTE from the current function, drop `for update skip locked`) on production via the Supabase MCP `execute_sql`. Record time and buffers in `docs/verification/database-efficiency/<UTC>/dam-claim-baseline.md`. Gate: numbers recorded with the command used.

**Step 1 — Migration** `supabase/migrations/<UTC>_dam_embedding_claim_order_idx.sql`, created with `create index concurrently` (check AGENTS.md for whether the promotion pipeline allows `concurrently`; if not, plain `create index` on ~30k-row partial index is acceptable — measure lock time in preview):
```sql
create index dam_search_embedding_claim_order_idx
  on public.dam_search_documents ((document_type = 'style_group') desc, indexed_at, document_type, entity_id)
  where embedding is null
    and embedding_error_category is distinct from 'permanent';
```
Intent: Postgres can read index entries in claim order and stop after enough rows pass the remaining (cheap, mostly-true) filters. Then drop the old `dam_search_embedding_claim_idx` **only if** no other query uses it (`grep` migrations and `pg_stat_user_indexes.idx_scan` after a day). Judgment: if a meaningful share of rows fail the retry/lease filters at the front of the order (they would be skipped repeatedly), add those columns to `INCLUDE (...)` so the filter runs from the index.
Gate: EXPLAIN on preview shows `Index Scan using dam_search_embedding_claim_order_idx` with `Limit` and no `Sort` node.

**Step 2 — Preview rehearsal.** Open PR; CI applies to a preview branch. Seed ≥30k null-embedding rows in preview if it lacks volume (preview fixtures). Gate: EXPLAIN ANALYZE < 50 ms and claim function returns same 100 keys as the old ordering on the same data (compare both queries' output).

**Step 3 — Land.** Merge when required checks pass; the automatic promotion workflow applies it to production. Never run it manually.

**Step 4 — Live proof.** Re-run step 0 on production; record in the same verification folder. After 24 h, `pg_stat_statements` mean for the claim query < 100 ms. Tick the checkbox on #5482.

## 10. Tests

Add a pgTAP (or repo-standard SQL test under `supabase/tests/`) case: insert style_group and non-style_group null-embedding rows with varied `indexed_at`; assert claim returns style_group first, then oldest `indexed_at`, honouring retry/lease/permanent filters. Existing `supabase test db` suite stays green.

## 11. Constraints

Structural change → load `shared-db-change`, claim objects on #5482 first, declare `ai-task-gates start --class shared-db`. Production read-only except via promotion. No `review-finding` open blocks promotion. Never hand-edit `types/database.types.ts` (index adds no type change). Worker keeps running throughout — no function signature change.

## 12. Access

Supabase MCP (`execute_sql`) is authenticated read-only on production. `gh` authenticated as the repo's AI identity. No secrets needed beyond those the CI workflows already hold.

## 13. Done, risks, open questions

Done: migration merged, promoted, production EXPLAIN < 50 ms recorded with artifact path, 24 h mean < 100 ms, #4664 checkbox ticked, this STATUS table updated with evidence, handoff updated.
Risk: index build briefly locks writes on `dam_search_documents` if not concurrent — rollback is `drop index`. Open: whether the old index becomes removable (decide by `idx_scan` after 24 h).

## Self-audit

1. Fresh session executes without asking? Yes — §2/§5 give objects and files, §9 gives SQL and gates, §12 access.
2. Background and ruled-out ideas carried? Yes — §6 evidence, §7 rejections with reasons.
3. Goal clear enough for judgment calls? Yes — §1 states "same rows, milliseconds"; §8 locks ordering semantics.
