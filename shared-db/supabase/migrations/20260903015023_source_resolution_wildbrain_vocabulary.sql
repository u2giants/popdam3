-- =====================================================================================
-- Add WildBrain to the plm.source_resolution source vocabulary.
--
-- Migration: 20260903015023_source_resolution_wildbrain_vocabulary.sql
-- Issue:     u2giants/shared-db #2147
-- Claim:     u2giants/shared-db #2154 -- table plm.source_resolution. Nothing else.
-- derived-from: none
--
-- Depends on (exact 14-digit versions):
--   20260902024541  source_resolution_supported_home -- creates plm.source_resolution and
--                   the constraint this file widens. This migration only ALTERS one
--                   constraint; it re-derives no object body, which is why it declares
--                   `derived-from: none`. If the table is absent this file fails loudly
--                   rather than installing anything.
--   20260819014639  wildbrain_dam_source_landing -- the per-capture WildBrain landing whose
--                   decisions have nowhere durable to live until this value exists. Not a
--                   hard dependency: nothing below reads or references those tables.
--
-- LOADS NO DATA. No row is inserted into plm.source_resolution by this file, and no
-- WildBrain property, character, guide, asset or keyword value appears anywhere in it.
-- u2giants/shared-db is a PUBLIC repository: SCHEMA IN GIT, DATA OUT OF GIT.
--
-- -------------------------------------------------------------------------------------
-- WHY A PLAIN VALUE AND NOT A NAMESPACED PATTERN
--
-- The existing vocabulary is `paramount`, `nbcu`, `disney_opa`, `disney_dcpvault`,
-- `lucasfilm_dcpvault`, `marvel_dcpvault`, `twentieth_century_dcpvault`, plus the LIKE
-- pattern `warner:%`. That pattern is not decoration and not a style choice -- it exists
-- because Warner's identity carries a dimension the others do not:
--
--   * plm.wb_property and its siblings (20260813230000) key identity on
--     (source_namespace, source_id), with the property namespace pinned by CHECK to two
--     portal namespaces. A Warner source ID is unique only WITHIN its namespace, so the
--     namespace is part of the durable identity. 20260814233423 therefore writes
--     `'warner:' || p.source_namespace` into source_system, and a LIKE pattern is the
--     only way to admit an open set of those namespaces.
--
--   * The qualified plain values follow the same logic in the other direction. Disney
--     spans TWO portals (OPA and the DCP Vault), and the DCP Vault portal spans FOUR
--     licensors, so both sides need a qualifier. Paramount and NBCU each have exactly one
--     portal and one ID space, and each gets a bare licensor token.
--
-- WildBrain is in the Paramount/NBCU situation, not the Warner one:
--
--   * There is no source_namespace column, or any equivalent, on any of the eleven
--     plm.wildbrain_* tables created by 20260819014639. Nothing in that landing carries a
--     second identity dimension.
--   * plm.wildbrain_character is keyed (capture_id, character_source_id) -- capture_id is
--     the snapshot, not a namespace -- and its own comment states that identity is
--     character_source_id AND NOTHING ELSE. That capture-scoping is exactly why the issue
--     needs the durable home in the first place.
--   * The landing header records that the licensee account sees exactly ONE property
--     through ONE portal. There is no second WildBrain source to disambiguate against.
--   * api.source_capture_inventory (20260819151536) already classifies every
--     plm.wildbrain_* table under the source_system token `wildbrain`, spelled exactly
--     that way. Choosing a different spelling here would put two names on one source.
--
-- So: a plain, single, lower-case value `wildbrain`. Not `wildbrain_dam` (there is no
-- sibling WildBrain portal to distinguish it from), and not a `wildbrain:%` pattern
-- (there is no namespace to carry). Both of those are proved refused below.
--
-- -------------------------------------------------------------------------------------
-- WIDENED, NOT REPLACED. The constraint is dropped and re-added because a CHECK
-- expression cannot be edited in place. Every value the old expression accepted is
-- re-asserted below by real inserts, so a narrowing cannot pass as a widening.
-- =====================================================================================

