# Coldlion ERP customers + vendors → canonical hubs (2026-07-15)

**Migration:** `supabase/migrations/20260715234500_erp_coldlion_customer_vendor_import.sql`
**DB:** shared Supabase `qsllyeztdwjgirsysgai` · **Source:** Coldlion "CLAPIServerEhp" API
(`/customers`, `/vendors`, `companyCode=EDGEHOME`) · see
[`../coldlion-erp-api-reference.md`](../coldlion-erp-api-reference.md).

## What / why

Pulled the Coldlion customer master (836 rows) and vendor master (539 rows) into the
shared backend, following the proven `plm.import_master_data()` customer pattern. Coldlion
is the ERP system of record; our DB holds a re-pullable replica.

**Where the data lands (three layers):**

| Layer | Object | Contents |
|---|---|---|
| Raw (bronze) | `ingest.raw_record` (`source_system='coldlion'`, `source_table='customers'\|'vendors'`) | Every row, exact payload, keyed by `customerCode`/`vendorCode`. 836 + 539. |
| Typed mirror (silver) | **`plm.erp_customer`** / **`plm.erp_vendor`** (NEW) | All rows (active + inactive), typed Coldlion columns. `customer_id`/`factory_id` link to canonical only when promoted. |
| Canonical (gold) | `core.customer` + `core.company_source_ref` / `core.factory` + `core.factory_source_ref` | **Active records only** (product decision below). `source_system='coldlion'`. |

**Importer functions (idempotent, `security definer`, service-role only):**
`plm.import_coldlion_customers(jsonb)` and `plm.import_coldlion_vendors(jsonb)`. Each takes a
JSON array of Coldlion rows, upserts all three layers, and wraps the run in `ingest.sync_run`.
Re-running only refreshes — canonical rows are matched by normalized name so re-pulls and the
pre-existing 139 customers / 6 factories are de-duplicated, never re-created.

## Product decision (2026-07-15): active-only promotion

Only records flagged `active='Y'` in Coldlion are resolved into the canonical hubs that the
CRM / PM / DAM apps read. Inactive/dormant ERP accounts still land in `ingest.raw_record` and
the typed `plm` mirror (with a NULL canonical link) so nothing is lost, but they do not flood
the app UIs. Promotion for an inactive record later is a one-line change (drop the `active`
guard, or backfill by name).

## Load results (verified live)

| Metric | Customers | Vendors |
|---|---:|---:|
| Rows pulled / in `ingest.raw_record` | 836 | 539 |
| Rows in typed mirror | 836 | 539 |
| Active | 834 | 532 |
| Promoted to canonical (created) | 790 | 523 |
| Promoted to canonical (matched existing) | 44 | 8 |
| Not promoted (inactive) | 2 (`EDP050`,`WIS030`) | 7 |

`core.customer`: 139 → 929 (848 active ERP-backed / `is_potential=false`, 81 still potential).
`core.factory`: 6 → 529. `core.company_source_ref` gained 834 `coldlion` rows;
`core.factory_source_ref` gained 531 (was empty).

**One benign data-quality note:** one *active* vendor has a blank `vendorDesc` in Coldlion, so
it is kept in `plm.erp_vendor` (active) but intentionally **not** promoted to `core.factory`
(no real name to key on). Not an error; fix the name in Coldlion and re-pull to promote it.

## Field mapping (highlights)

**Customer** (`plm.erp_customer`, key `customer_code`=`customerCode`): `name`=customerDesc,
`dba`=customerDBA, `active`=active Y/N, `address`=address1-3/city/state/zipCode/countryCode/
regionCode (jsonb), `phone`=phoneNo, `salesperson_code_1/2`, `commission_perc_1/2`,
`factor_code`, `currency_code`, `gl_code`, `erp_created_at`=createdTime, `erp_updated_at`=modTime.

**Vendor** (`plm.erp_vendor`, key `vendor_code`=`vendorCode`): `name`=vendorDesc, `active`,
`address` (jsonb), `phone`=phoneNo, `email`, `country_code`, `pay_term_code`, `gl_code`,
`separate_check`. Canonical `core.factory.code` = `vendorCode` for newly created rows;
pre-existing factories keep their own code (e.g. `directus:<uuid>`) and just gain a source ref.

## How to re-pull (operational, not a migration)

Migrations never call the external API. To refresh, page all rows from Coldlion and call the
importers with the service role (the load script used `pg` against the pooler as `postgres`):

```
GET http://x5.coldlion.com/EhpApi/customers?companyCode=EDGEHOME&size=200&page=N   (X-API-Key)
GET http://x5.coldlion.com/EhpApi/vendors?companyCode=EDGEHOME&size=200&page=N
-- then:
select * from plm.import_coldlion_customers('<json-array>'::jsonb);
select * from plm.import_coldlion_vendors('<json-array>'::jsonb);
```

API key: 1Password `vibe_coding` → *Coldlion ERP API key x5.coldlion.com* → `credential`.
DB password: 1Password `vibe_coding` → *Supabase DB Password - shared POP database*.
Both endpoints accept `modifiedFrom`/`modifiedTo` for nightly deltas instead of full reloads.

## Follow-ups (not done here)

- No `api.*` serving view was added for these yet — the CRM already reads customers/factories
  through `core.*` / existing `api.crm_customer_list`. Add `api.plm_vendor_list` if an app needs
  the typed Coldlion vendor columns directly.
- No scheduled sync job. This was a one-time backfill. A nightly delta pull (mirroring the
  existing dflow `popcre-sync-prod` cadence) can be added later, reusing these importers.
