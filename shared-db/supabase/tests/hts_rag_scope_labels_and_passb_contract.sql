-- Contract for issue #6402 (designflow-backend#278): Shelf-1 scope labels and Pass B store.
do $scope_passb$
declare
  v_table text;
  v_role text;
begin
  foreach v_table in array array['hts_rag.hts_rag_ruling_scope_labels','hts_rag.hts_rag_ruling_passb'] loop
    if not exists (select 1 from pg_class c where c.oid = to_regclass(v_table) and c.relrowsecurity) then
      raise exception '% missing or RLS disabled', v_table;
    end if;
    foreach v_role in array array['anon','authenticated','service_role'] loop
      if has_any_column_privilege(v_role, v_table, 'SELECT') then
        raise exception '% can read %', v_role, v_table;
      end if;
    end loop;
    foreach v_role in array array['designflow_hts_prod_runtime','designflow_hts_alsand_runtime'] loop
      if not has_table_privilege(v_role, v_table, 'SELECT')
         or has_table_privilege(v_role, v_table, 'INSERT')
         or has_table_privilege(v_role, v_table, 'DELETE')
         or has_any_column_privilege(v_role, v_table, 'UPDATE') then
        raise exception '% must only read %', v_role, v_table;
      end if;
    end loop;
    foreach v_role in array array['designflow_hts_prod_worker','designflow_hts_alsand_worker'] loop
      if not has_table_privilege(v_role, v_table, 'SELECT')
         or not has_table_privilege(v_role, v_table, 'INSERT')
         or not has_table_privilege(v_role, v_table, 'DELETE')
         or has_any_column_privilege(v_role, v_table, 'UPDATE') then
        raise exception '% must select, insert and delete % but never update', v_role, v_table;
      end if;
    end loop;
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'hts_rag_ruling_scope_labels_pkey'
                  and pg_get_constraintdef(oid) like '%(ruling_number, label_version, source_environment)%') then
    raise exception 'scope label key missing or changed';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hts_rag_ruling_passb_pkey'
                  and pg_get_constraintdef(oid) like '%(ruling_number, extract_version, source_environment)%') then
    raise exception 'Pass B key missing or changed';
  end if;
end
$scope_passb$;
