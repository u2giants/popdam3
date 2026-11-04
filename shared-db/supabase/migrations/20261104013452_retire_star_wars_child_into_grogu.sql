-- popdam3#680, replaces 20261104000346 before it reached production (review finding #5549).
-- "Child" and "Grogu" are one Star Wars character. Retiring is a status change, never a delete.
create table archive.character_child_grogu_links_20261104 (
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
begin
  select g.licensor_id into v_licensor
  from core."character" g
  join core."character" c on c.id = c_child and c.licensor_id = g.licensor_id
  where g.id = c_grogu;
  if v_licensor is null then
    raise exception 'Child and Grogu must both exist under one licensor';
  end if;

  insert into archive.character_child_grogu_links_20261104 (asset_id, old_row)
  select l.asset_id, to_jsonb(l)
  from public.asset_licensor_characters l
  where l.character_id = c_child;

  insert into public.asset_licensor_characters (asset_id, character_id, source, model, tagged_at)
  select l.asset_id, c_grogu, l.source, l.model, l.tagged_at
  from public.asset_licensor_characters l
  where l.character_id = c_child
  on conflict (asset_id, character_id) do nothing;

  delete from public.asset_licensor_characters where character_id = c_child;

  update core."character" set status = 'archived' where id = c_child;

  if exists (select 1 from public.asset_licensor_characters where character_id = c_child)
     or (select status::text from core."character" where id = c_child) <> 'archived' then
    raise exception 'Child was not retired';
  end if;
end $$;
