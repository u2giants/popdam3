-- u2giants/popdam3#680. Star Wars "Child" and "Grogu" are one character.
-- New version because the promotion queue skips renamed migrations; earlier versions never ran in production.
-- Absent from preview, which holds no scraped characters.
create table if not exists archive.character_child_grogu_links_20261104 (
  asset_id uuid primary key,
  old_row jsonb not null,
  archived_at timestamptz not null default now()
);
alter table archive.character_child_grogu_links_20261104 enable row level security;

do $$
declare
  old_id constant uuid := '0e5896e5-7813-4f82-a428-d4669504100a';
  keep_id constant uuid := '5183540b-1ae9-4eeb-9efc-b638deda17ac';
  old_row core."character";
  keep_row core."character";
begin
  select * into old_row from core."character" where id = old_id;
  select * into keep_row from core."character" where id = keep_id;
  if old_row.id is null and keep_row.id is null then
    raise notice 'neither character is here; no work';
    return;
  end if;
  if old_row.id is null or keep_row.id is null or old_row.licensor_id is distinct from keep_row.licensor_id or keep_row.licensor_id is null then
    raise exception 'expected both characters under one licensor';
  end if;
  if exists (select 1 from core.character_alias where character_id = old_id)
     or exists (select 1 from core.property_character_associations where character_id = old_id)
     or exists (select 1 from core.property_character_source_edge where character_id = old_id)
     or exists (select 1 from plm.item_character_associations where character_id = old_id) then
    raise exception 'old character has other references';
  end if;

  with moved as (
    delete from public.asset_licensor_characters where character_id = old_id returning *
  ), saved as (
    insert into archive.character_child_grogu_links_20261104 (asset_id, old_row)
    select m.asset_id, to_jsonb(m) from moved m on conflict (asset_id) do nothing
  )
  insert into public.asset_licensor_characters (asset_id, character_id, source, model, tagged_at)
  select m.asset_id, keep_id, m.source, m.model, m.tagged_at from moved m
  on conflict (asset_id, character_id) do nothing;

  update core."character" set status = 'archived' where id = old_id;

  insert into core.character_alias (character_id, licensor_id, alias, source_system, evidence_notes)
  select keep_id, keep_row.licensor_id, 'Child', 'popdam3#680', 'Duplicate name merged into Grogu'
  where not exists (
    select 1 from core.character_alias a
    where a.licensor_id = keep_row.licensor_id
      and a.normalized_alias = core.normalize_popsg_property_observation('Child')
  );
end $$;
