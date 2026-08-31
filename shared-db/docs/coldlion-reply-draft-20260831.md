# Draft reply to ColdLion — 2026-08-31

**For Albert to send to JamieLynn.** AI sessions never send ColdLion mail. Copy the block below
the line as-is.

**Numbering is continuous with our earlier notes** (see
[`coldlion-reply-draft-20260828.md`](coldlion-reply-draft-20260828.md)). Nothing below is a new
issue number — this recaps what's still open and closes out what you just fixed.

| # | Meaning in this thread | State in this reply |
|---|---|---|
| 3 | Documentation: field descriptions inline vs. lookup | **Closing the main ask — you did exactly what we requested.** One narrow follow-up left |
| 6 | No document-type marker on `orderHistory` rows | Still open, still our top priority |
| 7 | `salesOrderLineNo` = 0 on invoiced orders | With your tech team; no chase |
| 8 | `orderHistory`/`prodHistory` returned bare arrays, not paged | **Closing — fixed and verified.** |
| 9 | Item-number construction rule | Still open |
| 10 | Merch-group scoping and slots 7–14 | Still open |
| 11 | Renumbering cut-over dates, per division | Still open |
| 12 | Four overlapping item lifecycle flags | Still open |
| 13 | Licensor-to-property relationship | Still open |
| 14 | Five small confirmations | Still open |

---

Hi JamieLynn,

Thank you — we pulled the changes and tested them live. Both landed exactly as asked:

**Issue 3 — closing the main ask.** `LabelDesc` and `WarehouseDesc` are now on `orderHistory` and
`prodHistory`, and `MerchGroup01Desc` through `MerchGroup14Desc` are now on `/items`. That removes
the second lookup call we were making for every one of those fields, and removes a whole class of
local-copy drift. One small piece remains: when a code's meaning depends on `MgCategory` (which we
believe applies to slots 1–3 only, per issue 10), does the inline `Desc` you're now returning already
account for that scoping, or could it disagree with a raw `/merchGroupDetails` lookup for those three
slots? A yes/no is enough.

**Issue 8 — closing.** `orderHistory` and `prodHistory` now return the same paged envelope as your
other endpoints, and `page`/`size` are honored. Verified live. Thank you.

Everything else on our list from before is still open and unchanged since our last note — repeating
it here so nothing gets lost, not because anything changed:

**Issue 6 — still the most valuable item on this list.** A document-type or source-stage marker on
every `orderHistory` row (sales order vs. prepack vs. pick ticket vs. invoice), and the pick-ticket
and invoice numbers alongside it if available. Without it we cannot tell which of the four documents
a row came from, cannot reliably pick one row per line, and cannot total anything safely.

**Issue 7 — no chase, just acknowledging.** Cancelled orders explain most of the zero line numbers;
the invoiced ones are with your tech team. We'll wait.

**Issue 9 — the item-number construction rule.** We reverse-engineered it (Type/Sub-Type/Sub-Sub-Type
character, then size, licensor, property, then a sequence) and it reproduces about 90% of recently
created numbers. Please confirm or correct the rule, and tell us what explains the other 10%.

**Issue 10 — merch-group scoping and slots 7–14.** Confirm `MgCategory` scopes meaning for slots 1–3
only; confirm whether slots 7–10 (Style Guide / Art Source / Artist / Demographic) are deliberately
maintained and worth loading; confirm whether slots 11–14 are reserved or dead; and confirm that
reading `/merchGroupHeaders` per division (rather than assuming one fixed layout) is the right
approach, since Edge Home's slots 5–7 mean something different from POP Creations' and Spruce's.

**Issue 11 — the renumbering cut-over dates, per division.** We backed into approximate dates from
group-definition modify times (POP Creations ~28 April 2025, Edge Home and Spruce ~September 2025).
These decide which historical rows we trust as-is, so the real dates — or confirmation it was phased
— would help.

**Issue 12 — which of the four lifecycle flags is authoritative.** `ItemStatus`, `Active`,
`ItemAvailable`, `ItemDiscontinued` disagree with each other across the catalogue. We currently use
`Active`, which is a guess. Which one means "stop selling this," and does the blank `ItemStatus` on
about two-thirds of items mean anything?

**Issue 13 — is the licensor-to-property relationship held anywhere in the ERP?** We derived it by
hand from which licensor's items carry each property, including about 40 properties we filled in from
our own knowledge because they have no items yet. Also: what is `RoyaltyCode`, and does it or the
licensor merchandise group govern licensing?

**Issue 14 — five small confirmations**, unchanged from before: whether `CreatedUser = WebAPI`
reliably marks API-created items; whether a `prodHistory` call with no stage is meant to return only
issued lines; what `Udf01`'s values mean; whether `BrandAssuranceNo` is the licensor's artwork
approval reference; and whether `ProdReferenceNo` links a sales-order line to its production order.

Thanks again for the quick turnaround on issue 3 and issue 8 — both are exactly what we asked for.
Same order of value as before if you're picking where to start next: the source-document marker on
order history (issue 6), the item-number rule (issue 9), and the renumbering dates (issue 11).
Everything else can wait.

Albert
