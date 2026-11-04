-- popdam3#680, owner rulings Nov 3, 2026:
-- "\"group shot\" should itself be a character for tagging purposes"
-- "Eli is a freelancer/illustrator. the others are not and should be inactivated."
-- Only where the character list is loaded: test databases must keep it empty.
insert into core."character" (id, licensor_id, code, name, status, metadata)
select '90f4dfa8-b4f9-4880-b2f7-e772f5e40ca7', null, 'tagging_label:group_shot', 'Group Shot', 'active', '{"issue":"u2giants/popdam3#680","kind":"tagging_label"}'::jsonb
where exists (select 1 from core."character")
on conflict (id) do update set name = excluded.name, code = excluded.code, status = excluded.status, metadata = excluded.metadata;

insert into core.freelance_designer (name, status, metadata)
values ('Eli', 'active', '{"issue":"u2giants/popdam3#680"}'::jsonb)
on conflict (normalized_name) do update set name = excluded.name, status = excluded.status, metadata = core.freelance_designer.metadata || excluded.metadata, updated_at = now();

-- No existing roster row carries these names; these are new inactive records by the owner's ruling.
insert into core.creative_designer (name, status, metadata)
select v.name, 'inactive', '{"issue":"u2giants/popdam3#680"}'::jsonb
from unnest(array['Tan','Cliff','Hana','Uta','Ira']) as v(name)
on conflict (normalized_name) do update set status = excluded.status, metadata = core.creative_designer.metadata || excluded.metadata, updated_at = now();

-- No existing roster row carries these names; these are new inactive records by the owner's ruling.
insert into core.technical_designer (name, status, metadata)
select v.name, 'inactive', '{"issue":"u2giants/popdam3#680"}'::jsonb
from unnest(array['Tan','Cliff','Hana','Uta','Ira']) as v(name)
on conflict (normalized_name) do update set status = excluded.status, metadata = core.technical_designer.metadata || excluded.metadata, updated_at = now();

do $$
begin
  if exists (select 1 from core."character")
     and not exists (select 1 from core."character" where id = '90f4dfa8-b4f9-4880-b2f7-e772f5e40ca7' and status = 'active' and name = 'Group Shot' and licensor_id is null) then
    raise exception 'Group Shot character missing';
  end if;
  if (select count(*) from core.creative_designer where normalized_name in ('tan','cliff','hana','uta','ira') and status = 'inactive') <> 5 then
    raise exception 'creative designers not inactivated';
  end if;
  if (select count(*) from core.technical_designer where normalized_name in ('tan','cliff','hana','uta','ira') and status = 'inactive') <> 5 then
    raise exception 'technical designers not inactivated';
  end if;
  if not exists (select 1 from core.freelance_designer where normalized_name = 'eli' and status = 'active') then
    raise exception 'Eli missing';
  end if;
end $$;

-- Grogu part: u2giants/popdam3#680; Star Wars Child and Grogu are one character. Earlier versions never ran in production
-- (the queue skips renames and needs a closing issue). No-op where neither exists, as in preview.
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
