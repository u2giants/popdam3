# Merchandise groups and product taxonomy

**Status:** Settled

## Business hierarchy

Product classification is a real business hierarchy:

1. MG01 Product Type
2. MG02 Product Sub-Type
3. MG03 Product Sub-Sub-Type

Beyond MG01 through MG03, a merchandise-group slot can describe another business dimension. Its meaning depends on the Division, as defined below. A code from one dimension must not be treated as a substitute for another.

## Division changes the meaning

`mgTypeCode` has no meaning by itself. Always interpret the pair of Division and `mgTypeCode`.

- In licensed divisions `CW001` and `SP001`, MG05 and MG06 mean Licensor and Property.
- In Spruce non-licensed division `EH001`, those same slots mean Big Theme and Little Theme.
- In retired book and education division `EP001`, those same slots mean Product Line and Product Type.

`EP001` is a real retired division, not a mistaken spelling of `EH001`. DesignFlow also has older numeric division identifiers. Most historical item headers are in numeric division `2`; that history must not be silently reassigned to a current ColdLion division.

Merchandise-group codes are unique only inside their Division and merchandise-group type. `FR`, for example, has represented different kinds of object in different contexts and must never be resolved from the letters alone.

MG10 means Demographic, also called Age Group, in the three current divisions. It is a flat attribute, not a level in the Product Type hierarchy. This library does not yet define the approved Age Group vocabulary; that vocabulary is **Unknown** until confirmed.

## `mgCategory`

`mgCategory` is a hidden broad grouping of real MG01 Product Types. It is not another MG hierarchy level and does not replace MG01.

| Category | MG01 Product Types |
|---|---|
| Wall | A Stretched/Box; B Framed; C Plaque; D Functional; E Other Wall |
| Tabletop | F Block; G Box; H Photo Frames; J Object; K Other Tabletop |
| Clock | M Clocks |
| Storage | N Soft Storage; P Hard Storage; R Other storage |
| Workspace | S Stationery org; T Desk Acc; U Other workspace |
| Floor | V Floor coverings |
| Garden | W Garden |

That is seven categories covering the nineteen MG01 Product Types represented in `MerchGroup_Rework.xlsx`. The live taxonomy contains a twentieth MG01 within each division that the workbook does not map. Its category is **Unknown** and must not be guessed. Category constrains dependent choices such as valid sizes. A Product Type may not belong to two categories unless the business explicitly changes this rule.

## Description classification

Historical item descriptions must be interpreted into separate facts: Product Type, size, Licensor, Property, and artwork wording. Matching starts with the most specific supported combination and falls back carefully. Failure of a full multi-level match is not evidence that MG01 failed.

The categorization method changed after business closed on May 13, 2025. Items created before May 14, 2025 are historical. Items created May 14, 2025 or later are the trusted learning population. Moving that boundary requires written business approval.

Do not infer current product meaning from historical single-letter ERP values without the approved remediation method.

## Authority boundary

This taxonomy governs product and merchandise meaning only. Licensing names, ownership, Characters, Style Guides, Assets, Franchises, and Property Active/Inactive status follow [`licensing-master-data.md`](licensing-master-data.md).

## Implementation and evidence

The full schema history, code mappings, workbook evidence, and historical-remediation procedure remain in [`../merch-group-taxonomy-architecture.md`](../merch-group-taxonomy-architecture.md) and [`../item-description-mg-classification-process.md`](../item-description-mg-classification-process.md).
