# Draft reply to ColdLion — 2026-08-28

**For Albert to send to JamieLynn.** AI sessions never send ColdLion mail. Copy the block below
the line as-is.

**Numbering is continuous with our outbound thread.** Issues 1–7 keep their meaning; new points
start at 8.

| # | Meaning in this thread | State in this reply |
|---|---|---|
| 1 | "Nothing in `orderHistory` reports shipping or invoicing" | Withdrawn 2026-08-27; **confirmed withdrawn** — see the correction note below |
| 2 | Do the quantity formulas mean anything on historical rows? | **Closing it.** Their rule verified against 10,397 rows |
| 3 | Documentation: allowed values and field descriptions | Largely answered; **our reply to their maintenance-table question**, plus a narrow remainder |
| 4 | Malformed 7-day range error | Withdrawn 2026-08-27; nothing further |
| 5 | Negative quantities | Answered 2026-08-28; closed |
| 6 | No unique key; the same line comes back more than once | Answered — **and this is the follow-up ask that falls out of it** |
| 7 | `salesOrderLineNo` = 0 | With their tech team; acknowledged, no chase |
| **8** | **NEW — `orderHistory` returns a bare array, not a paged envelope** | Raised here for the first time |
| **9** | **NEW — the item-number construction rule** | We reverse-engineered it; asking them to state it |
| **10** | **NEW — how merchandise-group codes are scoped, and what slots 7–10 are for** | We inferred it, and we were partly wrong |
| **11** | **NEW — the renumbering dates, per division** | We backed into them from timestamps |
| **12** | **NEW — four overlapping item lifecycle flags** | We picked one; asking which is authoritative |
| **13** | **NEW — is the licensor-to-property relationship held anywhere?** | We inferred ~40 of them by hand |
| **14** | **NEW — five small confirmations** | Each is a working assumption of ours |

> ### ⚠️ Corrections to our own records, not to ColdLion
>
> **(a) The invoice and shipping fields are NOT empty on history.** A previous draft claimed they
> were, which would have re-raised issue 1 after we withdrew it. Re-measured across **10,397
> order-history rows spanning 2019–2026**: `invoiceNoString` and `invoiceDateString` are populated on
> **72%–99% of rows in every year**, `shipAmount` on 100%. The earlier zero reading was our own
> measurement fault — the probe expected a paged envelope that `orderHistory` does not return. That
> fault became issue 8.
>
> **(b) Merchandise-group slots 7–14 are not "legacy positions".** Our business rules said so. They
> are wrong. `/merchGroupHeaders` names them: **07 Style Guide, 08 Art Source, 09 Artist, 10
> Demographic**, and they carry data on 5.7%–27.2% of items. Slots 11–14 have no header and no data.
>
> **(c) Slot 03 is "Sub-Sub-Type", not "material or embellishment".** Our label was an inference from
> reading the values, and it is not what ColdLion calls it.
>
> **(d) Slots 05, 06 and 07 do not mean the same thing in every division.** In POP Creations and
> Spruce they are Licensor, Property and Style Guide. **In Edge Home they are Big Theme, Little Theme
> and Art Type.** Any logic that reads slot 05 as "licensor" across all divisions is wrong.

---

Hi JamieLynn,

Thank you — the `/divisions` endpoint, the `MgTypeCode` and `Active` documentation, and the size
answer all landed, and we have tested each of them. `/divisions` returns the four divisions cleanly,
and the size code is a single value across our entire catalogue of 19,362 items. Keeping the issue
numbers from our earlier notes so nothing gets lost.

Most of what follows is one kind of request. Over the past two weeks we have worked a number of
things out from the data itself — how item numbers are built, when the merchandise groups were
renumbered, which flag really means "this product is dead". Each of those is a guess that currently
matches the data, and a guess that matches the data is exactly the kind of thing that quietly stops
matching one day. **Where you can simply confirm or correct a sentence, that is worth more to us
than any new field.** We have written down what we currently believe so a wrong belief is easy for
you to knock down.

