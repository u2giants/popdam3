# PopSG file tags foundation — 2026-07-23

## Purpose

PopSG needs searchable, provenance-aware tags for every active
`public.style_guide_files` row. The first pipeline infers tags from the entire
directory ancestry and filename without requiring vision AI. Later document,
image-measurement, duplicate, cross-reference, and vision stages use the same
canonical storage contract.

Canonical migration:

- `20260723170000_popsg_file_tags.sql`

Consumer implementation plan:

- `u2giants/popdam3/fix_add_tags.md`

## Additive schema

The migration adds:

- `public.style_guide_tags` — canonical tag dictionary and facet;
- `public.style_guide_tag_aliases` — controlled synonym lookup;
- `public.style_guide_file_tags` — per-file provenance, confidence, evidence,
  accepted/suggested/rejected status, inheritance, and rule version;
- `public.style_guide_tagging_state` — explicit pending/running/completed/failed
  state per file and pipeline;
- `style_guide_files.tag_names` — database-maintained accepted-tag cache;
- `style_guide_files.tag_search_text` — database-maintained search cache;
- `style_guide_file_tags_display` — deduplicated browser read view; and
- service/browser RPCs for deterministic batches, replacement, statistics, and
  manual add/remove/reject behavior.

All changes are additive. Existing PopSG reads do not depend on tagging
completion.

## Invariants

1. Application code never writes `style_guide_files.tag_names` or
   `tag_search_text`; the database rebuilds both from accepted relationships.
2. Automatic replacement affects only deterministic automatic sources and does
   not delete manual or rejected relationships.
3. `quick_hash` is not used as identity or as a tag-inheritance proof.
4. A completed state with zero accepted tags is distinct from an unevaluated or
   failed file.
5. A path, filename, size, extension, modified-time, or active-state change
   updates the deterministic input fingerprint and queues the file.
6. Browser reads and manual mutations require legacy PopSG
   `public.app_access(app = 'styleguides')`; worker operations require
   `service_role`.

## Preview evidence

Preview project:

- `rjyboqwcdzcocqgmsyel`
- Supabase branch: `shared-db-schema-rehearsal`

Verification performed on 2026-07-23:

1. `scripts/check-sql.sh` passed.
2. `supabase db push --dry-run` listed only
   `20260723170000_popsg_file_tags.sql`.
3. The migration applied transactionally to preview.
4. `get_style_guide_deterministic_tag_batch` returned a real pending PopSG file.
5. `replace_style_guide_deterministic_tags` accepted a temporary test tag.
6. `style_guide_file_tags_display` returned the accepted tag and evidence.
7. The source `style_guide_files.tag_names` cache contained the test tag.
8. The temporary tag/relationship was deleted and the test file's state was
   reset to pending.

The first preview attempt failed safely and rolled back because this project did
not expose `extensions.unaccent(text)`. The normalization function was corrected
to avoid relying on that unavailable signature, after which the full migration
and end-to-end verification passed.

## Rollback

Operational rollback does not require dropping schema:

1. stop/disable the PopSG deterministic worker operation;
2. hide tag filters or editing in the consumer UI if needed;
3. retain manual tags and provenance for later repair; and
4. revert consumer code through GitHub.

Dropping tag tables or cached columns is destructive and requires a separate,
explicitly approved migration.
