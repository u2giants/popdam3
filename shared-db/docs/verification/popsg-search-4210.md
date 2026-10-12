# PopSG matching search repair evidence — issue 4210

Owner: Codex chat 01a12c68-44b8-7bb3-b1d4-98cb375b6859 on hetz.

## Executed synthetic behavior checks

Disposable PostgreSQL 15, invented fixture rows only, completed October 11,
2026 before 6:30 PM EDT. Existing nine search contracts passed. The canonical
baseline function was installed under a fixture-only name; the replacement
was applied under the actual serving name. All 224 complete JSON equality
comparisons passed: Files and Guides; null, matching, unmatched, negated,
quoted, null-identity and tag queries; four sorts; limits 1/200; offsets 0/1.
The equality covered entire results, totals, facets, order, rank, live preview
selection and null/empty guide identity. Existing contracts separately test
role denial, service access and an authorized authenticated user.

Terminal evidence retained locally:

```
NOTICE: issue #2506 PopSG v2 search contracts: all 9 checks passed
NOTICE: Full old/new JSON equality: 224 synthetic cases passed
```

## Bounded read-only query-body checks

Production-sized corpus: 220,218 active documents, 94,497 matching a common
six-character term. Every diagnostic transaction was READ ONLY; statement
ceiling stayed eight seconds and work_mem stayed 64MB. Files single-row
materialization: 4,113 ms. Guides constant SQL planned for bound call values
and separate page metadata/tag aggregation: 4,621 ms. No production function,
row, index, cron or setting was changed for these tests. These measurements
are diagnosis, not signed-in acceptance. The first two-hint prototype still
timed out in Guides; it is superseded by the final branch.

Runtime EXECUTE interpolates no user text. Fifteen USING values bind the
normalized mode and the original arguments in signature order. Planning cost
was 17 ms for the final Guides probe. Function settings remain precisely
search_path and work_mem; no plan-cache or timeout setting is added.

## Actual index usage and whole-set reads

The final common-query Guides plan reported these actual index nodes:

- Index Only Scan: `idx_sgf_live_missing_clean_ids`, rows 0, loops 1.
- Index Only Scan: `idx_sgf_live_missing_error_ids`, rows 2220, loops 1.
- Index Only Scan: `idx_sgf_live_preview_ids`, rows 108999, loops 2.
- Index Scan: `style_guide_files_pkey`, rows 1, loops 31665.

The bounded render-rollup reads the queue once. Broad common queries can
legitimately use sequential or parallel scans: nearly half the corpus matches,
and exact totals/facets require the whole matched set. No claim is made that
every optional predicate uses an index. The repair adds no index and does not
hide these reads. The query plan, not index existence alone, is the evidence.

Schema-only index inventory captured read-only:

