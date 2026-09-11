# Coldlion customer dedupe + status model — review & PENDING decisions

> **Customer codes are scrubbed (2026-09-02, issue #2103).** Every ColdLion customer/vendor master
> code below is a synthetic placeholder (`CUSTnnn`), used consistently across the
> ColdLion docs, and some ERP legal names and addresses are generalised. The real codes, ERP legal
> names and addresses live in the ColdLion question register, not in this public repository.

> **STATUS: PARTIALLY IMPLEMENTED (2026-07-17).** Schema + the reversible bulk are DONE;
> the destructive per-row merges/deletes are the remaining step (§3 below). Delete each
> section once its work lands, and fold permanent facts into
> [`app-migration-notes/coldlion-customers-vendors-20260715.md`](app-migration-notes/coldlion-customers-vendors-20260715.md).
>
> **DONE 2026-07-17:**
> - Re-pulled Coldlion customers — they reclassified hard: **153 active / 683 inactive** now
>   (was 834 active at first import).
> - `app.entity_status` gained **`potential`** (migration 20260717122237).
> - `core.customer` gained **`display_name`**; unused **`legal_name` dropped**; `normalized_name`
>   rebuilt from `name` alone (20260717122317).
> - `core.customer_alias` table (20260716143231) + **`core.merge_customer(loser,survivor)`**
>   (20260717123020), rehearsed.
> - **Status seeded from fresh Coldlion flags:** a Coldlion-mapped customer is active iff ≥1 of
>   its codes is still active. Result: **271 active / 658 inactive** (was 929 active). This is the
>   big dropdown reduction. Reversible.
>
> **DONE 2026-07-17 (part 2 — the destructive pass, §4 rulings applied):**
> - `core.merge_customer` fixed for the CRM department/company consistency triggers (20260717125626).
> - Applied all §4 rulings: **51 merges + 92 status sets + 3 deletes** (West End Express, New
>   Development, DO NOT USE), plus the Amazon 1P/3P split and the duplicate-TJX collapse. Merges
>   preserved every losing name as a `core.customer_alias` (73 aliases).
> - `is_potential` synced to `status='potential'`.
> - Autocomplete indexes added for customer `display_name` + factory `name` (20260717124807);
>   `display_name` exposed in `api.crm_customer_list` / `api.crm_account_list` (20260717125909).
>
> **Final customer counts:** 929 → **859** total — **140 active · 12 potential · 707 inactive**.
>
> **STILL OPEN:**
> - **Hiding inactive from app pickers is a FRONTEND change** (per-app: popcrm-web, poppim-web,
>   popdam3, dflow). The DB now supports it — views expose `status` + `display_name`, and there are
>   trigram indexes for type-ahead. Each app's customer + vendor picker must filter `status='active'`
>   (or active+potential) and search server-side.
> - **Dollarama** landed **inactive** (from the fresh Coldlion flag; no explicit ruling given) —
>   confirm if it should be active.
> - **Vendors (`core.factory`)** were NOT part of this dedup/status pass — still 529 rows, mostly
>   Coldlion-active-seeded. A vendor review + display_name pass is future work.
> - Collapse `customer_status` + `is_potential` into `status` and drop them (needs the app repos).

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
| GORDON BROTHER'S GROUP | CUST041, CUST042, CUST043, CUST044, CUST045, CUST046 (**6**) |
| JUST A DOLLAR | CUST059, CUST060, CUST061, CUST062, CUST064 (**5**) |
| ONCE UPON A CHILD | CUST087, CUST088, CUST089, CUST090 (**4**) |
| WAL-MART STORES INC | CUST108, CUST111 |
| TJ MAXX | CUST078, CUST079 |
| BARNES & NOBLE | CUST012, CUST013 |

If those codes are **separate stores/billing accounts that must stay separate customers**, the
merge is wrong and must be undone (each code gets its own canonical row). If they are **one
customer with several ERP accounts**, the merge is correct as-is. **Albert must answer this before
any further dedupe.**

### 2.3 Defects found in the import (regardless of the answer above)

1. **Apostrophe split — a real duplicate we created.** Exact-name matching treated these as
   different companies:
   - `GORDON BROTHER'S GROUP` (codes CUST041–CUST046)
   - `GORDON BROTHERS GROUP` (codes CUST039, CUST040)
   - plus a pre-existing Directus row `Gordon Brothers` (sim 0.76 → CUST039)

   Almost certainly **one company split across three canonical rows**.
2. **ERP junk promoted as a live customer.** Coldlion codes `CUST025` and `CUST091` are both named
   **"DO NOT USE"** — they merged into one canonical customer literally named *DO NOT USE*, active
   and visible to every app. Should be inactivated/excluded outright.
3. **Duplicates among the pre-existing rows themselves** (a Directus row and a DesignFlow row that
   are the same company, neither mapped to Coldlion):
   - `Dollarama L.P.` (Directus) + `Dollarama` (DesignFlow) → both are Coldlion `CUST027`
   - `Burlington Stores, Inc.` (Directus) + `Burlington` (DesignFlow) → both are Coldlion `CUST076`

### 2.4 Name similarity is unreliable in BOTH directions — do not auto-merge

**False positives** (high score, definitely NOT the same company):

| Our record | Best Coldlion "match" | Score |
|---|---|---:|
| Michael's | unrelated ERP record (a personal name) | 0.59 |
| Boscov's Department Store, LLC | unrelated ERP record `CUST015` | 0.63 |
| Ross Stores | unrelated ERP record `CUST092` | 0.50 |
| Dollar Tree | unrelated ERP record (generic "dollar" name) | 0.50 |
| MAC Wholesale | unrelated ERP record `CUST072` | 0.61 |
| Beacon Products Inc | unrelated ERP record `CUST048` | 0.54 |
| Fiesta Mart, Inc. | unrelated ERP record (generic "mart" name) | 0.50 |
| C&S Wholesale Grocers | unrelated ERP record `CUST097` | 0.50 |
| Petra Industries | unrelated ERP record `CUST050` | 0.48 |
| Sunrise Records | unrelated ERP record `CUST094` | 0.45 |
| DII Enterprises LLC | unrelated ERP record `CUST063` | 0.50 |
| Variety Stores, Inc. | unrelated ERP record `CUST035` | 0.57 |

**False negatives** (low score, obviously the same company) — proof a score threshold alone
cannot drive this:

| Our record | Coldlion | Score |
|---|---|---:|
| Bed Bath | ERP spelling of the same brand | 0.62 |
| Homegoods | ERP spelling of the same brand | 0.62 |
| BoxLunch | ERP spelling of the same brand | 0.58 |
| Spencer's | ERP spelling of the same brand | 0.53 |
| Shoppers World | ERP spelling of the same brand | 0.65 |

### 2.5 DECISION LOG — Albert, 2026-07-16

Rulings given. **None are implemented yet.** "Merge" = collapse into one canonical customer;
"separate" = keep distinct canonical rows even though the brand is shared.

| # | Records | Ruling | Final status |
|---|---|---|---|
| 1 | Gordon Brothers: `GORDON BROTHER'S GROUP` (CUST041–CUST046) = `GORDON BROTHERS GROUP` (CUST039–CUST040) = Directus `Gordon Brothers` | **Merge all** | **Inactive** |
| 2 | JUST A DOLLAR (CUST059/CUST060/CUST061/CUST062, CUST064) | — | **Inactive** |
| 3 | ONCE UPON A CHILD (CUST087/CUST088/CUST089/CUST090) | — | **Inactive** |
| 4 | Walmart `CUST108` (bricks & mortar) | keep | **Active** |
| 5 | Walmart `CUST110` (1P e-com), `CUST112` (3P marketplace) | keep separate from CUST108 | **Inactive** (still needed in the ERP) |
| 6 | Target `CUST099` (bricks & mortar) vs `CUST100` (.com) | **keep separate** | **both Inactive** |
| 7 | Nordstrom (Directus) + `CUST084` NORDSTROM RACK | **merge** | **Inactive** |
| 8 | Big Lots (US) vs `CUST010` BIG LOTS CANADA | **separate** | Big Lots US **Active**; Canada **Inactive** |
| 9 | TJX vs `CUST102` TJX UK | **separate** | TJX **Active**; TJX UK **Inactive** |
| 10 | TJX Canada — "sometimes Winners, sometimes HomeSense" | **consolidate all under one customer named `TJX Canada`** | **Active** |
| 11 | Amazon 1P vs Amazon 3P | **separate** | 1P **Active**; 3P **Inactive** |
| 12 | `Dollarama L.P.` (Directus) + `Dollarama` (DesignFlow) + `CUST027` | **merge** | name → **`Dollarama`** |
| 13 | `Burlington Stores, Inc.` (Directus) + `Burlington` (DesignFlow) + `CUST076/CUST077` | **merge**. Legacy alias **Modecraft** (hence the `MOD` codes) | name → **`Burlington`** |
| 14 | `Michael's` vs the similarly-named unrelated ERP record | **different companies** | **both Inactive** |
| 15 | `Fiesta Mart` vs the similarly-named unrelated ERP record | **different companies** | **both Inactive** |
| 16 | `Ross Stores` (aka Ross Dress for Less / Ross) vs unrelated ERP record `CUST092` | **different companies** | Ross **Active**; the other record **Inactive** |
| 17 | `Bed Bath` + `CUST009` BED BATH & BEYOND | **merge** | **Inactive** |
| 18 | `Homegoods` + `CUST051` HOME GOODS | **merge** | name → **`Homegoods`** · status **not stated — open** |

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
| Ross Stores | `CUST092` (an unrelated store group, 0.50) | **`CUST096`** (the real Ross ERP record) |
| Big Lots | `CUST010` BIG LOTS **CANADA** (0.45) | **`CUST011` BIG LOTS STORES INC** (US) |
| Dollar Tree Stores | `CUST026` DOLLAR TREE STORES INC **CAN** (0.70) | **`CUST031` DOLLAR TREE MERCHANDISING** (US) |

**Any re-run must report top-N candidates (N≥3) with country/city, not top-1.** Name similarity
alone also cannot see that `CUST051 HOME GOODS` and `CUST071 MARSHALLS` share the TJX head-office address —
i.e. TJX entities. Address is a stronger signal than the name for this data set.

### 2.7 STILL NEEDS CLARIFICATION (blocking)

**Loose ends inside the families decided in §2.5:**

| # | Item | Question |
|---|---|---|
| A | `CUST111` — a **second** row carrying the same ERP legal name and address as `CUST108` | You named CUST108/CUST110/CUST112 but not this. What is it? Currently merged into CUST108. |
| B | `CUST109` WAL-MART CANADA | Active or inactive? (Country is not a consistent rule for you: Big Lots Canada → inactive, but TJX Canada → active.) |
| C | `CUST101` TARGET S.A (**Panama**) | Not covered by the Target ruling. Status? |
| D | Which row **is** "TJX"? | No Coldlion row is named TJX. Candidates: `CUST078`+`CUST079` TJ MAXX, `CUST071` MARSHALLS. Is "TJX Active" = TJ Maxx only, or the whole US group? |
| E | `CUST078` vs `CUST079` | Two identical `TJ MAXX` rows (both at the TJX head-office address), currently merged. One customer? |
| F | `CUST071` MARSHALLS (TJX head-office address) | Part of the active TJX, or its own customer? |
| G | TJX Canada members | I find `CUST115` and `CUST052` (two Winners entities) and `CUST018` (Marshalls Canada) — all at one Canadian address. **There is no "HomeSense" row.** Is Marshalls Canada (`CUST018`) part of TJX Canada too? |
| H | `CUST051` HOME GOODS | Merge into `Homegoods` per §2.5 #18, but **active or inactive not stated**. Note its address is the TJX head office, so it may belong to the TJX question. |
| I | Dollar Tree | `CUST031` (US), `CUST028` DOLLAR TREE MERCHANDISING C (Canada), `CUST026` DOLLAR TREE STORES INC CAN (Canada). US active? Both Canada rows one customer, inactive? |
| J | Big Lots | `CUST011` BIG LOTS STORES INC (US) is the active one — but `CUST116` has the **same name**, is flagged inactive in Coldlion, and was never promoted. Confirm CUST011 is "Big Lots". |
| K | `CUST076` vs `CUST077` | Two identical BURLINGTON STORES rows. One customer? Status not stated. |

**CRITICAL — a merge already made that contradicts a ruling:**
`CUST003` and `CUST004` **both carry the same ERP legal name**, so the import merged them into a
single canonical customer. The code `CUST004` plainly means 3P. Ruling #11 requires 1P **Active** and
3P **Inactive** — **impossible while they are one row.** This merge must be undone. There is also a
third row, `CUST107` named `Amazon 3P`. Proposed: `CUST003` = 1P (Active); `CUST004` + `CUST107` = 3P (Inactive)
— **confirm**.

**The other 14 multi-code groups from §2.2, still unruled:** Barnes & Noble (CUST012, CUST013) ·
BOB BAY & SON (CUST007, CUST014) · CLOSE OUT CENTER (CUST017, CUST120) · DOLLAR VILLAGE (CUST024, CUST030) ·
DUAV CHILDRENS WEAR (CUST032, CUST121) · HUDSON GROUP (CUST054, CUST055) · III NYC 99 (CUST056, CUST057) ·
MINIMAX STORES (CUST075, CUST122) · NEBRASKA FURNITURE MART (CUST082, CUST083) · NEXUS (CUST080, CUST081) ·
OFFICE 1 SUPERSTORES (CUST085, CUST093) · TOYS 4 U (CUST103, CUST105) · WEST END EXPRESS (CUST113, CUST114) ·
an unrelated store group (CUST092, CUST123 — inactive per #16, but confirm the two codes are one customer).

**And the 81 with no Coldlion counterpart** (§2.9) — default to Potential, or inactivate?

### 2.8 Likely-good merges (still confirm before executing)

`Dollarama L.P.`→`CUST027` (1.00) · `Diamond Comic Distributors, Inc`→`CUST021` ·
`Nebraska Furniture Mart`→`CUST082` · `Ollie's Bargain Outlet`→`CUST086` ·
`Regent Products Corp.`→`CUST095` · `Four Seasons General Merchandise`→`CUST036` ·
`Citi Trends`→`CUST002` · `Hobby Lobby`→`CUST049` · `Kirkland's`→`CUST065` ·
`Toys"R"Us`→`CUST104` · `Zulily`→`CUST117` · `Kroger`→`CUST067` · `Lidl`→`CUST068` ·
`Danawares`→`CUST020` · `Cook Brothers Corp`→`CUST019` · `Giant Tiger`→`CUST038` ·
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

---

## 4. FINAL RULINGS (Albert, 2026-07-17) — execution ledger for the REMAINING work

Status seeding (done) already set most rows to the right active/inactive from the fresh Coldlion
flags. What remains is the per-row **merges, deletes, display_names, and `potential` overrides**.
"Merge X→Y" = `core.merge_customer(X_id, Y_id)`; the loser's name is auto-kept as an alias.

### 4.1 Clarifications to the family rulings
- **Amazon (SPLIT, not merge):** `CUST003` + `CUST004` share one ERP legal name and were
  wrongly merged into ONE row. SPLIT: `CUST003` = Amazon 1P, display **"Amazon"**, **active**. Move
  `CUST004` + `CUST107` onto one **"Amazon 3P"** row, **inactive**. Directus/DesignFlow "Amazon" → 1P row.
- **Walmart:** `CUST108` B&M **active**, display "Walmart"; `CUST111` (dup) → merge into CUST108; `CUST110`
  (.com/1P), `CUST112` (seller/3P), `CUST109` (Canada) separate **inactive**; directus "Walmart" → CUST108.
- **Target:** `CUST099` B&M + `CUST100` .COM separate, **both inactive**; `CUST101` (Panama) diff co, **inactive**.
- **Nordstrom:** directus Nordstrom + `CUST084` Rack → **merge**, **inactive**.
- **Big Lots:** `CUST011` (US) **active**, display "Big Lots"; `CUST010` (Canada) **inactive**; `CUST116`
  (same name, Coldlion-inactive, unpromoted) = Big Lots, inactive.
- **TJX (US):** merge `CUST078`+`CUST079` (TJ Maxx) + `CUST071` (Marshalls) + directus "The TJX Companies,
  Inc." → **"TJX" active**; aliases TJ Maxx, Marshalls, The TJX Companies Inc.
- **TJX UK:** `CUST102` **inactive**; directus "Tjxeurope" → alias.
- **TJX Canada:** merge `CUST115` + `CUST052` + `CUST018` + directus "Tjxcanada" → **"TJX Canada" active**;
  aliases Winners, HomeSense, Marshalls Canada (no literal HomeSense row exists in Coldlion).
- **Dollarama:** merge `Dollarama L.P.` + `Dollarama` + `CUST027` → name **"Dollarama"**.
- **Burlington:** merge `Burlington Stores, Inc.` + `Burlington` + `CUST076` + `CUST077` → name
  **"Burlington"**, **active**; alias **"Modecraft"** (legacy_name).
- **Gordon Brothers:** merge `GORDON BROTHER'S GROUP` (CUST041-CUST046) + `GORDON BROTHERS GROUP` (CUST039-CUST040)
  + directus `Gordon Brothers` → one, **inactive**.
- **Dollar Tree:** `CUST031` (US) **active**; merge `CUST028` + `CUST026` (Canada) → **inactive**.
- **General → Dollar General** (`CUST029`) **active**; `CUST047` (an unrelated discount chain) separate **inactive**.
- **DO NOT USE** (`CUST025`,`CUST091`): ERP junk. **Delete** the canonical row (like West End Express).

### 4.2 Sheet 1 — multi-code groups (all confirmed one customer)
`potential`: Barnes & Noble.
`inactive`: BOB BAY & SON, CLOSE OUT CENTER, DOLLAR VILLAGE, DUAV CHILDRENS WEAR, HUDSON GROUP,
III NYC 99, MINIMAX STORES, NEBRASKA FURNITURE MART, NEXUS, OFFICE 1 SUPERSTORES, TOYS 4 U.
**DELETE (not a customer):** WEST END EXPRESS — remove canonical row, keep only in the ERP mirror.

### 4.3 Sheet 2 — pre-existing Directus/DesignFlow customers (110 rows)

**A**=active **I**=inactive **P**=potential. "→X" = merge into X. "=alias of X" = keep X, add string as
alias. "2 diff" = two different companies, NOT merged.

**Own company (no merge):** POP MART (P) · Rooms to Go (A) · Shoppers Drug Mart (I) · Spencer's (A) ·
Toys"R"Us (I) · Tree Shops (I) · Lowe's Foundation (I) · Albertson Corp (I) · Claire's (P) · Faire (I) ·
Forman Mills (A) · GameStop (P) · H-E-B (I) · Hilco Global (I) · Hmv (I) · J C Pennys (I) · Mardel (I) ·
Marine Corps Community Services (I) · Mazelcompany (I) · Me Salve (I) · Menard's (A) · Miniso (A) ·
Nonfoods (I) · Ocean State (P, display "Ocean State") · Onceuponachildrockhill (I) · Osjl (I) ·
Overstock (I) · Sam's Club (P) · Spirit Halloween (A) · STORY at Macy's - NYC (I) · The Home Depot
Exteriors (I) · Toynk (I) · Tractor Supply (P) · Urban Outfitters (P) · Urban Outfitters Europe (I) ·
Vwhlsl (I) · Yankee Toy Box (I) · pOpshelf (A) · Gabes (A) · AAFES (A).

**Merge into a Coldlion row (loser name kept as alias; display = short label):**
4 Seasons → **4SGM** (A) [+ Four Seasons General Merchandise + CUST036 here; CUST037 (a different Four Seasons ERP record) is
SEPARATE, I] · 99 Only → its ERP records (CUST118 = CUST119) I · At Home → its ERP record (CUST005)
P · At Home Group Inc. = alias of At Home · Bealls, Inc. → **Bealls Outlet** (CUST008) A · Books A
Million (A) [an unrelated similarly-named ERP record = 2 diff, I] · BoxLunch (CUST016) A · Christianbook (I) · Citi Trends
(CUST002) I · Cook Brothers Corp → its ERP record (CUST019) I · Danawares (CUST020) A · DD's Discounts
(CUST022) A · DESPERATE ENTERPRISES → **Desperate Enterprises** (CUST023) A · Diamond Comic Distributors
(CUST021) I · Ebapparel → its ERP record (CUST033) I · Four Seasons General Merchandise → **4SGM** (CUST036)
A · FYE → **FYE** (CUST106 Transworld) P · General → **Dollar General** (CUST029) A · Giant Tiger (CUST038) I
· Hobby Lobby (CUST049) A · Hot Topic (CUST053) A · Hy-Vee (I) · Kirkland's (CUST065) I · Kohl's (CUST066) P ·
Kroger (CUST067) P · Lidl (CUST068) A · Nebraska Furniture Mart (CUST082/CUST083) I · Ollie's Bargain Outlet →
**Ollies** (CUST086) A · Spencer's (CUST098) A · Variety Stores, Inc. → display **VW** = "Variety
Wholesalers", A [unrelated ERP record CUST035 = 2 diff, I; **VW ≠ Vwhlsl**] · Zulily (CUST117) I.

**Two-different-companies, BOTH inactive (no merge):** Bargain Hunt · Beacon Products Inc (+CUST048) ·
Boscov's (+CUST015) · C&S Wholesale (+CUST097) · DII Enterprises (+CUST063) · MAC Wholesale (+CUST072) ·
Mid-States Distributing (+CUST074) · Midwest Marketing (+CUST001) · Midwest Trading (+CUST073) · National
Wholesale Liquidators (+CUST069) · Petra Industries (+CUST050) · Regent Products (+CUST095) · Sunrise Records
(+CUST094) · Super Value Market (+CUST070) · Wakefern (+CUST006) · Weis Markets (+CUST058).

**Internal alias merges (same company twice; keep decided one, other becomes alias):**
Aldi's + ALDI USA → **Aldi** (A) · B&N + Bn → Barnes & Noble · BAM → Books A Million · Bealls → Bealls
Outlet · DDs → DD's Discounts · Dii → DII Enterprises LLC (I) · Gabe's → Gabes (A) · Menard Inc → Menard's
· Miniso-us → Miniso · Ollies (df) → Ollies · Pop Shelf → pOpshelf (A) · United Pacific Designs Inc. →
**UPD** · Shoppers World + Shopperworld → alias of **Forman Mills** · Telcostores (I) · The TJX Companies →
TJX · Tjxcanada → TJX Canada · Tjxeurope → TJX UK.

### 4.4 OPEN conflicts to confirm before executing 4.3
1. **Homegoods** status never given (merge Homegoods + CUST051 → "Homegoods"; A or I? and is it part of
   TJX US — CUST051 is at the TJX head office — or its own customer?).
2. **UPD**: "United Pacific Designs Inc." → merge_into UPD, but the "UPD" row is marked inactive. One
   customer, display "UPD" — active or inactive?
3. **DO NOT USE**: delete (like West End Express) or inactivate?
4. **New Development**: DesignFlow-only placeholder — leave as-is in the shared hub, or delete?
