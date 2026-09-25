# ERP, orders, and source meaning

**Status:** Settled

## General rule

An ERP field name does not establish its business meaning. Every imported field must retain its source, time scope, and interpretation. Applications must not give the same source value different meanings.

## Orders and items

Google OrderList rows and future ColdLion rows describe the same real orders. They are not competing order systems. One canonical order and line must retain separate source references for each system. The ultimate item list belongs to the canonical PLM item identity.

## How a new order enters the system (OrderList intake)

**Status:** Settled where marked; the named Unknowns are open. Authority: Albert, 2026-09-17,
cross-checked against the live-workbook inspection of 2026-08-28 (shared-db issue #1772).

The two live Google sheets this program replaces (Settled, Albert, 2026-09-17):

| Legacy Google sheet | Replaced by |
|---|---|
| `OrderList`, spreadsheet `1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk` | the canonical order objects (`plm.production_order` / `plm.production_order_line`) and their DesignFlow UI |
| `MasterData` (legacy Google workbook; ID recorded in [`master-data-access.md`](master-data-access.md) and also cited in `plan_popdam_order_list.md` and migration `20260710135600`) | the Master Data / Styles grid (`dam.designflow.app/styles`) |

Intake sequence for a new customer order (Settled, Albert, 2026-09-17):

1. Adam (sales) receives the order from the customer, usually as a PDF.
2. Adam sends it to JamieLynn at ColdLion, who manually enters it into the ColdLion ERP. That
   manual entry is the trigger every downstream step depends on; nothing in this program
   replaces it.
3. Adam then creates the OrderList row himself, typing only the human-input columns (Albert,
   2026-09-17, by column number): 10 Order Person, 11 Order Type, 12 Customer, 14 Customer PO#,
   15 Assortment ID or 16 Style# (one or the other, never both), 21 Quantity, 22 Case Pack,
   24 Ship To, 25 Start Ship Date, 26 Cancel Date. Import PO# (col 02) is entered to create the
   order and becomes immutable afterwards. (Consistent with the 2026-08-28 issue-#1772
   inspection, which additionally listed col 18 Order Depth as human input; Albert's 2026-09-17
   list omits it.)
4. Description, licensing status, and the other lookup/calculated columns then carry values
   sourced from the linked Master Data sheet; Adam does not type them.
5. Yuchen (NY-based production coordinator; not currently a user of the DesignFlow system) then
   writes the production PO to the factory and enters columns 02 Import PO#, 03 Order vendor,
   04 Seal Container Day, and 05 Sent PO Date. The remaining columns auto-populate, partly from
   the workbook's PO tab (gid `426779438`). (Settled, Albert, 2026-09-17.)

On the mechanism behind step 4: the 2026-08-07/09 formula audit found no Master Data lookup
formulas on the `Order` tab, while the 2026-08-28 inspection found gray columns explicitly
marked automatic. Both are honest for their dates; whether the population is live formulas or
another path was never re-audited and does not need to be — the replacement system does not copy
either mechanism. Description and licensing status are projections from the linked canonical
item / Master Data (48-column contract, columns S and T).

**Unknowns**

- The full set of automatic columns beyond description and licensing status is recorded only in
  the live workbook, not yet in this library.

**Automatic order intake from ColdLion (Settled, Albert, 2026-09-17).** The DesignFlow system
polls the ColdLion API periodically during the business day and creates the canonical order rows
automatically, replacing Adam's typing (step 3) only. JamieLynn's manual ERP entry (step 2) stays
manual. The poll is an **unsealed current-window poll on our side**: waiting for ColdLion to
build a changed-since filter is explicitly ruled out — vendor programming would take time and
may not happen. Yuchen's production-PO columns (step 5) are out of scope for this automation.

Field coverage of Adam's input columns from `/orderHistory` (verified against the landed
`coldlion.order_history_line` projection, the 2026-08-19 field census, and live probes on
2026-09-17):

| Adam's column | `/orderHistory` field | Populated |
|---|---|---|
| 10 Order Person | `salesPersonCode1` (name via `/salespersons` master) | 100% |
| 11 Order Type | `warehouseCode`/`warehouseDesc` routing code — the term prefix | see note |
| 12 Customer | `customerCode` + `customerDesc` | 100% |
| 14 Customer PO# | `poNumber` | 100% |
| 15/16 Assortment ID / Style# | `itemNo` master; `prePackCode` + `prepackQty` + `subItemNo` components for assortments | 100% / 72.5% prepack |
| 21 Quantity | `orderQty` (per-SKU quantity — use this). `lineQty` is a parent-line total repeated on every exploded component; never read it as a per-SKU quantity and never sum it (`20260905105038:604-605`) | 100% |
| 22 Case Pack | not on the order line — item grain via `/itemDetails` `cartonQty` | see note |
| 24 Ship To | the same routing code's destination part (FOB excepted: its origin port is added sheet-side, not in the code — see the routing table) | see note |
| 25 Start Ship Date | `startDate` | 100% |
| 26 Cancel Date | `cancelDate` | 100% |

