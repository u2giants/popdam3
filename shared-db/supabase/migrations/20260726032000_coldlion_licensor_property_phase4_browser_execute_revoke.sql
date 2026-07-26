-- Phase 4 correction: hosted-preview default privileges granted anon and
-- authenticated EXECUTE directly on the newly created three-argument sync
-- functions. REVOKE FROM PUBLIC alone does not remove those explicit grants.
-- Keep the owner-only core ungranted and the guarded write entry points
-- service_role-only.

revoke all on function plm.link_coldlion_licensors_properties_core(jsonb, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function plm.link_coldlion_licensors_properties_approved(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function plm.sync_coldlion_licensors_properties(jsonb, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.sync_coldlion_licensors_properties(jsonb, text, jsonb)
  from public, anon, authenticated;

grant execute on function plm.link_coldlion_licensors_properties_approved(jsonb, jsonb)
  to service_role;
grant execute on function plm.sync_coldlion_licensors_properties(jsonb, text, jsonb)
  to service_role;
grant execute on function public.sync_coldlion_licensors_properties(jsonb, text, jsonb)
  to service_role;
