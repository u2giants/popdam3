-- Rollback-safe contract tests for
-- 20260731210000_core_licensor_alias.sql
--
-- Run against a disposable DB or preview AFTER the migration is applied.
-- Every fixture rolls back. Do not run as a long-lived production session.
--
-- Proves, in order:
--   A. The ten seeded aliases exist, resolve to the intended canonical Licensor, and
--      carry exactly the provenance they are supposed to: the seven inherited from the
--      worker code array are inherited_unverified, and ONLY the NBC family is approved.
--   B. Normalization matches the frozen popsg-property-observation-v1 behaviour that
--      produced the blast-radius corpus (same function as core.property_alias).
--   C. Conflicting/duplicate aliases are rejected: one normalized string may never
--      resolve to two Licensors, and an alias may not shadow a canonical Licensor.
--   D. Provenance cannot be faked: owner_approved is unrepresentable without approver
--      + timestamp + evidence, even for a direct service_role write.
--   E. Dormant rows are flagged, and dormancy requires evidence.
--   F. The public-schema lockdown did not leave the read path ungranted
--      (AGENTS.md section 10.2 -- the failure mode that looks like success).

begin;

do $$
declare
  v_suffix    text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_lic_a     uuid;
  v_lic_b     uuid;
  v_count     integer;
  v_status    text;
  v_norm      text;
  v_expected  text;
  v_fixture   record;
  v_seed      record;
  v_resolved  uuid;
  v_target    uuid;
  v_acl       text;
  v_id        uuid;
