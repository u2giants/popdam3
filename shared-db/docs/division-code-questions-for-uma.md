# Division codes: what to ask Uma

> **ANSWERED 2026-08-13.** All eight questions are answered in
> [`division-code-answers-from-uma-20260813.md`](division-code-answers-from-uma-20260813.md).
> That file, plus the owner rulings in it, is the authority. This page is kept only as
> the record of what was asked and why.

**Prepared 2026-08-13. Every number below was measured live against production
`qsllyeztdwjgirsysgai`. Nothing was changed.**

---

## The problem in three sentences

ColdLion and DesignFlow both have a thing called "division", but they write it two
different ways: ColdLion writes **`CW001`**, DesignFlow writes **`1`**. Our shared
database already stores **both** encodings in columns with the **same name**
(`division_code`), with nothing marking which is which. We are about to build the item key
as `company | division | item_no`, and picking the wrong encoding makes the key silently
**wrong** rather than missing, so nothing errors and items quietly merge or split.

**This is not hypothetical. 271 rows in the live database already contradict themselves.**

---

## The mapping table, verified

`plm."divisionCode"` is the only bridge between the two systems. All 5 rows:

| `divCode_id` | `divCode_code` | `division_name` | `external_divisoncode` | `is_divcode_active` |
|---|---|---|---|---|
| 1 | `Lic` | POP Lic | **CW001** | true |
| 2 | `Gen` | Everyday | **CW001** | *null* |
| 7 | `POP Lic` | POP Lic | **CW001** | *null* |
| 8 | `Spruce Lic` | Spruce Lic | **SP001** | true |
| 9 | `Spruce non-Lic` | Spruce non-Lic | **EH001** | true |

Two things fall out immediately:

1. **The mapping is many-to-one.** DesignFlow to ColdLion works. **ColdLion to DesignFlow
   does not**: given `CW001` we cannot tell whether the answer is 1, 2 or 7.
2. **ColdLion has a fourth division, `EP001`, with no row here at all.**

Note also that `divCode_code` is a *third* value ("Lic", "Gen") that is neither the id nor
the ColdLion code.

## The live contradiction

`core."merchGroup"` carries **both** columns: `divisionCode_fk` (text, ColdLion-style) and
`divisionCode_id_fk` (integer, DesignFlow-style).

- total rows: **3,645**
- rows with both columns populated: **3,553**
- **rows where the two disagree: 271** (7.6% of those 3,553)

The disagreements are not scattered noise. They are two clean blocks:

| text column says | integer column says | integer really means | rows |
|---|---|---|---|
| `EH001` | 2 | **CW001** | **217** |
| `CW001` | 8 | **SP001** | **54** |

Somebody has to say which column wins. We cannot decide this from the data.

---

## The questions for Uma

Each is answerable with one specific fact.

### Q1. Is `plm."divisionCode"."external_divisoncode"` maintained by a process, or was it typed in by hand once?
**Answer needed:** "maintained by <name of job>", or "hand-entered, never updated."
**What breaks if this is wrong:** it is the only bridge between the two code spaces
anywhere in our data. If it is stale, every division translation we build is wrong from
day one, and wrong silently.

### Q2. Ids 1 (`Lic`), 2 (`Gen`) and 7 (`POP Lic`) all point at `CW001`. Which of them are live in production DesignFlow?
**Answer needed:** the list of `divCode_id` values actually in use.
**What breaks if this is wrong:** any ColdLion-to-DesignFlow lookup has to guess between
three answers, and will be wrong most of the time.

### Q3. Only ids 1, 8 and 9 have `is_divcode_active = true`. Are 2 and 7 deprecated, and why is the flag NULL rather than false on them?
**Answer needed:** yes or no, plus what NULL is meant to mean.
**What breaks if this is wrong:** filtering on `is_divcode_active` silently drops rows;
filtering on `IS NOT FALSE` silently keeps dead divisions. Both are wrong, in opposite
directions.