**Order Type and Ship To are one ColdLion field — solved live 2026-09-17.** After
cross-checking recent OrderList rows against the feed, both columns turn out to be projections
of the routing code in `warehouseCode`/`warehouseDesc`. Observed live and cross-walked against
the sheet's own vocabulary (Order Type: FOB 6,811 / POE 2,154 / MDDP 403 rows; Ship To: NINGBO
7,948 / LA 2,964 / NJ 548 / SAVANNAH 67 — the two vocabularies were counted independently over
the same sheet and are both partial (the Order Type list ends in "…"), so they do **not**
partition the same rows; never reconcile one set against the other or treat a mismatch as a
defect):

| ERP `warehouseCode` / `warehouseDesc` | Sheet Order Type | Sheet Ship To |
|---|---|---|
| `FOB` / `FOB` | FOB | — (origin port Ningbo/Xiamen/Qingdao/Shanghai is NOT in the code; it is added on the sheet side) |
| `POECA` / `POE CALIFORNIA` | POE | LA |
| `POEGA` / `POE GA Savannah` | POE | SAVANNAH |
| `DDPNJ` / `DDP New Jersey` | POE | NJ |
| `MDDP` / `MDDP` | MDDP | NINGBO (on the sheet) |

**POE vs DDP — definitions and who differentiates them (Settled, Albert, 2026-09-17).**

- **POE (port of entry):** POP is responsible for getting the goods to a domestic port and
  paying freight and duty; the customer picks the container up at that port.
- **DDP:** POP must additionally truck the container from the domestic port to the customer's
  warehouse.
- **Forman Mills and Shoppers World are DDP orders**, not POE, despite their OrderList rows
  saying POE. DD's Discounts is a true POE (LA) customer.
- **ColdLion differentiates the two; the Google OrderList does not.** The ERP carries distinct
  routing codes — Forman Mills and Shoppers World ride `DDPNJ` ("DDP New Jersey") while
  Burlington as POE rides `POECA`, and Spencer Gifts uses a whole DDP-state family (`DDPPA`,
  `DDPOH`, `DDPNC`, `DDPCA`, `DDPGA`). The sheet's Order Type vocabulary (FOB / POE / MDDP /
  CONTRACTUAL SAMPLE / DAVID SAMPLE / C STOCK / STOCK / …) contains **no generic DDP value** —
  `MDDP` is listed but is a distinct DDP variant code, not a catch-all "DDP" label — so
  plain DDP orders (Forman Mills, Shoppers World) are labelled POE+NJ on the sheet. The
  automation's Order Type derived from the ERP routing code is therefore *more correct than
  the manual sheet column it replaces*.

**Routing-code vocabulary (all observed live, 2026-09-17, sales and production sides):**

