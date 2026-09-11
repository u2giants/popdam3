-- #1258: the CI-only pre-adoption baseline must preserve the durable ruling
-- catalogue even when the historical FR migrations correctly refuse on absent
-- real taxonomy rows. No deployed data is seeded or asserted here.

begin;

do $test$
declare
  v_constraints integer;
begin
  if to_regclass('core.taxonomy_owner_ruling') is null then
    raise exception 'core.taxonomy_owner_ruling is absent after the two-pass from-empty replay';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'core.taxonomy_owner_ruling'::regclass) then
    raise exception 'core.taxonomy_owner_ruling must keep RLS enabled';
  end if;

  if not has_table_privilege('authenticated', 'core.taxonomy_owner_ruling', 'select')
     or has_table_privilege('authenticated', 'core.taxonomy_owner_ruling', 'insert')
     or has_table_privilege('authenticated', 'core.taxonomy_owner_ruling', 'update')
     or has_table_privilege('authenticated', 'core.taxonomy_owner_ruling', 'delete') then
    raise exception 'authenticated must have read-only table privileges on core.taxonomy_owner_ruling';
  end if;

  if has_table_privilege('anon', 'core.taxonomy_owner_ruling', 'select') then
    raise exception 'anon must not read core.taxonomy_owner_ruling';
  end if;

  if not has_table_privilege('service_role', 'core.taxonomy_owner_ruling', 'insert') then
    raise exception 'service_role must retain write authority on core.taxonomy_owner_ruling';
  end if;

  select count(*) into v_constraints
  from pg_constraint
  where conrelid = 'core.taxonomy_owner_ruling'::regclass
    and conname in (
      'taxonomy_owner_ruling_entity_table_not_blank',
      'taxonomy_owner_ruling_ruling_not_blank',
      'taxonomy_owner_ruling_ruled_by_not_blank',
      'taxonomy_owner_ruling_evidence_not_blank',
      'taxonomy_owner_ruling_action_not_blank',
      'taxonomy_owner_ruling_has_a_subject'
    );
  if v_constraints <> 6 then
    raise exception 'core.taxonomy_owner_ruling has % of 6 provenance constraints', v_constraints;
  end if;
end;
$test$;

rollback;
