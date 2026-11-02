-- Contract for issue #5454 (designflow-backend#278): current code beside each ruling's held code.
do $ruling_current_codes$
declare
  v_role text;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'hts_rag' and c.relname = 'hts_rag_ruling_current_codes' and c.relrowsecurity) then
    raise exception 'hts_rag.hts_rag_ruling_current_codes missing or RLS disabled';
  end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_any_column_privilege(v_role, 'hts_rag.hts_rag_ruling_current_codes', 'SELECT') then
      raise exception '% can read hts_rag.hts_rag_ruling_current_codes', v_role;
    end if;
  end loop;
  foreach v_role in array array['designflow_hts_prod_runtime','designflow_hts_alsand_runtime'] loop
    if not has_table_privilege(v_role, 'hts_rag.hts_rag_ruling_current_codes', 'SELECT')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_ruling_current_codes', 'INSERT')
       or has_any_column_privilege(v_role, 'hts_rag.hts_rag_ruling_current_codes', 'UPDATE') then
      raise exception '% must only read hts_rag.hts_rag_ruling_current_codes', v_role;
    end if;
  end loop;
  foreach v_role in array array['designflow_hts_prod_worker','designflow_hts_alsand_worker'] loop
    if not has_table_privilege(v_role, 'hts_rag.hts_rag_ruling_current_codes', 'INSERT')
       or has_column_privilege(v_role, 'hts_rag.hts_rag_ruling_current_codes', 'held_code', 'UPDATE')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_ruling_current_codes', 'DELETE') then
      raise exception '% must insert but never rewrite held_code or delete', v_role;
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'hts_rag'
                  and table_name = 'hts_rag_hts_renumbering' and column_name = 'source_url') then
    raise exception 'hts_rag_hts_renumbering.source_url missing';
  end if;
end
$ruling_current_codes$;
