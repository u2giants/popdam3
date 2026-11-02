-- Contract for review finding #5491 (issue #5454): the code check carries the fix itself,
-- not just its name: canonical 4-10 digit shape, every candidate checked, no NULL candidate.
do $ruling_current_codes_null_candidates$
declare
  v_def text := pg_get_constraintdef((select oid from pg_constraint
                  where conname = 'hts_rag_ruling_current_codes_code_check'
                    and conrelid = 'hts_rag.hts_rag_ruling_current_codes'::regclass));
begin
  if v_def is null or v_def not like '%array_position(candidate_codes, NULL%'
     or v_def not like '%array_to_string(candidate_codes%'
     or v_def not like '%{0,3}$''%' then
    raise exception 'hts_rag_ruling_current_codes_code_check lacks the canonical shape or NULL guard: %', v_def;
  end if;
  if not (select convalidated from pg_constraint where conname = 'hts_rag_ruling_current_codes_code_check'
            and conrelid = 'hts_rag.hts_rag_ruling_current_codes'::regclass) then
    raise exception 'hts_rag_ruling_current_codes_code_check is not validated';
  end if;
end
$ruling_current_codes_null_candidates$;
