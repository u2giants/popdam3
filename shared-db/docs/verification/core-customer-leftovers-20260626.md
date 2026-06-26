# core.customer Leftover Repair Verification — 2026-06-26

## What Changed

Migration `20260626170000_fix_core_customer_leftovers.sql` repaired remaining
post-rename references after `core.company` was hard-renamed to `core.customer`.

It:
- Recreates `api.global_search` with `core.customer` as the customer source.
- Recreates the relevant PLM/Master Data functions after replacing executable
  `from core.company` references with `from core.customer`.
- Rewrites persisted Master Data resolution targets from `core/company` to
  `core/customer`, including the matching JSON note on bridge rows when present.

## Verification

- `scripts/check-sql.sh` passed.
- Preview `xjcyeuvzkhtzsheknaiu` dry-run showed only
  `20260626170000_fix_core_customer_leftovers.sql`; applying it succeeded.
- Production `qsllyeztdwjgirsysgai` dry-run showed only
  `20260626170000_fix_core_customer_leftovers.sql`; applying it succeeded.
- Preview candidate smoke test:

```sql
select *
from public.search_style_tracker_link_candidates('customer', 'Ross', 5, 'fuzzy');
```

returned `target_schema = 'core'`, `target_table = 'customer'`, and
`target_label = 'Ross Stores'`.

- Production resolution rows now group under `core/customer`:

```sql
select target_schema, target_table, count(*) as rows
from plm.style_tracker_value_resolution
group by 1, 2
order by 1, 2;
```

- Production Supabase type generation for app schemas succeeds:

```bash
supabase gen types typescript \
  --project-id qsllyeztdwjgirsysgai \
  --schema public,core,dam
```

## Watchouts

`core.company_source_ref` and `company_id` columns intentionally keep their names.
Do not rename them as part of customer-table cleanup.
