-- =====================================================================================
-- Paramount metadata-element contracts -- issue #965,
-- plan_pmt-metadata-element-normalization.md.
--
-- THIS FILE ASSERTS THE INTERIM (PRE-DROP) STATE that ships with the staged
-- A+B+C+D migration: the element table exists, value rows still have the six
-- heading columns (nullable, deprecated, unwritten), data_type stays on the
-- value table, the FK is in place, and there is no api view.
--
-- HOW TO RUN
--   Against PREVIEW rjyboqwcdzcocqgmsyel (or the CI ephemeral database) as the
--   migration owner:
--       \i supabase/tests/pmt_metadata_element_contracts.sql
--
--   RUN EACH `do $$` BLOCK AS A SEPARATE STATEMENT. Submitting the whole file
--   as one multi-statement batch through the transaction pooler (port 6543)
--   wraps every block in one implicit transaction and stalls.
--
--   NOTE for preview: the new-id path opens a synthetic capture via
--   plm.begin_pmt_capture, which REFUSES to run while any real capture is
--   loading or validating.
--
-- EVERY VALUE IN THIS FILE IS INVENTED.
--   u2giants/shared-db is PUBLIC. Fixtures use ZZTEST-* tokens and
--   example.invalid. Asset IDs are 40-hex repeats, never a real asset.
--
-- LAST RUN: (fill in after the preview rehearsal)
-- =====================================================================================


-- =====================================================================================
-- A. CATALOG. Element table shape, value-table data_type, no api view, freeze
--    triggers, privilege posture.
-- =====================================================================================
do $$
declare
  v_n integer;
  v_text text;
  p text;
  r record;
begin
  raise notice '=== A. CATALOG ===';

  if to_regclass('plm.pmt_metadata_element') is null then
    raise exception 'A FAILED: plm.pmt_metadata_element does not exist';
  end if;

  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'plm' and table_name = 'pmt_metadata_element'
    and column_name = 'data_type';
  if v_n <> 0 then
    raise exception 'A FAILED: element table must not have a data_type column';
  end if;

  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'plm' and table_name = 'pmt_asset_metadata_value'
    and column_name = 'data_type';
  if v_n <> 1 then
    raise exception 'A FAILED: data_type must remain on the value table';
  end if;

  select count(*) into v_n from pg_constraint
  where conrelid = 'plm.pmt_asset_metadata_value'::regclass
    and conname = 'pmt_amv_data_type_chk';
  if v_n <> 1 then
    raise exception 'A FAILED: pmt_amv_data_type_chk missing from the value table';
  end if;

  select count(*) into v_n from pg_constraint
  where conrelid = 'plm.pmt_asset_metadata_value'::regclass
    and conname = 'pmt_amv_element_fkey';
  if v_n <> 1 then
    raise exception 'A FAILED: pmt_amv_element_fkey missing';
  end if;

  if to_regclass('api.pmt_asset_metadata_value_expanded') is not null then
    raise exception 'A FAILED: api.pmt_asset_metadata_value_expanded must not exist';
  end if;

  select count(*) into v_n from pg_views
  where schemaname = 'api'
    and definition ilike '%pmt_asset_metadata_value%';
  if v_n <> 0 then
    raise exception 'A FAILED: an api view reads the lossless store';
  end if;

  for r in
    select tgname, rel
    from (values
      ('trg_pmt_metadata_element_immutable', 'plm.pmt_metadata_element'::regclass),
      ('trg_pmt_asset_metadata_value_immutable', 'plm.pmt_asset_metadata_value'::regclass)
    ) as v(tgname, rel)
  loop
    select pg_get_triggerdef(t.oid) into v_text
    from pg_trigger t
    where t.tgrelid = r.rel and t.tgname = r.tgname and not t.tgisinternal;
    if v_text is null or v_text not ilike '%pmt_reject_completed_capture_change%' then
      raise exception 'A FAILED: % missing or not bound to plm.pmt_reject_completed_capture_change()',
        r.tgname;
    end if;
  end loop;

  foreach p in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('service_role', 'plm.pmt_metadata_element', p) then
      raise exception 'A FAILED: service_role still holds %', p;
    end if;
  end loop;

  foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('anon', 'plm.pmt_metadata_element', p) then
      raise exception 'A FAILED: anon holds %', p;
    end if;
  end loop;

  foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege('authenticated', 'plm.pmt_metadata_element', p) then
      raise exception 'A FAILED: authenticated holds write privilege %', p;
    end if;
  end loop;
  if not has_table_privilege('authenticated', 'plm.pmt_metadata_element', 'SELECT') then
    raise exception 'A FAILED: authenticated lost SELECT';
  end if;

  if obj_description('plm.pmt_metadata_element'::regclass) is null
     or obj_description('plm.pmt_metadata_element'::regclass) not ilike '%data_type stays%' then
    raise exception 'A FAILED: table comment missing or does not lock data_type on the value row';
  end if;

  raise notice 'A: catalog, privilege, freeze, and no-api-view assertions passed';