| Code | Description | Meaning |
|---|---|---|
| `FOB` | FOB | free on board (customer's freight from origin) |
| `POECA` | POE CALIFORNIA | port of entry, California (Burlington, DD's) |
| `POEGA` | POE GA Savannah | port of entry, Savannah |
| `POEVA` | POE GA Norfolk | port of entry, Norfolk (code says VA, description says GA — as returned) |
| `POE` | POE | bare port-of-entry code, destination unstated |
| `DDPNJ` / `DDPMD` / `DDPPA` / `DDPOH` / `DDPNC` / `DDPCA` / `DDPGA` | DDP + state | delivered duty paid, trucked to the customer's state |
| `MDDP` | MDDP | DDP variant; the expansion is Unknown (sheet pairs it with NINGBO) |
| `DES001` | Deco Signs | drop-ship/destination code |
| `ANT001` | ANTHONY'S WAREHOUSE | POP-side warehouse |
| `WMFC` | Walmart Fulfillment Center | |

**Production orders carry a second vocabulary that can disagree with the routing code.**
`/prodtracking`'s `prodTypeCode` (101 recent production orders): `FOBCHINA` x62, `POECA` x18,
`POE` x13, `FOBUSA` x5, `FOBINDIA` x2, `POEVA` x1. The Forman Mills / Shoppers World orders are
`prodTypeCode = POE` while their `warehouseCode = DDPNJ` — the two fields disagree, and the
**`warehouseCode` is the one that matches the POE-vs-DDP business meaning** (Albert,
2026-09-17). `FOBUSA` pairs with `DES001`; `FOBINDIA` appeared with both `FOB` and `DDPMD`.

- The DDP-vs-MDDP wording distinction and the bare-`POE` destination are still to be collected
  empirically. `udf01` is the constant `"01"` everywhere sampled and `labelCode`/`labelDesc`
  are per-customer label/program codes — neither is order type.
- CONTRACTUAL SAMPLE / DAVID SAMPLE / C STOCK / STOCK sheet order types correspond to the
  settled `COS` and stock-order rules and are recognised separately, not via this field.
- **Case Pack** stays item-grain: `/itemDetails` returns `cartonQty`, `innerPackQty`,
  `cartonPackType` and carton dimensions/weight, with real varying values (1, 4, 7 observed).
  Auto-fill as the item default; the sheet's line-level exceptions (380 text/multiline cells in
  the historical profile) stay human.

- **FOB point is a production-order detail (Albert, 2026-09-17), and `/prodtracking` is where
  the ERP keeps it — but the specific port is not populated today.** `/prodtracking` is the
  production-order header endpoint (52 fields, one row per `prodOrderNo`): it declares
  `shipPortCode`, `arrivalPortCode`, `containerNo`, `freightForwarderCode`, plus
  `createdTime`/`createdUser`, deposit tracking, hang-tag tracking, and `ftySalesRep`. Across
  101 recent production orders: `shipPortCode` empty on all 101; `arrivalPortCode` populated
  once (`NY`) with a `containerNo` alongside it — the slots are real and get filled later in
  the process, not at entry. What IS available at entry is origin **country** granularity via
  `prodTypeCode` (`FOBCHINA`, `FOBINDIA`, `FOBUSA`). Near-term, FOB Ship To (the specific Ningbo/Qingdao/Xiamen/Shanghai port) stays human; no derived substitute may be invented;
  long-term, ask ColdLion to populate `shipPortCode`. `/prodtracking`'s `createdFrom`/`createdTo`
  filters returned zero rows for a known-populated range — access by `prodOrderNo` works and is
  the reliable route. `/proddetails` separately carries real `createdTime`/`createdUser` at
  production-line grain.
- **FOB Ship To maps from `shipPortCode` (Settled, Albert, 2026-09-17).** Albert will ask
  JamieLynn to start entering the FOB point there. Until it is populated the field reads empty
  and FOB Ship To stays human; no derived substitute may be invented.

**Three join rules and one correction from the deep cross-check (live, 2026-09-17).** Chasing
five "missing" sheet orders through the production side found every one of them in the ERP,
entered weeks earlier — and corrected an earlier note here that had blamed JamieLynn's entry
timing. The misses had three real causes, each now a rule:

1. **Customer-PO numbers are zero-padded inconsistently.** The ERP carries a 10-digit
   zero-padded value (synthetic shape: `"0001234567"`) and an ordinary 8-digit value
   (synthetic shape: `"87654321"`) in the same fields — observed on the live feed
   2026-09-17. Any join against a sheet-typed
   customer PO must normalize by stripping leading zeros first.
2. **The ERP's `startDate` is its own value, not the sheet's Start Ship Date.** Same orders:
   ERP 2026-12-04 vs sheet 2026-11-21; ERP 2026-10-02 and 2026-10-30 vs sheet 2026-10-10. The
   window filter keys on the ERP date, so the sales rows sat in future windows far from where
   the sheet dates pointed. Expected divergence, not an error; the automation maps ERP values.
3. **The sales orders are findable through the production side even when window scans miss:**
   `prodHistory` rows carry the linked `salesOrderNo` plus `custPONumber`, and
   `orderHistory?salesOrderNo=` then retrieves the sales order directly within its (now known)
   start-date window.
4. **Correction:** JamieLynn's entry does **not** lag Adam's sheet typing in the way an earlier
   note here claimed — the tested orders were all in the ERP, keyed around the time the
   production POs were cut. That note is withdrawn and replaced by rules 1–3.

**Forward-scan horizon (Settled, Albert, 2026-09-17):** API calls are cheap; never economise
call volume at the cost of missing data. The poll scans forward windows generously — until
consecutive empty months, not a fixed short horizon — in addition to the trailing re-read.

**One sales order maps to many production orders (Settled, Albert, 2026-09-17).** A single
customer order is regularly fulfilled by multiple production POs, and the reverse also occurs
(one production PO serving several customer orders). Verified on the live sheet the same day:
434 of 4,005 customer POs carry 2–12 distinct Import PO numbers, and customer PO differs inside
806 Import-PO groups. Consequences for the canonical model:

- A ColdLion `salesOrderNo` is **never** the identity of a canonical `production_order` header
  (the header grain stays one per Import PO).
- Sales-order rows created by the automatic intake are **placeholders** representing the
  customer order before production exists. When production orders are later written against
  that customer order, they **claim the placeholder's lines line-by-line** (splitting
  quantities where one sales line is produced across factories); they never merge headers.
