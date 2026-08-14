# Historical item product taxonomy and MG review

## Purpose

This work supports reassignment of merchandise groups for items created through May 13, 2025 using the categorization method introduced on May 14, 2025.

The work is intentionally staged:

1. Read every item description holistically and extract reusable product wording.
2. Treat the complete `MG01 + MG02 + MG03` combination on post-change items as the primary product key.
3. Use `MerchGroup_Rework.xlsx` to interpret that complete key and collect all observed product-description wording associated with it.
4. Review and improve the wording dictionary before proposing MG codes for historical items.

No database data was changed. No MG recommendation has yet been assigned to an older item.

## Controlling interpretation

- `MG01 + MG02 + MG03` together roughly describe a product.
- The same broad word, such as `Canvas`, may correctly occur under several complete MG keys because MG03 describes a treatment or embellishment.
- Wording that occurs under multiple complete keys is not automatically a conflict.
- Post-change MG values are evidence. Pre-change MG values are not trusted as evidence of the new method.
- For older items, MG03 stays unresolved until later-item evidence identifies the treatment.
- Material or construction wording is folded into the product type when the complete MG key says it is the same product. For example, `Polypropylene Molded Wall Clock` is consolidated into `Molded Wall Clock` under `M|W1|B1`.
- Superficial pack-count, abbreviation, word-order, material and spelling differences are consolidated when they describe the same product within the same complete MG key.

## Result from the August 14, 2026 rerun

| Measure | Count |
|---|---:|
| Post-change items | 3,658 |
| Post-change items with complete MG keys | 3,627 |
| Post-change items with incomplete MG keys | 31 |
| Distinct complete MG keys | 241 |
| Keys mapped to rework definitions | 189 |
| Keys not found in the rework definitions | 52 |
| Post-change items with resolved product wording | 2,683 |
| Post-change items needing wording review | 944 |
| Pre-change items | 15,644 |
| Pre-change items with extracted product wording | 8,587 |
| Pre-change items needing product-wording review | 7,057 |

## Current review workbook

The confidential workbook is stored locally at:

`C:\repos\shared-db\.private\item-mg-reclassification-20260814\mg_product_description_dictionary_review.xlsx`

Its sheets are:

- `Summary`: counts and the controlling interpretation.
- `MG Product Dictionary`: one row per complete post-change MG key, its rework meaning, consolidated product wording and observed description variants.
- `Post-Change Evidence`: every post-change item and the complete MG key supporting its product wording.
- `Pre-Change Product Types`: every older item with product wording where currently resolved. Proposed MG01, MG02 and MG03 are deliberately blank.
- `Post-Change Needs Review`: incomplete MG keys and product descriptions whose wording still needs review.

There is no wording-conflict sheet. Broad wording shared by different complete MG keys is expected and must be interpreted using the whole key.

The `.private` folder is excluded by `.gitignore`. Item descriptions contain licensed-property names and must never be pushed to this public repository.

## Reproduce or refresh

Run the current analysis scripts in this order:

```powershell
python '.\docs\verification\item-mg-reclassification-20260814\build_semantic_product_types.py'
python '.\docs\verification\item-mg-reclassification-20260814\build_mg_keyed_taxonomy.py'
node '.\docs\verification\item-mg-reclassification-20260814\build_semantic_product_type_workbook.mjs'
```

The analysis reads:

- `C:\Users\ahazan2\Downloads\full_item_master.csv`
- `T:\shared\_11 designflow\MerchGroup_Rework.xlsx`

The cutoff is the old method through May 13, 2025 and the new method beginning May 14, 2025.

## Skill

The reusable interpretation rules are maintained in the `item-description-taxonomy` Skill in `u2giants/ai-devops`. The installed copy on this machine is `C:\Users\ahazan2\.codex\skills\item-description-taxonomy\SKILL.md`.
