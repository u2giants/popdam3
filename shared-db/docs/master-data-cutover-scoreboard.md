# Master-data cutover scoreboard — which entities are on ColdLion, which are still on DesignFlow

**Purpose.** Answer, in one place, the question every AI session keeps re-deriving from
scratch: *for a given master-data entity, has it been cut over to direct ColdLion ERP, or is
it still fed by the DesignFlow PLM API?* Every fact below was previously discoverable, but
only by reading four separate documents and then querying the database. That cost has been
paid at least twice; this page ends it.

Verified live against `qsllyeztdwjgirsysgai` on **2026-07-23**.

---

## 1. The two generations — and the naming rule that distinguishes them

There are two different upstream systems feeding master data, and the table prefix tells you
which one you are looking at. **This is a real convention, applied consistently.** It is not
noise, and neither prefix is a "worse name" for the other.

| Prefix | Upstream | Layer | Meaning |
|---|---|---|---|
| `plm.*_import` | **DesignFlow PLM API** (the older system) | staging (bronze/silver) | Source-shaped rows as the DesignFlow API returned them, plus `raw jsonb`. Written by `plm.import_master_data()`. |
| `plm.erp_*` | **ColdLion ERP, direct** (the cutover target) | typed mirror (silver) | Typed ColdLion columns, all rows including inactive. Written by `plm.import_coldlion_customers()` / `plm.sync_coldlion_vendors()`. |

**The tell for a completed cutover is that both tables exist side by side.** `plm.customer_import`
(54 rows, DesignFlow) and `plm.erp_customer` (836 rows, ColdLion) coexist: the old staging
table is left in place for reconciliation while the new `erp_*` mirror becomes the truth.

**Therefore the absence of `plm.erp_licensor` / `plm.erp_property` is meaningful, not an
oversight of where to look.** Searching for those names and finding nothing is the *correct*
diagnostic, and it correctly concludes that licensor and property were never cut over.

> ⚠️ **Do not mistake `plm.licensor_import` / `plm.property_import` for a ColdLion mirror.**
> They are DesignFlow PLM staging. A previous AI session made exactly this error, reasoning
> that because `37 + 468 = 505` matches `core.taxonomy_source_ref` exactly, those tables must
> be the mirror. The matching count proves the opposite: all 505 taxonomy source refs are
> `source_system = 'designflow_plm'`, which is precisely what "not cut over" looks like.

---

## 2. The scoreboard

| Entity | Status | Live source | Staging / mirror table | Rows | Canonical table | Rows |
|---|---|---|---|---|---|---|
| **Customer** | ✅ **Cut over to ColdLion** | ColdLion `/customers` | `plm.erp_customer` | 836 | `core.customer` | 929 |
| **Vendor / factory** | ✅ **Cut over to ColdLion** | ColdLion `/vendors` | `plm.erp_vendor` | 97 | `core.factory` | 529 |
| **Licensor** | ⏳ **Still DesignFlow** | DesignFlow PLM API | `plm.licensor_import` | 37 | `core.licensor` | 20 |
| **Property** | ⏳ **Still DesignFlow** | DesignFlow PLM API | `plm.property_import` | 468 | `core.property` | 256 |

`core.taxonomy_source_ref` — the bridge for licensor and property — is **505 / 505
`designflow_plm`**, zero ColdLion. That single query is the fastest possible check of
whether this page is still accurate:

```sql
select source_system, count(*) from core.taxonomy_source_ref group by 1;
```

### Freshness (last import)

| Table | Last imported |
|---|---|
| `plm.customer_import` (legacy) | 2026-07-17 |
| `plm.licensor_import` | 2026-07-08 |
| `plm.property_import` | 2026-07-08 |

---

## 3. Why `core.licensor` = 20 but `plm.licensor_import` = 37 — this is correct

The canonical row counts are *lower* than the staging counts, which looks like a failed or
partial promotion. It is not. **The mapping is deliberately many-to-one, and it is exact:**

| Entity | Source refs in `taxonomy_source_ref` | Distinct canonical rows |
|---|---|---|
| licensor | 37 | **20** |
| property | 468 | **256** |

