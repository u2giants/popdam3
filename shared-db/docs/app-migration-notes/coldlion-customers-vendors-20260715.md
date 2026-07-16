# Coldlion ERP customers + vendors → canonical hubs (2026-07-15)

**Migrations:**
- `supabase/migrations/20260715234500_erp_coldlion_customer_vendor_import.sql` — the import machinery + one-time backfill.
- `supabase/migrations/20260716140000_erp_coldlion_status_app_owned.sql` — makes `status` app-owned so manual inactivation survives re-pulls (see "Status is app-owned" below).

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

**One benign data-quality note:** one *active* vendor (**`vendorCode = CNWAH`**) has a blank
`vendorDesc` in Coldlion, so it is kept in `plm.erp_vendor` (active) but intentionally **not**
promoted to `core.factory` (no real name to key on). Not an error; fix the name in Coldlion and
re-pull to promote it.

## Status is app-owned — how to inactivate accounts

**Everything promoted landed as `status = 'active'`** (we only promoted `active='Y'` records, and
each got `status='active'`). So the canonical hubs contain **929 active customers and 529 active
factories, 0 inactive** — the inactive ERP accounts never entered `core.*`; they live only in the
admin-only `plm.erp_customer` / `plm.erp_vendor` mirror.

**Reality check:** Coldlion's own `active` Y/N flag is unreliable — roughly 90% of the accounts it
reports active are dormant. So on our side, **`core.customer.status` / `core.factory.status` is the
authoritative, human-curated visibility signal**, not Coldlion's flag (which stays preserved in the
`plm.erp_*` mirror + `ingest.raw_record` for reference).

`20260716140000_erp_coldlion_status_app_owned.sql` makes this safe: the importers set `status`
**on insert only** and **never reset it on a re-pull** (verified: a manually-inactivated customer
and vendor both survive a re-pull). `is_potential` is still forced false on match (a matched ERP
account is a confirmed real customer, independent of active/inactive).

**To inactivate accounts** (durable — a later re-pull will not undo it):

```sql
-- one-off:
update core.customer set status = 'inactive' where id = '<uuid>';
update core.factory  set status = 'inactive' where id = '<uuid>';

-- bulk by a list of Coldlion codes (customers):
update core.customer c set status = 'inactive'
from core.company_source_ref r
where r.company_id = c.id and r.source_system = 'coldlion'
  and r.source_id = any (array['CODE1','CODE2', ...]);

-- bulk by a list of Coldlion vendor codes:
update core.factory f set status = 'inactive'
from core.factory_source_ref r
where r.factory_id = f.id and r.source_system = 'coldlion'
  and r.source_id = any (array['V1','V2', ...]);
```

**Dropdown / app visibility caveat (open follow-up):** the serving views
(`api.crm_customer_list`, `api.crm_account_list`) and the direct `core.factory` reads currently
return **all rows regardless of status** — setting `status='inactive'` records the curation but
does **not** yet hide the row from app pickers. To actually hide inactive accounts, the serving
contract must filter status (e.g. `where status = 'active'`) — a shared-db + app-repo change to
scope per app. See Follow-ups.

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

- **Hide inactive from app pickers.** `status='inactive'` is now durable but not yet enforced in
  the serving layer. Decide the desired UX per app (hide entirely vs. show under a filter/tab),
  then filter status in `api.crm_customer_list` / `api.crm_account_list` (shared-db) and in the
  factory read path (there is no `api` factory view today — apps read `core.factory` directly, so
  either add `api.plm_vendor_list`/`api.factory_list` with a status filter, or filter client-side).
- **Bulk inactivation source.** Coldlion's `active` flag is unreliable, so a better "is this really
  active?" signal is transaction recency (`/pickticket`, `/receiving`, order history). A one-time
  pass could set `status='inactive'` for every account with no shipment/order in the last N years,
  leaving a small active shortlist to hand-curate. Not built yet — pick the method first.
- No `api.*` serving view was added for these yet — the CRM already reads customers/factories
  through `core.*` / existing `api.crm_customer_list`. Add `api.plm_vendor_list` if an app needs
  the typed Coldlion vendor columns directly.
- No scheduled sync job. This was a one-time backfill. A nightly delta pull (mirroring the
  existing dflow `popcre-sync-prod` cadence) can be added later, reusing these importers.
