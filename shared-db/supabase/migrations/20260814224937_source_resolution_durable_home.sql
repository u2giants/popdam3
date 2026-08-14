-- Curated source-to-canonical decisions must outlive every source capture.
-- Issue #963. Reserved atomically by claim #1033.
--
-- Landing rows are immutable snapshots and are often keyed by capture_id. A decision stored
-- on one of those rows disappears from the current read path when the next capture lands.
-- This table keys the decision on the source's stable identity instead. Loaders never write
-- it. The only write path is plm.set_source_resolution().

create table plm.source_resolution (
  source_system       text        not null,
  entity_kind         text        not null,
  source_id           text        not null,
  core_property_id    uuid            null references core.property(id) on delete restrict,
  core_character_id   uuid            null references core.character(id) on delete restrict,
  core_style_guide_id uuid            null references core.style_guide(id) on delete restrict,
  dam_asset_id        uuid            null references dam.asset(id) on delete restrict,
  resolution_status   text        not null default 'unresolved',
  resolution_reason   text            null,
  resolved_at         timestamptz     null,
  resolved_by         text            null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint source_resolution_pkey primary key (source_system, entity_kind, source_id),
  constraint source_resolution_source_system_nonblank_chk check (btrim(source_system) <> ''),
  constraint source_resolution_source_id_nonblank_chk check (btrim(source_id) <> ''),
  constraint source_resolution_entity_kind_chk
    check (entity_kind in ('property','character','style_guide','asset')),
  constraint source_resolution_status_chk
    check (resolution_status in
      ('unresolved','matched','ambiguous','no_match','rejected','deferred')),
  constraint source_resolution_target_kind_chk check (
    case entity_kind
      when 'property' then
        core_character_id is null and core_style_guide_id is null and dam_asset_id is null
      when 'character' then
        core_property_id is null and core_style_guide_id is null and dam_asset_id is null
      when 'style_guide' then
        core_property_id is null and core_character_id is null and dam_asset_id is null
      when 'asset' then
        core_property_id is null and core_character_id is null and core_style_guide_id is null
      else false
    end
  ),
  constraint source_resolution_matched_target_chk check (
    (resolution_status = 'matched') =
    (num_nonnulls(core_property_id, core_character_id, core_style_guide_id, dam_asset_id) = 1)
  ),
  constraint source_resolution_audit_pair_chk check (
    (resolved_at is null) = (resolved_by is null)
  ),
  constraint source_resolution_reason_nonblank_chk check (
    resolution_reason is null or btrim(resolution_reason) <> ''
  ),
  constraint source_resolution_actor_nonblank_chk check (
    resolved_by is null or btrim(resolved_by) <> ''
  )
);

comment on table plm.source_resolution is
'Capture-independent durable record of a human source-to-canonical decision. Keyed by the '
'source system, entity kind and stable source ID, never by capture ID or display name. Source '
'loaders and syncs must never write this table; use plm.set_source_resolution().';
comment on column plm.source_resolution.source_system is
'Stable source namespace such as paramount or nbcu; never a capture identifier.';
comment on column plm.source_resolution.entity_kind is
'Canonical target kind: property, character, style_guide or asset.';
comment on column plm.source_resolution.source_id is
'Stable identifier assigned by the source. For NBCU fallback identities, this is the existing '
'deterministic *_key, never a display label.';
comment on column plm.source_resolution.resolution_status is
'Human decision state. Source loaders may not set or reset it.';
comment on column plm.source_resolution.resolved_by is
'Authenticated actor stamped by plm.set_source_resolution; never caller-supplied audit text.';
comment on column plm.source_resolution.updated_at is
'Conflict token. A caller replacing a different decision must provide this exact prior value.';

alter table plm.source_resolution enable row level security;
revoke all on table plm.source_resolution from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain
  on table plm.source_resolution from service_role;
grant select on table plm.source_resolution to authenticated, service_role;
create policy source_resolution_authenticated_read
  on plm.source_resolution for select to authenticated using (true);

create or replace view api.source_resolution
with (security_invoker = true)
as
select source_system, entity_kind, source_id,
       core_property_id, core_character_id, core_style_guide_id, dam_asset_id,
       resolution_status, resolution_reason, resolved_at, resolved_by, updated_at
