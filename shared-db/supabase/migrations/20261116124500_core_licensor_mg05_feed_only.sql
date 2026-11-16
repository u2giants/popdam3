-- Issue popcre/shared-db#6440: core.licensor is the ColdLion MG05 list and nothing else.
-- derived-from: none
--
-- Owner ruling (Albert Hazan, 2026-11-15 8:49 PM EST, exact words): "delete \"our own system's
-- licensor list\" so no future session can use it. the only thing to be using is the canonical
-- MG05 list we build from what comes in on the API".
--
-- core.licensor stays as the stable id table (about 40 foreign keys point at it), but:
--   * its only writer is plm.sync_core_licensor_from_coldlion, fed by the ColdLion MG05 list
--     (API landing coldlion.merch_group_detail, plus the DesignFlow copy dflow_prod."merchGroup"
--     for divisions CW001/SP001 when present);
--   * one row per MG05 code; rows outside MG05 are retired recoverably (status inactive, the
--     previous status and code kept in metadata.mg05_retired); nothing is ever deleted;
--   * every other insert, update, delete or truncate is refused by a trigger.
-- Supersedes the never-promoted 20261115031325 (same function, without retirement or guard).
-- plm.sync_core_property_from_coldlion already resolves an MG06 value through its MG05 parent;
-- it is unchanged. No MG06 value is ever created.

-- 1. The guard: only the MG05 feed may write core.licensor.
create or replace function app.guard_core_licensor_mg05_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $fn$
begin
  if coalesce(current_setting('app.core_licensor_writer', true), '') = 'mg05_feed' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE'
     and new.code is not distinct from old.code
     and new.name is not distinct from old.name
     and new.status is not distinct from old.status then
    return new;  -- nickname/metadata-only touch-ups keep working
  end if;
  raise exception 'core.licensor is the ColdLion MG05 list (issue #6440, owner ruling 2026-11-15): % refused. Licensors change only in ColdLion; plm.sync_core_licensor_from_coldlion copies them nightly.', tg_op
    using errcode = '42501';
end;
$fn$;
revoke all on function app.guard_core_licensor_mg05_only() from public, anon, authenticated;

-- Named to sort (and so fire) before licensor_licensing_write_guard.
drop trigger if exists licensor_00_mg05_only_guard on core.licensor;
create trigger licensor_00_mg05_only_guard
  before insert or update or delete on core.licensor
  for each row execute function app.guard_core_licensor_mg05_only();

drop trigger if exists licensor_00_mg05_only_truncate_guard on core.licensor;
create trigger licensor_00_mg05_only_truncate_guard
  before truncate on core.licensor
  for each statement execute function app.guard_core_licensor_mg05_only();

comment on table core.licensor is
  'The ColdLion MG05 (Licensor) list, copied nightly by plm.sync_core_licensor_from_coldlion (#6440). Never hand-maintained: rows outside MG05 are set inactive, other writes are refused.';