- A fully claimed placeholder is retired as evidence, never deleted.

Also recorded: the API exposes a **`POST /order`** insert-sales-order endpoint, unused by us.
JamieLynn's manual entry stays manual under the 2026-09-17 ruling; this only notes that the
lever exists.

Two technical constraints on the poll design:

- **The feed carries no created/entry timestamp — verified live 2026-09-17.** A direct probe of
  `/orderHistory` for the open week 2026-09-11..17 returned the full 63-field payload (the
  2026-08-19 census said 59; the 2026-08-31/09-01 additions raised it). The only date-valued
  fields are `startDate`, `cancelDate`, and `invoiceDateString` — none is a record-creation
  date. The rolling re-read must be the checkpoint, not a per-row created date. Detect new
  orders as `salesOrderNo` values not seen before, deduplicate by the landed identity plus
  source hash, and re-read a trailing window so late corrections land as new versions.
- **The window filter keys on the ERP start date — verified live 2026-09-17.** Windows in
  October, November and December 2026 return live rows today (a November window held 42 rows,
  a December window 117), and every returned row's `startDate` falls inside its requested
  window. A current-week-only poll therefore cannot see newly entered orders with future ship
  dates — which is the norm — so detection requires scanning forward windows to a generous
  horizon (Settled ruling above) in addition to the trailing re-read.
- **The API itself serves the open week.** The same probe returned 135 live rows across 3 pages
  for the still-open current week. The up-to-a-week trailing lag is purely our sealed-window
  landing design, not a vendor limitation. The pre-fulfilment signal also works live: rows with
  both `pickTicketNoString` and `invoiceNoString` empty are present and identifiable in the
  current week.

## The customer master is not a customer list

ColdLion's customer table includes ship-to-only records (a Licensor POP ships to
must be a customer there to get a pick ticket), customers dating to 2006 that are
now defunct, and active customers too small to warrant CRM attention. It must
never be read as POP's list of customers, and it never sets a CRM
classification. See [`customers-contacts-and-organizations.md`](customers-contacts-and-organizations.md).

## Historical classification

ERP merchandise data before the approved cutoff may use codes whose historical meaning differs from current codes. Historical items must follow the approved description-based remediation process rather than being forced through the current mapping.

## Samples and production indicators

A Production PO number ending `COS` means extra pieces of a customer's item are being made for the Licensor as contractual samples and/or for POP's internal purposes as DAVID samples.

- These pieces are a real POP cost with no customer revenue and must be classifiable separately.
- `salesOrderNo = 0` on a `COS` line is correct. It is not a missing link.
- The Customer on the line is the Customer from the original order, not the sample recipient.
- `COS` does not distinguish contractual samples from DAVID samples. That split is Unknown unless another source supplies it.
- Older data also contains other sample markers, so `COS` must not be treated as the only possible indicator.

The production-history feed covers four divisions: `CW001`, `EH001`, `EP001`, and `SP001`. A short time window may show fewer divisions and must not be generalized.

`1900-01-01` is the ERP's empty-date marker. It is not a real business date. Outside `COS`, `salesOrderNo = 0` means there is no linked sales order.

A source value that is absent or ambiguous must remain Unknown rather than being silently converted to zero, false, or not applicable.

## What the ColdLion order-history feed actually is

**Status: Settled.** Authority: ColdLion (JamieLynn), 2026-08-28.

The order-history feed is **not a sales-order table**. It assembles data from four separate
documents — the Sales Order, the Prepack Detail, the Pick Ticket and the Invoice — into one flat
list of rows. A change at any stage can split a line.

Consequences that are Settled:

- **No unique key exists, and none can be constructed.** The sales-order line number is
  **re-assigned at pick and again at invoice**, so it does not carry forward. Two rows can share an
  order and a line number and be different items; the same item can appear on two rows.
- **Rows that look like duplicates are the same order line seen at a different stage.** They must
  not be de-duplicated.
