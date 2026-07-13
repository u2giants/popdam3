# Search Performance

PopDAM library search is backed by Supabase Postgres, not an external search
cluster.

## Current Stack

- `public.dam_search_documents` is the flattened search table for DAM assets and
  style groups.
- `search_tsv` is a stored generated `tsvector` column indexed with GIN.
- `title`, `path`, `customer`, and `program` have trigram indexes for substring
  searches such as SKU prefixes (`3fz`).
- `embedding vector(384)` is reserved for Supabase `gte-small` embeddings.
- `search_dam_documents(...)` supports keyword-only search now and hybrid
  keyword + semantic search when a query embedding is supplied.
- The legacy RPCs `search_assets_full_text(...)` and
  `search_style_groups_full_text(...)` remain as wrappers so the app does not
  need a coordinated frontend cutover.

## Supabase Features In Use

- `pg_stat_statements`: inspect real slow search/query calls.
- `index_advisor` + `hypopg`: test candidate btree indexes without creating
  physical indexes first. Note: this advisor does not recommend trigram, GIN, or
  HNSW indexes, so it is a guardrail rather than the whole answer.
- `vector`: pgvector storage and HNSW index support for optional semantic
  search.
- Supabase Edge AI: `supabase/functions/dam-search-ai` uses native `gte-small`
  embeddings for batch embedding and semantic search tests.

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
