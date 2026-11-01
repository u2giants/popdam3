-- derived-from: none
-- Issue popcre/shared-db#5079 (claim #5340). Owner ruling 2026-11-01, docs/owner-rulings.md
-- 6.34. Albert Hazan, verbatim: "they are properties under Warner Bros" and "Yes, move them".
-- Follows 20261101153043, which moved the DC and HP Properties to WB.
--
-- WHAT STAYS. "DC" and "HP" remain ColdLion MG05 codes and SKU characters 6-7, so
-- public.assets.licensor_code keeps them. Both core.licensor rows stay, inactive, as the
-- referent of old history; nothing resolves to them any more.
--
-- WHAT THIS DOES, all archived first in archive.dc_hp_wb_repoint_20261101:
--  * plm.import_item_master_data resolves those two codes to WB. plm.item itself is not
--    written here: its next import sweep re-resolves its licensor (claim #4723 holds the table).
--  * The eight licensor source refs are replaced, because the identity guard makes a
--    ref's licensor immutable. source_name becomes WB's, which PopDAM copies onto assets;
--    raw keeps the original.
--  * plm.property_import, plm.licensor_import and plm.style_tracker_item_bridge move to WB.
--  * Any later write of a retired id to the DAM or import tables is redirected to WB.
--  * public.assets and public.style_groups rows are archived but re-pointed by PopDAM in
--    batches: each row refreshes search documents, too slow for one transaction.

create table if not exists archive.dc_hp_wb_repoint_20261101 (
  source_table text not null, row_key text not null, old_row jsonb not null,
  archived_at timestamptz not null default now(), primary key (source_table, row_key));
alter table archive.dc_hp_wb_repoint_20261101 enable row level security;

create or replace function plm.redirect_retired_wb_licensor()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'core'
as $function$
begin
  if new.licensor_id is not null
     and exists (select 1 from core.licensor l where l.id = new.licensor_id and l.code in ('DC', 'HP')) then
    select l.id into new.licensor_id from core.licensor l where l.code = 'WB';
  end if;
  return new;
end $function$;
revoke all on function plm.redirect_retired_wb_licensor() from public, anon, authenticated;

create trigger redirect_retired_wb_licensor before insert or update of licensor_id on public.assets
  for each row execute function plm.redirect_retired_wb_licensor();
create trigger redirect_retired_wb_licensor before insert or update of licensor_id on public.style_groups
  for each row execute function plm.redirect_retired_wb_licensor();
create trigger redirect_retired_wb_licensor before insert or update of licensor_id on plm.property_import
  for each row execute function plm.redirect_retired_wb_licensor();
create trigger redirect_retired_wb_licensor before insert or update of licensor_id on plm.licensor_import
  for each row execute function plm.redirect_retired_wb_licensor();

do $retire$
declare
  v_actor constant text := 'shared-db migration 20261101153102';
  v_old constant text := 'from core.licensor where code=b.merch_group_05';
  v_new constant text := 'from core.licensor where code=case when b.merch_group_05 in (''DC'',''HP'') then ''WB'' else b.merch_group_05 end';
  v_def text;
  v_wb uuid;
  v_wb_name text;
  v_retired uuid[];
  v_lic record;
  v_n integer;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'plm' and p.proname = 'import_item_master_data';
  if v_def is not null then
    if position(v_old in v_def) = 0 then
      raise exception '#5079: plm.import_item_master_data no longer resolves licensors by the expected text';
    end if;
    execute replace(v_def, v_old, v_new);
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'plm' and p.proname = 'import_item_master_data';
    if position(v_new in v_def) = 0 then
      raise exception '#5079: plm.import_item_master_data did not take the DC and HP redirect';
    end if;
  end if;

  select id, name into v_wb, v_wb_name from core.licensor where code = 'WB';
  select array_agg(id) into v_retired from core.licensor where code in ('DC', 'HP');
  if v_wb is null or v_retired is null then
    return;  -- an empty replay database holds no such rows
  end if;

  insert into archive.dc_hp_wb_repoint_20261101 (source_table, row_key, old_row)
  select 'public.assets', a.id::text, jsonb_build_object('licensor_id', a.licensor_id, 'licensor_name', a.licensor_name)
    from public.assets a where a.licensor_id = any(v_retired)
  union all
  select 'public.style_groups', g.id::text, jsonb_build_object('licensor_id', g.licensor_id, 'licensor_name', g.licensor_name)
    from public.style_groups g where g.licensor_id = any(v_retired)
  union all
  select 'plm.item', i.id::text, jsonb_build_object('licensor_id', i.licensor_id)
    from plm.item i where i.licensor_id = any(v_retired)
  union all
  select 'plm.property_import', x.ctid::text, to_jsonb(x) from plm.property_import x where x.licensor_id = any(v_retired)
  union all
  select 'plm.licensor_import', x.ctid::text, to_jsonb(x) from plm.licensor_import x where x.licensor_id = any(v_retired)
  union all
  select 'plm.style_tracker_item_bridge', x.ctid::text, to_jsonb(x) from plm.style_tracker_item_bridge x where x.core_licensor_id = any(v_retired)
  union all
  select 'core.taxonomy_source_ref', r.id::text, to_jsonb(r) from core.taxonomy_source_ref r
   where r.entity_schema = 'core' and r.entity_table = 'licensor' and r.entity_id = any(v_retired)
  on conflict do nothing;

  update plm.property_import set licensor_id = v_wb where licensor_id = any(v_retired);
  update plm.licensor_import set licensor_id = v_wb where licensor_id = any(v_retired);
  update plm.style_tracker_item_bridge set core_licensor_id = v_wb where core_licensor_id = any(v_retired);

  create temporary table pg_temp.old_refs on commit drop as
    select * from core.taxonomy_source_ref
     where entity_schema = 'core' and entity_table = 'licensor' and entity_id = any(v_retired);
  delete from core.taxonomy_source_ref r using pg_temp.old_refs o where r.id = o.id;
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_code, source_name, confidence, raw)
  select 'core', 'licensor', v_wb, o.source_system, o.source_table, o.source_id, o.source_code, v_wb_name, o.confidence,
         coalesce(o.raw, '{}'::jsonb) || jsonb_build_object('original_source_name', o.source_name,
           'original_entity_id', o.entity_id, 'repointed_by', v_actor)
    from pg_temp.old_refs o;

  for v_lic in select id from core.licensor where id = any(v_retired) and status <> 'inactive' loop
    insert into plm.licensing_write_authorization
      (backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash, actor, protected_columns, expires_at)
    values (pg_backend_pid(), txid_current(), 'core.licensor', 'owner_ruling_wb_property_reparent', gen_random_uuid(),
            encode(extensions.digest('5079/retire/' || v_lic.id::text, 'sha256'), 'hex'),
            v_actor, array['status'], clock_timestamp() + interval '1 minute');
    update core.licensor set status = 'inactive' where id = v_lic.id;
  end loop;

  select count(*) into v_n from core.property where licensor_id = any(v_retired);
  if v_n <> 0 then raise exception '#5079: % Properties still under DC or HP', v_n; end if;
  select count(*) into v_n from core.taxonomy_source_ref
   where entity_schema = 'core' and entity_table = 'licensor' and entity_id = any(v_retired);
  if v_n <> 0 then raise exception '#5079: % source refs still name DC or HP', v_n; end if;
end
$retire$;