- **A line split by a price change carries both prices, and both are real** — one from the sales
  order, one from the invoice. Adding them together double-counts. Any revenue or quantity figure
  taken from this feed by summing rows is wrong.
- Every row must be kept, and any landing table must carry a stage or source marker.
- **The feed does not say which of the four documents a row came from.** Until it does, the stage of
  an individual row is **Unknown** and must not be inferred.

## Quantity fields in the order-history feed

**Status: Settled.** Authority: ColdLion (JamieLynn), 2026-08-18, 2026-08-26 and 2026-08-28.

- Invoiced and open quantities are **not carried at component level**. Use the unshipped and picked
  quantities instead.
- The feed now applies the ERP report's own formulas, but **the formulas themselves were never
  disclosed** — only the computed result. Do not re-derive an invoiced or shipped quantity here.
- **A zero open or unshipped quantity on an invoiced line is a true zero**, not missing history:
  once a line is invoiced, open and unshipped drop to zero unless the shipment was short or partial.
- **This test cannot currently be applied**, because the feed returns nothing for invoice number,
  invoiced quantity, shipped quantity, shipped amount or invoice date on historical rows. Until
  those carry values, whether a historical zero is a true zero remains **Unknown row by row**.

## Negative quantities are valid business data

**Status: Settled.** Authority: ColdLion (JamieLynn), 2026-08-28.

A negative quantity records a **manual correction made after initial order entry**, not a data
error. Two confirmed causes:

- A customer ordered in cases while stock was held in pieces, so the order was manually exploded
  into pieces and the settings adjusted so the EDI went back out correctly.
- Contractual samples were being shipped and the warehouse found more units than expected; the extra
  units were added to the pick so everything could ship.

Negative quantities must be loaded as they are. They must never be rejected, clamped, zeroed or
converted to a positive value.

## Sales-order line number of zero

**Status: Settled in part; the remainder is Unknown.** Authority: ColdLion (JamieLynn), 2026-08-28.

A sales-order line number of zero occurs mostly on **cancelled items or cancelled orders**. Cases
where the line number is zero **and the order was invoiced are unexplained**; ColdLion's technical
team is investigating and has given no date.

A zero line number is therefore not a usable line reference. Rows carrying a zero line number
alongside an invoice must be held aside rather than loaded as ordinary lines.

## Blank merchandise groups on component rows

**Status: Settled.** Authority: ColdLion (JamieLynn), 2026-08-20.

A blank merchandise group on a component row is **not missing data**. ColdLion renumbered its
merchandise-group positions, and on affected rows the values still exist in the **old slot
positions**. A blank must never be treated as absent and must never be backfilled from the master
item — check the old positions first.

Separately, a set of items created through ColdLion's API around the time of the renumbering were
never re-mapped to the new merchandise groups. **Correcting those is POP's work, not ColdLion's**,
and it is done by owner decision, never by an automated mapping.

## Other Settled answers from ColdLion

**Authority: ColdLion (JamieLynn), on the dates shown.**

- **History begins 2019-01-01.** That is the load boundary. (Restated by Albert, 2026-08-20.)
- **A production line reference now separates real lines from duplicates** in production history; a
  duplicated production reference number was the original cause. (2026-08-17)
- **The history feed is capped at a seven-day window**, inclusive. ColdLion advises narrowing to a
  single day when a call is slow. There is no other hidden filter. (2026-08-17, 2026-08-26)
- **Production stage has exactly three values:** issued, in transit, and received. All three carry
  real rows, and the stage is now returned by the feed rather than assumed from the request.
  (2026-08-19, 2026-08-26)
- **Assortment-level merchandise groups are the blank ones**, because an assortment master is
  generic; the component carries the specific groups. (2026-08-18)
- **Amazon orders have no customer purchase order** because they are stock for Amazon's warehouse,
  not presold. An unlinked Amazon line is correct. (2026-08-19)
- **Hard-linking purchase orders to production orders began around 2022–2023.** Before that the
  customer purchase order was entered manually, so older lines legitimately lack the link.
  (2026-08-18)
- **Sub-UPCs are rarely populated**, because UPCs are not usually assigned to prepack components.
  (2026-08-17)
- **Merchandise groups carry an active/inactive flag**, and it is live. (2026-08-20)

## How ColdLion works — our working model of the ERP

**Status: Settled where marked; the two Unknowns are named explicitly.** Built from ColdLion's own
answers (JamieLynn, 2026-08-17 through 2026-08-28) and from what we have verified live against the
API. This section is the understanding, not the transcript. It exists so nobody has to re-derive it.

### ColdLion has two sides, and they mirror each other

