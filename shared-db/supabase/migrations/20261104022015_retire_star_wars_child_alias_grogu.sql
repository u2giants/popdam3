-- popdam3#680, replaces 20261104000346 and 20261104013452, neither applied to production
-- (review findings #5549, #5553). "Child" and "Grogu" are one Star Wars character.
-- Retiring is a status change. Safe if an earlier version removed the Child row in rehearsal.
create table if not exists archive.character_child_grogu_links_20261104 (
  asset_id uuid primary key,
  old_row jsonb not null,
  archived_at timestamptz not null default now()
);
alter table archive.character_child_grogu_links_20261104 enable row level security;

do $$
declare
  c_child constant uuid := '0e5896e5-7813-4f82-a428-d4669504100a';
  c_grogu constant uuid := '5183540b-1ae9-4eeb-9efc-b638deda17ac';
  v_licensor uuid;
  v_child_licensor uuid;
  v_dependents bigint;
begin
  select licensor_id into v_licensor from core."character" where id = c_grogu;
  if v_licensor is null then
    raise exception 'Grogu must exist';
  end if;
  select licensor_id into v_child_licensor from core."character" where id = c_child;
  if v_child_licensor is distinct from v_licensor and v_child_licensor is not null then
    raise exception 'Child and Grogu must share one licensor';
  end if;

  select (select count(*) from core.character_alias where character_id = c_child)
       + (select count(*) from core.property_character_associations where character_id = c_child)
       + (select count(*) from core.property_character_source_edge where character_id = c_child)
       + (select count(*) from plm.item_character_associations where character_id = c_child)
    into v_dependents;
  if v_dependents > 0 then
    raise exception 'Child has % other dependents; handle them first', v_dependents;
  end if;

  insert into archive.character_child_grogu_links_20261104 (asset_id, old_row)
  select l.asset_id, to_jsonb(l)
  from public.asset_licensor_characters l
  where l.character_id = c_child
  on conflict (asset_id) do nothing;

  insert into public.asset_licensor_characters (asset_id, character_id, source, model, tagged_at)
  select l.asset_id, c_grogu, l.source, l.model, l.tagged_at
  from public.asset_licensor_characters l
  where l.character_id = c_child
  on conflict (asset_id, character_id) do nothing;

  delete from public.asset_licensor_characters where character_id = c_child;

  update core."character" set status = 'archived' where id = c_child;

  insert into core.character_alias (character_id, licensor_id, alias, source_system, evidence_notes)
  select c_grogu, v_licensor, 'Child', 'popdam3#680', 'Duplicate name merged into Grogu'
  where not exists (
    select 1 from core.character_alias x
    where x.licensor_id = v_licensor
      and x.normalized_alias = core.normalize_popsg_property_observation('Child')
  );

  if exists (select 1 from public.asset_licensor_characters where character_id = c_child)
     or exists (select 1 from core."character" where id = c_child and status is distinct from 'archived') then
    raise exception 'Child was not retired';
  end if;
end $$;
