-- Contract for issue #5015 (designflow-backend#254) CBP ruling database (behavioural).
do $cbp_ruling_db$
declare
  v_table text;
  v_tables text[] := array['hts_rag_hts_codes','hts_rag_hts_renumbering','hts_rag_ruling_links','hts_rag_ruling_codes',
    'hts_rag_article_types','hts_rag_materials','hts_rag_attribute_keys','hts_rag_ruling_products',
    'hts_rag_product_components','hts_rag_product_attributes','hts_rag_heading_decisions'];
  v_deletable text[] := array['hts_rag_ruling_links','hts_rag_ruling_codes','hts_rag_ruling_products',
    'hts_rag_product_components','hts_rag_product_attributes','hts_rag_heading_decisions'];
  v_role text;
begin
  foreach v_table in array v_tables loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'hts_rag' and c.relname = v_table and c.relrowsecurity) then
      raise exception 'hts_rag.% missing or RLS disabled', v_table;
    end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'hts_rag' and table_name = v_table
                    and column_name = 'source_environment' and is_nullable = 'NO' and column_default is null) then
      raise exception 'hts_rag.% lacks a mandatory, default-free source_environment', v_table;
    end if;
    foreach v_role in array array['anon','authenticated','service_role','designflow_hts_prod_runtime','designflow_hts_alsand_runtime'] loop
      if has_any_column_privilege(v_role, 'hts_rag.' || v_table, 'SELECT') then
        raise exception '% can read hts_rag.%', v_role, v_table;
      end if;
    end loop;
    foreach v_role in array array['designflow_hts_prod_worker','designflow_hts_alsand_worker'] loop
      if not has_table_privilege(v_role, 'hts_rag.' || v_table, 'SELECT')
         or not has_table_privilege(v_role, 'hts_rag.' || v_table, 'INSERT')
         or has_table_privilege(v_role, 'hts_rag.' || v_table, 'UPDATE')
         or has_table_privilege(v_role, 'hts_rag.' || v_table, 'TRUNCATE')
         or has_column_privilege(v_role, 'hts_rag.' || v_table, 'source_environment', 'UPDATE')
         or has_table_privilege(v_role, 'hts_rag.' || v_table, 'DELETE') <> (v_table = any (v_deletable)) then
        raise exception '% has the wrong privileges on hts_rag.%', v_role, v_table;
      end if;
    end loop;
  end loop;
  if not has_column_privilege('designflow_hts_prod_worker', 'hts_rag.hts_rag_rulings', 'effective_status', 'UPDATE')
     or has_column_privilege('designflow_hts_prod_worker', 'hts_rag.hts_rag_rulings', 'full_text', 'UPDATE') then
    raise exception 'hts_rag_rulings column update grants differ';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'hts_rag' and indexname = 'hts_rag_ruling_products_phrase_hnsw_idx'
                  and indexdef like '%USING hnsw (phrase_embedding %halfvec_cosine_ops) WHERE%') then
    raise exception 'phrase vector index missing';
  end if;
  if not has_function_privilege('designflow_hts_alsand_worker', 'hts_rag.hts_rag_refresh_type_heading_stats()', 'EXECUTE')
     or has_function_privilege('anon', 'hts_rag.hts_rag_refresh_type_heading_stats()', 'EXECUTE')
     or has_table_privilege('designflow_hts_prod_runtime', 'hts_rag.hts_rag_type_heading_stats', 'SELECT')
     or has_table_privilege('anon', 'hts_rag.hts_rag_type_heading_stats', 'SELECT')
     or has_table_privilege('authenticated', 'hts_rag.hts_rag_type_heading_stats', 'SELECT') then
    raise exception 'type_heading_stats privileges differ';
  end if;
  if not exists (select 1 from pg_proc where oid = 'hts_rag.hts_rag_refresh_type_heading_stats()'::regprocedure
                  and prosecdef and proconfig = array['search_path=""'])
     or not exists (select 1 from pg_indexes where schemaname = 'hts_rag' and indexname = 'hts_rag_type_heading_stats_uq'
                  and indexdef like 'CREATE UNIQUE INDEX % NULLS NOT DISTINCT') then
    raise exception 'refresh function or its concurrent-refresh key differs';
  end if;
end
$cbp_ruling_db$;

-- Behaviour: environment-bound insert, cross-environment refusal, code roles, refresh.
-- One plain refresh only: once populated the function refreshes CONCURRENTLY,
-- which PostgreSQL refuses inside a transaction block.
begin;
-- The CI session user may only SET ROLE into roles it is a member of; test-only
-- grant, rolled back with the transaction (same preamble as hts_rag_shared_schema_contract.sql).
grant designflow_hts_prod_worker, designflow_hts_alsand_worker to postgres;
insert into hts_rag.hts_rag_rulings (ruling_number, full_text, full_text_hash, ruling_date, source_environment)
  values ('N022925', 'The applicable subheading for the lap desk will be 4420.90.8000.',
          encode(sha256(convert_to('The applicable subheading for the lap desk will be 4420.90.8000.', 'UTF8')), 'hex'),
          '2008-02-01', 'alsand');
set local role designflow_hts_alsand_worker;
insert into hts_rag.hts_rag_article_types (name, synonyms, vocab_version, source_environment)
  values ('lap desk', '{lapdesk}', 'v1', 'alsand');
insert into hts_rag.hts_rag_ruling_products (ruling_number, item_label, plain_phrase, article_type_id, held_code,
    held_heading, held_chapter, review_state, extract_version, source_environment)
  select 'N022925', 'Lap desk', 'mdf lap desk', id, '4420.90.8000', '4420', '44', 'trusted', 'x1', 'alsand'
    from hts_rag.hts_rag_article_types where name = 'lap desk';
insert into hts_rag.hts_rag_heading_decisions (product_id, heading, outcome, source_environment)
  select id, h, o, 'alsand' from hts_rag.hts_rag_ruling_products, (values ('4420','held'),('9403','rejected')) v(h, o);
insert into hts_rag.hts_rag_ruling_codes (ruling_number, code, role, extract_version, source_environment)
  values ('N022925', '4420.90.8000', 'held', 'x1', 'alsand');
do $$ begin
  begin
    insert into hts_rag.hts_rag_ruling_codes (ruling_number, code, role, extract_version, source_environment)
      values ('N022925', '9403.60.8081', 'rejected', 'x1', 'production');
    raise exception 'alsand worker wrote a production row';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into hts_rag.hts_rag_ruling_codes (ruling_number, code, role, extract_version, source_environment)
      values ('N022925', '9403.60.8081', 'counted', 'x1', 'alsand');
    raise exception 'unknown code role accepted';
  exception when check_violation then null;
  end;
end $$;
select hts_rag.hts_rag_refresh_type_heading_stats();
do $$ begin
  if (select count(*) from hts_rag.hts_rag_type_heading_stats where chapter = '94' and outcome = 'rejected' and all_materials) <> 1
     or (select product_count from hts_rag.hts_rag_type_heading_stats where heading = '4420' and outcome = 'held' and all_materials) <> 1 then
    raise exception 'type_heading_stats did not compute held and rejected headings';
  end if;
end $$;
delete from hts_rag.hts_rag_ruling_products;
do $$ begin
  if exists (select 1 from hts_rag.hts_rag_heading_decisions) then raise exception 'decisions did not cascade'; end if;
end $$;
reset role;
rollback;