- **Production history** is what POP buys — the orders POP places with factories.
- **Order history** is what POP sells — the orders customers place with POP.

They are two views of the same catalogue and share the item, division and merchandise-group
vocabulary, and each carries the other's order reference where a link exists. Neither is a ledger of
the other. **Settled.**

### An order line is not the smallest unit; a pack component is

Both sides return **one row per order line per pack component**. POP sells assortments — a master
item that contains several different styles — and ColdLion explodes the pack on the way out.

- The line names the **master** item and how many pieces are in one pack; the rows underneath name
  the individual styles.
- **The pack recipe is trustworthy.** Component quantities sum to the stated pack quantity; that is
  a usable integrity check on load. **Settled**, verified on 413 of 413 packs.
- **The component's merchandise groups are the real ones.** The master is deliberately generic; the
  styles inside are specific. Never inherit the master's taxonomy onto its components, and never
  read a blank on the master as missing data. **Settled** (JamieLynn, 2026-08-18).
- Roughly a third of sales rows and half of production rows are pack components.

### The order-history feed is a report, not a table

This is the most consequential thing we know, and it was confirmed only on 2026-08-28. The feed
assembles four documents — the **Sales Order**, the **Prepack Detail**, the **Pick Ticket** and the
**Invoice** — into one flat list. A change at any stage splits a line.

Everything awkward about the feed follows from that one fact:

- **Line numbers are re-assigned at pick and at invoice.** They are document-local, not order-local,
  so the same line number on the same order can name different items at different stages.
- **There is no unique key and none can be built.** Any attempt produces collisions.
- **Look-alike rows are the same line at different stages** — not duplicates, and not to be removed.
- **A price change between stages splits the line and both prices are real:** one from the sales
  order, one from the invoice. Summing them overstates revenue.
- **The feed does not say which document a row came from.** That is the single missing field that
  would make the rest usable, and it is the next thing to ask ColdLion. Until it exists, the stage
  of an individual order-history row is **Unknown** and must not be inferred.

The production side does not have this problem: ColdLion added a production line sequence and now
takes the latest production date, so its rows no longer fan out. **Settled**, verified live.

### The feed shows only part of production unless you ask for every stage

Production lines carry a stage — issued, in transit, received — and a request without a stage
returns **only the issued lines**. The other stages are not a subset; they are rows that appear
nowhere in the default response. A production pull that does not iterate the stages is silently
incomplete. **Settled**, verified live.

### What ColdLion computes, and what it refuses to explain

- Invoiced and open quantities are **not carried at component level**.
- The feed now applies the ERP report's own formulas, but **the formulas were never disclosed** —
  only the computed result. Nothing downstream may re-derive an invoiced or shipped quantity.
- Once a line is invoiced, open and unshipped drop to zero unless the shipment was short or partial,
  so **a zero on an invoiced line is a true zero**. **Settled.**
- **We can apply that test, and we have.** Verified 2026-08-28 across 10,397 order-history rows
  spanning 2019 to 2026: open and unshipped are zero on effectively every row from 2019 through
  2025, and those same years carry an invoice number on 72% to 99% of rows. The only year with live
  open and unshipped values is the current one — the orders still in flight. **The historical zeros
  are true zeros; load them as real. Settled.**
- An earlier note here said those invoice and shipping fields were empty on history. **That was a
  measurement fault on our side, corrected 2026-08-28** — the probe expected a paged envelope that
  the order-history endpoint does not return. Which leads to the next point.

### Not every endpoint answers in the same shape

**Superseded 2026-08-31; re-verified live 2026-09-17.** The order-history endpoint *did* return
a bare list with no count and no working paging until 2026-08-31 — a shape that once produced a
false finding which nearly went back to ColdLion as a defect report. Both history endpoints now
return the standard paged envelope and genuinely honour `page`/`size`, subject to an
undocumented **page-size cap of 200 rows**: always loop until `last` is true, and never infer
completeness from a single large request. `/merchGroupDetails` still returns a plain JSON
array. **Settled** (original bare-list finding verified live 2026-08-28; paging change verified
live 2026-08-31 and re-verified 2026-09-17, envelope keys `last`, `totalElements`, `totalPages`,
`size`, `number` observed on a live response).

### Manual intervention is normal, and it is visible in the data

ColdLion is operated by people who correct orders after entry, and the ERP records the correction
rather than rewriting history. That is why:

- **Negative quantities are valid.** Confirmed causes are a case-to-piece explosion done by hand so
  the EDI went back out correctly, and extra units found by the warehouse being added to a
  contractual-sample pick. Load them as they are. **Settled.**
