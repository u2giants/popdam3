-- Issue #2355 (successor to #1090) behavioural contracts.
--
-- These assertions do NOT check that a migration applied. They check that the database
-- REFUSES the specific mistakes the issue exists to prevent:
--
--   * an alias that crosses a licensor boundary,
--   * two different characters answering to one normalized name inside one licensor,
--   * provenance recorded with no source, or pointing at a row that does not exist,
--   * and above all: two licensors reusing the same small integer source id being
--     merged into one provenance row. Disney and Sega both number from small integers.
--     A bare source id is not an identity, and a royalty decision made on one is wrong.
--
-- The file opens its own transaction and rolls it back at the end, so every row it
-- creates disappears -- and so do the constraint DROPs in D6d, even when the file is run
-- by hand with `psql -f` and stops mid-way. The CI glob wrapper adds a begin/rollback of
-- its own; that nesting is harmless and is exactly what
-- core_franchise_canonical_entity_contracts.sql does.

begin;

do $contracts$
declare
  v_suffix   text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS') || substr(md5(random()::text), 1, 6);
  v_lic_a    uuid;
  v_lic_b    uuid;
  v_char_a   uuid;
  v_char_a2  uuid;
  v_char_b   uuid;
  v_ref      uuid;
  v_orphan_char uuid;
  v_orphan_ref  uuid;
  v_dangling_ref uuid;
  v_legacy_ref uuid;
  v_blank_ref  uuid;
  v_relic_char uuid;
  v_drift_char uuid;
  v_drift_alias uuid;
  v_null_ref   uuid;
  v_last_seen  timestamptz;
  v_relic_ref  uuid;
  v_txt      text;
  v_uuid     uuid;
  v_bool     boolean;
  v_count    integer;
  v_legacy   integer;
  v_raised   boolean;
