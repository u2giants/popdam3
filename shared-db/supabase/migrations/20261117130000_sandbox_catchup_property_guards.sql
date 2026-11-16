-- Sandbox catch-up batch 11 (#6356): DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- 1. Replays the remaining structure of production's 20261113183820 on core.property (pair check, link
--    uniqueness, no submission_canonical metadata). Sandbox pre-check 2026-11-16: 0 linked rows, 0 rows with
--    metadata.submission_canonical, so every row already satisfies them. The one-off data back-fill is not ported.
-- 2. Copies production's Coldlion licensor/property sync functions, the MG05-only licensor guard, and two changed function bodies, with production's exact EXECUTE grants.
-- 3. Copies production's relationship-lock, sync-alert and DCP-OPA crosswalk triggers (functions already present).
-- Not here: policies and api.oracle_user_directory() (they need production-only runtime roles), temp_status_watch triggers, crm/character_alias/
-- taxonomy_source_ref (open claims), sku_sg triggers (public schema awaits the owner's call).
-- Sandbox adaptation: the Coldlion sync functions read production's dflow_prod."merchGroup"; the sandbox's copy of that
-- DesignFlow table is dflow."merchGroup", so those references point there.
-- derived-from: none
-- maintains-eol-dependency: function api.db_data_admin_licensor_property_tree

set check_function_bodies = off;

alter table core.property
  add constraint property_submission_link_pair_ck check (
    (submission_source is null) = (submission_property_id is null)
    and (submission_source is null or submission_source in ('disney_opa', 'paramount_trackerplus'))
    and (submission_source is not null or submission_property_name is null));

create unique index if not exists property_submission_link_uq
  on core.property (submission_source, submission_property_id)
  where submission_source is not null;

alter table core.property
  add constraint property_no_submission_canonical_ck
  check (not coalesce(metadata ? 'submission_canonical', false));

CREATE OR REPLACE FUNCTION app.guard_core_licensor_mg05_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION plm.alert_coldlion_property_skips(p_run_id bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'plm'
AS $function$
declare
  v_run plm.coldlion_property_sync_run;
  v_codes jsonb;
  v_id uuid;
begin
  select * into v_run from plm.coldlion_property_sync_run where id = p_run_id;
  if v_run.id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(code order by code), '[]'::jsonb)
    into v_codes
    from (select distinct s->>'code' as code
            from jsonb_array_elements(case when jsonb_typeof(v_run.skipped) = 'array'
                                           then v_run.skipped else '[]'::jsonb end) s
           where jsonb_typeof(s) = 'object'
             and s->'active' in ('true'::jsonb, '"true"'::jsonb, '"Y"'::jsonb)
             and nullif(s->>'code', '') is not null) d;

  if jsonb_array_length(v_codes) = 0 then
    return null;
  end if;

  if exists (select 1 from plm.taxonomy_sync_alert a
              where a.source_name = 'coldlion_core_property_sync'
                and a.acknowledged_at is null
                and a.payload->'codes' = v_codes) then
    return null;
  end if;

  insert into plm.taxonomy_sync_alert(severity, source_name, reason, payload)
  values ('warning', 'coldlion_core_property_sync',
          'unresolved_licensor: ' || jsonb_array_length(v_codes)
            || ' active ColdLion MG06 value(s) skipped because no licensor owns the code and the app list gives no MG05 parent: '
            || (select string_agg(c, ', ' order by c) from jsonb_array_elements_text(v_codes) c),
          jsonb_build_object('codes', v_codes, 'reason', 'unresolved_licensor',
                             'sync_run_id', v_run.id, 'applied', v_run.applied,
                             'human_response_owner', 'Albert Hazan',
                             'first_response', 'Match each code to its licensor in ColdLion (MG05 parent) or core.property; never guess.'))
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION plm.sync_core_licensor_from_coldlion(p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
  if exists (select 1 from pg_attribute where attrelid = to_regclass('dflow."merchGroup"')
              and attname = 'divisionCode_fk' and not attisdropped) then
    insert into _mg05(c, n, act)
    select mg_code, (array_agg(mg_desc order by is_active desc nulls last, "modTime" desc nulls last))[1], bool_or(coalesce(is_active, false))
      from dflow."merchGroup"
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
$function$
;

CREATE OR REPLACE FUNCTION plm.sync_core_property_from_coldlion(p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_actor constant text := 'plm.sync_core_property_from_coldlion (#6194, #6463)';
  r record;
  v_id uuid; v_n integer;
  v_created integer := 0; v_coded integer := 0; v_renamed integer := 0; v_status integer := 0; v_seen integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_has_app boolean := to_regclass('dflow."merchGroup"') is not null;
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
  if v_has_app and exists (select 1 from pg_attribute where attrelid = to_regclass('dflow."merchGroup"')
                            and attname = 'divisionCode_fk' and not attisdropped) then
    -- MG groups are division-specific: the parent is read within the child's own licensed division.
      update _cl_prop c set licensor_id = l.id, how = 'app_parent'
        from (select m.mg_code c, min(p.mg_code) lic
                from dflow."merchGroup" m join dflow."merchGroup" p on p.mg_id = m.parent_id
               where m."mgTypeCode" = '06' and p."mgTypeCode" = '05'
                 and coalesce(m."divisionCode_fk", 'CW001') in ('CW001', 'SP001')
                 and p."divisionCode_fk" is not distinct from m."divisionCode_fk"
               group by m.mg_code having count(distinct p.mg_code) = 1) a
        join core.licensor l on l.code = a.lic
       where a.c = c.code and c.licensor_id is null;
  elsif v_has_app then
    -- static SQL: plpgsql plans it only when this branch runs, so it is safe where dflow is absent.
      update _cl_prop c set licensor_id = l.id, how = 'app_parent'
        from (select m.mg_code c, min(p.mg_code) lic
                from dflow."merchGroup" m join dflow."merchGroup" p on p.mg_id = m.parent_id
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
$function$
;

CREATE OR REPLACE FUNCTION api.db_data_admin_licensor_property_tree(p_search text DEFAULT NULL::text, p_include_inactive boolean DEFAULT false, p_cursor text DEFAULT NULL::text, p_page_size integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public'
AS $function$
declare
  v_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_cursor_value text;
  v_cursor_id uuid;
  v_snapshot_at timestamptz := clock_timestamp();
  v_total_licensors integer;
  v_active_licensors integer;
  v_total_properties integer;
  v_properties_with_licensor integer;
  v_orphan_count integer;
  v_orphans jsonb;
  v_licensors jsonb;
  v_fetched integer;
  v_last_sort text;
  v_last_id uuid;
  v_next_cursor text;
begin
  perform app.require_licensing_manager_access();
  if p_cursor is not null then
    begin
      v_cursor_value := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'v';
      v_cursor_id := (convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb ->> 'id')::uuid;
    exception when others then
      raise exception 'db_data_admin: invalid cursor' using errcode = 'invalid_parameter_value';
    end;
    if v_cursor_value is null or v_cursor_id is null then
      raise exception 'db_data_admin: invalid cursor' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  select count(*)::integer,
         count(*) filter (where l.status <> 'inactive')::integer
    into v_total_licensors, v_active_licensors
  from core.licensor l;
  select count(*)::integer,
         count(*) filter (where l.id is not null)::integer,
         count(*) filter (where l.id is null)::integer
    into v_total_properties, v_properties_with_licensor, v_orphan_count
  from core.property p left join core.licensor l on l.id = p.licensor_id;

  with association_counts as (
    select a.property_id, count(*)::integer as character_count
    from core.property_character_associations a where a.is_current group by a.property_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id::text, 'name', p.name, 'code', p.code, 'status', p.status,
    'licensor_id', p.licensor_id::text,
    'character_count', coalesce(ac.character_count, 0),
    'source_refs', '[]'::jsonb, 'plm_context', '[]'::jsonb,
    'updated_at', p.updated_at
  ) order by lower(btrim(p.name)) collate "C", p.id), '[]'::jsonb)
  into v_orphans
  from core.property p
  left join core.licensor l on l.id = p.licensor_id
  left join association_counts ac on ac.property_id = p.id
  where l.id is null;

  with association_counts as (
    select a.property_id, count(*)::integer as character_count
    from core.property_character_associations a where a.is_current group by a.property_id
  ), licensor_rows as (
    select l.id, l.name, l.code, l.status,
      lower(btrim(l.name)) collate "C" as sort_value,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id::text, 'name', p.name, 'code', p.code, 'status', p.status,
        'licensor_id', p.licensor_id::text,
        'character_count', coalesce(ac.character_count, 0),
        'source_refs', '[]'::jsonb, 'plm_context', '[]'::jsonb,
        'updated_at', p.updated_at
      ) order by lower(btrim(p.name)) collate "C", p.id)
      filter (where p.id is not null), '[]'::jsonb) as properties
    from core.licensor l
    left join core.property p on p.licensor_id = l.id and (
      p_search is null or l.name ilike '%' || p_search || '%' or p.name ilike '%' || p_search || '%'
    )
    left join association_counts ac on ac.property_id = p.id
    where (p_include_inactive or l.status <> 'inactive') and (
      p_search is null or l.name ilike '%' || p_search || '%'
      or exists (select 1 from core.property sp where sp.licensor_id = l.id and sp.name ilike '%' || p_search || '%')
    )
    group by l.id, l.name, l.code, l.status
  ), ordered as (
    select lr.* from licensor_rows lr
    where p_cursor is null or (lr.sort_value, lr.id) > (v_cursor_value collate "C", v_cursor_id)
    order by lr.sort_value, lr.id limit v_page_size + 1
  ), numbered as (
    select o.*, row_number() over (order by o.sort_value, o.id) as rn from ordered o
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id::text, 'name', n.name, 'code', n.code, 'status', n.status,
      'property_count', jsonb_array_length(n.properties),
      'source_refs', '[]'::jsonb, 'plm_context', '[]'::jsonb,
      'properties', n.properties, 'updated_at', null
    ) order by n.rn) filter (where n.rn <= v_page_size), '[]'::jsonb),
    count(*), max(n.sort_value) filter (where n.rn = v_page_size),
    (array_agg(n.id) filter (where n.rn = v_page_size))[1]
  into v_licensors, v_fetched, v_last_sort, v_last_id from numbered n;

  if v_fetched > v_page_size and v_last_id is not null then
    v_next_cursor := encode(convert_to(jsonb_build_object('v', v_last_sort, 'id', v_last_id)::text, 'UTF8'), 'base64');
  end if;
  return jsonb_build_object(
    'snapshot', jsonb_build_object(
      'snapshot_at', v_snapshot_at, 'store', 'core.licensor / core.property',
      'source_system', 'normalized_authoritative_sources',
      'feeder_last_sync_at', null, 'feeder_last_run_status', null,
      'feeder_days_stale', null, 'feeder_available', false,
      'live_upstream_reconciliation', false,
      'note', 'Canonical normalized Licensor and Property hierarchy. Character totals use explicit canonical associations.'
    ),
    'reconciliation', jsonb_build_object(
      'licensor_count', v_total_licensors, 'active_licensor_count', v_active_licensors,
      'property_count', v_total_properties, 'active_property_count', v_total_properties,
      'properties_with_licensor', v_properties_with_licensor,
      'orphan_property_count', v_orphan_count,
      'expected_orphan_count_is_zero', (v_orphan_count = 0),
      'partition_reconciles', (v_properties_with_licensor + v_orphan_count) = v_total_properties
    ),
    'licensors', v_licensors, 'orphan_properties', v_orphans,
    'next_cursor', v_next_cursor, 'page_size', v_page_size
  );
