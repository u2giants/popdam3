-- popdam3#680: "Child" and "Grogu" are one Star Wars character. Keep Grogu, keep the old
-- name as an alias, move file links, remove the duplicate. Old row kept in archive for undo.
begin;

create table if not exists archive.character_child_grogu_merge_20261104 as
  select now() as archived_at, to_jsonb(c) as old_row
  from core."character" c
  where c.id = '0e5896e5-7813-4f82-a428-d4669504100a';

insert into public.asset_licensor_characters (asset_id, character_id, source, model, tagged_at)
select l.asset_id, '5183540b-1ae9-4eeb-9efc-b638deda17ac', l.source, l.model, l.tagged_at
from public.asset_licensor_characters l
where l.character_id = '0e5896e5-7813-4f82-a428-d4669504100a'
on conflict (asset_id, character_id) do nothing;

insert into core.character_alias (character_id, licensor_id, alias, source_system, evidence_notes)
select '5183540b-1ae9-4eeb-9efc-b638deda17ac', c.licensor_id, 'Child', 'popdam3#680', 'Duplicate name merged into Grogu'
from core."character" c
where c.id = '5183540b-1ae9-4eeb-9efc-b638deda17ac'
  and not exists (
    select 1 from core.character_alias x
    where x.character_id = c.id and lower(x.alias) = 'child'
  );

delete from public.asset_licensor_characters
where character_id = '0e5896e5-7813-4f82-a428-d4669504100a';

delete from core."character"
where id = '0e5896e5-7813-4f82-a428-d4669504100a';

commit;
