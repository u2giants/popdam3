# Draft reply to ColdLion — 2026-08-31

**For Albert to send to JamieLynn.** AI sessions never send ColdLion mail. Copy the block below
the line as-is.

**This reply deliberately shortens the list.** The 2026-08-28 draft
([`coldlion-reply-draft-20260828.md`](coldlion-reply-draft-20260828.md)) carried issues 9–14. Most
of those are withdrawn here — not because ColdLion answered them, but because they were already
settled on our side or are not things we need from ColdLion at all:

| # | Was | Now | Why |
|---|---|---|---|
| 3 | Descriptions inline vs. lookup | **Closing.** One yes/no left | ColdLion delivered it 2026-08-31, verified live |
| 6 | Document-type marker on `orderHistory` | **Still open — the one that matters** | Nothing else can substitute; the load is blocked without it |
| 7 | `salesOrderLineNo` = 0 | Acknowledged, no chase | With their tech team |
| 8 | Bare array, not paged | **Closing.** Fixed, verified live | — |
| 9 | Item-number construction rule | **WITHDRAWN — do not ask** | We do not generate item numbers; ColdLion does. Our ~90% rule is a sanity check, not a need |
| 10 | MG scoping + slots 07–14 | **Reduced to one question** | `mgCategory` resolution is settled by owner ruling 2026-08-27; slots 11–14 have no data, treat as absent. Only "are 07–10 maintained?" is a real ask |
| 11 | Renumbering cut-over dates | **Still open — kept** | Load-critical, and our back-derived CW001 date (~2025-04-28) conflicts with the owner-ruled May 13 2025 category boundary |
| 12 | Four lifecycle flags | **Still open — kept** | We use `active` and it is a guess; it decides what we treat as sellable |
| 13 | Licensor→property; `royaltyCode` | **WITHDRAWN — do not ask** | Owner ruling §6.6 (2026-08-03): parentage is hand-curated in DB Data Admin and may **never** be derived from product data. The ERP's answer is irrelevant to us. We do not consume `royaltyCode` |
| 14 | Five small confirmations | **WITHDRAWN — do not ask** | `prodReferenceNo` settled by owner ruling 2026-08-17 (COS suffix, 1,047 rows). `createdUser=WebAPI` already works in production use. The `prodHistory` stage default is already worked around. We do not consume `udf01` or `brandAssuranceNo` |

**Three asks go out, in priority order: issue 6, issue 12, issue 11.** Plus two yes/no confirmations
that cost them nothing.

---

Hi JamieLynn,

Thank you — we pulled both changes and tested them live, and both landed exactly as asked.

`LabelDesc` and `WarehouseDesc` are now on order and production history, and `MerchGroup01Desc`
through `MerchGroup14Desc` are now on `/items`. That removes a second lookup call for every one of
those fields. And order and production history now return the same paged envelope as your other
endpoints, with `page` and `size` honored. **Issues 3 and 8 are closed on our side.**

We have also gone back through our own list and cut it down. Several of the questions in our last
note turned out to be things we had already decided internally, or fields we do not actually
consume, and it was not fair to keep them on your plate. **Consider issues 9, 13 and 14 withdrawn —
please don't spend any time on them.** What follows is the short list of what we genuinely need.

**Issue 6 — the one that matters. A document-type marker on every order-history row.**

This is still the single change that would unblock us, and nothing else on this list comes close.

Your answer explained the cause perfectly: the feed assembles Sales Order, Prepack Detail, Pick
Ticket and Invoice, and the line number is re-assigned at pick and at invoice. That means from our
side a row does not say which of the four documents it came from. We cannot tell a sales-order row
from an invoice row, cannot reliably pick one row per line, and cannot total a value without risking
double-counting — because, as you said, both prices are real.

**Could you add a document-type or source-stage field to every `orderHistory` row?** If the
pick-ticket and invoice numbers can come alongside it, better still. Until this exists we cannot
load order history at all — we can only look at it.

**Issue 12 — which of the four item flags means "stop selling this"?**

An item carries `ItemStatus`, `Active`, `ItemAvailable` and `ItemDiscontinued`, and across our full
catalogue of 19,362 items they disagree: `ItemStatus` is `A` on 6,676 and blank on the rest; `Active`
is `N` on 459; `ItemDiscontinued` is `Y` on 546; `ItemAvailable` is `N` on 11.

We currently use `Active`, which is a guess, and it decides what we treat as a live sellable product.
**Which one is authoritative?** And is the blank `ItemStatus` on two-thirds of the catalogue
meaningful, or just a field nobody fills in?

**Issue 11 — the merchandise-group renumbering cut-over date, per division.**

We never had these from you; we read them off when the group definitions were last modified — POP
Creations around late April 2025, Edge Home and Spruce around September 2025. They decide which
historical rows we trust as-is, so a wrong date means we mis-read old data silently.

**Could you give us the actual cut-over date for each division** — or tell us it was phased rather
than a single date, which we would handle differently?

**Two quick yes/no confirmations, if they're easy:**

1. The new inline `MerchGroup01Desc`–`MerchGroup14Desc`: for the slots where a code's meaning depends
   on its `MgCategory`, is the description you return already resolved against that item's own
   category? We want to be sure it can't disagree with a direct `/merchGroupDetails` lookup.
2. Slots 07–10 (Style Guide, Art Source, Artist, Demographic) carry values on roughly 6% to 27% of
   items. Are those four deliberately maintained and safe for us to load, or partly-populated and
   better ignored?

**Issue 7 — no chase, just acknowledging.** Cancelled orders explain most of the zero line numbers
and the invoiced ones are with your technical team. We have quarantined those rows and can wait.

Thanks again — the turnaround on issue 3 and issue 8 was quick and both were exactly right. If you
only pick up one thing from this note, please make it the document-type marker on order history.

Albert
