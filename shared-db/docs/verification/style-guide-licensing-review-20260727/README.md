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
| Specific franchise rule | 256 |
| One unique property found automatically | 18 |
| Marvel catch-all rule | 62 |
| DC catch-all rule | 0 |
| Conflicting properties found | 0 |
| No property found | 0 |
| Royalty sentinel excluded | 2 |
| **Total** | **338** |

Specific rules use the closest existing MG06 franchise. Characters without a narrower current
Marvel or DC property use the existing `MV` or `DC` assorted-styles property. The licensing
follow-up now contains **0 character names**.

The retired 305-row licensing workbook was removed. `character-franchise-rule-audit.xlsx` is
internal evidence only and must not be sent to licensing.

## Rules

- An existing MG06 answer maps the style guide to that canonical property code.
- Never designed keeps the style guide, leaves its property blank, and never creates a placeholder property.
- Multiple leaves the style guide property blank.
- A character under Multiple uses the closest specific existing MG06 franchise code.
- A unique same-licensor match from resolved style guides is preserved when no specific rule exists.
- A Marvel or DC character with no narrower current property uses `MV` or `DC`.
- Royalty sentinels are excluded from canonical characters.
