-- Move the remaining source-ID-keyed human decisions into the durable home created by
-- 20260814224937. Source loaders keep owning observations; only plm.set_source_resolution
-- may own a reviewed source-to-canonical decision.
-- Issue #999. Version reserved by claim #1037.

create temporary table remaining_source_resolution_stage (
  source_system text not null,
  entity_kind text not null,
  source_id text not null,
  core_property_id uuid,
  core_character_id uuid,
  core_style_guide_id uuid,
  dam_asset_id uuid,
  resolution_status text not null,
  resolution_reason text,
  resolved_at timestamptz,
  resolved_by text
) on commit drop;

-- OPA's original pair table repeated a property decision once per character. Keep every
-- candidate until the conflict gate below proves that the fan-out agrees.
insert into remaining_source_resolution_stage
select 'disney_opa', 'property', licensed_property_id::text,
       property_id, null::uuid, null::uuid, null::uuid, resolution_status, resolution_reason,
       resolved_at, resolved_by
from plm.opa_property_character
where resolution_status <> 'unresolved' or property_id is not null
   or resolution_reason is not null or resolved_at is not null or resolved_by is not null
union all
select 'disney_opa', 'property', licensed_property_id::text,
       core_property_id, null::uuid, null::uuid, null::uuid,
       case resolution_status when 'resolved' then 'matched'
                              when 'not_a_property' then 'rejected'
                              else resolution_status end,
       resolution_reason, resolved_at, resolved_by
from plm.opa_property
where resolution_status <> 'unresolved' or core_property_id is not null
   or resolution_reason is not null or resolved_at is not null or resolved_by is not null
union all
select 'disney_opa', 'character', character_id::text,
       null::uuid, core_character_id, null::uuid, null::uuid,
       case resolution_status when 'resolved' then 'matched'
                              when 'not_a_character' then 'rejected'
                              else resolution_status end,
       resolution_reason, resolved_at, resolved_by
from plm.opa_character
where resolution_status <> 'unresolved' or core_character_id is not null
   or resolution_reason is not null or resolved_at is not null or resolved_by is not null;

-- DCP browse tiles and metadata properties share a source namespace and are different
-- identities. Type-tag the ID so equal source text can never collapse the two.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('dcp', 'disney_dcpvault'),
      ('lucasfilm_dcp', 'lucasfilm_dcpvault'),
      ('marvel_dcp', 'marvel_dcpvault'),
      ('twentieth_century_dcp', 'twentieth_century_dcpvault')
    ) v(prefix, source_system)
  loop
    execute format($sql$
      insert into remaining_source_resolution_stage
      select %L, 'property', 'tile:' || source_key,
             core_property_id, null, null, null, resolution_status, resolution_reason,
             resolved_at, resolved_by
      from plm.%I
      where resolution_status <> 'unresolved' or core_property_id is not null
         or resolution_reason is not null or resolved_at is not null or resolved_by is not null
    $sql$, r.source_system, r.prefix || '_portal_tile');

    execute format($sql$
      insert into remaining_source_resolution_stage
      select %L, 'style_guide', 'path:' || source_path,
             null, null, core_style_guide_id, null, resolution_status, resolution_reason,
             resolved_at, resolved_by
      from plm.%I
      where resolution_status <> 'unresolved' or core_style_guide_id is not null
         or resolution_reason is not null or resolved_at is not null or resolved_by is not null
    $sql$, r.source_system, r.prefix || '_style_guide');

    execute format($sql$
      insert into remaining_source_resolution_stage
      select %L, 'property', 'id:' || source_id,
             core_property_id, null, null, null,
             case when core_property_id is not null then 'matched' else 'deferred' end,
             resolution_note,
             case when (resolved_at is null) = (resolved_by is null) then resolved_at end,
             case when (resolved_at is null) = (resolved_by is null) then resolved_by end
      from plm.%I
      where core_property_id is not null or resolution_note is not null
         or resolved_at is not null or resolved_by is not null
    $sql$, r.source_system, r.prefix || '_property');

    execute format($sql$
      insert into remaining_source_resolution_stage
      select %L, 'character', 'id:' || source_id,
             null, core_character_id, null, null,
             case when core_character_id is not null then 'matched' else 'deferred' end,
             resolution_note,
             case when (resolved_at is null) = (resolved_by is null) then resolved_at end,
             case when (resolved_at is null) = (resolved_by is null) then resolved_by end
      from plm.%I
      where core_character_id is not null or resolution_note is not null
         or resolved_at is not null or resolved_by is not null
    $sql$, r.source_system, r.prefix || '_character');
  end loop;