DesignFlow carries the same licensor once **per division** — `plm.licensor_import` holds 20
rows for division `1` and 17 for division `8`, totalling 37 (see
[`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md)). The whole job
of `core.taxonomy_source_ref` is to collapse those per-division duplicates onto one canonical
row. **Deduplication is the feature.** Promotion is working exactly as designed.

If you ever find these counts *not* matching (i.e. `count(*) != count(distinct entity_id)`
diverging from 37→20 / 468→256), *that* is a real defect. The check:

```sql
select entity_table, count(*) refs, count(distinct entity_id) entities
from core.taxonomy_source_ref group by 1;
```

---

## 4. What is actually blocking the licensor / property cutover

Not effort, and not a missing sync job. **ColdLion structurally cannot supply what
`core.licensor` / `core.property` already model.** Three hard blockers, all upstream:

1. **There is no ColdLion licensor or property endpoint.** The endpoint map in
   [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) has `/customers`,
   `/vendors`, `/items`, `/merchGroupHeaders`, `/merchGroupDetails` — and nothing else.
   Licensor and property exist only *inside* merch groups, as `merchGroup05` (licensor) and
   `merchGroup06` (property). Any cutover must be built out of the merch-group feed, which is
   a materially harder problem than the customer/vendor cutovers were.

2. **ColdLion has no licensor→property relationship.** `core.property` today has a strict
   `licensor_id` foreign key into `core.licensor`. ColdLion's merch-group payload carries no
   such hierarchy. Cutting over naively would **destroy** the licensor→property tree that 11
   foreign keys and 6 views currently depend on. This is a capability regression, not a
   migration.

3. **Merch-group codes are not globally unique, and they collide across entity types.** Codes
   are unique only within `(division, mgTypeCode)`. The documented live example: **`FR` is a
   licensor in our database and a *property* in ColdLion.** Any key-based reconciliation will
   silently mismatch rows unless it carries division and `mgTypeCode` through the join.

Secondary: ColdLion's merch-group payload has **no active/inactive flag** anywhere, so the
active-only promotion rule used for customers and vendors has no equivalent input here.

**Sizing note.** ColdLion holds 22 licensors and 258 properties in CW001, against our 20 and
256 (see [`coldlion-direct-sync-and-taxonomy-plan.md`](coldlion-direct-sync-and-taxonomy-plan.md)).
The near-match is a trap: two taxonomies that are 90 % identical are harder to reconcile
safely than two that are obviously different, because the mismatches hide.

---

## 5. What is blocking retirement of `plm.*_import`

Separate question from the cutover, and the answer differs per table.

| Table | Live consumers | Safe to retire? |
|---|---|---|
| `plm.licensor_import` | **None.** No views, no foreign keys, no application code — only the migration that created it. | **Yes, once a ColdLion licensor feed exists.** Blocked solely by §4, not by consumers. |
| `plm.property_import` | **None.** Same as above. | **Yes, once a ColdLion property feed exists.** Blocked solely by §4. |
| `plm.customer_import` | **One live consumer:** the view `api.crm_customer_list` reads `logo_url` and `status` (surfaced as `plm_status`). | **No, not yet** — see below. |

`plm.customer_import` is the only genuinely blocking case, and the blocker is narrow and
concrete: it carries **two fields ColdLion does not supply**.

- **`logo_url`** — the DesignFlow `customers_logo` value. ColdLion `/customers` has no logo
  field. Documented in [`shared-database-vision.md`](shared-database-vision.md).
- **`status`** — the mirrored PLM `ACTIVE`/`INACTIVE` value. Note that ColdLion's own `active`
  flag is explicitly documented as **unreliable**, which is why `core.customer.status` is
  app-owned and survives re-pulls.

So retiring `plm.customer_import` is not a delete — it requires first relocating those two
fields (the per-app extension table is the designed home; see
[`per-app-extension-tables-plan.md`](per-app-extension-tables-plan.md)) and repointing
`api.crm_customer_list`. Until then, dropping the table breaks the CRM customer list.

**Verify the consumer set before acting** — this query finds every view depending on these
tables, and is the check to re-run rather than trusting this page:

```sql
select dependent_ns.nspname||'.'||dependent_view.relname as consumer,
       source_ns.nspname||'.'||source_table.relname as reads
from pg_depend d
join pg_rewrite r on r.oid = d.objid
join pg_class dependent_view on dependent_view.oid = r.ev_class
join pg_class source_table on source_table.oid = d.refobjid
join pg_namespace dependent_ns on dependent_ns.oid = dependent_view.relnamespace
join pg_namespace source_ns on source_ns.oid = source_table.relnamespace
where source_table.relname in ('customer_import','licensor_import','property_import')
  and dependent_view.relname <> source_table.relname
group by 1,2;
```

---

## 6. Recommended order of work

1. **Relocate `logo_url` + `status` off `plm.customer_import`** and repoint
   `api.crm_customer_list`. Smallest, fully-unblocked win; retires one staging table.
2. **Resolve the licensor→property hierarchy question** (§4 blocker 2) *before* writing any
   sync. If ColdLion cannot supply the tree, the decision is whether `core` keeps owning it
   as curated data — which is a business decision for Albert, not an engineering one.
3. **Only then** build the merch-group-derived licensor/property feed, keyed on
   `(division, mgTypeCode, mgCode)` — never on `mgCode` alone, per the `FR` collision.
4. `plm.licensor_import` / `plm.property_import` can then be dropped with no consumer work at
   all.

---

## Related documents

- [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) — endpoint map, auth, known outages
- [`coldlion-direct-sync-and-taxonomy-plan.md`](coldlion-direct-sync-and-taxonomy-plan.md) — the taxonomy cutover plan
- [`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md) — `mgTypeCode` semantics, the `FR` collision
- [`app-migration-notes/coldlion-customers-vendors-20260715.md`](app-migration-notes/coldlion-customers-vendors-20260715.md) — how customer/vendor were cut over
- [`../fix_schema_for_api.md`](../fix_schema_for_api.md) — the 5-phase ERP mirror relocation
