# PM Directus Archive Migration — 2026-06-30

Purpose: finish moving retired PM Directus archive data into the shared Supabase
backend and verify current ClickUp parity.

## Source

- Retired Directus archive dump:
  `/worksp/directus/pm-system/backups/directus-to-supabase-20260619T220134Z.dump`
- Live Supabase production project:
  `qsllyeztdwjgirsysgai`
- ClickUp workspace audited:
  `2298436`

## Supabase Results

Normalized PM rows now present in production Supabase:

| Supabase table | Rows |
|---|---:|
| `pim.product` | 17,909 |
| `pim.project` | 651 |
| `pim.stage` | 86 |
| `pim.checklist_item` | 33,325 |
| `pim.product_file` | 20,281 |
| `pim.product_update` | 11,367 |
| `pim.product_tag` | 13,383 |
| `pim.product_field` | 3,761 |
| `pim.stage_history` | 18,573 |
| `pim.product_submission` | 84 |
| `pim.product_sample` | 5 |
| `pim.revision_request` | 611 |
| `pim.saved_view` | 15 |
| `pim.product_link` | 104 |

`pim.product_link` is lower than the 495 archive rows because the current
Supabase model enforces one row per `(from_product_id, to_product_id, link_type)`.
The lossless source rows are preserved in `ingest.raw_record`.

Lossless archive rows copied to `ingest.raw_record` with
`source_system = 'directus_pm_archive'`:

| Source table | Rows |
|---|---:|
| `checklist_item` | 33,325 |
| `pm_saved_view` | 15 |
| `product` | 17,859 |
| `product_field` | 3,761 |
| `product_file` | 20,281 |
| `product_link` | 495 |
| `product_sample` | 5 |
| `product_submission` | 84 |
| `product_tag` | 13,383 |
| `product_update` | 11,367 |
| `project` | 651 |
| `revision_request` | 611 |
| `stage` | 86 |
| `stage_history` | 18,573 |

## ClickUp Audit

Final live ClickUp audit after importing the 50 missing tasks:

| Metric | Count |
|---|---:|
| ClickUp spaces audited | 3 |
| ClickUp lists audited | 23 |
| ClickUp task ids | 17,908 |
| ClickUp open top-level task ids | 3,567 |
| Supabase ClickUp task ids | 17,909 |
| Missing in Supabase | 0 |
| Missing open top-level in Supabase | 0 |
| Extra in Supabase | 1 |

The one extra Supabase task id is `868h067nh`. ClickUp API returned:
`Task not found, deleted`. The Supabase row is retained as historical product
data.

The 50 tasks missing from the retired Directus dump were imported directly from
ClickUp into `pim.product` with `external_source = 'clickup'` and their raw
ClickUp payloads archived in `ingest.raw_record` with
`source_system = 'clickup_live_audit'`.

## Notes

- Temporary schema `legacy_pm_import` was dropped after migration.
- Directus remains retired; it was used only as an archive source.
- Current PM runtime reads the shared Supabase backend.
