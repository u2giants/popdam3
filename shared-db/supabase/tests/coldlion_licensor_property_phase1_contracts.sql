-- Rollback-safe Phase 1 contract tests for
-- 20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql
--
-- Run against a disposable DB or preview AFTER the migration is applied.
-- Fixtures roll back. Do not run as a long-lived production session.
--
-- Proves:
--   * core.property.licensor_id attnotnull + FK ON DELETE RESTRICT
--   * null parent insert fails; delete of referenced licensor fails
--   * header semantic unique key + mirror FK (cannot lie about Big Theme)
--   * composite uniqueness, multi-division same mg_code
--   * FR collision only on mirrors (unique core fixture codes — never code='FR')
--   * typed review FKs + approved_link rules + canonical_only without fake keys
--   * ACTIVE source uniqueness (partial unique index): second active fails;
--     new active succeeds after previous is dismissed or approved_link
--   * status/resolution/resolved-* CHECK matrix (valid + invalid pairs)
--   * rerun idempotency, ambiguity quarantine
--   * NASA/ZAG/FRIDA lifecycle + no status/parent mutation from mirror ops
--   * raw NOT NULL without default; api views omit raw
--   * authenticated has no mutation privileges and no write policies

begin;

do $$
declare
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_lic_friends uuid;
  v_lic_nasa uuid;
  v_lic_zag uuid;
  v_lic_frida uuid;
  v_lic_other uuid;
  v_lic_orphan_target uuid;
  v_prop_fr uuid;
  v_prop_nasa uuid;
  v_prop_zag uuid;
  v_prop_frida uuid;
  v_prop_canonical_only uuid;
  v_parent_before uuid;
  v_status_before app.entity_status;
  v_lic_status_before app.entity_status;
  v_count integer;
  v_name text;
  v_attnotnull boolean;
  v_confdeltype char;
  v_conname text;
  v_has_insert boolean;
  v_has_update boolean;
  v_has_delete boolean;
  v_has_truncate boolean;
  v_has_references boolean;
  v_has_trigger boolean;
  v_write_policies integer;
  v_col_default text;
  v_is_nullable text;
  v_view_def text;
  v_err text;
  v_review_id uuid;
  v_indexdef text;