end;
$$;

-- Warner's relationship table repeats a property decision for every character. The joined
-- property namespace is part of the durable namespace, and ID/fallback tags prevent a real
-- source ID from colliding with an equal fallback string.
insert into remaining_source_resolution_stage
select 'warner:' || p.source_namespace, 'property',
       case when p.source_id is not null then 'id:' || p.source_id
            else 'fallback:' || p.fallback_key end,
       pc.core_property_id, null, null, null,
       case pc.resolution_status when 'resolved' then 'matched'
                                 when 'not_a_property' then 'rejected'
                                 else pc.resolution_status end,
       pc.resolution_reason, pc.resolved_at, pc.resolved_by
from plm.wb_property_character_normalized pc
join plm.wb_property p on p.id = pc.property_id
where pc.resolution_status <> 'unresolved' or pc.core_property_id is not null
   or pc.resolution_reason is not null or pc.resolved_at is not null or pc.resolved_by is not null;

-- Never pick a winner when repeated landing rows disagree.
do $$
declare
  v_conflicts integer;
begin
  select count(*) into v_conflicts
  from (
    select source_system, entity_kind, source_id
    from remaining_source_resolution_stage
    group by source_system, entity_kind, source_id
    having count(distinct jsonb_build_array(
      core_property_id, core_character_id, core_style_guide_id, dam_asset_id,
      resolution_status, resolution_reason, resolved_at, resolved_by
    )) > 1
  ) conflicts;
  if v_conflicts <> 0 then
    raise exception 'remaining source resolution backfill has % conflicting source identity decision(s)',
      v_conflicts;
  end if;

  select count(*) into v_conflicts
  from remaining_source_resolution_stage s
  join plm.source_resolution d using (source_system, entity_kind, source_id)
  where jsonb_build_array(
          s.core_property_id, s.core_character_id, s.core_style_guide_id, s.dam_asset_id,
          s.resolution_status, s.resolution_reason, s.resolved_at, s.resolved_by
        ) is distinct from jsonb_build_array(
          d.core_property_id, d.core_character_id, d.core_style_guide_id, d.dam_asset_id,
          d.resolution_status, d.resolution_reason, d.resolved_at, d.resolved_by
        );
  if v_conflicts <> 0 then
    raise exception 'remaining source resolution backfill conflicts with % existing durable decision(s)',
      v_conflicts;
  end if;
end;
$$;

insert into plm.source_resolution (
  source_system, entity_kind, source_id,
  core_property_id, core_character_id, core_style_guide_id, dam_asset_id,
  resolution_status, resolution_reason, resolved_at, resolved_by
)
select distinct on (source_system, entity_kind, source_id)
       source_system, entity_kind, source_id,
       core_property_id, core_character_id, core_style_guide_id, dam_asset_id,
       resolution_status, resolution_reason, resolved_at, resolved_by
from remaining_source_resolution_stage
order by source_system, entity_kind, source_id
on conflict (source_system, entity_kind, source_id) do nothing;

-- The OPA reconciliation reader must switch before the landing fields are cleared.
create or replace view api.opa_property_reconciliation
with (security_invoker = true) as
select
  o.licensed_property_id,
  min(o.property_name) as opa_property_name,
  count(*) as opa_character_count,
  count(*) filter (where coalesce(r.resolution_status, 'unresolved') = 'unresolved')
    as unresolved_character_count,
  count(distinct r.core_property_id) as matched_core_property_count,
  coalesce(array_agg(distinct r.core_property_id order by r.core_property_id)
    filter (where r.core_property_id is not null), '{}'::uuid[]) as matched_core_property_ids,
  coalesce(array_agg(distinct p.name order by p.name)
    filter (where p.name is not null), '{}'::text[]) as core_property_names,
  coalesce(array_agg(distinct l.code order by l.code)
    filter (where l.code is not null), '{}'::text[]) as core_licensor_codes,
  coalesce(r.resolution_status, 'unresolved') as resolution_status,
  r.resolved_at as last_resolved_at,
  min(o.captured_at) as captured_at,
  min(o.line_of_business) as line_of_business,
  min(o.entitlement_scope) as entitlement_scope
