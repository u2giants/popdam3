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

**4. On `prodHistory`, what does `salesOrderNo = 0` mean on non-sample production?**

Thank you for the explanation of the `COS` suffix — contractual samples for the licensor and DAVID
samples for ourselves. That fits what we see exactly: those lines run 3 to 15 pieces against a
median of 2,000 on ordinary lines, and they are all unlinked, which now makes sense. We will report
them separately from customer purchases. **No further questions on `COS`.**

What we are still unsure about is the much larger group that has no sales order and **no** `COS`
marker. In a sample of 1,047 rows across five weeks between 2019 and 2026:

- 497 rows had a real `salesOrderNo`.
- 550 had `salesOrderNo = 0`. Of those, **95 are the `COS` sample lines** you described — understood.
- The remaining **455 rows (248 distinct order-lines)** are unlinked, not `COS`, and look like
  perfectly ordinary production: quantities from 1 to 15,600 with a **median of 430**, mostly
  `POECA` and `POE` production types in division `CW001`, with a customer named on nearly all of
  them.

Examples of that remaining group, all `companyCode=EDGEHOME`:

  Order 20016, line 1, ref d0561, CW001, 2019-06-03, item VSZ851B, qty 1600, vendor 417, customer MOD010
  Order 20016, line 2, ref d0561, CW001, 2019-06-03, item VSZ851C, qty 1000, vendor 417, customer MOD010
  Order 20017, line 1, ref d0553, CW001, 2019-06-03, item VSZ851B, qty 1600, vendor 417, customer MOD010
  Order 20818, line 1, ref b0247, EP001, 2021-03-03, item ACMPRM1, qty 15600, vendor SKPHL, customer (blank)
  Order 20821, line 41, ref D1201, CW001, 2021-03-01, item HGP83DYMM01, qty 12, vendor CNFLW, customer BIG226
  Order 23852, line 12, ref D3321, CW001, 2026-01-08, item FOILCORNER, qty 7600, vendor CNHDL, customer MOD010

For contrast, a normal linked row: order 23825, line 3, ref D3320, item AAW2A02,
`salesOrderNo` 7127555, `custPONumber` 668120603.

Two other observations that may help:

- The correlation with `custPONumber` is perfect in both directions. Every one of the 550 unlinked
  rows also has an empty `custPONumber`, `custStartDate` and `custCancelDate`; every one of the 497
  linked rows has `custPONumber` populated. That looks deliberate rather than sporadic.
- The unlinked share swings hugely by week and we cannot explain it: 91% in the first week of June
  2019, 0% in the first week of July 2024, 64% in the first week of August 2026.

So: for a line that is not a `COS` sample, is `salesOrderNo = 0` a deliberate "no sales order for
this line", and is there a rule that tells us why? We want to avoid either lumping these in with
customer orders or dropping them.

**4b. Are there other ways a sample run can be identified?**

Related to the above: we found sample production marked in two other ways, neither using a `COS`
reference. Order 20019, lines 2 and 3, reference d0550, carry the marker in the **item code** —
`VSZ851MABPCONTR` and `VSZ851WAJGCONTR` ("DC COMICS CANVAS SAMPLES"), both 15 pieces. And order
22236, reference D2313, uses the item `SAMPLECHRG` "SAMPLE CHARGE". Are these older conventions for
the same thing, or something different? We want our "is this a sample?" rule to catch all of them,
not just `COS`.

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
