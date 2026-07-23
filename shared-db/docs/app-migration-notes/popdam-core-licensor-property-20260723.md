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

## Production attempt and outage — 2026-07-23

Production migration `20260723113000` was attempted at approximately 14:45 UTC
and **did not apply**. Its asset-update transaction ran for 10 minutes, reached
the safety timeout, and rolled back. The production migration ledger contains
`20260723112900` but not `20260723113000` or `20260723113100`; the canonical
licensor/property cutover therefore remains pending in production.

While the transaction was running, its DDL and asset rewrite prevented
PostgREST from rebuilding its schema cache. PopSG and the other browser clients
received HTTP 503 responses with:

```text
PGRST002: Could not query the database for the schema cache. Retrying.
```

PopSG displayed “Style guides could not load.” The failure was not specific to
the style-guide views: `user_roles`, `admin_config`, `style_guide_folders`, and
`style_guide_file_groups` all returned 503. Supabase Auth continued to work.

After the timeout, read-only inspection confirmed that the long-running query
was gone, the migration had rolled back, and every PostgREST-exposed schema
(`public`, `graphql_public`, `api`, `crm`, `pim`, `core`, and `app`) still
existed. PostgREST remained stuck until it received its documented in-place
reload signals:

```sql
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
```

Those signals changed no data or schema. Browser verification then returned
HTTP 200 for `style_guide_folders`, HTTP 206 for the paginated
`style_guide_file_groups` request, and rendered live style-guide cards.

### Do not retry the production migration unchanged

The preview runtime of 6m48s did not predict the production runtime or the
availability impact of holding the DDL transaction open. Before another
production attempt:

1. Redesign the asset rewrite so it does not hold one transaction and
   PostgREST-affecting locks across the full backfill. The success gate is a
   preview rehearsal that keeps representative Data API reads available while
   the rewrite runs.
2. Re-run `supabase db push --dry-run` and confirm the intended pending sequence
   starts at `20260723113000`; do not mark the timed-out migration as applied.
3. Use an approved production window with live REST probes for a simple public
   table and the PopSG folder/group views.
4. If any probe returns `PGRST002`, stop the attempt, confirm rollback/query
   state, then reload PostgREST only after the database transaction is gone.
5. Verify the five replacement foreign keys and the canonical row counts before
   deploying dependent PopDAM code.
