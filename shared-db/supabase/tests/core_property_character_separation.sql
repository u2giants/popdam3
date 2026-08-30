-- Issue #1684 final contract: Property and Character are separate UUID entities.
begin;

do $contracts$
declare
  v_definition text;
begin
  if to_regclass('core.properties_and_characters') is not null then
    raise exception 'retired mixed Property/Character table still exists';
  end if;
  if to_regprocedure('core.reject_properties_and_characters_write()') is not null then
    raise exception 'Phase 1 EOL guard function survived the final drop';
  end if;
  if to_regclass('core.property') is null or to_regclass('core.character') is null then
    raise exception 'separate canonical Property or Character table is absent';
  end if;
  if (select count(*) from core.character) <> 0 then
    raise exception 'core.character was populated from forbidden mixed-table rows';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='core' and table_name='character'
      and column_name='id' and udt_name='uuid' and is_nullable='NO'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='core' and table_name='character'
      and column_name='licensor_id' and udt_name='uuid'
  ) then
    raise exception 'core.character UUID identity/Licensor contract is wrong';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='core' and table_name='character' and column_name='property_id'
  ) then
    raise exception 'Character still embeds scalar Property ownership';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='core' and table_name='property_character_associations'
      and column_name='licensor_id'
  ) or 2 <> (
    select count(*) from information_schema.columns
    where table_schema='core' and table_name='property_character_associations'
      and column_name in ('property_id','character_id') and udt_name='uuid'
  ) then
    raise exception 'explicit Property/Character association does not use only UUID endpoints';
  end if;

  if (select count(*) from core.property_character_associations) <> 0
     or (select count(*) from plm.item_character_associations) <> 0
     or (select count(*) from plm.wb_asset_canonical_property_edge) <> 0
     or (select count(*) from plm.wb_character_canonical_property_edge) <> 0
     or (select count(*) from plm.wb_style_guide_canonical_property_edge) <> 0 then
    raise exception 'unmappable legacy integer dependencies were not deliberately retired';
  end if;

  if (select udt_name from information_schema.columns
      where table_schema='plm' and table_name='item_character_associations'
        and column_name='character_id') <> 'uuid'
     or exists (
       select 1 from (values
         ('wb_asset_canonical_property_edge'),
         ('wb_character_canonical_property_edge'),
         ('wb_style_guide_canonical_property_edge')
       ) v(table_name)
       where (select udt_name from information_schema.columns
              where table_schema='plm' and information_schema.columns.table_name=v.table_name
                and column_name='canonical_property_id') <> 'uuid'
     ) then
    raise exception 'dependent PLM endpoints were not converted to UUID identities';
  end if;

  if has_table_privilege('authenticated','core.character','insert')
     or has_table_privilege('service_role','core.character','insert')
     or has_table_privilege('authenticated','core.property_character_associations','insert')
     or has_table_privilege('service_role','core.property_character_associations','insert') then
    raise exception 'empty curated Character contracts permit ungoverned direct writes';
  end if;

  select pg_get_functiondef('api.db_data_admin_licensor_property_tree(text,boolean,text,integer)'::regprocedure)
    into v_definition;
  if position('core.property p' in v_definition) = 0
     or position('core.licensor l' in v_definition) = 0
     or position('properties_and_characters' in v_definition) > 0 then
    raise exception 'DB Data Admin tree was not repointed to normalized canonical tables';
  end if;

  select pg_get_functiondef('plm.sync_wb_canonical_relationship_edges(text,jsonb)'::regprocedure)
    into v_definition;
  if position('core.property p' in v_definition) = 0
     or position('properties_and_characters' in v_definition) > 0 then
    raise exception 'Warner sync was not repointed to core.property UUID identities';
  end if;
end
$contracts$;

rollback;
