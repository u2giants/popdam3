-- =====================================================================================
-- Paramount metadata raw_value JSON-null contracts -- issues #1418 and #1459.
--
-- WHAT THIS PROVES
--   A. POSITIVE. A value row whose optional `raw_value` arrives as the JSON literal
--      null loads, and is stored as SQL NULL (not JSONB null). An omitted key keeps
--      behaving identically, and a real object still round-trips unchanged.
--   B. NEGATIVE. pmt_amv_raw_value_shape_chk is still doing its job: a non-object
--      raw_value and a blocked URL/credential-shaped key are still refused, so the
--      repair cannot have been made by weakening the constraint.
--
-- HOW TO RUN
--   Against PREVIEW (ref from the repository variable PREVIEW_PROJECT_REF) or the CI
--   ephemeral database, as the migration owner:
--       \i supabase/tests/pmt_raw_value_json_null_contracts.sql
--
--   RUN EACH `do $$` BLOCK AS A SEPARATE STATEMENT. Submitting the whole file as one
--   multi-statement batch through the transaction pooler (port 6543) wraps every block
--   in one implicit transaction and stalls.
--
--   NOTE for preview: this opens a synthetic capture via plm.begin_pmt_capture, which
--   REFUSES to run while any real capture is loading or validating.
--
-- EVERY VALUE IN THIS FILE IS INVENTED.
--   u2giants/shared-db is PUBLIC. Fixtures use ZZTEST-* tokens and example.invalid.
--   Asset IDs are 40-hex repeats, never a real asset.
--
-- LAST RUN: 2026-08-24 against preview (ref from PREVIEW_PROJECT_REF) -- migration
--   20260824135515 applied cleanly by the preview rehearsal, GitHub Actions run
--   32738436612, from PR #1421 merged as 2731b108e464bfcb558986fc911669e5d2de2959.
-- =====================================================================================

begin;

-- =====================================================================================
-- 0. FORWARD LINEAGE -- all three 20260814 rewrites and the later JSON-null repair coexist.
-- =====================================================================================
do $$
declare
  v_def text := lower(regexp_replace(pg_get_functiondef(
    'plm.load_pmt_capture_chunk(uuid,text,jsonb)'::regprocedure),'\s+',' ','g'));
  v_comment text;
