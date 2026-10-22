-- #4643 (follow-up of #4573 / PopDAM #97): retire the text indexes on
-- public.dam_search_documents that no reader uses any more.
--
-- 20261021223359 moved every keyword leg of public.search_dam_documents onto
-- the narrow key table public.dam_search_keys, which carries its own GIN
-- full-text and trigram indexes. dam_search_documents is now read only by
-- primary key (and by the embedding indexes for the semantic leg), so these
-- five indexes (~240 MB on production) are pure write overhead on every
-- search-document refresh.
--
-- Kept: primary key, embedding HNSW, embedding-claim index, asset_id and
-- style_group_id btrees, and the search_tsv column itself (still maintained
-- and copied into dam_search_keys by trigger).
--
-- DROP INDEX takes a brief ACCESS EXCLUSIVE lock; lock_timeout makes the
-- migration fail fast instead of queueing behind long readers.

set local lock_timeout = '5s';

drop index if exists public.idx_dam_search_documents_tsv;
drop index if exists public.idx_dam_search_documents_title_trgm;
drop index if exists public.idx_dam_search_documents_path_trgm;
drop index if exists public.idx_dam_search_documents_customer_trgm;
drop index if exists public.idx_dam_search_documents_program_trgm;
