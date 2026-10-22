-- Contract for hts_rag.hts_rag_ruling_ingest_jobs (issue #4588).
do $ruling_ingest_jobs$
declare
  t regclass := 'hts_rag.hts_rag_ruling_ingest_jobs'::regclass;
begin
  if not exists (select 1 from pg_class where oid = t and relkind = 'r' and relrowsecurity) then
    raise exception 'table missing or RLS disabled';
  end if;
  if (select string_agg(attname, ',' order by attnum) from pg_attribute where attrelid = t and attnum > 0 and not attisdropped)
     is distinct from 'id,ruling_number,source_determination_id,source_environment,status,attempt_count,max_attempts,claimed_by,claimed_at,lease_expires_at,error_code,error_detail,created_at,updated_at,completed_at' then
    raise exception 'column list differs';
  end if;
  if exists (select 1 from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid = t and a.attname = 'source_environment') then
    raise exception 'source_environment must have no default';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'hts_rag' and indexname = 'hts_rag_ruling_ingest_jobs_open_uq'
      and indexdef like 'CREATE UNIQUE INDEX % (source_environment, ruling_number) WHERE (status = ANY (ARRAY[''pending''::text, ''claimed''::text]))')
     or not exists (select 1 from pg_indexes where schemaname = 'hts_rag' and indexname = 'hts_rag_ruling_ingest_jobs_claim_idx'
      and indexdef like '% (status, lease_expires_at) WHERE (status = ANY (ARRAY[''pending''::text, ''claimed''::text]))')
     or not exists (select 1 from pg_indexes where schemaname = 'hts_rag' and indexname = 'hts_rag_ruling_ingest_jobs_source_determination_idx'
      and indexdef like '% (source_determination_id)') then
    raise exception 'index definitions differ';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = t and contype = 'f'
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (source_determination_id) REFERENCES hts_rag.hts_rag_determinations(id) ON DELETE SET NULL') then
    raise exception 'determination FK differs';
  end if;
  if (select count(*) from pg_policies where schemaname = 'hts_rag' and tablename = 'hts_rag_ruling_ingest_jobs') <> 6
     or not exists (select 1 from pg_trigger where tgrelid = t and tgname = 'set_updated_at' and not tgisinternal
      and tgfoid = 'app.set_updated_at()'::regprocedure) then
    raise exception 'policies or trigger differ';
  end if;
  if has_table_privilege('anon', t, 'SELECT') or has_table_privilege('authenticated', t, 'SELECT')
     or has_table_privilege('designflow_hts_prod_runtime', t, 'SELECT')
     or has_table_privilege('designflow_hts_prod_worker', t, 'DELETE') then
    raise exception 'privileges too broad';
  end if;
end
$ruling_ingest_jobs$;
