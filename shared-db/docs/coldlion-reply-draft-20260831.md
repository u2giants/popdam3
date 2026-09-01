# Draft reply to ColdLion — 2026-08-31

**For Albert to send to JamieLynn.** AI sessions never send ColdLion mail. Copy everything below
the line as-is.

## Numbering — read before editing this draft

**ColdLion has only ever seen issues 1–8.** They answered issue 3 and issue 8 on 2026-08-31. The
2026-08-28 internal draft was never sent, so issues 9+ were never used outbound and were free to
reassign. **Never mention a withdrawn question to ColdLion** — you cannot retract something they
never received.

| Outbound # | Subject | Status |
|---|---|---|
| 3 | Field descriptions inline | Closing. One yes/no remainder |
| 6 | Which document did this order-history row come from? | **Open — the lead ask** |
| 7 | `salesOrderLineNo` = 0 on invoiced orders | **RE-OPENED 2026-08-31 with a quantity-multiplication finding** |
| 8 | Bare array instead of a paged envelope | Closing — fixed, verified live |
| **9** | **NEW — which of the four item flags means "stop selling"** | The only new ask |

## What was dropped on 2026-08-31, and why — verified live, not inferred

**The merch-group renumbering cut-over date (was going out as issue 10) is DROPPED. It does not
affect us.** Two findings from a live pull of all 12,922 CW001, 3,883 EH001 and 2,108 SP001 items:

1. **There is no April 2025 signal anywhere, and the "~2025-04-28 CW001" figure in our records has
   no basis in the API.** No merch-group header carries an April 2025 timestamp (CW001 headers are
   2019 for slots 01–06 and 2025-09 for slots 07–10), and `merchGroupDetails` returns **no
   modification timestamps at all**. That date should never have been written down as ours. Albert's
   recollection of mid-May 2025 is much closer to the data.
2. **The only slot whose population actually breaks is slot 07** — and it breaks in **late May 2025**
   for CW001, not April. Daily counts: fully populated through 2025-05-19 (26 of 26 items on 05-14,
   5 of 5 on 05-19), mixed on 05-20 (6 of 12), and zero from 05-21 onward. SP001 breaks a week later
   (full through 05-22, zero from 05-27). EH001 runs the other way — slot 07 is empty all spring and
   only starts in October 2025.
3. **The slots we actually use did not move.** Comparing item records created before vs. on/after
   2025-05-20, slot 05 holds licensors in both periods (DISNEY, MARVEL, NBC, PEANUTS WORLDWIDE,
   WARNER BROS) and slot 06 holds properties in both (MICKEY MOUSE, LILO AND STITCH, PEANUTS, SPIDER
   MAN). **Same kind of value on both sides of the boundary — no re-slotting of licensor or
   property.** So a cut-over date would not change how we read a single field we consume.

**Slots 07–10 (was going out as issue 11) are DROPPED** — owner instruction 2026-08-31: we do not
actively use them. Since slot 07 is also the only slot the renumbering touched, dropping it removes
the last reason to ask about cut-over dates.

**Also found and worth recording:** the item-level category field (`mGCategory`) is **empty on 100%
of items in all three divisions, on every date including today.** Any rule that expects to read a
category off an item record cannot work — the category has to come from the merch-group definitions,
not the item.

Internal numbers 9, 12, 13 and 14 from the 2026-08-28 draft remain dead (item-number rule;
licensor→property and `royaltyCode`, settled by owner ruling §6.6; the five small confirmations).

---

Hi JamieLynn,

Thank you — we pulled both changes and tested them live, and both landed exactly as asked.

**Issue 8 is closed.** Order history and production history now return the same paged envelope as
your other endpoints, and `page` and `size` are honoured.

**Issue 3 is closed bar one small thing.** `LabelDesc` and `WarehouseDesc` are now on order and
production history, and you went further than we asked by adding `MerchGroup01Desc` through
`MerchGroup14Desc` to `/items`. That removes a second lookup call for every one of those fields, and
removes a local copy that could drift. The one remainder is a yes/no: where a merchandise-group
code's meaning depends on the category it sits under, is the description you now return already
resolved against that item's own category? We want to be certain the inline description cannot
disagree with a direct lookup.

