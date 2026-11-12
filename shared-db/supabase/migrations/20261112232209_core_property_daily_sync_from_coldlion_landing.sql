-- Issue popcre/shared-db#6194: core.property is filled from live ColdLion every day.
--
-- Owner ruling, Albert Hazan, 2026-11-12 4:07 PM EST (verbatim): "yes. all 3 should be filled
-- from coldlion via the established path: coldlion to landing table, landing table to the table
-- used by the apps." And 4:16 PM EST (verbatim): "the long-term property list is settled and
-- it's what's in coldlion right now + a few changes i will ask Jamielynn to make tomorrow".
-- Recorded in docs/owner-rulings-part-4.md 6.37.
--
-- Path: ColdLion API -> coldlion.merch_group_detail (landing, coldlion-landing-sync.yml, daily)
-- -> core.property (this function, daily by pg_cron after the landing run).
--
-- Per ColdLion MG06 (Property) code, across divisions:
--   licensor = the core.licensor that already owns a core.property row with that code (exactly one),
--              else the MG05 parent the app list (dflow_prod."merchGroup") gives that code,
--              else the value is skipped and counted (never guessed).
--   row      = core.property (licensor, code); else the one code-less row under that licensor with
--              the same name ignoring case (it gets the code); else a new row.
--   name     = ColdLion's exact name; the previous name is kept in metadata.coldlion_sync.
--   status   = active when ColdLion has it active in any division, else inactive.
-- Rows that are not in ColdLion are never touched. Nothing is deleted. Every protected write goes
-- through the existing transaction-bound licensing write guard (no new write kind, no guard edit):
--   insert -> licensing_review_create (as potential), name/code -> scrape_consolidation,
--   status -> coldlion_status.

create table if not exists plm.coldlion_property_sync_run (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default clock_timestamp(),
  applied boolean not null,
  counts jsonb not null,
  skipped jsonb not null default '[]'::jsonb
);
comment on table plm.coldlion_property_sync_run is
  '#6194: one row per run of plm.sync_core_property_from_coldlion (counts of created, renamed, coded, status changes, skips).';
alter table plm.coldlion_property_sync_run enable row level security;
revoke all on plm.coldlion_property_sync_run from public, anon, authenticated;

