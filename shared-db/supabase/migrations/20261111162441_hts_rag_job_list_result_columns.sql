-- derived-from: none
-- u2giants/popdam3#804 task 5 (claim popcre/shared-db#6054): the DesignFlow
-- backend HTS job-list poll reads about 13 JSON paths of `result` per job row
-- and 3 more per page row. `result` averages ~280 KB of JSON text per row,
-- stored out of line and compressed, and every path read decompresses the
-- whole value again. Production, read-only, 2026-11-11 ~11:30 AM EST: 224
-- sandbox-environment rows cost 4.2-4.6 s per poll (~5,000 s/day); three path
-- reads alone measure 838 ms; a single decompression per row still costs
-- ~0.3-0.5 s and grows with every job.
--
-- These three stored generated columns hold exactly the small pieces the list
-- reads (at most ~4 KB, ~300 bytes and ~50 bytes per row), so the poll never
-- opens `result`. Postgres maintains them on every insert/update of `result`;
-- no application write changes. Additive only.
--
-- Access: both worker roles hold table-level SELECT and INSERT, which covers
-- new columns; their UPDATE is column-scoped and deliberately not extended
-- (generated columns cannot be written). The contract in
-- supabase/tests/hts_rag_classification_jobs_contract.sql is unchanged.
--
-- One ALTER = one table rewrite (40 MB including out-of-line data, 236 rows)
-- under ACCESS EXCLUSIVE; bounded by lock_timeout so a busy poll makes the
-- apply fail and retry instead of queueing other sessions.
-- Rollback: alter table ... drop column result_public, drop column
-- result_system_check, drop column result_core_phrase (after the backend
-- stops reading them).
begin;
set local lock_timeout='3s';
set local statement_timeout='120s';
set local search_path=pg_catalog;

alter table hts_rag.hts_rag_classification_jobs
  add column if not exists result_public jsonb
    generated always as (result -> 'public') stored,
  add column if not exists result_system_check jsonb
    generated always as (result -> 'automated_system_check') stored,
  add column if not exists result_core_phrase jsonb
    generated always as (result #> '{request_snapshot,evidence,coreProductType,phrase}') stored;

comment on column hts_rag.hts_rag_classification_jobs.result_public is
  'Generated copy of result->''public'' for the job list; never read result in list polls (popdam3#804).';
comment on column hts_rag.hts_rag_classification_jobs.result_system_check is
  'Generated copy of result->''automated_system_check'' for the job list (popdam3#804).';
comment on column hts_rag.hts_rag_classification_jobs.result_core_phrase is
  'Generated copy of result#>''{request_snapshot,evidence,coreProductType,phrase}'' for the job list (popdam3#804).';

do $verify$
declare
  v_role text;
begin
  if (select count(*) from pg_attribute
      where attrelid = 'hts_rag.hts_rag_classification_jobs'::regclass
        and attname in ('result_public', 'result_system_check', 'result_core_phrase')
        and atttypid = 'jsonb'::regtype and attgenerated = 's' and not attisdropped) <> 3 then
    raise exception 'VERIFY FAILED: three stored generated jsonb columns expected';
  end if;
  if exists (select 1 from hts_rag.hts_rag_classification_jobs
      where result_public is distinct from (result -> 'public')
         or result_system_check is distinct from (result -> 'automated_system_check')
         or result_core_phrase is distinct from
            (result #> '{request_snapshot,evidence,coreProductType,phrase}')) then
    raise exception 'VERIFY FAILED: generated columns differ from result';
  end if;
  foreach v_role in array array['designflow_hts_prod_worker', 'designflow_hts_alsand_worker'] loop
    if exists (select 1 from pg_roles where rolname = v_role) and (
         not has_column_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', 'result_public', 'SELECT')
      or not has_column_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', 'result_system_check', 'SELECT')
      or not has_column_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', 'result_core_phrase', 'SELECT')
      or has_column_privilege(v_role, 'hts_rag.hts_rag_classification_jobs', 'result_public', 'UPDATE')) then
      raise exception 'VERIFY FAILED: worker access to generated columns for %', v_role;
    end if;
  end loop;
end
$verify$;

commit;
