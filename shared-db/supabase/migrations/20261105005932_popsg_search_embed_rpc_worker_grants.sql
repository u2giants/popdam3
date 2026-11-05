-- Work issue #5606, version 20261105005932; application issue u2giants/popdam3#706.
-- derived-from: none
-- style_guide_search_documents.embedding is the image vector of the thumbnail
-- (20261027012301). Grant the GPU poller the four PopSG embedding RPCs, as
-- 20261102202014 did for DAM. No function body, table, policy or data changes.
begin;

grant execute on function public.claim_sg_search_embedding_documents(integer, text, integer),
                      public.upsert_sg_search_embedding(uuid, text, uuid, extensions.vector, text),
                      public.mark_sg_search_embedding_error(uuid, text, uuid, text, text),
                      public.get_sg_search_embedding_status()
  to dam_image_embed_worker;

commit;
