# Merchandise groups and product taxonomy

**Status:** Settled

## Business hierarchy

Product classification is a real business hierarchy:

1. MG01 Product Type
2. MG02 Product Sub-Type
3. MG03 Product Sub-Sub-Type

Beyond MG01 through MG03, a merchandise-group slot can describe another business dimension. Its meaning depends on the Division, as defined below. A code from one dimension must not be treated as a substitute for another.

## Product categories we produce

**Settled — owner ruling by Albert Hazan, 2026-08-19.**

We produce seven product categories today:

1. Wall Art
2. Tabletop Decor
3. Clocks
4. Storage
5. Workspace
6. Floor Coverings
7. Garden

An eighth category, **Stationery**, is in development. Nothing has been sold in
Stationery yet, so Stationery will **not** appear in ColdLion. Its absence from
ColdLion is expected and is not a data gap.

Note: these seven are the same seven as the `mgCategory` groupings below
(`Wall`, `Tabletop`, `Clock`, `Storage`, `Workspace`, `Floor`, `Garden`).
"Workspace" already contains an MG01 Product Type named `S Stationery org`
(stationery organizers). That is a Workspace product type, **not** the new
Stationery category. Do not treat the two as the same thing.

## What each division produces

**Settled — owner ruling by Albert Hazan, 2026-08-19.** Three divisions apply
to this system.

| Division | Code | Licensed? | Categories produced |
|---|---|---|---|
| POP | `CW001` | Licensed designs only | Wall Art, Tabletop Decor, Clocks |
| Spruce Licensed | `SP001` | Licensed designs only | Storage, Workspace, Floor Coverings, Garden, and eventually Stationery |
| Spruce Generic | `EH001` | Generic (non-licensed) designs only | All eight categories |

So licensed-versus-generic is decided by the division, and the two licensed
divisions split the categories between them with no overlap: POP takes the
three wall/tabletop/clock categories, Spruce Licensed takes the rest.

**Conflict flagged, not resolved.** "Division scope of a Product Type" below
records that the nineteen workbook Product Types each exist once in **all
three** current divisions. That is a statement about which taxonomy rows exist
in the database. This ruling is a statement about what the business actually
produces. Existing rows in a division do not mean that division sells that
category. Where the two disagree, this ruling governs the business meaning, and
the stale taxonomy rows should be reviewed by the business.

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
| Storage | N Soft Storage; P Hard Storage; R Other storage; Q TBD storage |
| Workspace | S Stationery org; T Desk Acc; U Other workspace |
| Floor | V Floor coverings |
| Garden | W Garden |

Seven categories cover **twenty** MG01 Product Types. Category constrains dependent choices such as valid sizes. A Product Type may not belong to two categories unless the business explicitly changes this rule.

**Q TBD storage — Settled, owner ruling by Albert Hazan on 2026-08-18.** `Q TBD storage` is a real Product Type and its category is **Storage**. This replaces the earlier statement that a twentieth Product Type existed in every division with an **Unknown** category; that statement was wrong on both counts. `MerchGroup_Rework.xlsx` carries only the other nineteen, so the workbook still needs updating by the business to match the ruling. Until it does, **this recorded ruling is the authority for `Q`, not the workbook.**

### Division scope of a Product Type

**Settled — verified against the live taxonomy on 2026-08-18.** The nineteen workbook Product Types each exist once in each of the three current divisions `CW001`, `EH001` and `SP001`. `Q TBD storage` exists in `CW001` only.

Therefore an MG01 code alone never identifies a Product Type. **Division is always required** to resolve one, and a Product Type is not guaranteed to be offered in every division.

### Known trap: capitalisation

The live Product Type descriptions do not match the workbook's capitalisation — the live taxonomy reads `Other tabletop`, `Soft storage` and `Desk acc` where the workbook reads `Other Tabletop`, `Soft Storage` and `Desk Acc`. Any comparison between the two must ignore case and surrounding spaces. Treating them as different names has already caused one near-miss.

### Historical: retired Product Type rows

**Historical.** The Product Type list has been rebuilt at least once, and the pre-rebuild rows still exist in an inactive state rather than being deleted. The same letter has meant different things in different eras: a 2019 `A` meant `LEATHER/COWHIDE`, while the live `A` means `Stretched/Box`.

These inactive rows are **not** a live taxonomy conflict. The workbook and the live active set agree. Never cite a retired row as evidence that the current taxonomy disagrees with itself.

## Description classification

Historical item descriptions must be interpreted into separate facts: Product Type, size, Licensor, Property, and artwork wording. Matching starts with the most specific supported combination and falls back carefully. Failure of a full multi-level match is not evidence that MG01 failed.

The categorization method changed after business closed on May 13, 2025. Items created before May 14, 2025 are historical. Items created May 14, 2025 or later are the trusted learning population. Moving that boundary requires written business approval.

**Two different dates — do not confuse them. Settled, verified live on 2026-08-18.** The May 14, 2025 boundary above is the **item** boundary and applies to items only. Separately, the merchandise-group Product Type rows themselves were rebuilt in a single batch that carries a stored creation date of **2025-04-07**, and every Product Type row predating that rebuild is now inactive. Anyone reconciling the taxonomy against stored dates must not expect the May 14 boundary to appear on merchandise-group rows. The two dates answer different questions: one asks which items can be trusted for learning, the other asks when the Product Type list was last rebuilt.

Do not infer current product meaning from historical single-letter ERP values without the approved remediation method.

## Authority boundary

This taxonomy governs product and merchandise meaning only. Licensing names, ownership, Characters, Style Guides, Assets, Franchises, and Property Active/Inactive status follow [`licensing-master-data.md`](licensing-master-data.md).

## Implementation and evidence

The full schema history, code mappings, workbook evidence, and historical-remediation procedure remain in [`../merch-group-taxonomy-architecture.md`](../merch-group-taxonomy-architecture.md) and [`../item-description-mg-classification-process.md`](../item-description-mg-classification-process.md).
