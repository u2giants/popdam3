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

-- Privileges, FK behaviour and domain checks (#7002).
do $$
declare v_lic uuid; v_core uuid; v_pl uuid; v_pp uuid; v_pc uuid;
begin
  if has_table_privilege('anon', 'dam.character_core_map', 'select') then
    raise exception 'anon must not read dam.character_core_map';
  end if;
  if has_table_privilege('authenticated', 'dam.character_core_map', 'insert') then
    raise exception 'authenticated must not write dam.character_core_map';
  end if;
  if not has_table_privilege('service_role', 'dam.character_core_map', 'insert') then
    raise exception 'service_role must maintain dam.character_core_map';
  end if;
  if (select confdeltype from pg_constraint
      where conrelid = 'dam.character_core_map'::regclass and confrelid = 'core.character'::regclass) <> 'r' then
    raise exception 'core_character_id FK must be ON DELETE RESTRICT';
  end if;
  if exists (select 1 from core.character where metadata->>'issue' = 'popcre/shared-db#6994'
             and lower(name) ~ '(logo|wrestlemania|^nwo$|title)') then
    raise exception 'non-character WWE tags were created as characters';
  end if;
  if exists (select 1 from core.character c where c.metadata->>'issue' = 'popcre/shared-db#6994'
             and not exists (select 1 from core.taxonomy_source_ref r where r.entity_id = c.id)) then
    raise exception 'created character lacks a taxonomy_source_ref witness';
  end if;

  -- Fixture: method domain is enforced.
  select id into v_core from core.character limit 1;
  select id into v_pc from public.characters
   where id not in (select public_character_id from dam.character_core_map) limit 1;
  if v_core is not null and v_pc is not null then
    begin
      insert into dam.character_core_map (public_character_id, core_character_id, method, confidence)
      values (v_pc, v_core, 'name_only_guess', 'high');
      raise exception 'method domain not enforced';
    exception when check_violation then null;
    end;
  end if;
end $$;

rollback;
