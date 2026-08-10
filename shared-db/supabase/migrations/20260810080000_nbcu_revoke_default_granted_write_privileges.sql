-- =====================================================================================
-- NBCU landing -- revoke the write privileges that schema default privileges handed out.
--
-- Migration: 20260810080000_nbcu_revoke_default_granted_write_privileges.sql
-- Fixes:     20260810070000_nbcu_creative_asset_factory_landing.sql (same PR, issue #628)
-- Scope:     REVOKES ONLY. No table, column, index, function, policy or default privilege
--            is created, altered or dropped by this file.
--
-- WHAT WENT WRONG, IN FULL, BECAUSE THIS IS THE INTERESTING PART
--
-- Migration 20260810070000 states that NBCU snapshot rows are immutable, and delivers
-- that by PRIVILEGE SEPARATION rather than by a trigger: grant service_role SELECT and
-- INSERT, never UPDATE or DELETE, so a landed row cannot be changed by the only role
-- that can reach it.
--
-- It did not work. The schema `plm` carries
--     ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO service_role
-- (catalog: `service_role=arwdDxtm/postgres` in pg_default_acl). Postgres applies that
-- at CREATE TABLE time, so all sixteen nbcu tables were born holding SELECT, INSERT,
-- UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER for service_role. The migration then
-- revoked from `public`, `anon` and `authenticated` -- none of which is service_role --
-- and issued `grant select, insert to service_role`, which was a NO-OP against a role
-- that already held everything.
--
-- Net effect before this file: rows were fully mutable and deletable, and
-- plm.nbcu_capture was directly insertable, bypassing the begin/finalize functions that
-- are supposed to be its only write path. The immutability guarantee was INERT.
--
-- IT WAS COMPLETELY SILENT. The migration applied cleanly, the ledger row is green, and
-- every static check in this repository passed. Nothing in the SQL was wrong on its face;
-- the grant simply had no effect. CONTRACT TEST D IS THE ONLY THING IN THIS SESSION THAT
-- COULD HAVE CAUGHT IT, AND IT DID -- because it asserts the OUTCOME by reading
-- information_schema.role_table_grants, rather than asserting that the migration ran.
-- That is the argument for privilege separation over a trigger making itself: the
-- resulting privileges are inspectable in the catalog, so a test can check the guarantee
-- instead of checking that some guard code exists.
--
-- WHY THIS IS A SECOND FILE AND NOT AN EDIT
-- 20260810070000 is already applied to preview. Applied migrations are never edited in
-- this repository -- the ledger keys on the version, so an edited file is silently not
-- re-run and the two environments drift apart with no error anywhere.
--
-- DELIBERATELY NOT DONE HERE
--   * The schema-level ALTER DEFAULT PRIVILEGES is NOT changed. Every future table in
--     `plm` will keep being born with these grants.
--   * plm.erp_* and every other existing plm table carry the SAME seven grants and are
--     NOT touched. That finding is schema-wide, it reaches far beyond this licensor
--     import, and it is carried separately by the orchestrator. A general fix must not
--     ride in on a licensor-import PR.
--   Both are intentional omissions, not oversights.
--
-- REFERENCES is left in place: it only allows creating a foreign key that points AT these
-- tables, which writes nothing. TRIGGER is left in place for the same reason -- and
-- contract test D independently asserts that no user trigger actually exists.
-- =====================================================================================

do $$
declare
  t text;
  tables text[] := array[
    'nbcu_capture','nbcu_right','nbcu_scope','nbcu_property','nbcu_ip_family',
    'nbcu_character','nbcu_style_guide','nbcu_asset','nbcu_asset_metadata_value',
    'nbcu_asset_scope','nbcu_ip_family_property','nbcu_property_character',
    'nbcu_asset_property','nbcu_asset_character','nbcu_asset_style_guide',
    'nbcu_style_guide_property'
  ];
begin
  foreach t in array tables loop
    -- THE ACTUAL FIX. Without this, every statement in 20260810070000 about
    -- immutability is decoration.
    execute format('revoke update, delete, truncate on plm.%I from service_role', t);

    if t = 'nbcu_capture' then
      -- Capture rows are created and transitioned ONLY by plm.begin_nbcu_capture and
      -- plm.finalize_nbcu_capture, which are security definer. A direct INSERT here
      -- would let a loader mint a capture that skipped every validation in begin_*.
      execute format('revoke insert on plm.%I from service_role', t);
    end if;
  end loop;
end;
$$;

-- Assert the outcome IN the migration, so this file cannot itself fail silently the way
-- the one it fixes did. If the revokes did not take, this raises and the migration fails.
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm'
     and table_name like 'nbcu\_%'
     and grantee = 'service_role'
     and privilege_type in ('UPDATE','DELETE','TRUNCATE');
  if v_bad <> 0 then
    raise exception
      'nbcu revoke migration: service_role still holds % write grant(s) on nbcu tables', v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm'
     and table_name = 'nbcu_capture'
     and grantee = 'service_role'
     and privilege_type = 'INSERT';
  if v_bad <> 0 then
    raise exception 'nbcu revoke migration: plm.nbcu_capture is still directly insertable';
  end if;

  -- The loader must still be able to read everything and write the 15 snapshot tables.
  -- A revoke that overshot into SELECT or INSERT would break the load, so prove it did not.
  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'nbcu\_%'
     and grantee = 'service_role' and privilege_type = 'SELECT';
  if v_bad <> 16 then
    raise exception 'nbcu revoke migration: expected 16 SELECT grants, found %', v_bad;
  end if;

  select count(*) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'plm' and table_name like 'nbcu\_%'
     and grantee = 'service_role' and privilege_type = 'INSERT';
  if v_bad <> 15 then
    raise exception 'nbcu revoke migration: expected 15 INSERT grants, found %', v_bad;
  end if;

  raise notice 'nbcu privileges are now service_role: SELECT x16, INSERT x15, no UPDATE/DELETE/TRUNCATE';
end;
$$;