We have gone back through our own list and cut it right down — several things we were going to ask
turned out to be answerable from your data or not relevant to us, and it wasn't fair to put them on
your plate. Three things left, and one of them is a return to issue 7 with real examples.

**Issue 6 — a document-type marker on every order-history row. This is the one that matters.**

Your earlier answer explained the cause exactly: the feed assembles Sales Order, Prepack Detail, Pick
Ticket and Invoice, and the line number is re-assigned at pick and again at invoice. The consequence
on our side is that a row does not say which of those four documents it came from. We cannot tell a
sales-order row from an invoice row, we cannot reliably pick one row per line, and we cannot total a
value without risking double-counting — because, as you said, both prices are real.

**Could you add a document-type or source-stage field to every order-history row?** If the
pick-ticket and invoice numbers can come alongside it, better still. Until this exists we cannot load
order history into our system at all — we can only look at it. Everything else could wait a month;
this one can't.

**Issue 9 — which of the four item flags means "stop selling this"?**

An item carries `ItemStatus`, `Active`, `ItemAvailable` and `ItemDiscontinued`, and across our full
catalogue of 19,362 items they disagree with each other: `ItemStatus` is `A` on 6,676 items and blank
on the rest; `Active` is `N` on 459; `ItemDiscontinued` is `Y` on 546; `ItemAvailable` is `N` on 11.

We currently treat `Active` as the answer, which is a guess on our part, and it decides which
products we show as live and sellable. **Which one is authoritative?** And is the blank `ItemStatus`
on two-thirds of the catalogue meaningful, or simply a field that isn't filled in?

**Issue 7 — re-opening the invoiced ones, with examples. The quantity looks multiplied.**

When we raised this you said the cancelled orders explain most of the zero line numbers, and that the
invoiced ones were strange and would go to your technical team. We've now looked at those invoiced
ones properly, and we think we can show you what's happening — it isn't only a missing line number.

We scanned 2,502 order-history rows from January to August 2026. 130 carry `SalesOrderLineNo` = 0,
and **66 of those also carry an invoice number** — spread over just five orders, all invoiced on 30
July 2026. So this is current, not a historical leftover.

Every one of the five behaves the same way. Taking order **7127866**, invoice **6016766**, item
**NHNQ601**: the order quantity is **239**. The feed returns **14 rows** for it, every one with
`SalesOrderLineNo` = 0. Seven of those rows show an invoiced quantity of **1,673**, and the other
seven show **0**. 1,673 is exactly 239 × 7 — and seven is the number of populated rows.

The same relationship holds on all of them:

| Order | Invoice | Item | Order qty | Invoiced qty shown | Rows | Populated rows |
|---|---|---|---|---|---|---|
| 7127866 | 6016766 | NHNQ601 | 239 | 1,673 (= 239 × 7) | 14 | 7 |
| 7127867 | 6016767 | NHNQ601 | 203 | 1,421 (= 203 × 7) | 14 | 7 |
| 7127870 | 6016768 | NHNQ601 | 134 | 938 (= 134 × 7) | 14 | 7 |
| 7127943 | 6016762 | NBXS601 | 259 | 1,554 (= 259 × 6) | 12 | 6 |
| 7127942 | 6016763 | NBXS601 | 149 | 894 (= 149 × 6) | 12 | 6 |

**The invoiced quantity on each row appears to have been multiplied by the number of rows returned.**
Add the rows up and order 7127866 reads as 11,711 units invoiced against an order of 239 — roughly
forty-nine times the real figure. We are fairly confident the true invoiced quantity is simply the
order quantity, but we would not want to assume that on your behalf.

Three questions:

1. **What is the correct invoiced quantity on these five orders** — is it 239, 203, 134, 259 and 149?
2. **Is the multiplication a fault in how the report assembles the rows**, rather than anything wrong
   with the underlying invoice?
3. **Why does `SalesOrderLineNo` come back as 0 on every row of these orders** — not just some of
   them? On a normal order we see real line numbers, so these five look different in kind.

We have quarantined these rows rather than loading them, so nothing is at risk on our side. But it
does mean we cannot trust an invoiced quantity from this feed until we know whether the multiplication
is confined to these cases or can happen elsewhere without being as obvious.

Thanks again. The turnaround on issues 3 and 8 was quick and both were exactly right. If you only
pick up one thing from this note, please make it the document-type marker on order history.

Albert
