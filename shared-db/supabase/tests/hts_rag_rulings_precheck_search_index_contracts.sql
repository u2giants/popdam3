begin;
-- shared-db#4577 (claim #4626): HTS precheck search indexes on hts_rag_rulings. Rolled back.
do $$
declare
  r text;
  f text;
  i record;
begin
  assert public.hts_rag_fold_text(E'Décor Café Straße İSTANBUL') = 'decor cafe stra e istanbul',
    'fold must match the backend scorer (NFD, strip marks, lowercase; leftover non-ASCII is a word break)';
  assert public.hts_rag_tariff_subheadings('["6913.90.5000","6913905010","12.34",null,7117190000]'::jsonb) = array['691390','711719'],
    'subheadings are distinct first-six digits of tariffs with at least six digits';
  assert public.hts_rag_tariff_subheadings('{}'::jsonb) = '{}'::text[], 'non-array tariffs yield no subheadings';

  foreach f in array array['public.hts_rag_fold_text(text)', 'public.hts_rag_tariff_subheadings(jsonb)'] loop
    foreach r in array array['service_role', 'designflow_hts_prod_runtime', 'designflow_hts_alsand_runtime',
                             'designflow_hts_prod_worker', 'designflow_hts_alsand_worker'] loop
      assert has_function_privilege(r, f, 'EXECUTE'), format('%s must execute %s', r, f);
    end loop;
    assert not has_function_privilege('anon', f, 'EXECUTE'), format('anon must not execute %s', f);
    assert not has_function_privilege('authenticated', f, 'EXECUTE'), format('authenticated must not execute %s', f);
  end loop;

  for i in
    select * from (values
      ('public.hts_rag_rulings_search_trgm_idx', 'public.hts_rag_rulings', 'gin_trgm_ops'),
      ('hts_rag.hts_rag_rulings_search_trgm_idx', 'hts_rag.hts_rag_rulings', 'gin_trgm_ops'),
      ('public.hts_rag_rulings_subheadings_idx', 'public.hts_rag_rulings', 'hts_rag_tariff_subheadings(tariffs)'),
      ('hts_rag.hts_rag_rulings_subheadings_idx', 'hts_rag.hts_rag_rulings', 'hts_rag_tariff_subheadings(tariffs)')
    ) v(idx, tbl, needle)
  loop
    assert to_regclass(i.idx) is not null, format('%s missing', i.idx);
    assert (select x.indrelid = to_regclass(i.tbl) and x.indisvalid from pg_index x where x.indexrelid = to_regclass(i.idx)),
      format('%s must be a valid index on %s', i.idx, i.tbl);
    assert pg_get_indexdef(to_regclass(i.idx)) like '%USING gin%' and strpos(pg_get_indexdef(to_regclass(i.idx)), i.needle) > 0,
      format('%s must be the GIN index precheck queries (%s)', i.idx, pg_get_indexdef(to_regclass(i.idx)));
  end loop;
  assert strpos(pg_get_indexdef('public.hts_rag_rulings_search_trgm_idx'::regclass),
    $q$hts_rag_fold_text(((COALESCE(subject, ''::text) || ' '::text) || full_text))$q$) > 0,
    'text index expression must match the backend filter exactly';
end $$;
rollback;