from plm.source_resolution;
comment on view api.source_resolution is
'Authenticated read path for capture-independent source-to-canonical decisions. Join source '
'landing rows by source_system, entity_kind and stable source_id; never read the deprecated '
'resolution fields on a capture row.';
revoke all on table api.source_resolution from public, anon;
grant select on table api.source_resolution to authenticated, service_role;

-- Keep the established Paramount consumer views truthful. These views retain their public
-- column contract, but their resolution fields now come from the durable identity-keyed row.
create or replace view api.pmt_properties
with (security_invoker = true) as
select
  p.capture_id, p.property_source_id, p.property_name, p.is_licensed_selection,
  coalesce((select array_agg(distinct t.authorized_title_name)
              from plm.pmt_authorized_title_property atp
              join plm.pmt_authorized_title t
                on t.capture_id = atp.capture_id and t.authorized_title_key = atp.authorized_title_key
             where atp.capture_id = p.capture_id and atp.property_source_id = p.property_source_id),
           array[]::text[]) as business_title_names,
  (select count(*) from plm.pmt_asset_property ap
    where ap.capture_id = p.capture_id and ap.property_source_id = p.property_source_id) as asset_count,
  (select count(*) from plm.pmt_property_character pch
    where pch.capture_id = p.capture_id and pch.property_source_id = p.property_source_id) as character_count,
  (select count(*) from plm.pmt_property_collection pc
    where pc.capture_id = p.capture_id and pc.property_source_id = p.property_source_id) as style_guide_count,
  coalesce((select array_agg(f.franchise_name order by f.franchise_name)
              from plm.pmt_property_franchise_evidence pfe
              join plm.pmt_franchise f
                on f.capture_id = pfe.capture_id and f.franchise_source_id = pfe.franchise_source_id
             where pfe.capture_id = p.capture_id and pfe.property_source_id = p.property_source_id),
           array[]::text[]) as franchise_names_cooccurrence_evidence_only,
  false as franchise_link_is_a_direct_source_relationship,
  r.core_property_id, coalesce(r.resolution_status, 'unresolved') as resolution_status,
  r.resolution_reason, r.resolved_at
from plm.pmt_property p
join api.pmt_latest_capture lc on lc.capture_id = p.capture_id
left join plm.source_resolution r
  on r.source_system = 'paramount' and r.entity_kind = 'property'
 and r.source_id = p.property_source_id::text;

create or replace view api.pmt_characters
with (security_invoker = true) as
select
  ch.capture_id, ch.character_source_id, ch.character_name,
  coalesce((select array_agg(p.property_name order by p.property_name)
              from plm.pmt_property_character pch
              join plm.pmt_property p
                on p.capture_id = pch.capture_id and p.property_source_id = pch.property_source_id
             where pch.capture_id = ch.capture_id
               and pch.character_source_id = ch.character_source_id),
           array[]::text[]) as explicit_property_names,
  (select count(*) from plm.pmt_asset_character ac
    where ac.capture_id = ch.capture_id and ac.character_source_id = ch.character_source_id)
    as asset_count,
  coalesce((select array_agg(distinct cl.collection_name)
              from plm.pmt_asset_character ac
              join plm.pmt_asset_collection acl
                on acl.capture_id = ac.capture_id and acl.asset_id = ac.asset_id
              join plm.pmt_collection cl
                on cl.capture_id = acl.capture_id and cl.collection_source_id = acl.collection_source_id
             where ac.capture_id = ch.capture_id
               and ac.character_source_id = ch.character_source_id),
           array[]::text[]) as style_guide_names,
  r.core_character_id, coalesce(r.resolution_status, 'unresolved') as resolution_status,
  r.resolution_reason, r.resolved_at
from plm.pmt_character ch
join api.pmt_latest_capture lc on lc.capture_id = ch.capture_id
left join plm.source_resolution r
  on r.source_system = 'paramount' and r.entity_kind = 'character'
 and r.source_id = ch.character_source_id::text;

