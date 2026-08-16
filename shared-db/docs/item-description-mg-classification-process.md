# Item-description merchandise-group classification

## Permanent rule

This is the permanent operating rule for interpreting item descriptions and proposing the new merchandise-group hierarchy for items created before May 14, 2025.

The process does not redefine, repair, renumber, or overwrite MG01, MG02, MG03, or MG04. It changes only the analysis used to propose codes for historical items. The Item Master and source files remain unchanged until a separate update is explicitly approved.

The implementation is [`hierarchical_item_taxonomy.py`](verification/item-mg-reclassification-20260814/hierarchical_item_taxonomy.py). Its tests are [`test_hierarchical_item_taxonomy.py`](verification/item-mg-reclassification-20260814/test_hierarchical_item_taxonomy.py).

## Date boundary and trusted evidence

The categorization method changed after business closed on May 13, 2025.

- Historical population: items created before May 14, 2025.
- Trusted learning population: items created May 14, 2025 or later.
- MG01, MG02, and MG03 stored on a trusted-population row are accepted as that row's classification.
- MG01, MG02, and MG03 stored on a historical row are comparison fields only. They must never teach, vote for, or otherwise influence a proposal.
- MG04 is retained in the audit output but is not part of this classification decision. Size is parsed separately.

Moving the boundary by one day changes the evidence population and requires written business approval.

## Step 1: parse every full item description

Every old and new item description is divided into five business fields:

1. **Product type:** the physical product a merchant would say is being sold. Material, construction, or treatment stays only when it distinguishes a real product family.
2. **Size:** every stated physical dimension and unit, including depth or height.
3. **Licensor:** the license owner wording found in the description.
4. **Property:** the franchise, character, or property wording found in the description.
5. **Artwork description:** the remaining scene, pose, slogan, color, pattern, character action, or design wording.

Product-type variants that mean the same physical product are consolidated before matching. This includes spelling mistakes, abbreviations, punctuation, singular/plural, word order, and omitted words. Examples:

- `Anti Fatique Kitchen Mat` and `Anti Fatigue PVC Kitchen Mat` become `Anti-Fatigue PVC Kitchen Mat`.
- `PP Molded Wall Clock` and `Polypropylene Molded Wall Clock` become `Molded Wall Clock`.
- `2Pc Canvas Set Paint`, `DIY PBN Canvas`, and `DIY Canvas Set` become `Paint-Your-Own Canvas Set`.

Physically meaningful differences remain separate. `Crumb Rubber Door Mat` and `Crumb Rubber Outdoor Mat` are not merged.

If a description has no usable product wording, such as blank, `PENDING`, `ASSORTMENT`, a fee, a test record, or only an item number, it is reported separately as **no usable description**. It must not be mixed into the count of usable descriptions whose product type failed to find MG01.

### Fields with zero classification weight

Licensor, property, character, artwork, slogan, color, scene, pose, and size do not choose MG01, MG02, or MG03. They are parsed so they can be removed from the product-type decision and retained for review.

Rotated dimensions such as `16x20` and `20x16` describe the same face size when orientation does not change the product. Size may help a reviewer recognize an evidence row, but it cannot change the merchandise-group result.

## Step 2: build three independent post-change maps

The trusted population produces three separate maps. These are not one full-key map with pieces removed afterward.

### MG01 map

For every distinct MG01 present on or after May 14, 2025, list the MG01, every consolidated product type observed with it, item count for each type, total item count, and representative full descriptions.

### MG01+MG02 map

For every distinct MG01+MG02 pair present on or after May 14, 2025, list the same product-type range, counts, and examples.

### MG01+MG02+MG03 map

For every distinct complete MG01+MG02+MG03 combination present on or after May 14, 2025, list the same product-type range, counts, and examples.

The range is based on product types, not whole-description text. A Disney canvas and a Marvel canvas are both canvas evidence. License and artwork wording cannot split the physical product into artificial families.

