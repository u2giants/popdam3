-- Stage 0 bridge (pass 2): create/validate five core FKs + compatibility view.
--
-- No bulk DML. Requires zero residual non-core ids (enforced again here).
-- Idempotent:
--   * core FKs already present → leave / ensure validated
--   * legacy FKs still present → drop then add core (should not happen after 112910)
--   * missing → ADD NOT VALID then VALIDATE
--   * view → CREATE OR REPLACE
--
-- Does not write migration metadata. Does not touch 20260723113000.

do $finalize_pre$
declare
  v_assets bigint;
  v_sg bigint;
  v_bo bigint;
begin
  select count(*) into v_assets
  from public.assets a
  where (a.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = a.licensor_id))
     or (a.property_id is not null and not exists (select 1 from core.property p where p.id = a.property_id));

  select count(*) into v_sg
  from public.style_groups sg
  where (sg.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = sg.licensor_id))
     or (sg.property_id is not null and not exists (select 1 from core.property p where p.id = sg.property_id));

  select count(*) into v_bo
  from public.ai_tag_bakeoff_results r
  where r.property_id is not null
    and not exists (select 1 from core.property p where p.id = r.property_id);

  if v_assets <> 0 or v_sg <> 0 or v_bo <> 0 then
    raise exception
      'DAM core taxonomy finalize aborted: residuals remain assets=% style_groups=% bakeoff=% — finish DML backfill first',
      v_assets, v_sg, v_bo;
  end if;
end
$finalize_pre$;

do $finalize_fks$
declare
  r record;
begin
  -- Drop any remaining non-core targets for the exact five table+constraint pairs.
  for r in
    select
      c.conname,
      n.nspname as table_schema,
      rel.relname as table_name,
      rn.nspname || '.' || ref.relname as ref_table
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f'
      -- Exact five table+constraint pairs only (never match same conname on another table).
      and (
        (n.nspname = 'public' and rel.relname = 'assets' and c.conname = 'assets_licensor_id_fkey')
        or (n.nspname = 'public' and rel.relname = 'assets' and c.conname = 'assets_property_id_fkey')
        or (n.nspname = 'public' and rel.relname = 'style_groups' and c.conname = 'style_groups_licensor_id_fkey')
        or (n.nspname = 'public' and rel.relname = 'style_groups' and c.conname = 'style_groups_property_id_fkey')
        or (n.nspname = 'public' and rel.relname = 'ai_tag_bakeoff_results' and c.conname = 'ai_tag_bakeoff_results_property_id_fkey')
      )
  loop
    if r.ref_table not in ('core.licensor', 'core.property') then
      execute format(
        'alter table %I.%I drop constraint if exists %I',
        r.table_schema, r.table_name, r.conname
      );
    end if;
  end loop;

  -- assets.licensor_id → core.licensor
  if not exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f' and c.conname = 'assets_licensor_id_fkey'
      and n.nspname = 'public' and rel.relname = 'assets'
      and rn.nspname = 'core' and ref.relname = 'licensor'
  ) then
    alter table public.assets
      add constraint assets_licensor_id_fkey foreign key (licensor_id)
      references core.licensor(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f' and c.conname = 'assets_property_id_fkey'
      and n.nspname = 'public' and rel.relname = 'assets'
      and rn.nspname = 'core' and ref.relname = 'property'
  ) then
    alter table public.assets
      add constraint assets_property_id_fkey foreign key (property_id)
      references core.property(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f' and c.conname = 'style_groups_licensor_id_fkey'
      and n.nspname = 'public' and rel.relname = 'style_groups'
      and rn.nspname = 'core' and ref.relname = 'licensor'
  ) then
    alter table public.style_groups
      add constraint style_groups_licensor_id_fkey foreign key (licensor_id)
      references core.licensor(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f' and c.conname = 'style_groups_property_id_fkey'
      and n.nspname = 'public' and rel.relname = 'style_groups'
      and rn.nspname = 'core' and ref.relname = 'property'
  ) then
    alter table public.style_groups
      add constraint style_groups_property_id_fkey foreign key (property_id)
      references core.property(id) on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f' and c.conname = 'ai_tag_bakeoff_results_property_id_fkey'
      and n.nspname = 'public' and rel.relname = 'ai_tag_bakeoff_results'
      and rn.nspname = 'core' and ref.relname = 'property'
  ) then
    alter table public.ai_tag_bakeoff_results
      add constraint ai_tag_bakeoff_results_property_id_fkey foreign key (property_id)
      references core.property(id) on delete set null not valid;
  end if;

  alter table public.assets validate constraint assets_licensor_id_fkey;
  alter table public.assets validate constraint assets_property_id_fkey;
  alter table public.style_groups validate constraint style_groups_licensor_id_fkey;
  alter table public.style_groups validate constraint style_groups_property_id_fkey;
  alter table public.ai_tag_bakeoff_results validate constraint ai_tag_bakeoff_results_property_id_fkey;
end
$finalize_fks$;

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
