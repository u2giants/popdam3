# Products, items, SKUs, and identifiers

**Status:** Proposed

## Identity

A Product or Item is the business object. A SKU, style number, ERP item number, and application row ID are identifiers for that object; none should be confused with the object itself. Separate source references must be retained when multiple systems describe the same Item.

Designs and creative concepts remain business assets even when no buyer selects them. Approved but unsold concepts and unpicked designs must remain findable and reusable rather than disappearing inside an old project.

## Style numbers

A ColdLion style number is required only when a user requests ColdLion numbering. Draft or earlier-stage Items may exist without one. When supplied, each merchandise-group component used to request the number must exist and be active.

A failure to obtain a ColdLion style number must not destroy the Item or silently invent a number.

## Classification and descriptions

Product classification follows [`merchandise-and-product-taxonomy.md`](merchandise-and-product-taxonomy.md). A controlled description keeps Product Type, subtype, Licensor, Property, artwork wording, and size as separate facts even when presented as one readable description.

## Prepacks and assortments

**Settled — Albert Hazan, 2026-09-06.** A prepack is not an Item. It is a manifest of the Items packed in a carton. An Item in the creative systems will never map to a prepack, so prepacks belong to the transactional ERP domain and are out of scope for creative Master Data work. Prepacks must be excluded from any population being assessed for missing Licensor or Property, not chased for attribution.

An assortment head and a prepack member are different business objects. The assortment head is the orderable carton and legitimately carries no single Licensor or Property, because it mixes several. The member is a real single-property Item and must carry its own Licensor and Property. Reporting an assortment head as an Item with missing Licensor data is a false defect.

Assortment membership is the controlling test, not the shape of the style number. Style-number length and format correlate with assortment status but misclassify in both directions and must not be used as the rule. Measured on 2026-09-07, the shape heuristic missed **41** assortments carrying normal-looking item numbers and wrongly discarded genuine components. Replacing it with the stock record's own `prepackCode` gave **1,846** prepack heads and **4,662** prepack members with only **3** items in both sets — effectively disjoint, and decidable from evidence rather than from a guess.

### Source authority: ColdLion outranks DesignFlow

**Settled — Albert Hazan, 2026-09-08, given in session and recorded here because it existed nowhere in the repository.** ColdLion is always authoritative over DesignFlow. Where the two disagree on any item fact, ColdLion wins; DesignFlow is a downstream copy and is never the reason to keep a value ColdLion contradicts.

This settles how prepack codes are sourced. The 1,454 prepack codes visible today on the frozen item-master snapshot reached us through DesignFlow, which had itself taken them from ColdLion's own nightly prepack association sync — so the apparent conflict was never ColdLion missing the data, only our reading it at second hand. ColdLion's stock feed carries roughly 7,161 prepack-bearing rows, about five times more. The correct move is therefore to cut over to ColdLion and build the missing loader, not to hold the cutover to protect the stale copy. The loader is tracked at u2giants/popdam3#114; the destination column already exists and is empty.

Do not write placeholder text into a prepack code field to mark rows for later. A placeholder is indistinguishable from a real code to every consumer that reads the column, and an empty column with a tracked loader is the honest state.

### Prepack head and prepack member are two different fields

**Verified 2026-09-07. This matters for prepack work in flight.**
`plm."itemDetail".prepack_code_fk` and `public.erp_items_current.prepack_code`
have similar names and mean opposite things:

| Field | Marks | Share resolving a Property |
|---|---|---|
| `plm."itemDetail".prepack_code_fk` | prepack **members** — the real single-property Items inside a carton | **97.3%** |
| `public.erp_items_current.prepack_code` | prepack **heads** — the orderable assortment carton | **5.2%** |

They are not the same field and must never be treated as interchangeable.
Reading the head field where the member field was meant inverts the answer:
members almost always have a Property, heads almost never do, and that is the
correct behaviour of both. For comparison, items that are neither head nor
member resolve a Property 94.2% of the time.

### Exclusions to apply before counting a "missing Licensor" population

**Settled — owner ruling by Albert Hazan, 2026-09-06:** "take out of this list
anything from 2021 and before. take out anything that is clearly not a product
and probably an ERP artifact (EXTRA COST, GLITTER FEE, REPRINT FEE)."

Items created in 2021 or earlier, and obvious ERP artifacts — extra cost,
glitter fee, reprint fee and similar charge lines — are excluded from any
population being assessed for a missing Licensor or Property.

The exclusions that get forgotten, in the order they bite: **non-licensed
divisions, prepack heads, prepack members, ERP charge lines, uncleaned test
rows.** Missing any one of them inflates the answer by an order of magnitude;
the full worked example, from a headline of thousands down to a single real
product, is in
[`unmapped-licensor-population.md`](unmapped-licensor-population.md).

