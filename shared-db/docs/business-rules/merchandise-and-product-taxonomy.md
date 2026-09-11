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

### A non-licensed division with no Licensor is not a data gap

**Settled — owner ruling by Albert Hazan, 2026-09-06:** "EH001 and EP001 have no
licensed product, correct".

Divisions `EH001` and `EP001` contain no licensed product. Being 100%
unresolved for Licensor and Property is their **expected state**, not a failure,
and blank is the correct final answer for them. Any population being assessed
for a missing Licensor or Property must exclude them.

**Break the population by division before counting it.** A whole-company count
mixes non-licensed divisions into what is supposed to be a licensed-item
measurement. On 2026-09-06 this single mistake turned a real gap of 2,016 items
into a reported 6,350: `EH001` contributed 3,883 rows and `EP001` 451, all of
them correctly blank. The worked example is in
[`unmapped-licensor-population.md`](unmapped-licensor-population.md).

**Conflict flagged, not resolved.** "Division scope of a Product Type" below
records that the nineteen workbook Product Types each exist once in **all
three** current divisions. That is a statement about which taxonomy rows exist
in the database. This ruling is a statement about what the business actually
produces. Existing rows in a division do not mean that division sells that
category. Where the two disagree, this ruling governs the business meaning, and
the stale taxonomy rows should be reviewed by the business.

### Division identity is the letter code, never a number

**Settled — owner ruling by Albert Hazan, 2026-08-19.** A division is identified
by its ColdLion letter code — `CW001`, `SP001`, `EH001` (and retired `EP001`) —
and by nothing else. ColdLion itself keys divisions this way, and we follow it.

**Numeric division identifiers are not to be used as identity anywhere new.**
DesignFlow carries its own numeric division ids (`div_code_fk` = 1, 2, ...) and
some existing tables carry a numeric `divisionCode_id_fk`. Those are legacy
internal keys of the older system. They must not be introduced into new tables,
new feeds, or new contracts, and must not be treated as the division's real
identity.

Why this matters: the numeric ids do not survive the trip between systems. The
same division answers to different numbers in different places, and DesignFlow's
numeric division `2` is a mixed historical bucket that does not correspond to any
one current ColdLion division at all. The letter code is the only identifier that
means the same thing on both sides.

Applies to: the `coldlion` landing schema (already compliant — it stores
`division_code text`), every new ColdLion feed table, and any new cross-system
contract. Existing legacy columns are not retired by this ruling; they are simply
not the identity, and nothing new depends on them.

## Division changes the meaning

`mgTypeCode` has no meaning by itself. Always interpret the pair of Division and `mgTypeCode`.

- In licensed divisions `CW001` and `SP001`, MG05 and MG06 mean Licensor and Property.
- In Spruce non-licensed division `EH001`, those same slots mean Big Theme and Little Theme.
- In retired book and education division `EP001`, those same slots mean Product Line and Product Type.

A merchandise-group slot carries a code and a separate display name. The code is the fact; the name is a convenience label that may be absent even when the code is present. An item whose Licensor code is filled has a Licensor, regardless of whether the Licensor name is populated. Never test a slot's display name to decide whether the underlying fact is missing, and never report an item as unlicensed on that basis.

`EP001` is a real retired division, not a mistaken spelling of `EH001`. DesignFlow also has older numeric division identifiers. Most historical item headers are in numeric division `2`; that history must not be silently reassigned to a current ColdLion division.

**Read the field this page already names.** The 2026-09-06/07 unmapped-Licensor
analysis was invalidated twice over, and both times the correct field was
already written down here and had simply not been read. The first run read
`royaltyCode` as the Licensor; the second read `merchGroup05Desc`, the display
name, instead of `merchGroup05`, the code. Before measuring a Licensor or
Property population, check which field this rule names, then read that one. See
[`unmapped-licensor-population.md`](unmapped-licensor-population.md).

For general merchandise-group entity resolution, codes are scoped by Division and
merchandise-group type. `FR`, for example, has represented different kinds of object in
different contexts and must never be resolved from the letters alone. **For the newer
MG01–MG03 product hierarchy, JamieLynn confirmed 2026-09-10 that `mgCategory` is an
additional scope:** values may recur across categories, but should be unique within the
applicable division/category branch.

MG10 means Demographic, also called Age Group, in the three current divisions. It is a flat attribute, not a level in the Product Type hierarchy. This library does not yet define the approved Age Group vocabulary; that vocabulary is **Unknown** until confirmed.

## `mgCategory`

`mgCategory` is a hidden broad grouping of real MG01 Product Types. It is not another MG hierarchy level and does not replace MG01.

**Settled — owner ruling by Albert Hazan, 2026-08-27.** An item's `mgCategory`
is resolved only from its division-qualified MG01 definition. MG02 and MG03 never
affect the category. Items created on or before May 13, 2025 return no category;
items created May 14, 2025 or later may resolve one. This date restriction is
temporary and obsolete only after a separately verified project has reclassified
**every** historical item under the new MG01+MG02+MG03 methodology. Retire it only
through a later governed migration carrying that complete-reclassification
evidence. Partial analysis, proposed workbook values, or elapsed time do not prove
completion. Categories are resolved at read time and are not written onto item rows.

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

### ColdLion merchandise-group detail identity — Settled vendor rule

The settled POP rule above defines how POP resolves an item's `mgCategory`. JamieLynn
confirmed on 2026-09-10 that the same category dimension is also part of ColdLion's
`/merchGroupDetails` record identity. **`mgCategory` must be included.** Rows that share
company, division, merchandise-group type and code but differ by category are separate
ColdLion records; they are not rows for POP to merge or choose between. The business
grain is therefore `(company, division, mgType, mgCategory, mgCode)`.

JamieLynn also explained the business meaning: MG01–MG03 are the new codes and standards
POP had ColdLion implement in early 2025. Some code values intentionally recur across
categories, but they should be unique within the applicable division and category. The
division and `mgCategory`, with the MG01 choice, determine which MG02 and MG03 values are
valid. In plain terms, the same-looking code can mean different things in different
category branches; category is a scope for the hierarchy, not a cosmetic label.

This explains the live shape measured 2026-09-09/10: explicit `active=Y` and `active=N`
requests for `companyCode=EDGEHOME` returned 1,384 rows (1,376 active and 8 inactive),
while the old four-field projection produced only 1,038 combinations. Adding
`mgCategory` produced 1,384 distinct five-field identities. No source payload is stored
in this public repository.

**Still Unknown:** JamieLynn asked for clarification on the exact `mgCode` reuse question,
and said the possible placeholder rows came from a sheet provided to Brian but she does
not believe they are used. That recollection does not establish a current loader rule.
Her note that Uma helped make DesignFlow and ColdLion consistent confirms shared
cross-system standards and reduced redundancy, but does not authorize collapsing any
category-specific ColdLion rows or settle blank-description/placeholder semantics.

**Historical evidence:** an older 2026-07-23 sample found `mgCategory` empty on the
sampled detail rows. That observation is retained as historical and does not override the
current live result.

The category names shown above are migration-authoritative display labels. A governed
rewording ships in a new `shared-db` migration; replay intentionally restores the declared
label instead of preserving an out-of-band database edit. Application logic must continue
to use the stable category code, not the display label.

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
