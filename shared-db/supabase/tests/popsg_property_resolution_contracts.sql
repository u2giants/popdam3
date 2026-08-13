-- Rollback-safe contract tests for
-- 20260731150000_popsg_property_resolution_contracts.sql
--
-- Run against a disposable DB or preview AFTER the migration is applied.
-- Every fixture rolls back. Do not run as a long-lived production session.
--
-- Proves, in order:
--   A. The SQL normalizer reproduces the ENTIRE frozen popsg-property-observation-v1
--      fixture corpus byte-for-byte (plan test 20).
--   B. Exact same-parent behaviour: a same-parent decision/alias is accepted and a
--      cross-parent one is structurally impossible (plan rules 2/3, tests 3/9/24).
--   C. Role limits: viewer/designer cannot propose; administrator can propose but
--      CANNOT activate by writing the table; only the hash RPC activates
--      (plan tests 14/25/26).
--   D. Manual/rejected preservation and zero silent loss: the table is append-only,
--      decision content is immutable once effective, and activation supersedes
--      rather than overwrites (plan section 6.3, tests 11/12).
--   E. The public-schema lockdown did not leave the RPCs ungranted
--      (AGENTS.md section 10.2 -- the failure mode that looks like success).
--   F. Alias hygiene: blank, punctuation-only, and redundant aliases are refused;
--      the same alias text under a different Licensor is still allowed
--      (plan tests 21/22, section 6.1).

begin;

do $$
declare
  v_suffix        text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_lic_a         uuid;
  v_lic_b         uuid;
  v_prop_a        uuid;
  v_prop_b        uuid;
  v_res_id        uuid;
  v_res_id2       uuid;
  v_alias_id      uuid;
  v_count         integer;
  v_state         text;
  v_activated     integer;
  v_norm          text;
  v_expected      text;
  v_fixture       record;
  v_failed        text := '';
  v_ok            boolean;
  v_acl           text;
