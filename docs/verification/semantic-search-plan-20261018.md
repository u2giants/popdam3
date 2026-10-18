# Semantic-search planning evidence — October 18, 2026

Planning evidence only; no semantic implementation, new backfill or mode activation was performed. App baseline: [9033ce3d548ac84463e4ca4f823f37d8dcc69e54](https://github.com/u2giants/popdam3/commit/9033ce3d548ac84463e4ca4f823f37d8dcc69e54). [Combined delivery plan](../../plan_semantic_search_popdam_popsg.md).

## Production read-only snapshot

Observed October 18, 2026, approximately 12:21 PM EDT, through the supported Supabase management API endpoint for project `qsllyeztdwjgirsysgai`, request `read_only: true`. 1Password injected the PAT into the process environment; no credential was printed or saved to Git. Identity read returned `current_user=supabase_read_only_user`, `transaction_read_only=on`, PostgreSQL 17.6. It did not change role or grant access.

Reproduction query (execute through the current supported read-only identity; do not add privileges if denied):

```sql
select current_user, current_setting('transaction_read_only'), version();
select name, installed_version, default_version
from pg_available_extensions
where name in ('vector','vectors','vchord','pg_vectorsearch','vectorscale');
select count(*) as total,
       count(*) filter (where embedding is not null) as nonnull_vectors,
       count(*) filter (where embedding is null) as null_vectors
from public.dam_search_documents;
select key, value from public.admin_config
where key in ('SEARCH_MODE','SEARCH_AUTO_EMBED_ENABLED','SEARCH_MIN_SEMANTIC_SCORE');
select table_schema, table_name, column_name, udt_name
from information_schema.columns
where table_name = 'style_guide_search_documents'
   or (table_name = 'style_guide_files' and column_name like '%embed%');
select n.nspname, p.proname, pg_get_function_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'search_style_guide%';
```

Aggregate results: only `vector` listed, installed/default version 0.8.0; 150,459 DAM documents, 4,505 non-null vectors, 145,954 null vectors; zero rows for the three named settings. SG document columns include `search_vector` of type `tsvector`, but no embedding column. Current SG search functions `search_style_guide_library` and `search_style_guide_library_v2` have no query-embedding argument. These counts do not validate embedded content/model freshness, permissions for end users, current SG file coverage, or actual query usefulness.

A direct `get_dam_search_embedding_status()` call through this read-only identity returned permission denied. Table/catalog aggregate reads succeeded. This was an inspection limitation, not a need for a production grant or an alternative privileged SQL path. Future application status acceptance uses the real authenticated admin endpoint.

## Source/custody checks

- App fetch/fast-forward completed; main and origin/main resolved to the baseline above. Unrelated untracked files were preserved. Planning edits use a separate clean current-upstream worktree.
- [SG repair #4210](https://github.com/popcre/shared-db/issues/4210) and [claim #4212](https://github.com/popcre/shared-db/issues/4212) were OPEN. Claim exclusively names `function public.search_style_guide_library_v2`; owner is predecessor Codex chat `01a12c68-44b8-7bb3-b1d4-98cb375b6859`.
- [PR #4213](https://github.com/popcre/shared-db/pull/4213) is MERGED, merge `47e46b74260a33f6ef22d1e5c59a05d828fb3c1b`. Last recorded repair update, October 11, 2026, 11:20 PM EDT, says preview applied but automatic production risk qualification refused. Process activity was not verified. An October 18 `git ls-remote origin 'refs/db-author-handoff-ready/*'` listing contained no #4212 ready ref; no takeover was attempted.
- [#96](https://github.com/u2giants/popdam3/issues/96) latest direction read in this session, posted October 15, 2026, 10:45 PM EDT: do not rotate the key or recover the original interrupted operation; continue only its existing fresh run. Completion/current saved metadata was not reverified here.
- [New SG structural work #4437](https://github.com/popcre/shared-db/issues/4437) has `db-work` label and blocked scope depending on #4210. The two application acceptance cards remain [#97](https://github.com/u2giants/popdam3/issues/97) and [#107](https://github.com/u2giants/popdam3/issues/107), with fresh planning/baseline comments. No separate proof-only issue was created.

## Primary package research

Checked October 18, 2026; re-read upstream and live hosting inventory before implementation. These are vendor/project facts, not our performance measurements.

- [pg_vectorsearch README](https://github.com/timescale/pg_vectorsearch): alpha/testing-only warning, prerelease upgrade risk, PostgreSQL 18+ requirement, PRISM indexing and compatibility with pgvector columns. Do not confuse it with [pgvectorscale](https://github.com/timescale/pgvectorscale).
- [pgvecto.rs README](https://github.com/tensorchord/pgvecto.rs): maintainers encourage migration to [VectorChord](https://github.com/tensorchord/VectorChord).
- [VectorChord README](https://github.com/tensorchord/VectorChord): pgvector-compatible vector representation and an additional index extension. Hosting availability, production operations and our filter/count workload still require proof.
- [Supabase vector-index guidance](https://supabase.com/docs/guides/ai/vector-indexes): pgvector/HNSW is a supported documented path.
- [Supabase hybrid-search guide](https://supabase.com/docs/guides/ai/hybrid-search): keyword and semantic retrieval can be combined; its example is not proof of this application's security, full totals/facets, recall or latency.

## Planning verification and independent review

The plan self-audit passed: all 13 sections, background/failures/decisions, per-step gates, adversarial named tests, environment/secret locations, shipping/live acceptance and bidirectional handoff links are present. A local check validated section numbers, relative document links, the adversarial table and whitespace. These are documentation checks, not application behavior tests.

Muse Spark 1.3 Contributor completed the first actual review October 18, 2026, 12:43 PM EDT in conversation `popdam-popsg-search-plan-20261018`, native session `f4565879-498f-45a0-971a-f39d03de917f`, source `1038c1cdcc8fdab76cd345f0b5e74985c01087e3`. Report SHA-256: `c9dd3ff765f658393912b637a0c04ca8dfbeb5ef7074f5f215604987295ae4f0`. The runner proved completion and retained the report privately; no raw provider stream is committed.

**Explicit package answer:** Muse recommends existing pgvector/HNSW and says not to use Timescale pg_vectorsearch now. Its reasons were supplied hosting unavailability/PG17.6 versus PG18+, supplied alpha status/upgrade risk, and absence of measured need. It distinguished pg_vectorsearch from pgvectorscale, said not to start with pgvecto.rs, and kept VectorChord as a possible later candidate only after supported hosting and measured need. Muse independently read repository source but did not browse upstream or rerun SQL; package/live facts remain this session’s supplied evidence, not independently refreshed facts from Muse.

Muse’s initial verdict was **REVISE**. Disposition in the revised plan:

| Finding | Correction |
|---|---|
| M1 — nightly UUID churn overwhelms batch-three/minute freshness | Step 7 explicitly measures post-rebuild pending, states 180/hour upper bound, requires tested cadence/capacity/current stable identity before activation |
| M2 — SG/manual/automatic lane overlap | Step 5 uses one shared search-index lane and one round-robin coordinator through the existing operation path, with multi-replica fairness/exclusion proof |
| M3 — mode readable only by admin | Steps 1/6 test each role and name authenticated search-modes capability for both apps, returning permitted modes only |
| M4 — unextracted PDF-only test cases cannot pass | Steps 1/2 measure extraction status, freeze extracted-record cases before judging, and preserve other extraction obligations separately |
| M5 — #96 gate lacks exact releasing artifact | Step 7 names current 8,663-asset saved description/exact-model/active-tag fully paginated audit and current issue checklist; no operation-counter inference |
| O1 — silent same-dimension provider update | §8 records model/build/date if exposed, fixed-text canary drift checks and residual alias risk |
| O2 — canonical fixture timing/path | Step 2 drafts; structural step 4 owns landing canonical SQL tests |
| O3 — injected provider failure versus no-error gate | Step 8 separates normal latency from bounded 15-second fallback resilience drills |
| O4 — exact identifier with excluding filters | Step 2 explicitly requires permitting filters |
| O5 — refresh regression bypasses feature flags | §13 elevates preimage/parity and governed forward-fix/rollback of shared keyword refresh |
| O6 — old human-approval wording | Step 1 reconciles current technical gates/native automatic promotion and rejects stale human technical approval |
| O7 — unnamed freshness burst | Steps 1/7 freeze and record numeric burst N and nightly count from measured source arrivals |
| O8 — small relevance set noise | Step 2 records pooled/per-view NDCG and small-sample limitation |
| O9 — DAM catch-all auth fallback | Step 6 requires DAM and SG to propagate 401/403, with named auth_denial_never_keyword_fallback tests |
| O10 — Unicode/truncation ambiguity | Step 4 specifies NFC/code-point/line-ending/whitespace policy and verifies provider token limit |
| O11 — full-text hash versus prefix work | §8 explicitly measures/retains or governs alignment of DAM digest/input identity and budgets extra churn |
| O12 — incomplete source-writer enumeration | Step 4 explicitly includes tag-popsg-files/active tags/crawl reconciliation writers |
| O13 — unspecified request cancellation | Step 5 names adapter/SEMANTIC_QUERY_TIMEOUT_MS/AbortController and separates query/backfill budgets |
| O14 — engine change too early | Step 8 requires supported HNSW/iterative and exact membership tuning before alternatives |

A local preparation attempt used an abbreviated assert-head and was rejected before any snapshot/provider session existed. The wrapper retained `preparation_failed` with null session/report; transcript/reconcile could not produce a provider completion. This non-provider attempt remains preserved and is not approval. The successful conversation above started with the full immutable SHA and is the one to continue; never replay an uncertain provider turn or change engines.

Same-conversation confirmation of corrections and formal publication review remain pending at this draft. Never commit credentials, private corpora or authenticated traffic.
