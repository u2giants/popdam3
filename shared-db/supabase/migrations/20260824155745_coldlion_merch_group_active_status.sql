-- Issue #1429: ColdLion merch-group lifecycle status, fix-forward only.
-- The raw endpoint now supplies a required boolean `active` value. Preserve it in the
-- typed mirrors and permit only deterministic status-only canonical transitions.

alter table plm.erp_licensor add column if not exists source_active boolean;
alter table plm.erp_property add column if not exists source_active boolean;

comment on column plm.erp_licensor.source_active is
  'ColdLion /merchGroupDetails active flag. NULL only for historical rows captured before issue #1429; every new snapshot must supply a JSON boolean.';
comment on column plm.erp_property.source_active is
  'ColdLion /merchGroupDetails active flag. NULL only for historical rows captured before issue #1429; every new snapshot must supply a JSON boolean.';

-- Patch the current importer in place. Assertions make migration drift fail loudly instead
-- of silently leaving one of the two mirrors status-blind.
do $patch$
declare
  v_def text := pg_get_functiondef('plm.sync_coldlion_licensors_properties(jsonb,text,jsonb)'::regprocedure);
  v_old text;
  v_new text;
begin
  v_old := E'  -- 3h. Configurable absolute floors plus count-drop guard vs the prior successful run.';
  v_new := E'  -- 3h. ColdLion active is now a required typed endpoint contract.\n'
    || E'  if exists (select 1 from jsonb_array_elements(v_details) d(value)\n'
    || E'             where not (d.value ? ''active'') or jsonb_typeof(d.value -> ''active'') <> ''boolean'') then\n'
    || E'    raise exception ''every licensed /merchGroupDetails row must carry active as a JSON boolean'' using errcode = ''P0001'';\n'
    || E'  end if;\n\n'
    || E'  -- 3i. Configurable absolute floors plus count-drop guard vs the prior successful run.';
  if strpos(v_def, v_old) = 0 then raise exception 'issue #1429 importer patch point 1 not found'; end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := E'    erp_created_at, erp_updated_at, raw, source_hash, last_seen_at, last_sync_run_id\n  )';
  v_new := E'    erp_created_at, erp_updated_at, source_active, raw, source_hash, last_seen_at, last_sync_run_id\n  )';
  if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old) <> 2 then
    raise exception 'issue #1429 importer patch point 2 expected twice';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := E'         nullif(d.value ->> ''modTime'','''')::timestamptz,\n         d.value,';
  v_new := E'         nullif(d.value ->> ''modTime'','''')::timestamptz,\n         (d.value ->> ''active'')::boolean,\n         d.value,';
  if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old) <> 2 then
    raise exception 'issue #1429 importer patch point 3 expected twice';
  end if;
  v_def := replace(v_def, v_old, v_new);

  v_old := E'    erp_updated_at   = excluded.erp_updated_at,\n    raw              = excluded.raw,';
  v_new := E'    erp_updated_at   = excluded.erp_updated_at,\n    source_active    = excluded.source_active,\n    raw              = excluded.raw,';
  if (length(v_def)-length(replace(v_def,v_old,'')))/length(v_old) <> 2 then
    raise exception 'issue #1429 importer patch point 4 expected twice';
  end if;
  v_def := replace(v_def, v_old, v_new);

  -- now() is transaction-stable, so two recurring snapshots in one transaction
  -- otherwise tie and the promoter can select the older lifecycle state.
  v_old := E'  values (''coldlion'', ''coldlion_licensors_properties_api'', ''running'', now(),';
  v_new := E'  values (''coldlion'', ''coldlion_licensors_properties_api'', ''running'', clock_timestamp(),';
  if strpos(v_def, v_old) = 0 then raise exception 'issue #1429 importer patch point 5 not found'; end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end
$patch$;

-- The transaction-bound licensing guard already owns the canonical safety boundary.
-- Expand its existing coldlion_status branch from Property-only to status-only writes on
-- either claimed canonical table; all exact-column, transaction, expiry and consumption
-- protections remain unchanged.
do $patch$
declare
  v_def text := pg_get_functiondef('app.enforce_licensing_write_authority()'::regprocedure);
  v_old text := 'if v_auth.write_kind = ''coldlion_status'' and (tg_table_name <> ''property'' or v_changed <> array[''status'']::text[] or new.status not in (''active'',''inactive'')) then';
  v_new text := 'if v_auth.write_kind = ''coldlion_status'' and (tg_table_name not in (''licensor'',''property'') or tg_op <> ''UPDATE'' or v_changed <> array[''status'']::text[] or new.status not in (''active'',''inactive'')) then';
