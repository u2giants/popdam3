# ColdLion — re-measuring every claim in the 2026-08-26 email at scale

**Why this exists:** the email Albert sent on 2026-08-26 was built on 291 rows. One of its five
items was already proven wrong by a 3,981-row sweep. Albert then asked the right question — *what
else in that email rests on a small sample?* — so every item was re-tested on **19,008 rows**.
**A second item turned out to be wrong, and two problems we had never noticed turned up.**
**Last reviewed: 2026-08-27.**

**Sample:** 62 seven-day `GET /EhpApi/orderHistory` windows, `companyCode=EDGEHOME`, spread across
2019-01 to 2026-08. **19,008 rows** — 65× the original sample. By year: 2019 1,465 · 2020 8,995 ·
2021 2,366 · 2022 1,013 · 2023 1,224 · 2024 1,428 · 2025 1,983 · 2026 534.

---

## Verdict on each item we sent

| # | What we told ColdLion | Verdict on 19,008 rows |
|---|---|---|
| 1 | Seven fields empty; nothing reports shipping or invoicing | ❌ **WRONG — retract.** Invoice/ship fields are **76-80%** populated, every year |
| 2 | Open quantities appear only on 2026 rows | ⚠️ **Mostly right, needs softening** — 115 rows carry one, and 103 are 2026, but **12 are not** |
| 3 | `stageCode` documents an "Example", not the allowed values | ✅ **Holds.** Not a sample question — read from the spec itself |
| 4 | The 7-day-cap refusal is malformed (400 on the wire, 500 in the body) | ❌ **WRONG — retract.** Re-tested live today: clean **400 in both places** |
| 5 | Negative quantities reach -564 | ❌ **Figure wrong — retract.** Real range is **-3 to -8**, on 12 rows |

**Items 1, 4 and 5 all came from small samples or from our own older notes that were never
re-checked. Item 3 is the only one that was never at risk, because it was read from the spec rather
than measured.**

---

## 1. Invoicing is populated throughout — retract

| Field | 291 rows (sent) | 3,981 rows | **19,008 rows** |
|---|---|---|---|
| `invoiceNoString` / `invoiceDateString` | 0% | 70.2% | **80.4%** |
| `lineInvoiceQty` | 0% | 68.5% | **79.1%** |
| `shipQty` | 0% | 68.5% | **78.8%** |
| `shipAmount` | 0% | 67.7% | **76.4%** |
| `subDimCode`, `itemImage` | 0% | 0% | **0% — genuinely always empty** |

Only two fields are truly always empty, and neither matters to us.

## 4. The 7-day error is well-formed — retract

Re-tested 2026-08-27 on both endpoints, with an 8-day and a 31-day range:

```
HTTP 400
{"timestamp":"2026-08-27","message":"fromDate and toDate must be within 7 days (inclusive)",
 "error":"Bad Request","status":400,"path":"uri=/EhpApi/orderHistory"}
```

Body status matches the wire status, and the message names the rule. **Either ColdLion fixed this
or our note was wrong; either way we reported a defect that does not exist.** The claim came from
notes written before 2026-08-17 and was never re-tested before being sent.

## 5. Negative quantities — the real examples

**Twelve rows out of 19,008, in two clusters. Every one is the same pattern: invoiced for more than
ordered, so open quantity goes negative.**

| Date | Sales order | Line | Item | Customer | Ordered | Invoiced | Open |
|---|---|---|---|---|---|---|---|
| 2020-06-03 | 7113851 | 1 | BFC102ASW | AAF100 | 1 | 4 | -3 |
| 2020-06-08 | 7114426 | 1 | BFC102AMV | AAF100 | 1 | 4 | -3 |
| 2020-06-08 | 7114426 | 3 | BFC102ASW | AAF100 | 1 | 4 | -3 |
| 2020-07-06 | 7114895 | 2 | BFC102AMV | AAF100 | 1 | 4 | -3 |
| 2020-07-06 | 7114908 | 2 | BFC102AMV | AAF100 | 1 | 4 | -3 |
| 2020-07-06 | 7114912 | 1 | BFC102AMV | AAF100 | 1 | 4 | -3 |
| 2020-07-08 | 7114963 | 2 | BFC102AMV | AAF100 | 1 | 4 | -3 |
| 2025-12-02 | 7127496 | 2 | GFE52SWDV01 | DY001 | 9 | 13 | -4 |
| 2025-12-02 | 7127496 | 12 | VS162SWMF01 | DY001 | 12 | 20 | -8 |
| 2025-12-02 | 7127496 | 13 | VS162SWR201 | DY001 | 12 | 16 | -4 |
| 2025-12-02 | 7127496 | 16 | VSM93SWDV01 | DY001 | 12 | 20 | -8 |
| 2025-12-02 | 7127496 | 17 | VSM93SWTF01 | DY001 | 12 | 20 | -8 |

The 2020 cluster is customer AAF100 at $8.00 a piece (`unshippedAmount` -24.00 on each). The 2025
cluster is five lines of a single order, 7127496, for customer DY001.

