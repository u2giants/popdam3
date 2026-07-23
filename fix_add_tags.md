# PopSG File Tags — Detailed Implementation Plan

**Status:** Proposed implementation plan

**Application:** PopSG (`https://sg.designflow.app`)

**Repository:** `u2giants/popdam3`

**Shared backend:** `u2giants/shared-db`, Supabase project `qsllyeztdwjgirsysgai`

**Last updated:** 2026-07-23

## 1. Executive summary

Every active file in PopSG must have useful, searchable tags, and those tags
must be visible in the file-details flyout. The first tagging pass should not
depend on generative vision AI. It should use evidence PopSG already possesses
or can extract deterministically:

1. every directory segment above the file, at every depth;
2. the filename and extension;
3. controlled PopSG taxonomies and aliases;
4. consensus across files in the same folder;
5. embedded PDF, XMP, IPTC, SVG, Illustrator, Photoshop, and InDesign metadata;
6. native document text and OCR;
7. inexpensive image measurements such as dominant colors and orientation;
8. verified duplicate/related-file relationships; and
9. existing PopDAM-to-PopSG source-file relationships.

Vision AI becomes a later enrichment layer for facts that cannot be inferred
reliably from those sources, such as visual composition, motifs, artistic style,
unlabelled characters, and scene content.

The implementation must preserve provenance. A user should see a clean combined
tag list, while the system retains where each tag came from, its confidence,
whether it was inherited, and the exact evidence that generated it. Manual tags
must never be removed by an automated rerun.

## 2. Business outcome

When this work is complete:

- every active `style_guide_files` row has a completed deterministic tagging
  evaluation, even if no useful tag could be inferred;
- files inherit relevant information from their **entire** directory ancestry,
  not only the existing licensor/property/style-guide positions;
- tags appear in the PopSG file-details flyout;
- users can add and remove manual tags;
- users can search and filter PopSG by canonical tags;
- automatic tags can be traced to their source and regenerated safely;
- renaming or moving a file recalculates path-derived tags;
- tagging is incremental after each crawl and can also be backfilled in batches;
- vision AI can later add tags without replacing deterministic or manual tags;
  and
- tag quality and coverage are measurable from the Settings UI.

## 3. Current state

### 3.1 Existing PopSG file metadata

`style_guide_files` already contains:

- `root_label`
- `relative_path`
- `filename`
- `basename_no_ext`
- `file_extension`
- `path_segments`
- `directory_path`
- `depth`
- `licensor_name`
- `property_folder`
- `style_guide_folder`
- `normalized_name`
- `normalized_style_guide_folder`
- `size_bytes`
- `modified_at`
- `quick_hash`
- `thumbnail_url`
- `thumbnail_error`
- `is_active`
- crawl/run identifiers

The crawl derives path metadata in
`apps/bridge-agent/src/style-guide-crawler.ts`, and
`supabase/functions/agent-api/index.ts` upserts the resulting file rows.

### 3.2 Existing PopSG browsing UI

`src/pages/popsg/PopSGLibraryPage.tsx` supports grouped Style Guides and
individual Files. The file detail flyout currently loads file identity, path,
preview, type, size, and modified date, but PopSG has no canonical file-tag
storage or tag editor.

### 3.3 Existing reusable capabilities

- PopDAM has normalized tag storage in `asset_tags` and manual tag behavior in
  `src/components/library/AssetDetailPanel.tsx`. These are useful design
  references, but PopSG tags must not reuse `asset_tags`, because PopSG files
  live in `style_guide_files`, not `assets`.
- PDF text extraction already exists through the bridge and Windows agents and
  writes `pdf_text_samples` for PopDAM assets. The extraction code is reusable,
  but the current table and API contracts are asset-oriented and must not be
  overloaded without an explicit shared-backend design.
- `sku_files_used.style_guide_file_id` links some PopDAM licensing-sheet or
  tech-pack references to real PopSG source files.
- Character, property, and licensor taxonomies already exist in the shared
  backend and can seed canonical tag aliases.

### 3.4 Important constraint

`style_guide_files` currently has no tag column or normalized PopSG tag table.
This feature therefore requires a shared-backend change. All DDL, functions,
RLS, indexes, and migrations must be authored in canonical
`/worksp/shared-db`, on a dedicated branch and PR, previewed before production,
and merged before dependent PopDAM code is landed. Do not create migrations in
this repository's historical `supabase/migrations/` directory.

## 4. Product decisions

### 4.1 Tags are canonical concepts, not raw words

Do not store every token found in a path or document. Normalize candidates
against a controlled vocabulary so variants converge:

- `all over`, `all-over`, `aop` -> `allover pattern`
- `flowers`, `flower`, `florals` -> `floral`
- `xmas`, `christmas 2026` -> `christmas` plus `2026`
- `b&w`, `black and white`, `mono` -> the appropriate canonical color/style tag

Unrecognized but credible path or filename phrases may be stored as provisional
canonical tags after normalization. Extracted document body words may not.

### 4.2 Folder position is evidence

The full path is processed from root to immediate parent. Each segment retains:

