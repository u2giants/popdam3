-- Cut PopDAM's live licensor/property identity over from the legacy
-- public.licensors/public.properties catalog to the shared canonical tables.
--
-- Legacy rows remain temporarily because public.characters still references
-- public.properties. They are no longer an application-owned licensor/property
-- source. public.dam_character_catalog is the compatibility boundary that lets
-- DAM use the legacy character catalog with canonical property UUIDs.

set local statement_timeout = '10min';

create temporary table dam_legacy_licensor_map on commit drop as
select legacy.id as legacy_id, canonical.id as core_id
from public.licensors legacy
join lateral (
  select c.id
  from core.licensor c
  where lower(c.code) = lower(
          case legacy.external_id
            when 'DS' then 'DY'
            when 'WWE' then 'WW'
            else legacy.external_id
          end
        )
     or lower(trim(c.name)) = lower(trim(legacy.name))
  order by
    (lower(c.code) = lower(
      case legacy.external_id when 'DS' then 'DY' when 'WWE' then 'WW' else legacy.external_id end
    )) desc,
    c.id
  limit 1
) canonical on true;

do $$
declare
  v_unmapped integer;
begin
  select count(*) into v_unmapped
  from public.licensors l
  left join dam_legacy_licensor_map m on m.legacy_id = l.id
  where m.core_id is null;

  if v_unmapped <> 0 then
    raise exception 'DAM core taxonomy cutover aborted: % legacy licensors have no canonical core.licensor match', v_unmapped;
  end if;
end $$;

create temporary table dam_legacy_property_map on commit drop as
select legacy.id as legacy_id, min(canonical.id::text)::uuid as core_id
from public.properties legacy
join dam_legacy_licensor_map lm on lm.legacy_id = legacy.licensor_id
join core.property canonical
  on canonical.licensor_id = lm.core_id
 and lower(trim(canonical.name)) = lower(trim(legacy.name))
group by legacy.id
having count(*) = 1;

-- The current FKs target the legacy UUID sets and must be removed before the
-- canonical UUID rewrite. Recreate and validate them against core below.
alter table public.assets drop constraint if exists assets_licensor_id_fkey;
alter table public.assets drop constraint if exists assets_property_id_fkey;
alter table public.style_groups drop constraint if exists style_groups_licensor_id_fkey;
alter table public.style_groups drop constraint if exists style_groups_property_id_fkey;
alter table public.ai_tag_bakeoff_results drop constraint if exists ai_tag_bakeoff_results_property_id_fkey;

-- These triggers react to any UPDATE or to the automatic updated_at change.
-- A taxonomy FK rewrite does not change thumbnails, search text, or group
-- membership/counts, so firing them for ~85k rows is both incorrect and very
-- expensive. ALTER TABLE is transactional: an error restores trigger state.
alter table public.assets disable trigger set_assets_updated_at;
alter table public.assets disable trigger trg_dam_search_assets_refresh;
alter table public.assets disable trigger trg_refresh_sg_counts_on_update;
alter table public.assets disable trigger trg_sync_primary_on_thumbnail;

-- Build unique, indexed canonical lookups once. This avoids evaluating a
-- lateral core.property scan for every DAM asset.
create temporary table dam_core_property_by_code on commit drop as
select p.licensor_id, lower(p.code) as lookup_key, min(p.id::text)::uuid as core_id
from core.property p
where p.code is not null
group by p.licensor_id, lower(p.code)
having count(*) = 1;
create index on dam_core_property_by_code (licensor_id, lookup_key);

create temporary table dam_core_property_by_name on commit drop as
select p.licensor_id, lower(trim(p.name)) as lookup_key, min(p.id::text)::uuid as core_id
from core.property p
group by p.licensor_id, lower(trim(p.name))
having count(*) = 1;
create index on dam_core_property_by_name (licensor_id, lookup_key);

-- Assets carry ERP/path-derived codes and names, so resolve them directly to
-- canonical rows. A missing or ambiguous property is left as NULL while the
-- durable property_name/property_code fields remain intact; no incorrect FK is
-- guessed. The canonical licensor is still retained.
create temporary table dam_asset_taxonomy_resolution (
  id uuid primary key,
  licensor_id uuid,
  property_id uuid
) on commit drop;

insert into dam_asset_taxonomy_resolution (id, licensor_id, property_id)
select
  a.id,
  coalesce(code_match.licensor_id, name_match.licensor_id, lm.core_id),
  coalesce(code_match.core_id, name_match.core_id)
from public.assets a
left join dam_legacy_licensor_map lm on lm.legacy_id = a.licensor_id
left join public.properties legacy_property on legacy_property.id = a.property_id
left join dam_core_property_by_code code_match
  on code_match.licensor_id = lm.core_id
 and code_match.lookup_key = lower(a.property_code)
