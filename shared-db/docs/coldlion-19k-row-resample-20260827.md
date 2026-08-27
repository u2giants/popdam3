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

## Reply to ColdLion — rewritten 2026-08-27

**Status: drafted 2026-08-27, NOT yet sent.** Record the send date on register entry 2.11 once it
goes. Supersedes the earlier draft in this file; every figure is from the 19,008-row re-test above.

> **Subject:** The negative-quantity examples you asked for — and two corrections to Wednesday's list
>
> Hi JamieLynn,
>
> Here are the real examples behind the negative quantities. While pulling them I widened our
> sample considerably — 19,008 order lines from 2019 to date, against 291 on Wednesday — and that
> turned up two mistakes of my own. Apologies for the noise; both were our sampling, not your
> system.
>
> **The negative quantities — twelve lines, and my figure was wrong.** I said they reach -564. They
> do not; the range is -3 to -8. Every one is the same shape: the line was invoiced for more than
> it was ordered for, so the open quantity goes negative.
>
> Seven lines in 2020, all customer AAF100, all ordered 1 and invoiced 4:
>
> - 3 June 2020 — order 7113851 line 1, item BFC102ASW
> - 8 June 2020 — order 7114426 lines 1 and 3, items BFC102AMV and BFC102ASW
> - 6 July 2020 — orders 7114895 line 2, 7114908 line 2, 7114912 line 1, item BFC102AMV
> - 8 July 2020 — order 7114963 line 2, item BFC102AMV
>
> Five lines on a single order for customer DY001, 2 December 2025 — order 7127496:
>
> - line 2, GFE52SWDV01 — ordered 9, invoiced 13
> - line 12, VS162SWMF01 — ordered 12, invoiced 20
> - line 13, VS162SWR201 — ordered 12, invoiced 16
> - lines 16 and 17, VSM93SWDV01 and VSM93SWTF01 — ordered 12, invoiced 20
>
> The arithmetic looks right, so my question is about the orders rather than the report: is
> invoicing four against a line ordered for one something you would expect here, or do these look
> like errors on your side?
>
> **Correction 1 — please disregard item 1 of Wednesday's email.** I said nothing in `orderHistory`
> reports shipping or invoicing. That is false. Invoice number, invoice date, invoiced quantity and
> shipped quantity are populated on roughly 80% of lines, in every year from 2019 onward. Our sample
> had simply landed on 26 quiet days. The only fields I now see empty everywhere are `subDimCode`
> and `itemImage`, and neither matters to us.
>
> **Correction 2 — please disregard item 4 as well.** I reported that the 7-day range refusal
> returns 400 on the wire but 500 in the body. I re-tested it today on both endpoints, with 8-day
> and 31-day ranges: it is clean, 400 in both places, with a clear message naming the rule. Nothing
> for you to fix.
>
> **Two new things the larger sample found, and these do affect our load.**
>
> **A. We cannot tell one line from another.** About 2% of the 19,008 lines share the same sales
> order number, line number and component. Of those, 138 are identical in all 59 fields we receive.
> Others differ only in invoiced quantity, shipped quantity or price — which suggests one line can
> produce more than one row, perhaps one per invoice or shipment. Could you tell us what makes a row
> unique? We need a stable key to load against, and today no combination of the fields you return is
> unique. For the 138 that are identical in every field, we would also like to know whether to keep
> both or drop the duplicate.
>
> **B. `SalesOrderLineNo` comes back as 0 on some lines.** 103 of the 19,008 — and 51 of those are
> 2026, so it is not just old data. Order 7114895 is a clear case: six different items all carrying
> line number 0. Is that expected for certain order types? This is the field we were planning to key
> on, so it matters to us.
>
> **Item 2 from Wednesday still stands, and is now sharper.** Outside 2026, the open and unshipped
> quantities carry a value on exactly twelve lines — the same twelve negative ones above. Everything
> else from 2019 through 2025 is zero. Should we read that as "those orders are closed, so zero is
> correct", or were the new formulas applied only going forward? We are loading history back to
> 2019, so it decides whether we trust the value or ignore it.
>
> Items 3 and 5 from Wednesday are unchanged, and we are still not asking for any new stages.
>
> Thanks for your patience with the corrections,
> Albert