- its zero-based depth;
- its raw value;
- its normalized value;
- any taxonomy/facet match; and
- whether it was suppressed as an operational folder.

Known positional fields (`licensor_name`, `property_folder`,
`style_guide_folder`) remain authoritative for their facets. Deeper folders add
collection, character, season, occasion, application, asset-type, theme, and
style evidence.

### 4.3 Tags have facets

Initial facets:

- `licensor`
- `property`
- `character`
- `collection`
- `season`
- `year`
- `occasion`
- `product`
- `application`
- `asset_type`
- `theme`
- `style`
- `color`
- `material_finish`
- `audience`
- `language`
- `workflow`
- `other`

`workflow` tags such as `approved`, `archive`, or `final` should be hidden from
the default creative-tag view unless users explicitly enable operational tags.

### 4.4 Provenance and confidence are mandatory

Every stored file/tag relationship records:

- source;
- confidence;
- evidence;
- source file/folder relationship where applicable;
- inference-rule version;
- created and last-confirmed timestamps; and
- whether a user has confirmed or rejected it.

Confidence bands:

- `1.00`: manual tag or exact authoritative taxonomy field;
- `0.95`: exact controlled-taxonomy match in path/filename;
- `0.90`: embedded keyword/XMP metadata match;
- `0.85`: folder consensus with sufficient support;
- `0.80`: native document title/heading match;
- `0.70`: OCR or cross-reference inference;
- below `0.70`: suggestion only; do not display as an accepted tag by default.

Exact values should be configurable by inference-rule version rather than
scattered through handlers.

### 4.5 Manual intent always wins

- Automated reruns never delete `source = manual` rows.
- A rejected automatic tag is recorded so the same evidence and rule version do
  not immediately recreate it.
- If a user manually adds a tag previously rejected from automation, the manual
  row wins.
- Automated tags may be replaced only by a newer run of the same source/rule,
  and only within that source's result set.

### 4.6 Empty results are explicit

A file with zero accepted tags is not necessarily an unprocessed file. Store a
tagging-state row with `status = completed`, candidate/accepted counts, rule
version, and completion timestamp. Coverage reporting must distinguish:

- not evaluated;
- evaluation failed;
- evaluated with no accepted tags; and
- evaluated with accepted tags.

## 5. Proposed shared data model

Finalize exact names in the shared-db design review, but use this shape.

### 5.1 `style_guide_tags`

Canonical tag dictionary:

| Column | Purpose |
|---|---|
| `id uuid PK` | Stable identity |
| `tag text UNIQUE` | Lowercase canonical display value |
| `normalized_tag text UNIQUE` | Accent/punctuation-insensitive key |
| `facet text` | Controlled facet |
| `display_name text` | User-facing capitalization |
| `is_active boolean` | Retire without deleting history |
| `is_system boolean` | Controlled versus organically created |
| `created_at`, `updated_at` | Audit timestamps |

Constraints:

- non-empty canonical and normalized values;
- facet CHECK constraint;
- uniqueness must be case/normalization safe.

Indexes:

- unique normalized lookup;
- facet plus active status;
- trigram index on canonical/display name for manual autocomplete.

### 5.2 `style_guide_tag_aliases`

| Column | Purpose |
|---|---|
| `id uuid PK` | Identity |
| `tag_id uuid FK` | Canonical tag |
| `alias text` | Raw synonym |
| `normalized_alias text UNIQUE` | Matching key |
| `scope jsonb NULL` | Optional licensor/property context |
| `created_by text` | seed, admin, learned-review |

Scoped aliases prevent ambiguous names from matching globally when their
meaning depends on a licensor or property.

### 5.3 `style_guide_file_tags`

| Column | Purpose |
|---|---|
| `id uuid PK` | Identity |
| `style_guide_file_id uuid FK` | Tagged file |
| `tag_id uuid FK` | Canonical tag |
| `source text` | Provenance enum |
| `facet text` | Snapshot for efficient filtering/audit |
| `confidence numeric` | 0 to 1 |
| `status text` | accepted, suggested, rejected |
| `evidence jsonb` | Raw segment/filename/text/rule evidence |
| `inherited boolean` | Folder/related-file inheritance |
| `source_file_id uuid NULL` | Duplicate/sibling origin |
| `rule_version text` | Reproducibility |
| `confirmed_by uuid NULL` | User confirmation |
| `confirmed_at timestamptz NULL` | User confirmation time |
| `created_at`, `updated_at` | Audit timestamps |

Recommended uniqueness:

`(style_guide_file_id, tag_id, source, rule_version)`

Do not collapse all provenance into a single row. The same canonical tag may be
supported independently by a property folder, filename, and embedded metadata.
The UI/API should deduplicate it for display while retaining every evidence row.

Source enum:

- `manual`
- `path`
- `filename`
- `folder_consensus`
- `embedded_metadata`
- `document_text`
- `ocr`
- `image_measurement`
- `duplicate`
- `cross_reference`
- `vision_ai`

### 5.4 `style_guide_tagging_state`

One row per file and pipeline kind:

