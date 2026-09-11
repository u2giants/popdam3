-- Contracts for 20260905083426_core_franchise_canonical_entity.sql (issue #2333).
--
-- What is being pinned:
--   1. core.franchise and core.franchise_alias exist, with RLS enabled, a shared_read
--      SELECT policy, and read-only grants for `authenticated`.
--   2. Identity is source-scoped: (licensor_id, source_system, source_id) is unique with
--      NULLS NOT DISTINCT, so a licensor cannot accumulate duplicate 'manual' rows.
--   3. Licensor is part of that key: the SAME source_system/source_id under a DIFFERENT
--      licensor is accepted. This is the collision that a bare source-id join gets wrong.
--   4. Alias integrity is Licensor-safe: an alias whose licensor_id disagrees with its
--      parent franchise's licensor is unrepresentable (composite foreign key), and one
--      normalized observation may not resolve to two franchises of one licensor, while
--      the same observation under a different licensor is fine.
--   5. Alias normalization is the repository's single frozen normalizer.
--   6. Compatibility with live source-specific Franchise evidence: every distinct
--      franchise name present in plm.pmt_franchise is representable in core.franchise
--      (non-blank and normalizing non-blank), and its bigint source key survives the
--      text source_id. On an ephemeral database that table is empty; the assertion then
--      runs against the shape a Paramount row actually has, so it can never silently
--      pass by having nothing to check.
--
-- Every assertion rolls back. This test seeds no durable rows.

begin;

-- core.licensor is protected by the licensing write-authority guard
-- (20260817124545 / 20260819151527), which refuses any canonical write without an
-- exact transaction-bound authorization. Each synthetic licensor this file seeds is
-- authorized individually, immediately before its own insert, by the narrow route the
-- guard is designed to consume: one plm.licensing_write_authorization row naming this
-- backend, this transaction, the exact target table and the exact protected columns.
-- That is the same pattern core_licensor_code_nulls_distinct_contracts.sql and the CI
-- fixture seed use. The blanket helper public.ci_authorize_licensing_contract_test() is
-- deliberately NOT used here: scripts/database-contract-authorization.test.mjs pins the
-- in-file callers of that helper to one legacy contract file. The guard is NOT weakened,
-- bypassed or edited; every authorization below is real, transaction-bound, scoped to a
-- single write, and disappears with the rollback at the end of this file.

do $contracts$
declare
  v_licensor_a uuid;
  v_licensor_b uuid;
  v_licensor_c uuid;
  v_franchise_a uuid;
  v_franchise_b uuid;
  v_rls boolean;
  v_policies integer;
  v_has_insert_grant boolean;
  v_indexdef text;
  v_bad_names bigint;
  v_sample_name text;
  v_sample_source_id text;
begin
  -- 1. Existence -------------------------------------------------------------
  if to_regclass('core.franchise') is null then
    raise exception 'CONTRACT: core.franchise is missing; issue #2333 creates the canonical Franchise entity.';
  end if;
  if to_regclass('core.franchise_alias') is null then
    raise exception 'CONTRACT: core.franchise_alias is missing; issue #2333 creates the canonical alias contract.';
  end if;

  -- RLS and grants -----------------------------------------------------------
  select relrowsecurity into v_rls from pg_class where oid = 'core.franchise'::regclass;
  if v_rls is distinct from true then
    raise exception 'CONTRACT: row-level security is not enabled on core.franchise.';
  end if;
  select relrowsecurity into v_rls from pg_class where oid = 'core.franchise_alias'::regclass;
  if v_rls is distinct from true then
    raise exception 'CONTRACT: row-level security is not enabled on core.franchise_alias.';
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'core'
    and tablename in ('franchise','franchise_alias')
    and policyname = 'shared_read'
    and cmd = 'SELECT';
  if v_policies <> 2 then
    raise exception 'CONTRACT: expected a shared_read SELECT policy on both core.franchise and core.franchise_alias, found %.', v_policies;
  end if;

  select exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'core'
      and table_name in ('franchise','franchise_alias')
      and grantee = 'authenticated'
      and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
  ) into v_has_insert_grant;
  if v_has_insert_grant then
    raise exception 'CONTRACT: browser role `authenticated` holds a write grant on a core Franchise table; both are read-only to browser roles.';
  end if;

  -- 2. NULLS NOT DISTINCT on the source-scoped identity key -------------------
  select indexdef into v_indexdef
  from pg_indexes
  where schemaname = 'core' and indexname = 'franchise_licensor_source_key';
  if v_indexdef is null then
    raise exception 'CONTRACT: unique index franchise_licensor_source_key is missing.';
  end if;
  if v_indexdef !~* 'nulls not distinct' then
    raise exception 'CONTRACT: franchise_licensor_source_key must be NULLS NOT DISTINCT so a licensor cannot hold many null-source_id franchises. Definition: %', v_indexdef;
  end if;

  -- Seed two licensors ------------------------------------------------------
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '23330000-0000-4000-8000-000000000001', repeat('a', 64),
    'issue-2333 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code)
  values ('CONTRACT 2333 Licensor A', 'ctr2333a')
  returning id into v_licensor_a;

  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '23330000-0000-4000-8000-000000000002', repeat('b', 64),
    'issue-2333 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code)
  values ('CONTRACT 2333 Licensor B', 'ctr2333b')
  returning id into v_licensor_b;

  insert into core.franchise (licensor_id, name, source_system, source_id)
  values (v_licensor_a, 'Contract Franchise One', 'paramount', '12')
  returning id into v_franchise_a;

  -- Same source key, different licensor: MUST be accepted. A bare source-id join
  -- would fuse these two rows and misattribute the franchise.
  begin
    insert into core.franchise (licensor_id, name, source_system, source_id)
    values (v_licensor_b, 'Contract Franchise Two', 'paramount', '12')
    returning id into v_franchise_b;
  exception when others then
    raise exception 'CONTRACT: core.franchise refused the same source key under a different licensor (%). Licensor must be part of the identity key.', sqlerrm;
  end;

  -- Same source key, same licensor: MUST be refused.
  begin
    insert into core.franchise (licensor_id, name, source_system, source_id)
    values (v_licensor_a, 'Contract Franchise Duplicate', 'paramount', '12');
    raise exception 'CONTRACT: core.franchise accepted a duplicate (licensor, source_system, source_id) triple.';
  exception when unique_violation then
    null;
  end;

  -- Many code-less franchises per licensor are legitimate; a real code is unique.
  -- (This assertion caught a NULLS NOT DISTINCT code key that allowed exactly one
  -- code-less franchise per licensor and refused every later one.)
  insert into core.franchise (licensor_id, name, source_system, source_id)
  values (v_licensor_a, 'Contract Codeless One', 'paramount', '51'),
         (v_licensor_a, 'Contract Codeless Two', 'paramount', '52');
  insert into core.franchise (licensor_id, name, code, source_system, source_id)
  values (v_licensor_a, 'Contract Coded One', 'ctr-code', 'paramount', '53');
  begin
    insert into core.franchise (licensor_id, name, code, source_system, source_id)
    values (v_licensor_a, 'Contract Coded Two', 'ctr-code', 'paramount', '54');
    raise exception 'CONTRACT: core.franchise accepted a duplicate code within one licensor.';
  exception when unique_violation then
    null;
  end;

  -- Two null-source_id manual rows for one licensor: MUST be refused.
  insert into core.franchise (licensor_id, name, source_system)
  values (v_licensor_a, 'Contract Manual Franchise', 'manual');
  begin
    insert into core.franchise (licensor_id, name, source_system)
    values (v_licensor_a, 'Contract Manual Franchise Two', 'manual');
    raise exception 'CONTRACT: core.franchise accepted a second null-source_id row for one licensor and source system.';
  exception when unique_violation then
    null;
  end;

  -- Blank and unnormalizable names are refused -------------------------------
  begin
    insert into core.franchise (licensor_id, name, source_system, source_id)
    values (v_licensor_a, '   ', 'paramount', '99');
    raise exception 'CONTRACT: core.franchise accepted a blank name.';
  exception when check_violation then
    null;
  end;
  begin
    insert into core.franchise (licensor_id, name, source_system, source_id)
    values (v_licensor_a, '---', 'paramount', '98');
    raise exception 'CONTRACT: core.franchise accepted a name that normalizes to nothing, which no observation could ever match.';
  exception when check_violation then
    null;
  end;

  -- 4/5. Alias integrity ------------------------------------------------------
  insert into core.franchise_alias (franchise_id, licensor_id, alias)
  values (v_franchise_a, v_licensor_a, 'Contract  Franchise-One');

  if not exists (
    select 1 from core.franchise_alias
    where franchise_id = v_franchise_a
      and normalized_alias = core.normalize_popsg_property_observation('Contract  Franchise-One')
  ) then
    raise exception 'CONTRACT: core.franchise_alias.normalized_alias is not generated by core.normalize_popsg_property_observation.';
  end if;

  -- An alias claiming a licensor its parent franchise does not have is unrepresentable.
  begin
    insert into core.franchise_alias (franchise_id, licensor_id, alias)
    values (v_franchise_a, v_licensor_b, 'Cross Licensor Alias');
    raise exception 'CONTRACT: core.franchise_alias accepted an alias whose licensor disagrees with its parent franchise.';
  exception when foreign_key_violation then
    null;
  end;

  -- One normalized observation may not resolve twice within one licensor.
  begin
    insert into core.franchise_alias (franchise_id, licensor_id, alias)
    values (v_franchise_a, v_licensor_a, 'contract franchise one');
    raise exception 'CONTRACT: core.franchise_alias accepted two aliases normalizing identically under one licensor.';
  exception when unique_violation then
    null;
  end;

  -- The same observation under a DIFFERENT licensor is legitimate.
  begin
    insert into core.franchise_alias (franchise_id, licensor_id, alias)
    values (v_franchise_b, v_licensor_b, 'Contract Franchise-One');
  exception when others then
    raise exception 'CONTRACT: core.franchise_alias refused the same observation under a different licensor (%). Alias uniqueness is licensor-scoped, not global.', sqlerrm;
  end;

  -- Deleting a franchise that still has aliases is refused, not silently cascaded.
  begin
    delete from core.franchise where id = v_franchise_a;
    raise exception 'CONTRACT: deleting a core.franchise silently discarded its aliases; the alias foreign key must RESTRICT.';
  -- ON DELETE RESTRICT raises restrict_violation (23001), not foreign_key_violation.
  exception when restrict_violation or foreign_key_violation then
    null;
  end;

  -- 6. Compatibility with live source-specific Franchise evidence -------------
  if to_regclass('plm.pmt_franchise') is not null then
    execute $q$
      select count(*)
      from (select distinct franchise_name from plm.pmt_franchise) s
      where length(btrim(s.franchise_name)) = 0
         or length(core.normalize_popsg_property_observation(s.franchise_name)) = 0
    $q$ into v_bad_names;
    if v_bad_names > 0 then
      raise exception 'CONTRACT: % distinct plm.pmt_franchise names are not representable in core.franchise (blank, or normalizing to nothing).', v_bad_names;
    end if;

    execute $q$
      select franchise_name, franchise_source_id::text
      from plm.pmt_franchise
      order by franchise_source_id
      limit 1
    $q$ into v_sample_name, v_sample_source_id;
  end if;

  -- Fall back to the shape a Paramount landing row actually has, so this assertion
  -- can never pass merely because the evidence table is empty.
  if v_sample_name is null then
    v_sample_name := 'Star Trek';
    v_sample_source_id := '10421';
  end if;

  -- This row gets a licensor of its own. Licensors A and B already hold
  -- ('paramount', '12'), and on a populated landing table the sampled
  -- franchise_source_id could legitimately BE 12; reusing one of them would then
  -- fail unique_violation for a reason this assertion does not test.
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '23330000-0000-4000-8000-000000000003', repeat('c', 64),
    'issue-2333 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code)
  values ('CONTRACT 2333 Licensor C', 'ctr2333c')
  returning id into v_licensor_c;

  insert into core.franchise (licensor_id, name, source_system, source_id, source_evidence)
  values (v_licensor_c, v_sample_name, 'paramount',
          v_sample_source_id, 'contract test: plm.pmt_franchise shape');

  if not exists (
    select 1 from core.franchise
    where licensor_id = v_licensor_c
      and source_system = 'paramount'
      and source_id = v_sample_source_id
      and source_id::bigint = v_sample_source_id::bigint
  ) then
    raise exception 'CONTRACT: a Paramount franchise source key did not round-trip through core.franchise.source_id.';
  end if;

  raise notice 'CONTRACT OK: core.franchise / core.franchise_alias (issue #2333).';
end
$contracts$;

rollback;