-- 2. The feed.
create or replace function plm.sync_core_licensor_from_coldlion(p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $fn$
declare
  v_actor constant text := 'plm.sync_core_licensor_from_coldlion (#6440)';
  r record; v_id uuid; v_n integer; v_cur record; v_want text;
  v_created integer := 0; v_coded integer := 0; v_renamed integer := 0; v_status integer := 0; v_retired integer := 0;
  v_counts jsonb;
begin
  if to_regclass('coldlion.merch_group_detail') is null
     or not exists (select 1 from coldlion.merch_group_detail where mg_type_code = '05'
                     and last_seen_at > now() - interval '3 days') then
    return jsonb_build_object('note', 'no fresh ColdLion MG05 landing; nothing to do');
  end if;

  perform set_config('app.core_licensor_writer', 'mg05_feed', true);

  create temp table if not exists _mg05 (c text primary key, n text, act boolean) on commit drop;
  truncate _mg05;
  insert into _mg05(c, n, act)
  select mg_code, (array_agg(mg_desc order by (active = 'Y') desc, mod_time desc nulls last))[1], bool_or(active = 'Y')
    from coldlion.merch_group_detail
   where mg_type_code = '05' and nullif(btrim(mg_code), '') is not null and nullif(btrim(mg_desc), '') is not null
   group by mg_code;
  if exists (select 1 from pg_attribute where attrelid = to_regclass('dflow_prod."merchGroup"')
              and attname = 'divisionCode_fk' and not attisdropped) then
    insert into _mg05(c, n, act)
    select mg_code, (array_agg(mg_desc order by is_active desc nulls last, "modTime" desc nulls last))[1], bool_or(coalesce(is_active, false))
      from dflow_prod."merchGroup"
     where "mgTypeCode" = '05' and "divisionCode_fk" in ('CW001', 'SP001')
       and nullif(btrim(mg_code), '') is not null and nullif(btrim(mg_desc), '') is not null
     group by mg_code
    on conflict (c) do update set act = _mg05.act or excluded.act;
  end if;

  for r in select * from _mg05 order by c loop
    v_want := case when r.act then 'active' else 'inactive' end;
    v_id := null;
    select id into v_id from core.licensor where code = r.c;

    if v_id is null then
      -- A row outside MG05 (no code, or a code MG05 does not have) whose name is this MG05 name
      -- takes the code, so everything already pointing at it keeps working.
      select count(*), min(id::text)::uuid into v_n, v_id from core.licensor l
       where (l.code is null or not exists (select 1 from _mg05 m where m.c = l.code))
         and upper(regexp_replace(l.name, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(r.n, '[^A-Za-z0-9]', '', 'g'));
      if v_n <> 1 then v_id := null; end if;
      if v_id is not null then
        v_coded := v_coded + 1;
        if p_apply then
          insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
          values (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation', gen_random_uuid(),
            encode(extensions.digest('6440/licensor/code/'||r.c,'sha256'),'hex'), v_actor,
            case when (select name from core.licensor where id = v_id) = r.n then array['code'] else array['name','code'] end,
            clock_timestamp() + interval '1 minute');
          update core.licensor
             set code = r.c, name = r.n,
                 metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('coldlion_sync',
                   jsonb_build_object('issue', 6440, 'coded_at', now(), 'previous_name', name, 'previous_code', code))
           where id = v_id;
        end if;
      end if;
    end if;

    if v_id is null then
      v_created := v_created + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation', gen_random_uuid(),
          encode(extensions.digest('6440/licensor/create/'||r.c,'sha256'),'hex'), v_actor,
          array['name','code','status'], clock_timestamp() + interval '1 minute');
        insert into core.licensor(name, code, status, metadata)
        values (r.n, r.c, v_want::app.entity_status,
                jsonb_build_object('coldlion_sync', jsonb_build_object('issue', 6440, 'created_at', now())));
      end if;
      continue;
    end if;
    if not p_apply and (select code from core.licensor where id = v_id) is distinct from r.c then continue; end if;

    select name, status::text st into v_cur from core.licensor where id = v_id;
    if v_cur.name is distinct from r.n then
      v_renamed := v_renamed + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.licensor', 'scrape_consolidation', gen_random_uuid(),
          encode(extensions.digest('6440/licensor/name/'||r.c,'sha256'),'hex'), v_actor, array['name'], clock_timestamp() + interval '1 minute');
        update core.licensor
           set name = r.n,
               metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('coldlion_sync',
                 coalesce(metadata->'coldlion_sync','{}'::jsonb) || jsonb_build_object('issue', 6440, 'renamed_at', now(), 'previous_name', name))
         where id = v_id;
      end if;
    end if;
    if v_cur.st is distinct from v_want then
      v_status := v_status + 1;
      if p_apply then
        insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
        values (pg_backend_pid(), txid_current(), 'core.licensor', 'coldlion_status', gen_random_uuid(),
          encode(extensions.digest('6440/licensor/status/'||r.c,'sha256'),'hex'), v_actor, array['status'], clock_timestamp() + interval '1 minute');
        update core.licensor set status = v_want::app.entity_status where id = v_id;
      end if;
    end if;
  end loop;

  -- Retire, recoverably, every row MG05 does not have. Never deleted; references keep working.
  for r in
    select id, code, status::text st from core.licensor l
     where l.status::text <> 'inactive'
       and (l.code is null or not exists (select 1 from _mg05 m where m.c = l.code))
  loop
    v_retired := v_retired + 1;
    if p_apply then
      insert into plm.licensing_write_authorization(backend_pid,transaction_id,target_table,write_kind,plan_id,plan_hash,actor,protected_columns,expires_at)
      values (pg_backend_pid(), txid_current(), 'core.licensor', 'coldlion_status', gen_random_uuid(),
        encode(extensions.digest('6440/licensor/retire/'||r.id::text,'sha256'),'hex'), v_actor, array['status'], clock_timestamp() + interval '1 minute');
      update core.licensor
         set status = 'inactive',
             metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('mg05_retired',
               jsonb_build_object('issue', 6440, 'retired_at', now(), 'previous_status', r.st, 'code', r.code))
       where id = r.id;
    end if;
  end loop;

  v_counts := jsonb_build_object('entity', 'licensor', 'mg05_codes', (select count(*) from _mg05),
    'created', v_created, 'coded', v_coded, 'renamed', v_renamed, 'status_changed', v_status, 'retired', v_retired);
  insert into plm.coldlion_property_sync_run(applied, counts) values (p_apply, v_counts);
  return v_counts || jsonb_build_object('applied', p_apply);
end;
$fn$;

comment on function plm.sync_core_licensor_from_coldlion(boolean) is
  '#6440: the only writer of core.licensor. One row per ColdLion MG05 code; rows outside MG05 set inactive (recoverable). p_apply=false reports only. Never deletes.';
revoke all on function plm.sync_core_licensor_from_coldlion(boolean) from public, anon, authenticated;

-- 3. Licensors first, then Properties, in one daily job.
do $sched$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'coldlion-core-property-sync';
    perform cron.schedule('coldlion-core-property-sync', '30 15 * * *',
      $cron$ select plm.sync_core_licensor_from_coldlion(true); select plm.sync_core_property_from_coldlion(true) $cron$);
  end if;
end;
$sched$;

-- 4. First fill now where the landing is fresh (production); a no-op in preview/CI.
do $first$
begin
  if exists (select 1 from coldlion.merch_group_detail where mg_type_code = '05' and last_seen_at > now() - interval '3 days') then
    raise notice '#6440 licensors: %', plm.sync_core_licensor_from_coldlion(true);
    if exists (select 1 from coldlion.merch_group_detail where mg_type_code = '06' and last_seen_at > now() - interval '3 days') then
      raise notice '#6440 properties: %', plm.sync_core_property_from_coldlion(true);
    end if;
  else
    raise notice '#6440: no fresh ColdLion landing here (preview/CI); fill waits for the daily job';
  end if;
end;
$first$;
