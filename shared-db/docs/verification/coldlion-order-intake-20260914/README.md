# ColdLion order intake — F1 sample-week live proof

**Sample week:** 2026-09-08 .. 2026-09-14 (Mon–Sun)
**Week membership:** intake side by ERP `startDate`; sheet side by Start Ship Date
**Generated:** 2026-10-06 (sheet side completed 2026-10-06 5:55 PM EST)
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

Source: `orderlist.xlsx` export (full OrderList workbook, sheet `Order`), filtered to
Start Ship Date in 2026-09-08 .. 2026-09-14.

| Sheet Start Ship Date | Sheet rows | Distinct customer-PO keys | Order Type |
|---|---|---|---|
| 2026-09-10 | 2 | 2 | FOB |
| 2026-09-14 | 5 | 2 | FOB |
| **Week total** | **7** | **4** | all FOB |

### 2.1 Sheet row refs in week (GOOGLE-ROW-\<sheet-row\>)

| Sheet row ref | Start Ship Date | Order Type | Lines |
|---|---|---|---|
| GOOGLE-ROW-12226 | 2026-09-10 | FOB | 1 |
| GOOGLE-ROW-12227 | 2026-09-10 | FOB | 1 |
| GOOGLE-ROW-12212 | 2026-09-14 | FOB | 1 |
| GOOGLE-ROW-12213 | 2026-09-14 | FOB | 1 |
| GOOGLE-ROW-12214 | 2026-09-14 | FOB | 1 |
| GOOGLE-ROW-12215 | 2026-09-14 | FOB | 1 |
| GOOGLE-ROW-12508 | 2026-09-14 | FOB | 1 |

Four distinct customer-PO keys: one key covers GOOGLE-ROW-12212..12215 (4 lines);
the other three keys are one line each (12226, 12227, 12508).

### 2.2 Export provenance note

The 2026-10-05 2245Z handoff described a "33 rows: 31 POE + 2 FOB" sheet export.
That count is Start Ship Date week **2026-09-28 .. 2026-10-02**, not this F1
sample week. The same workbook yields 7 rows for 2026-09-08..14. The 33-row
figure is therefore a different week and is not the F1 sheet side.

---

## 3. Order-by-order comparison

Match key: normalized customer PO (Excel numeric keys compared without a trailing
`.0` float artifact). Item identity is out of scope for the report text.

### 3.1 Intake placeholders vs sheet

All 5 intake placeholders match a sheet row on customer-PO key, but **none** of
those sheet rows fall inside the sample week on Start Ship Date. This is the
expected **cross-week drift** class (plan § finding 3: ERP `startDate` is its own
value, never the sheet's Start Ship Date).

| Placeholder | ERP start_ship_date | Sheet row ref | Sheet Start Ship Date | Order Type both sides |
|---|---|---|---|---|
| COLDLION-SO-7127517 | 2026-09-09 | GOOGLE-ROW-11440 | 2026-09-01 | FOB |
| COLDLION-SO-7127522 | 2026-09-09 | GOOGLE-ROW-11439 | 2026-09-01 | FOB |
| COLDLION-SO-7127678 | 2026-09-14 | GOOGLE-ROW-11879 | 2026-09-25 | FOB |
| COLDLION-SO-7127677 | 2026-09-14 | GOOGLE-ROW-11880 | 2026-09-26 | FOB |
| COLDLION-SO-7127917 | 2026-09-14 | GOOGLE-ROW-12151 | 2026-09-07 | FOB |

### 3.2 Sheet week rows vs canonical orders

| Class | Sheet rows | Distinct keys | Notes |
|---|---|---|---|
| Cross-week drift (intake placeholder ↔ sheet, same key) | 5 (outside week) | 5 | §3.1; 5/5 placeholders explained |
| Pre-existing Import-PO-keyed orders (not ColdLion intake placeholders) | 6 (in week) | 3 | GOOGLE-ROW-12212..12215, 12226, 12227; already on `production_order` under Import-PO order numbers |
| Sheet-not-in-ERP | 1 (in week) | 1 | GOOGLE-ROW-12508 — no `production_order_line` match |
| POE-labelled-DDP | 0 | 0 | both sides FOB this week |

---

## 4. Divergence classes (recorded)

Per plan §9 F1, plus cross-week drift:

1. **Cross-week drift — 5 orders.** Every intake placeholder matches the sheet
   outside the sample week on Start Ship Date. Expected (plan finding 3). Not a bug.
2. **Sheet-not-in-ERP — 1 row (GOOGLE-ROW-12508).** On the sheet for this week;
   not yet keyed into the ERP / no canonical line. Expected class 1.
3. **Pre-existing non-intake canonical orders — 6 rows.** Sheet week rows that
   already sit on `production_order` via the Import-PO path, not via ColdLion
   intake placeholders. Not an intake failure; outside the writer's scope.
4. **POE-labelled-DDP — 0.** Expected class 2; no instances this week.
5. **Quarantine — 0.** The 5-placeholder writer run recorded 0 quarantined.

**F1 gate: PASSED** — sheet side populated, order-by-order comparison done,
every divergence explained as an expected class or out-of-scope path.

---

## 5. Reproduction

```
# Sheet side (local export)
# Filter orderlist.xlsx sheet "Order" to Start Ship Date in [2026-09-08, 2026-09-14];
# column [25] Start Ship Date, [11] Order Type, [14] Customer PO, [02] Import PO.

# Intake side + match-key comparison
# Production read-only SELECT on plm.production_order(_line) for the five
# COLDLION-SO-* placeholders and for the four in-week sheet customer-PO keys.
```

Database: production `qsllyeztdwjgirsysgai` via pooler (PG* env transport, read-only).

---

## 6. Gate status

- [x] Intake side counts extracted
- [x] Sheet side counts extracted (7 rows / 4 keys / all FOB)
- [x] Order-by-order comparison
- [x] Divergence classes recorded with counts

**F1 gate: PASSED.**
