-- Preview rehearsal exposed PL/pgSQL ambiguity between RETURNS TABLE output
-- names and ON CONFLICT column names. Name the existing unique constraint
-- explicitly so the atomic merge path is unambiguous.

create or replace function api.pm_upsert_view_pref(
  p_scope text,
  p_patch jsonb
)
returns table (
  id uuid,
  profile_id uuid,
  scope text,
  config jsonb,
  updated_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pim, app
as $$
declare
  v_profile_id uuid := app.current_profile_id();
begin
  if v_profile_id is null then
    raise exception using errcode = '42501', message = 'PM_PROFILE_REQUIRED';
  end if;

  if p_scope is null or p_scope !~ '^view:[0-9a-fA-F-]{36}$' then
    raise exception using errcode = '22023', message = 'PM_VIEW_PREF_SCOPE_INVALID';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'PM_VIEW_PREF_PATCH_OBJECT_REQUIRED';
  end if;

  return query
  insert into pim.view_pref as pref (profile_id, scope, config, updated_at)
  values (v_profile_id, p_scope, p_patch, clock_timestamp())
  on conflict on constraint view_pref_profile_id_scope_key do update
  set config = pref.config || excluded.config,
      updated_at = excluded.updated_at
  returning pref.id, pref.profile_id, pref.scope, pref.config, pref.updated_at;
end;
$$;

revoke all on function api.pm_upsert_view_pref(text, jsonb) from public, anon;
grant execute on function api.pm_upsert_view_pref(text, jsonb) to authenticated;

comment on function api.pm_upsert_view_pref(text, jsonb) is
  'Atomically merges the current profile saved-view preference using the named unique (profile_id, scope) constraint. Security-invoker table grants remain constrained by pim.pm_write RLS.';
