-- #1676 contract Property evidence landing contracts.
-- All values are synthetic. The test runs only in the throwaway CI database.

begin;

do $$
declare
  v_name text;
  v_count integer;
begin
  foreach v_name in array array[
    'plm.contract_property_capture',
    'plm.contract_property_document',
    'plm.contract_property',
    'plm.contract_property_evidence'
  ] loop
    if to_regclass(v_name) is null then
      raise exception 'missing table %', v_name;
    end if;
  end loop;

  select count(*) into v_count
  from pg_indexes
  where schemaname = 'plm'
    and indexname in (
      'contract_property_capture_licensor_idx',
      'contract_property_document_sha256_uq',
      'contract_property_licensor_identity_uq',
      'contract_property_evidence_document_idx'
    );
  if v_count <> 4 then
    raise exception 'expected four named indexes, found %', v_count;
  end if;

  select count(*) into v_count
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'plm'
    and c.relname in (
      'contract_property_capture','contract_property_document',
      'contract_property','contract_property_evidence'
    )
    and c.relrowsecurity and c.relforcerowsecurity;
  if v_count <> 4 then
    raise exception 'all four tables must have forced RLS';
  end if;

  select count(*) into v_count
  from pg_policies
  where schemaname = 'plm'
    and tablename in (
      'contract_property_capture','contract_property_document',
      'contract_property','contract_property_evidence'
    );
  if v_count <> 0 then
    raise exception 'contract Property landing must expose no RLS policies';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'plm'
      and table_name like 'contract_property%'
      and grantee in ('PUBLIC','anon','authenticated')
  ) then
    raise exception 'public application roles must have no contract Property grants';
  end if;

  select count(*) into v_count
  from information_schema.role_table_grants
  where table_schema = 'plm'
    and table_name in (
      'contract_property_capture','contract_property_document',
      'contract_property','contract_property_evidence'
    )
    and grantee = 'service_role'
    and privilege_type in ('SELECT','INSERT');
  if v_count <> 8 then
    raise exception 'service_role must have exactly SELECT and INSERT on all four tables';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'plm'
      and table_name like 'contract_property%'
      and grantee = 'service_role'
      and privilege_type not in ('SELECT','INSERT')
  ) then
    raise exception 'service_role received a mutating privilege beyond append';
  end if;
end $$;

do $$
declare
  v_licensor uuid := '00000000-0000-4000-8000-000000001676';
  v_capture_a uuid := '00000000-0000-4000-8000-000000001677';
  v_capture_b uuid := '00000000-0000-4000-8000-000000001678';
  v_property uuid := '00000000-0000-4000-8000-000000001679';
  v_property_b uuid := '00000000-0000-4000-8000-000000001681';
  v_document uuid := '00000000-0000-4000-8000-000000001680';
  v_document_a uuid := '00000000-0000-4000-8000-000000001682';
  v_rejected boolean;
  v_constraint text;
