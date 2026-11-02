-- Work issue #5492 (claim #5493, version 20261102202014); application issue
-- u2giants/popdam3#646 (cure (d) of #616).
-- derived-from: none
-- Grant the GPU poller's DB login (dam_image_embed_login, member of the
-- NOLOGIN role dam_image_embed_worker) execute on the four DAM
-- search-document embedding RPCs, so the durable search lane in
-- apps/image-embed-worker (u2giants/popdam3 PR #662) can claim, embed and
-- upsert through the documented functions with its own dedicated credential
-- instead of the shared postgres password — whose 2026-11-01 rotation
-- silently killed the previous nightly one-shot runner (stale DSN on the
-- GPU box, popdam3 #646 diagnosis 2026-11-02). Mirrors the dam.* worker
-- grants of 20261025163955. No function body, table, policy or data
-- changes; EXECUTE privilege is the authorization boundary being extended.
--
-- Guard interaction (review finding #5496, informational): these four RPCs
-- gate on `auth.role() <> 'service_role'`, which is NULL for a direct
-- Postgres login (no JWT), so the in-function guard does not fire for the
-- worker login and EXECUTE privilege is the real boundary for it. Do NOT
-- "harden" that guard to `is distinct from 'service_role'` without also
-- adding an explicit allowance for dam_image_embed_worker: that would break
-- the durable search lane with SQLSTATE 42501 (the lane cools down and
-- vectors re-starve).
--
-- ACL fragility (review finding #5496, medium): the defining migrations use
-- `drop function if exists` + `create function`, which discards the ACL —
-- a future re-creation of any of these four functions silently strips the
-- worker grant. The DO block below refuses to apply in that state only at
-- THIS migration's point in time; durable regression cover is pinned by
-- supabase/tests/dam_search_embed_worker_execute_grants_contracts.sql.
begin;

grant execute on function public.claim_dam_search_embedding_documents(integer, text, integer),
                      public.upsert_dam_search_embedding(text, uuid, text, uuid, extensions.vector, text),
                      public.mark_dam_search_embedding_error(text, uuid, text, uuid, text, text),
                      public.get_dam_search_embedding_status()
  to dam_image_embed_worker;

-- Explicit rather than inherited-by-PUBLIC: repeated public-schema hardening
-- could revoke the default USAGE and strand the worker with
-- `permission denied for schema public` (review finding #5496, low/medium).
grant usage on schema public to dam_image_embed_worker;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dam_image_embed_worker') then
    raise exception 'role dam_image_embed_worker is missing; run 20261025163955 first';
  end if;
  if not has_function_privilege('dam_image_embed_worker', 'public.claim_dam_search_embedding_documents(integer, text, integer)', 'execute')
     or not has_function_privilege('dam_image_embed_worker', 'public.upsert_dam_search_embedding(text, uuid, text, uuid, extensions.vector, text)', 'execute')
     or not has_function_privilege('dam_image_embed_worker', 'public.mark_dam_search_embedding_error(text, uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('dam_image_embed_worker', 'public.get_dam_search_embedding_status()', 'execute') then
    raise exception 'grant 20261102202014 did not leave dam_image_embed_worker with execute on all four dam_search embedding RPCs';
  end if;
  if has_function_privilege('anon', 'public.claim_dam_search_embedding_documents(integer, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_dam_search_embedding_documents(integer, text, integer)', 'execute') then
    raise exception 'client roles must not gain execute on claim_dam_search_embedding_documents through 20261102202014';
  end if;
end
$$;

commit;
