-- Issue #2085 (follow-up to #1609): browser clients holding an `authenticated` JWT
-- still cannot record a source resolution, because 20260902024541 delivered only the
-- plm.* setter and no api.* wrapper. PostgREST exposes the api schema alone, so today
-- only service_role paths can write.
-- derived-from: none
-- It re-derives no existing body: api.set_source_resolution is a brand-new object.
-- It does DEPEND on 20260902024541, which created plm.set_source_resolution.
--
-- This wrapper adds NO privilege of its own. Every rule -- the authenticated-actor
-- requirement, the matched-target existence lock, first-writer serialization, the
-- identical-repeat short circuit and the optimistic updated_at token -- stays inside
-- plm.set_source_resolution, and its exceptions propagate to the caller unchanged
-- (42501, 23503, 40001, plus the table's own check violations).

create or replace function api.set_source_resolution(
  p_source_system text,
  p_entity_kind text,
  p_source_id text,
  p_resolution_status text,
  p_core_property_id uuid default null,
  p_core_character_id uuid default null,
  p_core_style_guide_id uuid default null,
  p_dam_asset_id uuid default null,
  p_resolution_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns plm.source_resolution
language plpgsql
security definer
set search_path to pg_catalog
as $$
begin
  -- Thin delegation on purpose. Any validation copied here would be a second,
  -- silently diverging rule set; the setter is the only write path.
  return plm.set_source_resolution(
    p_source_system,
    p_entity_kind,
    p_source_id,
    p_resolution_status,
    p_core_property_id,
    p_core_character_id,
    p_core_style_guide_id,
    p_dam_asset_id,
    p_resolution_reason,
    p_expected_updated_at
  );
end;
$$;

comment on function api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz) is
  'Browser-reachable wrapper over plm.set_source_resolution. Delegates without relaxing anything: the setter still demands an authenticated actor, validates and locks a matched target, serializes first writers, preserves identical repeats, and requires the current updated_at token to replace a decision. Raise codes are the setter''s own.';

revoke all on function api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)
  from public, anon;
grant execute on function api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)
  to authenticated, service_role;

-- Post-apply truth. No row values are read or emitted.
do $$
declare
  v_signature text := 'api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)';
  v_definition text;
begin
  if to_regprocedure(v_signature) is null then
    raise exception 'api.set_source_resolution was not created';
  end if;
  v_definition := lower(pg_get_functiondef(v_signature::regprocedure));
  if position('security definer' in v_definition) = 0 then
    raise exception 'api.set_source_resolution is not security definer';
  end if;
  if position('search_path' in v_definition) = 0
     or position('pg_catalog' in v_definition) = 0 then
    raise exception 'api.set_source_resolution does not pin its search_path';
  end if;
  if position('plm.set_source_resolution' in v_definition) = 0 then
    raise exception 'api.set_source_resolution does not delegate to the plm setter';
  end if;
  if has_function_privilege('anon', v_signature::regprocedure, 'EXECUTE')
     or has_function_privilege('public', v_signature::regprocedure, 'EXECUTE') then
    raise exception 'api.set_source_resolution is reachable without a JWT';
  end if;
  if not has_function_privilege('authenticated', v_signature::regprocedure, 'EXECUTE')
     or not has_function_privilege('service_role', v_signature::regprocedure, 'EXECUTE') then
    raise exception 'api.set_source_resolution is missing its intended grants';
  end if;
end;
$$;
