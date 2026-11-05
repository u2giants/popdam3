-- derived-from: none
-- Issue #5622; application u2giants/popdam3#706 and #663.
-- One atomic CLI file: fail closed rather than hold up normal tagging saves.
set local lock_timeout = '500ms';
set local statement_timeout = '2500ms';
set local transaction_timeout = '3s';

create index sg_search_health_last_write_idx on public.style_guide_search_documents(embedding_updated_at desc)
where is_active and embedding_updated_at is not null;
