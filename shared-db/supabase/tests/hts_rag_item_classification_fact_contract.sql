-- Contract for issue #5596 (designflow-backend#278 P2): item classification facts.
do $item_facts$
declare
  v_role text;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'hts_rag' and c.relname = 'item_classification_fact' and c.relrowsecurity) then
    raise exception 'hts_rag.item_classification_fact missing or RLS disabled';
  end if;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if has_any_column_privilege(v_role, 'hts_rag.item_classification_fact', 'SELECT') then
      raise exception '% can read hts_rag.item_classification_fact', v_role;
    end if;
  end loop;
  foreach v_role in array array['designflow_hts_prod_runtime','designflow_hts_alsand_runtime'] loop
    if not has_table_privilege(v_role, 'hts_rag.item_classification_fact', 'SELECT')
       or has_table_privilege(v_role, 'hts_rag.item_classification_fact', 'INSERT')
       or has_any_column_privilege(v_role, 'hts_rag.item_classification_fact', 'UPDATE') then
      raise exception '% must only read hts_rag.item_classification_fact', v_role;
    end if;
  end loop;
  foreach v_role in array array['designflow_hts_prod_worker','designflow_hts_alsand_worker'] loop
    if not has_table_privilege(v_role, 'hts_rag.item_classification_fact', 'INSERT')
       or not has_column_privilege(v_role, 'hts_rag.item_classification_fact', 'fact_value', 'UPDATE')
       or has_table_privilege(v_role, 'hts_rag.item_classification_fact', 'DELETE') then
      raise exception '% must insert and update the value but never delete', v_role;
    end if;
    if exists (select 1 from information_schema.columns c
                where c.table_schema = 'hts_rag' and c.table_name = 'item_classification_fact'
                  and c.column_name not in ('family', 'fact_value', 'source', 'answered_by', 'answered_at')
                  and has_column_privilege(v_role, 'hts_rag.item_classification_fact', c.column_name, 'UPDATE')) then
      raise exception '% can update an item-fact column outside the whitelist', v_role;
    end if;
  end loop;
  if not exists (select 1 from pg_indexes where schemaname = 'hts_rag'
                  and indexname = 'item_classification_fact_item_fact_uq'
                  and indexdef like '%UNIQUE%'
                  and indexdef like '%(source_environment, item_ref, fact_key)%') then
    raise exception 'one-value-per-item-fact unique index missing or changed';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'item_classification_fact_source_check'
                  and pg_get_constraintdef(oid) like '%requester%'
                  and pg_get_constraintdef(oid) like '%designer%'
                  and pg_get_constraintdef(oid) like '%import%') then
    raise exception 'source check missing or changed';
  end if;
end
$item_facts$;
