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

Self-audit is preserved in the plan's final section. Review pending; a Muse doctor passed for the pinned Muse Code runner and protected key-store presence, but that alone is not a review completion. Add a sanitized report summary and qualified source/report identifiers after the actual requested Muse turn completes. Never commit provider credentials, private corpora, prompts containing real licensed rows or raw authenticated traffic.
