-- Synthetic-only contract for issue #1547. No licensed mappings are present.
begin;

do $contract$
declare
  v_result record;
  v_property_before bigint;
  v_property_after bigint;
  v_link_before bigint;
  v_link_after bigint;
  v_raw_before text;
  v_raw_after text;
  v_rejected boolean;
  v_role text;
  v_count integer;
begin
  insert into plm.opa_property (licensed_property_id, property_name)
  values
    (-1547001, 'Synthetic Disney Property'),
    (-1547002, 'Synthetic Marvel Property'),
    (-1547003, 'Synthetic Lucasfilm Property'),
    (-1547004, 'Synthetic Crossover Property'),
    (-1547005, 'Synthetic Candidate Property'),
    (-1547006, 'Synthetic Unresolved Property');

  insert into plm.opa_character (character_id, character_name)
  values (-1547101, 'Synthetic Character');

  insert into plm.opa_property_character (
    licensed_property_id, character_id, property_name, character_name,
    brand_property_id, option_source_id, captured_at, source_url,
    line_of_business, entitlement_scope, raw, source_hash
  )
  select p.licensed_property_id, -1547101, p.property_name, 'Synthetic Character',
         p.licensed_property_id, 1007, date '2099-01-01',
         'https://synthetic.invalid/opa', 'Home', 'synthetic-only',
         jsonb_build_object('synthetic_id', p.licensed_property_id),
         md5(p.licensed_property_id::text)
  from plm.opa_property p
  where p.licensed_property_id between -1547006 and -1547001;

  select count(*) into v_property_before from plm.opa_property;
  select count(*) into v_link_before from plm.opa_property_character;
  select md5(string_agg(
    concat_ws('|', licensed_property_id, character_id, property_name, character_name,
              brand_property_id, option_source_id, raw::text, source_hash),
    E'\n' order by licensed_property_id, character_id
  )) into v_raw_before
  from plm.opa_property_character;

  select * into v_result
  from plm.sync_opa_property_studio_resolution(jsonb_build_array(
    jsonb_build_object('licensed_property_id', -1547001, 'studio_code', 'disney',
      'resolution_status', 'canonical', 'provenance_type', 'direct_source_assertion',
      'provenance_reference', 'synthetic-direct'),
    jsonb_build_object('licensed_property_id', -1547002, 'studio_code', 'marvel',
      'resolution_status', 'canonical', 'provenance_type', 'owner_reviewed_resolution',
      'provenance_reference', 'synthetic-owner-review'),
    jsonb_build_object('licensed_property_id', -1547003, 'studio_code', 'lucasfilm',
      'resolution_status', 'canonical', 'provenance_type', 'direct_source_assertion',
      'provenance_reference', 'synthetic-direct'),
    jsonb_build_object('licensed_property_id', -1547004, 'studio_code', 'disney',
      'resolution_status', 'ambiguous_crossover', 'provenance_type', 'ambiguous_crossover',
      'provenance_reference', 'synthetic-crossover'),
    jsonb_build_object('licensed_property_id', -1547004, 'studio_code', 'marvel',
      'resolution_status', 'ambiguous_crossover', 'provenance_type', 'ambiguous_crossover',
      'provenance_reference', 'synthetic-crossover'),
    jsonb_build_object('licensed_property_id', -1547005, 'studio_code', 'disney',
      'resolution_status', 'inferred_candidate', 'provenance_type', 'inferred_candidate',
      'provenance_reference', 'synthetic-inference'),
    jsonb_build_object('licensed_property_id', -1547006, 'studio_code', null,
      'resolution_status', 'unresolved', 'provenance_type', 'unresolved')
  ));

  if v_result.rows_seen <> 7 or v_result.rows_inserted <> 7
     or v_result.rows_updated <> 0 or v_result.rows_unchanged <> 0 then
    raise exception 'unexpected first sync accounting: %', row_to_json(v_result);
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"app_metadata":{"roles":["administrator"]}}',
    true
  );

  if not exists (select 1 from api.opa_disney_property where licensed_property_id = -1547001)
     or exists (select 1 from api.opa_disney_property where licensed_property_id in (-1547002,-1547003,-1547004,-1547005,-1547006)) then
    raise exception 'Disney canonical view leaked another studio or non-canonical state';
  end if;
  if not exists (select 1 from api.opa_marvel_property where licensed_property_id = -1547002)
     or exists (select 1 from api.opa_marvel_property where licensed_property_id in (-1547001,-1547003,-1547004,-1547005,-1547006)) then
    raise exception 'Marvel canonical view leaked another studio or non-canonical state';
  end if;
  if not exists (select 1 from api.opa_lucasfilm_property where licensed_property_id = -1547003)
     or exists (select 1 from api.opa_lucasfilm_property where licensed_property_id in (-1547001,-1547002,-1547004,-1547005,-1547006)) then
    raise exception 'Lucasfilm canonical view leaked another studio or non-canonical state';
  end if;

  if (select count(*) from plm.opa_property_studio_resolution where licensed_property_id = -1547004) <> 2 then
    raise exception 'multi-studio crossover evidence was collapsed';
  end if;

  -- The canonical views are intentionally owner-defined projections because the
  -- normalized plm.opa_property table is not directly granted. Their explicit predicate
  -- must still match the confidential OPA mirror and never expose Disney IDs/names to
  -- vendor, viewer, designer, or a principal with no role.
  foreach v_role in array array['vendor', 'viewer', 'designer'] loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"app_metadata":{"roles":["%s"]}}', v_role), true);
    select count(*) into v_count
    from (
      select licensed_property_id from api.opa_disney_property
      union all select licensed_property_id from api.opa_marvel_property
      union all select licensed_property_id from api.opa_lucasfilm_property
    ) canonical
    where licensed_property_id in (-1547001, -1547002, -1547003);
    execute 'reset role';
    if v_count <> 0 then
      raise exception '% read % canonical OPA studio row(s)', v_role, v_count;
    end if;
  end loop;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', '{"app_metadata":{"roles":[]}}', true);
  select count(*) into v_count from api.opa_disney_property
    where licensed_property_id = -1547001;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'principal with no app role read a canonical OPA studio row';
  end if;

  foreach v_role in array array['administrator', 'sales', 'licensing'] loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
      format('{"app_metadata":{"roles":["%s"]}}', v_role), true);
    select count(*) into v_count from api.opa_disney_property
      where licensed_property_id = -1547001;
    execute 'reset role';
    if v_count <> 1 then
      raise exception '% could not read its authorized canonical OPA studio row', v_role;
    end if;
  end loop;

  v_rejected := false;
  begin
    perform * from plm.sync_opa_property_studio_resolution(jsonb_build_array(
      jsonb_build_object('licensed_property_id', -1547001, 'studio_code', 'unknown-studio',
        'resolution_status', 'canonical', 'provenance_type', 'direct_source_assertion',
        'provenance_reference', 'synthetic-invalid')
    ));
  exception when sqlstate 'P0001' then
    v_rejected := position('unrecognized' in sqlerrm) > 0;
  end;
  if not v_rejected then raise exception 'unrecognized studio did not fail closed'; end if;

  v_rejected := false;
  begin
    perform * from plm.sync_opa_property_studio_resolution(jsonb_build_array(
      jsonb_build_object('licensed_property_id', 1547.5, 'studio_code', 'disney',
        'resolution_status', 'canonical', 'provenance_type', 'direct_source_assertion',
        'provenance_reference', 'synthetic-invalid')
    ));
  exception when sqlstate 'P0001' then
    v_rejected := position('not an integer' in sqlerrm) > 0
      and position('1547.5' in sqlerrm) = 0;
  end;
  if not v_rejected then
    raise exception 'non-integer property ID did not fail closed without echoing its value';
  end if;

  v_rejected := false;
  begin
    perform * from plm.sync_opa_property_studio_resolution(jsonb_build_array(
      jsonb_build_object('licensed_property_id', -1547006,
        'resolution_status', 'canonical', 'provenance_type', 'direct_source_assertion',
        'provenance_reference', 'synthetic-invalid')
    ));
  exception when sqlstate 'P0001' then
    v_rejected := position('status/provenance' in sqlerrm) > 0;
  end;
  if not v_rejected then raise exception 'canonical resolution without a studio did not fail closed'; end if;

  v_rejected := false;
  begin
    perform * from plm.sync_opa_property_studio_resolution(jsonb_build_array(
      jsonb_build_object('licensed_property_id', -1547001, 'studio_code', 'disney',
        'resolution_status', 'inferred_candidate', 'provenance_type', 'inferred_candidate',
        'provenance_reference', 'synthetic-lower-authority')
    ));
  exception when sqlstate 'P0001' then
    v_rejected := position('lower-authority' in sqlerrm) > 0;
  end;
  if not v_rejected then raise exception 'inference overwrote direct canonical evidence'; end if;

  select count(*) into v_property_after from plm.opa_property;
  select count(*) into v_link_after from plm.opa_property_character;
  select md5(string_agg(
    concat_ws('|', licensed_property_id, character_id, property_name, character_name,
              brand_property_id, option_source_id, raw::text, source_hash),
    E'\n' order by licensed_property_id, character_id
  )) into v_raw_after
  from plm.opa_property_character;

  if v_property_after <> v_property_before or v_link_after <> v_link_before
     or v_raw_after is distinct from v_raw_before then
    raise exception 'OPA raw identities or direct links changed during studio resolution';
  end if;

  if has_function_privilege('authenticated',
       'plm.sync_opa_property_studio_resolution(jsonb)', 'execute') then
    raise exception 'authenticated may execute the governed studio resolution loader';
  end if;
  if not has_function_privilege('service_role',
       'plm.sync_opa_property_studio_resolution(jsonb)', 'execute') then
    raise exception 'service_role cannot execute the governed studio resolution loader';
  end if;
end
$contract$;

rollback;

select 'OPA_PROPERTY_STUDIO_RESOLUTION_CONTRACTS_OK' as result;