- `style_guide_files_pkey`: `CREATE UNIQUE INDEX style_guide_files_pkey ON public.style_guide_files USING btree (id)`.
- `style_guide_files_root_path_unique`: `CREATE UNIQUE INDEX style_guide_files_root_path_unique ON public.style_guide_files USING btree (root_label, relative_path)`.
- `idx_sgf_root_label`: `CREATE INDEX idx_sgf_root_label ON public.style_guide_files USING btree (root_label)`.
- `idx_sgf_directory_path`: `CREATE INDEX idx_sgf_directory_path ON public.style_guide_files USING btree (directory_path)`.
- `idx_sgf_normalized_name`: `CREATE INDEX idx_sgf_normalized_name ON public.style_guide_files USING btree (normalized_name)`.
- `idx_sgf_is_active`: `CREATE INDEX idx_sgf_is_active ON public.style_guide_files USING btree (is_active)`.
- `idx_sgf_crawl_run_id`: `CREATE INDEX idx_sgf_crawl_run_id ON public.style_guide_files USING btree (crawl_run_id)`.
- `idx_sgf_style_guide_folder`: `CREATE INDEX idx_sgf_style_guide_folder ON public.style_guide_files USING btree (style_guide_folder)`.
- `idx_sgf_property_folder`: `CREATE INDEX idx_sgf_property_folder ON public.style_guide_files USING btree (property_folder)`.
- `idx_sgf_licensor_name`: `CREATE INDEX idx_sgf_licensor_name ON public.style_guide_files USING btree (licensor_name)`.
- `idx_sgf_render_errored`: `CREATE INDEX idx_sgf_render_errored ON public.style_guide_files USING btree (id) WHERE (is_active AND (thumbnail_url IS NULL) AND (thumbnail_error IS NOT NULL))`.
- `idx_style_guide_files_filename_trgm`: `CREATE INDEX idx_style_guide_files_filename_trgm ON public.style_guide_files USING gin (lower(filename) gin_trgm_ops)`.
- `idx_style_guide_files_active_modified`: `CREATE INDEX idx_style_guide_files_active_modified ON public.style_guide_files USING btree (modified_at DESC NULLS LAST, filename) WHERE is_active`.
- `idx_sgf_reconcile_root_active_run_id`: `CREATE INDEX idx_sgf_reconcile_root_active_run_id ON public.style_guide_files USING btree (root_label, crawl_run_id, id) WHERE is_active`.
- `idx_style_guide_files_tag_names`: `CREATE INDEX idx_style_guide_files_tag_names ON public.style_guide_files USING gin (tag_names)`.
- `idx_style_guide_files_tag_search_trgm`: `CREATE INDEX idx_style_guide_files_tag_search_trgm ON public.style_guide_files USING gin (tag_search_text gin_trgm_ops)`.
- `idx_sgf_directory_path_trgm`: `CREATE INDEX idx_sgf_directory_path_trgm ON public.style_guide_files USING gin (directory_path gin_trgm_ops)`.
- `idx_sgf_relative_path_trgm`: `CREATE INDEX idx_sgf_relative_path_trgm ON public.style_guide_files USING gin (relative_path gin_trgm_ops)`.
- `idx_sgf_live_preview_ids`: `CREATE INDEX idx_sgf_live_preview_ids ON public.style_guide_files USING btree (id) WHERE (is_active AND (thumbnail_url IS NOT NULL))`.
- `idx_sgf_live_missing_clean_ids`: `CREATE INDEX idx_sgf_live_missing_clean_ids ON public.style_guide_files USING btree (id) WHERE (is_active AND (thumbnail_url IS NULL) AND (thumbnail_error IS NULL))`.
- `idx_sgf_live_missing_error_ids`: `CREATE INDEX idx_sgf_live_missing_error_ids ON public.style_guide_files USING btree (id) WHERE (is_active AND (thumbnail_url IS NULL) AND (thumbnail_error IS NOT NULL))`.
- `idx_sgf_active_preview_category`: `CREATE INDEX idx_sgf_active_preview_category ON public.style_guide_files USING btree ((
CASE
    WHEN (thumbnail_url IS NOT NULL) THEN 'has_preview'::text
    WHEN (lower(file_extension) <> ALL (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text])) THEN 'unsupported'::text
    WHEN ((thumbnail_error IS NULL) AND (lower(file_extension) = ANY (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text]))) THEN 'renderable_no_preview'::text
    WHEN ((thumbnail_error IS NOT NULL) AND (lower(file_extension) = ANY (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text])) AND ((lower(thumbnail_error) = ANY (ARRAY['no_pdf_compat'::text, 'no_preview_or_render_failed'::text, 'blank_render'::text])) OR (lower(thumbnail_error) ~~ '%enoent%'::text) OR (lower(thumbnail_error) ~~ '%not found%'::text) OR (lower(thumbnail_error) ~~ '%missing%'::text) OR (lower(thumbnail_error) ~~ '%unsupported%'::text) OR (lower(thumbnail_error) ~~ '%corrupt%'::text))) THEN 'renderable_terminal'::text
    WHEN ((thumbnail_error IS NOT NULL) AND (lower(file_extension) = ANY (ARRAY['pdf'::text, 'ai'::text, 'psd'::text, 'eps'::text, 'jpg'::text, 'jpeg'::text, 'png'::text, 'tif'::text, 'tiff'::text]))) THEN 'renderable_recoverable'::text
    WHEN ((thumbnail_error IS NOT NULL) AND ((lower(thumbnail_error) = ANY (ARRAY['no_pdf_compat'::text, 'no_preview_or_render_failed'::text, 'blank_render'::text])) OR (lower(thumbnail_error) ~~ '%enoent%'::text) OR (lower(thumbnail_error) ~~ '%not found%'::text) OR (lower(thumbnail_error) ~~ '%missing%'::text) OR (lower(thumbnail_error) ~~ '%unsupported%'::text) OR (lower(thumbnail_error) ~~ '%corrupt%'::text))) THEN 'other_terminal'::text
    WHEN (thumbnail_error IS NOT NULL) THEN 'other_recoverable'::text
    ELSE 'other_unexplained'::text
END)) WHERE is_active`.
- `style_guide_render_queue_pkey`: `CREATE UNIQUE INDEX style_guide_render_queue_pkey ON public.style_guide_render_queue USING btree (id)`.
- `idx_sgrq_status`: `CREATE INDEX idx_sgrq_status ON public.style_guide_render_queue USING btree (status)`.
- `idx_sgrq_file_id`: `CREATE INDEX idx_sgrq_file_id ON public.style_guide_render_queue USING btree (style_guide_file_id)`.
- `idx_sgrq_created_at`: `CREATE INDEX idx_sgrq_created_at ON public.style_guide_render_queue USING btree (created_at DESC)`.
- `idx_sgrq_status_created_at`: `CREATE INDEX idx_sgrq_status_created_at ON public.style_guide_render_queue USING btree (status, created_at DESC)`.
- `idx_sgrq_file_status`: `CREATE INDEX idx_sgrq_file_status ON public.style_guide_render_queue USING btree (style_guide_file_id, status)`.
- `style_guide_search_documents_pkey`: `CREATE UNIQUE INDEX style_guide_search_documents_pkey ON public.style_guide_search_documents USING btree (style_guide_file_id)`.
- `idx_sg_search_documents_search_vector`: `CREATE INDEX idx_sg_search_documents_search_vector ON public.style_guide_search_documents USING gin (search_vector) WHERE is_active`.
- `idx_sg_search_documents_filters`: `CREATE INDEX idx_sg_search_documents_filters ON public.style_guide_search_documents USING btree (licensor_name, property_folder, file_extension, modified_at DESC) WHERE is_active`.
- `idx_sg_search_documents_stable_page`: `CREATE INDEX idx_sg_search_documents_stable_page ON public.style_guide_search_documents USING btree (modified_at DESC NULLS LAST, style_guide_file_id) WHERE is_active`.