create or replace function plm.set_source_resolution(
  p_source_system text,
  p_entity_kind text,
  p_source_id text,
  p_resolution_status text,
  p_core_property_id uuid default null,
  p_core_character_id uuid default null,
  p_core_style_guide_id uuid default null,
  p_dam_asset_id uuid default null,
  p_resolution_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns plm.source_resolution
language plpgsql
security definer
set search_path to 'plm', 'pg_temp'
as $$
declare
  v_existing plm.source_resolution%rowtype;
  v_result plm.source_resolution%rowtype;
  v_actor text := coalesce(
    auth.uid()::text,
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    session_user::text
  );
begin
  p_source_system := btrim(p_source_system);
  p_entity_kind := btrim(p_entity_kind);
  p_source_id := btrim(p_source_id);
  p_resolution_status := btrim(p_resolution_status);
  p_resolution_reason := nullif(btrim(p_resolution_reason), '');

  if coalesce(v_actor, '') = '' then
    raise exception using errcode = '42501',
      message = 'source resolution requires an authenticated actor';
  end if;

  -- Serializes both an existing-row change and two simultaneous first decisions. Without
  -- this key lock, two first writers can both observe no row and one receives a raw unique
  -- violation instead of the documented reload conflict.
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(E'\x1f', p_source_system, p_entity_kind, p_source_id), 0
  ));

  select * into v_existing
  from plm.source_resolution
  where source_system = p_source_system
    and entity_kind = p_entity_kind
    and source_id = p_source_id
  for update;

  if found then
    if v_existing.resolution_status is not distinct from p_resolution_status
       and v_existing.core_property_id is not distinct from p_core_property_id
       and v_existing.core_character_id is not distinct from p_core_character_id
       and v_existing.core_style_guide_id is not distinct from p_core_style_guide_id
       and v_existing.dam_asset_id is not distinct from p_dam_asset_id
       and v_existing.resolution_reason is not distinct from p_resolution_reason then
      return v_existing;
    end if;

    if p_expected_updated_at is null
       or p_expected_updated_at is distinct from v_existing.updated_at then
      raise exception using errcode = '40001',
        message = format(
          'source resolution changed for %s/%s/%s; reload the current decision before replacing it',
          p_source_system, p_entity_kind, p_source_id
        );
    end if;

    update plm.source_resolution
    set resolution_status = p_resolution_status,
        core_property_id = p_core_property_id,
        core_character_id = p_core_character_id,
        core_style_guide_id = p_core_style_guide_id,
        dam_asset_id = p_dam_asset_id,
        resolution_reason = p_resolution_reason,
        resolved_at = clock_timestamp(),
        resolved_by = v_actor,
        updated_at = clock_timestamp()
    where source_system = p_source_system
      and entity_kind = p_entity_kind
      and source_id = p_source_id
    returning * into v_result;
  else
    if p_expected_updated_at is not null then
      raise exception using errcode = '40001',
        message = format(
          'source resolution does not yet exist for %s/%s/%s; reload before writing',
          p_source_system, p_entity_kind, p_source_id
        );
    end if;

    insert into plm.source_resolution (
      source_system, entity_kind, source_id, resolution_status,
      core_property_id, core_character_id, core_style_guide_id, dam_asset_id,
      resolution_reason, resolved_at, resolved_by
    ) values (
      p_source_system, p_entity_kind, p_source_id, p_resolution_status,
      p_core_property_id, p_core_character_id, p_core_style_guide_id, p_dam_asset_id,
      p_resolution_reason, clock_timestamp(), v_actor
    )
    returning * into v_result;
  end if;

  return v_result;
end;
$$;

comment on function plm.set_source_resolution(
  text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz
) is
'Only write path for durable source resolution. Stamps the authenticated actor, treats an '
'identical repeat as a no-op, and requires the current updated_at token to replace a different '
'decision. Source loaders and syncs must never call it.';
revoke all on function plm.set_source_resolution(
  text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz
) from public, anon;
grant execute on function plm.set_source_resolution(
  text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz
) to authenticated, service_role;

