# Draft reply to ColdLion — 2026-09-01

**For Albert to send to JamieLynn.** AI sessions never send ColdLion mail. Copy everything below
the line as-is. Reply on the existing thread: *RE: FW: Customer Data API — Sales Order & Production
Order API endpoints*.

## Numbering — read before editing this draft

ColdLion has seen issues **1–9**. Issue 9 (item lifecycle flags) went out with the 2026-08-31 reply
and is now answered. **Numbers never change.** Nothing new is opened here.

| Outbound # | Subject | Status in this reply |
|---|---|---|
| 3 | Field descriptions inline | **Closed.** They confirmed merch group can be read from the response |
| 6 | Which document did this row come from? | **Closed.** No marker, but `pickTicketNoString` solved it in practice |
| 7 | `salesOrderLineNo` = 0 / quantity multiplication | **Closed — and we owe them a correction.** It was our misreading |
| 8 | Paged envelope | **Closed.** One factual note about the page-size cap |
| 9 | Item lifecycle flags | **Closed.** Only `active` is in use |

## Why this reply leads with a correction

On 2026-08-31 we told ColdLion that invoiced quantities on five orders were multiplied by about 49×
and called it a live data fault. **It was not.** We were summing `lineInvoiceQty`, which is the
parent prepack total, once per exploded component row. Their prepack explanation reproduces the true
figures exactly. Saying so plainly, first, is worth more to the relationship than any question in
this reply — and per Albert's standing instruction, **no new questions are being spent here.** Two
short factual notes are included only because they cost them nothing to read.

---

Hi JamieLynn,

Thank you — the prepack explanation and the new `orderQty` / `invoiceQty` fields answered several of
our open issues at once, and one of them was our own mistake. Taking that one first.

**Issue 7 — our 49× report was wrong, and I want to retract it clearly.**

We reported that invoiced quantities on orders 7127866, 7127867, 7127870, 7127942 and 7127943 were
multiplied. They were not. We were reading `lineQty` and `lineInvoiceQty` as per-SKU quantities and
summing them across the exploded rows. Your explanation makes it obvious: those are the parent line
totals, repeated on each component row.

Order 7127866 checks out exactly. Prepack PPK2760 returns seven rows, `lineQty` and `lineInvoiceQty`
1,673 on each, `prepackQty` 7, `quantity` 1 — and `orderQty` and `invoiceQty` both 239, which is the
real number of assortments. We also see the seven zero-quantity rows are gone; the order returns
seven rows now instead of fourteen. Apologies for the noise, and thank you for chasing it down
anyway.

We have re-checked your formula across 1,823 order-history rows on 409 sales orders from 2019 to
2026. It reproduces `orderQty` and `invoiceQty` on every prepack row bar one order, and on
non-prepack rows `orderQty` simply equals `lineQty`. **We are switching our loader to use `orderQty`
and `invoiceQty` only, and to take the SKU from `subItemNo` / `subColorCode` / `subLabelCode`
whenever they are populated — exactly as you recommended.**

Two small factual notes on that, no action needed unless you think otherwise:

1. On order **7121892**, lines 1 to 4 (prepacks PPK1008, PPK1009, PPK1010, PPK1011), `lineQty` is 1
   against a `prepackQty` of 4 or 5, so the per-component quantity works out fractional and comes
   back as `orderQty` = 0 on all 17 rows. That looks like correct arithmetic on a partial prepack
   rather than a bug — we are treating it as a rounding artefact, not an empty line. Flagging it only
   so you know we are not reading those as missing data.
2. `salesOrderLineNo` = 0 is now clear to us — it marks a prepack component row. We had it filed as a
   defect; it is not one, and we have closed it.

**Issue 6 — closed, and `pickTicketNoString` did the job.**

Understood that the document type is not available. It turns out we do not need it: with the pick
ticket and invoice numbers both present, the per-stage duplicate rows we were struggling with are
gone. Order 7109618 used to come back as six rows for three lines and now returns three. That was
the actual problem, and it is solved.

Two things we noticed while confirming it, again just so our reading is on record:

- `invoiceNoString` and `pickTicketNoString` sometimes hold more than one number, comma separated —
  order 7126086 returns `6015220,6015221,6015222`. We are parsing them as lists.
- An invoice number can appear on a line whose `invoiceQty` is 0 (order 7121891, lines 8, 10 and 11),
  so we are reading fulfilment from the quantities rather than from the presence of a number.

**Issue 3 — closed.** Thank you for confirming we can take the merchandise group straight from the
response. The inline description fields are working on our side and we have stopped making the second
lookup call.

**Issue 8 — closed.** Paging works on both history endpoints. One note for anyone else who asks: a
request with a large `size` (we tried 5,000) returns 200 rows without an error, so we now always loop
until `last` is true. Not a complaint — just worth knowing the cap is there.

**Issue 9 — thank you for the straight answer.** We will use `active` and drop `itemStatus`,
`itemAvailable` and `itemDiscontinued` entirely. We have noted internally that `active` is not
closely maintained, so we will treat `N` as a genuine signal to stop selling and will not read a
blank as confirmation that an item is still current — we will use our own order and production
history for that. Nothing needed from you on it.

That closes everything open on our side. Thanks again — the prepack detail in particular saved us
from building the loader on a wrong assumption.

Best,
Albert
