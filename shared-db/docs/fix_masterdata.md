# fix_masterdata.md — guidance for the PopDAM Master Data session

**To the AI session working on the PopDAM "Master Data" page / the
`public.search_style_tracker_link_candidates` RPC:** the shared schema was
restructured underneath you. This explains what changed, why your in-flight work
was stopped, and exactly where to point things now.

## Why your work was stopped

Your three migrations on the preview branch —

- `20260625143000_master_data_plm_candidate_search`
- `20260625144500_tighten_master_data_plm_candidate_search`
- `20260625150000_dedupe_master_data_plm_candidate_search`

— were **applied to the preview branch but never committed to the `shared-db`
repo**, and they built the candidate search on top of `core.company`.
`core.company` was the wrong foundation: it conflated customers with email noise,
factories, and licensors. That is exactly the mess that was being fixed, so the
workstream was halted before it spread further. (Applying uncommitted migrations
directly to the shared preview branch also tripped the "one schema change in
flight at a time" rule in `AGENTS.md` §3 — see "Migration hygiene" below.)

## What the schema looks like now

`core.company` **no longer exists** (hard rename, no compatibility view). The new
shape — full rationale in
[`shared-database-vision.md`](shared-database-vision.md) → "Customer vs. Company
vs. Ingested Domain":

| You used to mean | Use now |
|---|---|
| `core.company` (a customer) | **`core.customer`** |
| `core.company_source_ref` | `core.company_source_ref` (**name unchanged** — still keyed by `company_id`) |
| "a real / PLM customer" | `core.customer` **with** a `designflow_plm`/`coldlion` source ref → `is_potential = false` |
| "a prospect we haven't transacted with" | `core.customer` with **no** ERP source ref → `is_potential = true` |
| an email domain (recruiter, vendor, spam) | **`crm.ingested_domain`** (CRM-private; never a customer; do not join to it) |
| a factory | `core.factory` |
| a licensor | `core.licensor` |

## What already happened to your function

`public.search_style_tracker_link_candidates` has been **repointed to the new
schema** in migration
[`20260625153030_masterdata_candidate_search_to_customer.sql`](../supabase/migrations/20260625153030_masterdata_candidate_search_to_customer.sql).
The only changes from your last preview version were in the **`customer`** branch:

- `from core.company c` → `from core.customer c`
- `target_table` label `'company'` → `'customer'`

The `licensor` / `property` / `factory` / `sku` branches were already on
`core.licensor` / `core.property` / `core.factory` and are unchanged. Treat that
migration as the **new baseline** for this function. If you have local
uncommitted edits stacked on `143000/144500/150000`, rebase them onto it.

## Where to go from here

- **PLM-backed only is now automatic.** The `customer` branch joins
  `core.company_source_ref` filtered to `source_system = 'designflow_plm'`. Since
  email noise is no longer in `core.customer` and prospects have no ERP ref, that
  join already returns only canonical PLM customers. If you instead want to offer
  potential customers too, drop the source-ref filter and read
  `core.customer` directly — but then exclude nothing-but-noise is still safe
  because noise lives in `crm.ingested_domain`, not here.
- **Reuse the shared fuzzy matcher.** There is now
  `core.match_customer(p_name, p_domain, match_threshold, review_threshold)`
  (migration `20260625153020`), backed by `pg_trgm` with a trigram index on
  `core.customer.normalized_name`. Prefer it over bespoke `similarity()` scoring
  so customer matching is consistent across the PLM import and the Master Data
  page.
- **Never reference `core.company`.** It is gone. New objects, views, and RPCs
  must target `core.customer` (+ `core.company_source_ref` for source linkage).

## Migration hygiene (so this doesn't recur)

Per [`AGENTS.md`](../AGENTS.md):

1. **Commit to the `shared-db` repo first, then apply.** Do not apply
   preview-only migrations that aren't in git — that is what caused this
   collision. Every schema object must exist as a committed
   `YYYYMMDDHHMMSS_*.sql` migration.
2. **One schema change in flight at a time.** Check for in-flight work before
   starting; coordinate with the owner.
3. **Preview first, production never untested.** Branch + PR, apply to preview
   (`xjcyeuvzkhtzsheknaiu`), verify, then promote.
4. **Timestamp after the latest committed migration.** As of this writing the
   newest committed migrations are the `20260625153000`–`20260625153030` set;
   stamp yours later than those.
