# DRAFT — note to ColdLion re: prodHistory / orderHistory

**Status:** draft for Albert's review. Not sent. Send from Albert, not from an AI session.
**Subject line suggestion:** Questions on the new prodHistory / orderHistory endpoints

---

Hi,

Thanks for opening up `prodHistory` and `orderHistory` on the EhpApi. We're building a
one-time historical load into our reporting database and then a recurring incremental pull,
and both endpoints are returning good data. A few questions came up while we were mapping
the payloads, listed most important first.

**1. Is there a production-order line number we can have?**

This is the one that actually blocks us. On `prodHistory`, a single production order can
return several rows for the same master item and the same component style, and there are two
different reasons for it, which we can't tell apart reliably.

Sometimes the rows are the same purchase repeated, with only the `last*` lookup fields
differing. Example: production order 23825, item AAW2A02, prepack PPK2621 returned 8 rows for
4 component styles, where the only difference between each pair was `lastProdDate`
(2026-01-04 vs 2026-01-08).

Other times the rows are genuinely different buy lines. Example: production order 20907, item
VSZ4803, prepack PPK1020 also returned 8 rows for 4 components, but here one set is for 1,600
packs and the other for 3,000 packs (`prodOrderQty` 1600 vs 3000, `totalPpkQty` 6400 vs
12000). Those are two real lines and both need to be counted.

Today we can only separate the two cases by comparing quantities. That works until an order
has two lines for the same item at the same quantity, at which point a real purchase would
look identical to a repeated row and we would undercount it. A line number or line sequence on
the production order, exposed as a field, would remove the ambiguity completely. Is one
available in the underlying data that could be added to the response?

**2. Is `subUpc` expected to be populated?**

On `orderHistory`, `subUpc` came back empty on every one of the 1,985 prepack component rows
we sampled, across seven separate months between 2019 and 2026. We just want to confirm it's
genuinely unused rather than something we're failing to request, so we know whether to keep a
place for it.

**3. Should the prepack merchandise groups on `prodHistory` be blank as often as they are?**

On `orderHistory`, the component-level groups (`subMerchGroup01`–`06`) are populated
consistently. On `prodHistory`, the equivalent `ppkMerchGroup01`–`14` fields were completely
blank on 140 of 1,774 component rows in the same sample, and partially blank on another 243,
including cases where the very same style code has full groups on the order side. Is that a
known gap on the production side, or a sign we should be joining to the item master for those
values instead of reading them from this payload?

**4. On `orderHistory`, are `lineInvoiceQty` and `lineOpenQty` populated for anyone?**

Both came back as `0` on every one of the 5,874 rows we sampled, across all four divisions and
all seven months, while `lineQty` and `lineCancelledQty` are populated normally. We'd rather
confirm they're simply not carried on this endpoint than build a report on them and quietly
read zero everywhere. Same question, less urgently, for `depositPerc` on `prodHistory`, which
was `0` on all 3,411 rows.

**5. Paging and rate limits for a large historical pull.**

Both endpoints return a plain JSON array rather than the paged envelope the other endpoints
use, and they appear to ignore `page` and `size`, so we're planning to chunk purely by date
window. Two things would help us be good citizens:

- Is there a maximum date range or row count you'd like us to stay under per request?
- Is there a time window you'd prefer we run a bulk historical pull in, and a request rate
  you'd like us to stay below? We're planning small sequential requests with a pause between
  them, deliberately spread over a weekend, and we're happy to work to whatever limits suit
  you. Response times we've seen range from under a second to about 50 seconds on older
  months, so we'd rather not run anything in parallel without your say-so.

**6. Two smaller confirmations.**

- `1900-01-01` appears in date fields where we'd expect "not set" (for example
  `shipCancelDate`, `udfDate01`). Confirming that's your empty-date marker so we store it as
  empty rather than as a real 1900 date.
- On `prodHistory`, `salesOrderNo` is sometimes `0`. We're reading that as "this production
  order isn't tied to a specific sales order" rather than a missing link. Is that right?

Thanks very much,
Albert

---

## Notes for the session sending this (not part of the note)

- Q1 is the only true blocker. Q2, Q3 and Q5 are confirmations that change how we model
  fields, not whether we can load. Q4 is courtesy plus rate-limit safety.
- Every number quoted above is from the probe runs recorded in
  [`coldlion-history-endpoints-shape.md`](../coldlion-history-endpoints-shape.md). If that
  doc is re-verified and the numbers move, update them here before sending.
- Do not include the API key, the key's 1Password location, or any internal system names.