begin
  if to_regclass('plm.pmt_metadata_element') is null
     or exists (
       select 1 from information_schema.columns
       where table_schema='plm' and table_name='pmt_collection'
         and column_name='paramount_term'
     )
     or (select count(*) from information_schema.columns
         where table_schema='plm' and is_nullable='YES'
           and ((table_name='pmt_authorized_title_property'
                 and column_name='paramount_property_name')
             or (table_name='pmt_property_capture_log'
                 and column_name='property_name'))) <> 2 then
    raise exception '0 FAILED: one of the three 20260814 structural rewrites is absent';
  end if;

  if position('nullif' in v_def)=0
     or position('''raw_value''' in v_def)=0
     or position('''null''::jsonb' in v_def)=0
     or v_def not like '%pmt_metadata_element%'
     or v_def like '%insert into plm.pmt_authorized_title_property%paramount_property_name%'
     or v_def like '%insert into plm.pmt_property_capture_log%property_name%'
     or v_def like '%insert into plm.pmt_collection%paramount_term%' then
    raise exception '0 FAILED: current loader is not the repaired full re-derivation';
  end if;

  select obj_description('plm.load_pmt_capture_chunk(uuid,text,jsonb)'::regprocedure,'pg_proc')
    into v_comment;
  if v_comment not ilike '%Issue #1459%'
     or v_comment not ilike '%three 20260814 rewrites%' then
    raise exception '0 FAILED: function note does not preserve the forward-order reason';
  end if;

  if has_function_privilege('anon','plm.load_pmt_capture_chunk(uuid,text,jsonb)','EXECUTE')
     or has_function_privilege('authenticated',
          'plm.load_pmt_capture_chunk(uuid,text,jsonb)','EXECUTE')
     or not has_function_privilege('service_role',
          'plm.load_pmt_capture_chunk(uuid,text,jsonb)','EXECUTE') then
    raise exception '0 FAILED: loader grants changed';
  end if;
  raise notice '0: full trio plus JSON-null forward repair and grants are intact';
end;
$$;


-- =====================================================================================
-- A. POSITIVE -- JSON-null raw_value loads and lands as SQL NULL.
-- =====================================================================================
do $$
declare
  v_cap uuid;
  v_n   integer;
  v_raw jsonb;
  v_asset text := repeat('c', 40);
begin
  raise notice '=== A. JSON-NULL raw_value ===';

  v_cap := plm.begin_pmt_capture(
    'test',
    'https://portal.example.invalid/',
    'ZZTEST Library',
    now(),
    'ZZTEST-contract-operator',
    repeat('9', 40),
    repeat('a', 64),
    0, 1, 1, 1, 0, 0,
    '{}'::jsonb,
    'pmt_raw_value_json_null_contracts A: synthetic capture, deleted at the end');

  perform plm.load_pmt_capture_chunk(v_cap, 'pmt_asset', $json$[
    {"asset_id": "cccccccccccccccccccccccccccccccccccccccc",
     "asset_name": "ZZTEST Asset Null-Raw",
     "content_size_bytes": 0, "content_type": "image", "mime_type": "image/png",
     "asset_version": 0}
  ]$json$);
  perform plm.load_pmt_capture_chunk(v_cap, 'pmt_metadata_element', $json$[
    {"metadata_element_id": "ZZTEST_NULLRAW_ELEMENT"}
  ]$json$);

  -- The key is PRESENT and its value is the JSON literal null. Before issue #1418
  -- this raised pmt_amv_raw_value_shape_chk and failed the whole capture closed.
  v_n := plm.load_pmt_capture_chunk(v_cap, 'pmt_asset_metadata_value', $json$[
    {"asset_id": "cccccccccccccccccccccccccccccccccccccccc",
     "metadata_element_id": "ZZTEST_NULLRAW_ELEMENT",
     "data_type": "string", "value_ordinal": 0,
     "source_value": "ZZTEST-value", "display_value": "ZZTEST Label",
     "raw_value": null}
  ]$json$);
  if v_n <> 1 then
    raise exception 'A FAILED: expected 1 value row for a JSON-null raw_value, got %', v_n;
  end if;

  select raw_value into v_raw from plm.pmt_asset_metadata_value
   where capture_id = v_cap and asset_id = v_asset
     and metadata_element_id = 'ZZTEST_NULLRAW_ELEMENT' and value_ordinal = 0;
  if v_raw is not null then
    raise exception 'A FAILED: JSON-null raw_value stored as %, expected SQL NULL',
      jsonb_typeof(v_raw);
  end if;

  -- An OMITTED key must keep behaving identically -- SQL NULL, not an error.
  v_n := plm.load_pmt_capture_chunk(v_cap, 'pmt_asset_metadata_value', $json$[
    {"asset_id": "cccccccccccccccccccccccccccccccccccccccc",
     "metadata_element_id": "ZZTEST_NULLRAW_ELEMENT",
     "data_type": "string", "value_ordinal": 1,
     "source_value": "ZZTEST-value-2", "display_value": "ZZTEST Label 2"}
  ]$json$);
  if v_n <> 1 then
    raise exception 'A FAILED: expected 1 value row for an omitted raw_value, got %', v_n;
  end if;
  select raw_value into v_raw from plm.pmt_asset_metadata_value
   where capture_id = v_cap and asset_id = v_asset
     and metadata_element_id = 'ZZTEST_NULLRAW_ELEMENT' and value_ordinal = 1;
  if v_raw is not null then
    raise exception 'A FAILED: omitted raw_value no longer stores as SQL NULL';
  end if;

  -- A real object still round-trips unchanged: the normalization must touch ONLY
  -- the JSON-null case, never a legitimate structured remainder.
  v_n := plm.load_pmt_capture_chunk(v_cap, 'pmt_asset_metadata_value', $json$[
    {"asset_id": "cccccccccccccccccccccccccccccccccccccccc",
     "metadata_element_id": "ZZTEST_NULLRAW_ELEMENT",
     "data_type": "string", "value_ordinal": 2,
     "source_value": "ZZTEST-value-3", "display_value": "ZZTEST Label 3",
     "raw_value": {"zztest_key": "zztest-remainder"}}
  ]$json$);
  if v_n <> 1 then
    raise exception 'A FAILED: expected 1 value row for an object raw_value, got %', v_n;
  end if;
  select raw_value into v_raw from plm.pmt_asset_metadata_value
   where capture_id = v_cap and asset_id = v_asset
     and metadata_element_id = 'ZZTEST_NULLRAW_ELEMENT' and value_ordinal = 2;
  if v_raw is null or jsonb_typeof(v_raw) <> 'object'
     or v_raw->>'zztest_key' <> 'zztest-remainder' then
    raise exception 'A FAILED: object raw_value did not round-trip, got %',
      coalesce(v_raw::text, '<null>');
  end if;

  delete from plm.pmt_asset_metadata_value where capture_id = v_cap;
  delete from plm.pmt_metadata_element where capture_id = v_cap;
  delete from plm.pmt_asset where capture_id = v_cap;
  delete from plm.pmt_capture_expectation where capture_id = v_cap;
  delete from plm.pmt_capture where capture_id = v_cap;

  raise notice 'A: JSON-null and omitted raw_value store as SQL NULL; an object round-trips';
end;
$$;


-- =====================================================================================
-- B. NEGATIVE -- the shape constraint is untouched. Unsafe and non-object values
--    are still refused.
-- =====================================================================================
do $$
declare
  v_cap uuid;
  v_ok  boolean;
  v_n   integer;
  v_payload jsonb;
  v_case text;
begin
  raise notice '=== B. UNSAFE / NON-OBJECT raw_value STILL REFUSED ===';

  -- The constraint must still exist, by name, and be validated on the value table.
  select count(*) into v_n from pg_constraint
  where conrelid = 'plm.pmt_asset_metadata_value'::regclass
    and conname = 'pmt_amv_raw_value_shape_chk'
    and convalidated;
  if v_n <> 1 then
    raise exception 'B FAILED: pmt_amv_raw_value_shape_chk is missing or not validated';
  end if;

  v_cap := plm.begin_pmt_capture(
    'test',
    'https://portal.example.invalid/',
    'ZZTEST Library',
    now(),
    'ZZTEST-contract-operator',
    repeat('b', 40),
    repeat('c', 64),
    0, 1, 1, 1, 0, 0,
    '{}'::jsonb,
    'pmt_raw_value_json_null_contracts B: synthetic capture, deleted at the end');

  perform plm.load_pmt_capture_chunk(v_cap, 'pmt_asset', $json$[
    {"asset_id": "dddddddddddddddddddddddddddddddddddddddd",
     "asset_name": "ZZTEST Asset Bad-Raw",
     "content_size_bytes": 0, "content_type": "image", "mime_type": "image/png",
     "asset_version": 0}
  ]$json$);
  perform plm.load_pmt_capture_chunk(v_cap, 'pmt_metadata_element', $json$[
    {"metadata_element_id": "ZZTEST_BADRAW_ELEMENT"}
  ]$json$);

  for v_case, v_payload in
    select c, p from (values
      ('json string',  '"zztest-not-an-object"'::jsonb),
      ('json number',  '17'::jsonb),
      ('json array',   '["zztest"]'::jsonb),
      ('json boolean', 'true'::jsonb),
      ('blocked key',  '{"url": "https://example.invalid/"}'::jsonb),
      ('blocked key headers', '{"headers": {"cookie": "zztest"}}'::jsonb)
    ) as v(c, p)
  loop
    v_ok := false;
    begin
      perform plm.load_pmt_capture_chunk(v_cap, 'pmt_asset_metadata_value',
        jsonb_build_array(jsonb_build_object(
          'asset_id', 'dddddddddddddddddddddddddddddddddddddddd',
          'metadata_element_id', 'ZZTEST_BADRAW_ELEMENT',
          'data_type', 'string',
          'value_ordinal', 0,
          'source_value', 'ZZTEST-value',
          'display_value', 'ZZTEST Label',
          'raw_value', v_payload)));
    exception
      when check_violation then
        v_ok := true;
      when others then
        if sqlstate = '23514' then v_ok := true; else raise; end if;
    end;
    if not v_ok then
      raise exception 'B FAILED: raw_value case % was accepted -- '
        'pmt_amv_raw_value_shape_chk has been weakened', v_case;
    end if;
  end loop;

  select count(*) into v_n from plm.pmt_asset_metadata_value where capture_id = v_cap;
  if v_n <> 0 then
    raise exception 'B FAILED: % unsafe value row(s) landed', v_n;
  end if;

  delete from plm.pmt_asset_metadata_value where capture_id = v_cap;
  delete from plm.pmt_metadata_element where capture_id = v_cap;
  delete from plm.pmt_asset where capture_id = v_cap;
  delete from plm.pmt_capture_expectation where capture_id = v_cap;
  delete from plm.pmt_capture where capture_id = v_cap;

  raise notice 'B: non-object and blocked-key raw_value are still refused by the constraint';
end;
$$;

rollback;
