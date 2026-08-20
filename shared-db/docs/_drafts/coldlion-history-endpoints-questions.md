# DRAFT — note to ColdLion re: prodHistory / orderHistory

**Status:** draft for Albert's review. Not sent. Send from Albert, not from an AI session.
**Subject line suggestion:** Questions on the new prodHistory / orderHistory endpoints

> ### ✅ 2026-08-19 — NOTHING IN THIS NOTE BLOCKS ANYTHING ANY MORE
>
> ColdLion has now answered every blocking question. Answered and **removed** from the note:
> the production-order line number (`prodLineSeq`), rate limits (7-day cap), `subUpc` (rare, keep
> it), `ppkMerchGroup*` blanks (assortment vs component SKU), `lineInvoiceQty`/`lineOpenQty` (not
> carried at component level), old unlinked lines (hard-linking began ~2022–2023; the link drops on
> `INTRAN`/`REC`), **the stage list (exactly `ISS`, `INTRAN`, `REC`)**, and **the AMA030 lines
> (Amazon is stock production, no customer PO)**.
>
> Register: [`coldlion-open-questions.md`](../coldlion-open-questions.md).
> **What is left below is one small question and two courtesy observations.** Send it whenever
> convenient, or fold it into the next conversation with them.

---

Hi JamieLynn,

Thank you — both answers close things out completely on our side. Confirming what we found when we
checked them, in case any of it is useful:

**The stage list was the important one.** Knowing there are exactly three means we can be certain
we are not missing a population. Worth mentioning: `INTRAN` returned nothing in the first four weeks
we sampled, so we had it pencilled in as possibly unused — then it returned 129 rows for the first
week of July 2024 and 7 rows for late July 2026. Clearly transient, which makes sense, but it does
mean anyone sampling a few quiet weeks could wrongly conclude the stage is dead. We now fetch all
three stages for every window.

**Amazon explains the group we could not place.** All ten of those AMA030 lines are unlinked with no
customer PO, all `StockCa` into warehouse `AMACN` — exactly as you describe. One thing we noticed
while checking: we cannot use the production type to identify stock production generally, because
customer DOL900 has 120 `StockCa` lines that *are* linked to sales orders. So we are treating the
Amazon arrangement as a customer-level fact rather than inferring it from a field.

That leaves one small question and two observations.

**1. Is there a field that tells us which stage a row is in?**

We could not find one, so a row's stage is known only from the request that fetched it. We record it
ourselves as we load, so this is a safety net rather than a need — but if there is a field we have
overlooked, we would rather use it.

**2. Two things from your recent changes, in case they are useful to you.**

- When a date range is wider than 7 days, the refusal comes back as HTTP 400 on the wire, but the
  JSON body says `"status": 500` and `"Internal Server Error"`, with the real explanation only in
  the `message` field. We handle it fine, but a client trusting the body would treat a permanent
  input error as a temporary server fault and retry it forever.
- `lastProdCost` still comes back twice for a few older orders where two production records share
  the same latest `lastProdDate` — for example order 20872, line 1, component CTZHS0MSC01, with 3.09
  and 3.64. `prodLineSeq` means this causes us no trouble now; flagging it only in case the
  de-duplication was meant to cover it.

**3. And one planning question, whenever convenient.**

How far back does the history go? We have pulled data as early as June 2019 and have not looked
further back. Knowing the earliest date with real data would let us size the one-time load exactly
instead of scanning backwards for the boundary.

Thanks again for all of these — between the line sequence, the stage list and the Amazon
explanation, our picture of this data is in much better shape than it was a week ago.

Albert

---

## Notes for the session sending this (not part of the note)

- **Nothing here blocks the historical load.** Every blocking question has been answered; this note
  is now one minor question plus courtesy feedback. Do not hold the load for it.
- Q3 (how far back) only saves us scanning backwards ourselves; it is not a dependency.
- Every number quoted is from probe runs recorded in
  [`coldlion-history-endpoints-shape.md`](../coldlion-history-endpoints-shape.md),
  [`business-rules-erp-data.md`](../business-rules-erp-data.md) and
  [`verification/coldlion-prodhistory-stage-discovery-20260819/README.md`](../verification/coldlion-prodhistory-stage-discovery-20260819/README.md).
- Do not include the API key, the key's 1Password location, or any internal system names.
