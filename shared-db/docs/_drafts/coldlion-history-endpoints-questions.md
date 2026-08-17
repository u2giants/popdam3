# DRAFT — note to ColdLion re: prodHistory / orderHistory

**Status:** draft for Albert's review. Not sent. Send from Albert, not from an AI session.
**Subject line suggestion:** Questions on the new prodHistory / orderHistory endpoints

> ### ✅ 2026-08-17 — ColdLion already answered two of these; both are now REMOVED from the note
>
> - **Production-order line number** (was Q1, the blocker): they added **`prodLineSeq`** and now
>   select the maximum `lastProdDate`. Verified live.
> - **Paging / rate limits** (was Q5): `fromDate`–`toDate` must be **within 7 days inclusive**;
>   ~2 seconds per window from their office. Verified live.
>
> **Do not re-ask either.** Detail and evidence:
> [`coldlion-history-endpoints-shape.md`](../coldlion-history-endpoints-shape.md) §2, §3, §4.3.
> What remains below is four field-modelling confirmations plus two new observations from their
> changes. **Nothing here blocks the historical load** — send it when convenient.

---

Hi,

Thanks for adding `prodLineSeq` and the 7-day window limit so quickly — we've confirmed both on
our side. `prodLineSeq` resolves the duplicate-row question completely: production order 23825
now returns 4 rows for its 4 component styles instead of 8, and separate buy lines on one order
are cleanly distinguishable. The 7-day windows come back in about a second for us, so a chunked
historical pull is straightforward now.

A few smaller questions remain from mapping the payloads. **None of these blocks us**, they just
determine how we store each field.

**1. Is `subUpc` expected to be populated?**

On `orderHistory`, `subUpc` came back empty on every one of the 1,985 prepack component rows
we sampled, across seven separate months between 2019 and 2026. We just want to confirm it's
genuinely unused rather than something we're failing to request, so we know whether to keep a
place for it.

**2. Should the prepack merchandise groups on `prodHistory` be blank as often as they are?**

On `orderHistory`, the component-level groups (`subMerchGroup01`–`06`) are populated
consistently. On `prodHistory`, the equivalent `ppkMerchGroup01`–`14` fields were completely
blank on 140 of 1,774 component rows in the same sample, and partially blank on another 243,
including cases where the very same style code has full groups on the order side. Is that a
known gap on the production side, or a sign we should be joining to the item master for those
values instead of reading them from this payload?

**3. On `orderHistory`, are `lineInvoiceQty` and `lineOpenQty` populated for anyone?**

Both came back as `0` on every one of the 5,874 rows we sampled, across all four divisions and
all seven months, while `lineQty` and `lineCancelledQty` are populated normally. We'd rather
confirm they're simply not carried on this endpoint than build a report on them and quietly
read zero everywhere. Same question, less urgently, for `depositPerc` on `prodHistory`, which
was `0` on all 3,411 rows.

**4. On `prodHistory`, does `salesOrderNo = 0` mean "not tied to a sales order"?**

Examples below, as requested. First, what we can see from our side, because it may narrow the
search: **`salesOrderNo = 0` and `custPONumber` being empty go together perfectly.** Across 1,047
rows sampled from five separate weeks between 2019 and 2026:

- 550 rows had `salesOrderNo = 0`. **All 550** had an empty `custPONumber`, `custStartDate` and
  `custCancelDate`.
- 497 rows had a real `salesOrderNo`. **All 497** had `custPONumber` populated.

There is no overlap either way, which is what makes us think it is one deliberate state rather
than sporadically missing data.

What we did **not** expect: `customerCode` is still populated on **534 of those 550** rows
(MOD010, OLL629, ROS010 and so on). So a customer is named even though no sales order is. That is
why we would rather ask than assume — "no customer order" and "customer known but no order raised"
are different things for our reporting.

One pattern that might be the lead you need: **95 of the 550 have a `prodReferenceNo` ending in
`COS`** (D2296COS, D2954COS, D3161COS...), and **not one** of the 497 linked rows does. Several of
those lines are clearly not regular production — item `SAMPLECHRG` "SAMPLE CHARGE", item
`FOILCORNER` "FOIL CORNERS", quantities of 4, 5 or 15. Others look like perfectly ordinary
production runs of thousands of units.

