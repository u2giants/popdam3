---
summary: ERP/orders business rules part 2 of 2: how ColdLion works (working model), what the ERP computes, divisions, merch-group hierarchy, item master; implementation 
kind: living
status: current
read-when: deciding what an ERP, OrderList or ColdLion order field means
---

# ERP, orders, and source meaning — part 2 of 2

> Moved **verbatim** from [`erp-orders-and-source-meaning.md`](erp-orders-and-source-meaning.md) on 2026-11-11 so no single document exceeds the size budget (documentation upkeep, popcre/designflow-backend issue 391). Nothing was reworded; headings and section numbers are unchanged, and a citation of the original file resolves through the table there.

**Status:** Settled

## How ColdLion works — our working model of the ERP

### Dim Codes, pack variants, and possible EDI multipliers

**Settled for the reported pack variants — JamieLynn, relayed by Albert Hazan
in chat, 2026-10-27.** Business question: can two records with the same style
represent different case packs, and does Dim Code help distinguish them?
JamieLynn's answer: “We used Dim code 5 for the 5 piece. Updated the other line
back to 9. Not sure why it changed to 3 maybe an EDI multiplier.”
The reported five-piece version uses Dim Code 5; the other reported version is
nine pieces. This is authority for those variants, not a rule that all Dim Codes
are numbers equal to the case pack.

**Correction — JamieLynn, relayed by Albert Hazan, 2026-10-27; supersedes
interpreting the earlier two versions as two active order lines.** JamieLynn
clarified that the original three-piece line was fully cancelled and replaced
by the five-piece variant; a different, similarly numbered style is the
nine-piece active line. She reports an EDI 860 dated 2026-07-31 corrected that
style. The supplied line-level explanation is the business authority; an EDI
multiplier remains a tentative explanation from the earlier, confused account.

**Verified implementation evidence, not additional business authority —
2026-10-27, direct API recheck at 12:11 PM EDT.** The live item-details response
shows the five-piece record with Dim Code 5 and a currently nine-piece record
with blank Dim Code. Those current item-master values do not establish the
historical pack on an order or whether that line is still active. Both report an inner-pack quantity of one. The production
details response links the checked production line to the five-piece record and
Dim Code 5. A saved landing snapshot still showed the earlier value of three.
Keep transaction identifiers and raw responses in approved private evidence;
case-pack reconciliation remains on PopDAM #527 / shared-db #4858.

#### What this changes

A style number and label alone need not distinguish the applicable pack.
Use the transaction's exact item identity and available Dim Code to distinguish
variants; consult the pack quantity on that matching source record. Do not
choose an arbitrary style match, treat blank Dim Code as proof of missing data,
or assume the numeric code itself defines the quantity. If the transaction
does not identify the version, its applicable pack remains **Unknown**.
This qualifies the older item-default guidance above: a default is usable only
when its variant is resolved, and assortment quantities remain distinct from
single-item defaults (see [product identity and prepacks](product-items-and-identifiers.md#prepacks-and-assortments)).

**Unknown — EDI cause and three inners.** JamieLynn suggested an EDI multiplier
as a possible explanation for the unexpected three; she did not confirm the
cause. Future quantity investigations should check EDI conversions/multipliers
alongside pack variant and source freshness. Do not automatically multiply or
divide case packs, inner packs, or ordered units, or infer three inners from
nine divided by three. The reported three inners are not confirmed by the API's
inner-pack quantity of one. A vendor defect, a universal Dim Code convention,
remain unproven. The saved order intake pulled on 2026-10-23 already shows
the obsolete line fully cancelled and no pick/invoice reference for it, while
the active lines have matching shipped/invoiced quantities and references.
Those references are carried by order history; they are not an independent
pick-ticket payload comparison. Check cancellation and replacement before
matching variants or counting an unresolved case pack. A current item-master
change must not rewrite a cancelled historical line by inference.


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

### `/proddetails` rows are keyed by `pkey`; `prodLineSeq` is not a line identity

**Settled** (ColdLion technical team, 2026-09-29; identity scan and shapes A–C earlier).

- **`pkey` uniquely identifies a `/proddetails` row.** Look primarily at `pkey`, but consider
  stage code. The landing primary key `(company_code, pkey)` is the right grain.
- **`prodLineSeq` groups sizes** of one item/color/label/dim. It **can repeat**. POP does not
  use size, so the field means nothing here and must never be a unique constraint.
- **Look-alike rows are real.** A customer PO can carry the same line twice (exact duplicate) or
  split a quantity across two rows. Do not de-duplicate and do not collapse them into one line.
  For **payment**, add `prodQty` × `prodCost` across those rows (settled 2026-09-29).
- **Ignore `prodQty` = 0.** Those rows are zeroed rather than cancelled; same effect as cancel.
- **Filter to `ISS` when loading production-order detail.** Other rows often only show in-transit
  and receiving, not extra purchase lines.
- **Cost impact is settled (JamieLynn, 2026-09-29): each real row is a real charge.** Amount
  owed to the factory = sum of `prodQty` × `prodCost` across the rows. A split-quantity line
  (400 + 200 of one item) is 600 units owed. A customer PO that carries the same line twice
  (1600 + 1600) is 3200 pieces owed, not a duplication. Keep the rows separate; add the money.
- **Ikonick multi-cost rows are an owner exception, not a cost formula.** Same item at several
  unit costs on one line is the Ikonick pattern: the item stood for different things reported
  under one number. Either ignore those rows or squeeze them to fit our method. Do not treat
  that shape as a general multi-cost rule. Owner ruling, Albert, 2026-09-29.

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
