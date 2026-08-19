# DRAFT — note to ColdLion re: prodHistory / orderHistory

**Status:** draft for Albert's review. Not sent. Send from Albert, not from an AI session.
**Subject line suggestion:** Questions on the new prodHistory / orderHistory endpoints

> ### ✅ Answered so far — REMOVED from the note, do not re-ask
>
> - **Production-order line number** → `prodLineSeq` added (2026-08-17).
> - **Paging / rate limits** → 7-day window cap (2026-08-17).
> - **`subUpc`** → rarely assigned to prepack components; one Walmart assortment. Keep the column.
> - **`ppkMerchGroup*` blanks** → assortment vs component SKU (JamieLynn, 2026-08-18).
> - **`lineInvoiceQty`/`lineOpenQty`** → not carried at component level; use `unshippedQty`.
> - **Old unlinked lines** → hard-linking began ~2022–2023; the link drops on `INTRAN`/`REC`.
>
> Evidence for all of it: [`coldlion-history-endpoints-shape.md`](../coldlion-history-endpoints-shape.md)
> and [`business-rules-erp-data.md`](../business-rules-erp-data.md).
> **The live asks are now the `stageCode` list and the 10 recent unlinked AMA030 lines.**

---

Hi JamieLynn,

Thank you — all three answers landed, and each one resolved something. Checking them against the
data turned up one thing we had badly wrong on our side, which I have noted below in case it
matters to other API users too.

**The stage answer was the most valuable thing anyone has told us about this feed.** Following it
up, we discovered that `prodHistory` without a `stageCode` returns **only the `ISS` lines**. Asking
for `stageCode=REC` returns rows that appear nowhere in the default response — 21 extra rows for one
week in August, 159 extra for a week in July 2024, with no overlap at all. So our whole picture of
"what we bought" was missing everything about what actually **arrived**. Production order 22717 is
the clearest example: `ISS` line 1 ordered 4,800, `REC` line 2 received 4,548, and only the first
half was visible to us.

Two questions on that, and they are now the only things we need before loading history:

**1. What is the full list of valid `stageCode` values?**

We have confirmed `ISS` and `REC` return data, and you mentioned `INTRAN` (it returned no rows in
the weeks we tried, which may just be timing). We tried `OPEN`, `CLOSED`, `SHIP`, `CAN`, `PEND`,
`NEW`, `COMP`, `WIP` and `APPR` and none returned anything. Since a stage we do not know about is a
stage we would silently never fetch, we would rather have the authoritative list than guess.

**2. Is there any way to tell from a row which stage it came from?**

The stage is not in the payload as far as we can see, so we only know it from the request we made.
We will record it ourselves as we load, but if there is a field we have missed, that would be safer.

**3. On the sales-order link — your explanation covers nearly all of it.**

The dates line up exactly with what you said about hard-linking starting around 2022/2023: 91% of
lines unlinked in June 2019, 48% in March 2021, 42% in November 2023, and **0% in July 2024**. And
every `REC` line we looked at was unlinked with an empty `custPONumber`, exactly as you described.

One small group is left over that your explanation does not seem to cover: **10 recent lines that
are `ISS` stage, not `COS` samples, and still unlinked** — all customer AMA030, references D3568 and
D3569, ordered 2026-08-05, quantities from 152 to 1,200. Is there another way a recent issued line
ends up without a sales order, or are these something specific?

**4. Merch groups — your instinct was right, with one twist.**

You asked whether groups 1-4 were populated consistently, and whether we were seeing assortment-SKU
data rather than sub-SKU data. Confirmed: on multi-component lines, `merchGroup01`–04 are identical
across every component (139 of 139 lines), while `ppkMerchGroup01`–04 vary between components in 61
of them. So `merchGroup*` is the assortment and `ppkMerchGroup*` is the piece, just as you thought.

The twist is which side is blank. On prepack rows it is the **assortment** groups that are mostly
empty — `merchGroup01`, `02` and `03` populated on only about 14% of rows, against 84–88% for
`ppkMerchGroup01`–06. Only `merchGroup04` (size) is consistently filled, at 97%. That makes sense to
us: an assortment master is generic and the licensor and theme live on the pieces inside. We will
read component taxonomy from `ppkMerchGroup*` and stop treating a blank assortment group as missing
data.

That leaves a much smaller question: roughly 12–16% of component rows have `ppkMerchGroup*` blank
too. Is that expected, or worth a look?

**5. Quantities — answered, thank you.**

You were right that the invoice and open quantities are not carried at component level, and right
that there are shipped/unshipped fields: we see `unshippedQty` and `linePickQty` populated
(66 and 55 rows out of 442 respectively, mostly on prepack lines). We will build shipment reporting
on those and treat `lineInvoiceQty` as unavailable here. Small correction to our earlier note:
`lineOpenQty` **is** occasionally populated — 11 rows out of 442, up to 250 — so we will keep it.

**6. Two small things from your recent changes, in case they are useful.**

- When a date range is wider than 7 days, the refusal comes back as HTTP 400 on the wire, but the
  JSON body says `"status": 500` and `"error": "Internal Server Error"`, with the real explanation
  in `message`. We handle it fine, but a client trusting the body would treat a permanent input
  error as a temporary server fault and retry it forever.
- `lastProdCost` still comes back twice for a few older orders where two production records share
  the same latest `lastProdDate` — for example order 20872, line 1, component CTZHS0MSC01, with 3.09
  and 3.64. `prodLineSeq` means this causes us no trouble now; flagging it only in case the
  de-duplication was meant to cover it.

**7. One planning question, whenever convenient.**

How far back does the history go? We have pulled data as early as June 2019 and have not looked
further back. Knowing the earliest date with real data would let us size the one-time load exactly
instead of scanning for the boundary.

Thanks again — the stage point in particular saved us from loading a materially incomplete history.

Albert

---

## Notes for the session sending this (not part of the note)

- **The `stageCode` list is now the one answer worth waiting for** before the full historical load.
  Everything else can be loaded around. Loading without knowing the valid stages risks a
  systematically incomplete dataset, which is much worse than a delayed one.
- Q3 (the 10 AMA030 lines) and Q4's tail (12-16% blank component groups) change how we classify
  rows, not whether we can load them.
- Q6 is courtesy feedback on their behaviour; Q7 sizes the pull.
- Every number quoted above is from probe runs recorded in
  [`coldlion-history-endpoints-shape.md`](../coldlion-history-endpoints-shape.md) and
  [`business-rules-erp-data.md`](../business-rules-erp-data.md). If those are re-verified and the
  numbers move, update them here before sending.
- Do not include the API key, the key's 1Password location, or any internal system names.