left join dam_core_property_by_name name_match
  on name_match.licensor_id = lm.core_id
 and name_match.lookup_key = lower(trim(coalesce(a.property_name, legacy_property.name)))
where a.licensor_id is not null or a.property_id is not null;

do $$
declare
  v_rows integer;
begin
  loop
    with batch as (
      select id, licensor_id, property_id
      from dam_asset_taxonomy_resolution
      order by id
      limit 5000
    ), updated as (
      update public.assets a
      set licensor_id = batch.licensor_id,
          property_id = batch.property_id
      from batch
      where a.id = batch.id
      returning a.id
    )
    delete from dam_asset_taxonomy_resolution r
    using updated u
    where r.id = u.id;

    get diagnostics v_rows = row_count;
    exit when v_rows = 0;
  end loop;
end $$;

alter table public.assets enable trigger set_assets_updated_at;
alter table public.assets enable trigger trg_dam_search_assets_refresh;
alter table public.assets enable trigger trg_refresh_sg_counts_on_update;
alter table public.assets enable trigger trg_sync_primary_on_thumbnail;

with resolved as (
  select
    sg.id,
    coalesce(code_match.licensor_id, name_match.licensor_id, lm.core_id) as licensor_id,
    coalesce(code_match.core_id, name_match.core_id) as property_id
  from public.style_groups sg
  left join dam_legacy_licensor_map lm on lm.legacy_id = sg.licensor_id
  left join public.properties legacy_property on legacy_property.id = sg.property_id
  left join dam_core_property_by_code code_match
    on code_match.licensor_id = lm.core_id
   and code_match.lookup_key = lower(sg.property_code)
  left join dam_core_property_by_name name_match
    on name_match.licensor_id = lm.core_id
   and name_match.lookup_key = lower(trim(coalesce(sg.property_name, legacy_property.name)))
  where sg.licensor_id is not null or sg.property_id is not null
)
update public.style_groups sg
set licensor_id = resolved.licensor_id,
    property_id = resolved.property_id
from resolved
where sg.id = resolved.id
  and (sg.licensor_id is not null or sg.property_id is not null);

update public.ai_tag_bakeoff_results r
set property_id = m.core_id
from dam_legacy_property_map m
where r.property_id = m.legacy_id;

update public.ai_tag_bakeoff_results r
set property_id = null
where r.property_id is not null
  and not exists (select 1 from core.property p where p.id = r.property_id);

alter table public.assets
  add constraint assets_licensor_id_fkey foreign key (licensor_id)
  references core.licensor(id) on delete set null not valid,
  add constraint assets_property_id_fkey foreign key (property_id)
  references core.property(id) on delete set null not valid;

alter table public.style_groups
  add constraint style_groups_licensor_id_fkey foreign key (licensor_id)
  references core.licensor(id) on delete set null not valid,
  add constraint style_groups_property_id_fkey foreign key (property_id)
  references core.property(id) on delete set null not valid;

alter table public.ai_tag_bakeoff_results
  add constraint ai_tag_bakeoff_results_property_id_fkey foreign key (property_id)
  references core.property(id) on delete set null not valid;

alter table public.assets validate constraint assets_licensor_id_fkey;
alter table public.assets validate constraint assets_property_id_fkey;
alter table public.style_groups validate constraint style_groups_licensor_id_fkey;
alter table public.style_groups validate constraint style_groups_property_id_fkey;
alter table public.ai_tag_bakeoff_results validate constraint ai_tag_bakeoff_results_property_id_fkey;

create or replace view public.dam_character_catalog
with (security_invoker = true)
as
select
  ch.id,
  ch.name,
  ch.external_id,
  ch.is_priority,
  ch.usage_count,
  ch.created_at,
  ch.updated_at,
  canonical_property.id as core_property_id
from public.characters ch
join public.properties legacy_property on legacy_property.id = ch.property_id
join public.licensors legacy_licensor on legacy_licensor.id = legacy_property.licensor_id
join core.licensor canonical_licensor
  on lower(canonical_licensor.code) = lower(
       case legacy_licensor.external_id when 'DS' then 'DY' when 'WWE' then 'WW' else legacy_licensor.external_id end
     )
  or lower(trim(canonical_licensor.name)) = lower(trim(legacy_licensor.name))
join core.property canonical_property
  on canonical_property.licensor_id = canonical_licensor.id
 and lower(trim(canonical_property.name)) = lower(trim(legacy_property.name));

grant select on public.dam_character_catalog to authenticated, service_role;

comment on view public.dam_character_catalog is
  'Temporary DAM character compatibility catalog. Licensor/property identity is canonical core.*; character IDs remain legacy public.characters until a separate core.character migration is approved.';
comment on table public.licensors is
  'DEPRECATED compatibility storage. PopDAM licensor lists and foreign keys use core.licensor.';
comment on table public.properties is
  'DEPRECATED compatibility storage retained for public.characters only. PopDAM property lists and foreign keys use core.property.';