| Column | Purpose |
|---|---|
| `style_guide_file_id uuid FK` | File |
| `pipeline text` | deterministic, document, measurement, vision |
| `status text` | pending, running, completed, failed |
| `input_fingerprint text` | Detect changed inputs |
| `rule_version text` | Version executed |
| `candidate_count int` | Observability |
| `accepted_count int` | Observability |
| `error_code`, `error_detail` | Loud failure reporting |
| `attempt_count int` | Retry control |
| `started_at`, `completed_at`, `updated_at` | Timing |

Unique key: `(style_guide_file_id, pipeline)`.

### 5.5 Optional materialized aggregate

Do not add `tags text[]` directly to `style_guide_files` in the first design
unless production query measurements prove the normalized join is too slow.
Prefer:

- an indexed view/RPC returning distinct accepted tags; or
- a maintained aggregate table keyed by file if PostgREST filtering across the
  normalized joins is inadequate.

If a denormalized array is added for performance, it is a derived cache only.
A database trigger/function must maintain it from accepted
`style_guide_file_tags`; application code must never independently write both.

### 5.6 RLS and permissions

- Authenticated PopSG users with `app_access.app = styleguides` can read active
  tags and accepted file-tag relationships.
- Only admins/service-role pipelines can create canonical tags or automatic
  relationships.
- Authorized PopSG users may add/remove their own manual tags if the current
  product permission model permits file metadata editing; otherwise restrict
  manual edits to admins for the first release.
- Rejections/confirmations require an authenticated user identity.
- No client may write confidence, source, evidence, or rule version for an
  automatic tag.

## 6. Controlled vocabulary and normalization

### 6.1 Seed sources

Build the first vocabulary from:

1. distinct `style_guide_files.licensor_name`;
2. distinct `property_folder`;
3. the shared licensor/property/character taxonomy;
4. distinct directory segments at every depth, with counts;
5. repeated filename tokens and phrases;
6. existing curated PopDAM tags, reviewed before importing;
7. known asset/application/style terms supplied by the business.

Do not automatically publish every distinct folder segment. Produce a review
report containing:

- normalized candidate;
- raw variants;
- file count;
- folder count;
- licensors/properties where found;
- inferred facet;
- proposed canonical tag;
- suppression reason, if any.

### 6.2 Normalization algorithm

Create one shared project-owned normalization module used by server/worker tests:

1. Unicode NFKC normalization;
2. lowercase;
3. normalize smart quotes/dashes and whitespace;
4. split camelCase, underscores, slashes, and hyphens;
5. preserve meaningful alphanumeric identifiers and four-digit years;
6. strip standalone version tokens and file extensions;
7. singularize only through explicit aliases, not an unrestricted English
   stemmer;
8. match longest known multi-word aliases before individual words;
9. apply contextual/scoped aliases;
10. return canonical tag IDs plus the matched span and rule.

Avoid aggressive stemming. It can corrupt character names, property names, and
licensed titles.

### 6.3 Suppression vocabulary

Maintain a configurable, reviewed list of operational folder tokens:

- `final`, `finals`, `approved`, `working`, `archive`, `old`
- `assets`, `art`, `files`, `links`, `images`, `source`
- `misc`, `other`, `new folder`
- version-only tokens such as `v2`, `rev 3`, `copy`
- platform noise such as macOS/Windows metadata folders

Some terms are useful as hidden `workflow` tags but should not pollute default
creative search. Suppression rules must be scoped; for example, `icons` is
creative content and must not be discarded just because it is a common folder.

## 7. Deterministic inference pipeline

Implement the pipeline as idempotent stages. Each stage emits candidates with
canonical tag, facet, confidence, evidence, and source. A common reducer applies
thresholds, deduplicates display results, and writes only that stage's
relationships.

### 7.1 Stage A — entire path ancestry

Input: `root_label`, `relative_path`, `path_segments`, known positional columns.

For every directory segment from the first segment through the immediate parent:

1. store depth and raw segment;
2. match exact known licensors/properties/characters first;
3. match longest taxonomy aliases;
4. parse year, season, and occasion patterns;
5. detect asset type/application/style phrases;
6. suppress operational noise;
7. create accepted tags at the configured confidence;
8. retain unmatched credible phrases as candidates for vocabulary review.

The file inherits all accepted creative tags from all ancestors. Do not impose a
three-level limit.

Example:

`Disney/Princess/Ariel/Holiday 2026/Packaging/Patterns/Floral/file.ai`

Expected tags:

- `disney` (`licensor`)
- `disney princess` or the canonical property name (`property`)
- `ariel` (`character`)
- `christmas` or `holiday`, depending on taxonomy (`occasion`)
- `2026` (`year`)
- `packaging` (`application`)
- `allover pattern` or `pattern` (`asset_type`)
- `floral` (`theme`)

### 7.2 Stage B — filename

Input: basename without extension.

- split delimiters and camel case;
- remove known version/revision suffixes;
- extract known reference identifiers into searchable metadata, not creative
  tags, unless explicitly configured;
- apply taxonomy and alias matching;
- recognize colorways, seasons, occasions, asset types, and character/property
  aliases;
- give exact multi-word matches priority;
- never infer a licensor/property that conflicts with authoritative path fields
  without recording a data-quality warning.

