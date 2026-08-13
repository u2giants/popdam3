# PopDAM OrderList production import reconciliation

- Generated: 2026-08-13T03:40:58Z
- Run mode: **production write — completed**
- Reviewed shared-db commit: `0aa4c64c6e54e881544b3a268dc4d47b0bac89fd`
- Destination project ref: `qsllyeztdwjgirsysgai`
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
| resolution = unique Master Data row | 23690 |
| resolution = ambiguous Master Data rows | 448 |
| resolution = unmatched SKU | 0 |
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
| staged rows equal the operator-declared expected populated rows | PASS | 12354 staged vs 12354 declared |
| staged rows equal the Phase 0 populated-row baseline | PASS | 12354 vs 12354 |
| direct-only rows equal the Phase 0 baseline | PASS | 8438 vs 8438 |
| assortment-only rows equal the Phase 0 baseline | PASS | 3899 vs 3899 |
| both-shape rows equal the Phase 0 baseline | PASS | 3 vs 3 |
| neither-shape rows equal the Phase 0 baseline | PASS | 14 vs 14 |
| assortment components equal the Phase 0 baseline | PASS | 15713 vs 15713 |
| blank-PO rows equal the Phase 0 baseline | PASS | 138 vs 138 |
| normalized PO numbers equal the Phase 0 baseline | PASS | 3087 vs 3087 |

**Overall: BALANCED**

## Source row-count history (provenance; settled by owner ruling)

The approved populated-row count is **12,354**. Two earlier figures appear in the history and are recorded here as provenance only — the owner closed the question by decision and no itemisation of the difference is required. This run still asserts against the count stated on the command line.

| Count | Workbook SHA-256 | How it was produced |
|---:|---|---|
| 12,328 | `4958b4b7…fc6abbe4` | 2026-08-09 Phase 0 audit of the then-approved export. |
| 12,323 | `b9b282dc…ffba30` / `904b2cb9…0b2845` | 2026-08-11 browser exports of the live sheet. DIFFERENT files from both the 2026-08-09 export and the approved one; neither was retained. |
| 12,354 | `68c9b03a0ec183e08b3a8f2344397e1bc4f61e73457849e7bf8c0cf7fb2409fe` | 2026-08-12 re-profile of the owner-accepted workbook using this importer's own `is_populated` definition (any mapped cell non-empty). The same file gives 12,349 under a PO-Status definition. |

For the record: the five-row shrink (12,328 -> 12,323) was measured on a file that is neither the 2026-08-09 export nor the approved workbook, and that file was not kept, so which rows changed cannot be recovered from this repository. The owner closed this by ruling that 12,354 is the approved count. It is not an outstanding gate.

