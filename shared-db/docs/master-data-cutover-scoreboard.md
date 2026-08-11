# Master-data cutover scoreboard — which entities are on ColdLion, which are still on DesignFlow

**Purpose.** Answer, in one place, the question every AI session keeps re-deriving from
scratch: *for a given master-data entity, has it been cut over to direct ColdLion ERP, or is
it still fed by the DesignFlow PLM API?* Every fact below was previously discoverable, but
only by reading four separate documents and then querying the database. That cost has been
paid at least twice; this page ends it.

Production rows below were verified against `qsllyeztdwjgirsysgai` on **2026-07-23**; Customer
and Vendor counts refreshed against a live read on **2026-07-31** (see the note under the
scoreboard table — the 929/529 canonical counts below were stale and have been corrected).

> ### ✅ Re-verified read-only against production `qsllyeztdwjgirsysgai` — 2026-08-11 (#533)
>
> **Why this note exists.** [PR #337](https://github.com/u2giants/shared-db/pull/337) merged
> live row counts into this page from a session that never recorded **which Supabase project it
> read**. Issue #533 asked for one of two outcomes: re-verify the numbers read-only, or mark
> them untrusted. They have now been **re-verified**, and the project is named.
>
> **Method.** Supabase MCP, bound to production (`get_project_url` returned
> `https://qsllyeztdwjgirsysgai.supabase.co` — stated before the first query). `SELECT` only.
> No write of any kind, in any project.
>
> **Every count in §2 and §3 below re-measured identical on 2026-08-11:**
> `plm.erp_customer` 836 · `core.customer` 862 · `plm.erp_vendor` 97 · `core.factory` 93 ·
> `core.licensor` 26 · `core.property` 256 · `plm.customer_import` 54 ·
> `plm.licensor_import` 37 · `plm.property_import` 468. The mapping-identity proof also holds
> exactly: `core.taxonomy_source_ref` is **37 refs → 20 licensor entities** and
> **468 refs → 256 property entities**, all 505 `source_system = 'designflow_plm'` and
> **zero `coldlion`** — production is still on DesignFlow, as claimed.
>
> **Three things this page had wrong, corrected inline below:**
>
> 1. **`plm.erp_licensor` and `plm.erp_property` are NOT preview-only any more.** Both tables
>    **exist in production** today and both hold **0 rows**. The empty-table state — not the
>    table's absence — is now what proves production has not cut over. Do not read "the table
>    exists" as "the cutover happened"; check the row count and
>    `core.taxonomy_source_ref.source_system`.
> 2. **`core.licensor` is 26 rows in production, not 20.** The 20 in §3 is the count of
>    *distinct canonical licensors reachable through `core.taxonomy_source_ref`*, which is a
>    different measure. Six canonical licensors carry no DesignFlow source ref. §3's heading has
>    been reworded so the two numbers stop looking like a contradiction.
> 3. **`plm.customer_import` last imported 2026-07-08, not 2026-07-17.** The freshness table
>    below has been corrected. It shares its import timestamp with the two other
>    `*_import` tables, all written by the same 2026-07-08 `plm.import_master_data()` run.
>
> The `plm.erp_customer` (2026-07-17) and `plm.erp_vendor` (2026-07-22) freshness dates were
> confirmed correct and are **unchanged since this page was written — those two ColdLion feeds
> have not run in three weeks.**

> **Licensor/Property correction — 2026-07-26:** direct ColdLion mirrors now exist on preview
> `rjyboqwcdzcocqgmsyel`: `plm.erp_licensor` (44) and `plm.erp_property` (516), with 542
> Albert-approved source links proven against 271 canonical UUIDs. Production remains on
> DesignFlow until the invariant-readiness plan passes and Albert explicitly approves the bounded
> production window. The former 14-day wait is retired. Read
> [`plan_coldlion_licensor_property_accelerated_cutover.md`](../plan_coldlion_licensor_property_accelerated_cutover.md)
> before re-deriving the current state.
>
> **Status as of 2026-07-31:** Steps 1–7 of the accelerated plan are complete on preview.
> Step 7A (the recurring production feed/monitoring lane) is **built and CI-green** in
> [PR #331](https://github.com/u2giants/shared-db/pull/331), which is still **open and
> unmerged** — that merge is the one concrete task left before Step 8 (Albert's explicit
> production-window approval) can even be requested. Nothing else is technically blocking;
> ColdLion does not supply the licensor→property relationship or active/inactive status, so
> per §6 those two facts are being kept as permanently curated Supabase data either way — the
> cutover only changes where the names/codes come from, not the relationship data.

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

**Historical note:** before Phase 1, the absence of `plm.erp_licensor` /
`plm.erp_property` correctly showed that groundwork had not begun. Those tables now exist on
preview; their presence does not mean production has cut over.

> ⚠️ **Do not mistake `plm.licensor_import` / `plm.property_import` for a ColdLion mirror.**
> They are DesignFlow PLM staging. A previous AI session made exactly this error, reasoning
> that because `37 + 468 = 505` matches `core.taxonomy_source_ref` exactly, those tables must
> be the mirror. The matching count proves the opposite: all 505 taxonomy source refs are
> `source_system = 'designflow_plm'`, which is precisely what "not cut over" looks like.

---

## 2. The scoreboard

| Entity | Status | Live source | Staging / mirror table | Rows | Canonical table | Rows |
|---|---|---|---|---|---|---|
| **Customer** | ✅ **Cut over to ColdLion** | ColdLion `/customers` | `plm.erp_customer` | 836 | `core.customer` | 862 |
| **Vendor / factory** | ✅ **Cut over to ColdLion** | ColdLion `/vendors` | `plm.erp_vendor` | 97 | `core.factory` | 93 |
| **Licensor** | ⏳ **Production DesignFlow; preview ColdLion readiness** | DesignFlow PLM API in production | `plm.erp_licensor` — **prod 0**, preview 44 | 0 / 44 | `core.licensor` (prod) | 26 |
| **Property** | ⏳ **Production DesignFlow; preview ColdLion readiness** | DesignFlow PLM API in production | `plm.erp_property` — **prod 0**, preview 516 | 0 / 516 | `core.property` (prod) | 256 |

The historical production baseline was **505 / 505 `designflow_plm`**, zero ColdLion. A live
re-check on 2026-07-31 confirmed production is unchanged: still 505/505 `designflow_plm`, zero
`coldlion`. Preview separately has 505 DesignFlow plus 542 approved ColdLion source refs. Before
claiming production cutover, re-measure production read-only and run the accelerated plan's
exact mapping-identity proof:

```sql
select source_system, count(*) from core.taxonomy_source_ref group by 1;
```

### Freshness (last import)

| Table | Last imported |
|---|---|
| ColdLion `/customers` → `plm.erp_customer` | 2026-07-17 (14 days stale as of this doc's 2026-07-31 refresh) |
| ColdLion `/vendors` → `plm.erp_vendor` | 2026-07-22 (9 days stale as of this doc's 2026-07-31 refresh) |
| `plm.customer_import` (legacy) | 2026-07-08 (corrected 2026-08-11, #533 — the page said 2026-07-17) |
| `plm.licensor_import` | 2026-07-08 |
| `plm.property_import` | 2026-07-08 |

---

## 3. Why 37 licensor source refs collapse to 20 canonical licensors — this is correct

> **Read the two numbers carefully (clarified 2026-08-11, #533).** `core.licensor` holds **26**
> rows in production. The **20** below is a different measure: the number of *distinct canonical
> licensors that a DesignFlow source ref points at*. Six canonical licensors have no DesignFlow
> source ref at all, which is why 26 ≠ 20. This heading previously read "`core.licensor` = 20",
> which made a correct table look like a broken one.

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
