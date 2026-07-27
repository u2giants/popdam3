# Licensing review results and MULTIPLE reconciliation

**Captured:** 2026-07-27

**Database work:** read-only. No row or schema was changed.

## Licensing answers

| Answer | Style guides | Character appearances |
|---|---:|---:|
| Existing MG06 code | 32 | 2391 |
| Never designed | 118 | 2074 |
| Multiple | 3 | 338 |

All returned MG06 codes exist in the captured Coldlion MG06 dictionary.

## MULTIPLE character reconciliation

| Result | Character appearances |
|---|---:|
| One unique property found automatically | 18 |
| Conflicting properties found | 37 |
| No property found | 281 |
| Royalty sentinel excluded | 2 |
| **Total** | **338** |

Only the conflict and unmatched rows belong in a licensing follow-up.
The deduplicated licensing follow-up contains **305 character names**.
Use `multiple-character-followup-for-licensing.xlsx` for the licensing team.
They should fill only `final_mg06_code` with an existing MG06 code or `never designed`.
They should not enter `multiple`, because every row now represents one character.

## Rules

- An existing MG06 answer maps the style guide to that canonical property code.
- Never designed keeps the style guide, leaves its property blank, and never creates a placeholder property.
- Multiple leaves the style guide property blank.
- A character under Multiple is accepted automatically only when its normalized name, within the same licensor, resolves to exactly one MG06 code through already resolved style guides.
- Conflicts and unmatched names require licensing review.
- Royalty sentinels are excluded from canonical characters.