end
$function$
;

CREATE OR REPLACE FUNCTION plm.coldlion_property_sync_run_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'plm'
AS $function$
begin
  begin
    perform plm.alert_coldlion_property_skips(new.id);
  exception when others then
    raise warning 'coldlion property skip alert failed for run %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$
;

revoke all on function app.guard_core_licensor_mg05_only() from public, anon, authenticated, service_role;
revoke all on function plm.alert_coldlion_property_skips(bigint) from public, anon, authenticated, service_role;
revoke all on function plm.sync_core_licensor_from_coldlion(boolean) from public, anon, authenticated, service_role;
revoke all on function plm.sync_core_property_from_coldlion(boolean) from public, anon, authenticated, service_role;
revoke all on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) from public, anon, service_role;
grant execute on function api.db_data_admin_licensor_property_tree(text, boolean, text, integer) to authenticated;

CREATE TRIGGER licensor_00_mg05_only_guard BEFORE INSERT OR DELETE OR UPDATE ON core.licensor FOR EACH ROW EXECUTE FUNCTION app.guard_core_licensor_mg05_only();
CREATE TRIGGER licensor_00_mg05_only_truncate_guard BEFORE TRUNCATE ON core.licensor FOR EACH STATEMENT EXECUTE FUNCTION app.guard_core_licensor_mg05_only();
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON core.property_character_associations FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('core.property_character_associations', 'property_id', 'character_id');
CREATE TRIGGER require_direct_support BEFORE INSERT OR UPDATE ON core.property_character_associations FOR EACH ROW EXECUTE FUNCTION core.require_direct_support_for_canonical_edge('core.property_character_source_edge', 'property_id', 'character_id');
CREATE TRIGGER lock_relationship_pair BEFORE INSERT OR DELETE OR UPDATE ON core.style_guide_character FOR EACH ROW EXECUTE FUNCTION core.lock_canonical_relationship_pair('core.style_guide_character', 'style_guide_id', 'character_id');
CREATE TRIGGER require_direct_support BEFORE INSERT OR UPDATE ON core.style_guide_character FOR EACH ROW EXECUTE FUNCTION core.require_direct_support_for_canonical_edge('core.style_guide_character_source_edge', 'style_guide_id', 'character_id');
CREATE TRIGGER coldlion_property_sync_run_alert AFTER INSERT ON plm.coldlion_property_sync_run FOR EACH ROW EXECUTE FUNCTION plm.coldlion_property_sync_run_alert();
CREATE CONSTRAINT TRIGGER dcp_opa_property_resolution_mapping_members_check AFTER INSERT OR UPDATE ON plm.dcp_opa_property_resolution DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION plm.enforce_dcp_opa_crosswalk_members();
CREATE CONSTRAINT TRIGGER dcp_opa_property_resolution_member_mapping_header_check AFTER INSERT OR UPDATE ON plm.dcp_opa_property_resolution_member DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION plm.enforce_dcp_opa_crosswalk_members();