-- =====================================================================================
-- Paramount Creative Library -- forward fixes to 20260810020000.
--
-- Migration: 20260810090000_pmt_loader_target_guard_and_truncate_revoke.sql
-- Follows:   20260810020000_pmt_creative_library_landing.sql  (already applied to preview)
-- Issue:     #623. Object claim #625. Version allocated by the orchestrator.
--
-- THIS IS A FORWARD FIX, NOT AN EDIT. 20260810020000 is already applied, and the Supabase
-- ledger keys on the 14-digit VERSION alone, so editing that file would never re-run it --
-- it would only desynchronise the file from the ledger while changing nothing in any
-- database. Every correction is a new migration. Always.
--
-- Three changes, nothing else:
--   1. plm.load_pmt_capture_chunk validates the target BEFORE the empty-rows early return.
--   2. RAISE format specifiers corrected from %L to %.
--   3. TRUNCATE and TRIGGER revoked from service_role on the 23 plm.pmt_* tables.
--
-- SCHEMA ONLY. NO DATA. No licensor source row appears in this repository.
-- =====================================================================================

-- =====================================================================================
-- FIX 3 (first, because it is the security one).
--
-- THE INERT-GUARANTEE BUG. plm carries a schema-level default privilege:
--     alter default privileges ... grant all on tables to service_role
-- Read from the catalog on preview, it is `service_role=arwdDxtm/postgres` -- INSERT,
-- SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN, handed to
-- service_role AUTOMATICALLY at CREATE TABLE time, before any GRANT in the migration runs.
--
-- Two consequences, both invisible in the migration text:
--
--   (a) The `grant select, insert, update, delete ... to service_role` in 20260810020000
--       was a NO-OP. It granted a subset of what the role already held. Reading that line
--       and concluding service_role has exactly those four privileges is wrong, and that
--       is precisely how this stays hidden.
--
--   (b) MUCH WORSE: service_role silently held TRUNCATE on all 23 tables, and
--       **TRUNCATE DOES NOT FIRE ROW TRIGGERS**. Every immutability trigger from
--       20260810020000 is BEFORE UPDATE OR DELETE FOR EACH ROW; verified against pg_trigger,
--       none of them carries the TRUNCATE bit, and a row-level trigger cannot carry it at
--       all. So the "completed captures are immutable and retained permanently" guarantee
--       -- which the table comments state and the contract tests appear to prove -- could
--       be erased in one statement by the very role the importer runs as. Every UPDATE and
--       DELETE test passed while the guarantee was bypassable. A guarantee that tests green
--       and does not hold is worse than no guarantee, because it stops anyone looking.
--
-- Scope of this revoke is deliberately narrow: ONLY the 23 plm.pmt_* tables. It does not
-- touch plm.erp_*, plm.opa_*, any other schema, or the schema-level ALTER DEFAULT
-- PRIVILEGES itself -- that general fix is sequenced separately by the orchestrator, and
-- a broad change here would collide with it.
--
-- What service_role KEEPS and why:
--   INSERT  -- plm.load_pmt_capture_chunk writes rows.
--   SELECT  -- validation and the API views read them.
--   UPDATE  -- finalize/fail move the capture header; reconciliation edits pmt_property
--             and pmt_character. Both are trigger-guarded once a capture is complete.
--   DELETE  -- an ABANDONED or FAILED in-flight capture must remain cleanable. This is
--             trigger-guarded too: a COMPLETE capture's rows already refuse DELETE.
-- What it LOSES:
--   TRUNCATE -- the trigger bypass above. There is no legitimate use for it here; the
--               loader never truncates, and a refresh is a new capture_id, never a wipe.
--   TRIGGER  -- least privilege. Nothing in this design creates a trigger at runtime.
-- =====================================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'pmt_capture','pmt_capture_expectation','pmt_capture_batch','pmt_authorized_title',
    'pmt_authorized_title_property','pmt_property','pmt_franchise','pmt_character',
    'pmt_collection','pmt_brand','pmt_asset','pmt_asset_property','pmt_asset_franchise',
    'pmt_asset_character','pmt_asset_collection','pmt_asset_brand',
    'pmt_property_character','pmt_property_collection','pmt_property_franchise_evidence',
    'pmt_authorized_property_asset','pmt_relationship_anomaly','pmt_property_capture_log',
    'pmt_shrink_override'
  ]
  loop
    execute format('revoke truncate, trigger on plm.%I from service_role', t);
    -- Belt and braces: PUBLIC and anon should hold nothing at all on these tables.
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
  end loop;
