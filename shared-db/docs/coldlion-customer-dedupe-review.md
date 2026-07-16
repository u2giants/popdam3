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

### 2.5 DECISION LOG — Albert, 2026-07-16

Rulings given. **None are implemented yet.** "Merge" = collapse into one canonical customer;
"separate" = keep distinct canonical rows even though the brand is shared.

| # | Records | Ruling | Final status |
|---|---|---|---|
| 1 | Gordon Brothers: `GORDON BROTHER'S GROUP` (GBG802–807) = `GORDON BROTHERS GROUP` (GBG800–801) = Directus `Gordon Brothers` | **Merge all** | **Inactive** |
| 2 | JUST A DOLLAR (JAD010/020/030/040, JUS572) | — | **Inactive** |
| 3 | ONCE UPON A CHILD (ONC001/252/397/540) | — | **Inactive** |
| 4 | Walmart `WAL010` (bricks & mortar) | keep | **Active** |
| 5 | Walmart `WAL060` (WAL-MART.COM = 1P e-com), `WAL080` (WALMART SELLER CENTER = 3P e-com) | keep separate from WAL010 | **Inactive** (still needed in the ERP) |
| 6 | Target `TAR010` (bricks & mortar) vs `TAR020` (TARGET.COM) | **keep separate** | **both Inactive** |
| 7 | Nordstrom (Directus) + `NOR020` NORDSTROM RACK | **merge** | **Inactive** |
| 8 | Big Lots (US) vs `BIG225` BIG LOTS CANADA | **separate** | Big Lots US **Active**; Canada **Inactive** |
| 9 | TJX vs `TKM300` TJX UK | **separate** | TJX **Active**; TJX UK **Inactive** |
| 10 | TJX Canada — "sometimes Winners, sometimes HomeSense" | **consolidate all under one customer named `TJX Canada`** | **Active** |
| 11 | Amazon 1P vs Amazon 3P | **separate** | 1P **Active**; 3P **Inactive** |
| 12 | `Dollarama L.P.` (Directus) + `Dollarama` (DesignFlow) + `DOL580` | **merge** | name → **`Dollarama`** |
| 13 | `Burlington Stores, Inc.` (Directus) + `Burlington` (DesignFlow) + `MOD010/MOD011` | **merge**. Legacy alias **Modecraft** (hence the `MOD` codes) | name → **`Burlington`** |
| 14 | `Michael's` vs `MICHAEL S ROTOLO` | **different companies** | **both Inactive** |
| 15 | `Fiesta Mart` vs `D MART INC` | **different companies** | **both Inactive** |
| 16 | `Ross Stores` (aka Ross Dress for Less / Ross) vs `P&P STORES` | **different companies** | Ross **Active**; P&P **Inactive** |
| 17 | `Bed Bath` + `BED010` BED BATH & BEYOND | **merge** | **Inactive** |
| 18 | `Homegoods` + `HOM020` HOME GOODS | **merge** | name → **`Homegoods`** · status **not stated — open** |

**Schema implication raised by #10 and #13:** customers need **aliases** (TJX Canada ⇄ Winners ⇄
HomeSense; Burlington ⇄ Modecraft). `core.customer.routing_aliases` (text) exists today for CRM
email routing but is not a real alias model. A `core.customer_alias` junction table
(`customer_id`, `alias`, `alias_type`, `source`) is the likely answer — decide before implementing
the merges, since merges destroy the losing names and the aliases are how we keep them findable.

**Gordon Brothers — business context (record for posterity):** they buy out bankrupt retailers and
run going-out-of-business sales, taking a **new ERP code per order** with different shipping and
store lists per retailer. That is why 8+ codes share the name. They are not a CRM/PLM/PM-relevant
account, so the representation barely matters — the requirement is only that they end up Inactive.

### 2.6 CORRECTION — the earlier "best match" list was misleading (top-1 only)

The first pass reported only the **single** highest-scoring Coldlion candidate per record. Where
scores tied or were close, that silently hid the right answer. Confirmed wrong calls from that pass:

| Our record | What pass 1 reported | The actual match |
|---|---|---|
| Ross Stores | `PPS006` P&P STORES (0.50) | **`ROS010` ROSS STORES INC SUPPLIERS** |
| Big Lots | `BIG225` BIG LOTS **CANADA** (0.45) | **`BIG226` BIG LOTS STORES INC** (Columbus OH, US) |
| Dollar Tree Stores | `DOL200` DOLLAR TREE STORES INC **CAN** (0.70) | **`DTM500` DOLLAR TREE MERCHANDISING** (Chesapeake VA, US) |

**Any re-run must report top-N candidates (N≥3) with country/city, not top-1.** Name similarity
alone also cannot see that `HOM020 HOME GOODS` and `MAR020 MARSHALLS` are both Framingham MA —
i.e. TJX entities. Address is a stronger signal than the name for this data set.

### 2.7 STILL NEEDS CLARIFICATION (blocking)