### Q4. ColdLion has a division `EP001` with no DesignFlow row. Does DesignFlow know about it?
**Answer needed:** the DesignFlow id for `EP001`, or "DesignFlow does not handle EP001."
**What breaks if this is wrong:** per ColdLion's own dictionary, `EP001` has **no licensor
or property concept at all** — in that division the same type codes mean "Product Line" and
"Product Type". Treating `EP001` rows like `CW001` rows turns product lines into licensors.

### Q5. Which column is authoritative in DesignFlow: `divisionCode_fk` (text) or `divisionCode_id_fk` (integer)?
**Answer needed:** one or the other.
**What breaks if this is wrong:** this is the live 271-row contradiction above. Pick wrong
and 271 taxonomy rows are filed under the wrong division, and their licensors and
properties then resolve against the wrong type dictionary.

### Q6. Does the DesignFlow item record carry a division, and on which table and column?
**Answer needed:** table plus column name, or "no."
**What breaks if this is wrong:** all **17,703** rows in `public.erp_items_current` have
`division_code` NULL, and all of them came from DesignFlow. The division was dropped
somewhere on the way in. If DesignFlow holds it, we backfill from source. If not, we have
to re-pull from ColdLion.

### Q7. Is `EDGEHOME` the only company code for items?
**Answer needed:** yes, or the full list.
**What breaks if this is wrong:** company is the first third of the key. If it is not a
constant then **every** key is wrong, not just some. (`erp_items_current` has no company
column at all today.)

### Q8. Will an item that sits in DesignFlow division `1` come back from ColdLion `/items` as `CW001`?
**Answer needed:** yes or no, plus **one real item number** as a worked example.
**What breaks if this is wrong:** this is the whole question. One worked example settles it.

---

## Do not ask her these — we already know

| Fact | How we know |
|---|---|
| `erp_items_current` = 17,703 rows, `division_code` NULL on **all** of them | live query |
| Every one of those rows came from DesignFlow, not ColdLion | live query |
| `erp_items_current.external_id` is a bare item number, unique, with no company or division inside it, and the table has **no company column** | live query |
| `plm.item_import`'s primary key really is `(company_code, division_code, item_no)` | `pg_constraint` |
| `plm.item`, `plm.item_import`, `plm.erp_licensor`, `plm.erp_property` and `plm.merch_group_header` are all **0 rows** — nothing is broken yet | live query |
| ColdLion's four divisions are `CW001`, `EH001`, `SP001`, `EP001`, company `EDGEHOME` | `docs/coldlion-erp-api-reference.md` |
| ColdLion's `mgTypeCode` **means different things in different divisions**, and its codes are unique only per division plus type | `docs/coldlion-erp-api-reference.md` |
| `plm.licensor_import.division_code` holds `"1"` and `"8"` — DesignFlow integers stored as text | live query |
| `core.product_size.division_code` and `public.style_groups.division_code` hold `CW001`/`EH001`/`SP001` — **the same column name, the opposite encoding, in the same database** | live query |
| `core.property`'s 256 rows carry **no division at all** | live query |
| ColdLion has no licensor-to-property relationship and no active/inactive flag | `docs/coldlion-erp-api-reference.md` |

---

## A concrete example to show her

The licensor **`TOEI - ONE PIECE`**, merch-group code `1P`.

- ColdLion returns it under `divisionCode = "CW001"`.
- Our `plm.licensor_import` stores it with `division_code = "1"`.

Same licensor. Two different divisions on paper.

---

## The one-line answer

They are **two encodings of the same real-world divisions**, joined only by
`plm."divisionCode"."external_divisoncode"` — and that join is many-to-one and is already
contradicted by 271 live rows. Building `company | division | item_no` before Q1, Q2 and Q5
are answered will produce wrong keys.

## Recommended guard, once the answers are in

Every `division_code` column is bare `text` with no constraint today, which is exactly why
`"1"` and `"CW001"` can both live in columns of the same name. A `CHECK` constraint or a
domain that accepts only the ColdLion shape would make this class of mistake impossible.
That needs its own shared-db PR and is not done here.

## Not verified

The DesignFlow-side sync code under `C:\repos\dflow plm` was not read. Q1, Q6 and Q8 may be
partly answerable from that code without troubling Uma at all.
