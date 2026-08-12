# PopDAM OrderList preview import reconciliation

- Generated: 2026-08-12T15:00:21Z
- Run mode: **preview write**
- Destination project ref: `rjyboqwcdzcocqgmsyel`
- Source spreadsheet: `1i1da5J0qy5a0EvsO1CvfyQ6Xijn4678LG7TFqbwxwUk`, tab `Order` (gid `0`)
- Workbook file: `OrderList.xlsx`
- Workbook SHA-256: `68c9b03a0ec183e08b3a8f2344397e1bc4f61e73457849e7bf8c0cf7fb2409fe`
- Matches approved Phase 0 export: **yes**
- Source system: `google_order_list`

This report contains counts and deterministic source references only. No customer, vendor, SKU or order text is reproduced here.

## Row shapes

| Class | Rows |
|---|---:|
| Staged (populated) rows | 12354 |
| Direct SKU rows | 8438 |
| Assortment rows | 3899 |
| Both shapes (rejected, needs review) | 3 |
| Neither shape (rejected) | 14 |
| Structurally invalid assortment rows | 28 |
| Assortment components expanded | 15713 |
| Rejected rows total | 45 |

## Orders and headers

| Measure | Count |
|---|---:|
| Planned canonical orders | 3225 |
| Normalized PO numbers | 3087 |
| Blank-PO rows (each its own header) | 138 |
| Quarantined orders (identity conflict) | 13 |
| Rows inside quarantined orders | 82 |
| Header fields left NULL on disagreement | 1 |
| Invalid header dates preserved as raw evidence | 10189 |

## Master Data resolution

`master_data_match_status` is the database column. `resolution` is the Master Data evidence, which survives even while `plm.item` is unpopulated.

| Measure | Count |
|---|---:|
| Planned canonical lines | 24151 |
| status = matched | 0 |
| status = unmatched | 23690 |
| status = ambiguous | 448 |
| status = not_applicable | 13 |
| resolution = unique Master Data row | 23649 |
| resolution = ambiguous Master Data rows | 448 |
| resolution = unmatched SKU | 41 |
| resolution = no usable SKU/type | 13 |

> `item_id` is NULL wherever `resolution = unique` but `plm.item` is still empty. That is issue #727's coordination constraint, not a defect: fix_schema_for_api.md Phase 4 owns populating `plm.item`.

## Writes

| Measure | First run | Second run |
|---|---:|---:|
| Orders inserted | 3212 | 0 |
| Orders updated | 0 | 0 |
| Orders unchanged | 0 | 3212 |
| Orders drifted (not rewritten) | 0 | 0 |
| Orders skipped (quarantined) | 13 | 13 |
| Lines inserted | 24010 | 0 |
| Lines updated | 0 | 0 |
| Lines unchanged | 0 | 24010 |
| Lines drifted (not rewritten) | 0 | 0 |
| Lines skipped (quarantined) | 141 | 141 |

**Idempotency: the second identical run changed 0 business rows.** PASS.

## Balance checks

| Check | Result | Detail |
|---|---|---|
| staged rows equal the sum of the four row shapes | PASS | 12354 staged vs 12354 classified |
| every planned line carries exactly one match status | PASS | 24151 statuses vs 24151 lines |
| staged rows equal the Phase 0 populated-row baseline | PASS | 12354 vs 12354 |
| direct-only rows equal the Phase 0 baseline | PASS | 8438 vs 8438 |
| assortment-only rows equal the Phase 0 baseline | PASS | 3899 vs 3899 |
| both-shape rows equal the Phase 0 baseline | PASS | 3 vs 3 |
| neither-shape rows equal the Phase 0 baseline | PASS | 14 vs 14 |
| assortment components equal the Phase 0 baseline | PASS | 15713 vs 15713 |
| blank-PO rows equal the Phase 0 baseline | PASS | 138 vs 138 |
| normalized PO numbers equal the Phase 0 baseline | PASS | 3087 vs 3087 |

**Overall: BALANCED**

