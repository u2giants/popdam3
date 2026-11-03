-- Contract for #5491/#5508: exercise the copied CHECK, not its definition text.
-- LIKE copies CHECKs but no foreign keys, so probes never touch ruling data.
do $ruling_current_codes_null_candidates$
declare
  v_codes text[];
  v_code text;
  v_constraint text;
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'hts_rag_ruling_current_codes_code_check'
                    and conrelid = 'hts_rag.hts_rag_ruling_current_codes'::regclass
                    and convalidated) then
    raise exception 'hts_rag_ruling_current_codes_code_check is missing or not validated';
  end if;

  create temporary table ruling_current_codes_code_probe (
    like hts_rag.hts_rag_ruling_current_codes including defaults including constraints
  ) on commit drop;

  insert into ruling_current_codes_code_probe
    (ruling_number, held_code, source_environment, state, current_code,
     candidate_codes, method, hts_revision, decided_by)
  values ('code-probe', '1001', 'production', 'unmapped', null,
          '{}'::text[], 'none', 'contract', 'contract');

  -- Every supported length must pass for both current_code and candidates.
  foreach v_code in array array['1001', '1001.00', '1001.00.00', '1001.00.00.00'] loop
    update ruling_current_codes_code_probe
       set state = 'current', current_code = v_code, candidate_codes = array[v_code];
  end loop;
  update ruling_current_codes_code_probe
     set state = 'split', current_code = null,
         candidate_codes = array['1001', '1001.00', '1001.00.00', '1001.00.00.00'];

  -- Keep the shape valid and check the rejecting constraint's identity so
  -- another CHECK cannot mask a broken code guard. Test bad candidates in
  -- both positions, including NULL-only arrays and NULLs beside valid codes.
  for v_codes in
    select codes from (values
      (array[null, null]::text[]),
      (array[null, '1001']), (array['1001', null]),
      (array['1001.00.00.00.00', '1001']),
      (array['1001', '1001.00.00.00.00']),
      (array['1001x00', '1001']), (array['1001', '1001x00']),
      (array['100', '1001']), (array['1001', '1001000000']),
      (array['1001', '1001.0']), (array['1001', '1001.000']),
      (array['1001', 'abcd']), (array['1001', ''])
    ) as probes(codes)
  loop
    begin
      update ruling_current_codes_code_probe set candidate_codes = v_codes;
      raise exception 'invalid candidates accepted: %', v_codes;
    exception when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'hts_rag_ruling_current_codes_code_check' then
        raise exception 'wrong constraint rejected candidates %: %', v_codes, v_constraint;
      end if;
    end;
  end loop;

  foreach v_code in array array['100', '1001000000', '1001x00', '1001.0',
                                '1001.000', '1001.00.00.00.00', 'abcd', ''] loop
    begin
      update ruling_current_codes_code_probe
         set state = 'current', current_code = v_code, candidate_codes = array[v_code];
      raise exception 'invalid current code accepted: %', v_code;
    exception when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'hts_rag_ruling_current_codes_code_check' then
        raise exception 'wrong constraint rejected current code %: %', v_code, v_constraint;
      end if;
    end;
  end loop;
end
$ruling_current_codes_null_candidates$;
