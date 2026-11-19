---
summary: Search performance on Supabase Postgres: query shapes, exact and semantic lanes, totals and cold-load fixes.
kind: living
status: current
read-when: making search faster or diagnosing timeouts
---

# Search Performance

PopDAM library search is backed by Supabase Postgres, not an external search
cluster.

## Current Stack

- `public.dam_search_documents` is the flattened search table for DAM assets and
  style groups.
- `search_tsv` is a stored generated `tsvector` column indexed with GIN.
- The ranked search uses trigram indexes on `public.dam_search_keys`
  (`title`, `path`, `customer`, and `program`) for substring matches.
- The old `embedding vector(384)` (`gte-small`) column is retired; nothing in
  search reads it. Meaning vectors live in separate tables: SigLIP2 picture
  vectors (768) and Qwen3-Embedding-0.6B text-meaning vectors (1024,
  `dam.search_text_vectors`, #1037).
- `search_dam_documents(...)` supports keyword-only search now and hybrid
  keyword + semantic search when a query embedding is supplied.
- The legacy RPCs `search_assets_full_text(...)` and
  `search_style_groups_full_text(...)` remain as wrappers so the app does not
  need a coordinated frontend cutover.

## Item-number search

`dam-search-ai` checks the current style-group catalog for a full item number
or the start of one. Catalog-confirmed item searches and unknown full numbers
in a supported catalog format skip spelling, vector settings, and vector
search. They use the same ranked keyword search, including matching outside
the item-number field, filters, ordering, and totals. See [the catalog search
rule](https://github.com/popcre/shared-db/blob/main/docs/business-rules/digital-asset-classification-and-tags.md#product-code-searches)
and [PopDAM #1061](https://github.com/u2giants/popdam3/pull/1061).

If a prefix is slow, measure the catalog check and ranked query separately
using `product_code` and `search_rpc` in the response's `Server-Timing` header.
Check which indexes the ranked query actually uses before proposing a new one.
A starts-with check on the item-number field alone can omit existing keyword
matches. Compare ordered IDs and totals across pages with a viewer account;
include a filtered request if changing filter handling.

In the [November 18 live check](https://github.com/u2giants/popdam3/issues/804#issuecomment-6987728536),
the existing indexed substring step found 188 matches in about 60 ms. The
same prefix returned in 0.36–0.78 s across three live requests, with all 188
groups verified across four pages. This sample did not establish peak-load
latency.

## Supabase Features In Use

- `pg_stat_statements`: inspect real slow search/query calls.
- `index_advisor` + `hypopg`: test candidate btree indexes without creating
  physical indexes first. Note: this advisor does not recommend trigram, GIN, or
  HNSW indexes, so it is a guardrail rather than the whole answer.
- `vector`: pgvector storage and HNSW index support for optional semantic
  search.
- Query vectors come from `apps/text-embed` (`TEXT_EMBED_URL`), which returns
  both SigLIP2 and Qwen3 text-meaning vectors; `dam-search-ai` no longer uses
  Supabase Edge AI `gte-small`. The text-meaning leg is switched by
  `admin_config.SEARCH_TEXT_LEG_MODE` (`on`/`off`, instant, no deploy).

## First search after idle (cold cost)

A first typed search is slower than repeats of the same query (#1196: measured
2.7–6.3 s first versus 1.1–2.0 s warm). Per-step Server-Timing
(`scripts/search-eval/step-timing.mjs --first-hit`) attributes it to a database
buffer-cache miss — `search_rpc` and `anchor_rpc` run 2–10× their warm cost on
the first execution of a query — plus a cold-isolate spelling-vocabulary load
(0.5–1.3 s). The query-embedding cache miss adds only ~0.15–0.25 s and is not
the cause.

Mitigations in place:

- The production canary (`scripts/production-canary.mjs`, every 15 minutes) runs
  a search keepalive ("frame", "canvas", "print") that keeps the edge isolates
  and the Postgres search working set warm. Keepalive runs are informational and
  never fail the canary — a slow warm-up is the very cost being hidden.
- `dam-search-ai` starts the spelling-vocabulary load as soon as a search
  arrives, so it overlaps the catalog checks and embed instead of serializing
  inside that search's spelling step.

When first searches regress, measure with `step-timing.mjs --first-hit` (viewer
tester) and compare `first` vs `repeat` per step: `search_rpc`/`anchor_rpc`
growth means database cache misses; `spelling` growth means isolate churn.

## Useful Checks

Search RPC timings:

```sql
select * from public.get_dam_search_performance_stats();
```

Embedding coverage:

```sql
select public.get_dam_search_embedding_status();
```

Index advisor for a concrete query:

```sql
select *
from public.advise_dam_search_query_indexes(
  $$select id from public.dam_search_documents where document_type = 'asset' and customer = $1$$
);
```

CLI inspection examples:

```bash
supabase inspect db cache-hit --db-url "$DATABASE_URL"
supabase inspect db index-sizes --db-url "$DATABASE_URL"
supabase inspect db bloat --db-url "$DATABASE_URL"
```

Embed a small batch through the Supabase Edge Function:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/dam-search-ai" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"embed-batch","limit":25}'
```

## Operating Notes

- Do not add broad `%term%` predicates to high-cardinality text fields unless a
  matching trigram index exists.
- When document content changes, the search trigger clears the stored embedding
  so semantic results cannot silently use stale text.
- Keep semantic search opt-in until relevance and latency are measured against
  real library searches.
