-- Rollback-safe Phase 4 contract tests for
-- 20260726030000_coldlion_licensor_property_phase4_link_approved.sql
-- (plm.link_coldlion_licensors_properties_core — the UNGRANTED deep-validation
-- core; plm.link_coldlion_licensors_properties_approved — the PINNED wrapper
-- granted to service_role; and the link_approved mode of
-- plm/public.sync_coldlion_licensors_properties).
--
-- Run against a disposable DB or preview AFTER migrations 20260724030000 (Phase 1),
-- 20260724060000 + 20260724061000 (Phase 2A), and 20260726030000 (Phase 4) are applied.
-- Fixtures roll back. Do not run as a long-lived production session.
--
-- Proves the Phase 4 LINK_APPROVED contract (fix_coldlion_licensor_property_cutover.md
-- §6.4, §11.1 Phase-4 cases, Phase 4 gate):
--   * exact approved fixture links through the ungranted core: deterministic
--     coldlion source refs (source_id = <company>/<division>/<mgTypeCode>/<mgCode>)
--     added BESIDE existing refs, typed mirror rows linked to the approved
--     canonical UUIDs, resolution_status 'manually_matched', approver stamped,
--     full run accounting
--   * idempotency: an identical committed re-run inserts/updates nothing and never
--     churns resolved_at; the core checks distinct_canonical only when supplied
--     (the pinned production wrapper always supplies exactly 271)
--   * exact input validation: wrong hash / wrong count / wrong distinct count each
--     abort with no partial work
--   * unapproved-mapping rejection even with a self-consistent hash (live typed
--     re-verification): cross-code NASA-style link, cross-entity FRIDA-style link,
--     name drift, missing mirror row (ColdLion-only), missing canonical (orphan)
--   * conflicting existing coldlion source ref / conflicting existing mirror link
--     each abort with no partial work
--   * duplicate composite key in the payload aborts
--   * NO canonical mutation: core.licensor/core.property counts, fixture codes,
--     names, statuses (incl. lapsed staying inactive), and property parent edges
--     are all unchanged; non-coldlion (DesignFlow) refs untouched
--   * mixed valid+invalid payload links NOTHING (atomic, no partial work)
--   * pinned wrapper: EVERY expected contract except the exact approved Phase 4
--     set (hash 1230f5a12d0f2a3029f1d3df17fc5b5f, count 542, distinct_canonical
--     271) is rejected with the pinned-set message — through the wrapper itself
--     (wrong hash / wrong count / wrong distinct), through the plm dispatch,
--     and through the public entry point — before any deep validation runs.
--     (The accepted 542-row pinned path is exercised separately in the
--     rolled-back preview rehearsal, not with tiny fixtures.)
--   * mode contract: link_approved without a contract raises the missing-contract
--     message; mirror_only rejects the contract; promote_approved (Phase 5)
--     still raises
--   * mirror_only regression through the re-declared 3-arg dispatch
--   * privileges: the core is UNGRANTED (owner-only — service_role/authenticated/
--     anon/public all denied in the catalog); the pinned wrapper and the 3-arg
--     sync lane are service_role-only (anon/authenticated denied, service_role
--     retained); old 2-arg signatures dropped; api run-list surface includes
--     Phase 4 link runs

begin;

-- Hash/encoding helpers (temp, rolled back). p4_link_hash mirrors the migration's
-- frozen encoding exactly: '<entity_type>|<company>/<division>/<mgTypeCode>/<mgCode>|<canonical_id>'
-- sorted by composite key (C collation) and joined by newline.
create function pg_temp.p4_map(p_entity text, p_div text, p_type text, p_code text, p_canonical uuid)
returns jsonb
language sql
stable
as $fn$
  select jsonb_build_object(
    'entity_type', p_entity,
    'company_code', 'EDGEHOME',
    'division_code', p_div,
    'mg_type_code', p_type,
    'mg_code', p_code,
    'canonical_id', p_canonical::text);
$fn$;

create function pg_temp.p4_input(p_approver text, p_mappings jsonb)
returns jsonb
language sql
stable
as $fn$
  select jsonb_build_object(
    'approved_by', p_approver,
    'approved_at_utc', '2026-07-26T00:00:00Z',
    'mappings', p_mappings);
$fn$;

create function pg_temp.p4_link_hash(p_mappings jsonb)
returns text
language sql
stable
as $fn$
  with m as (
    select (x.value ->> 'entity_type') as entity_type,
           (x.value ->> 'company_code') || '/' || (x.value ->> 'division_code') || '/'
             || (x.value ->> 'mg_type_code') || '/' || (x.value ->> 'mg_code') as source_id,
           (x.value ->> 'canonical_id') as canonical_id_text
    from jsonb_array_elements(p_mappings) x(value)
  )
  select md5(coalesce(string_agg(entity_type || '|' || source_id || '|' || canonical_id_text,
                                 E'\n' order by source_id collate "C"), md5('')))
  from m;
$fn$;

create function pg_temp.p4_expected(p_mappings jsonb, p_count integer, p_distinct integer)
returns jsonb
language sql
stable
as $fn$
  select jsonb_build_object(
    'hash', pg_temp.p4_link_hash(p_mappings),
    'count', p_count,
    'distinct_canonical', p_distinct);
$fn$;

