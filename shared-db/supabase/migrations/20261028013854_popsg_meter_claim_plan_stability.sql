-- Version: 20261028013854
-- derived-from: none
-- Issue: popcre/shared-db#4437 (app u2giants/popdam3#107), claim #4820 follow-up.
-- Production flapping incident (2026-10-27 evening, after 20261027183509 applied):
-- get_sg_search_embedding_status timed out intermittently (SQLSTATE 57014 via
-- PostgREST; timeout/timeout/success pattern) and claim_sg_search_embedding_documents
-- hit 57014 once at 21:27Z, on a QUIET database with all seven meter indexes
-- indisvalid+indisready. EXPLAIN on production showed the mechanism:
--
--   * the meter's pending bucket walks idx_sg_search_documents_meter_pending
--     (146k entries) as a NESTED LOOP doing one PER-ROW probe into
--     style_guide_files by primary key WITH FILTER (thumbnail_url IS NOT NULL) --
--     thumbnail_url sits in no index, so every probe is a heap fetch on a 340k-row
--     table; warm cache absorbs ~146k random fetches, a cold cache does not;
--   * the meter's waiting bucket plans a Parallel HASH ANTI JOIN whose inner side
--     is a full SEQ SCAN of style_guide_files on every call;
--   * the claim's candidates CTE plans a Parallel HASH JOIN over 113k WIDE
--     style_guide_files heap rows against 146k WIDE document heap rows (the
--     d-side retry/lease/freshness columns are not covered by
--     idx_sg_search_documents_meter_pending), then a full SORT for the ordered
--     LIMIT -- instead of walking the ordered index and probing until the limit.
--
-- Fix: two covering indexes, ZERO function-body changes. Both reviewed bodies
-- (meter md5 0366a4d0bddee2c5a8b8f2d4ba73c69a, claim md5
-- 1c6af615af8ecc225cbc57638bd4fd9c, pinned by foundation contract 13) stay
-- byte-identical; the plans simply stop touching either heap:
--
--   * idx_style_guide_files_thumbnail_live makes the files-side liveness lookup
--     index-only (id key, is_active included, partial on thumbnail_url IS NOT
--     NULL): the meter's pending EXISTS becomes an index-only probe, the waiting
--     anti-join inner becomes a ~6 MB index-only scan instead of a files seq
--     scan, and the claim's f-side (id + is_active) is served from the index;
--   * idx_sg_search_documents_claim_pending covers the claim's ordered candidate
--     walk (document_updated_at, style_guide_file_id key; thumbnail_url,
--     embedding_next_retry_at, embedding_lease_expires_at included; same
--     predicate as idx_sg_search_documents_meter_pending), so every d-side
--     filter and the freshness value are in-index and neither plan shape --
--     nested loop with early termination or hash join -- reads the table heap.
--
-- Index builds are non-concurrent inside the migration transaction (brief
-- ShareLock on each table; readers unaffected; the embedding backfill restarts
-- absorb the write pause).

set statement_timeout = '15min';

create index if not exists idx_style_guide_files_thumbnail_live
  on public.style_guide_files using btree (id)
  include (is_active)
  where thumbnail_url is not null;

create index if not exists idx_sg_search_documents_claim_pending
  on public.style_guide_search_documents using btree (document_updated_at, style_guide_file_id)
  include (thumbnail_url, embedding_next_retry_at, embedding_lease_expires_at)
  where is_active and content_sha256 is not null and embedding is null
    and embedding_attempts < embedding_max_attempts
    and embedding_error_category is distinct from 'permanent';

do $stability_verify$
begin
  -- The reviewed meter and claim bodies must be byte-identical to the ones
  -- contract 13 pins: this follow-up changes plans, never semantics.
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.get_sg_search_embedding_status()')
       and md5(p.prosrc) = '0366a4d0bddee2c5a8b8f2d4ba73c69a'
  ) or not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.claim_sg_search_embedding_documents(integer,text,integer)')
       and md5(p.prosrc) = '1c6af615af8ecc225cbc57638bd4fd9c'
  ) then
    raise exception 'meter/claim body drifted; the plan-stability fix must not alter function bodies';
  end if;
  if exists (select 1 from (values
      ('idx_style_guide_files_thumbnail_live',
       $def$CREATE INDEX idx_style_guide_files_thumbnail_live ON public.style_guide_files USING btree (id) INCLUDE (is_active) WHERE (thumbnail_url IS NOT NULL)$def$),
      ('idx_sg_search_documents_claim_pending',
       $def$CREATE INDEX idx_sg_search_documents_claim_pending ON public.style_guide_search_documents USING btree (document_updated_at, style_guide_file_id) INCLUDE (thumbnail_url, embedding_next_retry_at, embedding_lease_expires_at) WHERE (is_active AND (content_sha256 IS NOT NULL) AND (embedding IS NULL) AND (embedding_attempts < embedding_max_attempts) AND (embedding_error_category IS DISTINCT FROM 'permanent'::text))$def$)
    ) wanted(name, def) where (select pg_get_indexdef(c.oid)
                                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                where c.relname = wanted.name and n.nspname = 'public'
                                  and c.relkind = 'i') is distinct from wanted.def)
  then
    raise exception 'a plan-stability index is missing or its definition changed';
  end if;
end
$stability_verify$;