The rate also varies enormously by week, which we cannot explain: 91% of rows in the first week of
June 2019, 0% in the first week of July 2024, 64% in the first week of August 2026.

**Examples, one per week sampled, all `companyCode=EDGEHOME`:**

| Production order | Line | Reference | Division | Ordered | Item | Qty | Vendor | Customer |
|---|---|---|---|---|---|---|---|---|
| 20015 | 1 | d0557 | CW001 | 2019-06-03 | VSZ851B | 1600 | 417 | MOD010 |
| 20016 | 1 | d0561 | CW001 | 2019-06-03 | VSZ851B | 1600 | 417 | MOD010 |
| 20818 | 1 | b0247 | EP001 | 2021-03-03 | ACMPRM1 | 15600 | SKPHL | *(blank)* |
| 20821 | 41 | D1201 | CW001 | 2021-03-01 | HGP83DYMM01 | 12 | CNFLW | BIG226 |
| 22233 | 3 | D2296COS | CW001 | 2023-11-08 | VSM93DYNX04 | 5 | CNJAM | MOD010 |
| 22236 | 4 | D2313 | CW001 | 2023-11-07 | SAMPLECHRG | 1 | CNJAM | HLL770 |
| 23353 | 1 | D2996COS | CW001 | 2025-04-09 | MQZ48DYLS01 | 4 | CNDWG | ROS010 |
| 23852 | 12 | D3321 | CW001 | 2026-01-08 | FOILCORNER | 7600 | CNHDL | MOD010 |
| 24187 | 1 | D3161COS | SP001 | 2026-08-03 | SDX00WBLR01S | 15 | INHDW | BOX030 |
| 24189 | 1 | D3415COS | SP001 | 2026-08-03 | NKR06DYMM01 | 4 | CNQJM | BOX030 |

For contrast, a normal linked row from the same period: production order **23825**, line 3,
reference D3320, item AAW2A02, `salesOrderNo` 7127555, `custPONumber` 668120603.

So the question is really two: is `0` a deliberate "no sales order for this line", and if so, is
there a rule we can apply — the `COS` reference suffix, a production type, something else — that
tells us *why* a given line has none? We would rather report these correctly than lump them in
with ordinary customer orders or drop them.

**5. Two small things we noticed in the new behaviour, in case they're useful to you.**

- When a date range is wider than 7 days, the refusal comes back as HTTP 400 on the wire, but the
  JSON body says `"status": 500` and `"error": "Internal Server Error"`, with the actual
  explanation in `message`. We're handling it fine, but a client that trusts the body would treat
  a permanent input error as a temporary server fault and keep retrying it.
- `lastProdCost` still comes back twice for a few older orders where two production records share
  the same latest `lastProdDate` — for example order 20872, line 1, component CTZHS0MSC01, with
  3.09 and 3.64. `prodLineSeq` means this no longer causes us any trouble; flagging it only in
  case the de-duplication was meant to cover it.

**6. One planning question, whenever convenient.**

How far back does the history go? We've pulled data as early as June 2019 successfully and haven't
looked further back. Knowing the earliest date with real data would let us size the one-time load
exactly instead of scanning for the boundary.

Thanks very much,
Albert

---

## Notes for the session sending this (not part of the note)

- **Nothing in this note blocks the load any more.** The two blockers (line number, rate limits)
  were answered on 2026-08-17 and removed. Q1–Q4 change how we model individual fields; Q5 is
  courtesy feedback on their new behaviour; Q6 sizes the one-time pull.
- Q6 is the only one whose answer we actually need before the historical load finishes, and even
  then only to avoid scanning backwards for the earliest data ourselves.
- Every number quoted above is from the probe runs recorded in
  [`coldlion-history-endpoints-shape.md`](../coldlion-history-endpoints-shape.md). If that
  doc is re-verified and the numbers move, update them here before sending.
- Do not include the API key, the key's 1Password location, or any internal system names.
