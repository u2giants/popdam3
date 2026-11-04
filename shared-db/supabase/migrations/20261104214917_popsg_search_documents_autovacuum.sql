-- Version: 20261104214917
-- derived-from: none
-- Issue: popcre/shared-db#4437 (app u2giants/popdam3#706).
-- The claim walks idx_sg_search_documents_claim_pending in queue order, so every
-- embedded row leaves a dead entry exactly where the next claim starts. At the
-- default 20% threshold (~47k dead rows) that walk exceeded the 8s PostgREST
-- limit: 57014 ended the backfill on 2026-10-28. Live proof 2026-11-04: 44,887
-- heap fetches and 5.4s for a 100-row walk, 360 and 0.9s once entries were cleared.
-- Vacuum this table about every 2,000 updates so the walk stays short.
alter table public.style_guide_search_documents set (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 2000,
  autovacuum_analyze_scale_factor = 0.02
);

-- The larger cause, same day: with FOR UPDATE the planner estimates one row and
-- picks a hash join plus a sort of every pending document (79k rows, 38.9s live)
-- instead of walking the ordered index until the limit (4.2s cold on the same
-- rows). Pin the ordered walk on this function only; its body stays unchanged.
alter function public.claim_sg_search_embedding_documents(integer, text, integer)
  set enable_hashjoin = off;
alter function public.claim_sg_search_embedding_documents(integer, text, integer)
  set enable_mergejoin = off;
alter function public.claim_sg_search_embedding_documents(integer, text, integer)
  set enable_sort = off;