**This is not a reporting artefact — it is a business question.** Why was a line ordered for 1
invoiced for 4, seven times in 2020? Ask about the data, not the sign.

---

## Two problems we had never noticed

These are new. Neither was in the email, and both affect the landing design directly.

### A. `orderHistory` contains exact duplicate rows — **no key can separate them**

Testing candidate keys across 19,008 rows:

| Key | Colliding rows |
|---|---|
| `salesOrderNo` + `salesOrderLineNo` + `subItemNo` | 395 (2.08%) |
| + `itemNo` + `labelCode` | 300 (1.58%) |
| + `invoiceNoString` + `linePrice` | 155 (0.82%) |
| **The entire row, all 59 fields** | **138 (0.73%)** |

**138 rows are byte-for-byte identical to another row.** No key fixes that; only a decision does.
Of the 227 collisions that *do* differ, the differing fields are `lineInvoiceQty`, `shipQty`,
`shipAmount`, `linePrice` and `orderAmount` — which suggests **the grain is finer than the order
line** (one row per invoice or shipment event), something ColdLion has never told us.

> ⚠️ **This directly undercuts the loader plan.** We recorded on 2026-08-26 that
> `(salesOrderNo, salesOrderLineNo)` is now the authoritative line key. **It is not unique**, and a
> primary key built on it will reject 2% of rows or silently collapse them.

### B. `salesOrderLineNo` is 0 on 103 rows

The field ColdLion just added is empty on **103 of 19,008 rows** (0.54%) — 51 in 2026, 28 in 2025,
24 in 2020. On those rows the collisions are worst: order 7114895 has **six different items**
sharing line number 0, including Star Wars, Marvel and Justice League pieces at price 0.00.

So the new key must tolerate a missing line number. **Keep the derived key
`(salesOrderNo, itemNo, labelCode, subItemNo)` as a fallback rather than retiring it**, contrary to
what [`coldlion-answers-20260826.md`](coldlion-answers-20260826.md) §3 said.

---

## Item 2, restated accurately

Rows carrying an open, unshipped or picked quantity, by year:

| Year | Rows with a value | Rows |
|---|---|---|
| 2019 | 0 | 1,465 |
| 2020 | 7 | 8,995 |
| 2021 | 0 | 2,366 |
| 2022 | 0 | 1,013 |
| 2023 | 0 | 1,224 |
| 2024 | 0 | 1,428 |
| 2025 | 5 | 1,983 |
| **2026** | **103** | 534 |

Not "2026 only" — 12 older rows carry one, and **all 12 are the negative rows above**. So outside
2026, the *only* time these fields are populated is when something went wrong. That is a sharper
question than the one we sent, and it is worth asking as such.

---

## The standing lesson

**Three of five items in that email were wrong, and every wrong one was either measured on a thin
sample or copied from an internal note that was never re-checked.** Before anything goes to
ColdLion again: measure at the widest window the API allows, count rows rather than calls, and
re-run any figure quoted from our own documents. See
[`coldlion-negative-quantities-evidence-20260827.md`](coldlion-negative-quantities-evidence-20260827.md)
for the first correction and the method.

---

## Reply to ColdLion — rewritten 2026-08-27 (v3, with worked examples)

**Status: drafted 2026-08-27, NOT yet sent.** Supersedes both earlier drafts in this file.

**Why v3 exists.** Albert, 2026-08-27: *"you can't just say you found a problem, YOU MUST GIVE
ACTUAL EXAMPLES,"* and the issue numbering must continue from the 2026-08-26 email so each issue
keeps one number for its whole life. The duplicate-row and line-number-zero problems are therefore
**issues 6 and 7**, each with named orders.

**Evidence for this version:** a fresh 63-window sweep, **14,474 `orderHistory` lines**, 2019-01-01
to 2026-08-27, dumped and analysed offline. Findings, all reproducible from the orders named below:

- **160 colliding keys covering 320 rows across 34 distinct sales orders**, in 2019, 2020, 2021,
  2022, 2023, 2025 and 2026. Every collision's rows came from the **same** API window, so this is
  not an artefact of overlapping requests.
- **No byte-identical duplicate rows appear in this sample.** The "138 identical rows" figure from
  the earlier resample is **not repeated to ColdLion** — it was not reproduced here and may have
  been an overlapping-window artefact of that run.
- **30 rows carry `salesOrderLineNo` 0**, in 2020, 2024 and 2025. The earlier "103 rows, 51 in 2026"
  figure is **not repeated** — this sample shows no 2026 cases.

