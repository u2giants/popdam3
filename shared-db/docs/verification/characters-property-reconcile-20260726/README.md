# Characters → canonical property reconciliation

**Run date:** 2026-07-26

**Environment:** production Supabase `qsllyeztdwjgirsysgai`

**Mode:** read-only — no database object or row was changed

## Question answered

Can `public.characters.property_id` be promoted directly into
`core.character.property_id`?

**No, not for the population as a whole.** The legacy foreign key is internally
complete, but it points to the 500-row licensing/style-guide catalogue in
`public.properties`, not directly to the deliberately narrower 256-row
Coldlion-scoped `core.property` catalogue.

## Results

| Measurement | Count |
|---|---:|
| Legacy `public.properties` rows | 500 |
| Legacy properties with character appearances | 335 |
| `public.characters` rows (character appearances, not identities) | 9,622 |
| Canonical `core.property` rows | 256 |
| Canonical property provenance rows available in production | 468 |
| Legacy properties matching a canonical property by normalized name within the same licensor | 39 |
| Matching legacy properties that actually contain characters | 21 |
| Character appearances on those exact/normalized-name matches | **367 (3.8%)** |
| Legacy properties with characters requiring another mapping rule or review | **314** |
| Character appearances on that residual population | **9,255 (96.2%)** |

`public.properties.external_id` is a licensing/style-guide identifier, not a
Coldlion MG06 property code. It produced **zero** direct code matches. Looking
through `core.taxonomy_source_ref` produced no additional direct matches because
the provenance rows describe the canonical DesignFlow/Coldlion merch-group
identity, not the licensing catalogue's style-guide IDs.

The existing `public.dam_character_catalog` compatibility view is even narrower:
it exposes **161** character appearances because it requires a strict trimmed
name match. The 367 figure above allows punctuation/casing normalization but
does not use fuzzy or prefix inference.

## Known business-rule buckets inside the residual

The confirmed Disney Classics rule accounts for five appearance rows in this
exact-name sample:

- `101 Dalmatians`, `Aristocats`, `Bambi`, `Jungle Book`, and `Lion King`
  each have one appearance and must map to canonical `CP` ("CLASSIC
  PROPERTIES"), not to separate canonical properties.

The confirmed no-code examples account for four appearance rows:

- `Luca` has two; `Kim Possible` and `Inside Out` have one each.
- They must not create placeholder properties. They remain unresolved until the
  business assigns a Coldlion code.

These examples explain part of the residual, but not enough to make direct DAM
promotion safe. Most residual rows are style-guide variants such as `Batman
Core`, individual Harry Potter films, Marvel likeness variants, and collection
names that require the family/bucket mapping already represented in the
licensing-team review sheet.

## Phase 0 recommendation

Choose the **hybrid** branch:

1. Accept the 367 appearance rows whose DAM parent agrees with a canonical
   property by normalized name and licensor.
2. Apply the already-decided Classics → `CP` and no-code rules.
3. Have the licensing team complete the 174-row decision sheet at
   `../style-guide-property-mapping-20260726/style-guide-property-mapping.csv`
   for the remaining family/bucket decisions.

Branch A (promote all DAM mappings) is disproved by the evidence: it would leave
9,255 of 9,622 appearance rows pointing at licensing/style-guide catalogue
parents that do not exist canonically. Branch B remains safe but would
unnecessarily re-review the small exact-agreement population.

## Evidence files

- [`property-reconcile.csv`](property-reconcile.csv) — all 500 legacy property
  rows, character counts, and direct canonical match where one exists.
- [`residual-properties-with-characters.csv`](residual-properties-with-characters.csv)
  — the 314 populated legacy properties without a direct canonical match.

## Reproduction notes

The comparison:

1. maps legacy licensors to canonical licensors by the existing code aliases
   (`DS → DY`, `WWE → WW`) or normalized licensor name;
2. compares property code, normalized property name, and
   `core.taxonomy_source_ref` provenance within that licensor;
3. counts `public.characters` rows under each legacy parent.

The 9,622 rows are deliberately called **appearances** here. This reconciliation
does not attempt Phase 3 character-identity collapse.

## Phase drift check

- **Phase 2:** no drift; the additive target schema is unchanged.
- **Phase 3:** the backfill must support a hybrid mapping source and retain an
  explicit unresolved/no-code lane. It cannot copy
  `public.characters.property_id` wholesale.
- **Phase 4:** no drift; DAM relocation remains copy → repoint → retire.
- **Phase 5:** remains serialized behind the Coldlion property cutover and an
  approved production window.
- **Phases 6–7:** no drift.