begin
  insert into core.licensor(id, name, code)
  values (v_licensor, 'ZZTEST CONTRACT LICENSOR', 'ZZCP1676');

  insert into plm.contract_property_capture
    (id, licensor_id, source_identity, evidence_date, decision_authority, controlling_chain_complete)
  values
    (v_capture_a, v_licensor, 'ZZTEST-CAPTURE-A', date '2099-01-01', 'ZZTEST-OWNER-DECISION', true),
    (v_capture_b, v_licensor, 'ZZTEST-CAPTURE-B', date '2099-01-02', 'ZZTEST-OWNER-DECISION', false);

  insert into plm.contract_property(capture_id, id, exact_property_text)
  values
    (v_capture_a, v_property, 'ZZTEST EXACT PROPERTY'),
    (v_capture_b, v_property_b, 'ZZTEST OTHER EXACT PROPERTY');
  insert into plm.contract_property_document
    (capture_id, id, evidence_identity, document_sha256, signature_status)
  values
    (v_capture_b, v_document, 'ZZTEST-OPAQUE-DOCUMENT-B', repeat('a', 64), 'ZZTEST-SIGNED'),
    (v_capture_a, v_document_a, 'ZZTEST-OPAQUE-DOCUMENT-A', repeat('b', 64), 'ZZTEST-SIGNED');

  insert into plm.contract_property_evidence
    (capture_id, property_id, document_id, page_schedule_locator)
  values (v_capture_a, v_property, v_document_a, 'ZZTEST-SCHEDULE-SAME-CAPTURE');

  v_rejected := false;
  begin
    insert into plm.contract_property_evidence
      (capture_id, property_id, document_id, page_schedule_locator)
    values (v_capture_a, v_property, v_document, 'ZZTEST-SCHEDULE-1');
  exception when foreign_key_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_rejected := v_constraint = 'contract_property_evidence_document_fkey';
  end;
  if not v_rejected then
    raise exception 'cross-capture document evidence was not rejected by the intended constraint';
  end if;

  v_rejected := false;
  begin
    insert into plm.contract_property_evidence
      (capture_id, property_id, document_id, page_schedule_locator)
    values (v_capture_a, v_property_b, v_document_a, 'ZZTEST-SCHEDULE-CROSS-PROPERTY');
  exception when foreign_key_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_rejected := v_constraint = 'contract_property_evidence_property_fkey';
  end;
  if not v_rejected then
    raise exception 'cross-capture Property evidence was not rejected by the intended constraint';
  end if;

  v_rejected := false;
  begin
    insert into plm.contract_property_document
      (capture_id, evidence_identity, document_sha256, signature_status)
    values (v_capture_a, 'ZZTEST-BAD-HASH', 'not-a-sha', 'ZZTEST-SIGNED');
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_rejected := v_constraint = 'contract_property_document_sha256_valid';
  end;
  if not v_rejected then
    raise exception 'invalid SHA-256 was not rejected by the intended constraint';
  end if;

  v_rejected := false;
  begin
    insert into plm.contract_property_document
      (capture_id, evidence_identity, document_sha256, signature_status)
    values (v_capture_a, 'ZZTEST-DUPLICATE-HASH', repeat('a', 64), 'ZZTEST-SIGNED');
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_rejected := v_constraint = 'contract_property_document_sha256_uq';
  end;
  if not v_rejected then
    raise exception 'duplicate document SHA-256 was not rejected by the intended index';
  end if;

  v_rejected := false;
  begin
    insert into plm.contract_property(capture_id, exact_property_text)
    values (v_capture_a, 'ZZTEST EXACT PROPERTY');
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_rejected := v_constraint = 'contract_property_licensor_identity_uq';
  end;
  if not v_rejected then
    raise exception 'duplicate exact Property identity was not rejected by the intended index';
  end if;

  v_rejected := false;
  begin
    insert into plm.contract_property_capture
      (licensor_id, source_identity, evidence_date, decision_authority, controlling_chain_complete)
    values (v_licensor, '   ', date '2099-01-03', 'ZZTEST-OWNER-DECISION', true);
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_rejected := v_constraint = 'contract_property_capture_source_identity_not_blank';
  end;
  if not v_rejected then raise exception 'blank capture identity was not rejected'; end if;

  v_rejected := false;
  begin
    insert into plm.contract_property_document
      (capture_id, evidence_identity, document_sha256, signature_status)
    values (v_capture_a, ' ', repeat('c', 64), 'ZZTEST-SIGNED');
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_rejected := v_constraint = 'contract_property_document_evidence_identity_not_blank';
  end;
  if not v_rejected then raise exception 'blank document identity was not rejected'; end if;

  v_rejected := false;
  begin
    insert into plm.contract_property(capture_id, exact_property_text)
    values (v_capture_a, '   ');
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_rejected := v_constraint = 'contract_property_exact_text_not_blank';
  end;
  if not v_rejected then raise exception 'blank exact Property text was not rejected'; end if;

  v_rejected := false;
  begin
    insert into plm.contract_property_evidence
      (capture_id, property_id, document_id, page_schedule_locator)
    values (v_capture_a, v_property, v_document_a, ' ');
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    v_rejected := v_constraint = 'contract_property_evidence_locator_not_blank';
  end;
  if not v_rejected then raise exception 'blank evidence locator was not rejected'; end if;
end $$;

rollback;
