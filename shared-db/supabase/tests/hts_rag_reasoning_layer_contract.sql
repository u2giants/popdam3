-- Contract for issue #5188 (designflow-backend#254 §13): CBP ruling reasoning layer (behavioural).
do $reasoning_privileges$
declare
  v_table text;
  v_role text;
begin
  foreach v_table in array array['hts_rag_ruling_sentences','hts_rag_extractions','hts_rag_authorities',
    'hts_rag_classification_tests','hts_rag_test_aliases','hts_rag_decision_tests','hts_rag_decision_facts',
    'hts_rag_decision_authorities','hts_rag_counterfactuals'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'hts_rag' and c.relname = v_table and c.relrowsecurity) then
      raise exception 'hts_rag.% missing or RLS disabled', v_table;
    end if;
    foreach v_role in array array['anon','authenticated','service_role'] loop
      if has_any_column_privilege(v_role, 'hts_rag.' || v_table, 'SELECT') then
        raise exception '% can read hts_rag.%', v_role, v_table;
      end if;
    end loop;
    foreach v_role in array array['designflow_hts_prod_worker','designflow_hts_alsand_worker'] loop
      if not has_table_privilege(v_role, 'hts_rag.' || v_table, 'INSERT')
         or has_table_privilege(v_role, 'hts_rag.' || v_table, 'TRUNCATE')
         or has_column_privilege(v_role, 'hts_rag.' || v_table, 'source_environment', 'UPDATE') then
        raise exception '% has the wrong privileges on hts_rag.%', v_role, v_table;
      end if;
    end loop;
    foreach v_role in array array['designflow_hts_prod_runtime','designflow_hts_alsand_runtime'] loop
      if has_table_privilege(v_role, 'hts_rag.' || v_table, 'SELECT') <> (v_table <> 'hts_rag_extractions')
         or has_table_privilege(v_role, 'hts_rag.' || v_table, 'INSERT') then
        raise exception '% runtime access on hts_rag.% differs (read all but extractions, write none)', v_role, v_table;
      end if;
    end loop;
  end loop;
  if (select count(*) from hts_rag.hts_rag_classification_tests) < 25
     or exists (select 1 from hts_rag.hts_rag_classification_tests where anchor_authority_id is null) then
    raise exception 'seed vocabulary missing or unanchored';
  end if;
  if (select test_id from hts_rag.hts_rag_test_aliases where alias = 'essential character')
     is distinct from (select id from hts_rag.hts_rag_classification_tests where canonical_name like 'GRI 3(b)%') then
    raise exception 'alias essential character does not map to GRI 3(b)';
  end if;
  if not has_function_privilege('designflow_hts_alsand_worker', 'hts_rag.hts_rag_refresh_fault_lines()', 'EXECUTE')
     or has_function_privilege('designflow_hts_alsand_runtime', 'hts_rag.hts_rag_refresh_fault_lines()', 'EXECUTE') then
    raise exception 'fault-line refresh grants differ';
  end if;
end
$reasoning_privileges$;

-- Behaviour: a held/rejected pair with a dispositive test and a fact becomes a fault line.
begin;
grant designflow_hts_alsand_worker, designflow_hts_alsand_runtime to postgres;
set local role designflow_hts_alsand_worker;
insert into hts_rag.hts_rag_rulings (ruling_number, full_text, full_text_hash, source_environment)
values ('ZR0001', 'The item is a resin Santa figure. It is not a festive article because it is a candle holder.', 'h', 'alsand');
insert into hts_rag.hts_rag_ruling_sentences (ruling_number, seq, section, span, text_norm, text_hash, source_environment)
values ('ZR0001', 0, 'facts', int4range(0, 34), 'the item is a resin santa figure.', repeat('a', 40), 'alsand'),
       ('ZR0001', 1, 'analysis', int4range(35, 92), 'it is not a festive article because it is a candle holder.', repeat('b', 40), 'alsand');
