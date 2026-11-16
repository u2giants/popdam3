-- Issue popcre/shared-db#6463: ColdLion merchandise groups are division-specific.
-- derived-from: 20261116124500
--
-- Owner ruling (Albert Hazan, 2026-11-16 7:44 AM EST, exact words): "art themes like Abstract and
-- Animal are the MG05 values for division EH001. MG groups are specific to divisions."
--
-- MG05 means Licensor and MG06 means Property only in the licensed divisions CW001 and SP001.
-- * plm.sync_core_licensor_from_coldlion reads MG05 only from CW001/SP001. Its existing recoverable
--   retirement sets the EH001 art themes made licensors by 20261116124500 (DF, RB) inactive,
--   keeping their previous status in metadata.mg05_retired. Nothing is deleted.
-- * plm.sync_core_property_from_coldlion reads MG06 only from CW001/SP001 and resolves each value's
--   MG05 parent within its own division. No MG06 value is created; no property is inactivated.
-- (Property body derived from 20261112232209; only the division filters change.)

create or replace function plm.sync_core_licensor_from_coldlion(p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $fn$
declare
  v_actor constant text := 'plm.sync_core_licensor_from_coldlion (#6440, #6463)';
  r record; v_id uuid; v_n integer; v_cur record; v_want text;
  v_created integer := 0; v_coded integer := 0; v_renamed integer := 0; v_status integer := 0; v_retired integer := 0;
  v_counts jsonb;
begin
  if to_regclass('coldlion.merch_group_detail') is null
     or not exists (select 1 from coldlion.merch_group_detail where mg_type_code = '05' and division_code in ('CW001', 'SP001')
                     and last_seen_at > now() - interval '3 days') then
    return jsonb_build_object('note', 'no fresh ColdLion MG05 landing; nothing to do');
  end if;

  perform set_config('app.core_licensor_writer', 'mg05_feed', true);

  create temp table if not exists _mg05 (c text primary key, n text, act boolean) on commit drop;
  truncate _mg05;
  insert into _mg05(c, n, act)
  select mg_code, (array_agg(mg_desc order by (active = 'Y') desc, mod_time desc nulls last))[1], bool_or(active = 'Y')
    from coldlion.merch_group_detail
   where mg_type_code = '05' and division_code in ('CW001', 'SP001')
     and nullif(btrim(mg_code), '') is not null and nullif(btrim(mg_desc), '') is not null
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
revoke all on function plm.sync_core_licensor_from_coldlion(boolean) from public, anon, authenticated;

create or replace function plm.sync_core_property_from_coldlion(p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $fn$
declare
  v_actor constant text := 'plm.sync_core_property_from_coldlion (#6194, #6463)';
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
   where mg_type_code = '06' and division_code in ('CW001', 'SP001')
     and nullif(btrim(mg_code), '') is not null and nullif(btrim(mg_desc), '') is not null
   group by mg_code;

  -- Licensor 1: the one licensor that already owns this code in core.property.
  update _cl_prop c set licensor_id = x.lid, how = 'existing_code'
    from (select code, min(licensor_id::text)::uuid lid from core.property where code is not null
           group by code having count(distinct licensor_id) = 1) x
   where x.code = c.code;

  -- Licensor 2: the MG05 parent the app list gives this MG06 code (production only).
  if v_has_app and exists (select 1 from pg_attribute where attrelid = to_regclass('dflow_prod."merchGroup"')
                            and attname = 'divisionCode_fk' and not attisdropped) then
    -- MG groups are division-specific: the parent is read within the child's own licensed division.
      update _cl_prop c set licensor_id = l.id, how = 'app_parent'
        from (select m.mg_code c, min(p.mg_code) lic
                from dflow_prod."merchGroup" m join dflow_prod."merchGroup" p on p.mg_id = m.parent_id
               where m."mgTypeCode" = '06' and p."mgTypeCode" = '05'
                 and coalesce(m."divisionCode_fk", 'CW001') in ('CW001', 'SP001')
                 and p."divisionCode_fk" is not distinct from m."divisionCode_fk"
               group by m.mg_code having count(distinct p.mg_code) = 1) a
        join core.licensor l on l.code = a.lic
       where a.c = c.code and c.licensor_id is null;
  elsif v_has_app then
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
revoke all on function plm.sync_core_property_from_coldlion(boolean) from public, anon, authenticated;

-- Apply now where the landing is fresh (production); a no-op in preview/CI.
do $first$
begin
  if exists (select 1 from coldlion.merch_group_detail where mg_type_code = '05' and division_code in ('CW001','SP001')
              and last_seen_at > now() - interval '3 days') then
    raise notice '#6463 licensors: %', plm.sync_core_licensor_from_coldlion(true);
    if exists (select 1 from coldlion.merch_group_detail where mg_type_code = '06' and division_code in ('CW001','SP001')
                and last_seen_at > now() - interval '3 days') then
      raise notice '#6463 properties: %', plm.sync_core_property_from_coldlion(true);
    end if;
  else
    raise notice '#6463: no fresh ColdLion landing here (preview/CI)';
  end if;
end;
$first$;