begin
  -- =========================================================================
  -- A. The objects exist. to_regclass and the catalog, never the ledger row.
  -- =========================================================================
  if to_regclass('core.character_alias') is null then
    raise exception '#2355: core.character_alias is absent';
  end if;

  foreach v_txt in array array['source_licensor_id','first_seen_at','last_seen_at','missing_since'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'core' and table_name = 'taxonomy_source_ref' and column_name = v_txt
    ) then
      raise exception '#2355: core.taxonomy_source_ref.% is absent', v_txt;
    end if;
  end loop;

  -- "Current" is the PREDICATE `missing_since is null`, never a stored column. A STORED
  -- generated column would have rewritten the whole live table under ACCESS EXCLUSIVE for
  -- information the predicate already carries, and a plain boolean would be a duplicate
  -- free to drift. Neither is acceptable, so the column must not exist at all -- and the
  -- partial index that serves the predicate must.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'core' and table_name = 'taxonomy_source_ref' and column_name = 'is_current'
  ) then
    raise exception
      '#2355: taxonomy_source_ref.is_current exists -- current state is the predicate `missing_since is null`, not a stored column that rewrites the table to add and can drift once added';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'core' and tablename = 'taxonomy_source_ref'
      and indexname = 'taxonomy_source_ref_current_idx'
      and indexdef ilike '%missing_since IS NULL%'
  ) then
    raise exception
      '#2355: taxonomy_source_ref_current_idx (partial on missing_since is null) is absent -- the read path for "what does this source currently assert?" is unserved';
  end if;
  if (select is_generated from information_schema.columns
      where table_schema='core' and table_name='character_alias' and column_name='normalized_alias') <> 'ALWAYS' then
    raise exception '#2355: character_alias.normalized_alias must be a generated column';
  end if;

  -- The pre-existing global unique key MUST survive: a dozen already-applied importer
  -- functions use it as their `on conflict` target. Removing it would break them all.
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'core.taxonomy_source_ref'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attname)
        from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
      ) = array['source_id','source_system','source_table']
  ) then
    raise exception
      '#2355: the pre-existing UNIQUE (source_system, source_table, source_id) was removed -- every importer on-conflict target is now broken';
  end if;

  -- The guards themselves.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'core.taxonomy_source_ref'::regclass
      and tgname = 'a_taxonomy_source_ref_identity_guard' and not tgisinternal
  ) then
    raise exception '#2355: the taxonomy_source_ref identity guard trigger is absent';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'core.character_alias'::regclass
      and tgname = 'character_alias_licensor_guard' and not tgisinternal
  ) then
    raise exception '#2355: the character_alias licensor guard trigger is absent';
  end if;

  -- The ColdLion circuit breaker must NOT have been displaced by the new guard.
  foreach v_txt in array array['coldlion_source_ref_breaker_guard','coldlion_source_ref_delete_breaker_guard'] loop
    if not exists (
      select 1 from pg_trigger
      where tgrelid = 'core.taxonomy_source_ref'::regclass and tgname = v_txt and not tgisinternal
    ) then
      raise exception '#2355: pre-existing ColdLion breaker trigger % was lost', v_txt;
    end if;
  end loop;

  -- Licensor-scoped alias uniqueness, and licensor-scoped alias source key.
  if not exists (
    select 1 from pg_indexes
    where schemaname='core' and tablename='character_alias' and indexname='character_alias_licensor_norm_key'
  ) then
    raise exception '#2355: character_alias_licensor_norm_key is absent';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname='core' and tablename='character_alias' and indexname='character_alias_licensor_source_key'
  ) then
    raise exception '#2355: character_alias_licensor_source_key is absent';
  end if;

  -- RLS on, and browser roles read-only.
  if not (select relrowsecurity from pg_class where oid = 'core.character_alias'::regclass) then
    raise exception '#2355: RLS is not enabled on core.character_alias';
  end if;
  if has_table_privilege('authenticated', 'core.character_alias', 'INSERT')
     or has_table_privilege('authenticated', 'core.character_alias', 'UPDATE')
     or has_table_privilege('authenticated', 'core.character_alias', 'DELETE') then
    raise exception '#2355: browser role `authenticated` can write core.character_alias';
  end if;
  if not has_table_privilege('authenticated', 'core.character_alias', 'SELECT') then
    raise exception '#2355: `authenticated` cannot read core.character_alias';
  end if;
  if has_table_privilege('anon', 'core.character_alias', 'SELECT') then
    raise exception '#2355: `anon` can read core.character_alias';
  end if;

  -- =========================================================================
  -- B. Fixture: TWO licensors, one character each. The whole point.
  -- =========================================================================
  select count(*) into v_legacy from core.taxonomy_source_ref;

  -- core.licensor is protected by the licensing write-authority guard (20260817124545 /
  -- 20260819151527). Each synthetic licensor below is authorized INDIVIDUALLY, immediately
  -- before its own insert, by the narrow route the guard is designed to consume: one
  -- plm.licensing_write_authorization row naming this backend, this transaction, the exact
  -- target table and the exact protected columns. This is the pattern
  -- core_franchise_canonical_entity_contracts.sql uses. The blanket helper
  -- public.ci_authorize_licensing_contract_test() is deliberately NOT used:
  -- scripts/database-contract-authorization.test.mjs pins the in-file callers of that
  -- helper to one legacy contract file, and a blanket authorization would leave the guard
  -- open for every later write in this file. The guard is not weakened, bypassed or
  -- edited; each authorization is real, transaction-bound, scoped to one write, and
  -- disappears with the rollback. core.character needs no authorization -- the guard's
  -- target_table domain is core.licensor and core.property only.
  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '23550000-0000-4000-8000-000000000001', repeat('a', 64),
    'issue-2355 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status)
  values ('ZZ #2355 Licensor A ' || v_suffix, 'Z55A-' || substr(v_suffix, 12), 'active')
  returning id into v_lic_a;

  insert into plm.licensing_write_authorization (
    backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
    actor, protected_columns, expires_at
  ) values (
    pg_backend_pid(), txid_current(), 'core.licensor', 'licensing_review_create',
    '23550000-0000-4000-8000-000000000002', repeat('b', 64),
    'issue-2355 synthetic contract', array['name','code','status'],
    clock_timestamp() + interval '1 minute'
  );
  insert into core.licensor (name, code, status)
  values ('ZZ #2355 Licensor B ' || v_suffix, 'Z55B-' || substr(v_suffix, 12), 'active')
  returning id into v_lic_b;

  insert into core.character (licensor_id, name, code, status)
  values (v_lic_a, 'ZZ Blue Runner ' || v_suffix, 'Z55CA-' || substr(v_suffix, 12), 'active')
  returning id into v_char_a;
  insert into core.character (licensor_id, name, code, status)
  values (v_lic_b, 'ZZ Blue Runner ' || v_suffix, 'Z55CB-' || substr(v_suffix, 12), 'active')
  returning id into v_char_b;

  -- A SECOND character under licensor A, so a same-licensor repoint can be told apart
  -- from a cross-licensor one.
  insert into core.character (licensor_id, name, code, status)
  values (v_lic_a, 'ZZ Blue Runner Two ' || v_suffix, 'Z55CA2-' || substr(v_suffix, 12), 'active')
  returning id into v_char_a2;

  -- =========================================================================
  -- C. core.character_alias behaviour
  -- =========================================================================

  -- C1. A normal alias lands and normalizes.
  insert into core.character_alias (character_id, licensor_id, alias, source_system, source_id)
  values (v_char_a, v_lic_a, 'Sonic The  Hedgehog!', 'wb_starlabs', '5');
  select normalized_alias into v_txt from core.character_alias
   where character_id = v_char_a and alias = 'Sonic The  Hedgehog!';
  if v_txt is null or length(btrim(v_txt)) = 0 then
    raise exception '#2355: normalized_alias was not generated';
  end if;
  if v_txt <> core.normalize_popsg_property_observation('Sonic The  Hedgehog!') then
    raise exception '#2355: character_alias uses a different normalizer than the frozen one';
  end if;

  -- C2. Within ONE licensor, a normalized name may not resolve to two characters.
  --     Different spelling, same normalization, same licensor -> refused.
  insert into core.character (licensor_id, name, code, status)
  values (v_lic_a, 'ZZ Impostor ' || v_suffix, 'Z55CI-' || substr(v_suffix, 12), 'active')
  returning id into v_uuid;
  v_raised := false;
  begin
    insert into core.character_alias (character_id, licensor_id, alias, source_system)
    values (v_uuid, v_lic_a, 'sonic the hedgehog!', 'nbcu');
  exception when unique_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception
      '#2355: one normalized name resolved to TWO characters inside one licensor -- that is the name coincidence this table exists to refuse';
  end if;

  -- C3. The SAME name under a DIFFERENT licensor is legitimate and must be allowed.
  insert into core.character_alias (character_id, licensor_id, alias, source_system, source_id)
  values (v_char_b, v_lic_b, 'Sonic The  Hedgehog!', 'disney_opa', '5');
  if (select count(*) from core.character_alias
       where normalized_alias = core.normalize_popsg_property_observation('Sonic The  Hedgehog!')) <> 2 then
    raise exception '#2355: the same observed name under two licensors must be two distinct aliases';
  end if;

  -- C4. Same source_system + source_id ('5') under two licensors is fine. It would NOT
  --     be fine if the alias source key were global -- which is the whole lesson.
  --     (Proven implicitly by C3 succeeding with source_id '5' after C1 used '5'.)
  --     A repeat of '5' inside ONE licensor is refused.
  v_raised := false;
  begin
    insert into core.character_alias (character_id, licensor_id, alias, source_system, source_id)
    values (v_uuid, v_lic_a, 'Blue Runner Prime ' || v_suffix, 'wb_starlabs', '5');
  exception when unique_violation then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: one licensor accepted the same source_system/source_id twice';
  end if;

  -- C5. An alias may never cross a licensor boundary.
  v_raised := false;
  begin
    insert into core.character_alias (character_id, licensor_id, alias, source_system)
    values (v_char_a, v_lic_b, 'Cross Licensor ' || v_suffix, 'manual');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception
      '#2355: an alias was attached to licensor B while its character belongs to licensor A';
  end if;

  -- C6. Re-parenting an existing alias onto another licensor is refused too.
  v_raised := false;
  begin
    update core.character_alias set licensor_id = v_lic_b where character_id = v_char_a;
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: an existing alias was re-licensed by UPDATE';
  end if;

  -- C7. An alias with no source is a name with a row id. Refused.
  v_raised := false;
  begin
    insert into core.character_alias (character_id, licensor_id, alias, source_system)
    values (v_char_a, v_lic_a, 'Unsourced ' || v_suffix, '   ');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: an alias was recorded with a blank source_system';
  end if;

  -- C8. A name that normalizes to nothing can never be matched. Refused.
  v_raised := false;
  begin
    insert into core.character_alias (character_id, licensor_id, alias, source_system)
    values (v_char_a, v_lic_a, '---', 'manual');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: an alias that normalizes to nothing was accepted';
  end if;

  -- C9. The canonical character cannot be deleted out from under its aliases.
  v_raised := false;
  begin
    delete from core.character where id = v_char_a;
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: a character with live aliases was deleted';
  end if;

  -- =====================================================================
  -- C10. THE ALIAS SCOPE FOLLOWS THE PARENT, OR THE MOVE IS REFUSED.
  --      C5 and C6 only retarget the ALIAS row, and a trigger on
  --      core.character_alias sees nothing when the PARENT moves. If
  --      `update core.character set licensor_id = <B>` were allowed to
  --      leave the alias behind, the alias would still occupy licensor A's
  --      (licensor, normalized name) slot while the character belongs to
  --      B: resolving that name for A would return B's character, and A
  --      could never register its own. That is the exact cross-licensor
  --      misattribution this table exists to prevent, so either the alias
  --      moves with the character or the move is refused -- never drift.
  -- =====================================================================
  insert into core.character (licensor_id, name, code, status)
  values (v_lic_a, 'ZZ Drift Probe ' || v_suffix, 'Z55DP-' || substr(v_suffix, 12), 'active')
  returning id into v_drift_char;

  insert into core.character_alias (character_id, licensor_id, alias, source_system)
  values (v_drift_char, v_lic_a, 'Drift Probe Alias ' || v_suffix, 'manual')
  returning id into v_drift_alias;

  v_raised := false;
  begin
    update core.character set licensor_id = v_lic_b where id = v_drift_char;
  exception when others then
    v_raised := true;
  end;

  if v_raised then
    -- Refusing the re-licensing outright is an acceptable answer: nothing drifted.
    if (select licensor_id from core.character_alias where id = v_drift_alias) <> v_lic_a then
      raise exception
        '#2355: the parent re-licensing was refused, yet the alias licensor changed anyway';
    end if;
  else
    if (select licensor_id from core.character where id = v_drift_char) <> v_lic_b then
      raise exception
        '#2355: the re-licensing fixture did not move the character, so C10 tests nothing';
    end if;
    if (select licensor_id from core.character_alias where id = v_drift_alias) <> v_lic_b then
      raise exception
        '#2355: the parent character was re-licensed to B but its alias is still scoped to A -- resolving that name for A now returns B''s character, and A can never register its own';
    end if;
  end if;

  -- And the pair must be structurally bound, not merely trigger-checked: a trigger on
  -- core.character_alias cannot see a write to core.character at all.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'core.character_alias'::regclass
      and contype = 'f'
      and confrelid = 'core.character'::regclass
      and (
        select array_agg(a.attname::text order by a.attname)
        from unnest(conkey) as k(attnum)
        join pg_attribute a on a.attrelid = conrelid and a.attnum = k.attnum
      ) = array['character_id','licensor_id']
  ) then
    raise exception
      '#2355: core.character_alias has no composite (character_id, licensor_id) foreign key to core.character -- the licensor scope of an alias is only checked when the ALIAS is written, so re-licensing the parent silently strands it';
  end if;

  -- =========================================================================
  -- D. core.taxonomy_source_ref -- provenance cannot be recorded without its source
  -- =========================================================================

  -- D1. The licensor is DERIVED, not asked for.
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
  values ('core', 'character', v_char_a, 'zz_portal_2355', 'characters', '5')
  returning id, source_licensor_id, (missing_since is null) into v_ref, v_uuid, v_bool;
  if v_uuid <> v_lic_a then
    raise exception '#2355: source_licensor_id was not derived from the entity (% <> %)', v_uuid, v_lic_a;
  end if;
  if not v_bool then
    raise exception '#2355: a freshly recorded source ref must be current';
  end if;
  if (select first_seen_at from core.taxonomy_source_ref where id = v_ref) is null
     or (select last_seen_at from core.taxonomy_source_ref where id = v_ref) is null then
    raise exception '#2355: first_seen_at/last_seen_at were not populated';
  end if;

  -- =====================================================================
  -- D2. THE COLLISION. Licensor B also numbers its characters from small
  --     integers and also calls this one '5'. The importer pattern used
  --     everywhere in this repository is:
  --         on conflict (source_system, source_table, source_id)
  --         do update set entity_id = excluded.entity_id
  --     Left unguarded, that upsert silently hands licensor A's provenance
  --     row to licensor B's character, and every royalty and approval
  --     decision downstream is then made against the wrong licensor.
  --     It must FAIL, loudly.
  -- =====================================================================
  v_raised := false;
  begin
    insert into core.taxonomy_source_ref
      (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
    values ('core', 'character', v_char_b, 'zz_portal_2355', 'characters', '5')
    on conflict (source_system, source_table, source_id) do update
      set entity_id = excluded.entity_id,
          entity_table = excluded.entity_table,
          source_licensor_id = null;
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception
      '#2355: two licensors reusing source id 5 collapsed into ONE provenance row -- this is the royalty misattribution the issue exists to prevent';
  end if;

  -- And the original row is untouched: it still belongs to licensor A.
  if (select source_licensor_id from core.taxonomy_source_ref where id = v_ref) <> v_lic_a then
    raise exception '#2355: the refused collision still mutated licensor A''s provenance row';
  end if;
  if (select entity_id from core.taxonomy_source_ref where id = v_ref) <> v_char_a then
    raise exception '#2355: the refused collision still repointed licensor A''s provenance row';
  end if;

  -- =====================================================================
  -- D2b. THE GRANDFATHERED COLLISION. Every row that predates this
  --      migration carries source_licensor_id NULL. The immutability rule
  --      D2 proves keys off the row's ALREADY-STAMPED licensor, so on a
  --      legacy row it has nothing to compare against, and the FIRST
  --      conflicting upsert would stamp the thief's licensor on and call
  --      it settled. Those are exactly the rows a colliding importer
  --      reaches first. The old TARGET still says who the row belonged
  --      to, so this must FAIL too.
  --      A legacy-shaped row can only be fabricated with the guard off:
  --      the guard stamps a licensor on every row it is shown.
  -- =====================================================================
  alter table core.taxonomy_source_ref disable trigger a_taxonomy_source_ref_identity_guard;
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
  values ('core', 'character', v_char_a, 'zz_portal_2355', 'legacy_characters', '5')
  returning id into v_legacy_ref;
  alter table core.taxonomy_source_ref enable trigger a_taxonomy_source_ref_identity_guard;

  if (select source_licensor_id from core.taxonomy_source_ref where id = v_legacy_ref) is not null then
    raise exception
      '#2355: the pre-migration fixture row was stamped with a licensor, so it does not test the grandfathered path at all';
  end if;

  v_raised := false;
  begin
    update core.taxonomy_source_ref
       set entity_id = v_char_b
     where id = v_legacy_ref;
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception
      '#2355: a pre-migration row with a null source_licensor_id was re-attributed to another licensor on its first conflicting write';
  end if;
  if (select entity_id from core.taxonomy_source_ref where id = v_legacy_ref) <> v_char_a then
    raise exception '#2355: the refused legacy re-attribution still repointed the row';
  end if;
  if (select source_licensor_id from core.taxonomy_source_ref where id = v_legacy_ref) is not null then
    raise exception '#2355: the refused legacy re-attribution still stamped a licensor on the row';
  end if;

  -- D2c. ...but HEALING a legacy row is not stealing it. A repoint that stays inside
  --      the SAME licensor must still succeed and stamp the licensor it always had,
  --      or the rule above has quietly become a blanket ban on touching any
  --      pre-migration row -- which would strand every grandfathered row forever.
  update core.taxonomy_source_ref
     set entity_id = v_char_a2
   where id = v_legacy_ref
  returning source_licensor_id into v_uuid;
  if v_uuid is distinct from v_lic_a then
    raise exception
      '#2355: a same-licensor heal of a pre-migration row was refused or mis-stamped (% <> %) -- the anti-collision rule has become a blanket refusal',
      v_uuid, v_lic_a;
  end if;

  -- D3. Licensor B may record its OWN '5' under a distinct source_table. Recording
  --     provenance separately is always available; only the merge is refused.
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
  values ('core', 'character', v_char_b, 'zz_portal_2355', 'characters_licensor_b', '5')
  returning source_licensor_id into v_uuid;
  if v_uuid <> v_lic_b then
    raise exception '#2355: licensor B''s own provenance row was not scoped to licensor B';
  end if;

  -- =====================================================================
  -- D3b. A LICENSOR-LESS TARGET IS ACCEPTED, NOT REFUSED.
  --      The orphan fixture is a core.character, NOT a core.property.
  --      core.property.licensor_id was NULLABLE only until
  --      20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql
  --      set it NOT NULL, so an orphan property can no longer exist and the
  --      earlier version of this block failed on that constraint.
  --      core.character.licensor_id is still nullable
  --      (20260829004145_separate_property_and_character.sql line 34), so a
  --      licensor-less character is the honest live example. If the guard
  --      raised whenever the derived licensor came back null, every provenance
  --      write against such a character would become a hard failure. The
  --      honest record is a NULL owner, not an error.
  -- =====================================================================
  insert into core.character (licensor_id, name, code, status)
  values (null, 'ZZ #2355 Orphan Character ' || v_suffix, 'Z55OC-' || substr(v_suffix, 12), 'active')
  returning id into v_orphan_char;
  if (select licensor_id from core.character where id = v_orphan_char) is not null then
    raise exception '#2355: the orphan-character fixture acquired a licensor, so it tests nothing';
  end if;

  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
  values ('core', 'character', v_orphan_char, 'zz_portal_2355', 'characters_orphan', 'orphan-1')
  returning id, source_licensor_id into v_orphan_ref, v_uuid;
  if v_uuid is not null then
    raise exception
      '#2355: provenance for a licensor-less character was stamped with licensor % out of nowhere', v_uuid;
  end if;
  if (select first_seen_at from core.taxonomy_source_ref where id = v_orphan_ref) is null then
    raise exception '#2355: the licensor-less provenance row was not given a first_seen_at';
  end if;

  -- ...but a caller may not attribute it to a licensor the entity does not belong to.
  v_raised := false;
  begin
    insert into core.taxonomy_source_ref
      (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_licensor_id)
    values ('core', 'character', v_orphan_char, 'zz_portal_2355', 'characters_orphan', 'orphan-2', v_lic_a);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception
      '#2355: provenance for a licensor-less character was attributed to a licensor the character does not belong to';
  end if;

  -- ...and a target that does not exist AT ALL still raises. Accepting a null derived
  -- licensor must not have quietly turned the existence check off with it.
  v_raised := false;
  begin
    insert into core.taxonomy_source_ref
      (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
    values ('core', 'property', gen_random_uuid(), 'zz_portal_2355', 'properties', 'orphan-3');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: provenance was recorded against a property that does not exist';
  end if;

  -- =====================================================================
  -- D3c. THE DOCUMENTED LIMIT OF ROW-EXISTENCE CHECKING.
  --      Row existence is verified ONLY for the four licensor-scoped core
  --      kinds (licensor, property, character, franchise), because it is a
  --      free by-product of the licensor-derivation lookup. For any OTHER
  --      table, a provenance row naming a uuid that exists in no row is
  --      ACCEPTED. That is a deliberate decision, not an oversight: closing
  --      it would need dynamic SQL built from caller-supplied schema and
  --      table names inside a security-definer trigger, and the harm the
  --      guard exists to prevent is cross-licensor misattribution, which is
  --      entirely inside the four checked kinds. This assertion exists so
  --      the limit cannot change silently in either direction: if a later
  --      migration widens the check, this fails and the decision gets
  --      re-argued on purpose.
  -- =====================================================================
  if to_regclass('core.merch_group') is null then
    raise exception '#2355: core.merch_group is absent, so D3c cannot test the unchecked-kind path';
  end if;
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
  values ('core', 'merch_group', gen_random_uuid(), 'zz_portal_2355', 'dangling_kind', 'dangling-1')
  returning id, source_licensor_id into v_dangling_ref, v_uuid;
  if v_dangling_ref is null then
    raise exception
      '#2355: provenance against a nonexistent core.merch_group row was refused -- row existence is documented as checked ONLY for the four licensor-scoped core kinds. If widening it was intended, say so in the migration header and delete this assertion.';
  end if;
  if v_uuid is not null then
    raise exception
      '#2355: a non-licensor-scoped kind was stamped with licensor % out of nowhere', v_uuid;
  end if;

  -- ...but the TABLE must still be real for every kind, checked or not.
  v_raised := false;
  begin
    insert into core.taxonomy_source_ref
      (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
    values ('core', 'zz_no_such_table_2355', gen_random_uuid(), 'zz_portal_2355', 'dangling_kind', 'dangling-2');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: provenance was recorded against a table that does not exist';
  end if;

  -- D4. A source_licensor_id that disagrees with the entity is refused, not trusted.
  v_raised := false;
  begin
    insert into core.taxonomy_source_ref
      (entity_schema, entity_table, entity_id, source_system, source_table, source_id, source_licensor_id)
    values ('core', 'character', v_char_a, 'zz_portal_2355', 'characters', '77', v_lic_b);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: a caller-supplied source_licensor_id contradicting the entity was trusted';
  end if;

  -- D5. Provenance with a blank source id is not provenance.
  v_raised := false;
  begin
    insert into core.taxonomy_source_ref
      (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
    values ('core', 'character', v_char_a, 'zz_portal_2355', 'characters', '   ');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: a source ref was recorded with a blank source_id';
  end if;

  -- D6. KIND-SAFE TARGET INTEGRITY: entity_id is an untyped uuid. It may not name a
  --     row that does not exist...
  v_raised := false;
  begin
    insert into core.taxonomy_source_ref
      (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
    values ('core', 'character', gen_random_uuid(), 'zz_portal_2355', 'characters', '88');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: provenance was recorded against a character that does not exist';
  end if;

  -- ...nor may entity_table name something that is not a table.
  v_raised := false;
  begin
    insert into core.taxonomy_source_ref
      (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
    values ('core', 'not_a_real_kind', v_char_a, 'zz_portal_2355', 'characters', '89');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: provenance was recorded against a kind that does not exist';
  end if;

  -- ...and a uuid belonging to a DIFFERENT kind is refused, which is what makes the
  -- licensor derivation trustworthy in the first place.
  v_raised := false;
  begin
    insert into core.taxonomy_source_ref
      (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
    values ('core', 'character', v_lic_a, 'zz_portal_2355', 'characters', '90');
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception '#2355: a licensor uuid was accepted as a character entity_id';
  end if;

  -- D6b. A RE-ASSERTION advances last_seen_at. Importers upsert entity_id and name no
  --      freshness column, so if the guard did not advance it the column would be a
  --      permanent lie about when the source last said this.
  update core.taxonomy_source_ref
     set first_seen_at = now() - interval '3 days',
         last_seen_at  = now() - interval '2 days'
   where id = v_ref;
  update core.taxonomy_source_ref set entity_id = v_char_a where id = v_ref;
  if (select last_seen_at from core.taxonomy_source_ref where id = v_ref) < now() - interval '1 minute' then
    raise exception '#2355: last_seen_at was not advanced by a re-assertion';
  end if;

  -- D6c. ...but a METADATA-ONLY correction is NOT a sighting. Fixing a display name the
  --      source never re-sent must not be written into the record as "the source said
  --      this again today", or last_seen_at stops meaning anything at all.
  update core.taxonomy_source_ref
     set last_seen_at = now() - interval '2 days'
   where id = v_ref;
  update core.taxonomy_source_ref
     set source_name = 'ZZ corrected label ' || v_suffix
   where id = v_ref;
  if (select last_seen_at from core.taxonomy_source_ref where id = v_ref) > now() - interval '1 day' then
    raise exception
      '#2355: a metadata-only correction was recorded as a fresh source sighting -- last_seen_at advanced without the source re-asserting anything';
  end if;

  -- =====================================================================
  -- D6d. THE FIRST RE-ASSERTION ON A TRUE LEGACY ROW RECORDS *NOW*.
  --      Pre-#2355 rows carry first_seen_at and last_seen_at NULL --
  --      `alter column ... set default` back-fills nothing. On the ordinary
  --      importer upsert the identity guard fills last_seen_at from
  --      created_at, and the bump trigger then compares that against the
  --      OLD null, sees "the caller supplied a value", and leaves it alone.
  --      The first sighting after this migration would therefore be
  --      recorded as the row's creation date, often years old, and a
  --      freshness job would read live evidence as "the source dropped
  --      this". A second upsert heals it; the first -- the production path
  --      for every existing row -- must not need healing.
  --      D2b/D7c do NOT cover this: they omit the freshness columns from
  --      the insert list, so the column DEFAULTS fill now(). Only an
  --      EXPLICIT null produces a genuine legacy row, and the guard plus
  --      the two present-constraints must both be stood down to write one.
  -- =====================================================================
  alter table core.taxonomy_source_ref disable trigger a_taxonomy_source_ref_identity_guard;
  alter table core.taxonomy_source_ref drop constraint taxonomy_source_ref_first_seen_present;
  alter table core.taxonomy_source_ref drop constraint taxonomy_source_ref_last_seen_present;
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id,
     first_seen_at, last_seen_at)
  values ('core', 'character', v_char_a, 'zz_portal_2355', 'null_ts_legacy', '91',
          null, null)
  returning id into v_null_ref;
  alter table core.taxonomy_source_ref
    add constraint taxonomy_source_ref_first_seen_present
    check (first_seen_at is not null) not valid;
  alter table core.taxonomy_source_ref
    add constraint taxonomy_source_ref_last_seen_present
    check (last_seen_at is not null) not valid;
  alter table core.taxonomy_source_ref enable trigger a_taxonomy_source_ref_identity_guard;

  if (select first_seen_at is not null or last_seen_at is not null
        from core.taxonomy_source_ref where id = v_null_ref) then
    raise exception
      '#2355: the null-timestamp fixture was back-filled on insert, so D6d does not test a genuine pre-migration row at all';
  end if;

  -- The ordinary importer upsert: it re-supplies the target and names no freshness column.
  update core.taxonomy_source_ref set entity_id = v_char_a where id = v_null_ref;

  select last_seen_at into v_last_seen from core.taxonomy_source_ref where id = v_null_ref;
  if v_last_seen is null then
    raise exception '#2355: the first re-assertion on a legacy row left last_seen_at null';
  end if;
  if v_last_seen < now() - interval '1 minute' then
    raise exception
      '#2355: the FIRST re-assertion on a pre-migration row recorded last_seen_at = % (its created_at), not now() -- a freshness job would read live evidence as "the source dropped this"',
      v_last_seen;
  end if;
  if (select first_seen_at from core.taxonomy_source_ref where id = v_null_ref) is null then
    raise exception '#2355: first_seen_at was not back-filled on a legacy row';
  end if;

  -- D7. Absence is RECORDED, not deleted. missing_since is what makes a row non-current.
  update core.taxonomy_source_ref set missing_since = now() where id = v_ref;
  if (select missing_since is null from core.taxonomy_source_ref where id = v_ref) then
    raise exception '#2355: the row stayed current after missing_since was set';
  end if;
  if (select first_seen_at from core.taxonomy_source_ref where id = v_ref) is null then
    raise exception '#2355: first_seen_at was lost on update';
  end if;

  -- =====================================================================
  -- D7b. RE-APPEARANCE IS A SIGHTING. Clearing missing_since is the source
  --      asserting this again after an absence. If last_seen_at did not
  --      advance, a re-appeared row would go on claiming it was last seen
  --      before it vanished -- older than the absence it just ended.
  --      (Setting missing_since is still NOT a sighting: D7 above and the
  --      guard's own `new.missing_since is null` test cover that direction.)
  -- =====================================================================
  update core.taxonomy_source_ref
     set last_seen_at = now() - interval '2 days'
   where id = v_ref;
  if (select last_seen_at from core.taxonomy_source_ref where id = v_ref) > now() - interval '1 day' then
    raise exception '#2355: the re-appearance fixture could not be aged, so D7b tests nothing';
  end if;

  update core.taxonomy_source_ref set missing_since = null where id = v_ref;
  if not (select missing_since is null from core.taxonomy_source_ref where id = v_ref) then
    raise exception '#2355: clearing missing_since did not make the row current again';
  end if;
  if (select last_seen_at from core.taxonomy_source_ref where id = v_ref) < now() - interval '1 minute' then
    raise exception
      '#2355: a re-assertion after an absence did not advance last_seen_at -- the row still claims it was last seen before it went missing';
  end if;

  -- =====================================================================
  -- D7c. A LEGACY ROW WITH A BLANK SOURCE KEY STAYS EDITABLE FOR FRESHNESS.
  --      Pre-#2355 rows were written with no blank-key guard, so some carry
  --      a blank source_id. If the guard checked blank keys on EVERY write
  --      rather than on writes that set them, those rows could never be
  --      updated again -- including by the missing_since / last_seen_at
  --      writes this migration exists to make. The guard must be off to
  --      fabricate such a row: it refuses to CREATE one.
  -- =====================================================================
  alter table core.taxonomy_source_ref disable trigger a_taxonomy_source_ref_identity_guard;
  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
  values ('core', 'character', v_char_a, 'zz_portal_2355', 'blank_key_legacy', '   ')
  returning id into v_blank_ref;
  alter table core.taxonomy_source_ref enable trigger a_taxonomy_source_ref_identity_guard;

  update core.taxonomy_source_ref set missing_since = now() where id = v_blank_ref;
  if (select missing_since is null from core.taxonomy_source_ref where id = v_blank_ref) then
    raise exception
      '#2355: a freshness-only update to a legacy row with a blank source key did not take effect';
  end if;
  update core.taxonomy_source_ref set missing_since = null where id = v_blank_ref;
  if not (select missing_since is null from core.taxonomy_source_ref where id = v_blank_ref) then
    raise exception
      '#2355: a legacy row with a blank source key could not be re-asserted after an absence';
  end if;
  -- ...but the blank key is still refused the moment the write actually SETS it.
  v_raised := false;
  begin
    update core.taxonomy_source_ref
       set source_id = '  '
     where id = v_blank_ref;
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception
      '#2355: scoping the blank-key check to real key writes disabled it entirely -- a blank source_id was accepted';
  end if;

  -- =====================================================================
  -- D7d. A RE-LICENSED TARGET DOES NOT FREEZE ITS PROVENANCE ROW.
  --      Characters get moved between licensors. If the guard re-derived
  --      the licensor on every write, the derived value would then disagree
  --      with the licensor already stamped on the row, the immutability
  --      rule would refuse the change, and the row could never record its
  --      own absence again. Derivation must be scoped to writes that touch
  --      the target or the licensor.
  -- =====================================================================
  insert into core.character (licensor_id, name, code, status)
  values (v_lic_a, 'ZZ Relicensed ' || v_suffix, 'Z55RL-' || substr(v_suffix, 12), 'active')
  returning id into v_relic_char;

  insert into core.taxonomy_source_ref
    (entity_schema, entity_table, entity_id, source_system, source_table, source_id)
  values ('core', 'character', v_relic_char, 'zz_portal_2355', 'relicensed', '77')
  returning id into v_relic_ref;

  update core.character set licensor_id = v_lic_b where id = v_relic_char;
  if (select licensor_id from core.character where id = v_relic_char) <> v_lic_b then
    raise exception '#2355: the re-licensing fixture did not move the character, so D7d tests nothing';
  end if;

  update core.taxonomy_source_ref set missing_since = now() where id = v_relic_ref;
  if (select missing_since is null from core.taxonomy_source_ref where id = v_relic_ref) then
    raise exception
      '#2355: a freshness-only update to a provenance row whose target was re-licensed was refused or lost';
  end if;
  -- The stamped licensor is a historical fact and must NOT be silently re-derived.
  if (select source_licensor_id from core.taxonomy_source_ref where id = v_relic_ref) is distinct from v_lic_a then
    raise exception
      '#2355: a freshness-only update silently re-derived source_licensor_id from the re-licensed target';
  end if;

  -- D8. first_seen_at is a fact about the past and may not be moved forward.
  update core.taxonomy_source_ref
     set first_seen_at = now() + interval '1 day'
   where id = v_ref;
  if (select first_seen_at from core.taxonomy_source_ref where id = v_ref) > now() then
    raise exception '#2355: first_seen_at was moved forward by a later write';
  end if;

  -- =========================================================================
  -- E. Existing rows are PRESERVED. This migration rewrites nothing.
  -- =========================================================================
  select count(*) into v_count from core.taxonomy_source_ref
   where source_system not like 'zz_portal_2355%';
  if v_count < v_legacy then
    raise exception '#2355: % pre-existing taxonomy_source_ref row(s) disappeared', v_legacy - v_count;
  end if;

  -- The grandfathering constraints must stay NOT VALID: validating them would require
  -- rewriting the very rows this issue must preserve.
  foreach v_txt in array array['taxonomy_source_ref_first_seen_present','taxonomy_source_ref_last_seen_present'] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'core.taxonomy_source_ref'::regclass and conname = v_txt and not convalidated
    ) then
      raise exception
        '#2355: % must exist and remain NOT VALID -- validating it would rewrite pre-#2355 rows', v_txt;
    end if;
  end loop;

  raise notice '#2355 contracts: all character alias and source provenance assertions held';
end
$contracts$;

rollback;