begin
  -- ------------------------------------------------------------------
  -- Catalog: exact-one parent enforcement
  -- ------------------------------------------------------------------
  select a.attnotnull
  into v_attnotnull
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'core'
    and c.relname = 'property'
    and a.attname = 'licensor_id'
    and not a.attisdropped;

  if v_attnotnull is not true then
    raise exception 'core.property.licensor_id attnotnull is not true';
  end if;

  select c.conname, c.confdeltype
  into v_conname, v_confdeltype
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where c.contype = 'f'
    and nsp.nspname = 'core'
    and rel.relname = 'property'
    and c.conname = 'property_licensor_id_fkey';

  if v_conname is distinct from 'property_licensor_id_fkey' then
    raise exception 'expected FK name property_licensor_id_fkey, got %', v_conname;
  end if;
  -- 'r' = RESTRICT in pg_constraint.confdeltype
  if v_confdeltype is distinct from 'r' then
    raise exception 'property_licensor_id_fkey confdeltype=% (expected r=RESTRICT)', v_confdeltype;
  end if;

  if exists (
    select 1 from pg_class rel
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where rel.relkind = 'r'
      and nsp.nspname in ('core', 'plm', 'api', 'public')
      and rel.relname in (
        'property_licensor', 'licensor_property',
        'property_licensors', 'licensor_properties'
      )
  ) then
    raise exception 'unexpected many-to-many licensor/property bridge table exists';
  end if;

  -- Null parent insert must fail
  begin
    insert into core.property (name, code, status)
    values ('P1 null parent ' || v_suffix, 'P1NULL-' || v_suffix, 'active');
    raise exception 'null licensor_id insert was accepted';
  exception
    when not_null_violation then
      null;
  end;

  -- ------------------------------------------------------------------
  -- Header dictionary fixtures (semantic meanings)
  -- ------------------------------------------------------------------
  insert into plm.merch_group_header (
    company_code, division_code, mg_type_code, mg_type_desc, raw
  ) values
    ('EDGEHOME', 'CW001', '05', 'Licensor', '{"test":true}'::jsonb),
    ('EDGEHOME', 'CW001', '06', 'Property', '{"test":true}'::jsonb),
    ('EDGEHOME', 'SP001', '05', 'Licensor', '{"test":true}'::jsonb),
    ('EDGEHOME', 'SP001', '06', 'Property', '{"test":true}'::jsonb),
    ('EDGEHOME', 'EH001', '05', 'Big Theme', '{"test":true}'::jsonb),
    ('EDGEHOME', 'EH001', '06', 'Little Theme', '{"test":true}'::jsonb)
  on conflict (company_code, division_code, mg_type_code) do update set
    mg_type_desc = excluded.mg_type_desc,
    raw = excluded.raw;

  if not exists (
    select 1 from pg_constraint
    where conname = 'plm_merch_group_header_semantic_key_uidx'
  ) then
    raise exception 'missing plm.merch_group_header semantic unique key';
  end if;

  -- ------------------------------------------------------------------
  -- Canonical fixtures (unique codes only — never production codes like FR)
  -- ------------------------------------------------------------------
  insert into core.licensor (name, code, status, metadata)
  values (
    'P1 Friends TV ' || v_suffix,
    'P1FR-' || v_suffix,
    'active',
    jsonb_build_object('test', 'phase1', 'role', 'friends', 'suffix', v_suffix)
  )
  returning id into v_lic_friends;

  insert into core.licensor (name, code, status, metadata)
  values (
    'P1 NASA ' || v_suffix,
    'P1NASA-' || v_suffix,
    'inactive',
    jsonb_build_object('test', 'phase1', 'role', 'nasa', 'suffix', v_suffix)
  )
  returning id into v_lic_nasa;

  insert into core.licensor (name, code, status, metadata)
  values (
    'P1 ZAG ' || v_suffix,
    'P1ZAG-' || v_suffix,
    'inactive',
    jsonb_build_object('test', 'phase1', 'role', 'zag', 'suffix', v_suffix)
  )
  returning id into v_lic_zag;

  insert into core.licensor (name, code, status, metadata)
  values (
    'P1 FRIDA KAHLO ' || v_suffix,
    'P1FRIDA-' || v_suffix,
    'inactive',
    jsonb_build_object('test', 'phase1', 'role', 'frida', 'suffix', v_suffix)
  )
  returning id into v_lic_frida;

  insert into core.licensor (name, code, status, metadata)
  values (
    'P1 Other Licensor ' || v_suffix,
    'P1OTH-' || v_suffix,
    'active',
    jsonb_build_object('test', 'phase1', 'role', 'other', 'suffix', v_suffix)
  )
  returning id into v_lic_other;

  insert into core.licensor (name, code, status, metadata)
  values (
    'P1 Delete Target ' || v_suffix,
    'P1DEL-' || v_suffix,
    'active',
    jsonb_build_object('test', 'phase1', 'role', 'delete-target', 'suffix', v_suffix)
  )
  returning id into v_lic_orphan_target;

  -- Property under delete-target: deleting that licensor must RESTRICT.
  insert into core.property (licensor_id, name, code, status, metadata)
  values (
    v_lic_orphan_target,
    'P1 Child Of Delete Target ' || v_suffix,
    'P1CHD-' || v_suffix,
    'active',
    jsonb_build_object('test', 'phase1', 'suffix', v_suffix)
  );

  begin
    delete from core.licensor where id = v_lic_orphan_target;
    raise exception 'delete of referenced licensor was accepted (expected RESTRICT)';
  exception
    when foreign_key_violation then
      null;
  end;

  -- Unique core property codes only. FR collision is proven on MIRRORS alone.
  insert into core.property (licensor_id, name, code, status, metadata)
  values (
    v_lic_other,
    'P1 1ST ORDER TROOPER ' || v_suffix,
    'P1TROOP-' || v_suffix,
    'active',
    jsonb_build_object('test', 'phase1', 'role', 'fr-property', 'suffix', v_suffix)
  )
  returning id into v_prop_fr;

  insert into core.property (licensor_id, name, code, status, metadata)
  values (
    v_lic_nasa,
    'P1 NASA Property ' || v_suffix,
    'P1NP-' || v_suffix,
    'inactive',
    jsonb_build_object('test', 'phase1', 'role', 'nasa-prop', 'suffix', v_suffix)
  )
  returning id into v_prop_nasa;

  insert into core.property (licensor_id, name, code, status, metadata)
  values (
    v_lic_zag,
    'P1 ZAG Property ' || v_suffix,
    'P1ZP-' || v_suffix,
    'inactive',
    jsonb_build_object('test', 'phase1', 'role', 'zag-prop', 'suffix', v_suffix)
  )
  returning id into v_prop_zag;

  insert into core.property (licensor_id, name, code, status, metadata)
  values (
    v_lic_frida,
    'P1 FRIDA Property ' || v_suffix,
    'P1FP-' || v_suffix,
    'inactive',
    jsonb_build_object('test', 'phase1', 'role', 'frida-prop', 'suffix', v_suffix)
  )
  returning id into v_prop_frida;

  insert into core.property (licensor_id, name, code, status, metadata)
  values (
    v_lic_other,
    'P1 Canonical Only Property ' || v_suffix,
    'P1CAN-' || v_suffix,
    'active',
    jsonb_build_object('test', 'phase1', 'role', 'canonical-only', 'suffix', v_suffix)
  )
  returning id into v_prop_canonical_only;

  select licensor_id, status
  into v_parent_before, v_status_before
  from core.property
  where id = v_prop_fr;

  select status into v_lic_status_before from core.licensor where id = v_lic_nasa;

  if v_parent_before is null then
    raise exception 'fixture property has null parent after NOT NULL enforcement';
  end if;

  -- ------------------------------------------------------------------
  -- Header semantic FK: cannot insert erp_licensor for EH001 Big Theme
  -- by lying with mg_type_desc='Licensor'
  -- ------------------------------------------------------------------
  begin
    insert into plm.erp_licensor (
      company_code, division_code, mg_type_code, mg_code, mg_type_desc,
      name, resolution_status, source_hash, raw
    ) values (
      'EDGEHOME', 'EH001', '05', 'P1LIE-' || v_suffix, 'Licensor',
      'Fake licensor on Big Theme slot', 'unresolved', 'hash-lie',
      '{"mgCode":"lie"}'::jsonb
    );
    raise exception 'EH001 Big Theme accepted as Licensor via lied mg_type_desc';
  exception
    when foreign_key_violation then
      null; -- expected: no header semantic row (EH001,05,Licensor)
    when check_violation then
      -- also acceptable if check fires first, but FK is the required gate
      null;
  end;

  -- Even with correct-looking check text, missing header semantic row fails.
  -- (CW001 Licensor header exists — positive path below.)

  -- ------------------------------------------------------------------
  -- Composite uniqueness + multi-division
  -- ------------------------------------------------------------------
  insert into plm.erp_licensor (
    company_code, division_code, mg_type_code, mg_code, mg_type_desc,
    name, resolution_status, source_hash, raw
  ) values (
    'EDGEHOME', 'CW001', '05', 'P1L-' || v_suffix, 'Licensor',
    'P1 Mirror Licensor ' || v_suffix, 'unresolved', 'hash-lic-1',
    jsonb_build_object('mgCode', 'P1L-' || v_suffix)
  );

  begin
    insert into plm.erp_licensor (
      company_code, division_code, mg_type_code, mg_code, mg_type_desc,
      name, resolution_status, source_hash, raw
    ) values (
      'EDGEHOME', 'CW001', '05', 'P1L-' || v_suffix, 'Licensor',
      'DUPLICATE', 'unresolved', 'hash-dup', '{}'::jsonb
    );
    raise exception 'composite uniqueness failed for erp_licensor';
  exception
    when unique_violation then
      null;
  end;

  insert into plm.erp_licensor (
    company_code, division_code, mg_type_code, mg_code, mg_type_desc,
    name, resolution_status, source_hash, raw
  ) values (
    'EDGEHOME', 'SP001', '05', 'P1L-' || v_suffix, 'Licensor',
    'P1 Mirror Licensor SP ' || v_suffix, 'unresolved', 'hash-lic-sp',
    jsonb_build_object('division', 'SP001')
  );

  select count(*)::integer into v_count
  from plm.erp_licensor
  where mg_code = 'P1L-' || v_suffix;

  if v_count <> 2 then
    raise exception 'same mg_code in different divisions not distinct (got %)', v_count;
  end if;

  -- raw has no default: omit must fail
  begin
    execute format(
      'insert into plm.erp_licensor (
         company_code, division_code, mg_type_code, mg_code, mg_type_desc,
         name, resolution_status, source_hash
       ) values (%L, %L, %L, %L, %L, %L, %L, %L)',
      'EDGEHOME', 'CW001', '05', 'P1NORAW-' || v_suffix, 'Licensor',
      'Missing raw', 'unresolved', 'hash-noraw'
    );
    raise exception 'erp_licensor insert without raw was accepted';
  exception
    when not_null_violation then
      null;
  end;

  select is_nullable, column_default
  into v_is_nullable, v_col_default
  from information_schema.columns
  where table_schema = 'plm'
    and table_name = 'erp_licensor'
    and column_name = 'raw';

  if v_is_nullable is distinct from 'NO' then
    raise exception 'plm.erp_licensor.raw is nullable';
  end if;
  if v_col_default is not null then
    raise exception 'plm.erp_licensor.raw has a default (%) — importers must supply raw', v_col_default;
  end if;

  select is_nullable, column_default
  into v_is_nullable, v_col_default
  from information_schema.columns
  where table_schema = 'plm'
    and table_name = 'erp_property'
    and column_name = 'raw';

  if v_is_nullable is distinct from 'NO' or v_col_default is not null then
    raise exception 'plm.erp_property.raw must be NOT NULL with no default';
  end if;

  -- ------------------------------------------------------------------
  -- FR cross-entity collision on MIRRORS only (mg_code FR on both types)
  -- ------------------------------------------------------------------
  insert into plm.erp_licensor (
    company_code, division_code, mg_type_code, mg_code, mg_type_desc,
    name, resolution_status, source_hash, raw
  ) values (
    'EDGEHOME', 'CW001', '05', 'FR', 'Licensor',
    'P1 Friends Source ' || v_suffix, 'unresolved', 'hash-fr-lic',
    jsonb_build_object('mgCode', 'FR', 'entity', 'licensor')
  );

  insert into plm.erp_property (
    company_code, division_code, mg_type_code, mg_code, mg_type_desc,
    name, resolution_status, source_hash, raw
  ) values (
    'EDGEHOME', 'CW001', '06', 'FR', 'Property',
    'P1 1ST ORDER TROOPER Source ' || v_suffix, 'unresolved', 'hash-fr-prop',
    jsonb_build_object('mgCode', 'FR', 'entity', 'property')
  );

  -- Both exist; neither auto-linked; distinct entity types.
  select count(*)::integer into v_count
  from (
    select 1 from plm.erp_licensor
    where company_code='EDGEHOME' and division_code='CW001'
      and mg_type_code='05' and mg_code='FR' and licensor_id is null
    union all
    select 1 from plm.erp_property
    where company_code='EDGEHOME' and division_code='CW001'
      and mg_type_code='06' and mg_code='FR' and property_id is null
  ) x;

  if v_count <> 2 then
    raise exception 'FR mirror pair not both present and unlinked (got %)', v_count;
  end if;

  -- Conflict review: cannot put a licensor id on a property review proposed_licensor.
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      proposed_licensor_id, match_method, confidence, reason, status, resolution
    ) values (
      'property', 'source',
      'EDGEHOME', 'CW001', '06', 'FR',
      'P1 1ST ORDER TROOPER Source ' || v_suffix,
      v_lic_friends, 'code_only_unsafe', 'none',
      'cross-entity FR collision — property review must not use licensor columns',
      'conflict', 'conflict'
    );
    raise exception 'property review accepted proposed_licensor_id';
  exception
    when check_violation then
      null;
  end;

  insert into plm.taxonomy_resolution_review (
    entity_type, finding_scope,
    company_code, division_code, mg_type_code, mg_code, source_name,
    proposed_property_id, match_method, confidence, reason, evidence,
    status, resolution
  ) values (
    'property', 'source',
    'EDGEHOME', 'CW001', '06', 'FR',
    'P1 1ST ORDER TROOPER Source ' || v_suffix,
    v_prop_fr, 'code_only_unsafe', 'none',
    'FR code collides with licensor FRIENDS TV entity type; do not cross-match',
    jsonb_build_object(
      'collision', 'cross_entity_code',
      'mirror_licensor_mg_code', 'FR',
      'mirror_property_mg_code', 'FR',
      'friends_fixture_id', v_lic_friends
    ),
    'conflict', 'conflict'
  );

  -- ------------------------------------------------------------------
  -- Rerun idempotency
  -- ------------------------------------------------------------------
  insert into plm.erp_property (
    company_code, division_code, mg_type_code, mg_code, mg_type_desc,
    name, resolution_status, source_hash, raw
  ) values (
    'EDGEHOME', 'CW001', '06', 'P1RERUN-' || v_suffix, 'Property',
    'P1 Rerun Original ' || v_suffix, 'unresolved', 'hash-rerun-1',
    jsonb_build_object('v', 1)
  )
  on conflict (company_code, division_code, mg_type_code, mg_code) do update set
    name = excluded.name,
    source_hash = excluded.source_hash,
    raw = excluded.raw,
    last_seen_at = now();

  insert into plm.erp_property (
    company_code, division_code, mg_type_code, mg_code, mg_type_desc,
    name, resolution_status, source_hash, raw
  ) values (
    'EDGEHOME', 'CW001', '06', 'P1RERUN-' || v_suffix, 'Property',
    'P1 Rerun Renamed ' || v_suffix, 'unresolved', 'hash-rerun-2',
    jsonb_build_object('v', 2)
  )
  on conflict (company_code, division_code, mg_type_code, mg_code) do update set
    name = excluded.name,
    source_hash = excluded.source_hash,
    raw = excluded.raw,
    last_seen_at = now();

  select count(*)::integer, max(name)
  into v_count, v_name
  from plm.erp_property
  where mg_code = 'P1RERUN-' || v_suffix;

  if v_count <> 1 or v_name is distinct from ('P1 Rerun Renamed ' || v_suffix) then
    raise exception 'rerun idempotency failed (count=% name=%)', v_count, v_name;
  end if;

  -- ------------------------------------------------------------------
  -- Ambiguity quarantine + typed review rules
  -- ------------------------------------------------------------------
  insert into plm.erp_licensor (
    company_code, division_code, mg_type_code, mg_code, mg_type_desc,
    name, resolution_status, resolution_reason, source_hash, raw
  ) values (
    'EDGEHOME', 'CW001', '05', 'P1AMB-' || v_suffix, 'Licensor',
    'Ambiguous Name Twin ' || v_suffix, 'ambiguous',
    'two canonical name candidates; quarantined',
    'hash-amb', jsonb_build_object('candidates', 2)
  );

  insert into plm.taxonomy_resolution_review (
    entity_type, finding_scope,
    company_code, division_code, mg_type_code, mg_code, source_name,
    match_method, confidence, reason, evidence, status, resolution
  ) values (
    'licensor', 'source',
    'EDGEHOME', 'CW001', '05', 'P1AMB-' || v_suffix,
    'Ambiguous Name Twin ' || v_suffix,
    'normalized_name', 'low',
    'ambiguous name match: multiple canonical candidates',
    jsonb_build_object(
      'candidate_licensor_ids', jsonb_build_array(v_lic_friends, v_lic_other)
    ),
    'open', 'ambiguous'
  );

  -- manually_matched without link fails
  begin
    insert into plm.erp_licensor (
      company_code, division_code, mg_type_code, mg_code, mg_type_desc,
      name, resolution_status, source_hash, raw
    ) values (
      'EDGEHOME', 'CW001', '05', 'P1BADMATCH-' || v_suffix, 'Licensor',
      'Bad matched', 'manually_matched', 'hash-badmatch', '{}'::jsonb
    );
    raise exception 'manually_matched without licensor_id accepted';
  exception
    when check_violation then
      null;
  end;

  -- Catalog: partial unique index must include active-status predicate
  select indexdef into v_indexdef
  from pg_indexes
  where schemaname = 'plm'
    and indexname = 'plm_taxonomy_resolution_review_source_uidx';

  if v_indexdef is null then
    raise exception 'missing plm_taxonomy_resolution_review_source_uidx';
  end if;
  if v_indexdef !~* 'open'
     or v_indexdef !~* 'quarantined'
     or v_indexdef !~* 'conflict'
     or v_indexdef !~* 'WHERE'
  then
    raise exception
      'source_uidx must be PARTIAL with active statuses open|quarantined|conflict; got: %',
      v_indexdef;
  end if;
  -- Must NOT be a non-partial unique on all rows (no history).
  if v_indexdef !~* 'status' then
    raise exception 'source_uidx missing status predicate (would block review history)';
  end if;

  -- ------------------------------------------------------------------
  -- Status / resolution / resolved-* CHECK matrix
  --
  --   status          | resolution (allowed)                         | resolved IDs / by / at
  --   ----------------|----------------------------------------------|----------------------
  --   open            | NULL, unmatched, ambiguous,                  | all null
  --                   |   canonical_only, deferred                   |
  --   quarantined     | NULL, quarantined, unmatched, ambiguous      | all null
  --   conflict        | NULL, conflict                               | all null
  --   ignored         | NULL, ignored                                | all null
  --   dismissed       | NULL, deferred, unmatched, ignored,          | all null
  --                   |   canonical_only                             |
  --   approved_link   | approved_link (required)                     | typed resolved ID
  --                   |                                              | + nonblank resolved_by
  --                   |                                              | + nonnull resolved_at
  -- ------------------------------------------------------------------

  -- INVALID: approved_link without typed resolved id
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolution
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1BADAPPR-' || v_suffix,
      'Bad approved', 'manual', 'high', 'missing resolved id',
      'approved_link', 'approved_link'
    );
    raise exception 'approved_link without resolved_licensor_id accepted';
  exception
    when check_violation then
      null;
  end;

  -- INVALID: approved_link with resolved id but null resolved_by
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolution,
      resolved_licensor_id, resolved_at
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1BADAPPRBY-' || v_suffix,
      'Bad approved by', 'manual', 'high', 'missing resolved_by',
      'approved_link', 'approved_link', v_lic_other, now()
    );
    raise exception 'approved_link without resolved_by accepted';
  exception
    when check_violation then
      null;
  end;

  -- INVALID: approved_link with blank (whitespace) resolved_by
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolution,
      resolved_licensor_id, resolved_by, resolved_at
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1BADAPPRBLANK-' || v_suffix,
      'Bad approved blank by', 'manual', 'high', 'blank resolved_by',
      'approved_link', 'approved_link', v_lic_other, '   ', now()
    );
    raise exception 'approved_link with blank resolved_by accepted';
  exception
    when check_violation then
      null;
  end;

  -- INVALID: approved_link with resolved id + by but null resolved_at
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolution,
      resolved_licensor_id, resolved_by
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1BADAPPRAT-' || v_suffix,
      'Bad approved at', 'manual', 'high', 'missing resolved_at',
      'approved_link', 'approved_link', v_lic_other, 'phase1-test'
    );
    raise exception 'approved_link without resolved_at accepted';
  exception
    when check_violation then
      null;
  end;

  -- INVALID: status=approved_link but resolution is not approved_link
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolution,
      resolved_licensor_id, resolved_by, resolved_at
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1BADAPPRRES-' || v_suffix,
      'Bad approved resolution', 'manual', 'high', 'resolution mismatch',
      'approved_link', 'ignored', v_lic_other, 'phase1-test', now()
    );
    raise exception 'approved_link with resolution=ignored accepted';
  exception
    when check_violation then
      null;
  end;

  -- INVALID: non-approved status carrying resolution=approved_link
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolution
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1OPENAPPRRES-' || v_suffix,
      'Open with approved_link resolution', 'manual', 'high',
      'illegal resolution', 'open', 'approved_link'
    );
    raise exception 'open status with resolution=approved_link accepted';
  exception
    when check_violation then
      null;
  end;

  -- INVALID: open status cannot carry resolved id
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolved_licensor_id
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1OPENRES-' || v_suffix,
      'Open with resolved', 'manual', 'high', 'illegal', 'open', v_lic_other
    );
    raise exception 'open review with resolved_licensor_id accepted';
  exception
    when check_violation then
      null;
  end;

  -- INVALID: open cannot carry resolved_by / resolved_at
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolved_by, resolved_at
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1OPENBYAT-' || v_suffix,
      'Open with by/at', 'manual', 'high', 'illegal by/at',
      'open', 'phase1-test', now()
    );
    raise exception 'open review with resolved_by/resolved_at accepted';
  exception
    when check_violation then
      null;
  end;

  -- INVALID: conflict row cannot say resolution=ignored
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolution
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1CONFIGN-' || v_suffix,
      'Conflict ignored mismatch', 'manual', 'none',
      'conflict cannot carry ignored', 'conflict', 'ignored'
    );
    raise exception 'conflict status with resolution=ignored accepted';
  exception
    when check_violation then
      null;
  end;

  -- INVALID: ignored row cannot say resolution=conflict
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolution
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1IGNCONF-' || v_suffix,
      'Ignored conflict mismatch', 'manual', 'none',
      'ignored cannot carry conflict', 'ignored', 'conflict'
    );
    raise exception 'ignored status with resolution=conflict accepted';
  exception
    when check_violation then
      null;
  end;

  -- INVALID: property review cannot carry licensor resolved id (typed FKs)
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolution,
      resolved_licensor_id, resolved_by, resolved_at
    ) values (
      'property', 'source',
      'EDGEHOME', 'CW001', '06', 'P1PROPWRONGID-' || v_suffix,
      'Property wrong typed resolved', 'manual', 'high',
      'must use resolved_property_id', 'approved_link', 'approved_link',
      v_lic_other, 'phase1-test', now()
    );
    raise exception 'property approved_link with resolved_licensor_id accepted';
  exception
    when check_violation then
      null;
  end;

  -- VALID matrix samples (each uses a distinct source key so active-unique is free)
  insert into plm.taxonomy_resolution_review (
    entity_type, finding_scope,
    company_code, division_code, mg_type_code, mg_code, source_name,
    match_method, confidence, reason, status, resolution
  ) values
  (
    'licensor', 'source',
    'EDGEHOME', 'CW001', '05', 'P1VALOPEN-' || v_suffix,
    'Valid open unmatched', 'none', 'none',
    'valid open/unmatched', 'open', 'unmatched'
  ),
  (
    'licensor', 'source',
    'EDGEHOME', 'CW001', '05', 'P1VALCONF-' || v_suffix,
    'Valid conflict', 'code_only_unsafe', 'none',
    'valid conflict/conflict', 'conflict', 'conflict'
  ),
  (
    'licensor', 'source',
    'EDGEHOME', 'CW001', '05', 'P1VALIGN-' || v_suffix,
    'Valid ignored', 'manual', 'low',
    'valid ignored/ignored', 'ignored', 'ignored'
  ),
  (
    'licensor', 'source',
    'EDGEHOME', 'CW001', '05', 'P1VALDIS-' || v_suffix,
    'Valid dismissed', 'manual', 'low',
    'valid dismissed/deferred', 'dismissed', 'deferred'
  );

  -- VALID approved-link package (review only; no core mutation)
  insert into plm.taxonomy_resolution_review (
    entity_type, finding_scope,
    company_code, division_code, mg_type_code, mg_code, source_name,
    proposed_licensor_id, match_method, confidence, reason, evidence,
    status, resolution, resolved_licensor_id, resolved_by, resolved_at
  ) values (
    'licensor', 'source',
    'EDGEHOME', 'CW001', '05', 'P1APPR-' || v_suffix,
    'Approved Link Candidate ' || v_suffix,
    v_lic_other, 'manual_review', 'high',
    'human approved exact composite match',
    jsonb_build_object('note', 'phase1 review only'),
    'approved_link', 'approved_link', v_lic_other, 'phase1-test', now()
  );

  -- VALID property approved_link uses resolved_property_id (typed FK preserved)
  insert into plm.taxonomy_resolution_review (
    entity_type, finding_scope,
    company_code, division_code, mg_type_code, mg_code, source_name,
    proposed_property_id, match_method, confidence, reason, evidence,
    status, resolution, resolved_property_id, resolved_by, resolved_at
  ) values (
    'property', 'source',
    'EDGEHOME', 'CW001', '06', 'P1APPRPROP-' || v_suffix,
    'Approved Property Link ' || v_suffix,
    v_prop_fr, 'manual_review', 'high',
    'human approved property link',
    jsonb_build_object('note', 'typed property resolved id'),
    'approved_link', 'approved_link', v_prop_fr, 'phase1-test', now()
  );

  -- unmatched / quarantined source finding
  insert into plm.taxonomy_resolution_review (
    entity_type, finding_scope,
    company_code, division_code, mg_type_code, mg_code, source_name,
    match_method, confidence, reason, evidence, status, resolution
  ) values (
    'licensor', 'source',
    'EDGEHOME', 'CW001', '05', 'P1QUAR-' || v_suffix,
    'Quarantine Candidate ' || v_suffix,
    'none', 'none',
    'unmatched new ColdLion-only record quarantined by default',
    jsonb_build_object('outcome', 'unmatched'),
    'quarantined', 'quarantined'
  );

  -- ------------------------------------------------------------------
  -- Active uniqueness + review history (partial unique index)
  -- ------------------------------------------------------------------
  insert into plm.taxonomy_resolution_review (
    entity_type, finding_scope,
    company_code, division_code, mg_type_code, mg_code, source_name,
    match_method, confidence, reason, status, resolution
  ) values (
    'licensor', 'source',
    'EDGEHOME', 'CW001', '05', 'P1HIST-' || v_suffix,
    'History source key ' || v_suffix,
    'normalized_name', 'medium',
    'first active open finding',
    'open', 'ambiguous'
  )
  returning id into v_review_id;

  -- Second ACTIVE finding for the same source key must fail
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolution
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1HIST-' || v_suffix,
      'History source key duplicate active', 'normalized_name', 'low',
      'second active open must be rejected',
      'open', 'unmatched'
    );
    raise exception 'second active source finding was accepted (expected unique_violation)';
  exception
    when unique_violation then
      null;
  end;

  -- Active conflict also blocked while open remains
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      match_method, confidence, reason, status, resolution
    ) values (
      'licensor', 'source',
      'EDGEHOME', 'CW001', '05', 'P1HIST-' || v_suffix,
      'History source key conflict active', 'code_only_unsafe', 'none',
      'second active conflict must be rejected',
      'conflict', 'conflict'
    );
    raise exception 'second active conflict finding was accepted (expected unique_violation)';
  exception
    when unique_violation then
      null;
  end;

  -- Close out via dismissed (terminal history). resolved_* must stay null.
  update plm.taxonomy_resolution_review
  set status = 'dismissed',
      resolution = 'deferred',
      reason = 'first finding dismissed; history retained'
  where id = v_review_id;

  -- New ACTIVE finding allowed after dismiss (history preserved)
  insert into plm.taxonomy_resolution_review (
    entity_type, finding_scope,
    company_code, division_code, mg_type_code, mg_code, source_name,
    match_method, confidence, reason, status, resolution
  ) values (
    'licensor', 'source',
    'EDGEHOME', 'CW001', '05', 'P1HIST-' || v_suffix,
    'History source key reopened after dismiss', 'normalized_name', 'medium',
    'new active after dismissed history',
    'open', 'unmatched'
  )
  returning id into v_review_id;

  select count(*)::integer into v_count
  from plm.taxonomy_resolution_review
  where finding_scope = 'source'
    and entity_type = 'licensor'
    and company_code = 'EDGEHOME'
    and division_code = 'CW001'
    and mg_type_code = '05'
    and mg_code = 'P1HIST-' || v_suffix;

  if v_count <> 2 then
    raise exception
      'expected 2 history rows for P1HIST source key after dismiss+reopen (got %)',
      v_count;
  end if;

  -- Close out via approved_link (terminal). Then another active may open.
  update plm.taxonomy_resolution_review
  set status = 'approved_link',
      resolution = 'approved_link',
      resolved_licensor_id = v_lic_other,
      resolved_by = 'phase1-test',
      resolved_at = now(),
      reason = 'second finding approved; history retained'
  where id = v_review_id;

  insert into plm.taxonomy_resolution_review (
    entity_type, finding_scope,
    company_code, division_code, mg_type_code, mg_code, source_name,
    match_method, confidence, reason, status, resolution
  ) values (
    'licensor', 'source',
    'EDGEHOME', 'CW001', '05', 'P1HIST-' || v_suffix,
    'History source key reopened after approved_link', 'manual', 'low',
    'new active after approved_link history',
    'quarantined', 'quarantined'
  );

  select count(*)::integer into v_count
  from plm.taxonomy_resolution_review
  where finding_scope = 'source'
    and entity_type = 'licensor'
    and company_code = 'EDGEHOME'
    and division_code = 'CW001'
    and mg_type_code = '05'
    and mg_code = 'P1HIST-' || v_suffix;

  if v_count <> 3 then
    raise exception
      'expected 3 history rows for P1HIST after approved_link+reopen (got %)',
      v_count;
  end if;

  select count(*)::integer into v_count
  from plm.taxonomy_resolution_review
  where finding_scope = 'source'
    and entity_type = 'licensor'
    and company_code = 'EDGEHOME'
    and division_code = 'CW001'
    and mg_type_code = '05'
    and mg_code = 'P1HIST-' || v_suffix
    and status in ('open', 'quarantined', 'conflict');

  if v_count <> 1 then
    raise exception
      'expected exactly 1 ACTIVE finding for P1HIST after history reopen (got %)',
      v_count;
  end if;

  -- Canonical-only: no fake ColdLion keys
  insert into plm.taxonomy_resolution_review (
    entity_type, finding_scope,
    proposed_property_id, match_method, confidence, reason, evidence,
    status, resolution
  ) values (
    'property', 'canonical_only',
    v_prop_canonical_only, 'inventory', 'high',
    'canonical property has no ColdLion mirror counterpart',
    jsonb_build_object('outcome', 'canonical_only'),
    'open', 'canonical_only'
  );

  -- Fake keys on canonical_only must fail
  begin
    insert into plm.taxonomy_resolution_review (
      entity_type, finding_scope,
      company_code, division_code, mg_type_code, mg_code, source_name,
      proposed_property_id, match_method, confidence, reason, status, resolution
    ) values (
      'property', 'canonical_only',
      'EDGEHOME', 'CW001', '06', 'FAKE', 'fake',
      v_prop_canonical_only, 'bad', 'none', 'must not invent keys', 'open', 'canonical_only'
    );
    raise exception 'canonical_only accepted invented ColdLion source keys';
  exception
    when check_violation then
      null;
    when unique_violation then
      null; -- if unique on proposed_property_id fires first after scope fails...
  end;

  -- ------------------------------------------------------------------
  -- NASA / ZAG / FRIDA lifecycle + parent/status immutability under mirror ops
  -- ------------------------------------------------------------------
  insert into plm.erp_licensor (
    company_code, division_code, mg_type_code, mg_code, mg_type_desc,
    name, licensor_id, resolution_status, resolved_at, resolved_by,
    source_hash, raw
  ) values
  (
    'EDGEHOME', 'CW001', '05', 'NASA', 'Licensor',
    'NASA still present in ColdLion', v_lic_nasa, 'manually_matched',
    now(), 'phase1-test-fixture', 'hash-nasa',
    jsonb_build_object('mgCode', 'NASA', 'warning', 'lapsed')
  ),
  (
    'EDGEHOME', 'CW001', '05', 'ZAG', 'Licensor',
    'ZAG still present in ColdLion', v_lic_zag, 'manually_matched',
    now(), 'phase1-test-fixture', 'hash-zag',
    jsonb_build_object('mgCode', 'ZAG', 'warning', 'lapsed')
  ),
  (
    'EDGEHOME', 'CW001', '05', 'FRIDA', 'Licensor',
    'FRIDA KAHLO still present in ColdLion', v_lic_frida, 'manually_matched',
    now(), 'phase1-test-fixture', 'hash-frida',
    jsonb_build_object('mgCode', 'FRIDA', 'warning', 'lapsed')
  );

  insert into plm.erp_property (
    company_code, division_code, mg_type_code, mg_code, mg_type_desc,
    name, property_id, resolution_status, resolved_at, resolved_by,
    source_hash, raw
  ) values
  (
    'EDGEHOME', 'CW001', '06', 'NASAP', 'Property',
    'NASA property still present', v_prop_nasa, 'manually_matched',
    now(), 'phase1-test-fixture', 'hash-nasap', '{}'::jsonb
  ),
  (
    'EDGEHOME', 'CW001', '06', 'ZAGP', 'Property',
    'ZAG property still present', v_prop_zag, 'manually_matched',
    now(), 'phase1-test-fixture', 'hash-zagp', '{}'::jsonb
  ),
  (
    'EDGEHOME', 'CW001', '06', 'FRIDAP', 'Property',
    'FRIDA property still present', v_prop_frida, 'manually_matched',
    now(), 'phase1-test-fixture', 'hash-fridap', '{}'::jsonb
  );

  update plm.erp_licensor
  set name = name || ' (refreshed)',
      source_hash = source_hash || '-2',
      last_seen_at = now(),
      raw = raw || jsonb_build_object('refreshed', true)
  where mg_code in ('NASA', 'ZAG', 'FRIDA')
    and company_code = 'EDGEHOME' and division_code = 'CW001';

  update plm.erp_property
  set name = name || ' (refreshed)',
      source_hash = source_hash || '-2',
      last_seen_at = now(),
      raw = raw || jsonb_build_object('refreshed', true)
  where mg_code in ('NASAP', 'ZAGP', 'FRIDAP', 'FR')
    and company_code = 'EDGEHOME' and division_code = 'CW001';

  if (select status from core.licensor where id = v_lic_nasa) is distinct from 'inactive'
     or (select status from core.licensor where id = v_lic_zag) is distinct from 'inactive'
     or (select status from core.licensor where id = v_lic_frida) is distinct from 'inactive'
  then
    raise exception 'mirror refresh mutated lapsed licensor status (NASA/ZAG/FRIDA)';
  end if;

  if (select status from core.property where id = v_prop_nasa) is distinct from 'inactive'
     or (select status from core.property where id = v_prop_zag) is distinct from 'inactive'
     or (select status from core.property where id = v_prop_frida) is distinct from 'inactive'
  then
    raise exception 'mirror refresh mutated lapsed property status';
  end if;

  if (select status from core.licensor where id = v_lic_nasa) is distinct from v_lic_status_before then
    raise exception 'NASA licensor status changed from baseline';
  end if;

  if (select licensor_id from core.property where id = v_prop_fr) is distinct from v_parent_before then
    raise exception 'mirror ops mutated core.property.licensor_id';
  end if;

  if (select licensor_id from core.property where id = v_prop_nasa) is distinct from v_lic_nasa
     or (select licensor_id from core.property where id = v_prop_zag) is distinct from v_lic_zag
     or (select licensor_id from core.property where id = v_prop_frida) is distinct from v_lic_frida
  then
    raise exception 'mirror ops mutated parent edges on lapsed properties';
  end if;

  if (select status from core.property where id = v_prop_fr) is distinct from v_status_before then
    raise exception 'mirror ops mutated FR property fixture status';
  end if;

  -- ------------------------------------------------------------------
  -- Browser mutation privileges + no write policies
  -- ------------------------------------------------------------------
  select
    has_table_privilege('authenticated', 'plm.erp_licensor', 'insert'),
    has_table_privilege('authenticated', 'plm.erp_licensor', 'update'),
    has_table_privilege('authenticated', 'plm.erp_licensor', 'delete'),
    has_table_privilege('authenticated', 'plm.erp_licensor', 'truncate'),
    has_table_privilege('authenticated', 'plm.erp_licensor', 'references'),
    has_table_privilege('authenticated', 'plm.erp_licensor', 'trigger')
  into v_has_insert, v_has_update, v_has_delete, v_has_truncate, v_has_references, v_has_trigger;

  if v_has_insert or v_has_update or v_has_delete or v_has_truncate
     or v_has_references or v_has_trigger then
    raise exception
      'authenticated has mutation privilege on plm.erp_licensor (i=% u=% d=% t=% r=% g=%)',
      v_has_insert, v_has_update, v_has_delete, v_has_truncate, v_has_references, v_has_trigger;
  end if;

  select
    has_table_privilege('authenticated', 'plm.erp_property', 'insert'),
    has_table_privilege('authenticated', 'plm.erp_property', 'update'),
    has_table_privilege('authenticated', 'plm.erp_property', 'delete'),
    has_table_privilege('authenticated', 'plm.erp_property', 'truncate'),
    has_table_privilege('authenticated', 'plm.erp_property', 'references'),
    has_table_privilege('authenticated', 'plm.erp_property', 'trigger')
  into v_has_insert, v_has_update, v_has_delete, v_has_truncate, v_has_references, v_has_trigger;

  if v_has_insert or v_has_update or v_has_delete or v_has_truncate
     or v_has_references or v_has_trigger then
    raise exception 'authenticated has mutation privilege on plm.erp_property';
  end if;

  select
    has_table_privilege('authenticated', 'plm.taxonomy_resolution_review', 'insert'),
    has_table_privilege('authenticated', 'plm.taxonomy_resolution_review', 'update'),
    has_table_privilege('authenticated', 'plm.taxonomy_resolution_review', 'delete'),
    has_table_privilege('authenticated', 'plm.taxonomy_resolution_review', 'truncate'),
    has_table_privilege('authenticated', 'plm.taxonomy_resolution_review', 'references'),
    has_table_privilege('authenticated', 'plm.taxonomy_resolution_review', 'trigger')
  into v_has_insert, v_has_update, v_has_delete, v_has_truncate, v_has_references, v_has_trigger;

  if v_has_insert or v_has_update or v_has_delete or v_has_truncate
     or v_has_references or v_has_trigger then
    raise exception 'authenticated has mutation privilege on plm.taxonomy_resolution_review';
  end if;

  select count(*)::integer into v_write_policies
  from pg_policies
  where schemaname = 'plm'
    and tablename in ('erp_licensor', 'erp_property', 'taxonomy_resolution_review')
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  if v_write_policies <> 0 then
    raise exception 'found % authenticated-facing write policies on Phase 1 tables', v_write_policies;
  end if;

  if not has_table_privilege('authenticated', 'plm.erp_licensor', 'select')
     or not has_table_privilege('service_role', 'plm.erp_licensor', 'insert')
  then
    raise exception 'expected select for authenticated and insert for service_role';
  end if;

  -- ------------------------------------------------------------------
  -- Views
  -- ------------------------------------------------------------------
  if to_regclass('api.coldlion_licensor_reconciliation') is null
     or to_regclass('api.coldlion_property_reconciliation') is null
     or to_regclass('api.coldlion_taxonomy_cutover_summary') is null
  then
    raise exception 'missing Phase 1 reconciliation views';
  end if;

  select pg_get_viewdef('api.coldlion_licensor_reconciliation'::regclass, true)
  into v_view_def;
  if v_view_def ~* '\.raw\b' then
    raise exception 'licensor reconciliation view exposes raw';
  end if;

  select pg_get_viewdef('api.coldlion_property_reconciliation'::regclass, true)
  into v_view_def;
  if v_view_def ~* '\.raw\b' then
    raise exception 'property reconciliation view exposes raw';
  end if;

  select count(*)::integer into v_count
  from api.coldlion_property_reconciliation
  where company_code = 'EDGEHOME'
    and division_code = 'CW001'
    and mg_code = 'FR'
    and open_review_status = 'conflict';

  if v_count < 1 then
    raise exception 'property reconciliation did not surface FR conflict review';
  end if;

  select count(*)::integer into v_count
  from api.coldlion_licensor_reconciliation
  where mg_code = 'NASA'
    and matched_status = 'inactive'
    and canonical_not_active is true;

  if v_count < 1 then
    raise exception 'licensor reconciliation did not show NASA inactive';
  end if;

  select count(*)::integer into v_count
  from api.coldlion_property_reconciliation
  where matched_property_id = v_prop_nasa
    and canonical_parent_licensor_id = v_lic_nasa
    and coldlion_lacks_parent_edge is true;

  if v_count <> 1 then
    raise exception 'property reconciliation parent evidence wrong for NASA';
  end if;

  select count(*)::integer into v_count
  from plm.taxonomy_resolution_review
  where finding_scope = 'canonical_only'
    and proposed_property_id = v_prop_canonical_only
    and company_code is null;

  if v_count <> 1 then
    raise exception 'canonical_only finding not stored honestly';
  end if;

  -- No redundant header dictionary
  if to_regclass('plm.erp_merch_group_header') is not null
     or to_regclass('plm.merch_group_header_dictionary') is not null
  then
    raise exception 'redundant header dictionary table created';
  end if;

  raise notice 'Phase 1 revised contracts passed (suffix=%)', v_suffix;
end $$;

rollback;
