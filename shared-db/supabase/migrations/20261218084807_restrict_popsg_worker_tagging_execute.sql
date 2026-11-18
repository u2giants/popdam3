-- #6657: reissue the evidenced worker-only subset of the retired #6655.
-- #6690 quarantines the original, which was absent in both hosted ledgers.
-- The July tagging contracts granted only service_role on these exact
-- signatures. Their deployed bodies also enforce that service identity.
-- Keep all existing caller grants outside these three worker routines.
-- Rollback: restore EXECUTE to authenticated on these exact signatures
-- through a new migration if a supported caller needs that access.

revoke execute on function public.get_style_guide_deterministic_tag_batch(uuid, integer, boolean)
  from public, anon, authenticated;
revoke execute on function public.replace_style_guide_deterministic_tags(uuid, jsonb, text, text)
  from public, anon, authenticated;
revoke execute on function public.replace_style_guide_folder_consensus_tags(uuid, jsonb, text)
  from public, anon, authenticated;
