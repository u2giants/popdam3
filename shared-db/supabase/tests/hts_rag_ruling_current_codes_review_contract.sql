-- Contract for review finding #5457 (issue #5454): provenance correction, runtime isolation,
-- code shape and state shape on hts_rag_ruling_current_codes.
do $ruling_current_codes_review$
declare
  v_role text;
begin
  foreach v_role in array array['designflow_hts_prod_worker','designflow_hts_alsand_worker'] loop
    if not has_column_privilege(v_role, 'hts_rag.hts_rag_hts_renumbering', 'source_url', 'UPDATE')
       or not has_column_privilege(v_role, 'hts_rag.hts_rag_hts_renumbering', 'is_partial', 'UPDATE')
       or has_column_privilege(v_role, 'hts_rag.hts_rag_hts_renumbering', 'old_code', 'UPDATE')
       or has_table_privilege(v_role, 'hts_rag.hts_rag_hts_renumbering', 'DELETE') then
      raise exception '% must correct only renumbering provenance', v_role;
    end if;
  end loop;
  foreach v_role in array array['designflow_hts_prod_worker','designflow_hts_alsand_worker'] loop
    if has_column_privilege(v_role, 'hts_rag.hts_rag_ruling_current_codes', 'ruling_number', 'UPDATE')
       or has_column_privilege(v_role, 'hts_rag.hts_rag_ruling_current_codes', 'source_environment', 'UPDATE')
       or has_column_privilege(v_role, 'hts_rag.hts_rag_ruling_current_codes', 'id', 'UPDATE') then
      raise exception '% can rewrite a current-codes key column', v_role;
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'hts_rag'
                  and table_name = 'hts_rag_hts_renumbering' and column_name = 'is_partial') then
    raise exception 'hts_rag_hts_renumbering.is_partial missing';
  end if;
  if (select qual from pg_policies where schemaname = 'hts_rag' and tablename = 'hts_rag_ruling_current_codes'
        and policyname = 'hts_rag_alsand_runtime_read') is distinct from '(source_environment = ''alsand''::text)'
     or (select qual from pg_policies where schemaname = 'hts_rag' and tablename = 'hts_rag_ruling_current_codes'
        and policyname = 'hts_rag_prod_runtime_read') is distinct from '(source_environment = ''production''::text)' then
    raise exception 'runtime reads on hts_rag_ruling_current_codes are not scoped to their own environment';
  end if;
  foreach v_role in array array['hts_rag_ruling_current_codes_code_check','hts_rag_ruling_current_codes_shape_check',
                                 'hts_rag_ruling_current_codes_state_check','hts_rag_ruling_current_codes_method_check',
                                 'hts_rag_ruling_current_codes_uq','hts_rag_ruling_current_codes_ruling_fkey'] loop
    if not exists (select 1 from pg_constraint where conname = v_role
                    and conrelid = 'hts_rag.hts_rag_ruling_current_codes'::regclass) then
      raise exception 'constraint % missing', v_role;
    end if;
  end loop;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'hts_rag_ruling_current_codes_shape_check'))
       not like '%cardinality(candidate_codes) = 0%' then
    raise exception 'unmapped rows may still carry candidates';
  end if;
end
$ruling_current_codes_review$;
