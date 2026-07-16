# Coldlion customer dedupe + status model — review & PENDING decisions

> **STATUS: OPEN — nothing in this document has been implemented.** It records decisions taken
> and analysis done on 2026-07-16, and the questions that still block execution.
> **Delete each section marked `PENDING` once it is actually implemented**, and fold the
> permanent facts into
> [`app-migration-notes/coldlion-customers-vendors-20260715.md`](app-migration-notes/coldlion-customers-vendors-20260715.md).

Context: the Coldlion ERP import (2026-07-15) added 790 new canonical customers on top of the
139 that already existed from Directus + DesignFlow. This document covers (1) the planned
three-state status model and (2) the duplicate analysis between the pre-existing customers and
the Coldlion master.

---

## 1. PENDING — add a third status value: `potential`

**Decision (Albert, 2026-07-16):** the app-owned status column gets a **third** possible value
alongside Active and Inactive: **Potential**.

**Rule:** a Directus/DesignFlow customer that **cannot** be mapped to a `plm.erp_customer` row is
either **Potential** (a real prospect we haven't sold yet) or must be **Inactivated**. It must not
sit as plain "Active", because being in the ERP is what makes a customer genuinely active.

**Where it goes:** `core.customer.status`, which is the `app.entity_status` enum
(`active`, `inactive`, `archived`, `deleted`). Adding `potential` means extending that enum —
note the enum is shared with other `core` tables, so confirm blast radius before altering it, or
use a customer-specific enum/check constraint instead.

**This supersedes / must reconcile the existing status sprawl.** `core.customer` today carries
three overlapping fields, which is exactly the confusion this change should end:

| Field | Type | Current contents (2026-07-16) | Fate under the new model |
|---|---|---|---|
| `status` | `app.entity_status` enum | **all 929 = `active`** | **the survivor** — becomes Active / Inactive / Potential |
| `customer_status` | text | 823 null · 65 `POTENTIAL_CUSTOMER` · 40 `ACTIVE_CUSTOMER` · 1 `OTHER` | CRM leftover — migrate into `status`, then drop |
| `is_potential` | boolean | 848 false · 81 true | folds into `status = 'potential'`, then drop |

**Do not implement piecemeal.** Adding `potential` to `status` while `is_potential` and
`customer_status` still exist would make four fields meaning roughly the same thing. The
implementation must migrate all three into one and remove the losers, with app repos
(`popcrm-web`, `poppim-web`, `popdam3`) updated to read the survivor.

**Also still open (from the import):** the serving views (`api.crm_customer_list`,
`api.crm_account_list`) and the direct `core.factory` reads do **not** filter on `status` at all,
so today an Inactive/Potential row still appears in every app picker. The status model is
meaningless to users until that filter lands.

---

## 2. PENDING — duplicate review (Directus/DesignFlow vs `plm.erp_customer`)

**Decision (Albert, 2026-07-16):** all Directus and DesignFlow customers are to be compared
against `plm.erp_customer` and duplicates removed; anything uncertain comes to Albert.

### 2.1 The shape of the problem

| Bucket | Count |
|---|---:|
| Pre-existing customers (Directus/DesignFlow) **already** mapped to a Coldlion code | 12 |
| Pre-existing customers **not** mapped to Coldlion — the review set | **127** |
| ↳ of those: likely Coldlion twin, high name similarity (≥0.75) | 10 |
| ↳ of those: possible twin, needs human judgment (0.45–0.75) | 36 |
| ↳ of those: no plausible Coldlion counterpart (<0.45) | 81 |

> Note the 12 vs. the "44 matched" reported by the import run: only **12** of the import's matches
> were to genuinely pre-existing customers. The other **32** were Coldlion rows matching *other
> Coldlion rows* created earlier in the same run — see §2.3.

### 2.2 BLOCKING QUESTION — is one customer = one ERP code?

Everything else depends on this. The import assumed **one customer can own many Coldlion codes**
and merged by name, so 834 Coldlion refs now point at only **802** canonical customers.

Real examples of what that assumption produced:

| Canonical customer | Coldlion codes merged into it |
|---|---|
| GORDON BROTHER'S GROUP | GBG802, GBG803, GBG804, GBG805, GBG806, GBG807 (**6**) |
| JUST A DOLLAR | JAD010, JAD020, JAD030, JAD040, JUS572 (**5**) |
| ONCE UPON A CHILD | ONC001, ONC252, ONC397, ONC540 (**4**) |
| WAL-MART STORES INC | WAL010, WAL070 |
| TJ MAXX | NEW010, NEW349 |
| BARNES & NOBLE | BNB184, BNN001 |

If those codes are **separate stores/billing accounts that must stay separate customers**, the
merge is wrong and must be undone (each code gets its own canonical row). If they are **one
customer with several ERP accounts**, the merge is correct as-is. **Albert must answer this before
any further dedupe.**

### 2.3 Defects found in the import (regardless of the answer above)

1. **Apostrophe split — a real duplicate we created.** Exact-name matching treated these as
   different companies:
   - `GORDON BROTHER'S GROUP` (codes GBG802–807)
   - `GORDON BROTHERS GROUP` (codes GBG800, GBG801)
   - plus a pre-existing Directus row `Gordon Brothers` (sim 0.76 → GBG800)

   Almost certainly **one company split across three canonical rows**.
2. **ERP junk promoted as a live customer.** Coldlion codes `DOL060` and `OUA115` are both named
   **"DO NOT USE"** — they merged into one canonical customer literally named *DO NOT USE*, active
   and visible to every app. Should be inactivated/excluded outright.
3. **Duplicates among the pre-existing rows themselves** (a Directus row and a DesignFlow row that
   are the same company, neither mapped to Coldlion):
   - `Dollarama L.P.` (Directus) + `Dollarama` (DesignFlow) → both are Coldlion `DOL580`
   - `Burlington Stores, Inc.` (Directus) + `Burlington` (DesignFlow) → both are Coldlion `MOD010`

### 2.4 Name similarity is unreliable in BOTH directions — do not auto-merge

**False positives** (high score, definitely NOT the same company):

| Our record | Best Coldlion "match" | Score |
|---|---|---:|
| Michael's | MICHAEL S ROTOLO | 0.59 |
| Boscov's Department Store, LLC | BOLO'S DEPARTMENT STORE | 0.63 |
| Ross Stores | P&P STORES | 0.50 |
| Dollar Tree | A DOLLAR | 0.50 |
| MAC Wholesale | MEGA WHOLESALE | 0.61 |
| Beacon Products Inc | GNI PRODUCTS INC. | 0.54 |
| Fiesta Mart, Inc. | D MART INC | 0.50 |
| C&S Wholesale Grocers | SJL WHOLESALE GROUP | 0.50 |
| Petra Industries | HMS INDUSTRIES INC | 0.48 |
| Sunrise Records | RECORDS SURPLUS | 0.45 |
| DII Enterprises LLC | JAX ENTERPRISES | 0.50 |
| Variety Stores, Inc. | EXCELLENT VARIETY STORE INC | 0.57 |

**False negatives** (low score, obviously the same company) — proof a score threshold alone
cannot drive this:

| Our record | Coldlion | Score |
|---|---|---:|
| Bed Bath | BED BATH & BEYOND | 0.62 |
| Homegoods | HOME GOODS | 0.62 |
| BoxLunch | BOX LUNCH | 0.58 |
| Spencer's | SPENCER GIFTS | 0.53 |
| Shoppers World | SW GROUP-SHOPPERS WORLD | 0.65 |

### 2.5 BUSINESS CALL — same brand, different entity

These are the same *brand* but plausibly separate ERP customers (different country, channel, or
banner). Merging them would be wrong if they are billed separately. **Albert to decide, per row:**

| Our record | Coldlion candidate | The question |
|---|---|---|
| Target | TARGET.COM (`TAR020`) | store vs. dot-com — one customer or two? |
| Nordstrom | NORDSTROM RACK (`NOR020`) | separate banner? |
| Amazon | Amazon 3P (`UCI`), AMAZON.COM.INDC LLCQ (`AMA030`,`AMA3P`) | 1P vs 3P |
| Big Lots | BIG LOTS CANADA INC (`BIG225`) | US vs Canada |
| Dollar Tree Stores | DOLLAR TREE STORES INC CAN (`DOL200`) | US vs Canada |
| TJX | TJX UK (`TKM300`) | US vs UK |

### 2.6 Likely-good merges (still confirm before executing)

`Dollarama L.P.`→`DOL580` (1.00) · `Diamond Comic Distributors, Inc`→`DCD101` ·
`Nebraska Furniture Mart`→`NFM020` · `Ollie's Bargain Outlet`→`OLL629` ·
`Regent Products Corp.`→`REG899` · `Four Seasons General Merchandise`→`FSG090` ·
`Citi Trends`→`ALL020` · `Hobby Lobby`→`HLL770` · `Kirkland's`→`KIR500` ·
`Toys"R"Us`→`TOY100` · `Zulily`→`ZUL308` · `Kroger`→`KROG001` · `Lidl`→`LIDL` ·
`Danawares`→`DAN001` · `Cook Brothers Corp`→`COO174` · `Giant Tiger`→`GAI222` ·
plus the §2.4 false-negatives (Bed Bath, Homegoods, BoxLunch, Spencer's, Shoppers World).

### 2.7 The 81 with no Coldlion counterpart

Per the §1 rule these become **Potential** or **Inactive** — they are not ERP customers. Albert to
decide the default (recommend: Potential, since they came from CRM/PM where they were tracked as
real prospects; then inactivate the dead ones).

### 2.8 Merging is destructive — plan required

`core.customer.id` is referenced by CRM opportunities/contacts, `plm.style_tracker_item_bridge`,
and PM records. A merge = repoint every FK to the surviving id, move the source refs, then delete
the loser. Some FKs are `ON DELETE SET NULL`, so a careless merge **silently nulls links instead
of erroring**. Any merge must: snapshot the affected tables first, repoint by `source_id`, and
assert zero orphaned rows before and after.

---

## 3. Reproduce the analysis

```sql
-- the 127 unmapped pre-existing customers + their best Coldlion candidate
with pre as (
  select c.id, c.name,
    (select string_agg(distinct r.source_system,'+' order by r.source_system)
       from core.company_source_ref r where r.company_id=c.id) as sources
  from core.customer c
  where exists (select 1 from core.company_source_ref r where r.company_id=c.id and r.source_system<>'coldlion')
    and not exists (select 1 from core.company_source_ref r where r.company_id=c.id and r.source_system='coldlion')
)
select p.name, p.sources, e.customer_code, e.cl_name, round(e.s::numeric,2) as sim
from pre p cross join lateral (
  select ec.customer_code, ec.name as cl_name, similarity(lower(p.name), lower(ec.name)) as s
  from plm.erp_customer ec
  order by similarity(lower(p.name), lower(ec.name)) desc, ec.customer_code limit 1) e
order by e.s desc;

-- canonical rows holding more than one Coldlion code
select c.name, string_agg(r.source_id, ', ' order by r.source_id), count(*)
from core.company_source_ref r join core.customer c on c.id=r.company_id
where r.source_system='coldlion' group by c.id, c.name having count(*)>1 order by 3 desc;
```