- **A line number of zero** appears mostly on cancelled items and cancelled orders. The cases where
  it is zero **and** the order was invoiced are **Unknown** — with ColdLion's technical team since
  2026-08-28, no date given.
- **A missing sales-order link on an older line is usually correct.** Hard-linking purchase orders
  to production orders began around 2022–2023; before that the customer purchase order was typed in
  by hand. **Settled.**

### The divisions: four exist, three are ours

ColdLion publishes an authoritative list of divisions through a `/divisions` endpoint it built for
us on 2026-08-28, at our request, rather than sending a static list. **Nothing downstream may
hard-code a division code** — read the endpoint. It returns four, each with its own general-ledger
code, and all four are flagged active in the ERP.

**Owner ruling (Albert, 2026-08-28): only three of them are in scope — POP Creations (Licensed
Products), Edge Home, and Spruce (Licensed Products). Edgeucational Publishing is out, permanently.**
It will never be part of this system. Filter it out at the point of ingestion rather than letting it
travel downstream and get filtered repeatedly; and do not treat its absence from our merchandise-group
renumbering dates as a gap to close. **Settled.**

### The merchandise-group hierarchy, what it names, and what the renumbering left behind

ColdLion carries **fourteen merchandise-group slots per item.** Ten of them have names, and the
names come from the ERP itself, through the merchandise-group headers endpoint. **Read the names
from that endpoint. Do not hard-code them, and do not assume a slot means the same thing everywhere.**
**Settled**, verified live 2026-08-28.

- In POP Creations and Spruce the ten are: type, sub-type, sub-sub-type, size, licensor, property,
  style guide, art source, artist, demographic.
- **In Edge Home, slots five, six and seven mean something different** — big theme, little theme and
  art type. Any logic that reads the fifth slot as "the licensor" across every division is wrong.
- Slots eleven to fourteen have no name and no data anywhere. Treat them as absent.

Two earlier notes here were wrong and are corrected: slots seven to ten are **not** leftovers from
the renumbering — they are real, named axes, populated on roughly six to twenty-seven percent of
items. And the third slot is "sub-sub-type", not "material or embellishment"; that was our own
reading of the values, not the ERP's label. We have asked ColdLion to confirm how deliberately the
last four named slots are maintained. **Proposed** until they answer.

Three consequences follow, and each has already caught somebody:

- **A blank merchandise group on a pre-renumbering row is not missing data.** The value is still
  sitting in the old slot. Never backfill from the master item without looking there first.
  **Settled.**
- **A merchandise-group code means nothing on its own.** Its meaning is scoped by the category its
  top-level code belongs to, so the same code names different things in different product families.
  That scoping applies to the first three slots only — the category comes back empty on licensor and
  property. Any read that ignores the category is simply wrong, and ColdLion's own documentation does
  not say so. **Settled**, verified live.
- **Items created through ColdLion's API around the renumbering were never re-mapped.** Fixing them
  is **POP's work, not ColdLion's**, and it happens by owner decision — never by an automated
  mapping. See [`merchandise-and-product-taxonomy.md`](merchandise-and-product-taxonomy.md).

A merchandise group also carries a lifecycle flag, and it is a plain yes/no — two values, no third
state. **Settled.**

### Things we worked out ourselves, that ColdLion has not confirmed

Everything in this block currently matches the data. None of it came from ColdLion, so none of it is
Settled, and each was put to them on 2026-08-28 as a confirm-or-correct question. **Treat a change in
any of these as likely rather than surprising.**

- **Item numbers are built from the merchandise groups**, not allocated freely — one character each
  from the type, sub-type and sub-sub-type codes, then size, licensor and property, then a sequence.
  The rule reproduces about ninety percent of recently created numbers. The other ten percent are
  unexplained. **Proposed.**
- **The renumbering dates** — POP Creations around late April 2025, Edge Home and Spruce around
  September 2025 — were read off when the group definitions were last modified, not given to us.
  They decide which rows we trust as-is. **Proposed.**
- **Which flag means "retired" is now answered narrowly.** ColdLion confirmed that only
  `active` is in use, but also that it is not maintained reliably. `active = N` is a real
  suppression signal; its absence is not proof an item is sellable. The other lifecycle-looking
  fields are stale residue and are not business status. **Settled for source handling; saleability
  remains Unknown unless POP has separate evidence.**