### 7.3 Stage C — folder consensus

Run after stages A/B across a completed crawl:

1. group active files by `(root_label, directory_path)`;
2. count accepted non-manual tags from filename and embedded metadata;
3. inherit a tag to sibling files only when:
   - at least a minimum number of distinct files support it;
   - support exceeds a configured proportion of eligible files;
   - the tag facet is allowed to propagate; and
   - there is no conflicting file-specific evidence;
4. store supporting file IDs/counts in evidence;
5. prevent recursive reinforcement: `folder_consensus` tags do not count as
   original support for a later consensus run.

Starting thresholds to validate with real data:

- folders with 2–4 files: require all eligible files;
- folders with 5–19 files: require at least 3 files and 70%;
- folders with 20+ files: require at least 5 files and 60%.

Never propagate colors, language, or workflow state by default. Character,
property, collection, occasion, theme, style, application, and asset type may
propagate after validation.

### 7.4 Stage D — embedded metadata

Extract without rendering or generative AI:

- PDF Info and XMP title, subject, keywords, author;
- JPEG/TIFF/PNG XMP and IPTC keywords/captions;
- SVG `<title>`, `<desc>`, named groups/layers, and metadata;
- PSD/AI XMP properties;
- InDesign document/package metadata when available;
- artboard, layer, and swatch names where extraction is safe and bounded.

Only controlled taxonomy matches and explicitly curated metadata keywords become
accepted tags. Author/designer names should go to dedicated metadata rather than
creative tags unless a later product decision says otherwise.

Extraction must be:

- time-bounded;
- size-bounded;
- sandboxed from malformed files;
- non-blocking to the crawl;
- cached by a fingerprint of file identity/size/modified time/full hash where
  available; and
- loud on failure through tagging-state error fields and Settings diagnostics.

### 7.5 Stage E — document text and OCR

Priority:

1. native embedded text;
2. title/cover-page headings;
3. OCR only when native text is absent or insufficient.

Match only:

- known licensors, properties, and characters;
- controlled collection/season/occasion phrases;
- controlled asset types, applications, themes, styles, and material finishes;
- explicit keyword/contents sections.

Do not convert arbitrary frequent words into tags. Store bounded evidence:
document page, matched phrase, extraction method, and a short surrounding
snippet. Never store entire copyrighted document bodies in tag evidence.

Design this as a reusable style-guide-file document-extraction contract. Do not
force PopSG records into the asset-only `pdf_text_samples.asset_id` relationship.

### 7.6 Stage F — inexpensive image measurements

From existing thumbnails, derive without generative AI:

- dominant canonical color families;
- monochrome/grayscale/multicolor;
- landscape/portrait/square orientation;
- transparency presence;
- optional repeating-pattern likelihood after validation.

Dimensions and orientation are better presented as structured metadata/facets;
only user-valuable concepts such as canonical color families should appear in
the default tag list.

### 7.7 Stage G — duplicate and related-file inheritance

- A full cryptographic content hash can justify exact tag inheritance.
- `quick_hash` may narrow candidates but must never prove identity; it is a
  sampled hash and is not unique.
- Near-duplicate/perceptual similarity can create suggestions, not accepted
  tags, until precision is validated.
- Record `source_file_id` and similarity/identity evidence.
- Do not copy file-specific workflow, language, or color tags blindly across
  format variants.

### 7.8 Stage H — PopDAM cross-reference context

Use `sku_files_used.style_guide_file_id` plus associated design metadata as
lower-confidence evidence:

- property/character associations supported by multiple referencing designs;
- product categories or applications in which the source is used;
- collection/program context where consistent.

Rules:

- authoritative PopSG path taxonomy wins over conflicting PopDAM context;
- require multiple independent references for accepted inheritance;
- a single reference creates a suggestion only;
- keep product/application context separate from what the source artwork itself
  visibly depicts.

### 7.9 Later stage — vision AI

Vision enrichment must write `source = vision_ai` through the same normalized
tag system. It must receive the accepted deterministic tags and metadata as
context, avoid duplicating them, and focus on missing visual facts.

Vision reruns may replace only prior output from the same model/rule version.
They must not overwrite manual, path, filename, metadata, or document-derived
tags.

## 8. Pipeline orchestration

### 8.1 Incremental trigger

At crawl upsert:

- compute an input fingerprint from normalized path, filename, extension, size,
  modified time, and relevant content/hash metadata;
- if the fingerprint or deterministic rule version changed, mark deterministic
  tagging pending;
- if file content changed, mark embedded/document/measurement stages pending;
- a move or rename must recalculate path and filename tags even if content is
  unchanged;
- inactive files retain tag history but are excluded from normal browsing and
  coverage denominators.

Do not perform all extraction synchronously inside
`complete-style-guide-crawl`; the crawl must remain fast and resilient.

### 8.2 Worker operation

Add a Railway worker operation family, tentatively:

- `tag-popsg-deterministic`
- `tag-popsg-documents`
- `tag-popsg-measurements`
- `tag-popsg-folder-consensus`

