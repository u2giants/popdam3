-- Verification for migration 20261225090801_dam_character_core_map (popcre/shared-db#6994).
-- Read-only; rolls back.
-- Proves: the map exists with RLS on, targets core.character, and never maps
-- a PopDAM character to a core.character of a different licensor.
begin;

do $$
declare
  v_cross bigint;
begin
  if to_regclass('dam.character_core_map') is null then
    raise exception 'dam.character_core_map missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'dam.character_core_map'::regclass) then
    raise exception 'dam.character_core_map must have RLS enabled';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'dam.character_core_map'::regclass and contype = 'f'
      and confrelid = 'core.character'::regclass) then
    raise exception 'dam.character_core_map.core_character_id must reference core.character';
  end if;

  select count(*) into v_cross
  from dam.character_core_map m
  join public.characters c on c.id = m.public_character_id
  join public.properties p on p.id = c.property_id
  join public.licensors pl on pl.id = p.licensor_id
  join core.character cc on cc.id = m.core_character_id
  join core.licensor cl on cl.id = cc.licensor_id
  where not (lower(cl.code) = lower(case pl.external_id when 'DS' then 'DY' when 'WWE' then 'WW' else pl.external_id end)
             or lower(trim(cl.name)) = lower(trim(pl.name)));
  if v_cross <> 0 then
    raise exception 'dam.character_core_map has % cross-licensor rows', v_cross;
  end if;
end $$;

rollback;