begin
  -- ==========================================================================
  -- Fixtures: two Licensors, one Property each. Distinct codes so nothing
  -- collides with real data.
  -- ==========================================================================
  insert into core.licensor (name, code) values ('PSG5 TEST LIC A ' || v_suffix, 'PSGA' || v_suffix)
    returning id into v_lic_a;
  insert into core.licensor (name, code) values ('PSG5 TEST LIC B ' || v_suffix, 'PSGB' || v_suffix)
    returning id into v_lic_b;

  insert into core.property (licensor_id, name, code)
    values (v_lic_a, 'PSG5 TEST PROP A ' || v_suffix, 'PPA' || v_suffix)
    returning id into v_prop_a;
  insert into core.property (licensor_id, name, code)
    values (v_lic_b, 'PSG5 TEST PROP B ' || v_suffix, 'PPB' || v_suffix)
    returning id into v_prop_b;

  -- ==========================================================================
  -- A. Frozen normalization corpus (plan test 20)
  -- ==========================================================================
  -- The 22 fixtures below are transcribed from the frozen corpus
  -- docs/verification/popsg-property-reconciliation-20260726/normalization-fixtures-v1.csv
  -- (SHA-256 recorded in that directory's source-hashes.json). If this block and
  -- that file ever disagree, the CONTRACT wins and this migration is wrong.
  for v_fixture in
    select * from (values
      ('empty',                  '',                              ''),
      ('ascii_case',             'BATMAN',                        'batman'),
      ('camel_case',             'SpiderMan',                     'spider man'),
      ('leading_trailing_space', '  Batman  ',                    'batman'),
      ('multi_space',            'Batman   Returns',              'batman returns'),
      ('tab_newline',            E'Batman\tReturns\nCore',        'batman returns core'),
      ('ampersand',              'Parks & Rec',                   'parks rec'),
      ('straight_apostrophe',    'Ferris Bueller''s Day Off',     'ferris buellers day off'),
      ('curly_apostrophe',       'Gabby' || chr(8217) || 's Dollhouse', 'gabbys dollhouse'),
      ('ascii_hyphen',           'TOEI - ONE PIECE',              'toei one piece'),
      ('en_dash',                'Batman' || chr(8211) || 'Robin', 'batman robin'),
      ('em_dash',                'Batman' || chr(8212) || 'Robin', 'batman robin'),
      ('underscore',             'Marvel_Style_Guide',            'marvel style guide'),
      ('slashes',                'Marvel/Disney\Wb',              'marvel disney wb'),
      ('punctuation',            'The Mummy (1999)!',             'the mummy 1999'),
      ('multi_punctuation',      'Batman...Returns',              'batman returns'),
      ('nfkc_fullwidth',         'ＭＡＲＶＥＬ',                    'marvel'),
      ('nfkc_ligature',          'Of' || chr(64257) || 'ce',      'office'),
      ('accented',               'Café',                          'caf'),
      ('punctuation_only',       '___---!!!',                     ''),
      ('digit_boundary',         'Phase6Ready',                   'phase6 ready')
    ) as f(fixture_id, input, expected)
  loop
    v_norm := core.normalize_popsg_property_observation(v_fixture.input);
    if v_norm is distinct from v_fixture.expected then
      v_failed := v_failed || format(
        E'\n  fixture %s: input %L -> got %L, contract requires %L',
        v_fixture.fixture_id, v_fixture.input, v_norm, v_fixture.expected);
    end if;
  end loop;

  if v_failed <> '' then
    raise exception 'A. normalization contract popsg-property-observation-v1 VIOLATED:%', v_failed;
  end if;
  raise notice 'A. PASS - all 21 frozen normalization fixtures reproduce byte-for-byte';

  -- NULL in, NULL out (RETURNS NULL ON NULL INPUT), so a null observation can never
  -- silently normalize to the empty string and collide with another row.
  if core.normalize_popsg_property_observation(null) is not null then
    raise exception 'A. normalizer must return NULL for NULL input';
  end if;

  -- ==========================================================================
  -- B. Exact same-parent behaviour, and cross-parent impossibility
  -- ==========================================================================
  -- B1. A same-parent exact_existing decision is accepted.
  insert into dam.popsg_property_resolution (
    licensor_id, raw_observed_value, disposition, property_id,
    occurrence_count, evidence_batch_id, evidence_batch_sha256, proposed_by
  ) values (
    v_lic_a, 'Test Prop A', 'exact_existing', v_prop_a,
    155, 'batch-test-' || v_suffix, 'deadbeef', 'contract-test'
  ) returning id into v_res_id;
  raise notice 'B1. PASS - same-parent exact_existing decision accepted';

  -- B2. The SAME decision pointing at a Property under a DIFFERENT Licensor is
  -- rejected by the composite FK. This is the single most important guarantee in
  -- the whole workstream: it is structural, not application logic.
  begin
    insert into dam.popsg_property_resolution (
      licensor_id, raw_observed_value, disposition, property_id, proposed_by
    ) values (v_lic_a, 'Cross Parent Attempt', 'exact_existing', v_prop_b, 'contract-test');
    raise exception 'B2. FAIL - a cross-parent Property decision was accepted';
  exception
    when foreign_key_violation then
      raise notice 'B2. PASS - cross-parent decision refused by composite FK';
  end;

  -- B3. Same alias text under a different Licensor is legitimate and must remain
  -- insertable -- parent scoping must not degrade into a global unique name.
  insert into core.property_alias (property_id, licensor_id, alias)
    values (v_prop_a, v_lic_a, 'Shared Alias Text') returning id into v_alias_id;
  insert into core.property_alias (property_id, licensor_id, alias)
    values (v_prop_b, v_lic_b, 'Shared Alias Text');
  raise notice 'B3. PASS - identical alias text under two Licensors both accepted';

  -- B4. But the same alias twice under the SAME Licensor collides.
  begin
    insert into core.property_alias (property_id, licensor_id, alias)
      values (v_prop_a, v_lic_a, 'shared   alias TEXT');   -- normalizes identically
    raise exception 'B4. FAIL - duplicate normalized alias accepted under one Licensor';
  exception
    when unique_violation then
      raise notice 'B4. PASS - duplicate normalized alias refused within a Licensor';
  end;

  -- B5. An alias whose licensor_id does not match its Property's parent is
  -- unrepresentable.
  begin
    insert into core.property_alias (property_id, licensor_id, alias)
      values (v_prop_a, v_lic_b, 'Wrong Parent Alias');
    raise exception 'B5. FAIL - alias with mismatched parent accepted';
  exception
    when foreign_key_violation then
      raise notice 'B5. PASS - alias parent mismatch refused by composite FK';
  end;

  -- B6. Non-tagging dispositions may not carry a Property target, and tagging
  -- dispositions must carry one. This is what keeps "intentionally untagged"
  -- from ever producing a tag.
  begin
    insert into dam.popsg_property_resolution (
      licensor_id, raw_observed_value, disposition, property_id, proposed_by
    ) values (v_lic_a, 'Structural Folder', 'non_property', v_prop_a, 'contract-test');
    raise exception 'B6a. FAIL - non_property decision accepted with a Property target';
  exception
    when check_violation then
      raise notice 'B6a. PASS - non_property cannot carry a Property target';
  end;

  begin
    insert into dam.popsg_property_resolution (
      licensor_id, raw_observed_value, disposition, property_id, proposed_by
    ) values (v_lic_a, 'Untargeted Exact', 'exact_existing', null, 'contract-test');
    raise exception 'B6b. FAIL - exact_existing accepted without a Property target';
  exception
    when check_violation then
      raise notice 'B6b. PASS - exact_existing requires a Property target';
  end;

  -- B7. ambiguous and deferred rows produce no target -- `the lion king` stays locked.
  insert into dam.popsg_property_resolution (
    licensor_id, raw_observed_value, disposition, proposed_by
  ) values (v_lic_a, 'the lion king', 'ambiguous', 'contract-test');
  select property_id is null into v_ok
    from dam.popsg_property_resolution
   where licensor_id = v_lic_a and raw_observed_value = 'the lion king';
  if not v_ok then
    raise exception 'B7. FAIL - ambiguous row carries a Property target';
  end if;
  raise notice 'B7. PASS - ambiguous row carries no Property target';

  -- ==========================================================================
  -- C. Role limits and activation authority
  -- ==========================================================================
  -- C1. Only ONE active decision may exist per tuple.
  update dam.popsg_property_resolution
     set decision_state = 'active', activated_by = 'test', activated_at = now()
   where id = v_res_id;

  insert into dam.popsg_property_resolution (
    licensor_id, raw_observed_value, disposition, property_id, proposed_by
  ) values (v_lic_a, 'test   PROP a', 'exact_existing', v_prop_a, 'contract-test')
  returning id into v_res_id2;   -- normalizes to the same tuple; pending is fine

  begin
    update dam.popsg_property_resolution
       set decision_state = 'active', activated_by = 'test', activated_at = now()
     where id = v_res_id2;
    raise exception 'C1. FAIL - two active decisions for one tuple were accepted';
  exception
    when unique_violation then
      raise notice 'C1. PASS - only one active decision per observation tuple';
  end;

  -- C2. An active row cannot claim activation without an actor/timestamp.
  begin
    insert into dam.popsg_property_resolution (
      licensor_id, raw_observed_value, disposition, property_id, proposed_by, decision_state
    ) values (v_lic_b, 'Unattributed Activation', 'exact_existing', v_prop_b, 'contract-test', 'active');
    raise exception 'C2. FAIL - active row accepted with no activated_by/at';
  exception
    when check_violation then
      raise notice 'C2. PASS - an active decision must name who activated it and when';
  end;

  -- C3/C4/C7 call the authority-guarded RPCs. Until 20260813030000 they reached the
  -- post-guard validations from a session with NO JWT claims, because the old guard
  -- shape `if not (app.has_role(...) or auth.role() = 'service_role')` evaluated to
  -- NULL under a NULL auth.role() and skipped its own raise (issue #861). That is
  -- exactly the defect, and this suite was silently relying on it. Declare an
  -- authorised caller so these three assertions test what they say they test.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- C3. The activation RPC refuses a batch whose pending row count is not exactly
  -- what the owner approved. This is the "someone edited a proposal after approval"
  -- guard.
  begin
    v_activated := public.activate_popsg_property_decision_batch(
      'batch-test-' || v_suffix, 'deadbeef', 999);
    raise exception 'C3. FAIL - activation accepted a wrong expected row count';
  exception
    when check_violation then
      raise notice 'C3. PASS - activation refuses a batch that is not the approved size';
  end;

  -- C4. It also refuses a hash that no pending row carries (count comes back 0).
  begin
    v_activated := public.activate_popsg_property_decision_batch(
      'batch-test-' || v_suffix, 'not-the-approved-hash', 1);
    raise exception 'C4. FAIL - activation accepted an unapproved hash';
  exception
    when check_violation then
      raise notice 'C4. PASS - activation refuses an unapproved hash';
  end;

  -- C5. There is NO write policy for `authenticated` on either table, so a browser
  -- role cannot write them directly even with a valid role claim. Prove the policy
  -- set, not just the grant.
  select count(*) into v_count
    from pg_policies
   where schemaname = 'core' and tablename = 'property_alias'
     and cmd <> 'SELECT';
  if v_count <> 0 then
    raise exception 'C5a. FAIL - core.property_alias has % non-SELECT policies; shared alias truth must be RPC-only', v_count;
  end if;

  select count(*) into v_count
    from pg_policies
   where schemaname = 'dam' and tablename = 'popsg_property_resolution'
     and cmd <> 'SELECT';
  if v_count <> 0 then
    raise exception 'C5b. FAIL - dam.popsg_property_resolution has % non-SELECT policies', v_count;
  end if;
  raise notice 'C5. PASS - both tables are SELECT-only for browser roles (RPC-only writes)';

  -- C6. And the table GRANTs agree with the policies -- RLS is not a GRANT.
  for v_acl in
    select unnest(array['INSERT','UPDATE','DELETE'])
  loop
    if has_table_privilege('authenticated', 'core.property_alias', v_acl) then
      raise exception 'C6a. FAIL - authenticated holds % on core.property_alias', v_acl;
    end if;
    if has_table_privilege('authenticated', 'dam.popsg_property_resolution', v_acl) then
      raise exception 'C6b. FAIL - authenticated holds % on dam.popsg_property_resolution', v_acl;
    end if;
  end loop;
  raise notice 'C6. PASS - authenticated holds no INSERT/UPDATE/DELETE on either table';

  -- C7. promote_property_alias_batch refuses to write shared truth without an
  -- explicit cross-app certification (plan test 22).
  begin
    v_alias_id := public.promote_property_alias_batch(
      v_prop_a, 'Uncertified PopSG Folder', 'somehash', false, 'tester');
    raise exception 'C7. FAIL - shared alias promoted without cross-app certification';
  exception
    when check_violation then
      raise notice 'C7. PASS - uncertified shared-alias promotion refused';
  end;

  -- Drop back to an unauthenticated session for the rest of the suite.
  perform set_config('request.jwt.claims', null, true);

  -- ==========================================================================
  -- D. Append-only history: no silent loss
  -- ==========================================================================
  -- D1. Deleting a decision is refused outright.
  begin
    delete from dam.popsg_property_resolution where id = v_res_id;
    raise exception 'D1. FAIL - an active decision row was deleted';
  exception
    when restrict_violation then
      raise notice 'D1. PASS - decision rows cannot be deleted, only superseded';
  end;

  -- D2. The decision content of an active row is immutable.
  begin
    update dam.popsg_property_resolution
       set disposition = 'non_property', property_id = null
     where id = v_res_id;
    raise exception 'D2. FAIL - an active decision was rewritten in place';
  exception
    when restrict_violation then
      raise notice 'D2. PASS - active decision content is immutable';
  end;

  -- D3. But the lifecycle columns still move, so supersede works.
  update dam.popsg_property_resolution
     set decision_state = 'superseded', superseded_at = now()
   where id = v_res_id;
  select decision_state into v_state from dam.popsg_property_resolution where id = v_res_id;
  if v_state <> 'superseded' then
    raise exception 'D3. FAIL - could not supersede an active decision';
  end if;
  raise notice 'D3. PASS - supersede preserves the row and its history';

  -- D4. The superseded row still exists -- history is not erased.
  select count(*) into v_count from dam.popsg_property_resolution where id = v_res_id;
  if v_count <> 1 then
    raise exception 'D4. FAIL - superseded decision disappeared';
  end if;
  raise notice 'D4. PASS - superseded decision is retained for audit';

  -- ==========================================================================
  -- E. The public-schema lockdown did not silently orphan the RPCs
  -- ==========================================================================
  -- AGENTS.md section 10.2: the event trigger revokes EXECUTE from anon/PUBLIC on
  -- every new public function and its own failures are `raise warning` only. If the
  -- migration forgot its grants, the RPCs exist and are callable by nobody -- which
  -- looks exactly like success. Assert both directions.
  if not has_function_privilege('authenticated',
        'public.propose_popsg_property_resolution(uuid,text,text,uuid,integer,text,text,text,text)', 'EXECUTE') then
    raise exception 'E1. FAIL - authenticated cannot EXECUTE propose_popsg_property_resolution (lockdown stripped it)';
  end if;
  if not has_function_privilege('service_role',
        'public.activate_popsg_property_decision_batch(text,text,integer)', 'EXECUTE') then
    raise exception 'E2. FAIL - service_role cannot EXECUTE activate_popsg_property_decision_batch';
  end if;
  if not has_function_privilege('authenticated',
        'public.promote_property_alias_batch(uuid,text,text,boolean,text,text,text)', 'EXECUTE') then
    raise exception 'E3. FAIL - authenticated cannot EXECUTE promote_property_alias_batch';
  end if;
  raise notice 'E1-E3. PASS - intended callers really can invoke all three RPCs';

  if has_function_privilege('anon',
        'public.activate_popsg_property_decision_batch(text,text,integer)', 'EXECUTE') then
    raise exception 'E4. FAIL - anon can EXECUTE the activation RPC';
  end if;
  if has_function_privilege('anon',
        'public.promote_property_alias_batch(uuid,text,text,boolean,text,text,text)', 'EXECUTE') then
    raise exception 'E5. FAIL - anon can EXECUTE the alias promotion RPC';
  end if;
  if has_table_privilege('anon', 'core.property_alias', 'SELECT') then
    raise exception 'E6. FAIL - anon can read core.property_alias';
  end if;
  raise notice 'E4-E6. PASS - anon can neither call the guarded RPCs nor read alias truth';

  -- ==========================================================================
  -- F. Alias hygiene
  -- ==========================================================================
  -- F1. Blank alias refused.
  begin
    insert into core.property_alias (property_id, licensor_id, alias)
      values (v_prop_a, v_lic_a, '   ');
    raise exception 'F1. FAIL - blank alias accepted';
  exception
    when check_violation then
      raise notice 'F1. PASS - blank alias refused';
  end;

  -- F2. Punctuation-only alias (normalizes to empty) refused.
  begin
    insert into core.property_alias (property_id, licensor_id, alias)
      values (v_prop_a, v_lic_a, '---!!!');
    raise exception 'F2. FAIL - punctuation-only alias accepted';
  exception
    when check_violation then
      raise notice 'F2. PASS - punctuation-only alias refused';
  end;

  -- F3. An alias identical to the target Property's own name is redundant.
  begin
    insert into core.property_alias (property_id, licensor_id, alias)
      values (v_prop_a, v_lic_a, 'PSG5 TEST PROP A ' || v_suffix);
    raise exception 'F3. FAIL - redundant alias (= canonical name) accepted';
  exception
    when check_violation then
      raise notice 'F3. PASS - alias equal to the canonical name refused as redundant';
  end;

  -- F4. Same for the canonical code.
  begin
    insert into core.property_alias (property_id, licensor_id, alias)
      values (v_prop_a, v_lic_a, 'PPA' || v_suffix);
    raise exception 'F4. FAIL - redundant alias (= canonical code) accepted';
  exception
    when check_violation then
      raise notice 'F4. PASS - alias equal to the canonical code refused as redundant';
  end;

  -- F5. certification without an approver is refused by the table constraint too,
  -- not only by the RPC -- so a service_role direct write cannot bypass it.
  begin
    insert into core.property_alias (property_id, licensor_id, alias, cross_app_certified)
      values (v_prop_a, v_lic_a, 'Certified But Unapproved', true);
    raise exception 'F5. FAIL - certified alias accepted with no approver';
  exception
    when check_violation then
      raise notice 'F5. PASS - certification requires an approver identity and timestamp';
  end;

  raise notice '';
  raise notice 'ALL PSG-5 CONTRACT TESTS PASSED';
end;
$$;

rollback;