- **Nothing in the ERP links a licensor to its properties.** We derived the link from which licensor
  appears on items carrying each property, and hand-filled roughly forty properties that have no
  items yet. Those forty are our knowledge, not the ERP's. There is also a royalty code on the item
  whose values look like licensor codes but do not always agree with the licensor group; which of the
  two governs licensing is **Unknown.**
- Items created through the API appear to be identifiable by their created-by user; a production
  history request with no stage appears to return only issued lines; and the meanings of the first
  user-defined field, the brand-assurance number and the production-reference number are our
  readings, not documented ones. **Proposed.**

### Product size comes from the hierarchy, not from the ERP's size field

ColdLion's item-level size field is dead. POP does not sell apparel and never used it, so it carries
the same single value on effectively every item — verified across the entire catalogue of 19,362
items, with only sixteen blanks and no other value anywhere. **The real product-size axis is
merchandise group 04**, which is populated and meaningful.

The two are easy to confuse and expensive to confuse: one is noise, the other is the answer. Ignore
the item-level field entirely. **Settled** (JamieLynn 2026-08-28, verified live).

### What the ERP is not

- **ColdLion's customer table is not POP's customer list.** It holds ship-to-only records, defunct
  accounts back to 2006, and accounts too small for CRM. See the section above.
- **ColdLion is not a revenue report.** Its order feed can be counted only by someone who knows it
  contains the same line more than once.
- **ColdLion's API is not business authority.** As of 2026-09-10, the specification does supply
  typed response schemas and rejects invalid declared enum values, which makes it a useful
  integration contract. It still does not establish business meaning: interpret ERP values through
  the settled rules and verified source behaviour, never from a field name or schema alone.
- **An ERP field name does not establish its meaning.** Several fields here mean something other
  than their name suggests, and two of the most obvious-looking ones are empty.

### The item master mixes products with charges, and barely says which is which

The ColdLion item master is not a product catalogue. Alongside real products it
holds fee and charge codes, raw-material and component codes, sample and test
placeholders, and abandoned junk records. The ERP does provide a flag for this -
a single-character non-inventory field on the item record, landed here as
`non_inventory_item` and mirrored in the DesignFlow item header as
`non_inv_item` - but it is close to unused.

Measured on 2026-09-07 across roughly 19,600 item records: 15 were flagged as
non-inventory, about 14,900 were flagged as ordinary products, and about 4,700
carried no value at all. At least 35 entries that are plainly not products -
glitter fee, reprint fee, colour corners, handling, foil stamp fee, sample
charge, port charge, plate cost, ticketing, discount, commission, lenticular
material, felt pieces, clear hang tabs - were recorded as ordinary products. A
further ~450 records are junk: 250 with no description, and about 150 that are
gibberish or test entries such as "awd" and "Test Alex 5".

Two consequences for any work that reads this feed:

1. **Never count item rows as products.** A population taken straight from the
   item master overstates the catalogue by fees, materials, placeholders and
   junk, and the flag will not filter them out for you.
2. **The absence of the flag proves nothing.** Only a positive non-inventory
   value carries information today; blank and "product" are indistinguishable
   until the field is corrected at source and kept current.

Which entries belong on each side of the line is a business question, not an ERP
question - see *Non-inventory items* in
[`product-items-and-identifiers.md`](product-items-and-identifiers.md).

### How ColdLion answers questions — and why that matters

ColdLion answers well, fixes real defects quickly, and has twice added fields on request. But their
answers arrive as prose about specific orders, not as specification. Three working rules follow, and
all three have already cost us once:

1. **Every question must carry named examples** — an order number they can look up. A question
   phrased as a count gets a general answer that fits nothing.
2. **Verify every answer against live data before recording it.** Two answers we accepted were
   half-true in practice: fields described as populated were populated only on recent rows.
3. **Size the sample by row count, not by how many days or calls it took.** A 291-row sample once
   reported a field as empty; 3,981 rows showed it 70% populated, and the wrong figure went out.

## Implementation and evidence

The field-by-field source evidence and formula findings remain in [`../business-rules-erp-data.md`](../business-rules-erp-data.md), [`../app-migration-notes/popdam-order-list.md`](../app-migration-notes/popdam-order-list.md), and the linked formula audit. The intake column contract (human-input vs automatic columns) is shared-db issue #1772 (2026-08-28 workbook inspection). Current ColdLion ingestion runs as sealed 7-day windows via `tools/coldlion-landing/` and the `coldlion-landing-sync` workflow — it deliberately trails real time by up to a week, which any new-order automation must account for. The build plan for the automatic intake is [`../../plan_coldlion_order_intake.md`](../../plan_coldlion_order_intake.md) (read its STATUS table first). This page is the companywide entry point.
