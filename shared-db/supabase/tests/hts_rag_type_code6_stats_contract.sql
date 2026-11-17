-- Contract issue #6590 (designflow-backend#278): 6-digit code stats read model.
do $code6$
declare
  v_role text;
begin
  if not exists (select 1 from pg_matviews where schemaname = 'hts_rag' and matviewname = 'hts_rag_type_code6_stats') then
    raise exception 'hts_rag.hts_rag_type_code6_stats materialized view missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'hts_rag' and indexname = 'hts_rag_type_code6_stats_uq') then
    raise exception 'unique index for concurrent refresh missing';
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'designflow_hts_prod_runtime', 'designflow_hts_alsand_runtime'] loop
    if has_table_privilege(v_role, 'hts_rag.hts_rag_type_code6_stats', 'SELECT') then
      raise exception '% must not read hts_rag_type_code6_stats', v_role;
    end if;
    if has_function_privilege(v_role, 'hts_rag.hts_rag_refresh_type_code6_stats()', 'EXECUTE') then
      raise exception '% must not refresh hts_rag_type_code6_stats', v_role;
    end if;
  end loop;
  foreach v_role in array array['designflow_hts_prod_worker', 'designflow_hts_alsand_worker'] loop
    if not has_table_privilege(v_role, 'hts_rag.hts_rag_type_code6_stats', 'SELECT')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_type_code6_stats', 'INSERT')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_type_code6_stats', 'DELETE') then
      raise exception '% must only read hts_rag_type_code6_stats', v_role;
    end if;
    if not has_function_privilege(v_role, 'hts_rag.hts_rag_refresh_type_code6_stats()', 'EXECUTE') then
      raise exception '% must be able to refresh hts_rag_type_code6_stats', v_role;
    end if;
  end loop;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'hts_rag' and p.proname = 'hts_rag_refresh_type_code6_stats' and p.prosecdef) then
    raise exception 'refresh routine must be SECURITY DEFINER';
  end if;
end;
$code6$;
