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

---

## Design (2026-07-15) — builds on the landed two-level foundation

The two-level metadata foundation (`style_groups.item_description`,
`assets.content_type` incl. `tech_pack`/`licensing_sheet`, and the
`refresh_dam_search_*` rollup) was landed to production on 2026-07-15
(shared-db PR #67). Rich-PDF data is **product-level `style_group` metadata**, so
it extends that foundation rather than introducing a parallel schema.

### Grounding facts (verified on prod `qsllyeztdwjgirsysgai`, 2026-07-15)
- **Eligibility selector already exists:** `isStyleGuideSourcePdf(asset)` in
  `supabase/functions/_shared/tag-asset-contract.js` (filename match:
  `tech pack` / `tech_pack` / `techpack` / `licensing sheet` / `licensing_sheet`).
  This is the durable backfill selector — it does **not** depend on
  `assets.content_type`, which is `0` until image tagging next runs.
- **Corpus:** ~15,686 "tech pack" + ~3,353 "licensing sheet" PDFs by filename
  (~19k eligible). `pdf_text_samples` = 3,132 rows, **2,430 with real extracted
  text**. So most eligible PDFs have **no text yet** → the backfill is two-pass.
- `pdf_text_samples` (keyed by `asset_id`) has no structured-metadata column;
  rich data needs a new home. Tech-pack/licensing PDFs carry a `style_group_id`
  (their SKU group), so rollup target = the PDF asset's `style_group_id`.

### Storage — two objects, mirroring the two-level pattern
1. **Raw per-PDF extraction** — new `dam.pdf_rich_extraction`:
   - `asset_id uuid primary key` (source PDF; FK `public.assets`), `style_group_id uuid`, `sku text`
   - `doc_kind text` — `tech_pack` | `licensing_sheet`
   - `data jsonb not null` — the canonical field schema below
   - `source_text_sha256 text` — hash of the `pdf_text_samples.extracted_text` used (idempotency; skip re-extract when unchanged)
   - `model text`, `prompt_version text`, `schema_version int`, `confidence numeric null`, `parse_error text null`, `extracted_at timestamptz default now()`
   - One row per source PDF asset; re-extract updates in place.
2. **Product-level rollup** — extend `public.style_groups` (additive, nullable):
   `rich_metadata jsonb`, `rich_metadata_source text`, `rich_metadata_updated_at timestamptz`.
   Merged best value across the group's member-PDF extractions — mirrors how
   `item_description` sits on `style_groups`.

### Canonical `data` schema (collapse Qwen's overlapping names; all fields optional)
```
{
  source_files: [{ name, normalized, style_guide_file_id?, confidence }],
  style_guide_reference: text,
  approval_date: date, submission_date: date,
  production_specs: { dimensions, materials[], finish[], hardware[], packaging, print_process, construction_notes },
  compliance: { regulatory[], age_rating, warnings[], country_of_origin },
  legal: { copyright[], required_text[], placement, font_size },
  manufacturer: { name, address },
  colors: [{ pantone?, name? }],
  retailer_program: text, season: text
}
```
Enforced with a strict `json_schema` at the model layer.

### Rollup + search
- `public.refresh_style_group_rich_metadata(p_style_group_id)` — recompute
  `style_groups.rich_metadata` from member `dam.pdf_rich_extraction` rows
  (newest/highest-confidence per field; licensing_sheet may win legal/compliance,
  tech_pack may win production_specs).
- Extend `refresh_dam_search_style_group_document` to fold a flattened
  `rich_metadata` text into `search_text`; member assets inherit it via the
  existing `style_group_id` rollup — **no per-asset physical denormalization**
  (answers open Q3: search projection, not denorm).

### Answers to the open questions above
- **Q1 (one table vs jsonb column vs both):** both — raw extraction rows
  (`dam.pdf_rich_extraction`) for provenance/idempotency **plus** a `style_groups`
  rollup column for read/search.
- **Q2 (source_files vs sku_files_used):** keep separate. `sku_files_used` stays
  scoped to Style Guide Sources; rich `source_files` is lineage in the extraction
  JSON, optionally reconciled to `style_guide_file_id` via the existing fuzzy
  resolver later. Do not overload `sku_files_used`.
- **Q3 (asset denorm vs projection):** projection via the style_group search
  rollup; no physical per-asset copy in v1.
- **Q4 (model + creds):** **direct DeepSeek API** (OpenAI-compatible,
  `https://api.deepseek.com`), NOT OpenRouter. Rationale: the prompt has a large
  fixed prefix (instructions + strict JSON schema) identical across all ~19k
  calls; DeepSeek's **automatic prefix-based context caching** bills cache-hit
  input at ~1/10 the miss price — a major saving on a batch this size. OpenRouter
  adds a routing margin, does not reliably pass DeepSeek's auto-caching through,
  and its account data-policy guardrails already blocked the spike. **The worker
  must order messages stable-prefix-first** (instructions+schema, then the
  variable PDF text last) to maximize cache hits. Key: the existing `deepseek`
  field in 1Password `ai-provider-api-keys` (confirmed present) — no new secret.
  Store the model id in `admin_config.AI_TASK_MODELS.rich_pdf_extraction`.

### Worker + backfill
- New bulk op `rich-pdf-extract` (operation-loop), resumable via keyset cursor
  over `asset_id`, idempotent via `source_text_sha256`:
  - **Pass 1 (text present):** eligible-by-`isStyleGuideSourcePdf` ∩
    `pdf_text_samples.extracted_text` → call model → upsert
    `dam.pdf_rich_extraction` → `refresh_style_group_rich_metadata` →
    `refresh_dam_search_style_group_document`.
  - **Pass 2 (no text yet, ~16k):** on-prem agent PDF text extraction must run
    first (existing PDF backfill path — text extraction is on-prem, not cloud),
    then Pass 1.
- **Forward flow (new styles):** when tagging sets
  `content_type in ('tech_pack','licensing_sheet')` and text is present, enqueue
  rich extraction for that asset.

### Shared-db migration plan (preview-first, additive)
One additive migration: create `dam.pdf_rich_extraction`; add the 3 nullable
`style_groups` columns; add `refresh_style_group_rich_metadata()`; extend the
search rollup functions. All additive → cannot break CRM/PM/PLM.

### Decisions (resolved 2026-07-15 with owner)
1. **Extraction model:** **direct DeepSeek API** with automatic context caching
   (see Q4). Not OpenRouter — this is a cacheable, high-volume batch and the owner
   rule is "never use OpenRouter for cacheable repeated-prompt workloads." Worker
   orders the stable instructions+schema prefix first, PDF text last.
2. **Faceted filtering:** **project facet fields onto `assets` in v1** (owner
   choice). In addition to the `style_groups.rich_metadata` rollup + search,
   denormalize a small high-value set onto `assets` so `FilterSidebar` can facet
   immediately. Proposed v1 facet set (tight, extensible): `product_material`
   (text[]) and `product_dimensions` (text); candidates to add later:
   `country_of_origin`, `age_rating`. These are populated from the same
   extraction during rollup, and added to the asset search document + counts.
