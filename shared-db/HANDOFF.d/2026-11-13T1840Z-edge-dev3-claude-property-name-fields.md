---
status: OPEN
owner: unassigned (next shared-db session)
---

# Open plan: four names per property on core.property

Written 2026-11-13 1:40 PM EST on edge-dev3 by Claude.
The plan holds everything: [docs/plan_property-name-fields.md](../docs/plan_property-name-fields.md). Read its STATUS table first and start at Step 1. Nothing is built. No claims are held.

## Open question from Albert (2026-11-13 1:36 PM EST) — answer BEFORE Step 1

Albert asked: "are you sure 'Short name' doesn't exist in the area of designflow plm which will be automatically making item descriptions?"

Not yet verified. The 2026-11-13 check covered only the shared database (column names on property/merch-group tables) and one script, https://github.com/popcre/designflow-item-master/blob/sandbox-albert/scripts/display-desc-load-properties.js, which derives a shortened property name on the fly by stripping suffixes (`SUFFIX_RE`) and writes `config/display-desc-properties.json`. That generated JSON may already act as a short-name list. Also check the rest of the item-description code before adding `core.property.short_name`:
- https://github.com/popcre/designflow-item-master/tree/sandbox-albert/scripts/product-description
- the `dflow.item_product_description` table and its writers (shared-db #5994)
- any `display_desc*` / `product_description*` / description config files in all six popcre designflow-* repos.
If a short name already exists there, the plan changes: reuse it, or move it to `core.property` and repoint its readers. Do not keep two. Update https://github.com/popcre/shared-db/blob/main/docs/plan_property-name-fields.md §5/§6 with the answer, then report it to Albert in plain words.