> **Subject:** Negative-quantity examples, two corrections, and issues 6 and 7
>
> Hi JamieLynn,
>
> Here are the real examples behind the negative quantities. While pulling them I widened our sample
> considerably — 14,474 order lines spread across 2019 to today, against 291 on Wednesday — and that
> turned up two mistakes of my own, plus two new issues. I have kept Wednesday's numbering so each
> issue keeps one number from here on.
>
> **Issue 5 — the negative quantities you asked about. Twelve lines, and my figure was wrong.** I
> said they reach -564. They do not; the range is -3 to -8. Every one has the same shape: the line
> was invoiced for more than it was ordered for, so the open quantity goes negative.
>
> Seven lines in 2020, all customer AAF100, every one ordered 1 and invoiced 4:
>
> - 3 June 2020 — order 7113851 line 1, item BFC102ASW
> - 8 June 2020 — order 7114426 lines 1 and 3, items BFC102AMV and BFC102ASW
> - 6 July 2020 — orders 7114895 line 2, 7114908 line 2 and 7114912 line 1, item BFC102AMV
> - 8 July 2020 — order 7114963 line 2, item BFC102AMV
>
> Five lines on one order for customer DY001, 2 December 2025 — order 7127496:
>
> - line 2, GFE52SWDV01 — ordered 9, invoiced 13
> - line 12, VS162SWMF01 — ordered 12, invoiced 20
> - line 13, VS162SWR201 — ordered 12, invoiced 16
> - lines 16 and 17, VSM93SWDV01 and VSM93SWTF01 — ordered 12, invoiced 20
>
> The arithmetic looks right, so the question is about the orders rather than the report: is
> invoicing four against a line ordered for one something you would expect here, or do these look
> like errors on your side?
>
> **Issue 1 — please disregard it; I was wrong.** I said nothing in `orderHistory` reports shipping
> or invoicing. That is false. Invoice number, invoice date, invoiced quantity and shipped quantity
> are populated on roughly 80% of lines, in every year from 2019 onward — order 7109618 below is one
> of thousands. Our sample had landed on 26 quiet days. The only fields I now see empty everywhere
> are `subDimCode` and `itemImage`, and neither matters to us.
>
> **Issue 4 — please disregard this one too.** I reported that the 7-day range refusal returns 400
> on the wire but 500 in the body. I re-tested today on both endpoints with 8-day and 31-day ranges:
> it is clean, 400 in both places, with a clear message naming the rule. Nothing for you to fix.
>
> **Issue 2 stands, and is now sharper.** Outside 2026, the open and unshipped quantities carry a
> value on exactly twelve lines — the same twelve negative ones above. Everything else from 2019
> through 2025 is zero. Should we read that as "those orders are closed, so zero is correct", or
> were the new formulas applied only going forward? We are loading history back to 2019, so it
> decides whether we trust the value or ignore it. Issue 3 is unchanged, and we are still not asking
> for any new stages.
>
> **Issue 6 (new) — the same sales order line comes back twice, and we cannot tell which row is
> real.** 320 rows across 34 orders in our sample share a sales order number and line number with
> another row. Three worked examples:
>
> **6a. Order 7109618** — customer HLL770, start date 1 April 2019, your PO W0349282. Line 1 comes
> back twice. Both rows are item MFZ82WABM, both say ordered 375, both carry invoice 4 dated 30
> April 2019. They disagree on the rest:
>
> - row one — price 39.88, invoiced 375, shipped 375, order amount 14,955.00
> - row two — price 41.60, invoiced 0, shipped 0, order amount 15,600.00
>
> Lines 2 and 3 of the same order behave identically — line 2 is 39.88/invoiced 375 against
> 41.60/invoiced 0, and line 3 is 40.28/invoiced 309 against 42.00/invoiced 0. It reads as though we
> are getting both the ordered price and the invoiced price as two rows, but nothing in the row says
> which is which.
>
> **6b. Order 7121891** — customer JEM090, start date 17 March 2023, your PO 217457. Line 6 comes
> back twice with **two different items**: PMABSE01S, invoiced 24, and 4PSBSE01S, invoiced 0. Same
> line number, same price of 1.15, different product. If two products can share one line number, we
> have no way to say which one line 6 is.
>
> **6c. Order 7124128** — customer MOD010, 4 September 2024, your PO 663594206. Item BG1SF01S comes
> back four times, all quantity 1,080, at four different prices: 1.31, 2.40, 3.00 and 3.30.
>
> What we need from you is one sentence: **what makes an `orderHistory` row unique?** We are building
> a load that has to insert each line exactly once, and no combination of the fields you return is
> unique today. If a line legitimately produces one row per price, per invoice or per shipment, tell
> us which and we will key on it.
>
> **Issue 7 (new) — `SalesOrderLineNo` comes back as 0.** 30 rows in our sample, and it is not
> confined to old data: 2020, 2024 and 2025. Examples:
>
> - **Order 7114595** — customer AAF100, 24 June 2020, your PO 0051463610. Two different items,
>   3FZ17WBBM and GFZ52MCSP, both carrying line number 0, both quantity 1 at price 0.00.
> - **Order 7124128** — customer MOD010, 4 September 2024, PO 663594206. Four rows, all line 0.
> - **Order 7126086** — customer MOD011, 14 July 2025, PO 665480703. Eight rows, all line 0, item
>   BGPS604, quantity 9,792, invoices 6015220, 6015221 and 6015222.
>
> This is the field you added for us in your last release and the one we intended to key our load
> on, so it matters: is 0 expected for certain order types — samples, or orders entered a particular
> way — or does it indicate the line number was not carried across?
>
> Thanks for your patience with the corrections,
> Albert
