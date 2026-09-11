-- Issue #2493. Version reserved by migration-author claim #2524.
-- derived-from: 20260907051735
--
-- Complete the read contract for the licensor and franchise resolution kinds added by
-- 20260907051735. The original five-argument target helper and both ten-argument setters
-- remain compatibility surfaces: repository and mirrored consumer contract suites still
-- call the setters with four through ten arguments, and the production catalog verifier
-- pins the old helper and PLM setter signatures. New-kind reads use a separate seven-
-- argument helper so no existing call becomes ambiguous.

create or replace function plm.source_resolution_target_missing(
  p_entity_kind text,
  p_core_property_id uuid,
  p_core_character_id uuid,
  p_core_style_guide_id uuid,
  p_dam_asset_id uuid,
  p_core_licensor_id uuid,
  p_core_franchise_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path to pg_catalog
as $function$
declare
  v_found boolean := false;
begin
  case p_entity_kind
    when 'property' then
      if to_regclass('core.property') is null then return true; end if;
      execute 'select true from core.property where id = $1'
        into v_found using p_core_property_id;
    when 'character' then
      if to_regclass('core.character') is null then return true; end if;
      execute 'select true from core.character where id = $1'
        into v_found using p_core_character_id;
    when 'style_guide' then
      if to_regclass('core.style_guide') is null then return true; end if;
      execute 'select true from core.style_guide where id = $1'
        into v_found using p_core_style_guide_id;
    when 'asset' then
      if to_regclass('dam.asset') is null then return true; end if;
      execute 'select true from dam.asset where id = $1'
        into v_found using p_dam_asset_id;
    when 'licensor' then
      if to_regclass('core.licensor') is null then return true; end if;
      execute 'select true from core.licensor where id = $1'
        into v_found using p_core_licensor_id;
    when 'franchise' then
      if to_regclass('core.franchise') is null then return true; end if;
      execute 'select true from core.franchise where id = $1'
        into v_found using p_core_franchise_id;
    else
      return true;
  end case;

  return not coalesce(v_found, false);
end;
$function$;

comment on function plm.source_resolution_target_missing(
  text,uuid,uuid,uuid,uuid,uuid,uuid) is
  'Reports whether the selected canonical target is absent for all six source-resolution '
  'entity kinds. The five-argument overload remains for compatibility; current reads use '
  'this six-kind overload.';

revoke all on function plm.source_resolution_target_missing(
  text,uuid,uuid,uuid,uuid,uuid,uuid) from public, anon;
grant execute on function plm.source_resolution_target_missing(
  text,uuid,uuid,uuid,uuid,uuid,uuid) to authenticated, service_role;

create or replace view api.source_resolution
with (security_invoker = true)
as
select r.source_system,
       r.entity_kind,
       r.source_id,
       r.core_property_id,
       r.core_character_id,
       r.core_style_guide_id,
       r.dam_asset_id,
       r.resolution_status,
       r.resolution_reason,
       r.resolved_at,
       r.resolved_by,
       r.updated_at,
       case when r.resolution_status = 'matched'
         then plm.source_resolution_target_missing(
           r.entity_kind,
           r.core_property_id,
           r.core_character_id,
           r.core_style_guide_id,
           r.dam_asset_id,
           r.core_licensor_id,
           r.core_franchise_id)
         else false
       end as target_missing,
       r.core_licensor_id,
       r.core_franchise_id
from plm.source_resolution r;

comment on view api.source_resolution is
  'Authenticated durable decision read path for property, character, style guide, asset, '
  'licensor and franchise decisions. target_missing keeps dangling decisions visible; '
  'consumers must LEFT JOIN and must not treat a missing target as an absent decision.';

-- Keep both ten-argument setters unchanged. Repository and mirrored consumer callers use
-- their defaults, and the PLM routine's body is part of the established serialization and
-- optimistic-concurrency contract. The twelve-argument overloads remain the write route for
-- licensor and franchise decisions.

-- Catalog-only post-apply truth. No application rows are read or emitted.
do $verification$
declare
  v_old_plm regprocedure := to_regprocedure(
    'plm.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)');
  v_old_api regprocedure := to_regprocedure(
    'api.set_source_resolution(text,text,text,text,uuid,uuid,uuid,uuid,text,timestamptz)');
  v_new_helper regprocedure := to_regprocedure(
    'plm.source_resolution_target_missing(text,uuid,uuid,uuid,uuid,uuid,uuid)');
  v_view_definition text;
begin
  if v_old_plm is null or v_old_api is null or v_new_helper is null then
    raise exception 'source-resolution compatibility or six-kind read routine is missing';
  end if;

  if not has_function_privilege('authenticated', v_new_helper, 'execute')
     or has_function_privilege('anon', v_new_helper, 'execute')
     or has_function_privilege('public', v_new_helper, 'execute') then
    raise exception 'six-kind target helper grants do not match the authenticated read contract';
  end if;

  select lower(pg_get_viewdef('api.source_resolution'::regclass, true))
    into v_view_definition;
  if position('core_licensor_id' in v_view_definition) = 0
     or position('core_franchise_id' in v_view_definition) = 0
     or position('source_resolution_target_missing' in v_view_definition) = 0 then
    raise exception 'api.source_resolution does not expose and validate the two new targets';
  end if;

  if position('pg_advisory_xact_lock' in lower(pg_get_functiondef(v_old_plm))) = 0
     or position('plm.set_source_resolution' in lower(pg_get_functiondef(v_old_api))) = 0 then
    raise exception 'legacy setter compatibility or serialization contract changed';
  end if;
end;
$verification$;