Broad product types may correctly occur under several complete combinations. For example, `Printed Canvas` may span sibling MG03 treatments. That is not a conflict. It means the broad type supports MG01+MG02 unless the description contains reliable treatment evidence for MG03.

## Step 3: classify each historical product type deepest-first

For every historical consolidated product type, try these levels in order:

1. **MG01+MG02+MG03:** assign all three only when one complete key has strong, consistent post-change support.
2. **MG01+MG02:** if the complete key is not justified, use the independent pair map. Assign the pair and leave MG03 blank.
3. **MG01:** if the pair is not justified, use the independent MG01 map. Assign MG01 and leave MG02 and MG03 blank.
4. **Unresolved:** only when no level is reliable. State whether the cause is no usable description, an unrecognized product type, no post-change analog, or conflicting evidence.

Failure at a deeper level is not failure at a shallower level. A count called “unmatched to MG01” is valid only after the system actually tries the independent MG01 map.

### Decision strength and audit trail

The system first tries the consolidated product type exactly, then semantically equivalent variants. Deeper assignments require stronger agreement than broad MG01 assignments. When trusted rows materially disagree, the system falls back one level or abstains.

Each decision retains:

- level selected: 3, 2, 1, or unresolved;
- proposed MG01, MG02, and MG03, leaving unsupported levels blank;
- all post-change keys and counts considered at that level;
- winning share of the evidence;
- exact-type or semantic-variant basis;
- a plain-English reason;
- confirmation that artwork was not used.

## Required counts

Every run reports these separately:

- historical items assigned MG01+MG02+MG03;
- historical items assigned MG01+MG02 only;
- historical items assigned MG01 only;
- historical items with a usable description but not matched even to MG01;
- historical items without a usable product description.

The last two must never be combined. A blank description is a source-data problem. A readable product type that cannot reach MG01 is a classification-logic or coverage problem.

## Output contract

- `all_item_description_chunks.csv`: every item and the five parsed fields.
- `post_change_mg01_product_types.json`: the independent MG01 map.
- `post_change_mg01_mg02_product_types.json`: the independent pair map.
- `post_change_mg01_mg02_mg03_product_types.json`: the independent complete-key map.
- `historical_hierarchical_mg_matches.csv`: each historical item, current comparison values, proposed values, selected level, and evidence.
- `hierarchical_match_summary.json`: required outcome counts and source totals.

Generated outputs contain licensed item descriptions and belong in the ignored private working directory. They must not be committed to this public repository.

## Run commands

From the repository root on this Windows workstation:

```powershell
$python = 'C:\Users\ahazan2\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$folder = 'docs\verification\item-mg-reclassification-20260814'
& $python "$folder\hierarchical_item_taxonomy.py" `
  "$folder\data\full_item_master.csv" `
  --reference 'docs\verification\coldlion-licensor-property-phase3-20260725\designflow-fresh-edges.json' `
  --output '.private\item-mg-hierarchical'
Push-Location $folder
& $python -m unittest test_hierarchical_item_taxonomy.py -v
Pop-Location
```

The interpretation reference is `docs/verification/item-mg-reclassification-20260814/data/MerchGroup_Rework.xlsx`.

## Review and maintenance gate

Before a result is called complete:

1. Review every proposed product-type family semantically. A repeated phrase is not automatically a product type.
2. Pass the consolidation cases for DIY canvas, anti-fatigue kitchen mats, canvas treatments, molded wall clocks, and separate crumb-rubber mat constructions.
3. Inspect at least 25 random rows, every major MG01 family, every user example, every high-volume unresolved type, and examples that fall from three levels to two or one.
4. Confirm historical MG values were not inputs.
5. Confirm licensor, property, artwork, color, slogan, character, and size were not inputs to the MG decision.
6. Reconcile the five required counts directly from the row output.
7. If a workbook is produced, visually inspect every sheet.

Adding a product-type phrase is a business-taxonomy change. It requires examples showing why it is a distinct physical product or why its variants are equivalent. Do not add a phrase merely to force an unresolved count lower.