begin
  if strpos(v_def, v_old) = 0 then raise exception 'issue #1429 licensing guard patch point not found'; end if;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def,
    'coldlion_status authorization may change only Property status to active or inactive',
    'coldlion_status authorization may change only Licensor or Property status to active or inactive');
  execute v_def;
end
$patch$;

create or replace function plm.promote_coldlion_source_owned(
  p_expected jsonb,
  p_client_plan jsonb default null,
  p_is_drill boolean default false
)
returns table (
  sync_run_id uuid, mode text, source_rows integer, linked_rows integer,
  promotions integer, curated_name_changes integer, provenance_refreshes integer,
  unchanged_rows integer, quarantined_rows integer, protected_violations integer
)
language plpgsql
security definer
set search_path = pg_catalog, plm
as $$
declare
  v_run uuid;
  v_snapshot uuid;
  v_source integer := 0;
  v_linked integer := 0;
  v_changed integer := 0;
  v_unchanged integer := 0;
  v_quarantined integer := 0;
  r record;
  v_plan uuid;
  v_hash text;
  v_has_owner_ruling boolean := to_regclass('core.taxonomy_owner_ruling') is not null;
begin
  if not pg_try_advisory_xact_lock(720260729) then
    insert into ingest.sync_run(source_system,source_name,status,started_at,finished_at,error,metadata)
    values('coldlion','coldlion_licensors_properties_promote_source_owned','cancelled',now(),now(),
           'another ColdLion promotion already holds advisory lock 720260729; no work was attempted',
           jsonb_build_object('mode','skipped_already_running','outcome','skipped_already_running',
                              'advisory_lock_key',720260729,
                              'counts_toward_consecutive_failure_breaker',false))
    returning id into v_run;
    return query select v_run,'skipped_already_running'::text,0,0,0,0,0,0,0,0;
    return;
  end if;
  if p_is_drill then raise exception 'ColdLion status promotion does not accept drill writes'; end if;
  if plm.taxonomy_circuit_breaker_is_open('coldlion_licensor_property') then
    raise exception 'ColdLion status promotion refused: taxonomy circuit breaker is tripped';
  end if;
  if p_expected is null or jsonb_typeof(p_expected)<>'object'
     or lower(btrim(coalesce(p_expected->>'hash',''))) <> '1230f5a12d0f2a3029f1d3df17fc5b5f'
     or btrim(coalesce(p_expected->>'count','')) <> '542'
     or btrim(coalesce(p_expected->>'distinct_canonical','')) <> '271' then
    raise exception 'ColdLion status promotion refused: expected contract does not match the approved Phase 4 link set';
  end if;
  select id into v_snapshot from ingest.sync_run
   where source_name='coldlion_licensors_properties_api' and status='succeeded'
   order by started_at desc nulls last limit 1;
  if v_snapshot is null then raise exception 'no successful ColdLion mirror snapshot exists'; end if;

  insert into ingest.sync_run(source_system,source_name,status,started_at,metadata)
  values('coldlion','coldlion_licensors_properties_promote_source_owned','running',now(),
         jsonb_build_object('mode','coldlion_status','snapshot_run_id',v_snapshot,
                            'failure_recording','runner_out_of_band'))
  returning id into v_run;

  drop table if exists pg_temp.coldlion_status_decision;
  create temporary table coldlion_status_decision on commit drop as
  with arms as (
    select 'licensor'::text entity_type, licensor_id canonical_id, source_active
      from plm.erp_licensor where last_sync_run_id=v_snapshot and resolution_status='manually_matched' and licensor_id is not null
    union all
    select 'property', property_id, source_active
      from plm.erp_property where last_sync_run_id=v_snapshot and resolution_status='manually_matched' and property_id is not null
  )
  select entity_type, canonical_id,
         case when count(*) filter (where source_active is null)>0 or count(distinct source_active)<>1
              then null else bool_and(source_active) end source_active,
         count(*) arm_count,
         count(*) filter (where source_active is null)>0 or count(distinct source_active)<>1 as conflicting,
         exists(select 1 from core.taxonomy_source_ref sr
                where sr.entity_schema='core' and sr.entity_table=arms.entity_type
                  and sr.entity_id=arms.canonical_id
                  and sr.source_system not in ('coldlion','designflow_plm')) as higher_authority
    from arms group by entity_type, canonical_id;

  -- Owner rulings are a second, stronger authority when that governed table is
  -- present. Dynamic SQL keeps from-empty replay valid because the historical
  -- data migration that introduced the table is intentionally not replayable.
  if v_has_owner_ruling then
    execute $owner$
      update coldlion_status_decision d
         set higher_authority = true
       where exists (
         select 1 from core.taxonomy_owner_ruling o
          where o.entity_schema='core' and o.entity_table=d.entity_type
            and o.entity_id=d.canonical_id)
    $owner$;
  end if;

  select coalesce(sum(arm_count),0), count(*) into v_source, v_linked from coldlion_status_decision;
  select count(*) into v_quarantined from coldlion_status_decision where conflicting or higher_authority;

  for r in select * from coldlion_status_decision where not conflicting and not higher_authority order by entity_type, canonical_id loop
    if r.entity_type='licensor' then
      if (select status::text from core.licensor where id=r.canonical_id) = (case when r.source_active then 'active' else 'inactive' end) then
        v_unchanged := v_unchanged + 1; continue;
      end if;
      v_plan := gen_random_uuid();
      v_hash := encode(extensions.digest(r.entity_type||r.canonical_id::text||r.source_active::text,'sha256'),'hex');
      insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
      values(pg_backend_pid(),txid_current(),'core.licensor','coldlion_status',v_plan,v_hash,'plm.promote_coldlion_source_owned',array['status'],clock_timestamp()+interval '1 minute');
      update core.licensor set status=(case when r.source_active then 'active' else 'inactive' end)::app.entity_status where id=r.canonical_id;
    else
      if (select status::text from core.property where id=r.canonical_id) = (case when r.source_active then 'active' else 'inactive' end) then
        v_unchanged := v_unchanged + 1; continue;
      end if;
      v_plan := gen_random_uuid();
      v_hash := encode(extensions.digest(r.entity_type||r.canonical_id::text||r.source_active::text,'sha256'),'hex');
      insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
      values(pg_backend_pid(),txid_current(),'core.property','coldlion_status',v_plan,v_hash,'plm.promote_coldlion_source_owned',array['status'],clock_timestamp()+interval '1 minute');
      update core.property set status=(case when r.source_active then 'active' else 'inactive' end)::app.entity_status where id=r.canonical_id;
    end if;
    v_changed := v_changed + 1;
  end loop;

  update ingest.sync_run
     set status = 'succeeded', finished_at = now(),
         rows_seen = v_source, rows_updated = v_changed, rows_failed = 0,
         metadata = metadata || jsonb_build_object(
           'linked_rows',v_linked,'status_changes',v_changed,
           'unchanged_rows',v_unchanged,'quarantined_rows',v_quarantined)
   where id = v_run;

  return query select v_run, 'coldlion_status'::text, v_source, v_linked, v_changed,
    0, 0, v_unchanged, v_quarantined, 0;
