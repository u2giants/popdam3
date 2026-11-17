-- Contract for popcre/designflow-backend#278 Phase 3: product embeddings store and nearest-product function.
do $product_embeddings$
declare
  v_table text := 'hts_rag.hts_rag_product_embeddings';
  v_fn text := 'hts_rag.hts_rag_nearest_products(text, text, integer, text[])';
  v_role text;
begin
  if not exists (select 1 from pg_class c where c.oid = to_regclass(v_table) and c.relrowsecurity) then
    raise exception '% missing or RLS disabled', v_table;
  end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_any_column_privilege(v_role, v_table, 'SELECT') then
      raise exception '% can read %', v_role, v_table;
    end if;
    if has_function_privilege(v_role, v_fn, 'EXECUTE') then
      raise exception '% can execute %', v_role, v_fn;
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
  foreach v_role in array array['designflow_hts_prod_runtime','designflow_hts_alsand_runtime','designflow_hts_prod_worker','designflow_hts_alsand_worker'] loop
    if not has_function_privilege(v_role, v_fn, 'EXECUTE') then
      raise exception '% cannot execute %', v_role, v_fn;
    end if;
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'hts_rag_product_embeddings_pkey'
                  and pg_get_constraintdef(oid) like '%(product_id, embed_version, source_environment)%') then
    raise exception 'product embeddings key missing or changed';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = to_regprocedure(v_fn) and p.prosecdef
                  and array_to_string(p.proconfig, ',') like '%search_path=""%') then
    raise exception '% must be security definer with an empty search_path', v_fn;
  end if;
end
$product_embeddings$;
