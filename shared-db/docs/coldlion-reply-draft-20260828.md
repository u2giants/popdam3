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
| **8** | **NEW — `orderHistory` returns a bare array, not a paged envelope like every other endpoint** | Raised here for the first time |

> ### ⚠️ Correction to our own records, not to ColdLion
> A previous draft of this reply claimed the invoice and shipping fields were empty on historical
> rows. **That was wrong, and it would have re-raised issue 1 after we had already withdrawn it.**
> Re-measured 2026-08-28 across **10,397 order-history rows spanning 2019–2026**: `invoiceNoString`
> and `invoiceDateString` are populated on **72%–99% of rows in every year**, and `shipAmount` on
> 100%. The earlier zero reading was a measurement fault on our side — `orderHistory` returns a bare
> JSON array, and the probe was reading a paged envelope that does not exist. That fault is itself
> issue 8.

---

Hi JamieLynn,

Thank you — the `/divisions` endpoint, the `MgTypeCode` and `Active` documentation, and the size
answer all landed, and we have tested each of them. `/divisions` returns the four divisions cleanly,
and the size code is a single value across our entire catalogue of 19,362 items. Keeping the issue
numbers from our earlier notes so nothing gets lost.

**Issue 2 — closing it, and thank you. Your rule holds.**

You told us that once a line has an invoice number, open and unshipped drop to zero unless we
shipped short or partial. We checked that across 10,397 order-history rows spanning 2019 through
2026. It is exactly right: from 2019 to 2025 the open and unshipped quantities are zero on
effectively every row, and those years carry invoice numbers on 72% to 99% of lines. The only year
where open and unshipped carry real values is 2026 — the orders still in flight. So the historical
zeros are true zeros, not un-backfilled history, and we will load them as real. Nothing further
needed from you on this one.

**Issue 3 — answering your question, and one narrow piece left.**

You asked whether we would prefer lookup APIs for the maintenance tables or the descriptions
directly in the response. **Please put the descriptions directly in the response, and only for
`LabelCode` and `WarehouseCode`.** Inline saves us a second call and saves us both a local copy that
can drift. You already do exactly this for the merchandise groups — `MerchGroup01Desc` through
`MerchGroup06Desc` come back alongside the codes, and it works well. The same pattern for those two
is all we need.

Please do not spend time on `ColorCode` or `DimCode`. `DimCode` is empty on essentially every row we
have pulled, and we do not consume `ColorCode`. Two are enough.

One small note that may save you a step: on the `/items` response the size field is named
`sizeRangeCode`, not `sizeCode` — your answer about it is right, we would just like the documented
name to match. And none of the four maintenance-table codes appears on `/items` at all; they live on
the order-history and production-history responses, so anything you build for them belongs there.

The remainder of issue 3 is small and unchanged: the response fields in the specification still have
no plain-English descriptions. The one that matters most is the merchandise groups. We can read them
through `/merchGroupHeaders` and `/merchGroupDetails`, but only because we worked out for ourselves
that a code's meaning depends on the category it sits under — the same code means different things
in different product families. That is not stated anywhere in the documentation, and it is exactly
the kind of thing that will trip up the next person who integrates with you.

**Issue 6 — your answer explained a great deal, and it leads to one request.**

If the feed assembles the Sales Order, Prepack Detail, Pick Ticket and Invoice, and the line number
is re-assigned at pick and at invoice, then from our side a row does not say which of the four it
is. That means we cannot tell a sales-order row from an invoice row, cannot reliably pick one row
per line, and cannot total a value without risking double-counting — because, as you said, both
prices are real.

Could you add a document-type or source-stage marker to every `orderHistory` row? If the pick-ticket
number and the invoice number are available alongside it, those would help too. **This is the single
change that would move the feed from something we have to interpret into something we can load
directly**, and it would be the most valuable thing on this list.

**Issue 7 — no chase, just acknowledging.** You said the cancelled ones explain most of the zero
line numbers and the invoiced ones are with your technical team. That is fine; we have quarantined
those rows and can wait.

**Issue 8 (new) — `orderHistory` returns a bare array, while your other endpoints return a paged
envelope.**

`/items`, `/divisions` and `/merchGroupHeaders` all return the familiar wrapper with `content`,
`totalElements`, `totalPages` and `last`. `/orderHistory` returns a plain JSON array with none of
that. It is not urgent and we have worked around it, but it caught us out once already: a check we
ran against it silently read nothing and reported a field as empty when it was in fact populated.
Two consequences worth knowing. We cannot ask how many rows a window contains without pulling all of
them, and `page` and `size` appear to have no effect there. If the envelope could be made consistent
across endpoints, it would remove a whole class of quiet mistakes.

Thanks again — the turnaround on the documentation and the new endpoint is appreciated.

Albert