end;
$$;


-- =====================================================================================
-- B. NEW-ELEMENT-ID PATH. The case that only fails for a *new* id after a
--    backfill-covered schema looks healthy (2026-08-14 OPA).
-- =====================================================================================
do $$
declare
  v_cap uuid;
  v_n integer;
  v_asset text := repeat('a', 40);
  v_ok boolean;
begin
  raise notice '=== B. NEW-ELEMENT-ID LOADER PATH ===';

  v_cap := plm.begin_pmt_capture(
    'test',
    'https://portal.example.invalid/',
    'ZZTEST Library',
    now(),
    'ZZTEST-contract-operator',
    repeat('3', 40),
    repeat('4', 64),
    0, 1, 1, 1, 0, 0,
    '{}'::jsonb,
    'pmt_metadata_element_contracts: synthetic capture, deleted at the end');

  v_n := plm.load_pmt_capture_chunk(v_cap, 'pmt_asset', $json$[
    {"asset_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
     "asset_name": "ZZTEST Asset One",
     "content_size_bytes": 0, "content_type": "image", "mime_type": "image/png",
     "asset_version": 0}
  ]$json$);
  if v_n <> 1 then raise exception 'B FAILED: expected 1 asset row, got %', v_n; end if;

  -- Parent first, then a value for a previously unseen element id.
  v_n := plm.load_pmt_capture_chunk(v_cap, 'pmt_metadata_element', $json$[
    {"metadata_element_id": "ZZTEST_NEW_ELEMENT",
     "metadata_element_name": null, "metadata_category_id": null,
     "metadata_category_name": null, "domain_id": null,
     "source_table_name": null, "source_column_name": null}
  ]$json$);
  if v_n <> 1 then raise exception 'B FAILED: expected 1 element row, got %', v_n; end if;

  v_n := plm.load_pmt_capture_chunk(v_cap, 'pmt_asset_metadata_value', $json$[
    {"asset_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
     "metadata_element_id": "ZZTEST_NEW_ELEMENT",
     "data_type": "number", "value_ordinal": 0,
     "source_value": "12345", "display_value": "ZZTEST Label"}
  ]$json$);
  if v_n <> 1 then raise exception 'B FAILED: expected 1 value row, got %', v_n; end if;

  select count(*) into v_n from plm.pmt_asset_metadata_value
   where capture_id = v_cap and metadata_element_id = 'ZZTEST_NEW_ELEMENT'
     and data_type = 'number';
  if v_n <> 1 then
    raise exception 'B FAILED: data_type was not stored on the value row';
  end if;

  -- Same new-id path FAILS if the element parent is not loaded first (FK).
  v_ok := false;
  begin
    perform plm.load_pmt_capture_chunk(v_cap, 'pmt_asset_metadata_value', $json$[
      {"asset_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
       "metadata_element_id": "ZZTEST_ORPHAN_ELEMENT",
       "data_type": "string", "value_ordinal": 0,
       "source_value": "orphan", "display_value": "ZZTEST Orphan"}
    ]$json$);
  exception
    when foreign_key_violation then
      v_ok := true;
    when others then
      if sqlstate = '23503' then
        v_ok := true;
      else
        raise;
      end if;
  end;
  if not v_ok then
    raise exception 'B FAILED: value row without an element parent was accepted';
  end if;

  delete from plm.pmt_asset_metadata_value where capture_id = v_cap;
  delete from plm.pmt_metadata_element where capture_id = v_cap;
  delete from plm.pmt_asset where capture_id = v_cap;
  delete from plm.pmt_capture_expectation where capture_id = v_cap;
  delete from plm.pmt_capture where capture_id = v_cap;

  raise notice 'B: new-element-id path succeeds after parent load and fails without it';
end;
$$;


-- =====================================================================================
-- C. CHECKs. Blank element id, invalid data_type on the VALUE table, raw_value
--    shape still refuses a blocked key.
-- =====================================================================================
do $$
declare
  v_cap uuid;
  v_ok boolean;
