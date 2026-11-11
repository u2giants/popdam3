-- u2giants/popdam3#804: let search_dam_documents' default_flag_state read the
-- visibility flags from a small index instead of the wide document rows.
-- Production profile 2026-11-11 4:55 AM EST (read-only EXPLAIN ANALYZE of the
-- function body, query "canvas", style groups): default_flag_state does one
-- dam_search_documents_pkey lookup per candidate (8,196), each fetching a
-- ~2.6 KB heap row (the row carries the 768-d embedding) to read five small
-- columns. Cold: 4.7 s of a 9.2 s body (26,802 blocks read); warm: 86 ms.
-- This index carries exactly the columns that step reads, so it can be an
-- index-only scan over a structure small enough to stay in cache.
-- No function change: the planner picks it by cost. Additive only.
begin;
set local lock_timeout='500ms';
set local statement_timeout='120s';
set local search_path=pg_catalog,public,extensions;

create index if not exists dam_search_documents_default_flag_cover_idx
  on public.dam_search_documents (document_type, entity_id)
  include (has_default_visible_member, default_visible_member_count,
           default_visible_min_date, asset_id, style_group_id);

commit;
