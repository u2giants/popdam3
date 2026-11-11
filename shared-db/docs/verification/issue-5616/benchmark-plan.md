---
summary: "Issue 5616 candidate to rebuild the identical 662 MB PopSG HNSW index: read-only findings, proposed scope needing separate claim, synthetic benchmark."
kind: plan
status: open
read-when: evaluating the 5616 PopSG HNSW rebuild benchmark and scope
---

# Issue 5616: identical PopSG HNSW rebuild candidate

Owner: the coordinator of PopDAM issue 663 owns the decision and shared-db issue 5616 intake. This document and its synthetic benchmark authorize no database action. No object claim is adopted. The benchmark is maintained here only for issue 5616; consolidate into the existing benchmark tooling or retire it after the repair decision.

## Read-only findings

Production `qsllyeztdwjgirsysgai`, November 4, 2026, 11:34–11:36 PM EST, checked as `supabase_read_only_user`, `transaction_read_only=on`:

- `upsert_sg_search_embedding` executes one primary-key/hash/lease-guarded UPDATE. Its table has no user triggers. A trigger rewrite cannot cure this SG path.
- SG HNSW is 662 MB; exactly 56,454 documents currently have non-null embeddings. DAM HNSW is 540 MB for approximately 146,168 indexed tuples. Both are full-precision vector(768), cosine, partial on non-null embedding.
- Issue 706 records 234,795 old text vectors cleared before the picture backfill. Index size relative to current live vectors makes retained old graph space a candidate, not a proven complete explanation.
- Shared buffers are 512 MB. Both indexes separately exceed that; competing writes, crawl, and DAM index vacuum cause simultaneous `DataFileRead` waits. DAM vacuum was in `vacuuming indexes` with 29,115 dead item IDs after roughly an hour.
- DAM upserts continued progressing at several seconds each. SG upsert recorded 40,155 ms maximum. IO timing is disabled; `pg_buffercache` is absent. SQL evidence cannot distinguish exhausted storage credits from RAM/cache pressure.
- SG dead tuples were 1,699 after the existing frequent-autovacuum repair. Blanket fillfactor or another claim-plan repair is unsupported by this evidence. Existing issue 1966 explicitly rejects blanket fillfactor and index removal on lost counters.

## Proposed precise scope (root must claim and authorize separately)

Candidate write objects: existing index `public.idx_sg_search_documents_embedding_hnsw`, plus its owning table `public.style_guide_search_documents` only insofar as rebuilding its index requires locks. No function/RPC, permission, model, vector, lease, document, search behavior, or other index changes. Rebuild the identical full-precision HNSW definition with identical options/predicate. Never quantize, remove, disable, or replace search to mask the problem.

Coordinate with issue 4437/Claude chat 6f863884's existing reloptions/function-settings custody and issue 1966 before claiming. PR 5588 is merged; that fact does not retire anyone's claim.

## Runnable synthetic benchmark

Script: `scripts/benchmark_sg_hnsw_rebuild.py`. Six offline safety tests: `python3 scripts/test_benchmark_sg_hnsw_rebuild.py`. These tests perform no database access or DDL.

The coordinator supplies a separately authorized preview/disposable DSN through protected environment variable `SG_HNSW_BENCHMARK_DSN`; never command arguments/output. `--target-identity` must be independently verified and appear in that DSN. Production ref is explicitly refused. Use existing pgvector 0.8.0; do not install extensions. Root performs all task gates/target proofs before running.

Smoke invocation, after the protected environment is established:

```sh
python3 scripts/benchmark_sg_hnsw_rebuild.py --target-identity "$VERIFIED_PREVIEW_REF" --old-rows 1000 --new-rows 250 --probes 32 --statement-ms 30000 --deadline-s 180
```

Only after the smoke run passes and root accepts preview resource impact, representative ratio run:

```sh
python3 scripts/benchmark_sg_hnsw_rebuild.py --target-identity "$VERIFIED_PREVIEW_REF" --old-rows 234795 --new-rows 56454 --probes 32 --statement-ms 900000 --deadline-s 3600
```

Every statement respects the remaining total deadline and its explicit statement ceiling. Locks are bounded to 500 ms. The script commits each phase on a session-temporary synthetic table, builds the original HNSW, commits clearing old vectors, commits inserting the replacement vectors, probes actual writes with EXPLAIN ANALYZE/BUFFERS, rebuilds the identical index, and probes again. Session close removes all objects even on timeout/failure. No persisted/shared table is accessed, and no licensed rows are read. No vacuum is run, deliberately preserving the old graph until the rebuild comparison.

Capture JSON stdout in a protected scratch file. Compare before/after index bytes, exact live count, write execution time and local buffer reads/writes. Temporary tables use local buffers, not production shared buffers: **this experiment proves/rejects retained graph overhead only; its timings cannot establish production cold-cache throughput or search acceptance.** The small fixture is a smoke test only. No conclusion from a timeout. Similar size after rebuild rejects this specific repair hypothesis.

## Canonical promotion boundary

`docs/production-promotion-procedure.md` lines 284–293 records the maintained route: pinned Supabase CLI 2.105.0 sends migration files through a pipeline; `CREATE INDEX CONCURRENTLY` and `REINDEX ... CONCURRENTLY` fail there. The document mentions deliberate out-of-band work as a distinct possibility, but that is **not** an automatic-promotion route and conflicts with this task's production-only-through-automatic-workflow restriction. Do not use it.

An ordinary transactional `REINDEX INDEX` (or plain CREATE INDEX) is the candidate supported SQL shape, contingent on exact-object admission and preview proof of lock/statement/transaction budgets. Existing indexes remain available on rollback. The measured build must fit the agreed interruption budget; do not silently enlarge it. Root must inspect current guarded promotion/verification parsers for explicit REINDEX support before authoring a migration. If either timeout/availability budget or parser refuses it, stop that production action: a separately scoped canonical workflow capability change is required, not an ad hoc concurrent command.

No production structure change has been authorized or performed. Root retains schema, merge, and production decisions.

Parser inspection: `scripts/check-pr-object-collisions.mjs` models CREATE INDEX and ALTER INDEX, but contains no REINDEX handler. The verify-cost scanner recognizes REINDEX only as a cost-bearing read context (`scripts/check-migration-verify-cost.mjs:267`), which does not prove structural object admission. Therefore a bare REINDEX migration must **not** be assumed admitted. The existing modeled alternative is transactional CREATE of an identical replacement index, then DROP old and RENAME replacement, all in one transaction so failures preserve the old index. That expands claimed writes to the replacement index name as well; it still takes a table write lock during the build. Root must choose after benchmark timings and current admission proof; no production SQL is supplied here.