begin
  raise notice '=== C. CHECK CONSTRAINTS ===';

  v_cap := plm.begin_pmt_capture(
    'test',
    'https://portal.example.invalid/',
    'ZZTEST Library',
    now(),
    'ZZTEST-contract-operator',
    repeat('5', 40),
    repeat('6', 64),
    0, 1, 1, 1, 0, 0,
    '{}'::jsonb,
    'pmt_metadata_element_contracts C: synthetic capture, deleted at the end');

  v_ok := false;
  begin
    perform plm.load_pmt_capture_chunk(v_cap, 'pmt_metadata_element', $json$[
      {"metadata_element_id": "   ",
       "metadata_element_name": null}
    ]$json$);
  exception
    when check_violation then
      v_ok := true;
    when others then
      if sqlstate = '23514' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'C FAILED: blank metadata_element_id was accepted';
  end if;

  perform plm.load_pmt_capture_chunk(v_cap, 'pmt_asset', $json$[
    {"asset_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
     "asset_name": "ZZTEST Asset Two",
     "content_size_bytes": 0, "content_type": "image", "mime_type": "image/png",
     "asset_version": 0}
  ]$json$);
  perform plm.load_pmt_capture_chunk(v_cap, 'pmt_metadata_element', $json$[
    {"metadata_element_id": "ZZTEST_TYPE_ELEMENT"}
  ]$json$);

  v_ok := false;
  begin
    perform plm.load_pmt_capture_chunk(v_cap, 'pmt_asset_metadata_value', $json$[
      {"asset_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
       "metadata_element_id": "ZZTEST_TYPE_ELEMENT",
       "data_type": "date", "value_ordinal": 0,
       "source_value": "x", "display_value": "x"}
    ]$json$);
  exception
    when check_violation then
      v_ok := true;
    when others then
      if sqlstate = '23514' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'C FAILED: data_type outside string/number/boolean was accepted on the value table';
  end if;

  v_ok := false;
  begin
    perform plm.load_pmt_capture_chunk(v_cap, 'pmt_asset_metadata_value', $json$[
      {"asset_id": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
       "metadata_element_id": "ZZTEST_TYPE_ELEMENT",
       "data_type": "string", "value_ordinal": 0,
       "source_value": "x", "display_value": "x",
       "raw_value": {"url": "https://example.invalid/"}}
    ]$json$);
  exception
    when check_violation then
      v_ok := true;
    when others then
      if sqlstate = '23514' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'C FAILED: pmt_amv_raw_value_shape_chk no longer rejects a blocked key';
  end if;

  delete from plm.pmt_asset_metadata_value where capture_id = v_cap;
  delete from plm.pmt_metadata_element where capture_id = v_cap;
  delete from plm.pmt_asset where capture_id = v_cap;
  delete from plm.pmt_capture_expectation where capture_id = v_cap;
  delete from plm.pmt_capture where capture_id = v_cap;

  raise notice 'C: blank id, bad data_type, and blocked raw_value key are still refused';
end;
$$;


-- =====================================================================================
-- D. COMPLETED-CAPTURE FREEZE on plm.pmt_metadata_element.
-- =====================================================================================
do $$
declare
  v_cap uuid;
  v_ok boolean;
begin
  raise notice '=== D. COMPLETED-CAPTURE FREEZE ===';

  v_cap := plm.begin_pmt_capture(
    'test',
    'https://portal.example.invalid/',
    'ZZTEST Library',
    now(),
    'ZZTEST-contract-operator',
    repeat('7', 40),
    repeat('8', 64),
    0, 1, 1, 1, 0, 0,
    '{}'::jsonb,
    'pmt_metadata_element_contracts D: synthetic capture, deleted at the end');

  perform plm.load_pmt_capture_chunk(v_cap, 'pmt_metadata_element', $json$[
    {"metadata_element_id": "ZZTEST_FREEZE_ELEMENT"}
  ]$json$);

  update plm.pmt_capture
     set status = 'complete',
         completed_at = now(),
         validated_at = now(),
         validation_passed = true
   where capture_id = v_cap;

  v_ok := false;
  begin
    update plm.pmt_metadata_element
       set source_hash = source_hash
     where capture_id = v_cap;
  exception
    when others then
      if sqlerrm ilike '%COMPLETE%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'D FAILED: UPDATE on a completed capture was accepted';
  end if;

  v_ok := false;
  begin
    delete from plm.pmt_metadata_element where capture_id = v_cap;
  exception
    when others then
      if sqlerrm ilike '%COMPLETE%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'D FAILED: DELETE on a completed capture was accepted';
  end if;

  alter table plm.pmt_metadata_element disable trigger trg_pmt_metadata_element_immutable;
  alter table plm.pmt_capture disable trigger trg_pmt_capture_freeze;
  delete from plm.pmt_metadata_element where capture_id = v_cap;
  delete from plm.pmt_capture_expectation where capture_id = v_cap;
  delete from plm.pmt_capture where capture_id = v_cap;
  alter table plm.pmt_metadata_element enable trigger trg_pmt_metadata_element_immutable;
  alter table plm.pmt_capture enable trigger trg_pmt_capture_freeze;

  raise notice 'D: completed capture refuses UPDATE and DELETE on the element table';
end;
$$;