Alternatively use one `tag-popsg-files` operation with explicit stages. Choose
the fewer-moving-parts design after checking the existing worker operation
framework.

Requirements:

- keyset pagination by stable file ID;
- bounded batches;
- resumable cursor;
- stage-aware retry;
- per-file failure isolation;
- progress counts for pending/completed/failed/no-tag;
- idempotent writes;
- no exact total-count query in a hot loop if it is expensive;
- mutual exclusion with another run of the same PopSG tag stage;
- safe continuation after deployment/restart.

### 8.3 Nightly sequencing

Recommended sequence:

1. nightly PopSG crawl completes;
2. deterministic path/filename tagging runs for changed/new files;
3. document/metadata extraction runs for eligible changed/new files;
4. folder consensus runs only after the source stages complete;
5. optional duplicate/cross-reference enrichment runs;
6. coverage and vocabulary-candidate reports refresh.

A failed tag stage must not mark the crawl failed or deactivate files, but it
must remain visible as a failed tagging stage.

### 8.4 Backfill

Provide Settings actions:

- `Tag new/changed files`
- `Rebuild deterministic tags`
- `Process embedded metadata/document text`
- `Recompute folder consensus`
- `Retry failures`

The initial production backfill should start with path and filename only, then
measure quality before enabling document/OCR and inheritance stages.

## 9. API design

Prefer focused RPCs or admin-api routes rather than broad client table writes.

Required read shape for the flyout:

```ts
type StyleGuideDisplayTag = {
  id: string;
  tag: string;
  display_name: string;
  facet: string;
  confidence: number;
  manual: boolean;
  confirmed: boolean;
  sources: Array<{
    source: string;
    inherited: boolean;
    evidence_summary: string;
  }>;
};
```

Required operations:

- list accepted tags for one file;
- add a manual tag using canonical autocomplete or create a permitted new tag;
- remove a manual tag;
- reject an automatic tag;
- restore/confirm a suggested or rejected tag;
- list tag facets/counts for filtering;
- filter/search active files by one or more canonical tag IDs;
- retrieve tagging status and failure diagnostics;
- request/backfill a tagging stage as an admin.

The mutation response must return the final display-tag list so the UI does not
temporarily diverge from server state.

## 10. File-details flyout

Update the file-details flyout in
`src/pages/popsg/PopSGLibraryPage.tsx`, preferably extracting it into a focused
component if the page would otherwise grow further.

### 10.1 Default presentation

Add a **Tags** section near the file identity/path metadata:

- deduplicated tag chips;
- canonical display names;
- facet-aware ordering;
- manual add control;
- manual remove control;
- clear empty state: `No tags inferred yet` or `Tagging pending`;
- loading and explicit error states;
- no layout jump when tags load.

Recommended ordering:

1. property and character;
2. collection;
3. occasion/season/year;
4. application and asset type;
5. theme and style;
6. color/material/audience;
7. other.

Licensor may remain in the existing location field and also be available as a
filter tag; avoid visually repeating it if that makes the panel noisy.

### 10.2 Provenance disclosure

Hover/click a chip to show:

- source labels such as `From folder`, `From filename`, `From PDF metadata`,
  `Inherited from folder`, `Manual`, or `Vision AI`;
- confidence only in admin/debug mode;
- concise evidence, for example:
  `Folder level 5: "Holiday 2026"` or
  `Filename phrase: "floral pattern"`.

Do not expose raw JSON, full OCR text, model internals, or database terminology
to normal users.

### 10.3 Editing behavior

- Adding a tag searches canonical tags with facet labels.
- Allow creating a new canonical manual tag only for authorized users.
- Removing a manual tag deletes that manual relationship.
- Removing an automatic tag records a rejection instead of deleting evidence.
- Provide an undo toast.
- Manual changes update immediately and invalidate file, filter-facet, and
  search queries.

### 10.4 Accessibility and responsive behavior

- chips and controls are keyboard accessible;
- remove buttons have tag-specific labels;
- provenance popovers work without hover;
- long tags wrap or truncate with an accessible full label;
- the section works in the existing mobile/narrow flyout width;
- color tags never rely only on a color swatch to communicate meaning.

## 11. Search and filtering

### 11.1 Search

Include accepted canonical tag display names and aliases in PopSG search.
Search should match:

- canonical tag;
- known alias;
- filename/path as it does today;
- licensor/property/style-guide names.

Do not make tag search depend on the unfinished PopDAM semantic-search pipeline.
Ship exact/prefix/full-text tag matching first.

### 11.2 Faceted filter

Add a tag filter for Files view and decide separately how guide cards aggregate
file tags. Recommended first release:

- Files view: filter by one or more tags;
- Style Guides view: show aggregated top tags, but do not add multi-tag guide
  filtering until query behavior and performance are measured.

For multi-select:

- tags within the same facet default to OR;
- different facets default to AND;
- show removable filter chips;
- keep URL/search state behavior consistent with current PopSG filters.

### 11.3 Group aggregation

For each style-guide group, compute:

- distinct accepted tags;
- number/proportion of files supporting each tag;
- top tags by facet and coverage.

Do not claim a guide has a tag because one outlier file has it. Use a documented
coverage threshold and always retain the underlying file-level truth.