-- Preserve every existing decision, choosing the newest captured occurrence of each stable
-- source identity. A zero-row backfill is valid; the assertion below still proves it.
with candidates as (
  select 'paramount'::text source_system, 'property'::text entity_kind,
         p.property_source_id::text source_id, p.core_property_id,
         null::uuid core_character_id, null::uuid core_style_guide_id, null::uuid dam_asset_id,
         p.resolution_status, p.resolution_reason, p.resolved_at, p.resolved_by,
         coalesce(c.completed_at, c.started_at) captured_at,
         p.capture_id::text capture_tiebreaker
  from plm.pmt_property p join plm.pmt_capture c using (capture_id)
  where p.resolution_status <> 'unresolved' or p.core_property_id is not null
  union all
  select 'paramount', 'character', p.character_source_id::text, null, p.core_character_id,
         null, null, p.resolution_status, p.resolution_reason, p.resolved_at, p.resolved_by,
         coalesce(c.completed_at, c.started_at), p.capture_id::text
  from plm.pmt_character p join plm.pmt_capture c using (capture_id)
  where p.resolution_status <> 'unresolved' or p.core_character_id is not null
  union all
  select 'nbcu', 'property', p.property_key, p.core_property_id, null, null, null,
         p.resolution_status, p.resolution_reason, p.resolved_at, p.resolved_by,
         coalesce(c.load_completed_at, c.source_captured_at), p.capture_id::text
  from plm.nbcu_property p join plm.nbcu_capture c on c.id = p.capture_id
  where p.resolution_status <> 'unresolved' or p.core_property_id is not null
  union all
  select 'nbcu', 'character', p.character_key, null, p.core_character_id, null, null,
         p.resolution_status, p.resolution_reason, p.resolved_at, p.resolved_by,
         coalesce(c.load_completed_at, c.source_captured_at), p.capture_id::text
  from plm.nbcu_character p join plm.nbcu_capture c on c.id = p.capture_id
  where p.resolution_status <> 'unresolved' or p.core_character_id is not null
  union all
  select 'nbcu', 'style_guide', p.style_guide_key, null, null, p.core_style_guide_id, null,
         p.resolution_status, p.resolution_reason, p.resolved_at, p.resolved_by,
         coalesce(c.load_completed_at, c.source_captured_at), p.capture_id::text
  from plm.nbcu_style_guide p join plm.nbcu_capture c on c.id = p.capture_id
  where p.resolution_status <> 'unresolved' or p.core_style_guide_id is not null
  union all
  select 'nbcu', 'asset', p.asset_source_key, null, null, null, p.dam_asset_id,
         p.resolution_status, p.resolution_reason, p.resolved_at, p.resolved_by,
         coalesce(c.load_completed_at, c.source_captured_at), p.capture_id::text
  from plm.nbcu_asset p join plm.nbcu_capture c on c.id = p.capture_id
  where p.resolution_status <> 'unresolved' or p.dam_asset_id is not null
), ranked as (
  select *, row_number() over (
    partition by source_system, entity_kind, source_id
    order by captured_at desc nulls last, resolved_at desc nulls last,
             capture_tiebreaker desc
  ) as choice
  from candidates
)
insert into plm.source_resolution (
  source_system, entity_kind, source_id,
  core_property_id, core_character_id, core_style_guide_id, dam_asset_id,
  resolution_status, resolution_reason, resolved_at, resolved_by
)
select source_system, entity_kind, source_id,
       core_property_id, core_character_id, core_style_guide_id, dam_asset_id,
       resolution_status, resolution_reason,
       coalesce(resolved_at, captured_at, now()),
       coalesce(nullif(btrim(resolved_by), ''), 'legacy-backfill')
from ranked where choice = 1;

do $$
declare
  v_expected bigint;
  v_actual bigint;
begin
  with candidates as (
    select 'paramount'::text s, 'property'::text k, property_source_id::text i
      from plm.pmt_property where resolution_status <> 'unresolved' or core_property_id is not null
    union select 'paramount', 'character', character_source_id::text
      from plm.pmt_character where resolution_status <> 'unresolved' or core_character_id is not null
    union select 'nbcu', 'property', property_key
      from plm.nbcu_property where resolution_status <> 'unresolved' or core_property_id is not null
    union select 'nbcu', 'character', character_key
      from plm.nbcu_character where resolution_status <> 'unresolved' or core_character_id is not null
    union select 'nbcu', 'style_guide', style_guide_key
      from plm.nbcu_style_guide where resolution_status <> 'unresolved' or core_style_guide_id is not null
    union select 'nbcu', 'asset', asset_source_key
      from plm.nbcu_asset where resolution_status <> 'unresolved' or dam_asset_id is not null
  ) select count(*) into v_expected from candidates;

  select count(*) into v_actual from plm.source_resolution
  where source_system in ('paramount','nbcu');

  if v_actual <> v_expected then
    raise exception 'source_resolution backfill mismatch: expected %, inserted %',
      v_expected, v_actual;
  end if;
  raise notice 'source_resolution backfill preserved % durable decision(s)', v_actual;
