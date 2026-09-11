-- Contract test for migration 20260904172420. All values are synthetic.
begin;

insert into public.hts_rag_product_examples
  (id, product_family, fixture_version, fixture_hash, input_hash)
values
  ('b1111111-1111-4111-8111-111111111111', 'ZZ Repeat fixture family',
   'zz-repeat-v1', repeat('1', 64), repeat('2', 64));

insert into public.hts_rag_determinations
  (id, product_example_id, method, proposed_hts, classification_state,
   result_hash, comparison_key, session_id, completion_key)
values
  ('b2111111-1111-4111-8111-111111111111',
   'b1111111-1111-4111-8111-111111111111', 'legacy_ai_cross', '9503.00.00',
   'provisional_complete', repeat('3', 64),
   'b3111111-1111-4111-8111-111111111111',
   'b4111111-1111-4111-8111-111111111111', 'zz-repeat-completion-1'),
  ('b2111111-1111-4111-8111-111111111112',
   'b1111111-1111-4111-8111-111111111111', 'legacy_ai_cross', '9503.00.00',
   'provisional_complete', repeat('3', 64),
   'b3111111-1111-4111-8111-111111111112',
   'b4111111-1111-4111-8111-111111111112', 'zz-repeat-completion-2');

do $$
declare
  v_count integer;
  v_operative_count integer;
  v_constraint text;
begin
  select count(*), count(*) filter (where operative_eligible)
    into v_count, v_operative_count
    from public.hts_rag_determinations
   where product_example_id = 'b1111111-1111-4111-8111-111111111111'
     and method = 'legacy_ai_cross'
     and result_hash = repeat('3', 64);

  if v_count <> 2 then
    raise exception 'expected two separate-session determinations, found %', v_count;
  end if;
  if v_operative_count <> 0 then
    raise exception 'repeat determinations became operative without explicit authorization';
  end if;

  begin
    insert into public.hts_rag_determinations
      (product_example_id, method, proposed_hts, classification_state,
       result_hash, comparison_key, session_id, completion_key)
    values
      ('b1111111-1111-4111-8111-111111111111', 'legacy_ai_cross', '9503.00.00',
       'provisional_complete', repeat('3', 64),
       'b3111111-1111-4111-8111-111111111113',
       'b4111111-1111-4111-8111-111111111113', 'zz-repeat-completion-1');
    raise exception 'duplicate completion key was accepted';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_determinations_completion_key_uq' then
      raise exception 'wrong constraint rejected duplicate completion key: %', v_constraint;
    end if;
  end;
end $$;

rollback;