from plm.opa_property_character o
left join plm.source_resolution r
  on r.source_system = 'disney_opa'
 and r.entity_kind = 'property'
 and r.source_id = o.licensed_property_id::text
left join core.property p on p.id = r.core_property_id
left join core.licensor l on l.id = p.licensor_id
group by o.licensed_property_id, r.core_property_id, r.resolution_status, r.resolved_at;

comment on view api.opa_property_reconciliation is
'Exactly one row per Disney OPA property source ID. Reconciliation is read from the '
'capture-independent plm.source_resolution record; pair rows remain source relationship evidence.';

-- Clear every legacy decision only after the durable insert and reader replacement succeed.
update plm.opa_property_character
set property_id = null, resolution_status = 'unresolved', resolution_reason = null,
    resolved_at = null, resolved_by = null
where property_id is not null or resolution_status <> 'unresolved'
   or resolution_reason is not null or resolved_at is not null or resolved_by is not null;
update plm.opa_property
set core_property_id = null, resolution_status = 'unresolved', resolution_reason = null,
    resolved_at = null, resolved_by = null
where core_property_id is not null or resolution_status <> 'unresolved'
   or resolution_reason is not null or resolved_at is not null or resolved_by is not null;
update plm.opa_character
set core_character_id = null, resolution_status = 'unresolved', resolution_reason = null,
    resolved_at = null, resolved_by = null
where core_character_id is not null or resolution_status <> 'unresolved'
   or resolution_reason is not null or resolved_at is not null or resolved_by is not null;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('dcp'), ('lucasfilm_dcp'), ('marvel_dcp'), ('twentieth_century_dcp')
    ) v(prefix)
  loop
    execute format('update plm.%I set core_property_id=null, resolution_status=''unresolved'', resolution_reason=null, resolved_at=null, resolved_by=null where core_property_id is not null or resolution_status<>''unresolved'' or resolution_reason is not null or resolved_at is not null or resolved_by is not null', r.prefix || '_portal_tile');
    execute format('update plm.%I set core_style_guide_id=null, resolution_status=''unresolved'', resolution_reason=null, resolved_at=null, resolved_by=null where core_style_guide_id is not null or resolution_status<>''unresolved'' or resolution_reason is not null or resolved_at is not null or resolved_by is not null', r.prefix || '_style_guide');
    execute format('update plm.%I set core_property_id=null, resolution_note=null, resolved_at=null, resolved_by=null where core_property_id is not null or resolution_note is not null or resolved_at is not null or resolved_by is not null', r.prefix || '_property');
    execute format('update plm.%I set core_character_id=null, resolution_note=null, resolved_at=null, resolved_by=null where core_character_id is not null or resolution_note is not null or resolved_at is not null or resolved_by is not null', r.prefix || '_character');
  end loop;
end;
$$;

update plm.wb_property_character_normalized
set core_property_id = null, resolution_status = 'unresolved', resolution_reason = null,
    resolved_at = null, resolved_by = null
where core_property_id is not null or resolution_status <> 'unresolved'
   or resolution_reason is not null or resolved_at is not null or resolved_by is not null;

-- Exact trigger names are reserved by claim #1037.
create trigger opa_property_character_resolution_immutable before insert or update on plm.opa_property_character for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger opa_property_resolution_immutable before insert or update on plm.opa_property for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger opa_character_resolution_immutable before insert or update on plm.opa_character for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger dcp_portal_tile_resolution_immutable before insert or update on plm.dcp_portal_tile for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger dcp_style_guide_resolution_immutable before insert or update on plm.dcp_style_guide for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger dcp_property_resolution_immutable before insert or update on plm.dcp_property for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger dcp_character_resolution_immutable before insert or update on plm.dcp_character for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger lucasfilm_dcp_portal_tile_resolution_immutable before insert or update on plm.lucasfilm_dcp_portal_tile for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger lucasfilm_dcp_style_guide_resolution_immutable before insert or update on plm.lucasfilm_dcp_style_guide for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger lucasfilm_dcp_property_resolution_immutable before insert or update on plm.lucasfilm_dcp_property for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger lucasfilm_dcp_character_resolution_immutable before insert or update on plm.lucasfilm_dcp_character for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger marvel_dcp_portal_tile_resolution_immutable before insert or update on plm.marvel_dcp_portal_tile for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger marvel_dcp_style_guide_resolution_immutable before insert or update on plm.marvel_dcp_style_guide for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger marvel_dcp_property_resolution_immutable before insert or update on plm.marvel_dcp_property for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger marvel_dcp_character_resolution_immutable before insert or update on plm.marvel_dcp_character for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger twentieth_century_dcp_portal_tile_resolution_immutable before insert or update on plm.twentieth_century_dcp_portal_tile for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger twentieth_century_dcp_style_guide_resolution_immutable before insert or update on plm.twentieth_century_dcp_style_guide for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger twentieth_century_dcp_property_resolution_immutable before insert or update on plm.twentieth_century_dcp_property for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger twentieth_century_dcp_character_resolution_immutable before insert or update on plm.twentieth_century_dcp_character for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger wb_property_character_normalized_resolution_immutable before insert or update on plm.wb_property_character_normalized for each row execute function plm.reject_legacy_landing_resolution_write();