end;
$$;

-- =====================================================================================
-- FIXES 1 and 2. plm.load_pmt_capture_chunk, replaced whole.
--
-- FIX 1 -- THE SILENT SUCCESS. The previous body returned 0 for an empty chunk BEFORE it
-- looked at p_target, so a misspelled target with an empty array returned 0 and looked
-- like a successful no-op load. A non-empty chunk with a bad target always raised, which
-- is why every test passed; the gap was exactly the empty case. Standing rule: no silent
-- failures. The target is now validated against the allow list FIRST, so a typo is refused
-- whether or not there are rows behind it.
--
-- FIX 2 -- %L IS NOT A RAISE SPECIFIER. It belongs to format(). In RAISE, `%` is the
-- placeholder and the `L` was emitted as a literal character, so the messages read
-- `role authenticatedL`. Corrected to `%` throughout.
-- =====================================================================================
create or replace function plm.load_pmt_capture_chunk(
  p_capture_id uuid,
  p_target     text,
  p_rows       jsonb
)
returns integer
language plpgsql
security definer
set search_path = plm, core, public, extensions
as $$
declare
  v_role   text := auth.role();
  v_status text;
  v_n      integer;
  v_count  integer;
  -- The allow list, named once. core.* and every table outside plm.pmt_* is unreachable
  -- from this function by construction, not by convention.
  c_targets constant text[] := array[
    'pmt_capture_batch','pmt_authorized_title','pmt_property','pmt_franchise',
    'pmt_character','pmt_collection','pmt_brand','pmt_asset',
    'pmt_authorized_title_property','pmt_asset_property','pmt_asset_franchise',
    'pmt_asset_character','pmt_asset_collection','pmt_asset_brand',
    'pmt_property_character','pmt_property_collection','pmt_property_franchise_evidence',
    'pmt_authorized_property_asset','pmt_property_capture_log','pmt_relationship_anomaly'
  ];