## 12. Settings and observability

Add a PopSG tagging diagnostics section showing:

- active file count;
- evaluated deterministic count and percentage;
- accepted-tag coverage;
- evaluated-with-zero-tags count;
- pending/running/failed counts by stage;
- tag relationships by source;
- top canonical tags;
- top unmatched folder/filename candidates;
- top suppressed tokens;
- conflict count;
- last completed run and rule version;
- average and p95 processing time;
- retry action for failures.

Provide sample-review tooling:

- random files with their full paths and inferred tags;
- samples by inference source;
- samples by low confidence;
- conflicts between path, filename, and taxonomy;
- tags with unusually high prevalence;
- folders where consensus would affect many files.

Every fallback or extraction failure must appear here; do not silently skip.

## 13. Security, privacy, and copyright safeguards

- Do not send file content outside approved systems during deterministic stages.
- Store only bounded evidence snippets, not complete document text.
- Sanitize metadata strings before display.
- Treat PDFs/SVGs/Adobe files as untrusted input; use safe parsers, timeouts, and
  resource limits.
- Do not execute embedded scripts, actions, macros, or external references.
- Do not expose local NAS absolute paths; continue using PopSG relative paths.
- RLS must enforce existing PopSG entitlement boundaries.
- Vision AI remains separately configurable and auditable.

## 14. Performance requirements

Initial targets, to validate on preview data:

- path/filename tagging: at least 1,000 files/minute per worker process;
- file-detail tag read: p95 under 250 ms from Supabase;
- tag-filter first page: p95 under 500 ms for the production-scale library;
- no crawl batch delayed materially by tagging work;
- no full-table offset pagination;
- no N+1 tag queries in Files view or group-detail lists;
- bounded document extraction memory and wall time;
- backfill is resumable after worker restart.

Use `EXPLAIN (ANALYZE, BUFFERS)` on preview-scale fixtures for:

- one-file tag retrieval;
- tag facet counts;
- single-tag file filtering;
- multi-tag AND filtering;
- group tag aggregation;
- pending-work keyset selection.

## 15. Test plan

### 15.1 Unit tests

Normalization:

- Unicode and punctuation;
- camelCase/underscore/hyphen splitting;
- longest multi-word alias;
- scoped aliases;
- years and revisions;
- singular/plural aliases;
- suppression rules;
- character/property names that resemble ordinary words.

Path inference:

- depths from 1 through deeply nested trees;
- every ancestor contributes;
- known positional facets remain authoritative;
- operational folders are hidden/suppressed;
- conflicting path and filename evidence;
- move/rename fingerprint changes.

Folder consensus:

- threshold boundaries;
- no recursive self-reinforcement;
- no propagation of disallowed facets;
- small/large folders;
- conflicting siblings;
- inactive files excluded.

Reducer/write behavior:

- provenance retained;
- display deduplication;
- manual tag preservation;
- rejection persistence;
- idempotent rerun;
- newer rule version replaces only its own source.

### 15.2 Database tests

- constraints and unique indexes;
- RLS read/write cases;
- cascade/archive behavior when a file becomes inactive or is deleted;
- canonical alias collision handling;
- RPC authorization;
- filtering semantics;
- trigger/materialized aggregate correctness, if used;
- keyset work claiming under concurrent workers.

### 15.3 API/integration tests

- list/add/remove/reject/confirm;
- unauthorized mutation;
- stale client retry;
- changed crawl file becomes pending;
- unchanged crawl file is not reprocessed;
- failed file does not block batch;
- inactive file excluded from facets;
- manual tag survives every automatic rebuild.

### 15.4 UI tests

- flyout loading, populated, empty, pending, and error states;
- add/remove/reject and undo;
- duplicate source display;
- keyboard and screen-reader behavior;
- long tags and narrow viewport;
- filter selection and URL state;
- no N+1 requests.

### 15.5 Visual verification

Serve PopSG locally with `?mode=popsg` and capture screenshots of:

- file flyout with representative tags;
- provenance popover;
- manual tag autocomplete;
- no-tag/pending state;
- tag filters in Files view;
- narrow/mobile flyout.

### 15.6 Quality evaluation set

Before broad rollout, create a human-reviewed set of at least 300 files,
stratified by:

- licensors/properties;
- shallow and deep directory trees;
- common and rare file types;
- clean and messy filenames;
- small and large folders;
- photography, source art, patterns, icons, logos, packaging, PDFs, and Adobe
  source files.

For each expected tag, record facet and acceptable aliases. Measure:

- precision by source and facet;
- recall by source and facet;
- false-positive rate;
- zero-tag rate;
- disagreement rate;
- folder-consensus contamination rate.

Launch targets:

- path/filename precision >= 97%;
- folder-consensus precision >= 98%;
- deterministic accepted-tag precision >= 95% overall;
- no manual-tag loss;
- zero cross-property/licensor contamination in the review set.

Recall is secondary to precision for the deterministic phase; vision AI can
later fill missing visual concepts.

## 16. Implementation sequence

### Phase 0 — data profiling and vocabulary proposal