insert into hts_rag.hts_rag_attribute_keys (key, kind, vocab_version, source_environment)
values ('zz_principal_use', 'text', 'test', 'alsand') on conflict do nothing;
do $reasoning_behaviour$
declare
  v_ext uuid; v_product uuid; v_held uuid; v_rej uuid; v_test uuid; v_rows integer;
  v_ext2 uuid; v_attr uuid; v_test2 uuid;
begin
  insert into hts_rag.hts_rag_extractions (ruling_number, pass, extract_version, model, prompt_hash, text_hash, is_current, source_environment)
  values ('ZR0001', 'reasoning', 'test-v1', 'test', 'p', 't', true, 'alsand') returning id into v_ext;
  begin
    insert into hts_rag.hts_rag_extractions (ruling_number, pass, extract_version, model, prompt_hash, text_hash, is_current, source_environment)
    values ('ZR0001', 'reasoning', 'test-v2', 'test', 'p', 't', true, 'alsand');
    raise exception 'two current extractions for one (ruling, pass) were accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into hts_rag.hts_rag_extractions (ruling_number, pass, extract_version, model, prompt_hash, text_hash, source_environment)
    values ('ZR0001', 'product', 'test-v1', 'test', 'p', 't', 'production');
    raise exception 'alsand worker forged production provenance';
  exception when insufficient_privilege then null;
  end;
  insert into hts_rag.hts_rag_ruling_products (ruling_number, item_label, plain_phrase, held_code, held_heading, held_chapter,
    review_state, extract_version, extraction_id, source_environment)
  values ('ZR0001', 'figure', 'resin santa candle holder', '9405.50.4000', '9405', '94', 'trusted', 'test-v1', v_ext, 'alsand')
  returning id into v_product;
  insert into hts_rag.hts_rag_heading_decisions (product_id, heading, code_prefix, outcome, extraction_id, source_environment)
  values (v_product, '9405', '9405.50', 'held', v_ext, 'alsand') returning id into v_held;
  insert into hts_rag.hts_rag_heading_decisions (product_id, heading, code_prefix, outcome, rejected_proposed_by, extraction_id, source_environment)
  values (v_product, '9505', '9505.10', 'rejected', 'importer', v_ext, 'alsand') returning id into v_rej;
  begin
    insert into hts_rag.hts_rag_heading_decisions (product_id, heading, code_prefix, outcome, source_environment)
    values (v_product, '9505', '9405.10', 'rejected', 'alsand');
    raise exception 'code_prefix outside its heading was accepted';
  exception when check_violation then null;
  end;
  insert into hts_rag.hts_rag_decision_tests (decision_id, test_id, outcome, is_dispositive, reason_sentence_seq, extraction_id, source_environment)
  values (v_rej, (select id from hts_rag.hts_rag_classification_tests where canonical_name like 'Festive article: utilitarian%'),
          'failed', true, 1, v_ext, 'alsand') returning id into v_test;
  insert into hts_rag.hts_rag_decision_facts (decision_test_id, attribute_key, direction, sentence_seq, source_environment)
  values (v_test, 'zz_principal_use', 'defeats', 1, 'alsand');
  insert into hts_rag.hts_rag_decision_authorities (decision_id, authority_id, role, sentence_seq, source_environment)
  values (v_rej, (select id from hts_rag.hts_rag_authorities where ref_norm = 'park b. smith'), 'applied', 1, 'alsand');
  insert into hts_rag.hts_rag_counterfactuals (product_id, attribute_key, if_value, then_code_prefix, sentence_seq, extraction_id, source_environment)
  values (v_product, 'zz_principal_use', 'decoration', '9505.10', 1, v_ext, 'alsand');
  perform hts_rag.hts_rag_refresh_fault_lines();
  select count(*) into v_rows from hts_rag.hts_rag_fault_lines
   where prefix_a = '9405.50' and prefix_b = '9505.10' and attribute_key = 'zz_principal_use'
     and n_products = 1 and n_held_a = 1 and n_held_b = 0;
  if v_rows <> 1 then raise exception 'fault line not computed (% rows)', v_rows; end if;
  if not exists (select 1 from hts_rag.hts_rag_fault_lines_any_type where prefix_a = '9405.50' and prefix_b = '9505.10') then
    raise exception 'type-agnostic fault line missing';
  end if;
  if not exists (select 1 from pg_proc where oid = 'hts_rag.hts_rag_refresh_fault_lines()'::regprocedure
                  and 'statement_timeout=5min' = any(proconfig)) then
    raise exception 'fault-line refresh must carry its own statement timeout';
  end if;
  -- (5a) UPDATE new columns on heading_decisions and product_attributes under RLS
  insert into hts_rag.hts_rag_product_attributes (product_id, key, value_text, source_span, source_environment)
  values (v_product, 'zz_principal_use', 'candle holder', int4range(0, 34), 'alsand') returning id into v_attr;
  update hts_rag.hts_rag_heading_decisions
     set code_prefix = '9405.50.40', sentence_seq = 0, rejected_proposed_by = 'cbp_alternative'
   where id = v_held;
  update hts_rag.hts_rag_product_attributes set sentence_seq = 0 where id = v_attr;
  -- (5b) second extraction version writes beside the old
  insert into hts_rag.hts_rag_extractions (ruling_number, pass, extract_version, model, prompt_hash, text_hash, source_environment)
  values ('ZR0001', 'reasoning', 'test-v2', 'test', 'p', 't', 'alsand') returning id into v_ext2;
  insert into hts_rag.hts_rag_decision_tests (decision_id, test_id, outcome, is_dispositive, reason_sentence_seq, extraction_id, source_environment)
  values (v_rej, (select id from hts_rag.hts_rag_classification_tests where canonical_name like 'Festive article: utilitarian%'),
          'failed', true, 0, v_ext2, 'alsand') returning id into v_test2;
  insert into hts_rag.hts_rag_counterfactuals (product_id, attribute_key, if_value, then_code_prefix, sentence_seq, extraction_id, source_environment)
  values (v_product, 'zz_principal_use', 'decoration', '9505.10', 0, v_ext2, 'alsand');
  -- (5c) provenance forgery refused: bad sentence_seq
  begin
    insert into hts_rag.hts_rag_heading_decisions (product_id, heading, code_prefix, outcome, sentence_seq, extraction_id, source_environment)
    values (v_product, '9405', '9405.50', 'held', 999, v_ext, 'alsand');
    raise exception 'forged sentence_seq was accepted';
  exception when others then
    if sqlerrm like '%forged%' then raise; end if;
    if sqlerrm not like '%sentence provenance%' then raise; end if;
  end;
  begin
    insert into hts_rag.hts_rag_counterfactuals (product_id, attribute_key, if_value, then_code_prefix, sentence_seq, extraction_id, source_environment)
    values (v_product, 'zz_principal_use', 'decoration', '9505.10', 999, v_ext, 'alsand');
    raise exception 'forged counterfactual sentence_seq was accepted';
  exception when others then
    if sqlerrm like '%forged%' then raise; end if;
    if sqlerrm not like '%sentence provenance%' then raise; end if;
  end;
  -- (5c) provenance forgery refused: bad affected_product_ids
  begin
    insert into hts_rag.hts_rag_ruling_links (from_ruling, to_ruling, kind, link_source, affected_product_ids, source_environment)
    values ('ZR0001', 'ZR0002', 'revokes', 'text', array[gen_random_uuid()], 'alsand');
    raise exception 'forged affected_product_ids was accepted';
  exception when others then
    if sqlerrm like '%forged%' then raise; end if;
    if sqlerrm not like '%affected_product_ids%' then raise; end if;
  end;
end
$reasoning_behaviour$;
reset role;
set local role designflow_hts_alsand_runtime;
do $reasoning_runtime$
begin
  if not exists (select 1 from hts_rag.hts_rag_ruling_sentences where ruling_number = 'ZR0001' and seq = 1)
     or not exists (select 1 from hts_rag.hts_rag_fault_lines where prefix_a = '9405.50') then
    raise exception 'runtime cannot read sentences or fault lines';
  end if;
end
$reasoning_runtime$;
reset role;
rollback;
