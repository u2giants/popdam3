# Rich PDF Extraction

This note records the 2026-07-09 discovery spike for scraping tech-pack and licensing-sheet PDFs into structured style data.

## Current State

PopDAM already extracts text from licensing-sheet and tech-pack PDFs into `pdf_text_samples.extracted_text`. Current durable use of that text is narrow:

- `sku_files_used` parses "Files Used" / "Source Files" / "Art Files" sections for Style Guide Sources.
- Library full-text search can search `pdf_text_samples.extracted_text` when the shared-db full-text RPCs are deployed.
- AI tagging may use extracted PDF text as context for existing asset fields such as designer names, tags, descriptions, and files-used.

There is not yet a durable structured "rich PDF data" model attached to `style_groups` and copied/searchable on member `assets`.

## Discovery Spike

On 2026-07-09, a read-only production sample was run against live project `qsllyeztdwjgirsysgai`.

Available extracted-text corpus at the time:

- Tech-pack PDFs with extracted text: `125`
- Licensing-sheet PDFs with extracted text: `14`

Sampled documents:

| # | Kind | File | SKU | Extracted chars |
|---|---|---|---|---:|
| 1 | tech pack | `MFH30DYNX01 tech pack.pdf` | `MFH30DYNX01` | 2189 |
| 2 | tech pack | `GFQ21DYPN03 tech pack.pdf` | `GFQ21DYPN03` | 2010 |
| 3 | tech pack | `VSZ62DYEC02 tech pack.pdf` | `VSZ62DYEC02` | 1724 |
| 4 | tech pack | `AAA66MVSP01_TECHPACK.pdf` | `AAA66MVSP01` | 1840 |
| 5 | tech pack | `MTP57MVSP02 tech pack.pdf` | `MTP57MVSP02` | 2392 |
| 6 | licensing sheet | `MQE48NBCK01_LICENSING SHEET.pdf` | `MQE48NBCK01` | 2478 |
| 7 | licensing sheet | `VSQ2ADYPN05_LICENSING SHEET.pdf` | `VSQ2ADYPN05` | 2468 |
| 8 | licensing sheet | `NHF61SMCM01_LICENSING SHEET.pdf` | `NHF61SMCM01` | 1412 |
| 9 | licensing sheet | `AA021DYLS03_LICENSING SHEET.pdf` | `AA021DYLS03` | 2054 |
| 10 | licensing sheet | `SES5KMVSP01_LICENSING SHEET.pdf` | `SES5KMVSP01` | 1919 |

The test used `qwen3.7-plus` through DashScope's OpenAI-compatible endpoint with `enable_thinking=false`. OpenRouter listed the model as `qwen/qwen3.7-plus`, but the available OpenRouter key returned a privacy/data-policy guardrail error for that endpoint. Future tests that require this exact model should use the `dashscope` field in the existing `ai-provider-api-keys` 1Password item unless the OpenRouter account policy is changed.

Generated local artifacts from the spike:

- `/tmp/popdam-rich-pdf-data-sample.md`
- `/tmp/popdam-rich-pdf-data-sample.json`

Those `/tmp` files contain the full raw extracted PDF text and Qwen's per-document relevance JSON. They are local working artifacts, not durable repo state.

## Relevant Data Found

Qwen repeatedly identified these useful fields across the sample:

- Source art/file references from "Files Used" sections, including `CC...`, PSD/TIF/AI filenames, and licensor asset IDs.
- Style-guide reference names more specific than licensor/property, such as `Disney Princess`, `Encanto`, and `Marvel's Spider-man`.
- Designer and technical designer names, often already mappable to existing fields.
- Approval/submission dates.
- Product dimensions, including cases where print area and total physical dimensions differ.
- Production materials and finishes, such as MDF, metal, canvas, sugar glitter, high-gloss coating, frame specs, and lacquer.
- Hardware and construction notes, such as keyhole hanger, sawtooth hanger, LED strip, battery box, try-me button, and packaging corners.
- Compliance and legal requirements, such as TSCA Title VI, California ATCM/CARB Phase 2, Prop 65/formaldehyde text, age rating, "not a toy", country of origin, and copyright lines.
- Manufacturer/factory info.
- Pantone/color references.
- Retailer program or season values when present in the document but absent from PopDAM path-derived `program`.

## Recommended Canonical Shape

Qwen suggested many overlapping field names. Collapse them before implementation. A practical first schema should look more like this:

| Canonical field | Suggested type | Attach to | Notes |
|---|---|---|---|
| `source_files` | structured array | style group, optionally asset-search projection | Extend/replace current `sku_files_used` use case; keep source file name, normalized match, resolved `style_guide_file_id` when available, source PDF asset ID, confidence, and extraction source. |
| `style_guide_reference` | text or structured object | style group | More specific guide/source label from the PDF, distinct from PopSG file links. |
| `approval_date` / `submission_date` | date | style group | Use nullable fields or a dated event list if multiple documents disagree. |
| `production_specs` | jsonb | style group | Dimensions, materials, finish, hardware, packaging, print process, construction notes. |
| `compliance_requirements` | jsonb | style group | Regulatory requirements, age rating, warnings, country of origin. |
| `legal_requirements` | jsonb | style group | Copyright/legal copy, placement, font size, required multilingual text. |
| `manufacturer_info` | jsonb | style group | Factory/manufacturer and address if present. |
| `color_references` | text array or jsonb | style group | Pantone and named colors. |
| `rich_pdf_search_text` | generated/maintained text | style group and/or assets | Flattened searchable text derived from the structured fields, if existing PDF full-text search is not enough. |

Do not create a separate physical column for every Qwen-proposed name such as `material_specs`, `production_material`, `production_materials`, `compliance_codes`, `compliance_standards`, and `regulatory_compliance`; those are the same domain and should be normalized into one structured object.

## Implementation Direction

New-style forward flow should be:

1. Agent extracts text into `pdf_text_samples`.
2. Worker or edge-triggered operation classifies eligible PDFs as tech-pack/licensing-sheet sources.
3. Qwen (or configured text extraction model) converts text into a strict schema with citations to raw text snippets or line spans.
4. Backend stores the structured result against the source PDF asset and rolls up the current best value to the owning `style_group`.
5. Asset search can find the data either through `style_group_id` rollup or a maintained asset projection.
6. Backfill runs in batches over existing `pdf_text_samples` coverage, then separately over PDFs not yet text-extracted.

All database work for this feature must be implemented in canonical `/worksp/shared-db`, not in this app repo's historical `supabase/migrations/` directory.

## Open Questions

- Whether rich PDF data should be stored as one `style_group_pdf_metadata` table, a `style_group_rich_metadata` jsonb column, or both raw extraction rows plus a rollup table.
- Whether source-file references should extend `sku_files_used` or move to a broader lineage table.
- Whether asset-level copying should be physical denormalization or query-time/search-index projection from `style_groups`.
- Which Qwen/DashScope credentials should be production-owned if this becomes a worker feature. The session used the existing `ai-provider-api-keys` 1Password item for a test only.