do $$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_approver text;
  v_l1 uuid; v_l2 uuid; v_lx uuid; v_ln uuid; v_lc uuid; v_lc2 uuid;
  v_ld uuid; v_ld2 uuid; v_l3 uuid;
  v_p1 uuid; v_q1 uuid;
  v_mappings jsonb;
  v_input jsonb;
  v_expected jsonb;
  v_hash text;
  v_run jsonb;
  v_count integer;
  v_link uuid;
  v_text text;
  v_res_status text;
  v_res_by text;
  v_res_at timestamptz;
  v_ref record;
  v_runrow record;
  v_lic_count_before bigint;
  v_prop_count_before bigint;
  v_noncl_refs_before bigint;
  v_has_service boolean;
  v_has_auth boolean;
begin
  v_approver := 'P4 Test Approver ' || v_suffix;

  -- Baseline counts (must be unchanged by every link_approved call).
  select count(*) into v_lic_count_before from core.licensor;
  select count(*) into v_prop_count_before from core.property;
  select count(*) into v_noncl_refs_before from core.taxonomy_source_ref
    where source_system <> 'coldlion';

  -- ------------------------------------------------------------------
  -- Header fixtures (semantic meanings; real preview headers already exist).
  -- ------------------------------------------------------------------
  insert into plm.merch_group_header (company_code, division_code, mg_type_code, mg_type_desc, raw)
  values ('EDGEHOME', 'CW001', '05', 'Licensor', '{"test":"phase4"}'::jsonb),
         ('EDGEHOME', 'CW001', '06', 'Property', '{"test":"phase4"}'::jsonb),
         ('EDGEHOME', 'SP001', '05', 'Licensor', '{"test":"phase4"}'::jsonb),
         ('EDGEHOME', 'SP001', '06', 'Property', '{"test":"phase4"}'::jsonb)
  on conflict (company_code, division_code, mg_type_code) do nothing;

  -- ------------------------------------------------------------------
  -- Canonical fixtures (9 licensors, 2 properties).
  -- ------------------------------------------------------------------
  insert into core.licensor (name, code, status, metadata)
  values ('P4 Link Licensor ' || v_suffix, 'P4L-' || v_suffix, 'active', '{"test":"phase4"}'::jsonb)
  returning id into v_l1;
  insert into core.licensor (name, code, status, metadata)
  values ('P4 Lapsed Licensor ' || v_suffix, 'P4LAP-' || v_suffix, 'inactive', '{"test":"phase4"}'::jsonb)
  returning id into v_l2;
  insert into core.licensor (name, code, status, metadata)
  values ('P4 Crosscode ' || v_suffix, 'P4XCANON-' || v_suffix, 'active', '{"test":"phase4"}'::jsonb)
  returning id into v_lx;
  insert into core.licensor (name, code, status, metadata)
  values ('P4 Name A ' || v_suffix, 'P4N-' || v_suffix, 'active', '{"test":"phase4"}'::jsonb)
  returning id into v_ln;
  insert into core.licensor (name, code, status, metadata)
  values ('P4 Conflict ' || v_suffix, 'P4C-' || v_suffix, 'active', '{"test":"phase4"}'::jsonb)
  returning id into v_lc;
  insert into core.licensor (name, code, status, metadata)
  values ('P4 Conflict Other ' || v_suffix, 'P4C2-' || v_suffix, 'active', '{"test":"phase4"}'::jsonb)
  returning id into v_lc2;
  insert into core.licensor (name, code, status, metadata)
  values ('P4 Prelinked ' || v_suffix, 'P4D-' || v_suffix, 'active', '{"test":"phase4"}'::jsonb)
  returning id into v_ld;
  insert into core.licensor (name, code, status, metadata)
  values ('P4 Prelinked Other ' || v_suffix, 'P4D2-' || v_suffix, 'active', '{"test":"phase4"}'::jsonb)
  returning id into v_ld2;
  insert into core.licensor (name, code, status, metadata)
  values ('P4 Partial Licensor ' || v_suffix, 'P4L2-' || v_suffix, 'active', '{"test":"phase4"}'::jsonb)
  returning id into v_l3;
  insert into core.property (licensor_id, name, code, status, metadata)
  values (v_l1, 'P4 Link Property ' || v_suffix, 'P4P-' || v_suffix, 'active', '{"test":"phase4"}'::jsonb)
  returning id into v_p1;
  insert into core.property (licensor_id, name, code, status, metadata)
  values (v_l1, 'P4 Type Collision ' || v_suffix, 'P4Q-' || v_suffix, 'active', '{"test":"phase4"}'::jsonb)
  returning id into v_q1;

  -- ------------------------------------------------------------------
  -- Mirror fixtures (unresolved; names mirror the canonical rows).
  -- ------------------------------------------------------------------
  insert into plm.erp_licensor (company_code, division_code, mg_type_code, mg_code, mg_type_desc,
                                name, resolution_status, source_hash, raw)
  values ('EDGEHOME', 'CW001', '05', 'P4L-' || v_suffix, 'Licensor',
          'P4 Link Licensor ' || v_suffix, 'unresolved', 'p4h1', '{"test":"phase4"}'::jsonb),
         ('EDGEHOME', 'SP001', '05', 'P4L-' || v_suffix, 'Licensor',
          'P4 Link Licensor ' || v_suffix, 'unresolved', 'p4h2', '{"test":"phase4"}'::jsonb),
         ('EDGEHOME', 'CW001', '05', 'P4LAP-' || v_suffix, 'Licensor',
          'P4 Lapsed Licensor ' || v_suffix, 'unresolved', 'p4h3', '{"test":"phase4"}'::jsonb),
         ('EDGEHOME', 'CW001', '05', 'P4X-' || v_suffix, 'Licensor',
          'P4 Crosscode ' || v_suffix, 'unresolved', 'p4h4', '{"test":"phase4"}'::jsonb),
         ('EDGEHOME', 'CW001', '05', 'P4N-' || v_suffix, 'Licensor',
          'P4 Name B ' || v_suffix, 'unresolved', 'p4h5', '{"test":"phase4"}'::jsonb),
         ('EDGEHOME', 'CW001', '05', 'P4Q-' || v_suffix, 'Licensor',
          'P4 Type Collision ' || v_suffix, 'unresolved', 'p4h6', '{"test":"phase4"}'::jsonb),
         ('EDGEHOME', 'CW001', '05', 'P4ORPH-' || v_suffix, 'Licensor',
          'P4 Orphan ' || v_suffix, 'unresolved', 'p4h7', '{"test":"phase4"}'::jsonb),
         ('EDGEHOME', 'CW001', '05', 'P4C-' || v_suffix, 'Licensor',
          'P4 Conflict ' || v_suffix, 'unresolved', 'p4h8', '{"test":"phase4"}'::jsonb),
         ('EDGEHOME', 'CW001', '05', 'P4L2-' || v_suffix, 'Licensor',
          'P4 Partial Licensor ' || v_suffix, 'unresolved', 'p4h9', '{"test":"phase4"}'::jsonb);
  -- Pre-linked mirror (conflicting-link fixture): already linked to v_ld2.
  insert into plm.erp_licensor (company_code, division_code, mg_type_code, mg_code, mg_type_desc,
                                name, licensor_id, resolution_status, resolved_at, resolved_by,
                                source_hash, raw)
  values ('EDGEHOME', 'CW001', '05', 'P4D-' || v_suffix, 'Licensor',
          'P4 Prelinked ' || v_suffix, v_ld2, 'manually_matched', now(), 'p4-fixture',
          'p4h10', '{"test":"phase4"}'::jsonb);
  insert into plm.erp_property (company_code, division_code, mg_type_code, mg_code, mg_type_desc,
                                name, resolution_status, source_hash, raw)
  values ('EDGEHOME', 'CW001', '06', 'P4P-' || v_suffix, 'Property',
          'P4 Link Property ' || v_suffix, 'unresolved', 'p4h11', '{"test":"phase4"}'::jsonb);

  -- Pre-seeded conflicting source ref (conflicting-ref fixture): the same source_id
  -- already points at a DIFFERENT licensor (v_lc2).
  insert into core.taxonomy_source_ref (entity_schema, entity_table, entity_id,
                                        source_system, source_table, source_id, source_code,
                                        source_name, confidence, raw)
  values ('core', 'licensor', v_lc2, 'coldlion', 'merchGroupDetails',
          'EDGEHOME/CW001/05/P4C-' || v_suffix, 'P4C-' || v_suffix,
          'P4 Conflict ' || v_suffix, 'verified', '{"test":"phase4"}'::jsonb);

  -- ==================================================================
  -- 1) Happy path: the exact approved fixture links refs + mirror rows.
  -- ==================================================================
  v_mappings := jsonb_build_array(
    pg_temp.p4_map('licensor', 'CW001', '05', 'P4L-' || v_suffix, v_l1),
    pg_temp.p4_map('licensor', 'SP001', '05', 'P4L-' || v_suffix, v_l1),
    pg_temp.p4_map('licensor', 'CW001', '05', 'P4LAP-' || v_suffix, v_l2),
    pg_temp.p4_map('property', 'CW001', '06', 'P4P-' || v_suffix, v_p1));
  v_input := pg_temp.p4_input(v_approver, v_mappings);
  v_expected := pg_temp.p4_expected(v_mappings, 4, 3);
  v_hash := pg_temp.p4_link_hash(v_mappings);

  select to_jsonb(t) into v_run
    from plm.link_coldlion_licensors_properties_core(v_input, v_expected) t;

  if v_run ->> 'mode' <> 'link_approved' then
    raise exception 'happy path: mode not link_approved: %', v_run;
  end if;
  if (v_run ->> 'rows_seen')::int <> 4
     or (v_run ->> 'rows_inserted')::int <> 4
     or (v_run ->> 'rows_updated')::int <> 4
     or (v_run ->> 'rows_unchanged')::int <> 0 then
    raise exception 'happy path accounting wrong: %', v_run;
  end if;
  if (v_run ->> 'licensor_rows')::int <> 3 or (v_run ->> 'property_rows')::int <> 1
     or (v_run ->> 'division_count')::int <> 2 then
    raise exception 'happy path entity/division counts wrong: %', v_run;
  end if;
  if v_run ->> 'snapshot_hash' is distinct from v_hash then
    raise exception 'happy path approved hash mismatch: % vs %', v_run ->> 'snapshot_hash', v_hash;
  end if;

  -- Source refs: deterministic composite source_id, correct entity, verified, audit raw.
  select r.entity_schema, r.entity_table, r.entity_id, r.source_code, r.source_name,
         r.confidence::text as confidence, r.raw ->> 'approved_mapping_hash' as raw_hash,
         r.raw ->> 'phase' as raw_phase
    into v_ref
    from core.taxonomy_source_ref r
   where r.source_system = 'coldlion' and r.source_table = 'merchGroupDetails'
     and r.source_id = 'EDGEHOME/CW001/05/P4L-' || v_suffix;
  if v_ref.entity_schema <> 'core' or v_ref.entity_table <> 'licensor'
     or v_ref.entity_id is distinct from v_l1
     or v_ref.source_code <> 'P4L-' || v_suffix
     or v_ref.source_name <> 'P4 Link Licensor ' || v_suffix
     or v_ref.confidence <> 'verified'
     or v_ref.raw_hash is distinct from v_hash
     or v_ref.raw_phase <> '4' then
    raise exception 'happy path source ref wrong: %', v_ref;
  end if;
  select count(*) into v_count from core.taxonomy_source_ref
   where source_system = 'coldlion' and source_id like '%' || v_suffix;
  if v_count <> 5 then
    -- 4 approved + 1 intentionally pre-seeded conflicting-ref fixture (P4C).
    raise exception 'expected 5 coldlion refs for fixture keys (4 approved + 1 seeded), got %', v_count;
  end if;

  -- Mirror links: typed link, manually_matched, approver stamped.
  select e.licensor_id, e.resolution_status, e.resolved_by, e.resolved_at
    into v_link, v_res_status, v_res_by, v_res_at
    from plm.erp_licensor e
   where e.company_code = 'EDGEHOME' and e.division_code = 'CW001'
     and e.mg_type_code = '05' and e.mg_code = 'P4L-' || v_suffix;
  if v_link is distinct from v_l1 or v_res_status <> 'manually_matched'
     or v_res_by <> v_approver or v_res_at is null then
    raise exception 'happy path licensor mirror link wrong';
  end if;
  select e.property_id into v_link from plm.erp_property e
   where e.company_code = 'EDGEHOME' and e.division_code = 'CW001'
     and e.mg_type_code = '06' and e.mg_code = 'P4P-' || v_suffix;
  if v_link is distinct from v_p1 then
    raise exception 'happy path property mirror link wrong';
  end if;
  -- Same canonical linked from both divisions (2 source rows -> 1 UUID).
  select count(*) into v_count from plm.erp_licensor e
   where e.licensor_id = v_l1 and e.mg_code = 'P4L-' || v_suffix;
  if v_count <> 2 then raise exception 'both division mirror rows must link to the same UUID'; end if;

  -- Lapsed canonical stays inactive (linking never activates).
  if (select status from core.licensor where id = v_l2) is distinct from 'inactive' then
    raise exception 'link_approved resurrected an inactive canonical licensor';
  end if;

  -- Run accounting row.
  select r.status, r.source_name, r.error,
         r.metadata ->> 'mode' as m_mode, r.metadata ->> 'phase' as m_phase,
         r.metadata ->> 'approved_mapping_hash' as m_hash,
         r.metadata ->> 'source_refs_inserted' as m_refs_ins,
         r.metadata ->> 'mirror_links_set' as m_links_set,
         r.metadata ->> 'canonical_rows_created' as m_created,
         r.metadata ->> 'distinct_canonical' as m_distinct
    into v_runrow
    from ingest.sync_run r
   where r.id = (v_run ->> 'sync_run_id')::uuid;
  if v_runrow.status <> 'succeeded'
     or v_runrow.source_name <> 'coldlion_licensors_properties_link_approved'
     or v_runrow.m_mode <> 'link_approved' or v_runrow.m_phase <> '4'
     or v_runrow.m_hash is distinct from v_hash
     or v_runrow.m_refs_ins <> '4' or v_runrow.m_links_set <> '4'
     or v_runrow.m_created <> '0' or v_runrow.m_distinct <> '3' then
    raise exception 'run accounting wrong: %', v_runrow;
  end if;

  -- ==================================================================
  -- 2) Idempotency: identical re-run changes nothing; resolved_at stable.
  --    These call the UNGRANTED core directly, where distinct_canonical is
  --    checked only when supplied (the pinned production wrapper always
  --    supplies exactly 271).
  -- ==================================================================
  select to_jsonb(t) into v_run
    from plm.link_coldlion_licensors_properties_core(v_input, v_expected) t;
  if (v_run ->> 'rows_inserted')::int <> 0
     or (v_run ->> 'rows_updated')::int <> 0
     or (v_run ->> 'rows_unchanged')::int <> 4 then
    raise exception 'idempotent re-run accounting wrong: %', v_run;
  end if;
  if (select e.resolved_at from plm.erp_licensor e
       where e.company_code = 'EDGEHOME' and e.division_code = 'CW001'
         and e.mg_type_code = '05' and e.mg_code = 'P4L-' || v_suffix) is distinct from v_res_at then
    raise exception 'idempotent re-run churned resolved_at';
  end if;

  v_expected := jsonb_build_object('hash', v_hash, 'count', 4);  -- no distinct_canonical
  select to_jsonb(t) into v_run
    from plm.link_coldlion_licensors_properties_core(v_input, v_expected) t;
  if (v_run ->> 'rows_unchanged')::int <> 4 then
    raise exception 'expected contract without distinct_canonical must still validate: %', v_run;
  end if;

  -- ==================================================================
  -- 3) Exact input validation: hash / count / distinct mismatch each abort.
  -- ==================================================================
  v_expected := pg_temp.p4_expected(v_mappings, 4, 3);
  begin
    perform plm.link_coldlion_licensors_properties_core(
      v_input,
      jsonb_build_object('hash', md5('bogus-' || v_suffix), 'count', 4, 'distinct_canonical', 3));
    raise exception 'P4-FAIL wrong hash was accepted';
  exception when others then
    if sqlerrm !~* 'hash mismatch' then
      raise exception 'wrong-hash rejection message unexpected: %', sqlerrm;
    end if;
  end;

  begin
    perform plm.link_coldlion_licensors_properties_core(
      v_input,
      jsonb_build_object('hash', v_hash, 'count', 5, 'distinct_canonical', 3));
    raise exception 'P4-FAIL wrong count was accepted';
  exception when others then
    if sqlerrm !~* 'count mismatch' then
      raise exception 'wrong-count rejection message unexpected: %', sqlerrm;
    end if;
  end;

  begin
    perform plm.link_coldlion_licensors_properties_core(
      v_input,
      jsonb_build_object('hash', v_hash, 'count', 4, 'distinct_canonical', 2));
    raise exception 'P4-FAIL wrong distinct was accepted';
  exception when others then
    if sqlerrm !~* 'distinct canonical count mismatch' then
      raise exception 'wrong-distinct rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- ==================================================================
  -- 4) Unapproved-mapping rejection even with a self-consistent hash
  --    (live typed re-verification). Each payload carries its OWN correct
  --    hash, so only the live re-verification can stop it.
  -- ==================================================================
  -- 4a. NASA-style cross-code: canonical code differs from mg_code (name agrees).
  v_mappings := jsonb_build_array(pg_temp.p4_map('licensor', 'CW001', '05', 'P4X-' || v_suffix, v_lx));
  begin
    perform plm.link_coldlion_licensors_properties_core(
      pg_temp.p4_input(v_approver, v_mappings), pg_temp.p4_expected(v_mappings, 1, 1));
    raise exception 'P4-FAIL cross-code link was accepted';
  exception when others then
    if sqlerrm !~* 'live re-verification failed' then
      raise exception 'cross-code rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- 4b. FRIDA-style cross-entity: licensor mapping pointing at a canonical PROPERTY.
  v_mappings := jsonb_build_array(pg_temp.p4_map('licensor', 'CW001', '05', 'P4Q-' || v_suffix, v_q1));
  begin
    perform plm.link_coldlion_licensors_properties_core(
      pg_temp.p4_input(v_approver, v_mappings), pg_temp.p4_expected(v_mappings, 1, 1));
    raise exception 'P4-FAIL cross-entity link was accepted';
  exception when others then
    if sqlerrm !~* 'live re-verification failed' then
      raise exception 'cross-entity rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- 4c. Name drift: normalized names disagree.
  v_mappings := jsonb_build_array(pg_temp.p4_map('licensor', 'CW001', '05', 'P4N-' || v_suffix, v_ln));
  begin
    perform plm.link_coldlion_licensors_properties_core(
      pg_temp.p4_input(v_approver, v_mappings), pg_temp.p4_expected(v_mappings, 1, 1));
    raise exception 'P4-FAIL name-drift link was accepted';
  exception when others then
    if sqlerrm !~* 'live re-verification failed' then
      raise exception 'name-drift rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- 4d. Excluded ColdLion-only row: no mirror row exists.
  v_mappings := jsonb_build_array(pg_temp.p4_map('licensor', 'CW001', '05', 'P4NOMIRROR-' || v_suffix, v_l1));
  begin
    perform plm.link_coldlion_licensors_properties_core(
      pg_temp.p4_input(v_approver, v_mappings), pg_temp.p4_expected(v_mappings, 1, 1));
    raise exception 'P4-FAIL missing-mirror link was accepted';
  exception when others then
    if sqlerrm !~* 'live re-verification failed' then
      raise exception 'missing-mirror rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- 4e. Excluded canonical-only/orphan row: no canonical row exists.
  v_mappings := jsonb_build_array(pg_temp.p4_map('licensor', 'CW001', '05', 'P4ORPH-' || v_suffix, gen_random_uuid()));
  begin
    perform plm.link_coldlion_licensors_properties_core(
      pg_temp.p4_input(v_approver, v_mappings), pg_temp.p4_expected(v_mappings, 1, 1));
    raise exception 'P4-FAIL missing-canonical link was accepted';
  exception when others then
    if sqlerrm !~* 'live re-verification failed' then
      raise exception 'missing-canonical rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- ==================================================================
  -- 5) Conflicting existing provenance / mirror link abort everything.
  -- ==================================================================
  -- 5a. Existing coldlion ref for the same source_id points at a different licensor.
  v_mappings := jsonb_build_array(pg_temp.p4_map('licensor', 'CW001', '05', 'P4C-' || v_suffix, v_lc));
  begin
    perform plm.link_coldlion_licensors_properties_core(
      pg_temp.p4_input(v_approver, v_mappings), pg_temp.p4_expected(v_mappings, 1, 1));
    raise exception 'P4-FAIL conflicting ref was accepted';
  exception when others then
    if sqlerrm !~* 'conflicting existing coldlion source ref' then
      raise exception 'conflicting-ref rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- 5b. Mirror row already linked to a different canonical UUID.
  v_mappings := jsonb_build_array(pg_temp.p4_map('licensor', 'CW001', '05', 'P4D-' || v_suffix, v_ld));
  begin
    perform plm.link_coldlion_licensors_properties_core(
      pg_temp.p4_input(v_approver, v_mappings), pg_temp.p4_expected(v_mappings, 1, 1));
    raise exception 'P4-FAIL conflicting mirror link was accepted';
  exception when others then
    if sqlerrm !~* 'conflicting existing mirror link' then
      raise exception 'conflicting-link rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- ==================================================================
  -- 6) Mixed valid+invalid payload links NOTHING (atomic, no partial work).
  -- ==================================================================
  v_mappings := jsonb_build_array(
    pg_temp.p4_map('licensor', 'CW001', '05', 'P4L2-' || v_suffix, v_l3),   -- valid
    pg_temp.p4_map('licensor', 'CW001', '05', 'P4X-' || v_suffix, v_lx));   -- cross-code violation
  begin
    perform plm.link_coldlion_licensors_properties_core(
      pg_temp.p4_input(v_approver, v_mappings), pg_temp.p4_expected(v_mappings, 2, 2));
    raise exception 'P4-FAIL mixed payload was accepted';
  exception when others then
    if sqlerrm !~* 'live re-verification failed' then
      raise exception 'mixed-payload rejection message unexpected: %', sqlerrm;
    end if;
  end;
  select count(*) into v_count from core.taxonomy_source_ref
   where source_system = 'coldlion' and source_id = 'EDGEHOME/CW001/05/P4L2-' || v_suffix;
  if v_count <> 0 then
    raise exception 'failed run left a partial source ref for the valid row';
  end if;
  select count(*) into v_count from plm.erp_licensor e
   where e.mg_code = 'P4L2-' || v_suffix and e.licensor_id is not null;
  if v_count <> 0 then
    raise exception 'failed run left a partial mirror link for the valid row';
  end if;

  -- ==================================================================
  -- 7) Payload-shape guards.
  -- ==================================================================
  -- 7a. Duplicate composite key inside the payload.
  v_mappings := jsonb_build_array(
    pg_temp.p4_map('licensor', 'CW001', '05', 'P4L-' || v_suffix, v_l1),
    pg_temp.p4_map('licensor', 'CW001', '05', 'P4L-' || v_suffix, v_l1));
  begin
    perform plm.link_coldlion_licensors_properties_core(
      pg_temp.p4_input(v_approver, v_mappings), pg_temp.p4_expected(v_mappings, 2, 1));
    raise exception 'P4-FAIL duplicate composite key was accepted';
  exception when others then
    if sqlerrm !~* 'duplicate composite source key' then
      raise exception 'duplicate-key rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- 7b. Invalid entity_type (typed isolation is strict).
  v_mappings := jsonb_build_array(jsonb_build_object(
    'entity_type', 'vendor', 'company_code', 'EDGEHOME', 'division_code', 'CW001',
    'mg_type_code', '05', 'mg_code', 'P4L-' || v_suffix, 'canonical_id', v_l1::text));
  begin
    perform plm.link_coldlion_licensors_properties_core(
      pg_temp.p4_input(v_approver, v_mappings), pg_temp.p4_expected(v_mappings, 1, 1));
    raise exception 'P4-FAIL invalid entity_type was accepted';
  exception when others then
    if sqlerrm !~* 'input shape invalid' then
      raise exception 'entity-type rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- 7c. Missing mappings array / missing approved_by.
  begin
    perform plm.link_coldlion_licensors_properties_core(
      jsonb_build_object('approved_by', v_approver, 'approved_at_utc', '2026-07-26T00:00:00Z'),
      jsonb_build_object('hash', v_hash, 'count', 4));
    raise exception 'P4-FAIL missing mappings array was accepted';
  exception when others then
    if sqlerrm !~* 'input.mappings must be a JSON array' then
      raise exception 'missing-mappings rejection message unexpected: %', sqlerrm;
    end if;
  end;
  begin
    perform plm.link_coldlion_licensors_properties_core(
      jsonb_build_object('approved_at_utc', '2026-07-26T00:00:00Z', 'mappings', v_mappings),
      jsonb_build_object('hash', v_hash, 'count', 4));
    raise exception 'P4-FAIL missing approved_by was accepted';
  exception when others then
    if sqlerrm !~* 'approved_by is required' then
      raise exception 'missing-approver rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- ==================================================================
  -- 8) Mode contract.
  -- ==================================================================
  -- 8a. link_approved without the separate expected contract raises.
  begin
    perform plm.sync_coldlion_licensors_properties(v_input, 'link_approved', null);
    raise exception 'P4-FAIL link_approved without expected contract was accepted';
  exception when others then
    if sqlerrm !~* 'requires an explicit expected contract' then
      raise exception 'missing-contract rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- 8b. mirror_only rejects the expected contract.
  begin
    perform plm.sync_coldlion_licensors_properties(v_input, 'mirror_only', v_expected);
    raise exception 'P4-FAIL mirror_only accepted a link expected contract';
  exception when others then
    if sqlerrm !~* 'only valid with mode link_approved' then
      raise exception 'mirror_only-contract rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- 8c. promote_approved (Phase 5) still raises loudly via the public wrapper.
  begin
    perform public.sync_coldlion_licensors_properties(v_input, 'promote_approved', null);
    raise exception 'P4-FAIL promote_approved was accepted';
  exception when others then
    if sqlerrm !~* 'Unsupported mode' then
      raise exception 'promote_approved rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- 8d. Pinned-wrapper rejection: every non-pinned expected contract is
  --     rejected with the pinned-set message — through the wrapper itself
  --     (wrong hash, wrong count, wrong distinct) and through the plm/public
  --     link_approved dispatch — before any deep validation runs. The accepted
  --     542-row pinned path is exercised separately in the rolled-back preview
  --     rehearsal, not with tiny fixtures.
  begin
    perform plm.link_coldlion_licensors_properties_approved(
      v_input, jsonb_build_object('hash', md5('bogus-' || v_suffix), 'count', 542, 'distinct_canonical', 271));
    raise exception 'P4-FAIL pinned wrapper accepted a wrong hash';
  exception when others then
    if sqlerrm !~* 'does not match the pinned approved Phase 4 set' then
      raise exception 'wrapper wrong-hash rejection message unexpected: %', sqlerrm;
    end if;
  end;
  begin
    perform plm.link_coldlion_licensors_properties_approved(
      v_input, jsonb_build_object('hash', '1230f5a12d0f2a3029f1d3df17fc5b5f', 'count', 541, 'distinct_canonical', 271));
    raise exception 'P4-FAIL pinned wrapper accepted a wrong count';
  exception when others then
    if sqlerrm !~* 'does not match the pinned approved Phase 4 set' then
      raise exception 'wrapper wrong-count rejection message unexpected: %', sqlerrm;
    end if;
  end;
  begin
    perform plm.link_coldlion_licensors_properties_approved(
      v_input, jsonb_build_object('hash', '1230f5a12d0f2a3029f1d3df17fc5b5f', 'count', 542, 'distinct_canonical', 270));
    raise exception 'P4-FAIL pinned wrapper accepted a wrong distinct';
  exception when others then
    if sqlerrm !~* 'does not match the pinned approved Phase 4 set' then
      raise exception 'wrapper wrong-distinct rejection message unexpected: %', sqlerrm;
    end if;
  end;
  begin
    perform plm.sync_coldlion_licensors_properties(v_input, 'link_approved', v_expected);
    raise exception 'P4-FAIL plm dispatch accepted a non-pinned contract';
  exception when others then
    if sqlerrm !~* 'does not match the pinned approved Phase 4 set' then
      raise exception 'plm dispatch pin rejection message unexpected: %', sqlerrm;
    end if;
  end;
  begin
    perform public.sync_coldlion_licensors_properties(v_input, 'link_approved', v_expected);
    raise exception 'P4-FAIL public dispatch accepted a non-pinned contract';
  exception when others then
    if sqlerrm !~* 'does not match the pinned approved Phase 4 set' then
      raise exception 'public dispatch pin rejection message unexpected: %', sqlerrm;
    end if;
  end;

  -- ==================================================================
  -- 9) NO canonical mutation + NO residue from any failed call.
  -- ==================================================================
  if (select count(*) from core.licensor) <> v_lic_count_before + 9
     or (select count(*) from core.property) <> v_prop_count_before + 2 then
    raise exception 'link_approved created or deleted canonical rows';
  end if;
  if (select code from core.licensor where id = v_l1) is distinct from 'P4L-' || v_suffix
     or (select name from core.licensor where id = v_l1) is distinct from 'P4 Link Licensor ' || v_suffix
     or (select status from core.licensor where id = v_l1) is distinct from 'active' then
    raise exception 'link_approved mutated canonical licensor code/name/status';
  end if;
  if (select status from core.licensor where id = v_l2) is distinct from 'inactive' then
    raise exception 'lapsed canonical licensor was activated';
  end if;
  if (select licensor_id from core.property where id = v_p1) is distinct from v_l1
     or (select status from core.property where id = v_p1) is distinct from 'active'
     or (select code from core.property where id = v_p1) is distinct from 'P4P-' || v_suffix
     or (select name from core.property where id = v_p1) is distinct from 'P4 Link Property ' || v_suffix then
    raise exception 'link_approved mutated canonical property parent/status/code/name';
  end if;
  if (select count(*) from core.taxonomy_source_ref where source_system <> 'coldlion') <> v_noncl_refs_before then
    raise exception 'non-coldlion (DesignFlow) source refs changed';
  end if;
  -- Residue: only the 4 approved refs + the 1 intentionally seeded conflicting-ref
  -- fixture exist for fixture keys; only the 3 approved licensor links + the 1
  -- pre-seeded pre-linked fixture + the 1 approved property link exist.
  select count(*) into v_count from core.taxonomy_source_ref
   where source_system = 'coldlion' and source_id like '%' || v_suffix;
  if v_count <> 5 then
    raise exception 'unexpected coldlion ref residue for fixture keys: %', v_count;
  end if;
  select count(*) into v_count from plm.erp_licensor e
   where e.mg_code like '%' || v_suffix and e.licensor_id is not null;
  if v_count <> 4 then
    raise exception 'unexpected licensor mirror-link residue: % (expected 4 = 3 approved + 1 seeded)', v_count;
  end if;
  select count(*) into v_count from plm.erp_property e
   where e.mg_code like '%' || v_suffix and e.property_id is not null;
  if v_count <> 1 then
    raise exception 'unexpected property mirror-link residue: % (expected 1 approved)', v_count;
  end if;

  -- ==================================================================
  -- 10) mirror_only regression through the re-declared 3-arg dispatch.
  -- ==================================================================
  declare
    v_snap jsonb := $snap${
      "companyCode": "EDGEHOME",
      "headers": [
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor"},
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property"}
      ],
      "pairs": [
        {"divisionCode":"CW001","mgTypeCode":"05","mgTypeDesc":"Licensor","entityType":"licensor"},
        {"divisionCode":"CW001","mgTypeCode":"06","mgTypeDesc":"Property","entityType":"property"}
      ],
      "details": [
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"05","mgCode":"P4M-LIC","mgDesc":"P4 Mirror Regression Licensor","mgTypeDesc":"Licensor","active":true},
        {"companyCode":"EDGEHOME","divisionCode":"CW001","mgTypeCode":"06","mgCode":"P4M-PROP","mgDesc":"P4 Mirror Regression Property","mgTypeDesc":"Property","active":true}
      ],
      "pages": [
        {"divisionCode":"CW001","mgTypeCode":"05","pagesFetched":1,"terminalReached":true,"rowCount":1},
        {"divisionCode":"CW001","mgTypeCode":"06","pagesFetched":1,"terminalReached":true,"rowCount":1}
      ],
      "config": {"headerDivisions":["CW001"],"requiredDivisions":["CW001"],"licensorFloor":1,"propertyFloor":1,"maxCountDropPct":50},
      "prior": null
    }$snap$;
  begin
    select to_jsonb(t) into v_run from plm.sync_coldlion_licensors_properties(v_snap, 'mirror_only') t;
    if (v_run ->> 'rows_inserted')::int <> 2 or v_run ->> 'mode' <> 'mirror_only' then
      raise exception 'mirror_only regression failed: %', v_run;
    end if;
  end;

  -- ==================================================================
  -- 11) Privileges and catalog shape.
  -- ==================================================================
  select has_function_privilege('service_role', 'plm.sync_coldlion_licensors_properties(jsonb,text,jsonb)', 'execute'),
         has_function_privilege('authenticated', 'plm.sync_coldlion_licensors_properties(jsonb,text,jsonb)', 'execute')
    into v_has_service, v_has_auth;
  if v_has_service is not true then
    raise exception 'service_role must have execute on the 3-arg guarded lane';
  end if;
  if v_has_auth is true then
    raise exception 'authenticated must NOT have execute on the 3-arg guarded lane';
  end if;
  select has_function_privilege('service_role', 'plm.link_coldlion_licensors_properties_approved(jsonb,jsonb)', 'execute'),
         has_function_privilege('authenticated', 'plm.link_coldlion_licensors_properties_approved(jsonb,jsonb)', 'execute')
    into v_has_service, v_has_auth;
  if v_has_service is not true or v_has_auth is true then
    raise exception 'link_approved implementation privilege wrong (service_role yes / authenticated no)';
  end if;
  select has_function_privilege('service_role', 'public.sync_coldlion_licensors_properties(jsonb,text,jsonb)', 'execute'),
         has_function_privilege('authenticated', 'public.sync_coldlion_licensors_properties(jsonb,text,jsonb)', 'execute')
    into v_has_service, v_has_auth;
  if v_has_service is not true or v_has_auth is true then
    raise exception 'public wrapper privilege wrong (service_role yes / authenticated no)';
  end if;

  -- The ungranted core: NO role but the database owner may execute it.
  if has_function_privilege('service_role', 'plm.link_coldlion_licensors_properties_core(jsonb,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'plm.link_coldlion_licensors_properties_core(jsonb,jsonb)', 'execute')
     or has_function_privilege('anon', 'plm.link_coldlion_licensors_properties_core(jsonb,jsonb)', 'execute')
     or has_function_privilege('public', 'plm.link_coldlion_licensors_properties_core(jsonb,jsonb)', 'execute') then
    raise exception 'ungranted core must NOT be executable by service_role/authenticated/anon/public';
  end if;

  -- Browser roles lack execute on every granted entry point; service_role retains it.
  if has_function_privilege('anon', 'plm.link_coldlion_licensors_properties_approved(jsonb,jsonb)', 'execute')
     or has_function_privilege('anon', 'plm.sync_coldlion_licensors_properties(jsonb,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.sync_coldlion_licensors_properties(jsonb,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'plm.link_coldlion_licensors_properties_approved(jsonb,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'plm.sync_coldlion_licensors_properties(jsonb,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.sync_coldlion_licensors_properties(jsonb,text,jsonb)', 'execute') then
    raise exception 'browser roles (anon/authenticated) must NOT have execute on the approved/plm-sync/public-sync entry points';
  end if;
  if not has_function_privilege('service_role', 'plm.link_coldlion_licensors_properties_approved(jsonb,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'plm.sync_coldlion_licensors_properties(jsonb,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.sync_coldlion_licensors_properties(jsonb,text,jsonb)', 'execute') then
    raise exception 'service_role must retain execute on the approved/plm-sync/public-sync entry points';
  end if;
  -- Old 2-arg signatures must be gone (replaced by the 3-arg forms).
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('plm', 'public') and p.proname = 'sync_coldlion_licensors_properties'
      and p.pronargs = 2
  ) then
    raise exception 'old 2-arg sync_coldlion_licensors_properties signature must be dropped';
  end if;

  -- api run-list surface exists and includes Phase 4 link runs.
  if to_regprocedure('api.coldlion_licensor_property_run_list(integer)') is null then
    raise exception 'missing api.coldlion_licensor_property_run_list(integer)';
  end if;
  if pg_get_functiondef('api.coldlion_licensor_property_run_list(integer)'::regprocedure)
       not like '%coldlion_licensors_properties_link_approved%' then
    raise exception 'run-list surface must include Phase 4 link_approved runs';
  end if;

  raise notice 'Phase 4 link_approved contracts passed (suffix=%)', v_suffix;
end $$;

rollback;