end;
$$;

create or replace function plm.reject_legacy_landing_resolution_write()
returns trigger
language plpgsql
security definer
set search_path to 'plm', 'pg_temp'
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_column text;
begin
  if tg_op = 'INSERT' then
    if coalesce(v_new ->> 'resolution_status', 'unresolved') <> 'unresolved' then
      raise exception using errcode = '23514',
        message = format(
          '%I.%I.resolution_status is legacy and must stay unresolved; use plm.set_source_resolution()',
          tg_table_schema, tg_table_name
        );
    end if;
    foreach v_column in array array[
      'core_property_id','core_character_id','core_style_guide_id','dam_asset_id',
      'resolution_reason','resolved_at','resolved_by'
    ] loop
      if v_new ? v_column and v_new -> v_column <> 'null'::jsonb then
        raise exception using errcode = '23514',
          message = format(
            '%I.%I.%I is legacy and cannot be written; use plm.set_source_resolution()',
            tg_table_schema, tg_table_name, v_column
          );
      end if;
    end loop;
    return new;
  end if;

  v_old := to_jsonb(old);
  foreach v_column in array array[
    'core_property_id','core_character_id','core_style_guide_id','dam_asset_id',
    'resolution_status','resolution_reason','resolved_at','resolved_by'
  ] loop
    if v_new ? v_column
       and (v_new -> v_column) is distinct from (v_old -> v_column) then
      raise exception using errcode = '23514',
        message = format(
          '%I.%I.%I is legacy and immutable; use plm.set_source_resolution()',
          tg_table_schema, tg_table_name, v_column
        );
    end if;
  end loop;
  return new;
end;
$$;

comment on function plm.reject_legacy_landing_resolution_write() is
'Fail-closed guard: source capture tables may insert only unresolved/null defaults and may '
'never change legacy resolution fields. Durable decisions use plm.source_resolution.';
revoke all on function plm.reject_legacy_landing_resolution_write() from public, anon, authenticated;

create trigger pmt_property_resolution_immutable
before insert or update on plm.pmt_property
for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger pmt_character_resolution_immutable
before insert or update on plm.pmt_character
for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger nbcu_property_resolution_immutable
before insert or update on plm.nbcu_property
for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger nbcu_character_resolution_immutable
before insert or update on plm.nbcu_character
for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger nbcu_style_guide_resolution_immutable
before insert or update on plm.nbcu_style_guide
for each row execute function plm.reject_legacy_landing_resolution_write();
create trigger nbcu_asset_resolution_immutable
before insert or update on plm.nbcu_asset
for each row execute function plm.reject_legacy_landing_resolution_write();

comment on column plm.pmt_property.core_property_id is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value is immutable.';
comment on column plm.pmt_property.resolution_status is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value stays unresolved.';
comment on column plm.pmt_character.core_character_id is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value is immutable.';
comment on column plm.pmt_character.resolution_status is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value stays unresolved.';
comment on column plm.nbcu_property.core_property_id is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value is immutable.';
comment on column plm.nbcu_property.resolution_status is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value stays unresolved.';
comment on column plm.nbcu_character.core_character_id is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value is immutable.';
comment on column plm.nbcu_character.resolution_status is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value stays unresolved.';
comment on column plm.nbcu_style_guide.core_style_guide_id is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value is immutable.';
comment on column plm.nbcu_style_guide.resolution_status is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value stays unresolved.';
comment on column plm.nbcu_asset.dam_asset_id is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value is immutable.';
comment on column plm.nbcu_asset.resolution_status is
'DEPRECATED resolution field. Read plm.source_resolution; this landing value stays unresolved.';