## Review response

The first DeepSeek run returned BLOCKED, with no confirmed correctness defect,
because index use/equivalence evidence was not attached and owner/dependency
checks were incomplete. That finding is retained, not replaced by an approval.
This artifact supplies executed aggregate evidence and real plan/index facts;
the baseline, contract and live proof now assert PostgreSQL ownership and
exact dependency kinds/key column types as well as body/settings/grants.

The dynamic marker sidecar is hash-bound. Its runtime constant SELECT creates
no extra durable object when this migration applies; ordinary catalog
verification still covers the static CREATE OR REPLACE FUNCTION. CI’s missing
sidecar refusal is addressed explicitly, without weakening its checker.

Production acceptance remains unchecked until the guarded merge, merged-main
rehearsal, automatic promotion and request-correlated live checks succeed.

## DeepSeek REVISE response (slot 2, sequence 6311)

Findings retained as issued at
https://github.com/popcre/shared-db/pull/4213#issuecomment-6115408507.
This section records the corrective evidence without erasing the judgment.

### 1. Exact default-matview column identities (finding 1)

`supabase/tests/popsg_parse_search_query_once_contracts.sql` now asserts exact
`atttypid` types for the snapshot columns the RPC reads:

- `style_guide_library_default_summary.result_mode` text
- `style_guide_library_default_summary.total` bigint
- `style_guide_library_default_summary.facets` jsonb
- `style_guide_library_default_guides.result` jsonb
- `style_guide_library_default_guides.modified_at` timestamptz
- `style_guide_library_default_guides.sort_name` text
- `style_guide_library_default_guides.entity_key` text

A renamed or retyped column now fails the same fail-closed contract that
already pins relation kind and the serving function identity.

### 2. Source-file tag GIN does not serve search-document tag predicates (finding 2)

`idx_style_guide_files_tag_names` is on `public.style_guide_files`. The Guides
and Files tag filters evaluate `d.tag_names && …` against
`public.style_guide_search_documents`, a different relation. That inventory
entry cannot serve the filter as written. The predicate is pre-existing and
unchanged; this repair adds no index and does not claim one serves it. Broad
common queries may scan; exact totals and facets require the whole matched
set. Plan evidence remains the authority, not index names.

### 3. Extension-array order is not a documented guarantee (finding 3)

