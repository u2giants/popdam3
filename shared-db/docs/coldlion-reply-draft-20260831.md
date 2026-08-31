# Draft reply to ColdLion — 2026-08-31

**For Albert to send to JamieLynn.** AI sessions never send ColdLion mail. Copy everything below
the line as-is.

## Numbering — read before editing this draft

**ColdLion has only ever seen issues 1–8.** They answered issue 3 and issue 8 on 2026-08-31.
Issues 9 and above have **never been sent to them** — the 2026-08-28 internal draft was not sent, so
those numbers were never used in the outbound thread and are free.

This reply therefore assigns them fresh, and **there is nothing to withdraw** — you cannot withdraw a
question the other side never received. Never mention a retracted or unsent question to ColdLion.

| Outbound # | Subject | Status in this reply |
|---|---|---|
| 3 | Field descriptions inline vs. lookup | Closing. One yes/no remainder |
| 6 | Order-history rows: which document did this row come from? | **Open — the lead ask** |
| 7 | `salesOrderLineNo` = 0 | Acknowledged, no chase |
| 8 | Bare array instead of a paged envelope | Closing — fixed, verified live |
| **9** | **NEW — which of the four item flags means "stop selling"** | Was internally numbered 12 |
| **10** | **NEW — merch-group renumbering cut-over dates, per division** | Was internally numbered 11 |
| **11** | **NEW — are merch-group slots 07–10 deliberately maintained?** | Was part of internal 10 |

**Internal numbers 9, 12, 13 and 14 from the 2026-08-28 draft are dead** and must not be reused
outbound: the item-number rule (we don't generate item numbers), licensor→property and `royaltyCode`
(owner ruling §6.6 — parentage is hand-curated and may never be derived from product data), and the
five small confirmations (settled, already working, or fields we don't consume). See the gate at the
top of §2 of [`coldlion-open-questions.md`](coldlion-open-questions.md).

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
resolved against that item's own category? We want to be certain the inline description can't
disagree with a direct lookup.

We have kept the rest of this note deliberately short. Three things, in the order they matter to us.

**Issue 6 — a document-type marker on every order-history row. This is the one that matters.**

Your earlier answer explained the cause exactly: the feed assembles Sales Order, Prepack Detail, Pick
Ticket and Invoice, and the line number is re-assigned at pick and again at invoice. The consequence
on our side is that a row does not say which of those four documents it came from. We cannot tell a
sales-order row from an invoice row, we cannot reliably pick one row per line, and we cannot total a
value without risking double-counting — because, as you said, both prices are real.

**Could you add a document-type or source-stage field to every order-history row?** If the
pick-ticket and invoice numbers can come alongside it, better still. Until this exists we cannot load
order history into our system at all — we can only look at it. Everything else on this list could
wait a month; this one can't.

**Issue 9 — which of the four item flags means "stop selling this"?**

An item carries `ItemStatus`, `Active`, `ItemAvailable` and `ItemDiscontinued`, and across our full
catalogue of 19,362 items they disagree with each other: `ItemStatus` is `A` on 6,676 items and blank
on the rest; `Active` is `N` on 459; `ItemDiscontinued` is `Y` on 546; `ItemAvailable` is `N` on 11.

We currently treat `Active` as the answer, which is a guess on our part, and it decides which
products we show as live and sellable. **Which one is authoritative?** And is the blank `ItemStatus`
on two-thirds of the catalogue meaningful, or simply a field that isn't filled in?

**Issue 10 — the merchandise-group renumbering cut-over date, for each division.**

We know the renumbering happened because you told us. What we never had is when. We read approximate
dates off when the group definitions were last modified — POP Creations around late April 2025, Edge
Home and Spruce around September 2025 — but that is our inference, not your record. Those dates
decide which historical rows we can trust as they stand, so if we have them wrong we will misread old
data without ever noticing.

**Could you give us the actual cut-over date per division?** If it was phased rather than a single
date, that's just as useful — we would handle it differently.

**Issue 11 — are merchandise-group slots 07 to 10 deliberately maintained?**

Your headers name them Style Guide, Art Source, Artist and Demographic, and they carry real values on
somewhere between 6% and 27% of items. Before we load them we would like to know whether they are
maintained on purpose and safe to rely on, or partly-populated leftovers we should leave alone. A
one-line answer is plenty.

**Issue 7 — no chase, just acknowledging.** You said cancelled orders explain most of the zero line
numbers and the invoiced ones are with your technical team. That's fine — we've set those rows aside
and can wait.

Thanks again. The turnaround on issues 3 and 8 was quick and both were exactly right. If you only
pick up one thing from this note, please make it the document-type marker on order history.

Albert
