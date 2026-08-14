-- Issue #970. Every fixture value is invented; no licensed row contents appear here.
-- Run against preview or the CI temporary database as the migration owner.

do $$
declare
  v_text text;
  v_n integer;
  v_invoker text;
  v_search_path_config text;
begin
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'plm' and table_name = 'pmt_collection'
    and column_name = 'paramount_term';
  if v_n <> 0 then
    raise exception 'catalog failed: plm.pmt_collection.paramount_term still exists';
  end if;

  select pg_get_functiondef('plm.load_pmt_capture_chunk(uuid,text,jsonb)'::regprocedure)
    into v_text;
  if v_text ilike '%paramount_term%' then
    raise exception 'loader failed: function still names paramount_term';
  end if;
  select cfg into v_search_path_config
  from pg_proc p
  cross join lateral unnest(p.proconfig) as cfg
  where p.oid = 'plm.load_pmt_capture_chunk'::regproc
    and cfg like 'search_path=%';
  if v_text not ilike '%security definer%'
     or regexp_replace(coalesce(v_search_path_config, ''), '[[:space:]"]+', '', 'g')
          <> 'search_path=plm,core,public,extensions'
     or v_text not ilike '%not (p_target = any (c_targets))%' then
    raise exception 'loader failed: security-definer safeguards changed';
  end if;

  select c.reloptions::text into v_invoker
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'api' and c.relname = 'pmt_style_guides';
  if v_invoker is null or v_invoker not ilike '%security_invoker=true%' then
    raise exception 'view failed: security_invoker=true is missing';
  end if;

  if has_table_privilege('anon', 'api.pmt_style_guides', 'SELECT')
     or not has_table_privilege('authenticated', 'api.pmt_style_guides', 'SELECT')
     or not has_table_privilege('service_role', 'api.pmt_style_guides', 'SELECT') then
    raise exception 'view failed: read grants changed';
  end if;

  select pg_get_viewdef('api.pmt_style_guides'::regclass, true) into v_text;
  if v_text not ilike '%''Collection''::text AS paramount_term%'
     or v_text ilike '%cl.paramount_term%' then
    raise exception 'view failed: paramount_term is not the computed Collection literal';
  end if;

  select count(*) into v_n
  from api.pmt_style_guides
  where paramount_term is distinct from 'Collection'::text;
  if v_n <> 0 then
    raise exception 'API failed: % rows do not return Collection', v_n;
  end if;
end;
$$;

do $$
declare
  v_cap uuid;
  v_n integer;
begin
  v_cap := plm.begin_pmt_capture(
    'test', 'https://portal.example.invalid/', 'ZZTEST Library', now(),
    'ZZTEST-contract-operator', repeat('7', 40), repeat('8', 64),
    0, 0, 0, 0, 0, 0, '{}'::jsonb,
    'pmt_collection_paramount_term_contracts: deleted below');

  v_n := plm.load_pmt_capture_chunk(v_cap, 'pmt_collection', $json$[
    {"collection_source_id":"99001","collection_name":"ZZTEST Collection",
     "paramount_term":"legacy input must be ignored"}
  ]$json$);
  if v_n <> 1 then
    raise exception 'loader path failed: expected 1 row, got %', v_n;
  end if;

  select count(*) into v_n
  from plm.pmt_collection
  where capture_id = v_cap and collection_source_id = '99001'
    and collection_name = 'ZZTEST Collection';
  if v_n <> 1 then
    raise exception 'loader path failed: collection row was not retained';
  end if;

  delete from plm.pmt_collection where capture_id = v_cap;
  delete from plm.pmt_capture_expectation where capture_id = v_cap;
  delete from plm.pmt_capture where capture_id = v_cap;
end;
$$;
