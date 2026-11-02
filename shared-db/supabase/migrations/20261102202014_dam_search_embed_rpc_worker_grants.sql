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
begin;

grant execute on function public.claim_dam_search_embedding_documents(integer, text, integer),
                      public.upsert_dam_search_embedding(text, uuid, text, uuid, extensions.vector, text),
                      public.mark_dam_search_embedding_error(text, uuid, text, uuid, text, text),
                      public.get_dam_search_embedding_status()
  to dam_image_embed_worker;

commit;