**Loose ends inside the families decided in §2.5:**

| # | Item | Question |
|---|---|---|
| A | `WAL070` — a **second** row named `WAL-MART STORES INC`, identical name/address to `WAL010` | You named WAL010/060/080 but not this. What is it? Currently merged into WAL010. |
| B | `WAL020` WAL-MART CANADA | Active or inactive? (Country is not a consistent rule for you: Big Lots Canada → inactive, but TJX Canada → active.) |
| C | `TAR081` TARGET S.A (**Panama**) | Not covered by the Target ruling. Status? |
| D | Which row **is** "TJX"? | No Coldlion row is named TJX. Candidates: `NEW010`+`NEW349` TJ MAXX, `MAR020` MARSHALLS. Is "TJX Active" = TJ Maxx only, or the whole US group? |
| E | `NEW010` vs `NEW349` | Two identical `TJ MAXX` rows (both Framingham MA), currently merged. One customer? |
| F | `MAR020` MARSHALLS (Framingham MA) | Part of the active TJX, or its own customer? |
| G | TJX Canada members | I find `WIN030` WINNERS DISTRIBUTION CENTER, `HOM030` Winners Merchants International LP, `CMA030` CM/MARSHALLS DISTRIBUTION — all Mississauga ON. **There is no "HomeSense" row.** Is Marshalls Canada (`CMA030`) part of TJX Canada too? |
| H | `HOM020` HOME GOODS | Merge into `Homegoods` per §2.5 #18, but **active or inactive not stated**. Note its address is Framingham MA = TJX HQ, so it may belong to the TJX question. |
| I | Dollar Tree | `DTM500` (US), `DOL800` DOLLAR TREE MERCHANDISING C (Burnaby BC), `DOL200` DOLLAR TREE STORES INC CAN (Burnaby BC). US active? Both Canada rows one customer, inactive? |
| J | Big Lots | `BIG226` BIG LOTS STORES INC (US) is the active one — but `WIS030` has the **same name**, is flagged inactive in Coldlion, and was never promoted. Confirm BIG226 is "Big Lots". |
| K | `MOD010` vs `MOD011` | Two identical BURLINGTON STORES rows. One customer? Status not stated. |

**CRITICAL — a merge already made that contradicts a ruling:**
`AMA030` and `AMA3P` are **both named `AMAZON.COM.INDC LLCQ`**, so the import merged them into a
single canonical customer. The code `AMA3P` plainly means 3P. Ruling #11 requires 1P **Active** and
3P **Inactive** — **impossible while they are one row.** This merge must be undone. There is also a
third row, `UCI` named `Amazon 3P`. Proposed: `AMA030` = 1P (Active); `AMA3P` + `UCI` = 3P (Inactive)
— **confirm**.

**The other 14 multi-code groups from §2.2, still unruled:** Barnes & Noble (BNB184, BNN001) ·
BOB BAY & SON (BBS050, BOB121) · CLOSE OUT CENTER (CLO006/007) · DOLLAR VILLAGE (DOL012, DOLL012) ·
DUAV CHILDRENS WEAR (DUA003/005) · HUDSON GROUP (HUD300, HUD500) · III NYC 99 (III099, III570) ·
MINIMAX STORES (MIN006/007) · NEBRASKA FURNITURE MART (NFM020, NFM345) · NEXUS (NEX118, NEX203) ·
OFFICE 1 SUPERSTORES (OFF010, PRE900) · TOYS 4 U (TOY001, TOY232) · WEST END EXPRESS (WEE001, WES285) ·
P&P STORES (PPS006/007 — inactive per #16, but confirm the two codes are one customer).

**And the 81 with no Coldlion counterpart** (§2.9) — default to Potential, or inactivate?

### 2.8 Likely-good merges (still confirm before executing)

`Dollarama L.P.`→`DOL580` (1.00) · `Diamond Comic Distributors, Inc`→`DCD101` ·
`Nebraska Furniture Mart`→`NFM020` · `Ollie's Bargain Outlet`→`OLL629` ·
`Regent Products Corp.`→`REG899` · `Four Seasons General Merchandise`→`FSG090` ·
`Citi Trends`→`ALL020` · `Hobby Lobby`→`HLL770` · `Kirkland's`→`KIR500` ·
`Toys"R"Us`→`TOY100` · `Zulily`→`ZUL308` · `Kroger`→`KROG001` · `Lidl`→`LIDL` ·
`Danawares`→`DAN001` · `Cook Brothers Corp`→`COO174` · `Giant Tiger`→`GAI222` ·
plus the §2.4 false-negatives (Bed Bath, Homegoods, BoxLunch, Spencer's, Shoppers World).

### 2.9 The 81 with no Coldlion counterpart

Per the §1 rule these become **Potential** or **Inactive** — they are not ERP customers. Albert to
decide the default (recommend: Potential, since they came from CRM/PM where they were tracked as
real prospects; then inactivate the dead ones).

### 2.10 Merging is destructive — plan required

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
