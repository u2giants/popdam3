-- derived-from: none
-- Issue #5622; application u2giants/popdam3#706 and #663.
-- One atomic CLI file: fail closed rather than hold up normal tagging saves.
set local lock_timeout = '500ms';
set local statement_timeout = '2500ms';
set local transaction_timeout = '3s';

create index dam_search_health_errored_idx on public.dam_search_documents(entity_id)
where embedding_error is not null;
