# ColdLion negative quantities — the actual examples, and a correction we owe them

**Why this exists:** ColdLion asked for real examples behind our claim that quantities go negative.
Producing them required a much larger sample than the one behind our 2026-08-26 email — and that
larger sample **contradicts item 1 of the email we already sent.** Both results are below.
**Last reviewed: 2026-08-27.**

**Sample:** 17 seven-day `GET /EhpApi/orderHistory` windows, `companyCode=EDGEHOME`, spread across
2019-02 to 2026-08. **3,981 rows** — versus the 291 rows behind the 2026-08-26 email. Plus 30
`prodHistory` calls (10 days × `ISS`/`INTRAN`/`REC`), 198 rows.

---

## 1. The negative examples ColdLion asked for

**Four rows out of 3,981, all in the same week of July 2020, all the same item and customer.**

| Sales order | Line | Item | Customer | PO | Start | lineQty | lineInvoiceQty | lineOpenQty | unshippedQty | subQty | unshippedAmount |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 7114895 | 2 | BFC102AMV | AAF100 | 0051524549 | 2020-07-06 | 1 | 4 | **-3** | **-3** | **-3** | **-24.00** |
| 7114908 | 2 | BFC102AMV | AAF100 | 0051524631 | 2020-07-06 | 1 | 4 | **-3** | **-3** | **-3** | **-24.00** |
| 7114912 | 1 | BFC102AMV | AAF100 | 0051524658 | 2020-07-06 | 1 | 4 | **-3** | **-3** | **-3** | **-24.00** |
| 7114963 | 2 | BFC102AMV | AAF100 | 0051541930 | 2020-07-08 | 1 | 4 | **-3** | **-3** | **-3** | **-24.00** |

All four are division `CW001`, `linePrice` 8.00, no prepack component (`subItemNo` empty),
`lineCancelledQty` 0, `linePickQty` 0, cancel date the day after the start date.

**The negative is arithmetic, and it is visible in the row itself:** the line was ordered for **1**
and invoiced for **4**. Open quantity is order minus invoiced, so it lands at **-3**, and
`unshippedAmount` is -3 × 8.00 = **-24.00**. So the real question for ColdLion is not "why is the
quantity negative" but **"why was a line ordered for 1 invoiced for 4?"** — four separate orders,
same item, same customer, same week. That looks like a data-entry or allocation event in July 2020,
not a reporting artefact.

**We could not reproduce -564.** That figure comes from our own earlier internal notes
([`coldlion-history-endpoints-shape.md`](coldlion-history-endpoints-shape.md) §5.6) and this larger
sweep does not support it: the **only** negatives found anywhere are the four rows above, minimum
**-3**. No negative value of any kind appeared in the 198 `prodHistory` rows, on any of the three
stages. **Do not repeat the -564 figure to ColdLion.** §5.6 has been corrected.

---

## 2. ⚠️ A correction we owe ColdLion — item 1 of the 2026-08-26 email is WRONG

The email said seven `orderHistory` fields are empty on every row, and that **no row reports
shipping or invoicing**. That was measured on 291 rows drawn from 26 single-day windows. On 3,981
rows it does not hold:

| Field | 291-row sample (sent) | 3,981-row sample (actual) |
|---|---|---|
| `lineInvoiceQty` | 0% | **68.5%** |
| `shipQty` | 0% | **68.5%** |
| `shipAmount` | 0% | **67.7%** |
| `invoiceNoString` | 0% | **70.2%** |
| `invoiceDateString` | 0% | **70.2%** |
| `subDimCode` | 0% | **0%** — genuinely always empty |
| `itemImage` | 0% | **0%** — genuinely always empty |

Invoicing is populated in **every year 2019-2026**. Only `subDimCode` and `itemImage` survive as
always-empty.

**Why the first sample was wrong:** 26 single days, chosen by spacing rather than by volume, landed
on light days. A day with two order lines tells you almost nothing, and averaging 26 such days does
not fix it. The 7-day windows carry 3,981 rows from the same period and answer the question.

**Standing lesson:** never characterise a field as dead from single-day windows. Size the sample by
row count, not by how many calls were made.

---

## 3. What still holds

**Item 2 of the email is confirmed, and more sharply than before.** Open/unshipped/picked
quantities by year, out of 3,981 rows:

| Year | Rows with an open/unshipped/picked quantity | Rows |
|---|---|---|
| 2019 | 0 | 412 |
| 2020 | 4 *(the negative rows above)* | 749 |
| 2021 | 0 | 1,004 |
| 2022 | 0 | 318 |
| 2023 | 0 | 158 |
| 2024 | 0 | 415 |
| 2025 | 0 | 576 |
| **2026** | **103** | 349 |

Apart from the four July 2020 anomalies, these fields are **exclusively a 2026 phenomenon** across
seven years of data. Given that invoicing *is* populated throughout, the "these orders are closed,
so zero is correct" reading is now the more likely one — but it is still worth their confirmation,
because our historical load back to 2019-01-01 depends on it.

Items 3, 4 and 5 of the email are unaffected.
