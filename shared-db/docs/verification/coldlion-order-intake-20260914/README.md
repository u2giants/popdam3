# ColdLion order intake — F1 sample-week live proof

**Sample week:** 2026-09-08 .. 2026-09-14 (Mon–Sun, ERP `startDate` basis)
**Generated:** 2026-10-06
**Scope:** counts and deterministic refs only — no customer names, PO numbers, or SKU text

---

## 1. Intake side (ERP `startDate` week)

### 1.1 Placeholder orders created

| Placeholder | Source ref | Intake lines | Prod lines |
|---|---|---|---|
| COLDLION-SO-7127517 | coldlion:so-header:7127517 | 1 | 1 |
| COLDLION-SO-7127522 | coldlion:so-header:7127522 | 1 | 1 |
| COLDLION-SO-7127677 | coldlion:so-header:7127677 | 1 | 1 |
| COLDLION-SO-7127678 | coldlion:so-header:7127678 | 1 | 1 |
| COLDLION-SO-7127917 | coldlion:so-header:7127917 | 7 | 1 |

**Totals:** 5 placeholder orders, 11 intake lines, 5 production order lines.

### 1.2 Intake line counts by start_date

| start_date | lines | distinct orders |
|---|---|---|
| 2026-09-09 | 2 | 2 |
| 2026-09-14 | 9 | 3 |

### 1.3 Sync runs in window

401 `/orderHistory` sync_run rows in 2026-09-08 .. 2026-09-14 (staging phase).
Placeholder creation run: writer sync_run `58198708` (production, 5 placeholders minted).

---

## 2. Sheet side (Google OrderList — Start Ship Date basis)

**NOT YET POPULATED.** The Google OrderList sheet was not accessible from this
environment. The comparison requires sheet rows for the same week keyed by
Start Ship Date.

To complete F1, fill in:

| Sheet Start Ship Date | Sheet rows | Sheet orders |
|---|---|---|
| (week of 2026-09-08) | ? | ? |

---

## 3. Expected divergence classes

Per plan §9 F1, two divergence classes are expected and are NOT bugs:

1. **Sheet-not-yet-in-ERP:** orders in the Google sheet for this week that have
   not yet been keyed into the ColdLion ERP. These appear on the sheet side only.
2. **POE-labelled-DDP:** ERP orders whose sheet Order Type says POE but the ERP
   routing says DDP — the system is *more* correct than the sheet.

Cross-week drift (sheet Start Ship Date vs ERP `startDate`) is reported as its
own class.

---

## 4. Reproduction

```
# Intake side counts
node tmp-f1-check.mjs   # lines by week
node tmp-f1-orders.mjs  # placeholder orders
node tmp-f1-lines.mjs   # intake line details
```

Database: production `qsllyeztdwjgirsysgai` via pooler (PG* env transport).

---

## 5. Gate status

- [x] Intake side counts extracted
- [ ] Sheet side counts extracted (blocked: no Google sheet access from this environment)
- [ ] Order-by-order comparison
- [ ] Divergence classes recorded with counts

**F1 gate: NOT YET PASSED** — sheet side required.