alter table plm.source_resolution
  drop constraint if exists source_resolution_source_system_supported_chk;

alter table plm.source_resolution
  add constraint source_resolution_source_system_supported_chk check (
    source_system in (
      'paramount','nbcu','disney_opa','disney_dcpvault','lucasfilm_dcpvault',
      'marvel_dcpvault','twentieth_century_dcpvault','wildbrain'
    ) or source_system like 'warner:%'
  );

comment on column plm.source_resolution.source_system is
  'Durable source vocabulary. A bare licensor token where the licensor has one portal and '
  'one ID space (paramount, nbcu, wildbrain); a licensor_portal token where either side is '
  'shared (disney_opa, disney_dcpvault, lucasfilm_dcpvault, marvel_dcpvault, '
  'twentieth_century_dcpvault); and warner:<source_namespace>, because a Warner source ID is '
  'unique only within its portal namespace. Pinned by '
  'source_resolution_source_system_supported_chk.';

-- =====================================================================================
-- Self-verification.
--
-- BEHAVIOUR, NOT TEXT. Reading pg_constraint.conbin or pg_get_constraintdef and matching a
-- substring would pass for a constraint that accepts everything, and would pass for one
-- left NOT VALID. So the vocabulary is proved by REAL INSERTS that raise a REAL SQLSTATE.
--
-- WHY THE INSERTS GO INTO A LIKE-COPY AND NOT INTO THE DURABLE TABLE ITSELF.
-- The migration verification cost guard (scripts/check-migration-verify-cost.mjs, issue
-- #1285, documented in docs/migration-verification-cost-guard.md) refuses a verification
-- block that names a plm object in a read-or-write context, an INSERT included. That guard
-- is correct and is not being worked around: a bounded probe still must not put a row,
-- however briefly, into a governed durable-decision table inside the apply transaction.
-- `create temporary table ... (like ... including constraints including defaults)` copies
-- the CHECK constraints AS THE CATALOGUE HOLDS THEM at this instant, under their own names,
-- so the expressions exercised below are the deployed expressions and not a restatement of
-- them. DEFAULTS are included because two NOT NULL timestamp columns are only satisfiable
-- through their defaults; without it every probe fails 23502 and proves nothing about the
-- vocabulary. The copy is proved complete before it is trusted: it must carry the same
-- number of CHECK constraints as the real table AND the exact constraint under test. The
-- temporary table is ON COMMIT DROP, reads no data, and touches no row of the durable
-- table.
--
-- A NOT VALID constraint would still reject new inserts, so behaviour alone cannot see it.
-- convalidated is therefore pinned in the catalogue, alongside the constraint's identity.
-- =====================================================================================
do $verify$
declare
  v_real_checks   integer;
  v_probe_checks  integer;
  v_count         integer;
  v_accepted      text[] := array[
    'paramount','nbcu','disney_opa','disney_dcpvault','lucasfilm_dcpvault',
    'marvel_dcpvault','twentieth_century_dcpvault',
    'warner:warner_product_catalogue','warner:warner_art_assets','warner:',
    'wildbrain'
  ];
  v_refused       text[] := array[
    'wildbrain_dam','wildbrain:dam','wildbrain_2','WildBrain','WILDBRAIN',
    'warner','wb','disney','paramount_pmt','sega','peanuts',
    'no_such_source_system'
  ];
  v_value         text;
  v_i             integer := 0;
  v_refused_ok    boolean;
  v_state         text;
begin
  -- 1. The constraint's identity, kind, table, validity and non-deferrability.
  --    Exactly one row, or this migration did not end where it says it did.
  select count(*) into v_count
  from pg_constraint
  where conrelid = 'plm.source_resolution'::regclass
    and conname = 'source_resolution_source_system_supported_chk'
    and contype = 'c'
    and convalidated
    and not condeferrable;
  if v_count <> 1 then
    raise exception 'issue #2147: expected exactly 1 validated, non-deferrable CHECK named source_resolution_source_system_supported_chk on the durable resolution table, found %', v_count;
  end if;

  -- 2. A complete copy of the deployed CHECK set, or the probes below prove nothing.
  select count(*) into v_real_checks
  from pg_constraint
  where conrelid = 'plm.source_resolution'::regclass and contype = 'c';

  create temporary table source_resolution_vocabulary_probe
    (like plm.source_resolution including constraints including defaults) on commit drop;

  select count(*) into v_probe_checks
  from pg_constraint
  where conrelid = 'source_resolution_vocabulary_probe'::regclass and contype = 'c';
  if v_probe_checks <> v_real_checks then
    raise exception 'issue #2147: the probe copy carries % CHECK constraint(s) but the durable resolution table carries %; the probes below would not be testing the deployed rules', v_probe_checks, v_real_checks;
  end if;

  select count(*) into v_count
  from pg_constraint
  where conrelid = 'source_resolution_vocabulary_probe'::regclass
    and conname = 'source_resolution_source_system_supported_chk'
    and contype = 'c';
  if v_count <> 1 then
    raise exception 'issue #2147: the probe copy does not carry the source-system vocabulary constraint under test (found % of it)', v_count;
  end if;

  -- 3. EVERY value the vocabulary accepted before must still be accepted, and the new
  --    WildBrain value must be accepted. A narrowing cannot pass as a widening.
  foreach v_value in array v_accepted loop
    v_i := v_i + 1;
    begin
      insert into source_resolution_vocabulary_probe
        (source_system, entity_kind, source_id, resolution_status)
      values (v_value, 'character', 'probe-' || v_i::text, 'unresolved');
    exception when others then
      raise exception 'issue #2147: source_system % must be accepted by the durable resolution vocabulary but was refused with SQLSTATE %', v_value, sqlstate;
    end;
  end loop;

  select count(*) into v_count from source_resolution_vocabulary_probe;
  if v_count <> array_length(v_accepted, 1) then
    raise exception 'issue #2147: % accepted vocabulary value(s) were offered but % row(s) landed in the probe', array_length(v_accepted, 1), v_count;
  end if;

  -- 4. The vocabulary must still be a vocabulary. Each off-vocabulary value must be
  --    refused, and refused specifically by a CHECK (SQLSTATE 23514) -- not by some
  --    coincidental error. `wildbrain_dam`, `wildbrain:dam`, `wildbrain_2` and the case
  --    variants prove the chosen shape is an exact plain value, not a prefix and not a
  --    namespace pattern; `warner` and `warner:` prove the pre-existing Warner pattern
  --    was not loosened into a bare-value or empty-namespace form.
  foreach v_value in array v_refused loop
    v_i := v_i + 1;
    v_refused_ok := false;
    begin
      insert into source_resolution_vocabulary_probe
        (source_system, entity_kind, source_id, resolution_status)
      values (v_value, 'character', 'probe-' || v_i::text, 'unresolved');
    exception when others then
      v_state := sqlstate;
      if v_state <> '23514' then
        raise exception 'issue #2147: off-vocabulary source_system % was refused with SQLSTATE % instead of a check violation', v_value, v_state;
      end if;
      v_refused_ok := true;
    end;
    if not v_refused_ok then
      raise exception 'issue #2147: off-vocabulary source_system % was ACCEPTED by the durable resolution vocabulary; the constraint is not a vocabulary', v_value;
    end if;
  end loop;

  -- 5. Nothing landed behind a refusal: the accepted rows are still the only rows.
  select count(*) into v_count from source_resolution_vocabulary_probe;
  if v_count <> array_length(v_accepted, 1) then
    raise exception 'issue #2147: the probe holds % row(s) after the refusal pass, expected %', v_count, array_length(v_accepted, 1);
  end if;

  -- NO EXPLICIT DROP. `on commit drop` above already destroys the probe when the apply
  -- transaction commits, so a `drop table` here would be redundant -- and the object
  -- collision extractor (scripts/check-pr-object-collisions.mjs) deliberately exempts
  -- `create temporary table` from its keys but not `drop table`, so spelling the drop
  -- out emits a scratch name as a claimed object. Leaving it to `on commit drop` is
  -- both the smaller statement and the honest one: a per-transaction scratch relation
  -- is not an object this claim owns.
end;
$verify$;
