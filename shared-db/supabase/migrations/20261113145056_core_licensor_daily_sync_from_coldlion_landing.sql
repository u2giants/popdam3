-- Issue popcre/shared-db#6194: core.licensor is filled from live ColdLion every day, ahead of
-- core.property, so every ColdLion Property has its ColdLion Licensor.
--
-- Owner ruling 6.37 (Albert Hazan, 2026-11-12): the long-term list is what ColdLion has.
-- 2026-11-13 9:50 AM EST, Albert (verbatim): "that's not true. are you looking in the wrong place?
-- the coldlion API feed has these. check it live" -- about 17 ColdLion Property values left out
-- because their ColdLion Licensors (FORD - DESPERATE, PAUL FRANK, STEAL A BRAINROT, ...) were
-- never brought into core.licensor.
--
-- Per ColdLion MG05 (Licensor) code, across divisions:
--   row    = core.licensor with that code; else the one code-less row whose name matches ignoring
--            case and punctuation (it gets the code); else a new row.
--   name   = ColdLion's exact name (previous name kept in metadata.coldlion_sync).
--   status = active when ColdLion has it active in any division, else inactive.
-- Rows not in ColdLion are untouched. Nothing is deleted. Writes go through the existing
-- licensing write guard: insert/name/code -> scrape_consolidation, status -> coldlion_status.

create or replace function plm.sync_core_licensor_from_coldlion(p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $fn$
declare
  v_actor constant text := 'plm.sync_core_licensor_from_coldlion (#6194)';
  r record; v_id uuid; v_n integer; v_cur record; v_want text;
  v_created integer := 0; v_coded integer := 0; v_renamed integer := 0; v_status integer := 0;
  v_counts jsonb;
begin
  if to_regclass('coldlion.merch_group_detail') is null
     or not exists (select 1 from coldlion.merch_group_detail where mg_type_code = '05'
                     and last_seen_at > now() - interval '3 days') then
    return jsonb_build_object('note', 'no fresh ColdLion MG05 landing; nothing to do');
  end if;

  for r in
    select mg_code c,
           (array_agg(mg_desc order by (active = 'Y') desc, mod_time desc nulls last))[1] n,
           bool_or(active = 'Y') act
      from coldlion.merch_group_detail
     where mg_type_code = '05' and nullif(btrim(mg_code), '') is not null and nullif(btrim(mg_desc), '') is not null
     group by mg_code order by mg_code
  loop
    v_want := case when r.act then 'active' else 'inactive' end;
    v_id := null;
    select id into v_id from core.licensor where code = r.c;

    if v_id is null then
      select count(*), min(id::text)::uuid into v_n, v_id from core.licensor
       where code is null
         and upper(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(r.n, '[^A-Za-z0-9]', '', 'g'));
      if v_n <> 1 then v_id := null; end if;
      if v_id is not null then
        v_coded := v_coded + 1;
        if p_apply then
          select name into v_cur from core.licensor where id = v_id;
          insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
          values (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation', gen_random_uuid(),
            encode(extensions.digest('6194/licensor/code/'||r.c,'sha256'),'hex'), v_actor,
            case when v_cur.name = r.n then array['code'] else array['name','code'] end, clock_timestamp() + interval '1 minute');
          update core.licensor
             set code = r.c, name = r.n,
                 metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('coldlion_sync',
                   jsonb_build_object('issue', 6194, 'coded_at', now(), 'previous_name', name))
           where id = v_id;
        end if;
      end if;
    end if;

    if v_id is null then
      v_created := v_created + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation', gen_random_uuid(),
          encode(extensions.digest('6194/licensor/create/'||r.c,'sha256'),'hex'), v_actor,
          array['name','code','status'], clock_timestamp() + interval '1 minute');
        insert into core.licensor(name, code, status, metadata)
        values (r.n, r.c, v_want::app.entity_status,
                jsonb_build_object('coldlion_sync', jsonb_build_object('issue', 6194, 'created_at', now())));
      end if;
      continue;
    end if;
    if not p_apply and v_coded > 0 and (select code from core.licensor where id = v_id) is null then continue; end if;

    select name, status::text st into v_cur from core.licensor where id = v_id;
    if v_cur.name is distinct from r.n then
      v_renamed := v_renamed + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation', gen_random_uuid(),
          encode(extensions.digest('6194/licensor/name/'||r.c,'sha256'),'hex'), v_actor, array['name'], clock_timestamp() + interval '1 minute');
        update core.licensor
           set name = r.n,
               metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('coldlion_sync',
                 coalesce(metadata->'coldlion_sync','{}'::jsonb) || jsonb_build_object('issue', 6194, 'renamed_at', now(), 'previous_name', name))
         where id = v_id;
      end if;
    end if;
    if v_cur.st is distinct from v_want then
      v_status := v_status + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.licensor', 'coldlion_status', gen_random_uuid(),
          encode(extensions.digest('6194/licensor/status/'||r.c,'sha256'),'hex'), v_actor, array['status'], clock_timestamp() + interval '1 minute');
        update core.licensor set status = v_want::app.entity_status where id = v_id;
      end if;
    end if;
  end loop;

  v_counts := jsonb_build_object('entity', 'licensor', 'created', v_created, 'coded', v_coded,
    'renamed', v_renamed, 'status_changed', v_status);
  insert into plm.coldlion_property_sync_run(applied, counts) values (p_apply, v_counts);
  return v_counts || jsonb_build_object('applied', p_apply);
end;
$fn$;

comment on function plm.sync_core_licensor_from_coldlion(boolean) is
  '#6194: fill core.licensor from the ColdLion landing (MG05). p_apply=false reports only. Never deletes; rows not in ColdLion untouched.';
revoke all on function plm.sync_core_licensor_from_coldlion(boolean) from public, anon, authenticated;

-- Licensors first, then Properties, in one daily job.
do $sched$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'coldlion-core-property-sync';
    perform cron.schedule('coldlion-core-property-sync', '30 15 * * *',
      $cron$ select plm.sync_core_licensor_from_coldlion(true); select plm.sync_core_property_from_coldlion(true) $cron$);
  end if;
end;
$sched$;

do $first$
begin
  if exists (select 1 from coldlion.merch_group_detail where mg_type_code = '06' and last_seen_at > now() - interval '3 days') then
    raise notice '#6194 licensors: %', plm.sync_core_licensor_from_coldlion(true);
    raise notice '#6194 properties: %', plm.sync_core_property_from_coldlion(true);
  else
    raise notice '#6194: no fresh ColdLion landing here (preview/CI); fill waits for the daily job';
  end if;
end;
$first$;
