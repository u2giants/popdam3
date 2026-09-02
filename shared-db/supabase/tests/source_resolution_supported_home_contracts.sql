-- Issue #1609 supported successor: plain UUID targets, guarded writes, dangling visibility.
begin;

do $$
declare
  v_count integer;
  v_missing uuid := gen_random_uuid();
begin
  select count(*) into v_count from pg_constraint
   where conrelid='plm.source_resolution'::regclass and contype='f';
  if v_count <> 0 then raise exception 'source_resolution still has % foreign keys',v_count; end if;

  select count(*) into v_count from pg_trigger
   where tgfoid='plm.reject_legacy_landing_resolution_write()'::regprocedure and not tgisinternal;
  if v_count <> 26 then raise exception 'expected 26 landing guards, found %',v_count; end if;

  select count(*) into v_count from pg_constraint
   where conrelid='plm.source_resolution'::regclass and contype='c' and convalidated;
  if v_count <> 10 then raise exception 'expected 10 validated source_resolution checks, found %',v_count; end if;

  if not exists (
    select 1 from pg_policies
     where schemaname='plm' and tablename='source_resolution'
       and policyname='source_resolution_authenticated_read'
       and cmd='SELECT' and roles=array['authenticated']::name[]
       and regexp_replace(lower(coalesce(qual,'')),'[[:space:]()]','','g')='true'
       and with_check is null
  ) then raise exception 'source_resolution read policy shape is wrong'; end if;

  if not has_table_privilege('authenticated','plm.source_resolution','SELECT')
     or not has_table_privilege('service_role','plm.source_resolution','SELECT') then
    raise exception 'source_resolution read grants are missing';
  end if;

  if not coalesce((select reloptions @> array['security_invoker=true']
      from pg_class where oid='api.source_resolution'::regclass),false)
     or not coalesce((select reloptions @> array['security_invoker=true']
      from pg_class where oid='api.pmt_properties'::regclass),false)
     or not coalesce((select reloptions @> array['security_invoker=true']
      from pg_class where oid='api.pmt_characters'::regclass),false)
     or not coalesce((select reloptions @> array['security_invoker=true']
      from pg_class where oid='api.opa_property_reconciliation'::regclass),false) then
    raise exception 'source resolution API views are not security invokers';
  end if;

  if position('plm.source_resolution' in pg_get_viewdef('api.pmt_properties'::regclass,true))=0
     or position('plm.source_resolution' in pg_get_viewdef('api.pmt_characters'::regclass,true))=0
     or position('plm.source_resolution' in pg_get_viewdef('api.opa_property_reconciliation'::regclass,true))=0 then
    raise exception 'consumer views bypass durable source resolution';
  end if;

  if position('opa_property_character' in pg_get_functiondef(
       'plm.reject_legacy_landing_resolution_write()'::regprocedure))=0
     or position('property_id' in pg_get_functiondef(
       'plm.reject_legacy_landing_resolution_write()'::regprocedure))=0 then
    raise exception 'OPA property_id is not frozen by the landing guard';
  end if;

  begin
    perform plm.set_source_resolution('paramount','property','contract-test-missing-target','matched',
      v_missing,null,null,null,'ZZTEST missing',null);
    raise exception 'guarded write accepted a missing target';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into plm.source_resolution(source_system,entity_kind,source_id,resolution_status)
    values ('unsupported-test-source','property','unsupported-source','unresolved');
    raise exception 'unsupported source system was accepted';
  exception when check_violation then null;
  end;

  -- A target can disappear after a valid historic decision. The row must remain readable
  -- and explicitly dangling; direct insert is test-only setup for that durable state.
  insert into plm.source_resolution(source_system,entity_kind,source_id,
    core_property_id,resolution_status,resolution_reason,resolved_at,resolved_by)
  values ('paramount','property','contract-test-dangling-visible',v_missing,'matched','ZZTEST historic',now(),'zztest');
  if not coalesce((select target_missing from api.source_resolution
      where source_system='paramount' and entity_kind='property' and source_id='contract-test-dangling-visible'),false) then
    raise exception 'dangling decision was not surfaced by the read path';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema='plm' and table_name='source_resolution'
       and grantee in ('anon','authenticated','service_role')
       and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
  ) then raise exception 'direct mutation grant exists on source_resolution'; end if;

  if position('to_regclass' in lower(pg_get_functiondef(
      'plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid)'::regprocedure)))=0
     or position('execute' in lower(pg_get_functiondef(
      'plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid)'::regprocedure)))=0 then
    raise exception 'dangling detector is statically coupled to target relations';
  end if;
end;
$$;

rollback;
