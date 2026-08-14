-- Paramount: stop forcing the duplicated property-name copies onto two non-entity tables.
--
-- plm.pmt_authorized_title_property.paramount_property_name and
-- plm.pmt_property_capture_log.property_name each store a copy of
-- plm.pmt_property.property_name on rows that already foreign-key to that entity table on
-- (capture_id, property_source_id). Measured on production 2026-08-14 there are ZERO
-- mismatches against the entity table and zero orphan keys in both tables
-- (plan_pmt-duplicate-name-columns.md section 3). The copies agree today, which is exactly
-- the state in which to stop writing them -- before a future capture makes them disagree
-- and leaves nobody able to say which copy is right.
--
-- This is the STAGED portion of plan_pmt-duplicate-name-columns.md (issue #964): the
-- deprecation, both writer stops and the index drop in ONE file.
--   1. A drift-refusal guard, then DROP NOT NULL plus deprecation comments on both
--      columns. Same shape as the NBCU precedent 20260814050000.
--   2. plm.load_pmt_capture_chunk replaced with the live 20260811030000 body minus the two
--      duplicate-name INSERT writes. Everything else is preserved verbatim: the fixed
--      allow list, the privilege check, the capture-status guard, the 5000-row bound, the
--      loud unreachable-else backstop, SECURITY DEFINER with a pinned search_path, and the
--      revoke/grant posture.
--   3. DROP INDEX plm.idx_pmt_atp_name, the btree that invited lookups against the copy.
--      Nothing in this repository reads either copy (verified, plan section 5a), so there
--      is no reader to repoint. Plain DROP INDEX, never CONCURRENTLY, which a migration
--      file cannot carry.
--
-- THE COLUMNS ARE NOT DROPPED HERE. Plan Step 1 (duplicate attribute vs. genuinely
-- distinct fact) turns on evidence that lives outside this public repository -- the
-- private capture builder in u2giants/licensor-source-data and per-capture sampling on
-- production -- and was not available to the authoring session. Dropping or renaming
-- waits for that reading. Until then the columns stay, nullable and unwritten, and every
-- historical row keeps its value. If Step 1 later rules one of them a distinct fact, the
-- remedy is a rename plus restoring the writer, not a drop.
--
-- SEQUENCING. Apply this migration to an environment BEFORE running a Paramount capture
-- with the matching tools/sync-paramount-creative-library.mjs revision: that revision
-- stops sending the two name fields, so a pre-20260814193351 function body would read
-- them as NULL and violate the then-still-active NOT NULL. A database at this version is
-- consistent with both writers, old and new.
--
-- SIBLING PLANS (#965, #970) replace the same loader files from a different base. This
-- body was copied from the live 20260811030000 body with EXACTLY two removals; rebase by
-- re-applying those two removals to the then-live body, never by copying this file.
--
-- Schema only. This migration seeds no row and writes no source value.

-- =====================================================================================
-- SECTION 1. Drift-refusal guard. Relaxing NOT NULL over already-drifted or orphaned
-- copies would quietly bless the disagreement this migration exists to remove; the right
-- response to drift is reconcile-first. The zero-mismatch precondition was measured on
-- production 2026-08-14 -- this block turns that snapshot into an at-apply-time fact.
-- =====================================================================================
do $$
declare
  v_atp_mismatch bigint;
  v_log_mismatch bigint;
  v_orphans bigint;
begin
  select count(*) into v_atp_mismatch
  from plm.pmt_authorized_title_property a
  join plm.pmt_property p
    on p.capture_id = a.capture_id and p.property_source_id = a.property_source_id
  where a.paramount_property_name is distinct from p.property_name;

  select count(*) into v_log_mismatch
  from plm.pmt_property_capture_log l
  join plm.pmt_property p
    on p.capture_id = l.capture_id and p.property_source_id = l.property_source_id
  where l.property_name is distinct from p.property_name;

  select count(*) into v_orphans
  from (
    select capture_id, property_source_id from plm.pmt_authorized_title_property
    union all
    select capture_id, property_source_id from plm.pmt_property_capture_log
  ) t
  where not exists (
          select 1 from plm.pmt_property p
          where p.capture_id = t.capture_id and p.property_source_id = t.property_source_id);

  if v_atp_mismatch > 0 or v_log_mismatch > 0 then
    raise exception
      'pmt duplicate name columns: % rights-list and % capture-log names already disagree '
      'with plm.pmt_property.property_name; reconcile before deprecating',
      v_atp_mismatch, v_log_mismatch;
  end if;

  if v_orphans > 0 then
    raise exception
      'pmt duplicate name columns: % rows have no plm.pmt_property row to join to; the '
      'entity table cannot yet replace the copies',
      v_orphans;
  end if;

  raise notice 'pmt duplicate name columns: verified consistent, proceeding';
end $$;

-- =====================================================================================
-- SECTION 2. Deprecate both columns. The btrim CHECKs stay: they still hold for any
-- non-null value, and they drop automatically with the column in the later Step 6 file.
-- =====================================================================================
alter table plm.pmt_authorized_title_property alter column paramount_property_name drop not null;
alter table plm.pmt_property_capture_log alter column property_name drop not null;

comment on column plm.pmt_authorized_title_property.paramount_property_name is
  'DEPRECATED 2026-08-14 (20260814193351) -- duplicate of plm.pmt_property.property_name. '
  'Do not read it and do not write it: join through '
  'pmt_authorized_title_property_property_fkey on (capture_id, property_source_id) instead. '
  'Nullable and unwritten since 20260814193351 -- the client loader and '
  'plm.load_pmt_capture_chunk stopped populating it in the same change. Dropped by a later '
  'migration once plan_pmt-duplicate-name-columns.md Step 1 settles duplicate-vs-distinct '
  'against the private capture builder.';

comment on column plm.pmt_property_capture_log.property_name is
  'DEPRECATED 2026-08-14 (20260814193351) -- duplicate of plm.pmt_property.property_name. '
  'Do not read it and do not write it: join through pmt_pcl_property_fkey on (capture_id, '
  'property_source_id) instead. Nullable and unwritten since 20260814193351 -- the client '
  'loader and plm.load_pmt_capture_chunk stopped populating it in the same change. Dropped '
  'or renamed by a later migration once plan_pmt-duplicate-name-columns.md Step 1 settles '
  'whether this column is the property name or the search string the portal displayed.';

-- =====================================================================================
-- SECTION 3. plm.load_pmt_capture_chunk -- replaced whole, from the live 20260811030000
-- body. Changes against that body, and NOTHING else:
--   1. The pmt_authorized_title_property INSERT branch no longer names or selects
--      paramount_property_name.
--   2. The pmt_property_capture_log INSERT branch no longer names or selects
--      property_name. The pmt_property entity branch KEEPS its property_name write: that
--      is the single place the name is stored from now on.
-- Rows that still carry either key in the JSON are accepted unchanged; the keys are
-- simply no longer read.
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
  c_targets constant text[] := array[
    'pmt_capture_batch','pmt_authorized_title','pmt_property','pmt_franchise',
    'pmt_character','pmt_collection','pmt_brand','pmt_asset',
    'pmt_authorized_title_property','pmt_asset_property','pmt_asset_franchise',
    'pmt_asset_character','pmt_asset_collection','pmt_asset_brand',
    'pmt_property_character','pmt_property_collection','pmt_property_franchise_evidence',
    'pmt_authorized_property_asset','pmt_property_capture_log','pmt_relationship_anomaly',
    'pmt_asset_metadata_value'
  ];
begin
  if not plm.pmt_loader_privilege_ok(v_role, session_user) then
    raise exception 'Paramount import refused: JWT role % / session_user % may not load capture '
      'chunks.', coalesce(v_role, '<null>'), coalesce(session_user, '<null>')
      using errcode = 'P0001';
  end if;

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
    select p_capture_id, r->>'property_source_id', r->>'property_name',
      coalesce((r->>'is_licensed_selection')::boolean, false),
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_franchise' then
    insert into plm.pmt_franchise (capture_id, franchise_source_id, franchise_name, raw, source_hash)
    select p_capture_id, r->>'franchise_source_id', r->>'franchise_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_character' then
    insert into plm.pmt_character (capture_id, character_source_id, character_name, raw, source_hash)
    select p_capture_id, r->>'character_source_id', r->>'character_name',
      coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_collection' then
    insert into plm.pmt_collection (
      capture_id, collection_source_id, collection_name, paramount_term, raw, source_hash)
    select p_capture_id, r->>'collection_source_id', r->>'collection_name',
      coalesce(r->>'paramount_term', 'Collection'), coalesce(r->'raw', '{}'::jsonb), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_brand' then
    insert into plm.pmt_brand (capture_id, brand_source_id, brand_name, raw, source_hash)
    select p_capture_id, r->>'brand_source_id', r->>'brand_name',
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
      capture_id, authorized_title_key, property_source_id,
      reported_asset_count, mapping_status, notes, source_hash)
    select p_capture_id, r->>'authorized_title_key', r->>'property_source_id',
      coalesce((r->>'reported_asset_count')::integer, 0),
      coalesce(r->>'mapping_status','mapped'), r->>'notes', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_property' then
    insert into plm.pmt_asset_property (capture_id, asset_id, property_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'property_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_franchise' then
    insert into plm.pmt_asset_franchise (capture_id, asset_id, franchise_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'franchise_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_character' then
    insert into plm.pmt_asset_character (capture_id, asset_id, character_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'character_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_collection' then
    insert into plm.pmt_asset_collection (capture_id, asset_id, collection_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'collection_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_brand' then
    insert into plm.pmt_asset_brand (capture_id, asset_id, brand_source_id, source_hash)
    select p_capture_id, r->>'asset_id', r->>'brand_source_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_character' then
    insert into plm.pmt_property_character (
      capture_id, property_source_id, character_source_id, evidence_asset_count, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'character_source_id',
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_collection' then
    insert into plm.pmt_property_collection (
      capture_id, property_source_id, collection_source_id, evidence_asset_count, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'collection_source_id',
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_franchise_evidence' then
    -- evidence_kind and is_direct_source_relationship are STILL NOT accepted from the
    -- caller. They stay pinned by CHECK on the base table. Co-occurrence never becomes a
    -- direct relationship through this loader.
    insert into plm.pmt_property_franchise_evidence (
      capture_id, property_source_id, franchise_source_id, evidence_asset_count, source_hash)
    select p_capture_id, r->>'property_source_id', r->>'franchise_source_id',
      coalesce((r->>'evidence_asset_count')::integer, 0), md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_authorized_property_asset' then
    insert into plm.pmt_authorized_property_asset (
      capture_id, licensed_property_source_id, asset_id, source_hash)
    select p_capture_id, r->>'licensed_property_source_id', r->>'asset_id', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_property_capture_log' then
    insert into plm.pmt_property_capture_log (
      capture_id, property_source_id, reported_asset_count,
      captured_asset_count, page_count, complete, failure_message, source_hash)
    select p_capture_id, r->>'property_source_id',
      (r->>'reported_asset_count')::integer, (r->>'captured_asset_count')::integer,
      (r->>'page_count')::integer, (r->>'complete')::boolean, r->>'failure_message', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_relationship_anomaly' then
    insert into plm.pmt_relationship_anomaly (
      capture_id, asset_id, relationship_field, raw_value, action, details, source_hash)
    select p_capture_id, r->>'asset_id', r->>'relationship_field', r->>'raw_value',
      r->>'action', r->>'details', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  elsif p_target = 'pmt_asset_metadata_value' then
    -- NOTE `r->'raw_value'` (arrow, keeps jsonb) not `r->>'raw_value'` (double arrow,
    -- stringifies). The double arrow here would store the TEXT "{...}" inside a jsonb
    -- column as a JSON string and quietly defeat the shape CHECK.
    -- value_ordinal is taken from the payload, never from row order: jsonb_array_elements
    -- ordering is an implementation detail and must not become the source's meaning.
    insert into plm.pmt_asset_metadata_value (
      capture_id, asset_id, metadata_element_id, metadata_element_name,
      metadata_category_id, metadata_category_name, domain_id,
      source_table_name, source_column_name, data_type,
      value_ordinal, source_value, display_value, language, source_path,
      raw_value, source_hash)
    select p_capture_id,
      r->>'asset_id', r->>'metadata_element_id', r->>'metadata_element_name',
      r->>'metadata_category_id', r->>'metadata_category_name', r->>'domain_id',
      r->>'source_table_name', r->>'source_column_name', r->>'data_type',
      (r->>'value_ordinal')::integer, r->>'source_value', r->>'display_value',
      r->>'language', r->>'source_path',
      r->'raw_value', md5(r::text)
    from jsonb_array_elements(p_rows) r;

  else
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
'with zero rows behind it. Bounded to 5000 rows per call and refuses any capture not in '
'status loading. There is no dynamic table name, so no caller can reach core.* or any other '
'schema through it. Relationship rows are rejected by the capture-scoped composite foreign '
'keys when an endpoint is missing from the same capture. As of 20260811030000 it inserts '
'Paramount source IDs as EXACT TEXT -- every ::bigint cast is gone, because casting an '
'identifier to a number is how a leading zero or a >2^53 value gets destroyed without an '
'error -- and it loads plm.pmt_asset_metadata_value, the lossless repeated-metadata store. '
'As of 20260814193351 it no longer writes the duplicated property-name copies on '
'plm.pmt_authorized_title_property and plm.pmt_property_capture_log: the property name is '
'written once, to plm.pmt_property, and both tables reach it by their capture-scoped '
'foreign keys. Rows still carrying those keys in the JSON are accepted; the keys are not '
'read.';

revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb) from public;
revoke all on function plm.load_pmt_capture_chunk(uuid, text, jsonb) from anon, authenticated;
grant execute on function plm.load_pmt_capture_chunk(uuid, text, jsonb) to service_role;

-- =====================================================================================
-- SECTION 4. Drop the index that invited lookups against the copy. Readers: none in this
-- repository (plan section 5a); the serving views built in 20260811030000 all read
-- p.property_name from plm.pmt_property itself. Plain DROP INDEX -- CONCURRENTLY cannot
-- run inside a migration file (AGENTS.md 5.1-A).
-- =====================================================================================
drop index plm.idx_pmt_atp_name;