begin
  -- ==========================================================================
  -- A. The ten seeds
  -- ==========================================================================
  -- Eight inherited from the PopDAM worker code array, plus the two NBC name variants
  -- added on Albert's 2026-07-31 ruling. `expected_status` is asserted per row rather
  -- than globally, so this loop pins WHICH rows are approved -- not merely how many.
  select count(*) into v_count from core.licensor_alias;
  if v_count < 10 then
    raise exception 'A0. FAIL - expected at least the 10 seeded aliases, found %', v_count;
  end if;
  raise notice 'A0. PASS - % alias rows present', v_count;

  for v_seed in
    select * from (values
      -- alias,             canonical target,    dormant, expected approval_status
      ('NBC Universal',      'NBC',               false,  'owner_approved'),
      ('NBCU',               'NBC',               true,   'owner_approved'),
      ('NBCUniversal',       'NBC',               true,   'owner_approved'),
      ('Marvel Style Guide', 'Marvel',            false,  'inherited_unverified'),
      ('One Piece',          'TOEI - ONE PIECE',  false,  'inherited_unverified'),
      ('Peanuts',            'Peanuts Worldwide', false,  'inherited_unverified'),
      ('Sesame Workshop',    'Sesame Street',     false,  'inherited_unverified'),
      ('Paramount',          'Viacom Multi',      false,  'inherited_unverified'),
      ('Nickelodeon',        'Viacom Multi',      true,   'inherited_unverified'),
      ('Viacom',             'Viacom Multi',      true,   'inherited_unverified')
    ) as s(alias, target, dormant, expected_status)
  loop
    -- the canonical Licensor the alias is SUPPOSED to point at
    select l.id into v_target
      from core.licensor l
     where core.normalize_popsg_property_observation(l.name)
             = core.normalize_popsg_property_observation(v_seed.target)
        or core.normalize_popsg_property_observation(coalesce(l.code, ''))
             = core.normalize_popsg_property_observation(v_seed.target);

    if v_target is null then
      raise exception 'A1. FAIL - canonical Licensor % does not exist', v_seed.target;
    end if;

    -- the read path must return exactly that
    select public.resolve_licensor_alias(v_seed.alias) into v_resolved;
    if v_resolved is distinct from v_target then
      raise exception 'A1. FAIL - alias % resolved to %, expected % (%)',
        v_seed.alias, v_resolved, v_target, v_seed.target;
    end if;

    -- A2. provenance is EXACTLY what it is supposed to be, row by row. An inherited
    -- mapping must not drift into looking ratified, and an approved one must not
    -- silently lose its ratification.
    select approval_status into v_status
      from core.licensor_alias where alias = v_seed.alias;
    if v_status <> v_seed.expected_status then
      raise exception
        'A2. FAIL - alias % is recorded as %, expected %. Only the NBC family was ruled on.',
        v_seed.alias, v_status, v_seed.expected_status;
    end if;

    -- E1. dormancy flag matches the frozen measurement
    select count(*) into v_count
      from core.licensor_alias
     where alias = v_seed.alias
       and is_dormant = v_seed.dormant
       and (is_dormant = false or dormancy_evidence is not null);
    if v_count <> 1 then
      raise exception 'E1. FAIL - alias % dormancy flag/evidence wrong (expected dormant=%)',
        v_seed.alias, v_seed.dormant;
    end if;
  end loop;
  raise notice 'A1. PASS - all 10 aliases resolve to their intended canonical Licensor';
  raise notice 'A2. PASS - provenance is exact per row: NBC family approved, the rest inherited';
  raise notice 'E1. PASS - dormant rows are flagged with evidence';

  -- A3. NOTHING outside the NBC family claims owner approval. This is the guard against
  -- a later session quietly ratifying Marvel or Paramount on the back of Albert's NBC
  -- ruling, which covered the NBC family and nothing else.
  select count(*) into v_count
    from core.licensor_alias
   where approval_status = 'owner_approved'
     and alias not in ('NBC Universal', 'NBCU', 'NBCUniversal');
  if v_count <> 0 then
    raise exception
      'A3. FAIL - % row(s) outside the NBC family claim owner approval. Albert ruled only on NBC.',
      v_count;
  end if;
  raise notice 'A3. PASS - only the NBC family is owner-approved';

  -- A4. The seven inherited aliases are all still present and all still unverified,
  -- by name. A count alone would not notice a swap.
  select count(*) into v_count
    from core.licensor_alias
   where approval_status = 'inherited_unverified'
     and alias in ('Marvel Style Guide', 'One Piece', 'Peanuts', 'Sesame Workshop',
                   'Paramount', 'Nickelodeon', 'Viacom');
  if v_count <> 7 then
    raise exception
      'A4. FAIL - expected all 7 non-NBC inherited aliases to remain inherited_unverified, found %',
      v_count;
  end if;
  raise notice 'A4. PASS - all 7 non-NBC aliases remain inherited_unverified';

  -- ==========================================================================
  -- B. Normalization matches the frozen corpus behaviour
  -- ==========================================================================
  -- Transcribed from the frozen corpus
  -- docs/verification/popsg-property-reconciliation-20260726/normalization-fixtures-v1.csv.
  -- These are the cases that actually bear on Licensor strings.
  for v_fixture in
    select * from (values
      ('ascii_case',           'NBC UNIVERSAL',      'nbc universal'),
      -- Camel-case splitting fires only on a lower/digit -> UPPER boundary.
      ('camel_case',           'NbcUniversal',       'nbc universal'),
      -- ...so an ALL-CAPS run followed by a capitalised word does NOT split. This is
      -- the frozen contract's real behaviour and a known sharp edge; asserted here so
      -- nobody "fixes" the normalizer and silently re-parents 25,731 files.
      ('caps_run_no_split',    'NBCUniversal',       'nbcuniversal'),
      ('padded',               '  Paramount  ',      'paramount'),
      ('multi_space',          'Viacom   Multi',     'viacom multi'),
      ('ascii_hyphen',         'TOEI - ONE PIECE',   'toei one piece'),
      ('ampersand',            'Sesame & Workshop',  'sesame workshop'),
      ('straight_apostrophe',  'Peanuts'' Worldwide','peanuts worldwide')
    ) as f(label, input, expected)
  loop
    v_norm := core.normalize_popsg_property_observation(v_fixture.input);
    v_expected := v_fixture.expected;
    if v_norm <> v_expected then
      raise exception 'B. FAIL - normalize(%) = %, expected %',
        v_fixture.label, quote_literal(v_norm), quote_literal(v_expected);
    end if;
  end loop;
  raise notice 'B. PASS - normalization matches the frozen corpus behaviour';

  -- B2. The stored normalized_alias column agrees with the function.
  select count(*) into v_count
    from core.licensor_alias
   where normalized_alias <> core.normalize_popsg_property_observation(alias);
  if v_count <> 0 then
    raise exception 'B2. FAIL - % rows have a stale normalized_alias', v_count;
  end if;
  raise notice 'B2. PASS - every stored normalized_alias agrees with the normalizer';

  -- B3. The read path is normalization-insensitive, so worker input spelling
  -- variations still resolve.
  if public.resolve_licensor_alias('  nbc   universal ')
       is distinct from public.resolve_licensor_alias('NBC Universal') then
    raise exception 'B3. FAIL - resolver is not normalization-insensitive';
  end if;
  raise notice 'B3. PASS - resolver matches on the normalized form';

  -- ==========================================================================
  -- C. Conflicting aliases are rejected
  -- ==========================================================================
  insert into core.licensor (name, code) values ('LA TEST LIC A ' || v_suffix, 'LAA' || v_suffix)
    returning id into v_lic_a;
  insert into core.licensor (name, code) values ('LA TEST LIC B ' || v_suffix, 'LAB' || v_suffix)
    returning id into v_lic_b;

  -- C1. The SAME normalized string may not resolve to a second Licensor. This is the
  -- one rule that keeps 25,731 files from being re-routed by a careless insert.
  begin
    insert into core.licensor_alias (licensor_id, alias)
      values (v_lic_a, 'NBC  Universal');
    raise exception 'C1. FAIL - a conflicting alias for a different Licensor was accepted';
  exception
    when unique_violation then
      raise notice 'C1. PASS - a second Licensor cannot claim an existing normalized alias';
  end;

  -- C2. Exact duplicate, same Licensor, also rejected.
  begin
    insert into core.licensor_alias (licensor_id, alias, source_system)
      values ((select licensor_id from core.licensor_alias where alias = 'Paramount'),
              'Paramount', 'manual');
    raise exception 'C2. FAIL - duplicate alias accepted';
  exception
    when unique_violation then
      raise notice 'C2. PASS - duplicate alias refused';
  end;

  -- C3. An alias that IS a canonical Licensor name shadows a real record.
  begin
    insert into core.licensor_alias (licensor_id, alias)
      values (v_lic_a, 'LA TEST LIC B ' || v_suffix);
    raise exception 'C3. FAIL - an alias shadowing another canonical Licensor was accepted';
  exception
    when check_violation then
      raise notice 'C3. PASS - alias shadowing a canonical Licensor refused';
  end;

  -- C4. An alias equal to its OWN target's name is redundant.
  begin
    insert into core.licensor_alias (licensor_id, alias)
      values (v_lic_a, 'LA TEST LIC A ' || v_suffix);
    raise exception 'C4. FAIL - redundant alias accepted';
  exception
    when check_violation then
      raise notice 'C4. PASS - alias equal to its own canonical name refused as redundant';
  end;

  -- C5. Blank and punctuation-only aliases.
  begin
    insert into core.licensor_alias (licensor_id, alias) values (v_lic_a, '   ');
    raise exception 'C5. FAIL - blank alias accepted';
  exception
    when check_violation then raise notice 'C5. PASS - blank alias refused';
  end;

  begin
    insert into core.licensor_alias (licensor_id, alias) values (v_lic_a, '---');
    raise exception 'C6. FAIL - punctuation-only alias accepted';
  exception
    when check_violation then raise notice 'C6. PASS - punctuation-only alias refused';
  end;

  -- A legitimate alias for a brand-new Licensor still works.
  insert into core.licensor_alias (licensor_id, alias, source_system)
    values (v_lic_a, 'LA TEST ALIAS ' || v_suffix, 'manual')
    returning id into v_id;
  raise notice 'C7. PASS - a non-conflicting alias is still insertable';

  -- ==========================================================================
  -- D. Provenance cannot be faked
  -- ==========================================================================
  -- D1. owner_approved with no approver/evidence -- refused by the TABLE, so a
  -- direct service_role write cannot bypass the RPC.
  begin
    insert into core.licensor_alias (licensor_id, alias, approval_status)
      values (v_lic_b, 'LA FAKE APPROVED ' || v_suffix, 'owner_approved');
    raise exception 'D1. FAIL - owner_approved accepted with no approver or evidence';
  exception
    when check_violation then
      raise notice 'D1. PASS - owner approval requires approver + timestamp + evidence';
  end;

  -- D2. approver but no evidence -- still refused.
  begin
    insert into core.licensor_alias (licensor_id, alias, approval_status, approved_by, approved_at)
      values (v_lic_b, 'LA FAKE APPROVED2 ' || v_suffix, 'owner_approved', 'Albert', now());
    raise exception 'D2. FAIL - owner_approved accepted without evidence';
  exception
    when check_violation then
      raise notice 'D2. PASS - approval evidence reference is mandatory';
  end;

  -- D3. An unverified row may not carry approval fields that make it look approved.
  begin
    insert into core.licensor_alias (licensor_id, alias, approved_by)
      values (v_lic_b, 'LA MISLEADING ' || v_suffix, 'Albert');
    raise exception 'D3. FAIL - unverified row accepted an approver name';
  exception
    when check_violation then
      raise notice 'D3. PASS - an unverified row cannot carry approval fields';
  end;

  -- D4. Unknown approval_status values are refused.
  begin
    insert into core.licensor_alias (licensor_id, alias, approval_status)
      values (v_lic_b, 'LA BADSTATUS ' || v_suffix, 'probably_fine');
    raise exception 'D4. FAIL - arbitrary approval_status accepted';
  exception
    when check_violation then raise notice 'D4. PASS - approval_status is constrained';
  end;

  -- D5. The RPC refuses to approve anonymously.
  begin
    perform public.approve_licensor_alias('Paramount', '', 'some memo');
    raise exception 'D5. FAIL - approval accepted with an empty approver';
  exception
    when null_value_not_allowed then
      raise notice 'D5. PASS - approve_licensor_alias demands an approver and evidence';
  end;

  -- D6. The RPC DOES work when given both, and leaves an audit trail.
  perform public.approve_licensor_alias(
    'LA TEST ALIAS ' || v_suffix, 'CONTRACT TEST', 'supabase/tests/core_licensor_alias_contracts.sql');
  select approval_status into v_status from core.licensor_alias where id = v_id;
  if v_status <> 'owner_approved' then
    raise exception 'D6. FAIL - approval RPC did not promote the row (status %)', v_status;
  end if;
  select count(*) into v_count
    from core.licensor_alias
   where id = v_id and approved_by = 'CONTRACT TEST'
     and approved_at is not null and approval_evidence is not null;
  if v_count <> 1 then
    raise exception 'D6. FAIL - approval did not record a complete audit trail';
  end if;
  raise notice 'D6. PASS - approval RPC promotes with a full audit trail';

  -- ==========================================================================
  -- E2. Dormancy requires evidence
  -- ==========================================================================
  begin
    insert into core.licensor_alias (licensor_id, alias, is_dormant)
      values (v_lic_b, 'LA DORMANT NOEV ' || v_suffix, true);
    raise exception 'E2. FAIL - dormant flag accepted with no evidence';
  exception
    when check_violation then
      raise notice 'E2. PASS - claiming dormancy requires a measurement reference';
  end;

  -- ==========================================================================
  -- F. Grants survived the public-schema lockdown event trigger
  -- ==========================================================================
  for v_fixture in
    select * from (values
      ('public.resolve_licensor_alias(text)'),
      ('public.list_licensor_aliases()'),
      ('public.approve_licensor_alias(text,text,text)')
    ) as f(sig)
  loop
    v_acl := coalesce(
      (select array_to_string(p.proacl, ',') from pg_proc p
        where p.oid = v_fixture.sig::regprocedure), '');

    if position('authenticated=X' in v_acl) = 0 then
      raise exception 'F. FAIL - % is not executable by authenticated (auth_exec=f). ACL: %',
        v_fixture.sig, v_acl;
    end if;
    if position('service_role=X' in v_acl) = 0 then
      raise exception 'F. FAIL - % is not executable by service_role (svc_exec=f). ACL: %',
        v_fixture.sig, v_acl;
    end if;
    if position('anon=X' in v_acl) > 0 then
      raise exception 'F. FAIL - % is executable by anon (anon_exec=t). ACL: %',
        v_fixture.sig, v_acl;
    end if;
    -- PUBLIC shows as a leading bare "=X/" entry in an aclitem list.
    if v_acl ~ '(^|,)=[a-zA-Z]*X' then
      raise exception 'F. FAIL - % is executable by PUBLIC. ACL: %', v_fixture.sig, v_acl;
    end if;
  end loop;
  raise notice 'F1. PASS - all three public functions: auth_exec=t, svc_exec=t, anon_exec=f, PUBLIC=f';

  -- F2. And the actual privilege check agrees (not just the ACL string).
  if not has_function_privilege('authenticated', 'public.resolve_licensor_alias(text)', 'execute') then
    raise exception 'F2. FAIL - authenticated cannot execute resolve_licensor_alias';
  end if;
  if not has_function_privilege('service_role', 'public.resolve_licensor_alias(text)', 'execute') then
    raise exception 'F2. FAIL - service_role cannot execute resolve_licensor_alias';
  end if;
  if has_function_privilege('anon', 'public.resolve_licensor_alias(text)', 'execute') then
    raise exception 'F2. FAIL - anon CAN execute resolve_licensor_alias';
  end if;
  raise notice 'F2. PASS - the intended callers can actually invoke the read path';

  -- F3. Table grants: authenticated may read, not write; anon has nothing.
  if not has_table_privilege('authenticated', 'core.licensor_alias', 'select') then
    raise exception 'F3. FAIL - authenticated cannot select core.licensor_alias';
  end if;
  if has_table_privilege('authenticated', 'core.licensor_alias', 'insert')
     or has_table_privilege('authenticated', 'core.licensor_alias', 'update')
     or has_table_privilege('authenticated', 'core.licensor_alias', 'delete') then
    raise exception 'F3. FAIL - authenticated has write privileges on core.licensor_alias';
  end if;
  if has_table_privilege('anon', 'core.licensor_alias', 'select') then
    raise exception 'F3. FAIL - anon can select core.licensor_alias';
  end if;
  if not has_table_privilege('service_role', 'core.licensor_alias', 'select') then
    raise exception 'F3. FAIL - service_role cannot select core.licensor_alias';
  end if;
  raise notice 'F3. PASS - table grants are least-privilege (auth read-only, anon none)';

  -- F4. RLS is on and there is no write policy for authenticated.
  select count(*) into v_count
    from pg_policies
   where schemaname = 'core' and tablename = 'licensor_alias' and cmd <> 'SELECT';
  if v_count <> 0 then
    raise exception 'F4. FAIL - % non-SELECT policy/policies exist on core.licensor_alias', v_count;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'core.licensor_alias'::regclass) then
    raise exception 'F4. FAIL - RLS is not enabled on core.licensor_alias';
  end if;
  raise notice 'F4. PASS - RLS enabled, SELECT-only policy set';

  -- ==========================================================================
  -- G. The NBC family -- Albert's owner ruling of 2026-07-31
  -- ==========================================================================
  --     "NBC Universal really means NBC, really means NBCU, really means NBCUniversal"
  --
  -- Four strings, ONE canonical Licensor. This section exists because the four do NOT
  -- share a normalized form -- if anyone ever assumes they do, these tests fail.

  -- G1. THE NORMALIZED FORMS ARE PINNED. This is the load-bearing fixture. The camel-
  -- case rule splits only on a lower/digit -> UPPER boundary, so an ALL-CAPS run
  -- followed by a capitalised word does NOT split: 'NBCUniversal' stays one token. If a
  -- later session "fixes" the normalizer to split NBCUniversal into 'nbc universal',
  -- these four rows would collapse onto one normalized key, the global unique index on
  -- normalized_alias would start rejecting them, and 25,731 files' worth of routing
  -- would change meaning. Pinning the exact strings makes that impossible to do quietly.
  for v_fixture in
    select * from (values
      ('nbc_spaced',       'NBC Universal', 'nbc universal'),
      ('nbc_bare',         'NBC',           'nbc'),
      ('nbc_initialism',   'NBCU',          'nbcu'),
      ('nbc_capsrun',      'NBCUniversal',  'nbcuniversal')
    ) as f(label, input, expected)
  loop
    v_norm := core.normalize_popsg_property_observation(v_fixture.input);
    if v_norm <> v_fixture.expected then
      raise exception
        'G1. FAIL - normalize(%) = %, expected %. The four NBC strings have four DISTINCT '
        'normalized forms; do not let them merge.',
        quote_literal(v_fixture.input), quote_literal(v_norm), quote_literal(v_fixture.expected);
    end if;
  end loop;

  -- G1b. ...and they really are four distinct keys, stated as its own assertion so the
  -- reason for G1 cannot be lost if someone edits the fixture table.
  if (select count(distinct core.normalize_popsg_property_observation(s))
        from unnest(array['NBC Universal','NBC','NBCU','NBCUniversal']) as s) <> 4 then
    raise exception 'G1b. FAIL - the four NBC strings no longer normalize to four distinct keys';
  end if;
  raise notice 'G1. PASS - the four NBC normalized forms are pinned and distinct';

  -- G2. ALL FOUR STRINGS REACH THE SAME CANONICAL LICENSOR.
  -- Resolution mirrors the PopDAM worker and the frozen inventory script
  -- (scripts/popsg-property-psg1-inventory.cjs lines 261-263): try a DIRECT canonical
  -- name/code match first, and fall back to the alias table only if that misses. That
  -- order is why 'NBC' has no alias row and must not have one -- it hits the canonical
  -- record directly, and the section-2 redundancy trigger refuses aliases that duplicate
  -- their own target's name (asserted in G4).
  select l.id into v_target from core.licensor l where l.name = 'NBC';
  if v_target is null then
    raise exception 'G2. FAIL - canonical Licensor NBC does not exist';
  end if;

  foreach v_norm in array array['NBC Universal', 'NBC', 'NBCU', 'NBCUniversal']
  loop
    select l.id into v_resolved
      from core.licensor l
     where core.normalize_popsg_property_observation(l.name)
             = core.normalize_popsg_property_observation(v_norm)
        or core.normalize_popsg_property_observation(coalesce(l.code, ''))
             = core.normalize_popsg_property_observation(v_norm);

    if v_resolved is null then
      v_resolved := public.resolve_licensor_alias(v_norm);
    end if;

    if v_resolved is distinct from v_target then
      raise exception
        'G2. FAIL - NBC-family string % resolved to %, expected the canonical NBC (%). '
        'Albert ruled that all four denote the one Licensor NBC.',
        quote_literal(v_norm), v_resolved, v_target;
    end if;
  end loop;
  raise notice 'G2. PASS - all four NBC strings resolve to the one canonical Licensor NBC';

  -- G3. The three NBC ALIAS rows are owner_approved with ALL THREE approval fields
  -- populated, attributed to Albert, dated to the ruling, and carrying his words
  -- verbatim. An approval with a missing or vague evidence note is not an approval.
  select count(*) into v_count
    from core.licensor_alias
   where alias in ('NBC Universal', 'NBCU', 'NBCUniversal')
     and approval_status = 'owner_approved'
     and approved_by = 'Albert Hazan'
     and approved_at is not null
     -- Asserted in EXPLICIT UTC, and separately in the server's own local timezone.
     -- A bare `approved_at::date` is timezone-dependent: this database runs
     -- America/New_York, so a ruling stored at midnight UTC would read back as
     -- 2026-07-30 and the audit trail would name the wrong day. Both assertions must
     -- hold, which is what forces the stored value away from a midnight boundary.
     and (approved_at at time zone 'UTC')::date = date '2026-07-31'
     and approved_at::date = date '2026-07-31'
     and approval_evidence like
         '%NBC Universal really means NBC, really means NBCU, really means NBCUniversal%'
     and approval_evidence like '%2026-07-31%';
  if v_count <> 3 then
    raise exception
      'G3. FAIL - expected 3 NBC alias rows owner_approved by Albert Hazan, dated 2026-07-31, '
      'quoting the ruling verbatim; found %', v_count;
  end if;
  raise notice 'G3. PASS - the NBC family is owner_approved with approver, date and verbatim evidence';

  -- G4. 'NBC' must NOT be an alias row, and must be refused if anyone tries -- it is the
  -- canonical name itself. This pins the reason the ruling's four strings map to only
  -- three rows, so nobody "fixes" the apparent off-by-one by inserting it.
  if exists (select 1 from core.licensor_alias where alias = 'NBC') then
    raise exception
      'G4. FAIL - NBC is stored as an alias. It is the canonical Licensor name and resolves directly.';
  end if;
  begin
    insert into core.licensor_alias (licensor_id, alias) values (v_target, 'NBC');
    raise exception 'G4. FAIL - an alias equal to the canonical name NBC was accepted';
  exception
    when check_violation then
      raise notice 'G4. PASS - NBC has no alias row and is refused as redundant';
  end;

  -- G5. The two new variants carry owner_ruling provenance, not worker-code provenance,
  -- and are flagged dormant on the frozen measurement (zero PSG-1 observations).
  select count(*) into v_count
    from core.licensor_alias
   where alias in ('NBCU', 'NBCUniversal')
     and source_system = 'owner_ruling'
     and is_dormant
     and dormancy_evidence is not null
     and evidence_notes like '%2026-07-31%';
  if v_count <> 2 then
    raise exception
      'G5. FAIL - the two new NBC variants must be source_system=owner_ruling and dormant '
      'with evidence; found % matching', v_count;
  end if;
  raise notice 'G5. PASS - NBCU/NBCUniversal are owner_ruling provenance, dormant with evidence';

  -- G6. The read path actually returns NBC for the two variants that matched NOTHING
  -- before this migration. This is the behaviour change the ruling bought.
  if public.resolve_licensor_alias('NBCU') is distinct from v_target then
    raise exception 'G6. FAIL - resolve_licensor_alias(''NBCU'') does not return canonical NBC';
  end if;
  if public.resolve_licensor_alias('NBCUniversal') is distinct from v_target then
    raise exception 'G6. FAIL - resolve_licensor_alias(''NBCUniversal'') does not return canonical NBC';
  end if;
  raise notice 'G6. PASS - NBCU and NBCUniversal now resolve through the alias table';

  raise notice '';
  raise notice 'ALL core.licensor_alias CONTRACT TESTS PASSED';
end;
$$;

rollback;
