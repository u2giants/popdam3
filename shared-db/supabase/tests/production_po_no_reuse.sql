-- #4257 / PopDAM #277. Transactional contract tests for permanent production PO use.
-- Run after 20261013201822_production_po_no_reuse.sql in a disposable test database.
-- Synthetic fixture labels only; every row is rolled back at the end.
begin;

do $test$
declare
  v_constraint text;
  v_state text;
  v_used timestamptz;
  v_role text;
  v_registry text;
  v_privilege text;
  v_first uuid := '42570000-0000-4000-8000-000000000001';
  v_voided uuid := '42570000-0000-4000-8000-000000000002';
  v_punct uuid := '42570000-0000-4000-8000-000000000003';
  v_zero uuid := '42570000-0000-4000-8000-000000000004';
  v_admitted uuid := '42570000-0000-4000-8000-000000000005';
  v_wrong_admission uuid := '42570000-0000-4000-8000-000000000006';
  v_wrong_attempt uuid := '42570000-0000-4000-8000-000000000007';
  v_bad_hash uuid := '42570000-0000-4000-8000-000000000008';
  v_recycled uuid := '42570000-0000-4000-8000-000000000009';
begin
  -- The reservation and one-use admission ledgers are owner-only, including for
  -- service_role, which must not become an application bypass.
  foreach v_role in array array['anon','authenticated','service_role'] loop
    foreach v_registry in array array['plm.production_po_reservation','plm.production_po_legacy_admission'] loop
      foreach v_privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(v_role,v_registry,v_privilege) then
          raise exception 'application roles have production PO registry privileges';
        end if;
      end loop;
    end loop;
  end loop;

  -- Outer POSIX whitespace (including tabs/newlines) and NBSP normalize to the
  -- same identity. Ordinary case/space normalization is exercised by the first row.
  insert into plm.production_order(id, production_order_number, source_system, source_id)
  values (v_first, '  TEST-NoReuse-Normalized  ', 'po-no-reuse-test', 'fixture:first');

  begin
    insert into plm.production_order(id, production_order_number, source_system, source_id)
    values ('42570000-0000-4000-8000-000000000010', E'\t test-noreuse-normalized \n', 'po-no-reuse-test', 'fixture:tab-newline');
    raise exception 'tab/newline-wrapped duplicate production PO was accepted';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'production_po_no_reuse' then raise; end if;
  end;

  begin
    insert into plm.production_order(id, production_order_number, source_system, source_id)
    values ('42570000-0000-4000-8000-000000000011', U&'\00A0test-noreuse-normalized\00A0', 'po-no-reuse-test', 'fixture:nbsp');
    raise exception 'NBSP-wrapped duplicate production PO was accepted';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'production_po_no_reuse' then raise; end if;
  end;

  -- Punctuation and leading zeroes are significant parts of the production PO.
  insert into plm.production_order(id, production_order_number, source_system, source_id)
  values (v_punct, 'TEST-NoReuse-Punct-1', 'po-no-reuse-test', 'fixture:punct');
  insert into plm.production_order(id, production_order_number, source_system, source_id)
  values (v_zero, '0004257', 'po-no-reuse-test', 'fixture:leading-zero');
  insert into plm.production_order(id, production_order_number, source_system, source_id)
  values ('42570000-0000-4000-8000-000000000012', 'TESTNOREUSEPUNCT1', 'po-no-reuse-test', 'fixture:punct-distinct');
  insert into plm.production_order(id, production_order_number, source_system, source_id)
  values ('42570000-0000-4000-8000-000000000013', '4257', 'po-no-reuse-test', 'fixture:zero-distinct');

  -- A same-order normalized representation update is allowed; renaming the PO or
  -- changing the order UUID is refused even when the caller is the table owner.
  update plm.production_order set production_order_number = 'test-noreuse-normalized'
  where id = v_first;
  begin
    update plm.production_order set production_order_number = 'TEST-NOREUSE-RENAMED'
    where id = v_first;
    raise exception 'production PO rename was accepted';
  exception when check_violation then null;
  end;
  begin
    update plm.production_order set id = '42570000-0000-4000-8000-000000000014'
    where id = v_first;
    raise exception 'production order UUID change was accepted';
  exception when check_violation then null;
  end;

  -- Voiding/cancellation does not release the reservation; hard deletion does not
  -- release it either.
  insert into plm.production_order(id, production_order_number, status, voided_at, source_system, source_id)
  values (v_voided, 'TEST-NoReuse-Voided', 'cancelled', now(), 'po-no-reuse-test', 'fixture:voided');
  begin
    insert into plm.production_order(id, production_order_number, source_system, source_id)
    values ('42570000-0000-4000-8000-000000000015', 'test-noreuse-voided', 'po-no-reuse-test', 'fixture:voided-duplicate');
    raise exception 'voided production PO was reused';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'production_po_no_reuse' then raise; end if;
  end;
  delete from plm.production_order where id = v_voided;
  begin
    insert into plm.production_order(id, production_order_number, source_system, source_id)
    values (v_recycled, 'TEST-NoReuse-Voided', 'po-no-reuse-test', 'fixture:deleted-reuse');
    raise exception 'deleted production PO was reused';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'production_po_no_reuse' then raise; end if;
  end;

  -- A historical duplicate is admitted only for its exact future UUID and exact
  -- normalized value; the admission is consumed by that one insert.
  insert into plm.production_po_legacy_admission(
    order_id, normalized_po, source_evidence_sha256, review_receipt_sha256
  ) values (
    v_admitted, 'test-noreuse-normalized', repeat('a', 64), repeat('b', 64)
  );
  insert into plm.production_order(id, production_order_number, source_system, source_id)
  values (v_admitted, 'TEST-NOREUSE-NORMALIZED', 'po-no-reuse-test', 'fixture:admitted-history');
  select used_at into v_used from plm.production_po_legacy_admission where order_id = v_admitted;
  if v_used is null then raise exception 'exact historical admission was not consumed'; end if;
  if (select count(*) from plm.production_order
      where lower(btrim(production_order_number)) = 'test-noreuse-normalized') <> 2
     or not exists (select 1 from plm.production_order
                    where id = v_first and production_order_number = 'test-noreuse-normalized')
     or not exists (select 1 from plm.production_order
                    where id = v_admitted and production_order_number = 'TEST-NOREUSE-NORMALIZED') then
    raise exception 'historical duplicate headers or their raw spellings were not preserved';
  end if;
  delete from plm.production_order where id = v_admitted;
  begin
    insert into plm.production_order(id, production_order_number, source_system, source_id)
    values (v_admitted, 'test-noreuse-normalized', 'po-no-reuse-test', 'fixture:admission-reuse');
    raise exception 'consumed historical admission released a deleted PO';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'production_po_no_reuse' then raise; end if;
  end;

  -- Wrong-ID use is denied and leaves the admission unconsumed. An exact-ID update
  -- of its already-existing order is ordinary idempotency and also leaves it unused.
  insert into plm.production_order(id, production_order_number, source_system, source_id)
  values (v_wrong_admission, 'TEST-NoReuse-WrongId', 'po-no-reuse-test', 'fixture:wrong-id-owner');
  insert into plm.production_po_legacy_admission(
    order_id, normalized_po, source_evidence_sha256, review_receipt_sha256
  ) values (
    v_wrong_attempt, 'test-noreuse-wrongid', repeat('c', 64), repeat('d', 64)
  );
  begin
    insert into plm.production_order(id, production_order_number, source_system, source_id)
    values ('42570000-0000-4000-8000-000000000016', 'test-noreuse-wrongid', 'po-no-reuse-test', 'fixture:wrong-id-attempt');
    raise exception 'wrong-UUID historical admission authorized a duplicate';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'production_po_no_reuse' then raise; end if;
  end;
  select used_at into v_used from plm.production_po_legacy_admission where order_id = v_wrong_attempt;
  if v_used is not null then raise exception 'wrong-UUID attempt consumed the admission'; end if;
  update plm.production_order set production_order_number = upper(production_order_number)
  where id = v_wrong_admission;
  select used_at into v_used from plm.production_po_legacy_admission where order_id = v_wrong_attempt;
  if v_used is not null then raise exception 'ordinary exact-order update consumed an unrelated admission'; end if;

  -- Both evidence digests are mandatory lowercase SHA-256 hex strings.
  begin
    insert into plm.production_po_legacy_admission(
      order_id, normalized_po, source_evidence_sha256, review_receipt_sha256
    ) values (
      v_bad_hash, 'test-noreuse-normalized', repeat('g', 64), repeat('f', 64)
    );
    raise exception 'malformed admission digest was accepted';
  exception when check_violation then null;
  end;
end;
$test$;

rollback;

-- Give service_role a temporary test INSERT privilege to prove that even a
-- direct writer cannot bypass the trigger. The ACL and fixtures roll back;
-- neither the migration nor production grants this additional privilege.
begin;
grant insert on plm.production_order to service_role;
set local role service_role;
insert into plm.production_order(production_order_number,source_system,source_id)
values ('TEST-NOREUSE-SERVICE-4257','po-no-reuse-test','fixture:service-owner');
do $service_test$
declare v_constraint text;
begin
  begin
    insert into plm.production_order(production_order_number,source_system,source_id)
    values (' test-noreuse-service-4257 ','po-no-reuse-test','fixture:service-duplicate');
    raise exception 'service_role bypassed production PO reuse protection';
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'production_po_no_reuse' then raise; end if;
  end;
end;
$service_test$;
rollback;