-- The shared trigger predates DCP metadata's resolution_note name. A null-only constraint
-- closes that insert/update path without redefining the shared function.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('dcp'), ('lucasfilm_dcp'), ('marvel_dcp'), ('twentieth_century_dcp')
    ) v(prefix)
  loop
    execute format('alter table plm.%I add constraint %I check (resolution_note is null)',
      r.prefix || '_property', r.prefix || '_property_legacy_resolution_note_null_chk');
    execute format('alter table plm.%I add constraint %I check (resolution_note is null)',
      r.prefix || '_character', r.prefix || '_character_legacy_resolution_note_null_chk');
  end loop;
end;
$$;

-- Mark every old decision surface clearly. Workflow resolution tables are deliberately absent.
do $$
declare
  r record;
  c text;
begin
  for r in
    select * from (values
      ('opa_property_character', array['property_id','resolution_status','resolution_reason','resolved_at','resolved_by']),
      ('opa_property', array['core_property_id','resolution_status','resolution_reason','resolved_at','resolved_by']),
      ('opa_character', array['core_character_id','resolution_status','resolution_reason','resolved_at','resolved_by']),
      ('dcp_portal_tile', array['core_property_id','resolution_status','resolution_reason','resolved_at','resolved_by']),
      ('dcp_style_guide', array['core_style_guide_id','resolution_status','resolution_reason','resolved_at','resolved_by']),
      ('dcp_property', array['core_property_id','resolution_note','resolved_at','resolved_by']),
      ('dcp_character', array['core_character_id','resolution_note','resolved_at','resolved_by']),
      ('lucasfilm_dcp_portal_tile', array['core_property_id','resolution_status','resolution_reason','resolved_at','resolved_by']),
      ('lucasfilm_dcp_style_guide', array['core_style_guide_id','resolution_status','resolution_reason','resolved_at','resolved_by']),
      ('lucasfilm_dcp_property', array['core_property_id','resolution_note','resolved_at','resolved_by']),
      ('lucasfilm_dcp_character', array['core_character_id','resolution_note','resolved_at','resolved_by']),
      ('marvel_dcp_portal_tile', array['core_property_id','resolution_status','resolution_reason','resolved_at','resolved_by']),
      ('marvel_dcp_style_guide', array['core_style_guide_id','resolution_status','resolution_reason','resolved_at','resolved_by']),
      ('marvel_dcp_property', array['core_property_id','resolution_note','resolved_at','resolved_by']),
      ('marvel_dcp_character', array['core_character_id','resolution_note','resolved_at','resolved_by']),
      ('twentieth_century_dcp_portal_tile', array['core_property_id','resolution_status','resolution_reason','resolved_at','resolved_by']),
      ('twentieth_century_dcp_style_guide', array['core_style_guide_id','resolution_status','resolution_reason','resolved_at','resolved_by']),
      ('twentieth_century_dcp_property', array['core_property_id','resolution_note','resolved_at','resolved_by']),
      ('twentieth_century_dcp_character', array['core_character_id','resolution_note','resolved_at','resolved_by']),
      ('wb_property_character_normalized', array['core_property_id','resolution_status','resolution_reason','resolved_at','resolved_by'])
    ) v(table_name, columns)
  loop
    foreach c in array r.columns loop
      execute format('comment on column plm.%I.%I is %L', r.table_name, c,
        'DEPRECATED resolution field. Read plm.source_resolution; this landing value is immutable.');
    end loop;
  end loop;
end;
$$;