create or replace function plm.sync_core_property_from_coldlion(p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $fn$
declare
  v_actor constant text := 'plm.sync_core_property_from_coldlion (#6194)';
  r record;
  v_id uuid; v_n integer;
  v_created integer := 0; v_coded integer := 0; v_renamed integer := 0; v_status integer := 0; v_seen integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_has_app boolean := to_regclass('dflow_prod."merchGroup"') is not null;
  v_counts jsonb;
  v_cur record;
begin
  if to_regclass('coldlion.merch_group_detail') is null then
    return jsonb_build_object('note','coldlion landing absent; nothing to do');
  end if;
  if (select count(*) from coldlion.merch_group_detail where mg_type_code = '06') = 0 then
    return jsonb_build_object('note','no ColdLion MG06 rows landed; nothing to do');
  end if;
  if (select count(*) from coldlion.merch_group_detail where mg_type_code = '06'
        and last_seen_at > now() - interval '3 days') = 0 then
    raise exception '#6194: ColdLion MG06 landing is older than 3 days; refusing to sync from a stale copy';
  end if;

  create temp table if not exists _cl_prop (
    code text primary key, name text, active boolean, licensor_id uuid, how text
  ) on commit drop;
  truncate _cl_prop;

  insert into _cl_prop(code, name, active)
  select mg_code, (array_agg(mg_desc order by (active = 'Y') desc, mod_time desc nulls last))[1], bool_or(active = 'Y')
    from coldlion.merch_group_detail
   where mg_type_code = '06' and nullif(btrim(mg_code), '') is not null and nullif(btrim(mg_desc), '') is not null
   group by mg_code;

  -- Licensor 1: the one licensor that already owns this code in core.property.
  update _cl_prop c set licensor_id = x.lid, how = 'existing_code'
    from (select code, min(licensor_id::text)::uuid lid from core.property where code is not null
           group by code having count(distinct licensor_id) = 1) x
   where x.code = c.code;

  -- Licensor 2: the MG05 parent the app list gives this MG06 code (production only).
  if v_has_app then
    -- static SQL: plpgsql plans it only when this branch runs, so it is safe where dflow_prod is absent.
      update _cl_prop c set licensor_id = l.id, how = 'app_parent'
        from (select m.mg_code c, min(p.mg_code) lic
                from dflow_prod."merchGroup" m join dflow_prod."merchGroup" p on p.mg_id = m.parent_id
               where m."mgTypeCode" = '06' group by m.mg_code having count(distinct p.mg_code) = 1) a
        join core.licensor l on l.code = a.lic
       where a.c = c.code and c.licensor_id is null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'active', active) order by code), '[]'::jsonb)
    into v_skipped from _cl_prop where licensor_id is null;

  for r in select * from _cl_prop where licensor_id is not null order by code loop
    v_seen := v_seen + 1;
    v_id := null;
    select id into v_id from core.property where licensor_id = r.licensor_id and code = r.code;
    if v_id is null then
      select count(*), min(id::text)::uuid into v_n, v_id from core.property
       where licensor_id = r.licensor_id and code is null and lower(name) = lower(r.name);
      if v_n <> 1 then v_id := null; end if;
      if v_id is not null then
        v_coded := v_coded + 1;
        if p_apply then
          insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
          values (pg_backend_pid(), txid_current(), 'core.property', 'scrape_consolidation', gen_random_uuid(),
            encode(extensions.digest('6194/code/'||r.code,'sha256'),'hex'), v_actor,
            case when (select name from core.property where id = v_id) = r.name then array['code'] else array['name','code'] end,
            clock_timestamp() + interval '1 minute');
          update core.property
             set code = r.code, name = r.name, updated_at = now(),
                 metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('coldlion_sync', jsonb_build_object(
                   'issue', 6194, 'coded_at', now(), 'previous_name', name))
           where id = v_id;
        end if;
      end if;
    end if;

    if v_id is null then
      v_created := v_created + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create', gen_random_uuid(),
          encode(extensions.digest('6194/create/'||r.code,'sha256'),'hex'), v_actor,
          array['licensor_id','name','code','status'], clock_timestamp() + interval '1 minute');
        insert into core.property(licensor_id, name, code, status, metadata)
        values (r.licensor_id, r.name, r.code, 'potential',
                jsonb_build_object('coldlion_sync', jsonb_build_object('issue', 6194, 'created_at', now(), 'licensor_from', r.how)))
        returning id into v_id;
      end if;
    end if;

    if not p_apply and v_id is null then continue; end if;

    select name, status::text st into v_cur from core.property where id = v_id;
    if v_cur.name is distinct from r.name and not (not p_apply and v_coded > 0 and (select code from core.property where id = v_id) is null) then
      v_renamed := v_renamed + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.property', 'scrape_consolidation', gen_random_uuid(),
          encode(extensions.digest('6194/name/'||r.code,'sha256'),'hex'), v_actor, array['name'], clock_timestamp() + interval '1 minute');
        update core.property
           set name = r.name, updated_at = now(),
               metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('coldlion_sync',
                 coalesce(metadata->'coldlion_sync','{}'::jsonb) || jsonb_build_object('issue', 6194, 'renamed_at', now(), 'previous_name', name))
         where id = v_id;
      end if;
    end if;
    if v_cur.st is distinct from (case when r.active then 'active' else 'inactive' end) then
      v_status := v_status + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.property', 'coldlion_status', gen_random_uuid(),
          encode(extensions.digest('6194/status/'||r.code,'sha256'),'hex'), v_actor, array['status'], clock_timestamp() + interval '1 minute');
        update core.property set status = case when r.active then 'active' else 'inactive' end::app.entity_status, updated_at = now()
         where id = v_id;
      end if;
    end if;
  end loop;

  v_counts := jsonb_build_object('coldlion_values', (select count(*) from _cl_prop), 'placed', v_seen,
    'created', v_created, 'coded', v_coded, 'renamed', v_renamed, 'status_changed', v_status,
    'skipped_no_licensor', jsonb_array_length(v_skipped));
  insert into plm.coldlion_property_sync_run(applied, counts, skipped) values (p_apply, v_counts, v_skipped);
  return v_counts || jsonb_build_object('applied', p_apply);
end;
$fn$;

comment on function plm.sync_core_property_from_coldlion(boolean) is
  '#6194: fill core.property from the ColdLion landing (MG06). p_apply=false reports only. Never deletes; rows not in ColdLion untouched.';
revoke all on function plm.sync_core_property_from_coldlion(boolean) from public, anon, authenticated;

-- Daily at 15:30 UTC (10:30 AM EST / 11:30 AM EDT), after the 13:xx UTC production landing run.
do $sched$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'coldlion-core-property-sync';
    perform cron.schedule('coldlion-core-property-sync', '30 15 * * *',
      $cron$ select plm.sync_core_property_from_coldlion(true) $cron$);
  end if;
end;
$sched$;

-- First fill now (no-op where the landing is absent, as in CI); the daily job keeps it current.
do $first$
begin
  if exists (select 1 from coldlion.merch_group_detail where mg_type_code = '06' and last_seen_at > now() - interval '3 days') then
    raise notice '#6194 first fill: %', plm.sync_core_property_from_coldlion(true);
  else
    raise notice '#6194: no fresh ColdLion MG06 landing here (preview/CI); first fill waits for the daily job';
  end if;
end;
$first$;
