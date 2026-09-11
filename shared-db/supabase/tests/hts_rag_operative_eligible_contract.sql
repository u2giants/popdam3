-- Contract test for migration 20260907121706. All values are synthetic and the
-- assertions run inside a transaction that is rolled back.
begin;

insert into public.hts_rag_product_examples
  (id, product_family, fixture_version, fixture_hash, input_hash)
values
  ('c1111111-1111-4111-8111-111111111111', 'ZZ Operative fixture family',
   'zz-operative-v1', repeat('1', 64), repeat('2', 64));

-- Null remains valid when the outcome is explicitly non-operative.
insert into public.hts_rag_determinations
  (id, product_example_id, method, proposed_hts, classification_state,
   operative_eligible, result_hash, comparison_key)
values
  ('c2111111-1111-4111-8111-111111111111',
   'c1111111-1111-4111-8111-111111111111', 'legacy_ai_cross', null,
   'needs_more_facts', false, repeat('3', 64),
   'c3111111-1111-4111-8111-111111111111');

-- A completed determination with a real code remains eligible.
insert into public.hts_rag_determinations
  (id, product_example_id, method, proposed_hts, classification_state,
   operative_eligible, result_hash, comparison_key)
values
  ('c2111111-1111-4111-8111-111111111112',
   'c1111111-1111-4111-8111-111111111111', 'legacy_ai_cross', '9503.00.00',
   'provisional_complete', true, repeat('4', 64),
   'c3111111-1111-4111-8111-111111111112');

do $$
declare
  v_constraint text;
begin
  begin
    insert into public.hts_rag_determinations
      (product_example_id, method, proposed_hts, classification_state,
       operative_eligible, result_hash, comparison_key)
    values
      ('c1111111-1111-4111-8111-111111111111', 'legacy_ai_cross', null,
       'provisional_complete', true, repeat('5', 64),
       'c3111111-1111-4111-8111-111111111113');
    raise exception 'operative determination with null proposed_hts was accepted';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_determinations_operative_proposed_hts_chk' then
      raise exception 'wrong constraint rejected operative null proposed_hts: %', v_constraint;
    end if;
  end;
end $$;

-- The older HTS-format constraint also rejects blank text. Drop it only inside
-- this rolled-back test transaction so the new constraint is proven to reject
-- operative blank text independently, rather than receiving credit for another
-- constraint's failure.
alter table public.hts_rag_determinations
  drop constraint hts_rag_determinations_proposed_hts_check;

do $$
declare
  v_constraint text;
begin
  begin
    insert into public.hts_rag_determinations
      (product_example_id, method, proposed_hts, classification_state,
       operative_eligible, result_hash, comparison_key)
    values
      ('c1111111-1111-4111-8111-111111111111', 'legacy_ai_cross', '   ',
       'provisional_complete', true, repeat('6', 64),
       'c3111111-1111-4111-8111-111111111114');
    raise exception 'operative determination with blank proposed_hts was accepted';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'hts_rag_determinations_operative_proposed_hts_chk' then
      raise exception 'wrong constraint rejected operative blank proposed_hts: %', v_constraint;
    end if;
  end;
end $$;

rollback;
