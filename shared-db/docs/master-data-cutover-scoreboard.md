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
`core.licensor` / `core.property` already model.** **The data is fully available. Only the
parent-child relationship is missing.** Verified against the live ColdLion Swagger spec
(`/EhpApi/v2/api-docs`) and live API responses on 2026-07-23.

> ⚠️ **Correction — do not repeat this error.** An earlier version of this page claimed
> "there is no ColdLion licensor or property endpoint," implying the data was unavailable.
> **That was wrong, and it overstated the blocker.** There is no *dedicated* `/licensors`
> path, but licensor and property are fully served by `/merchGroupDetails` in exactly the
> shape a sync needs. The cutover is **not** blocked on data access.

**What ColdLion DOES supply** (live, verified):

| Entity | Endpoint | Live count (CW001) | Ours |
|---|---|---|---|
| Licensor | `/merchGroupDetails?companyCode=EDGEHOME&divisionCode=CW001&mgTypeCode=05` | **22** | 20 |
| Property | `/merchGroupDetails?companyCode=EDGEHOME&divisionCode=CW001&mgTypeCode=06` | **258** | 256 |

Returns a plain array (not a paged envelope). Fields: `createdTime`, `createdUser`, `modTime`,
`modUser`, `companyCode`, `divisionCode`, `mgTypeCode`, `mgCode`, `mgDesc`, `itemNoCode`,
`mgCategory`, `mgCode2`. Live samples — licensor `1P` = "TOEI - ONE PIECE", `CB` = "CARE
BEARS"; property `55` = "SHREK 5", `75` = "PEANUTS 75TH ANNIVERSARY".

`mgTypeCode` meaning is **per-division** and must be read from `/merchGroupHeaders`, never
hardcoded. In `CW001` and `SP001`, `05` = Licensor and `06` = Property — but in `EH001` the
same codes are "Big Theme"/"Little Theme", and in `EP001` "Product Line"/"Product Type".

**The one real blocker:**

1. **ColdLion has no licensor→property relationship.** Confirmed by field inspection: a
   property row carries no licensor reference of any kind, and `mgCategory` is empty on every
   row sampled. `core.property` has a strict `licensor_id` FK into `core.licensor` that 11
   foreign keys and 6 views depend on. **DesignFlow (dflow) is the only place the
   licensor→property parent-child relationship exists.**

   This does **not** block the cutover — see the sequencing decision in §6. Point the tables
   at ColdLion first, then carry the relationship over from dflow as a separate step.

**Two traps for whoever builds the sync:**

- **Codes collide across entity types *within the same division*.** Live proof in CW001:
  `mgCode = "1P"` is **both** a licensor (TOEI - ONE PIECE) *and* a property (ONE PIECE
  GENERAL ART). The previously documented `FR` case is the same class of problem. Keys must
  be `(divisionCode, mgTypeCode, mgCode)` — **never `mgCode` alone**.
- **No active/inactive flag** exists anywhere in the merch-group payload, so the active-only
  promotion rule used for customers and vendors has no equivalent input here.

**Sizing note.** 22 vs 20 and 258 vs 256 is a near-match, and that is a trap rather than a
comfort: two taxonomies that are ~99 % identical are harder to reconcile safely than two that
are obviously different, because the handful of genuine mismatches hide in the noise.

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

**Sequencing decision (Albert, 2026-07-23): point at the new tables first, migrate the
relationships afterwards.** The licensor→property tree does not gate the cutover — it is a
second, separable step sourced from dflow. Do not hold the sync hostage to it.

1. **Build `plm.erp_licensor` / `plm.erp_property`** from `/merchGroupDetails`, keyed on
   `(divisionCode, mgTypeCode, mgCode)`. Read `mgTypeCode` semantics from
   `/merchGroupHeaders` per division — never hardcode `05`/`06`, they mean different things
   in `EH001` and `EP001`. This follows the proven `plm.erp_customer` / `plm.erp_vendor`
   pattern exactly, so it is a known shape, not new design.
2. **Repoint `core.licensor` / `core.property` promotion at the new `erp_*` mirrors,** adding
   `source_system = 'coldlion'` rows to `core.taxonomy_source_ref` alongside the existing
   `designflow_plm` ones. Keep `licensor_id` populated as-is during this step — do not clear
   it, do not enforce it from ColdLion.
3. **Migrate the licensor→property relationship from dflow** as its own change, since dflow is
   the sole source of it. Decide at that point whether `core` owns the tree as curated data
   permanently (likely, given ColdLion will not supply it).
4. **Then drop `plm.licensor_import` / `plm.property_import`** — zero consumers, no
   downstream work required.

Independently and in parallel: **relocate `logo_url` + `status` off `plm.customer_import`**
and repoint `api.crm_customer_list`. Smallest fully-unblocked win in this whole area; retires
a third staging table and depends on none of the above.

---

## Related documents

- [`coldlion-erp-api-reference.md`](coldlion-erp-api-reference.md) — endpoint map, auth, known outages
- [`coldlion-direct-sync-and-taxonomy-plan.md`](coldlion-direct-sync-and-taxonomy-plan.md) — the taxonomy cutover plan
- [`merch-group-taxonomy-architecture.md`](merch-group-taxonomy-architecture.md) — `mgTypeCode` semantics, the `FR` collision
- [`app-migration-notes/coldlion-customers-vendors-20260715.md`](app-migration-notes/coldlion-customers-vendors-20260715.md) — how customer/vendor were cut over
- [`../fix_schema_for_api.md`](../fix_schema_for_api.md) — the 5-phase ERP mirror relocation
