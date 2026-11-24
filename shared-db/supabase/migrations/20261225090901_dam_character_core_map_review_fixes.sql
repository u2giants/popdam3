-- popcre/shared-db#7002 (review of #7000, stage C1 popcre/shared-db#6994)
-- Fixes to dam.character_core_map before it promotes:
--   1. explicit privileges + admin read policy, like other dam.* tables;
--   2. WWE logos/shows/titles are not characters: their created core.character
--      rows and map rows are removed (they stay unmapped and are listed in the
--      C1 report); only real wrestlers and the Coca-Cola brand marks remain;
--   3. every row created by #6994 gets a core.taxonomy_source_ref witness;
--   4. FK to core.character is ON DELETE RESTRICT, like every other reference;
--   5. an extra alias pass through the canonical normalizer
--      core.normalize_popsg_property_observation (normalized_alias index).
-- Recovery (in this order): drop table dam.character_core_map;
--   delete from core.taxonomy_source_ref where source_system = 'popdam'
--     and source_table = 'public.characters';
--   delete from core.character where metadata->>'issue' = 'popcre/shared-db#6994';

-- 1. Privileges.
revoke all on dam.character_core_map from public, anon, authenticated;
grant select on dam.character_core_map to authenticated;
grant all on dam.character_core_map to service_role;
drop policy if exists character_core_map_admin_read on dam.character_core_map;
create policy character_core_map_admin_read on dam.character_core_map
  for select to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role));

-- 4. FK restrict.
alter table dam.character_core_map
  drop constraint if exists character_core_map_core_character_id_fkey;
alter table dam.character_core_map
  add constraint character_core_map_core_character_id_fkey
  foreign key (core_character_id) references core.character (id) on delete restrict;

-- 2. Remove non-character creations.
create temporary table c1_not_character on commit drop as
select id from core.character
where metadata->>'issue' = 'popcre/shared-db#6994'
  and lower(regexp_replace(trim(name), '\s+', ' ', 'g')) in
    ('wwe logo', 'smackdown logo', 'raw logo', 'wrestlemania', 'nwo',
     'wwe heavyweight championship title');
delete from dam.character_core_map where core_character_id in (select id from c1_not_character);
delete from core.character where id in (select id from c1_not_character);

-- 3. Source witnesses for the remaining creations.
insert into core.taxonomy_source_ref
  (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_name, confidence, raw)
select 'core', 'character', c.id, 'popdam', 'public.characters', c.metadata->>'source_id', c.name, 'verified',
  jsonb_build_object('issue', 'popcre/shared-db#6994',
    'evidence', 'PopDAM tag in use under this licensor; licensor proven by core.licensor code/name')
from core.character c
where c.metadata->>'issue' = 'popcre/shared-db#6994'
on conflict (source_system, source_table, source_id) do nothing;

-- 5. Canonical-normalizer alias pass for still-unmapped characters.
insert into dam.character_core_map (public_character_id, core_character_id, method, confidence)
select ch.id, min(a.character_id::text)::uuid, 'alias', 'high'
from public.characters ch
join public.properties p on p.id = ch.property_id
join (
  select pl.id as public_licensor_id, min(cl.id::text)::uuid as core_licensor_id
  from public.licensors pl
  join core.licensor cl
    on lower(cl.code) = lower(case pl.external_id when 'DS' then 'DY' when 'WWE' then 'WW' else pl.external_id end)
    or lower(trim(cl.name)) = lower(trim(pl.name))
  group by pl.id having count(distinct cl.id) = 1
) l on l.public_licensor_id = p.licensor_id
join core.character_alias a
  on a.licensor_id = l.core_licensor_id
 and a.normalized_alias = core.normalize_popsg_property_observation(ch.name)
where not exists (select 1 from dam.character_core_map m where m.public_character_id = ch.id)
group by ch.id
having count(distinct a.character_id) = 1
on conflict (public_character_id) do nothing;