## Closing and answering

**Issue 2 — closing it, and thank you. Your rule holds.**

You told us that once a line has an invoice number, open and unshipped drop to zero unless we
shipped short or partial. We checked that across 10,397 order-history rows spanning 2019 through
2026. It is exactly right: from 2019 to 2025 the open and unshipped quantities are zero on
effectively every row, and those years carry invoice numbers on 72% to 99% of lines. The only year
where open and unshipped carry real values is 2026 — the orders still in flight. So the historical
zeros are true zeros, and we will load them as real. Nothing further needed from you.

**Issue 3 — answering your question, and one narrow piece left.**

You asked whether we would prefer lookup APIs for the maintenance tables or the descriptions
directly in the response. **Please put the descriptions directly in the response, and only for
`LabelCode` and `WarehouseCode`.** Inline saves us a second call and saves us both a local copy that
can drift. You already do exactly this for the merchandise groups — `MerchGroup01Desc` through
`MerchGroup06Desc` come back alongside the codes, and it works well. The same pattern for those two
is all we need.

Please do not spend time on `ColorCode` or `DimCode`. `DimCode` is empty on essentially every row we
have pulled, and we do not consume `ColorCode`. Two are enough.

One note that may save you a step: on the `/items` response the size field is named `sizeRangeCode`,
not `sizeCode` — your answer about it is right, we would just like the documented name to match. And
none of the four maintenance-table codes appears on `/items` at all; they live on the order-history
and production-history responses, so anything built for them belongs there.

The remainder of issue 3 is unchanged: the response fields in the specification still have no
plain-English descriptions.

**Issue 6 — your answer explained a great deal, and it leads to one request.**

If the feed assembles the Sales Order, Prepack Detail, Pick Ticket and Invoice, and the line number
is re-assigned at pick and at invoice, then from our side a row does not say which of the four it
is. We cannot tell a sales-order row from an invoice row, cannot reliably pick one row per line, and
cannot total a value without risking double-counting — because, as you said, both prices are real.

Could you add a document-type or source-stage marker to every `orderHistory` row? If the pick-ticket
number and the invoice number are available alongside it, those would help too. **This is the single
change that would move the feed from something we interpret into something we can load directly**,
and it is the most valuable item on this list.

**Issue 7 — no chase, just acknowledging.** You said the cancelled ones explain most of the zero
line numbers and the invoiced ones are with your technical team. That is fine; we have quarantined
those rows and can wait.

## New

**Issue 8 — `orderHistory` returns a bare array, while your other endpoints return a paged
envelope.**

`/items`, `/divisions` and `/merchGroupHeaders` all return the familiar wrapper with `content`,
`totalElements`, `totalPages` and `last`. `/orderHistory` returns a plain JSON array with none of
it. Not urgent, and we have worked around it, but it caught us out once: a check we ran silently read
nothing and reported a field as empty when it was in fact populated. We also cannot ask how many rows
a window holds without pulling all of them, and `page` and `size` appear to have no effect there. A
consistent envelope would remove a whole class of quiet mistakes.

**Issue 9 — the item-number construction rule. Please confirm or correct it.**

We worked out that an item number is assembled from the merchandise groups rather than allocated
freely — the first character being the Type's `ItemNoCode`, the second the Sub-Type's, the third the
Sub-Sub-Type's, then size, then licensor, then property, then a sequence number. **That rule
reproduces 3,456 of 3,853 recently-created item numbers, about 90%.**

Two questions. Is that the actual rule, and are we describing the positions correctly? And what are
the remaining 10% — older numbers issued under a previous scheme, manually assigned exceptions, or
have we got a position wrong? We would rather be told the rule than keep inferring it, because we
use it to sanity-check items whose merchandise groups look wrong.

**Issue 10 — how merchandise-group codes are scoped, and what slots 7 to 10 are for.**

Three things here, and we got at least one of them wrong on our own.

