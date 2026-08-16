# Historical item product taxonomy and MG review

## Purpose

This work supports reassignment of merchandise groups for items created through May 13, 2025 using the categorization method introduced on May 14, 2025.

The work is intentionally staged:

1. Read every item description holistically and extract reusable product wording.
2. Treat the complete `MG01 + MG02 + MG03` combination on post-change items as the primary product key.
3. Use `MerchGroup_Rework.xlsx` to interpret that complete key and collect all observed product-description wording associated with it.
4. Reduce each historical description to its physical product, construction or shape, and treatment.
5. Ignore licensor, property, artwork, slogan, color, character and size orientation when deciding the MG key.
6. Count every post-change complete MG key associated with that semantic signature. Propose all three parts only when the evidence is strong; otherwise propose stable MG01+MG02 and leave MG03 blank.

No database data was changed.

## Controlling interpretation

- `MG01 + MG02 + MG03` together roughly describe a product.
- The same broad word, such as `Canvas`, may correctly occur under several complete MG keys because MG03 describes a treatment or embellishment.
- Wording that occurs under multiple complete keys is not automatically a conflict.
- Post-change MG values are evidence. Pre-change MG values are not trusted as evidence of the new method.
- For older items, MG03 stays unresolved until later-item evidence identifies the treatment.
- Artwork similarity is never classification evidence. It may appear in the displayed example description, but it has zero weight in the decision.
- Each recommendation records the full later-key distribution so a reviewer can see supporting and dissenting examples.
- Rotated dimensions such as `16x20` and `20x16` are treated as the same size when orientation does not change the product.
- Material or construction wording is folded into the product type when the complete MG key says it is the same product. For example, `Polypropylene Molded Wall Clock` is consolidated into `Molded Wall Clock` under `M|W1|B1`.
- Superficial pack-count, abbreviation, word-order, material and spelling differences are consolidated when they describe the same product within the same complete MG key.

## Result from the August 15, 2026 rerun

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
| Historical semantic signatures | 332 |
| Pre-change items with high-confidence complete MG assignments | 2,487 |
| Pre-change items with MG01+MG02 supported and MG03 unresolved | 4,002 |
| High-confidence assignments that differ from the old MG values | 881 |

## Current review workbook

The confidential workbook is stored locally at:

`C:\repos\shared-db\.private\item-mg-reclassification-20260814\mg_product_description_dictionary_review.xlsx`

Its sheets are:

- `Summary`: counts and the controlling interpretation.
- `MG Product Dictionary`: one row per complete post-change MG key, its rework meaning, consolidated product wording and observed description variants.
- `Classification Evidence`: one row per historical physical-product + construction/shape + treatment signature, including every later MG key found, consensus, the selected meaning and an explicit statement that artwork was not used.
- `Post-Change Evidence`: every post-change item and the complete MG key supporting its product wording.
- `Pre-Change Product Types`: every older item, its classification components, proposed MG codes, the complete later-key distribution and the decision trace. MG03 remains blank when treatment evidence is insufficient.
- `Post-Change Needs Review`: incomplete MG keys and product descriptions whose wording still needs review.

There is no wording-conflict sheet. Broad wording shared by different complete MG keys is expected and must be interpreted using the whole key.

Generated workbooks remain under `.private` and are excluded from GitHub. The two source files are tracked under `data/` with the owner's approval so they are available from any machine.

## Reproduce or refresh

Run the current analysis scripts in this order:

```powershell
python '.\docs\verification\item-mg-reclassification-20260814\extract_description_chunks.py' '.\docs\verification\item-mg-reclassification-20260814\data\full_item_master.csv'
python '.\docs\verification\item-mg-reclassification-20260814\mine_item_type_phrases.py' '.\docs\verification\item-mg-reclassification-20260814\data\full_item_master.csv'
python '.\docs\verification\item-mg-reclassification-20260814\build_semantic_product_types.py' '.\docs\verification\item-mg-reclassification-20260814\data\full_item_master.csv'
python '.\docs\verification\item-mg-reclassification-20260814\build_mg_keyed_taxonomy.py'
node '.\docs\verification\item-mg-reclassification-20260814\build_semantic_product_type_workbook.mjs'
```

The analysis reads its public source files from inside this repository:

- `docs/verification/item-mg-reclassification-20260814/data/full_item_master.csv`
- `docs/verification/item-mg-reclassification-20260814/data/MerchGroup_Rework.xlsx`

These files are deliberately tracked on GitHub so the same analysis can run from any machine without depending on the Downloads folder or the `T:` drive. The owner confirmed on August 15, 2026 that these product descriptions are not confidential and approved publishing them for analysis and guidance.

The cutoff is the old method through May 13, 2025 and the new method beginning May 14, 2025.

## Skill

The reusable interpretation rules are maintained in the `item-description-taxonomy` Skill in `u2giants/ai-devops`. The installed copy on this machine is `C:\Users\ahazan2\.codex\skills\item-description-taxonomy\SKILL.md`.