## Non-inventory items

**Settled - Albert Hazan, 2026-09-07.** Not every row in the Item Master is a
product. Some rows exist only so that a charge, a placeholder, or a consumed
input can be put on an order or a cost record. Those rows are non-inventory
items and must be marked accordingly.

An entry is a non-inventory item when it is any of:

- a **fee or charge** - extra cost, glitter fee, reprint fee, colour corners,
  handling, foil stamp fee, tooling or machine-tool charge, labelling fee,
  sample charge, port charge, repackaging, plate cost, ticketing, discount,
  commission, freight or shipping charge, small-order fee;
- a **raw material or component** consumed into a finished product - lenticular
  material, felt pieces, clear hang tabs, PVC window film. These are physically
  held, but they are inputs, not sellable goods;
- a **sample or test placeholder** that exists to carry a transaction rather
  than to be sold;
- a **digital or downloadable good** that is never stocked.

An entry is an inventory item, and must not be marked non-inventory, when it is
a finished good we sell, **or a store fixture we physically own and hold** -
display racks, rack signage, PDQ units, spinners, brackets, card attachments.
A fixture is not sold, but it is real stock and is counted as such.

The controlling test is whether the entry represents something held and counted
as stock, not whether it is sold. A physical thing we hold is inventory even
when it never reaches a customer; a charge or a consumed input is not inventory
even when it appears on the same order.

### Non-inventory items do not belong in the served product data

**Settled - Albert Hazan, 2026-09-07.** Entries flagged as non-inventory must
not be carried forward into the item data our applications read. They are
bookkeeping entries, not products, and every downstream count, catalogue,
search result, and report that treats them as products is wrong.

This rule governs the served result, not the raw landing copy. The raw copy
from the source system stays complete, because production order lines do
reference charge and material entries and those references must still resolve;
the exclusion is applied when the item data is published for applications to
use. Dropping the rows from the landing copy instead would orphan real order
lines.

The flag is only as good as its maintenance. Until the source data is corrected,
excluding on the flag alone removes far fewer entries than it should - see the
evidence note at the end of this topic.

## What is left after the exclusions is still not a catalogue

**Unknown, measured 2026-09-07.** It is tempting to define the product
catalogue as the Item Master minus prepacks and assortments, minus
non-inventory entries. That subtraction does not produce a catalogue today, for
two reasons, and neither is fixed by correcting the non-inventory flag.

First, there is no marker on the item header that says an entry is a prepack or
an assortment head. The pack-type field carries a single value across every row
and the item-type field is empty on every row, so assortment membership has to
be established from a separate source, not read off the item. The exclusion is
therefore a join against other data, not a filter.

Second, a large body of entries is neither a product, a prepack, nor a
non-inventory charge: entries with no description at all, entries whose
description is keyboard noise, entries named as tests, and entries with no item
number that look like abandoned drafts. Roughly 450 such entries were counted on
2026-09-07. Correcting the non-inventory flag will not touch them, because they
are not charges - they are unfinished or abandoned records.

A defensible catalogue therefore needs a third exclusion for junk and draft
records, and a prepack join, in addition to the non-inventory rule. Until all
three exist, the item list minus the two exclusions is a smaller item list, not
a product catalogue.

## Lifecycle

Stage, lifecycle, next action, owner, blocker, and required evidence are different facts. A single status label must not be made to carry all of them. Every transition that becomes Settled must identify the object, starting and ending state, permitted role, required evidence, next owner, rejection/reversal behavior, and related notifications.

## Implementation and evidence

Application plans and Item Master validation notes may describe screens, endpoints, fields, and proposed transitions. They must link here and to [`product-development-workflow.md`](product-development-workflow.md) instead of becoming separate business authorities.

The ColdLion ERP records assortment membership on the stock record rather than on the item record: an inventory row carrying a prepack code identifies that item as the assortment head, and the prepack manifest lists its member items. The two populations are effectively disjoint. An Item with no stock record carries no assortment evidence either way and must be reported as unconfirmed rather than assumed. The item record itself carries no assortment flag.

The ColdLion ERP carries this distinction as a single-character flag on the item
record, mirrored into our systems as the Item Master's non-inventory field. The
flag is not maintained: as measured on 2026-09-07 only 15 of roughly 19,600 item
records carried it, while at least 35 further entries - including glitter fee,
reprint fee and colour corners - were recorded as ordinary products, and around
4,700 records had the field left blank rather than set either way. A blank or
"not non-inventory" value is therefore evidence of nothing, and this field must
not be used on its own to decide whether a row is a real product until it has
been corrected at source and kept current.