begin
  if not plm.pmt_loader_privilege_ok(v_role, session_user) then
    raise exception 'Paramount import refused: JWT role % / session_user % may not load capture '
      'chunks.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

  -- TARGET FIRST. This check used to sit after the empty-rows return, which made a
  -- misspelled target with an empty chunk indistinguishable from a successful no-op.
  if p_target is null or not (p_target = any (c_targets)) then
    raise exception 'Paramount import refused: % is not a loadable target. The target list is '
      'a fixed allow list; core.* and every table outside plm.pmt_* is unreachable from here '
      'by construction, not by convention. This is checked BEFORE the empty-chunk shortcut, '
      'so a typo cannot pass as a successful load of nothing.',
      coalesce(p_target, '<null>') using errcode = 'P0001';
  end if;

  select status into v_status from plm.pmt_capture where capture_id = p_capture_id;
  if v_status is null then
    raise exception 'Paramount import refused: capture % does not exist.', p_capture_id
      using errcode = 'P0001';
  end if;
  if v_status <> 'loading' then
    raise exception 'Paramount import refused: capture % is %, not loading. A capture that has '
      'left the loading state may not receive more rows.', p_capture_id, v_status
      using errcode = 'P0001';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Paramount import refused: rows must be a jsonb array, got %.',
      coalesce(jsonb_typeof(p_rows), 'null') using errcode = 'P0001';
  end if;

  v_n := jsonb_array_length(p_rows);
  if v_n = 0 then
    return 0;
  end if;
  if v_n > 5000 then
    raise exception 'Paramount import refused: chunk of % rows exceeds the 5000-row bound. '
      'Stream bounded chunks.', v_n using errcode = 'P0001';
  end if;

  if p_target = 'pmt_capture_batch' then
    insert into plm.pmt_capture_batch (
      capture_id, batch_number, expected_asset_count, returned_asset_count,
      first_asset_id, last_asset_id, http_status, content_was_json,
      requested_ids_sha256, returned_ids_sha256, id_sets_matched, complete,
      failure_message, captured_at, source_hash)
    select p_capture_id,
      (r->>'batch_number')::integer, (r->>'expected_asset_count')::integer,
      (r->>'returned_asset_count')::integer, r->>'first_asset_id', r->>'last_asset_id',
      (r->>'http_status')::integer, (r->>'content_was_json')::boolean,
      r->>'requested_ids_sha256', r->>'returned_ids_sha256',
      (r->>'id_sets_matched')::boolean, (r->>'complete')::boolean,
      r->>'failure_message', (r->>'captured_at')::timestamptz, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_title' then
    insert into plm.pmt_authorized_title (
      capture_id, authorized_title_key, authorized_title_name, capture_status,
      resolved_property_count, unique_asset_count, full_metadata_count, notes, source_hash)
    select p_capture_id, r->>'authorized_title_key', r->>'authorized_title_name',
      r->>'capture_status', (r->>'resolved_property_count')::integer,
      (r->>'unique_asset_count')::integer, (r->>'full_metadata_count')::integer,
      r->>'notes', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property' then
    insert into plm.pmt_property (
      capture_id, property_source_id, property_name, is_licensed_selection, raw, source_hash)
    select p_capture_id, (r->>'property_source_id')::bigint, r->>'property_name',
      coalesce((r->>'is_licensed_selection')::boolean, false),
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_franchise' then
    insert into plm.pmt_franchise (capture_id, franchise_source_id, franchise_name, raw, source_hash)
    select p_capture_id, (r->>'franchise_source_id')::bigint, r->>'franchise_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_character' then
    insert into plm.pmt_character (capture_id, character_source_id, character_name, raw, source_hash)
    select p_capture_id, (r->>'character_source_id')::bigint, r->>'character_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_collection' then
    insert into plm.pmt_collection (
      capture_id, collection_source_id, collection_name, paramount_term, raw, source_hash)
    select p_capture_id, (r->>'collection_source_id')::bigint, r->>'collection_name',
      coalesce(r->>'paramount_term', 'Collection'), coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_brand' then
    insert into plm.pmt_brand (capture_id, brand_source_id, brand_name, raw, source_hash)
    select p_capture_id, (r->>'brand_source_id')::bigint, r->>'brand_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset' then
    insert into plm.pmt_asset (
      capture_id, asset_id, asset_name, date_imported, date_last_updated,
      content_size_bytes, content_type, mime_type, asset_version, raw, source_hash)
    select p_capture_id, r->>'asset_id', r->>'asset_name',
      nullif(r->>'date_imported','')::timestamptz, nullif(r->>'date_last_updated','')::timestamptz,
      (r->>'content_size_bytes')::bigint, r->>'content_type', r->>'mime_type',
      (r->>'asset_version')::integer, coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_title_property' then
    insert into plm.pmt_authorized_title_property (
      capture_id, authorized_title_key, property_source_id, paramount_property_name,
      reported_asset_count, mapping_status, notes, source_hash)
    select p_capture_id, r->>'authorized_title_key', (r->>'property_source_id')::bigint,
      r->>'paramount_property_name', coalesce((r->>'reported_asset_count')::integer, 0),
      coalesce(r->>'mapping_status','mapped'), r->>'notes', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_property' then
    insert into plm.pmt_asset_property (capture_id, asset_id, property_source_id, source_hash)
    select p_capture_id, r->>'asset_id', (r->>'property_source_id')::bigint, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_franchise' then
    insert into plm.pmt_asset_franchise (capture_id, asset_id, franchise_source_id, source_hash)
    select p_capture_id, r->>'asset_id', (r->>'franchise_source_id')::bigint, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_character' then
    insert into plm.pmt_asset_character (capture_id, asset_id, character_source_id, source_hash)
    select p_capture_id, r->>'asset_id', (r->>'character_source_id')::bigint, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_collection' then
    insert into plm.pmt_asset_collection (capture_id, asset_id, collection_source_id, source_hash)
    select p_capture_id, r->>'asset_id', (r->>'collection_source_id')::bigint, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_brand' then
    insert into plm.pmt_asset_brand (capture_id, asset_id, brand_source_id, source_hash)
    select p_capture_id, r->>'asset_id', (r->>'brand_source_id')::bigint, md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_character' then
    insert into plm.pmt_property_character (
      capture_id, property_source_id, character_source_id, evidence_asset_count, source_hash)
    select p_capture_id, (r->>'property_source_id')::bigint, (r->>'character_source_id')::bigint,
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_collection' then
    insert into plm.pmt_property_collection (
      capture_id, property_source_id, collection_source_id, evidence_asset_count, source_hash)
    select p_capture_id, (r->>'property_source_id')::bigint, (r->>'collection_source_id')::bigint,
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_franchise_evidence' then
    -- evidence_kind and is_direct_source_relationship are NOT accepted from the caller.
    -- They are pinned by CHECK anyway; refusing them here means the loader cannot even try.
    insert into plm.pmt_property_franchise_evidence (
      capture_id, property_source_id, franchise_source_id, evidence_asset_count, source_hash)
    select p_capture_id, (r->>'property_source_id')::bigint, (r->>'franchise_source_id')::bigint,
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_property_asset' then
    insert into plm.pmt_authorized_property_asset (
      capture_id, licensed_property_source_id, asset_id, source_hash)
    select p_capture_id, (r->>'licensed_property_source_id')::bigint, r->>'asset_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_capture_log' then
    insert into plm.pmt_property_capture_log (
      capture_id, property_source_id, property_name, reported_asset_count,
      captured_asset_count, page_count, complete, failure_message, source_hash)
    select p_capture_id, (r->>'property_source_id')::bigint, r->>'property_name',
      (r->>'reported_asset_count')::integer, (r->>'captured_asset_count')::integer,
      (r->>'page_count')::integer, (r->>'complete')::boolean, r->>'failure_message', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_relationship_anomaly' then
    insert into plm.pmt_relationship_anomaly (
      capture_id, asset_id, relationship_field, raw_value, action, details, source_hash)
    select p_capture_id, r->>'asset_id', r->>'relationship_field', r->>'raw_value',
      r->>'action', r->>'details', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  else
    -- Unreachable: the allow-list check above already refused anything not in c_targets.
    -- Kept as a loud backstop so adding a name to c_targets without adding its INSERT
    -- branch fails immediately instead of silently loading nothing.
    raise exception 'Paramount import refused: target % passed the allow list but has no '
      'INSERT branch. A name was added to c_targets without its loader.', p_target
      using errcode = 'P0001';
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function plm.load_pmt_capture_chunk(uuid, text, jsonb) is
'The ONLY row-loading entry point for a Paramount capture. Validates the target against a '
'FIXED ALLOW LIST *before* the empty-chunk shortcut, so a misspelled target is refused even '
'with zero rows behind it -- the earlier body returned 0 there and looked like a successful '
'no-op load. Bounded to 5000 rows per call and refuses any capture not in status loading. '
'There is no dynamic table name, so no caller can reach core.* or any other schema through '
'it. Relationship rows are rejected by the capture-scoped composite foreign keys when an '
'endpoint is missing from the same capture, so an orphan link cannot be inserted at all.';

-- The privilege posture from 20260810020000 is re-stated, NOT widened. This is the grant
-- that was previously a no-op against the schema default privileges; it is kept so the
-- intended posture is readable in one place, and it is now meaningful because TRUNCATE and
-- TRIGGER were revoked above.
revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function plm.load_pmt_capture_chunk(uuid, text, jsonb) to service_role;