First: a merchandise-group code is not unique by itself. The same code means different things
depending on the `MgCategory` it sits under — the same Sub-Type code reads one way under one Type
and another way under another. We found that by accident. It appears to apply to slots 1, 2 and 3
only; the category comes back empty on licensor and property. **Is that right, and could it be
stated in the documentation?** Anyone integrating with you who looks a code up without the category
will silently get the wrong answer.

Second: we had recorded slots 7 to 14 as leftovers from the renumbering. That was wrong. Your
headers name them Style Guide, Art Source, Artist and Demographic, and they carry real values on
between 6% and 27% of items. **Are those four maintained deliberately and worth loading, or are they
partly-populated and best ignored?** We would rather ask than guess a second time.

Third: slots 11 to 14 exist as fields on the item, have no header and no values anywhere. **Are they
reserved for future use, or dead?**

And a related one: the slots do not mean the same thing in every division. In POP Creations and
Spruce, slots 5, 6 and 7 are Licensor, Property and Style Guide. In Edge Home they are Big Theme,
Little Theme and Art Type. We now read the headers per division rather than assuming — **please
confirm that reading the headers per division is the correct approach**, and that the meanings can
diverge like that by design.

**Issue 11 — the merchandise-group renumbering dates, per division.**

We know the renumbering happened, because you told us, and because rows before it carry values in
different slots. But we do not have the dates from you — we inferred them from when the group
definitions were last modified: **POP Creations around 28 April 2025, Edge Home and Spruce around
September 2025**. Those dates are load-critical, because they decide which rows we trust as-is and
which we treat as pre-change.

**Could you give us the actual cut-over date for each division?** If there was no single date and it
was phased, that is just as useful to know — we would handle it differently.

**Issue 12 — four item flags that overlap, and we do not know which one is authoritative.**

An item carries `ItemStatus`, `Active`, `ItemAvailable` and `ItemDiscontinued`. Across our full
catalogue of 19,362 items they disagree in ways we cannot resolve from outside: `ItemStatus` is `A`
on 6,676 items and blank on the rest; `Active` is `N` on 459; `ItemDiscontinued` is `Y` on 546;
`ItemAvailable` is `N` on 11.

**Which one should we treat as "do not sell this any more"?** And is the blank `ItemStatus` on
two-thirds of the catalogue meaningful, or simply a field nobody fills in? We currently use `Active`,
which is a guess.

**Issue 13 — is the relationship between a licensor and its properties held anywhere in the system?**

We need to know which licensor owns which property — that Warner Bros. owns one title and Universal
another. The property list gives us the codes and names, but nothing that points back to a licensor.
So we derived the link by looking at which licensor code appears on items carrying each property,
and **for around forty properties with no items yet, we filled it in by hand from our own
knowledge**. That is exactly the sort of thing that will be wrong somewhere and we will not find out
until it matters.

**Is that relationship maintained anywhere in the ERP?** There is also a `RoyaltyCode` on the item,
whose values look like licensor codes and overlap the licensor merchandise group without matching it
everywhere. **What is `RoyaltyCode` for, and which of the two should we trust for licensing?**

**Issue 14 — five small confirmations. A yes or no on each is plenty.**

1. Items created through the API show `CreatedUser` as `WebAPI`. We use that to identify them. Is
   that reliable, or can a person's name appear on an API-created item?
2. A production-history request with no stage returns only issued lines — not everything. We found
   that the hard way and now always iterate the three stages. Is that the intended default?
3. `Udf01` carries `LIC` (1,324), `EP` (506), `DEC` (134), `GKC` (110) or `WB` (2) on about 2,080
   items and is blank elsewhere. What is it?
4. We read `BrandAssuranceNo` as the licensor's approval reference for the artwork. Correct?
5. We read `ProdReferenceNo` as the link from a sales-order line to the production order that made
   the goods. Correct?

Thanks again — the turnaround on the documentation and the new endpoint is appreciated, and we know
this is a long list. If it helps, the order of value to us is: the source-document marker on order
history (issue 6), the item-number rule (issue 9), and the renumbering dates (issue 11). Everything
else can wait.

Albert