`file_extensions` is `array_agg(distinct d.extension)` with no `ORDER BY` in
both the snapshot matview and this repair. The new guide contract compared the
JSON array by exact order, elevating an unspecified aggregation order to a
hard contract. That assertion is corrected to a set comparison (sorted distinct
values plus length). Output shape is unchanged; no `ORDER BY` was added to the
function body, so the API contract is preserved exactly as shipped.

### 4. Null-versus-empty guide_key sort ties (finding 4)

`group_id` keeps NULL and '' distinct (length-prefixed parts). `entity_key`
and the emitted `guide_key` use `coalesce(...,'')`, so two groups differing
only in NULL vs '' share the final sort tie-break. Their relative page order
is unspecified. This is pre-existing in the 20260917024050 body and is not
changed here. The guide metadata contract now records that limitation with an
explicit notice; semantics are preserved.

### 5. Executable equivalence and test evidence (finding 5)

Reproducible local sequence on a disposable PostgreSQL 15 fixture (invented
rows only, never licensed data):

1. Install the baseline function body from migration `20260917024050` under a
   fixture-only name.
2. Apply this migration's body under the real serving name.
3. Run `supabase/tests/popsg_search_style_guide_library_v2_contracts.sql`
   (nine behavior contracts).
4. Run `supabase/tests/popsg_parse_search_query_once_contracts.sql` and
   `supabase/tests/popsg_guide_page_metadata_contracts.sql`.
5. Compare complete JSON (results, totals, facets, order, rank, live preview,
   null/empty identity) across 224 synthetic cases in both modes.

Terminal fixture output retained from the October 11 run:

```
NOTICE: issue #2506 PopSG v2 search contracts: all 9 checks passed
NOTICE: Full old/new JSON equality: 224 synthetic cases passed
```

Production-sized prepared-body timings (Files 4.113 s, Guides 4.621 s) remain
READ ONLY diagnosis under the unchanged eight-second ceiling. They are not
deployed acceptance. The sidecar checker runs in CI against the real origin;
the sandbox `RepositoryIdentityError` is a missing-origin limitation of that
copy, not a failing sidecar.

### 6. Rollback / recovery path (finding 6)

The migration is a single `CREATE OR REPLACE FUNCTION` plus a fail-closed
baseline `md5(prosrc)` guard. If the guard fails, the statement aborts and the
prior body remains in place. If a later statement failed after a successful
replace, recovery is re-applying the exact previous body from migration
`20260917024050_popsg_search_v2_default_browse_snapshot.sql` (baseline
prosrc MD5 `3547b0f7d28d044ff6d6e031dcbeebbb`). No destructive DROP is used.
Drill: on a disposable fixture, replace with the new body, then replace again
with the 20260917024050 body and assert the baseline hash returns.

### Preservation

No index was added, no timeout/role/cron/model setting changed, no caller text
interpolated, and the output contract is unchanged. The original BLOCKED and
REVISE verdicts stay on the durable refs; this evidence answers the six
requested items and does not rewrite history.

## DeepSeek REVISE response round 2 (slot 2 at 02c597a0)

Additional sibling index-serviceability cases are disclosed here. None are
introduced by this repair; no index is added and output semantics are unchanged.

1. **Extension predicate wrap.** `lower(coalesce(d.file_extension, '')) = any (…)`
   cannot use `idx_sg_search_documents_filters`, which indexes raw
   `file_extension`. The wrap defeats the column. Pre-existing, unchanged.
2. **Style-guide name filter.** `d.style_guide_name = any (…)` has no dedicated
   index on `style_guide_search_documents`. Pre-existing, unchanged.
3. **Tag predicate** (already disclosed): source-file GIN does not serve
   search-document `tag_names &&` filters.

Live proof `.github/live-proofs/4210.sql` now asserts the same default-matview
column identities/types as the contract test, so live proof and contract cover
the same object set.

Broader residual columns the routine reads (search document path/filename/
extension/size/pdf fields, `thumbnail_error`, queue `status`) remain at their
pre-existing types and are unchanged by this migration. They are not newly
pinned here to keep the contract focused on the objects this repair actually
depends on for the default snapshot path. A rename still fails at runtime, not
silently.

Test executability remains fixture-local (invented rows only). Body hashes,
parameter mapping, volatility, grants and authorization are unchanged from the
prior REVISE response.
