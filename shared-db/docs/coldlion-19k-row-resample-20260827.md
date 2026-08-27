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

## Draft follow-up email — for Albert to send

**Status: drafted 2026-08-27, not yet sent.** Record the send date on register entry 2.11.

> **Subject:** Correction to Wednesday's list, and the examples you asked for
>
> Hi JamieLynn,
>
> You asked for real examples of the negative quantities. In pulling them I sampled far more data
> than my Wednesday email was based on — 19,008 order lines across 2019 to date, against 291
> before — and I have to correct two things I sent you. Apologies; both were my sampling, not your
> system.
>
> **First, the correction. Item 1 of Wednesday's email was wrong.** I said nothing in the API
> reports shipping or invoicing. That is not true: invoice number, invoice date, invoiced quantity
> and shipped quantity are populated on about 80% of lines, in every year from 2019 onward. My
> sample had landed on 26 unusually quiet days. Please disregard that item entirely. The only two
> fields I now see empty everywhere are `subDimCode` and `itemImage`, and neither matters to us.
>
> **Second, item 4 was also wrong.** I reported that the 7-day range refusal returns HTTP 400 on
> the wire but 500 in the body. I re-tested it today on both endpoints and it is clean — 400 in
> both places, with a clear message naming the rule. Nothing to fix; please disregard.
>
> **The negative quantities you asked about — twelve lines, and the figure I quoted was wrong
> too.** I said -564; the real range is -3 to -8. Every one is the same shape: the line was
> invoiced for more than it was ordered for, so the open quantity goes negative.
>
> The 2020 cluster, all customer AAF100:
>
> - Order 7113851 line 1, item BFC102ASW, 3 June 2020 — ordered 1, invoiced 4, open -3
> - Order 7114426 lines 1 and 3, items BFC102AMV and BFC102ASW, 8 June 2020 — ordered 1, invoiced 4
> - Orders 7114895 line 2, 7114908 line 2 and 7114912 line 1, item BFC102AMV, 6 July 2020 — ordered 1, invoiced 4
> - Order 7114963 line 2, item BFC102AMV, 8 July 2020 — ordered 1, invoiced 4
>
> The 2025 cluster, all on one order for customer DY001, 2 December 2025:
>
> - Order 7127496 line 2, GFE52SWDV01 — ordered 9, invoiced 13
> - Order 7127496 line 12, VS162SWMF01 — ordered 12, invoiced 20
> - Order 7127496 line 13, VS162SWR201 — ordered 12, invoiced 16
> - Order 7127496 lines 16 and 17, VSM93SWDV01 and VSM93SWTF01 — ordered 12, invoiced 20
>
> The arithmetic is behaving correctly, so my question is about the orders rather than the report:
> is invoicing four against a line ordered for one an expected situation here, or do these look
> like errors to you?
>
> **Two new things the larger sample turned up, and these do matter to us.**
>
> **A. Some lines come back more than once, and 138 of them are identical in every field.** Across
> the 19,008 lines, about 2% share the same sales order, line number and component. Some differ
> only in invoiced quantity, shipped quantity or price — which makes me think a line can produce
> more than one row, perhaps one per invoice or shipment. If that is so, could you tell us what
> makes a row unique? We need something we can use as a primary key, and today no combination of
> the fields we receive is unique. For the 138 that are identical in all 59 fields, we would just
> like to know whether we should drop the duplicate or count both.
>
> **B. `SalesOrderLineNo` comes back as 0 on some lines.** 103 of the 19,008 — 51 of them in 2026,
> so it is not only old data. Order 7114895 is a clear example: six different items, all sharing
> line number 0. Is that expected for certain order types?
>
> Item 2 from Wednesday still stands, and the larger sample sharpens it: outside 2026, the open and
> unshipped quantities are populated on exactly twelve lines — and they are the same twelve
> negative lines above. So for 2019 through 2025 those fields are otherwise always zero. Should we
> read that as "those orders are closed, so zero is correct", or were the new formulas applied only
> going forward?
>
> Thanks for your patience with the corrections,
> Albert
