# VERIFIED — `prodHistory` returns only ISS lines unless `stageCode` is given

**Date:** 2026-08-19 · **Machine:** al8960ofc · **Agent:** claude (Opus 5)
**Endpoint:** `GET http://x5.coldlion.com/EhpApi/prodHistory`, `companyCode=EDGEHOME`
**Why this file exists:** this finding changes what a complete historical load *is*. It was found
by accident, three days after two other sessions had already documented these endpoints as
understood. The evidence is recorded in full so nobody has to take it on trust or re-derive it.

---

## 1. The claim, in one line

**A `prodHistory` request without `stageCode` returns only the `ISS` (issued) lines. Receipt lines
(`stageCode=REC`) exist, are different rows, and appear nowhere in the default response.**

## 2. How it was found

ColdLion (JamieLynn, relayed by Albert, 2026-08-18) was answering an unrelated question about why
`salesOrderNo` is sometimes 0:

> "Additionally, if you're getting prod stages INTRAN or REC, the custPONumber drops off / doesn't
> carry down, so it would only be on lines in stage ISS."

That sentence implies rows in stages other than `ISS` exist in this feed. The `stageCode` parameter
had been listed in our own API documentation since 2026-08-14 and marked **"never exercised"**.
Exercising it produced the result below.

**Lesson worth keeping:** an unexercised optional parameter is not a harmless gap. For three days
this feed was documented as "one row per production-order line × prepack component" and that was
wrong — it is one row per production-order line × prepack component **for a single stage**.

## 3. Evidence — same window, three requests

| Window | No `stageCode` | `stageCode=ISS` | `stageCode=REC` | REC rows also in default |
|---|---|---|---|---|
| 2026-08-03..09 | 67 rows | 67 rows | 21 rows | **0 of 21** |
| 2024-07-01..07 | 144 rows | 144 rows | 159 rows | **0 of 159** |
| 2021-03-01..07 | 662 rows | 662 rows | 579 rows | **0** |
| 2019-06-03..09 | 138 rows | 138 rows | 141 rows | — |

Row keys compared on `(prodOrderNo, prodLineSeq, prepackItemNo, itemNo)`.

**Default ≡ ISS.** Key sets were identical in both directions in every window tested: 0 default keys
absent from `ISS`, 0 `ISS` keys absent from default.

**REC is disjoint from the default.** Not a subset, not partially overlapping — zero shared keys.

## 4. What a REC row actually is

Receipt lines are **separate lines of the same production order**, not restatements of the ISS line.

Production order **22717**, 2024-07-01, item `VSZ20ATRN01`, customer `HLL770`:

| Stage | `prodLineSeq` | `prodOrderQty` | `salesOrderNo` | `custPONumber` | `receiveDate` |
|---|---|---|---|---|---|
| `ISS` | 1 | **4,800** | 7123801 | populated | 2024-08-23 |
| `REC` | 2 | **4,548** | **0** | empty | 2024-08-23 |

Ordered 4,800, received 4,548 — a **252-piece shortfall that is invisible in the default response**.
Multiply that across seven years of purchasing and the gap is the entire subject of "did we get what
we paid for".

## 5. Consequences, stated bluntly

1. **A loader that omits `stageCode` builds a purchase history with no receipts in it** — no short
   shipments, no over-shipments, no actual arrival quantities. Worse, it looks complete.
2. **The stage is NOT in the payload.** Every field was compared between a default row and a `REC`
   row; nothing identifies the stage. It is knowable only from the request that fetched it, so the
   loader must record it. Without that column, ordered and received quantities are indistinguishable
   and any `SUM(prodOrderQty)` double-counts.
3. **Row keys do NOT collide across stages** — verified on `(prodOrderNo, prodLineSeq)` and on
   `(prodOrderNo, prodLineSeq, prepackItemNo)` across three windows: **0 collisions** in every case.
   This is the dangerous kind of safe: a table keyed without `stage_code` will accept both stages
   without error and silently produce inflated totals. The absence of a key violation is **not**
   evidence the load is correct.
4. **`salesOrderNo = 0` on a REC row is correct**, not missing data. Attribute a receipt to a
   customer order via `prodOrderNo` back to the `ISS` line — never via `salesOrderNo`.

## 6. Which stage codes exist

**Confirmed to return data:** `ISS`, `REC`.
**Named by ColdLion, returned 0 rows in the windows tested:** `INTRAN` (in transit) — plausibly just
timing, treat as valid and fetch it.
**Probed and returned nothing:** `OPEN`, `CLOSED`, `SHIP`, `SHP`, `CLS`, `CAN`, `PEND`, `NEW`,
`COMP`, `WIP`, `APPR`, `IN TRAN`, `INT`.

> **⚠️ This list is empirical, not authoritative.** An unknown stage code is a stage we would never
> fetch and never miss. **Ask ColdLion for the definitive list before the full historical load** —
> this is the single most valuable outstanding question about these endpoints.

## 7. Reproducing it

```bash
KEY="$(op read 'op://vibe_coding/Coldlion ERP API key x5.coldlion.com/credential')"
BASE="http://x5.coldlion.com/EhpApi/prodHistory?companyCode=EDGEHOME&fromDate=2024-07-01&toDate=2024-07-07"

curl -s -H "X-API-Key: $KEY" "$BASE"                  | jq 'length'   # 144  (= ISS)
curl -s -H "X-API-Key: $KEY" "$BASE&stageCode=ISS"    | jq 'length'   # 144
curl -s -H "X-API-Key: $KEY" "$BASE&stageCode=REC"    | jq 'length'   # 159  (none of them in the first call)
```

Remember the **7-day window cap** — a wider range is refused.

## 8. What this does NOT establish

- **Whether `INTRAN` ever returns rows.** Not seen yet; 0 rows in four windows is not proof of
  absence, only of absence in those windows.
- **Whether other stages exist.** See §6 — empirical only.
- **Whether `orderHistory` has an equivalent hidden dimension.** It has no `stageCode` parameter, but
  no one has proved its default response is complete. **Worth checking before the load.**
- **Whether stage membership is stable over time.** A line presumably moves `ISS` → `INTRAN` → `REC`
  as goods travel, which means a re-pull of the same window may return *different* stage populations
  later. Untested, and it matters for the recurring sync.
