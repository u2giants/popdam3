-- #5622. Synthetic-only behavioural checks; all writes roll back.
begin;
do $test$
declare health record; recovered integer;
begin
  if exists(select 1 from (values ('dam_search_health_errored_idx'),
      ('dam_search_health_last_write_idx'),('sg_search_health_last_write_idx')) wanted(name)
      where to_regclass('public.'||wanted.name) is null) then
    raise exception 'compact health indexes are missing';
  end if;
  if has_function_privilege('anon','public.get_search_embedding_health()','execute')
     or not has_function_privilege('authenticated','public.get_search_embedding_health()','execute')
     or has_function_privilege('authenticated','public.reset_dam_search_embedding_errors(text,integer)','execute')
     or not has_function_privilege('service_role','public.reset_dam_search_embedding_errors(text,integer)','execute')
     or has_function_privilege('authenticated','public.reset_dam_search_embedding_errors(text,integer,text)','execute') then
    raise exception 'search health/reset grants invalid';
  end if;
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin
    perform public.get_search_embedding_health();
    raise exception 'non-admin health access accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.reset_dam_search_embedding_errors(null::text,1);
    raise exception 'non-service reset accepted';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('request.jwt.claim.role','service_role',true);
  if (select count(*) from public.get_search_embedding_health()) <> 2 then
    raise exception 'health must return one row per corpus';
  end if;
  begin
    perform public.reset_dam_search_embedding_errors(null::text,5001);
    raise exception 'unbounded reset accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.reset_dam_search_embedding_errors(null::text,0);
    raise exception 'zero reset accepted';
  exception when invalid_parameter_value then null; end;

  delete from public.dam_search_documents;
  insert into public.dam_search_documents(document_type,entity_id,indexed_at,metadata,embedding_error,embedding_error_category,embedding_attempts,embedding_lease_expires_at)
  values
   ('asset',gen_random_uuid(),now()-interval '3 hours','{"thumbnail_url":"https://example.invalid/a.png"}','missing','permanent',5,null),
   ('asset',gen_random_uuid(),now()-interval '3 hours','{"thumbnail_url":"https://example.invalid/b.png"}','missing','permanent',5,null),
   ('asset',gen_random_uuid(),now()-interval '3 hours','{}','missing','permanent',5,null),
   ('asset',gen_random_uuid(),now()-interval '3 hours','{"thumbnail_url":"https://example.invalid/c.png"}','leased','permanent',5,now()+interval '1 hour'),
   ('asset',gen_random_uuid(),now()-interval '3 hours','{"thumbnail_url":"https://example.invalid/d.png"}','network','transient',1,null);
  select * into health from public.get_search_embedding_health() where corpus='dam';
  if health.pending <> 1 or not health.stale or health.errored <> 5 then
    raise exception 'health ignores eligibility or missing-write age: %',row_to_json(health);
  end if;
  recovered := public.reset_dam_search_embedding_errors('permanent',1,'style_group');
  if recovered <> 0 then raise exception 'document-type filter ignored'; end if;
  recovered := public.reset_dam_search_embedding_errors('permanent',1);
  if recovered <> 1 or (select count(*) from public.dam_search_documents where embedding_error is null) <> 1 then
    raise exception 'bounded reset did not recover exactly one';
  end if;
  recovered := public.reset_dam_search_embedding_errors('permanent',5000);
  if recovered <> 1 then raise exception 'reset touched wrong category, live lease, or no-thumbnail row'; end if;
  if (select count(*) from public.dam_search_documents where embedding_error is null and embedding_attempts=0) <> 2 then
    raise exception 'reset must clear exhausted attempt budget';
  end if;
  delete from public.dam_search_documents where embedding_error is null or embedding_error_category='transient';
  select * into health from public.get_search_embedding_health() where corpus='dam';
  if health.pending <> 0 or health.stale then raise exception 'excluded rows must not alarm'; end if;
end;
$test$;
rollback;