1. Query all active PopSG path segments and filename tokens.
2. Produce candidate counts, variants, facets, and suppression candidates.
3. Compare candidates with existing licensor/property/character taxonomies.
4. Create the 300-file evaluation set.
5. Obtain business review of canonical facets, aliases, and suppressed terms.

**Gate:** vocabulary and evaluation fixture are approved; no schema/code change
depends on unreviewed mass-imported folder words.

### Phase 1 — shared-db foundation

1. Confirm `/worksp/shared-db` is clean.
2. Create a dedicated branch such as `popsg-file-tags`.
3. Add the four normalized tables, constraints, indexes, RLS, and read/write
   RPCs.
4. Seed only reviewed tags and aliases.
5. Add database tests.
6. Apply to a Supabase preview branch.
7. Load production-scale/synthetic fixtures and capture query plans.
8. Open, review, and merge the shared-db PR.
9. Verify migration ledger and objects in production.

**Gate:** preview tests pass, required query p95 targets are met, shared-db PR is
merged/applied, and `/worksp/shared-db` is clean.

### Phase 2 — path and filename inference

1. Add shared normalization/taxonomy modules under project-owned worker source.
2. Implement candidate generation and reducer.
3. Add resumable worker operation.
4. Mark changed/new crawl rows pending without blocking the crawl.
5. Add unit/integration tests.
6. Run against the evaluation set and tune rules.

**Gate:** precision targets pass and idempotent/manual-preservation tests pass.

### Phase 3 — flyout and manual tags

1. Add typed tag read/mutation hooks.
2. Add Tags section to the PopSG file flyout.
3. Add provenance disclosure and manual editing.
4. Add loading, empty, pending, and error states.
5. Add UI tests and visual screenshots.

**Gate:** users can see and safely manage tags on desktop and narrow layouts;
visual review passes.

### Phase 4 — search, filters, and diagnostics

1. Add canonical tag matching to Files search.
2. Add faceted tag filters to Files view.
3. Add Settings coverage/failure diagnostics.
4. Add vocabulary-candidate review report.
5. Load-test production-scale queries.

**Gate:** query performance targets pass and diagnostics account for every active
file.

### Phase 5 — production deterministic backfill

1. Deploy code through GitHub/Railway/Coolify-owned paths.
2. Run a small canary across reviewed folders.
3. Compare canary results with evaluation expectations.
4. Expand to one licensor/property cohort.
5. Backfill all active files.
6. Recompute folder consensus only after base tagging completes.
7. Monitor failures, coverage, prevalence outliers, and contamination.

**Gate:** all active files have deterministic evaluation state, coverage is
reported, and quality audit passes.

### Phase 6 — embedded metadata and document text

1. Define a PopSG-specific extraction record/API contract.
2. Reuse safe parsers from existing bridge/Windows agents where appropriate.
3. Implement embedded metadata extraction.
4. Implement native text and bounded OCR matching.
5. Validate each source separately against the evaluation set.
6. Enable sources progressively.

**Gate:** each source meets its precision target and failure modes are visible.

### Phase 7 — image measurements and relationship enrichment

1. Add dominant-color/orientation/transparency analysis.
2. Add exact full-hash inheritance.
3. Evaluate near-duplicate suggestions separately.
4. Add conservative cross-reference inference.

**Gate:** no `quick_hash`-only inheritance, no cross-property contamination, and
all inherited tags expose their source.

### Phase 8 — vision AI enrichment

1. Define the PopSG vision schema using the same canonical tag IDs/facets.
2. Send deterministic context and ask only for missing visual concepts.
3. Store model/provider/prompt version and evidence as `vision_ai`.
4. Canary and compare incremental value against cost and false positives.
5. Tag only files/thumbnails where deterministic coverage is insufficient.

**Gate:** vision adds measurable recall without overwriting trusted sources.

## 17. Expected application files

Exact placement may change after code inspection, but likely changes include:

### PopDAM/PopSG repository

- `src/pages/popsg/PopSGLibraryPage.tsx`
- a new focused file-detail/tag component under `src/pages/popsg/` or
  `src/components/popsg/`
- new hooks under `src/hooks/`
- new PopSG tag types under `src/types/`
- `apps/worker/src/operation-loop.ts`
- new handlers/modules under `apps/worker/src/handlers/`
- `apps/bridge-agent/src/style-guide-crawler.ts`
- `apps/bridge-agent/src/api-client.ts` if extraction commands are added
- `apps/windows-agent/src/` for Adobe/document extraction where required
- `supabase/functions/agent-api/index.ts`
- `supabase/functions/admin-api/index.ts` or focused shared handlers
- `supabase/functions/_shared/operation-constants.ts`
- targeted tests under `src/test/` and app-level test directories
- `docs/POPSG.md`
- `docs/SCHEMA.md`
- `docs/WORKER_LOGIC.md`
- `docs/API_CONTRACTS.md`
- `docs/KNOWN_QUIRKS.md` for any intentional constraints discovered

Do not manually edit generated
`src/integrations/supabase/types.ts`; regenerate it through the canonical
workflow after shared-db changes.

### Canonical shared-db repository

