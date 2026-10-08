-- Focused rollback-only unit contracts. Synthetic helpers isolate the real detector
-- bodies from deployment baseline activation; this is not cutover readiness proof.
begin;

create or replace function plm.compute_taxonomy_immutability_snapshot()
returns jsonb language sql stable security definer set search_path = plm, core, ingest, public as $$
select coalesce(nullif(current_setting('test3175.snapshot', true), ''), '{}')::jsonb
$$;
create or replace function plm.taxonomy_baseline_pin_set(p_baseline_key text default null)
returns jsonb language plpgsql stable security definer set search_path = plm, public as $$
begin
  if p_baseline_key = 'test3175-unreadable' then raise exception 'test3175 unreadable pins'; end if;
  return current_setting('test3175.pins')::jsonb;
end;
$$;
create or replace function plm.active_taxonomy_baseline_key()
returns text language sql stable security definer set search_path = plm, public as $$
select null::text
$$;

do $$
declare
  s jsonb := jsonb_build_object(
    'licensor_count',0,'property_count',0,'taxonomy_source_ref_count',0,
    'coldlion_source_ref_count',0,'designflow_source_ref_count',0,
    'linked_licensor_count',0,'linked_property_count',0,'open_review_count',0,
    'licensor_uuid_hash',md5(''),'property_uuid_hash',md5(''),
    'licensor_status_hash','00bf7069fff79b9deab1d14dbd9112b2',
    'property_status_hash',md5(''),'parent_edge_hash',md5(''),
    'source_ref_hash',md5(''),'status_hash',md5(''),'coldlion_mirror_key_hash',md5(''));
  opts jsonb := '{"baseline_key":"test3175","skip_alert":true}';
  h jsonb; o jsonb; before_count bigint; df_id uuid; cl_id uuid;
  f text;
begin
  perform set_config('test3175.snapshot',s::text,true);
  perform set_config('test3175.pins',s::text,true);
  -- The former lane must remain optional for every historical status.
  insert into ingest.sync_run(source_system,source_name,status,started_at,finished_at)
  values('coldlion','coldlion_licensors_properties_api','succeeded',now()+interval '1 day',now()+interval '1 day') returning id into cl_id;
  o:=plm.record_taxonomy_parallel_observation(date '1900-01-01',opts);
  if (o->>'pass')::boolean is not true or o->'designflow_lane' is distinct from '{"status":"retired","required":false}'::jsonb then
    raise exception 'fresh ColdLion must pass independently of DesignFlow: %',o;
  end if;
  if (o->>'designflow_ok')::boolean is not true then raise exception 'compatibility flag missing'; end if;
  h:=plm.check_taxonomy_sync_health(interval '36 hours',opts);
  if (h->>'ok')::boolean is not true or h->'designflow_lane' is distinct from '{"status":"retired","required":false}'::jsonb then
    raise exception 'healthy active lane blocked by retired lane: %',h;
  end if;
  insert into ingest.sync_run(source_system,source_name,status,started_at,finished_at)
  values('designflow_plm','plm_master_data_api','failed',now()+interval '2 days',now()+interval '2 days') returning id into df_id;
  o:=plm.record_taxonomy_parallel_observation(date '1900-01-02',opts);
  h:=plm.check_taxonomy_sync_health(interval '36 hours',opts);
  if (o->>'pass')::boolean is not true or (h->>'ok')::boolean is not true then raise exception 'failed historical lane still gates'; end if;
  if not exists(select 1 from ingest.sync_run where id=df_id and status='failed') then raise exception 'historical evidence rewritten'; end if;
  if not exists(select 1 from plm.taxonomy_parallel_observation where id=(o->>'observation_id')::uuid and details->'designflow_lane'='{"status":"retired","required":false}'::jsonb) then raise exception 'persisted compatibility semantics missing'; end if;

  h:=plm.check_taxonomy_sync_health(interval '-100 years',opts);
  o:=plm.record_taxonomy_parallel_observation(date '1900-01-03',opts||'{"max_success_age":"-100 years"}');
  if (h->>'ok')::boolean is not false or (h->'issues' @> '[{"kind":"stale_run","lane":"coldlion"}]') is not true or (o->>'pass')::boolean is not false then raise exception 'ColdLion freshness guard lost'; end if;

  insert into ingest.sync_run(source_system,source_name,status,started_at,finished_at)
  values('coldlion','coldlion_licensors_properties_api','failed',now()+interval '3 days',now()+interval '3 days'),
        ('coldlion','coldlion_licensors_properties_api','failed',now()+interval '4 days',now()+interval '4 days');
  h:=plm.check_taxonomy_sync_health(interval '36 hours',opts);
  o:=plm.record_taxonomy_parallel_observation(date '1900-01-04',opts);
  if (h->>'ok')::boolean is not false or (h->'issues' @> '[{"kind":"two_consecutive_failures","lane":"coldlion"}]') is not true or (o->'diffs' @> '[{"kind":"coldlion_lane"}]') is not true then raise exception 'ColdLion failure guard lost'; end if;

  perform set_config('test3175.snapshot',(s||'{"designflow_source_ref_count":1}')::text,true);
  o:=plm.record_taxonomy_parallel_observation(date '1900-01-05',opts);
  if (o->>'baseline_ok')::boolean is not false or (o->>'links_ok')::boolean is not false then raise exception 'historical DesignFlow reference invariants lost'; end if;

  select count(*) into before_count from plm.taxonomy_parallel_observation;
  perform set_config('test3175.snapshot',(s||'{"licensor_status_hash":"unreviewed"}')::text,true);
  begin
    perform plm.check_taxonomy_sync_health(interval '36 hours',opts);
    raise exception 'health accepted unreviewed hash';
  exception when raise_exception then
    if sqlerrm <> 'taxonomy health refused: live licensor_status_hash is outside the reviewed transition' then raise; end if;
  end;
  begin
    perform plm.record_taxonomy_parallel_observation(date '1900-01-06',opts);
    raise exception 'observation accepted unreviewed hash';
  exception when raise_exception then
    if sqlerrm <> 'taxonomy health refused: live licensor_status_hash is outside the reviewed transition' then raise; end if;
  end;
  if (select count(*) from plm.taxonomy_parallel_observation)<>before_count then raise exception 'refused hash wrote observation'; end if;
  perform set_config('test3175.snapshot',s::text,true);
  h:=plm.check_taxonomy_sync_health(interval '36 hours','{"skip_alert":true}');
  o:=plm.record_taxonomy_parallel_observation(date '1900-01-07','{"skip_alert":true}');
  if h->>'reason' is distinct from 'no_active_baseline' or o->>'reason' is distinct from 'no_active_baseline' then raise exception 'missing baseline refusal lost'; end if;
  h:=plm.check_taxonomy_sync_health(interval '36 hours',opts||'{"baseline_key":"test3175-unreadable"}');
  if (h->>'baseline_unreadable')::boolean is not true then raise exception 'unreadable baseline refusal lost'; end if;
  o:=plm.record_taxonomy_parallel_observation(date '1900-01-08',opts||'{"force_fail":true}');
  if (o->>'pass')::boolean is not false or (o->>'is_drill')::boolean is not true then raise exception 'drill guard lost'; end if;

  foreach f in array array['plm.check_taxonomy_sync_health(interval,jsonb)','plm.record_taxonomy_parallel_observation(date,jsonb)'] loop
    if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE') or not has_function_privilege('service_role',f,'EXECUTE') then raise exception 'execution boundary changed: %',f; end if;
  end loop;
end;
$$;
rollback;