end
$$;

create or replace function public.promote_coldlion_source_owned(
  p_expected jsonb,
  p_client_plan jsonb default null,
  p_is_drill boolean default false
)
returns table (
  sync_run_id uuid, mode text, source_rows integer, linked_rows integer,
  promotions integer, curated_name_changes integer, provenance_refreshes integer,
  unchanged_rows integer, quarantined_rows integer, protected_violations integer
)
language sql security definer set search_path=pg_catalog,public
as $$ select * from plm.promote_coldlion_source_owned(p_expected,p_client_plan,p_is_drill) $$;

revoke all on function plm.promote_coldlion_source_owned(jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
revoke all on function public.promote_coldlion_source_owned(jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.promote_coldlion_source_owned(jsonb,jsonb,boolean) to service_role;

comment on function plm.promote_coldlion_source_owned(jsonb,jsonb,boolean) is
  'Issue #1429 status-only ColdLion promotion. Applies unanimous current active flags only for approved typed identities. Conflicting division arms, null historical flags, unresolved identities, and rows with durable owner rulings abstain. Uses transaction-bound exact-column licensing authorizations; never changes names, codes, UUIDs, parents, metadata, or row counts. Successful cycles update their ingest.sync_run in-band. Failures propagate without a body-level handler: tools/promote-coldlion-source-owned.mjs owns durable separate-transaction failure evidence through record_taxonomy_sync_alert and buildFailedSyncRunSql.';
