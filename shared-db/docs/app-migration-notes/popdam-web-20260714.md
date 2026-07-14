# PopDAM DAM Search Synonyms - 2026-07-14

## Status

Done and promoted to production.

## What Changed

PopDAM DAM search now expands user queries through a curated shared database vocabulary before ranking DAM search documents.

Durable implementation:

- Migration `supabase/migrations/20260714165000_dam_search_spiderman_normalization.sql`
  - First production fix for `spiderman` -> `spider man` normalization inside `search_dam_documents`.
- Migration `supabase/migrations/20260714173500_dam_search_synonyms.sql`
  - Adds `public.dam_search_synonyms`.
  - Adds `public.expand_dam_search_queries(query)`.
  - Replaces `public.search_dam_documents(...)` so keyword search uses expanded query variants before grouping/ranking.
  - Seeds 23 active aliases for collapsed character/property names and common product-language terms, including `spiderman`, `mickeymouse`, `starwars`, `wallart`, `canvas`, `3 d`, `3d`, and `lenticular`.

App-facing compatibility wrappers are unchanged:

- `public.search_assets_full_text(query, limit)`
- `public.search_style_groups_full_text(query, limit)`

PopDAM frontend code did not need to change because it already calls those wrappers.

## Why

A user search for `spiderman canvas` returned only 22 groups / 227 files in the app. Live database probes showed the search engine was treating the query as `spiderman AND canvas`, while most DAM metadata is tokenized as `Spider-Man` / `Spider Man`. The same intent spelled `spider man canvas` returned thousands of matching assets.

The broader fix makes search more forgiving for designers, sales, and other non-technical employees who naturally type collapsed names, punctuation variants, or product/category shorthand.

## Affected Apps

- PopDAM web library search.
- Any future DAM worker or admin tooling that calls `search_dam_documents`, `search_assets_full_text`, or `search_style_groups_full_text`.

No CRM, PM/PIM, or PLM app behavior is expected to change unless those apps later call the DAM search RPCs.

## Verification

Ran:

- `bash scripts/check-sql.sh`
- Preview branch dry-run against `xjcyeuvzkhtzsheknaiu`
- Preview branch `supabase db push`
- Production dry-runs against `qsllyeztdwjgirsysgai`
- Production `supabase db push`
- Live production SQL probes through the Supabase pooler

Selected live verification after production deploy:

| Query | Asset RPC count | Style-group RPC count |
|---|---:|---:|
| `mickeymouse canvas` | 1,949 | 328 |
| `mickey mouse canvas` | 1,949 | 328 |
| `starwars wallart` | 1,524 | 373 |
| `star wars wall art` | 1,524 | 373 |
| `spiderman canvas` | 4,621 | 696 |
| `3-D lenticular` | 5,244 | 1,291 |

`expand_dam_search_queries('starwars wallart')` returned variants including `star wars wall art`, proving multi-term expansion works.

## Future Sessions Should

- Add new business vocabulary as rows in `public.dam_search_synonyms`; do not hard-code new one-off replacements in app code.
- Keep `search_term` lowercase and normalized to letters/numbers/spaces. The helper handles hyphen/slash/underscore variants at query time.
- Re-test broad aliases before adding them. Terms like `canvas -> wall art` intentionally broaden search; very broad aliases can affect result volume and relevance.
- Use shared-db branch + PR + preview-first workflow for any search schema/RPC change.

## Rollback

Disable a bad alias without replacing the function:

```sql
update public.dam_search_synonyms
set is_active = false
where search_term = '<term>';
```

If the expansion function itself causes a problem, create a new shared-db migration that restores the prior `search_dam_documents` definition from `20260714165000_dam_search_spiderman_normalization.sql` or `20260713221518_dam_hybrid_search_foundation.sql`.
