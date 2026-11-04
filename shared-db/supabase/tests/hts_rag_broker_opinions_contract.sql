-- Contract for issue #5566 (designflow-backend#278): broker opinion, authoritative override.
do $broker_opinions$
declare
  v_role text;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'hts_rag' and c.relname = 'hts_rag_broker_opinions' and c.relrowsecurity) then
    raise exception 'hts_rag.hts_rag_broker_opinions missing or RLS disabled';
  end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_any_column_privilege(v_role, 'hts_rag.hts_rag_broker_opinions', 'SELECT') then
      raise exception '% can read hts_rag.hts_rag_broker_opinions', v_role;
    end if;
  end loop;
  foreach v_role in array array['designflow_hts_prod_runtime','designflow_hts_alsand_runtime'] loop
    if not has_table_privilege(v_role, 'hts_rag.hts_rag_broker_opinions', 'SELECT')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_broker_opinions', 'INSERT')
       or has_any_column_privilege(v_role, 'hts_rag.hts_rag_broker_opinions', 'UPDATE') then
      raise exception '% must only read hts_rag.hts_rag_broker_opinions', v_role;
    end if;
  end loop;
  foreach v_role in array array['designflow_hts_prod_worker','designflow_hts_alsand_worker'] loop
    if not has_table_privilege(v_role, 'hts_rag.hts_rag_broker_opinions', 'INSERT')
       or has_column_privilege(v_role, 'hts_rag.hts_rag_broker_opinions', 'broker_code', 'UPDATE')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_broker_opinions', 'DELETE') then
      raise exception '% must insert but never rewrite broker_code or delete', v_role;
    end if;
  end loop;
  if not exists (select 1 from pg_indexes where schemaname = 'hts_rag'
                  and indexname = 'hts_rag_broker_opinions_ruling_auth_uq'
                  and indexdef like '%(ruling_number, held_code, source_environment)%'
                  and indexdef like '%is_authoritative%') then
    raise exception 'one-authoritative-per-ruling-code index missing or changed';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'hts_rag'
                  and indexname = 'hts_rag_broker_opinions_product_auth_uq'
                  and indexdef like '%(determination_id, source_environment)%'
                  and indexdef like '%is_authoritative%') then
    raise exception 'one-authoritative-per-product index missing or changed';
  end if;
  -- Workers may update exactly is_authoritative, notes and evidence; nothing else.
  foreach v_role in array array['designflow_hts_prod_worker','designflow_hts_alsand_worker'] loop
    if not (has_column_privilege(v_role, 'hts_rag.hts_rag_broker_opinions', 'is_authoritative', 'UPDATE')
            and has_column_privilege(v_role, 'hts_rag.hts_rag_broker_opinions', 'notes', 'UPDATE')
            and has_column_privilege(v_role, 'hts_rag.hts_rag_broker_opinions', 'evidence', 'UPDATE')) then
      raise exception '% lost the broker-opinion update whitelist', v_role;
    end if;
    if exists (select 1 from information_schema.columns c
                where c.table_schema = 'hts_rag' and c.table_name = 'hts_rag_broker_opinions'
                  and c.column_name not in ('is_authoritative', 'notes', 'evidence', 'updated_at')
                  and has_column_privilege(v_role, 'hts_rag.hts_rag_broker_opinions', c.column_name, 'UPDATE')) then
      raise exception '% can update a broker-opinion column outside the whitelist', v_role;
    end if;
  end loop;
end
$broker_opinions$;
