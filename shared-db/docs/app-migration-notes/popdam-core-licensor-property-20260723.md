# PopDAM canonical licensor/property cutover — 2026-07-23

PopDAM formerly kept separate `public.licensors` and `public.properties` tables.
Migration `20260723113000` moves live DAM foreign keys to the shared canonical
`core.licensor` and `core.property` identities.

## Contract

- `public.assets.{licensor_id,property_id}` and
  `public.style_groups.{licensor_id,property_id}` now reference `core.*`.
- `public.ai_tag_bakeoff_results.property_id` references `core.property`.
- Canonical matching prefers the record's ERP property code, then a unique
  normalized property name scoped to its canonical licensor. Missing/ambiguous
  properties become `NULL`; their durable `property_code`/`property_name` text
  is preserved. The migration never guesses an FK.
- `public.licensors` / `public.properties` remain deprecated only because
  PopDAM's 9,622-row character catalog still references legacy properties.
- `public.dam_character_catalog` is the explicit read-only compatibility view;
  it exposes legacy character IDs with `core_property_id`. Character migration
  is separate scope because `core.character` was empty and PopDAM had 117,012
  asset-character links.

## Preview verification

Applied to preview `rjyboqwcdzcocqgmsyel` on 2026-07-22 EDT. Verified:

- zero asset licensor IDs outside `core.licensor`;
- zero asset property IDs outside `core.property`;
- all five replacement FKs target the correct `core` table;
- 85,481 asset licensor links and 42,700 asset property links survived canonical resolution in preview;
- 5,726 style-group licensor links and 3,803 style-group property links survived in preview;
- `public.dam_character_catalog` is queryable (161 currently compatible character rows).

The preview backfill took 6m48s. Migrations `20260723112900` and
`20260723113100` bracket production application with a session-only 10-minute
statement timeout and restore the normal setting afterward.