- new timestamped migrations under `/worksp/shared-db/supabase/migrations/`
- shared-db schema/application notes
- tests and generated schema artifacts required by that repository

## 18. Deployment and rollback

### Deployment order

1. shared-db preview and production-compatible additive migration;
2. backend/API/worker code that can populate tags;
3. flyout read UI;
4. manual-edit UI;
5. search/filter UI;
6. controlled backfill;
7. later extraction/enrichment stages.

All schema changes should initially be additive. Do not make existing PopSG
browsing depend on completed tags.

### Feature flags

Add runtime-configurable flags in `admin_config`, with exact names finalized
during implementation:

- enable deterministic tag processing;
- enable folder consensus;
- enable embedded metadata;
- enable document OCR;
- enable image measurements;
- enable duplicate inheritance;
- enable cross-reference inference;
- enable PopSG vision tagging;
- minimum accepted confidence;
- current rule version.

Configuration changes belong in the normal shared-backend/Coolify-owned paths;
do not hard-code production-only switches.

### Rollback

- Disable the relevant processor flag.
- Stop creating/updating automated relationships.
- Keep tag tables and manual tags intact.
- Hide tag filters if query behavior is faulty.
- Revert UI/worker code through GitHub.
- Do not drop tag data during an operational rollback.
- A later cleanup migration may remove abandoned data only after explicit
  approval and export.

## 19. Acceptance criteria

The feature is complete only when all are true:

1. Every active PopSG file has deterministic tagging state.
2. Every directory level is evaluated and evidence records its depth/raw value.
3. Tags are canonicalized and faceted.
4. Accepted tags appear in the file-details flyout.
5. Manual tags can be added and removed safely.
6. Automatic tags can be rejected without erasing their audit trail.
7. Manual tags survive every automatic rerun.
8. File moves/renames update path tags.
9. Unchanged files are not needlessly reprocessed.
10. Files can be searched and filtered by canonical tags.
11. Tag provenance is understandable to users.
12. Settings reports pending, failed, empty, and tagged states separately.
13. Backfills resume safely after interruption.
14. Query and processing performance gates pass.
15. Deterministic precision targets pass on the reviewed evaluation set.
16. No tag inheritance relies only on `quick_hash`.
17. No shared database migration exists in the PopDAM app repo.
18. Shared-db changes complete the required branch/PR/preview/merge workflow.
19. UI work is visually verified with screenshots.
20. Production deployment and live behavior are verified after rollout.

## 20. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Folder names contain operational noise | Suppression vocabulary, hidden workflow facet, review report |
| Same word means different things by licensor | Scoped aliases and authoritative path context |
| Deep ancestry creates irrelevant tags | Facets, reviewed aliases, confidence, explicit suppression |
| Folder consensus contaminates siblings | Minimum support, facet allowlist, no recursive support, quality audit |
| Manual work is overwritten | Separate provenance rows and manual-wins reducer |
| Tag variants fragment search | Canonical dictionary and alias table |
| Document text creates noisy tags | Controlled phrase matching only; no arbitrary keyword extraction |
| Metadata parser hangs or crashes | Time/memory bounds, per-file isolation, visible failures |
| `quick_hash` collision copies bad tags | Require full hash or verified similarity |
| Cross-reference context misstates artwork | Lower confidence, multiple references, suggestions first |
| Tag joins slow browsing | Preview query plans, indexes, optional database-maintained aggregate |
| Crawl becomes slow/unreliable | Asynchronous pending queue after crawl |
| Vision tags conflict with trusted evidence | Separate source, deterministic context, no overwrite |
| Huge backfill overloads shared Supabase | Keyset batches, rate limits, resumable stages, canary rollout |

## 21. Questions to resolve during Phase 0

These questions should be answered with production data samples and business
review, not guessed during coding:

1. Can all PopSG-entitled users edit manual tags, or admins only?
2. Should licensor/property appear as visible tag chips when already shown as
   location metadata?
3. Which folder words are operational versus creatively meaningful?
4. Which facets should propagate through folder consensus?
5. Should years be visible tags, filters, or structured metadata only?
6. Should file-reference/design codes be first-class searchable fields rather
   than tags?
7. Which existing PopDAM tags are clean enough to seed PopSG aliases?
8. Is guide-card tag aggregation needed in the first release, or only
   file-level tags and filtering?
9. Which Adobe formats can be parsed safely on the existing bridge versus the
   Windows agent?
10. What deterministic coverage threshold should trigger later vision tagging?

## 22. Definition of the first shippable release

The first production release should deliberately stop before document parsing
and vision AI. It consists of:

- normalized PopSG tag schema and provenance;
- reviewed canonical vocabulary and aliases;
- full-depth directory inference;
- filename inference;
- safe folder consensus;
- resumable incremental/backfill worker;
- file-flyout tags with manual editing and provenance;
- Files-view search/filter by tags;
- Settings coverage/failure diagnostics;
- evaluation set, tests, and production canary.

This release creates immediate value from existing metadata, establishes the
correct durable tag contract, and gives later metadata extraction and vision AI
one safe place to add evidence without rewriting the system.
