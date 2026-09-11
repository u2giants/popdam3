-- =====================================================================================
-- Require a non-blank namespace after the `warner:` prefix in the plm.source_resolution
-- source vocabulary.
--
-- Migration: 20260905104420_source_resolution_warner_namespace_required.sql
-- Issue:     u2giants/shared-db #2159
-- Claim:     u2giants/shared-db #2226 -- table plm.source_resolution. Nothing else.
-- derived-from: none
--
-- Depends on (exact 14-digit versions):
--   20260902024541  source_resolution_supported_home -- creates plm.source_resolution and the
--                   constraint this file narrows.
--   20260903015023  source_resolution_wildbrain_vocabulary -- the immediately preceding state
--                   of that same constraint. Every value IT accepted, except the empty-namespace
--                   Warner form this issue is about, is re-asserted below by real inserts.
--   20260813230000  wb_normalized_source_schema -- creates plm.wb_property, whose
--                   source_namespace is the namespace that goes after the colon. READ ONLY as
--                   evidence for the shape; this file neither reads nor writes it.
--
-- LOADS NO DATA. No row is inserted into plm.source_resolution by this file. u2giants/shared-db
-- is a PUBLIC repository: SCHEMA IN GIT, DATA OUT OF GIT.
--
-- -------------------------------------------------------------------------------------
-- THE DEFECT
--
-- The deployed expression admits Warner values through `source_system like 'warner:%'`.
-- In SQL, `%` matches ZERO characters, so the bare string `'warner:'` -- a Warner row whose
-- namespace is empty -- is accepted. `source_resolution_source_system_nonblank_chk` does not
-- catch it either: `btrim('warner:')` is `'warner:'`, which is not blank. The same holds for
-- every namespace made only of whitespace -- E'warner:\t', E'warner:\n', E'warner:\r',
-- E'warner:\f' and E'warner:\v' (vertical tab). Each names no source namespace, each is
-- exactly as unresolvable as the empty one, and each is refused here too.
--
-- That matters because the namespace is not decoration. plm.wb_property keys identity on
-- (source_namespace, source_id), so a Warner source ID is unique only WITHIN its namespace,
-- and 20260814233423 writes `'warner:' || p.source_namespace` into source_system precisely to
-- carry that dimension. A row spelled `warner:` therefore records a durable resolution
-- decision that names no source namespace at all: it is unresolvable back to a capture, and
-- it sorts and groups alongside genuine Warner values.
--
-- -------------------------------------------------------------------------------------
-- WHY THIS SHAPE, DERIVED AND NOT ASSUMED
--
-- The issue offers `warner:_%` as the obvious form. `_` requires exactly one character, so
-- `warner:_%` refuses `'warner:'` -- but it ACCEPTS `'warner: '` and `'warner:   '`, which are
-- namespaces made only of whitespace and are exactly as unresolvable as the empty one.
--
-- The family the namespace comes from says non-blank, not merely non-empty:
--
--   * plm.wb_property pins source_namespace by CHECK to
--     ('warner_product_catalogue','warner_art_assets') -- 20260813230000 line 22.
--   * Its four sibling landing tables (wb_franchise, wb_character_normalized,
--     wb_style_guide_normalized, and the asset table) each require
--     `btrim(source_namespace) <> ''`.
--
-- So the invariant the source side actually enforces is a NON-BLANK namespace, and that is
-- what is required here:
--
--     source_system like 'warner:%'
--       and substring(source_system from length('warner:')+1) !~ '^[[:space:]]*$'
--
-- WHY A REGEX AND NOT btrim(). An earlier draft of this file wrote
-- `btrim(substring(...)) <> ''`, and THAT DRAFT WAS WRONG. One-argument `btrim(x)` trims
-- SPACES ONLY: its defaulted second argument is the single-character set ' '. It therefore
-- still ACCEPTED E'warner:\t', E'warner:\n', E'warner:\r', E'warner:\f' and
-- E'warner:\v' -- namespaces made entirely of whitespace, every one of them as unresolvable
-- as the empty string. The guarantee this file STATES (present and non-blank) and the
-- guarantee it DELIVERED disagreed, and its own verification block could not see the gap
-- because it only ever offered ordinary spaces.
--
-- The two candidate repairs are `btrim(x, E' \t\n\r\f\v') <> ''` and the regex
-- above. BOTH are correct: PostgreSQL's E'' strings do recognise \v as the vertical tab --
-- checked, not assumed, `ascii(E'\v')` is 11, identical to `ascii(E'\x0B')` -- so the
-- explicit trim set really does cover all five characters. The regex is used because it states
-- the condition being tested ("the namespace is not entirely whitespace") in a single reading,
-- and because it names the whitespace set by its POSIX class rather than re-listing five
-- escapes that a later edit could shorten by one without anything noticing. Silently covering
-- fewer characters than intended is precisely the defect being repaired here, so the form that
-- cannot be quietly under-specified is preferred.
--
-- The two forms are provably equivalent over the values at issue. PostgreSQL's POSIX class
-- [[:space:]] is exactly {space, \t, \n, \v, \f, \r}, so
-- `x !~ '^[[:space:]]*$'` is false precisely when every character of x belongs to that set --
-- the empty string included -- which is the same condition as `btrim(x, <that same set>) = ''`.
-- Both are IMMUTABLE, so both are legal in a CHECK. Any value with at least one non-whitespace
-- character passes either form, and the verification block below exercises all five whitespace
-- characters individually, doubled and mixed, on BOTH sides of the accept/refuse line.
--
-- This is deliberately NOT a pin to the two literal namespaces plm.wb_property currently
-- allows. The vocabulary comment has always described this side as `warner:<source_namespace>`
-- for an OPEN set of namespaces, and pinning two literals here would silently couple this
-- constraint to a CHECK on another table that is not in this claim. Requiring a non-blank
-- namespace closes the hole the issue names and nothing else. `warner:x` is still accepted,
-- and it is proved accepted below.
--
-- NO OTHER VALUE HAS THE SAME HOLE. Every other member of the vocabulary is an exact literal
-- in an `IN` list -- `paramount`, `nbcu`, `disney_opa`, `disney_dcpvault`,
-- `lucasfilm_dcpvault`, `marvel_dcpvault`, `twentieth_century_dcpvault`, `wildbrain`. There is
-- exactly one LIKE pattern in the expression, and it is the Warner one. A zero-length-wildcard
-- hole needs a wildcard, so no other value can carry one.
--
-- -------------------------------------------------------------------------------------
-- NO EXISTING ROW IS INVALIDATED
--
-- Checked read-only against production (project qsllyeztdwjgirsysgai, proved with
-- get_project_url immediately before the read) while authoring this file:
-- plm.source_resolution holds 0 rows and 0 distinct source_system values, so 0 rows carry the
-- empty-namespace form. That is a point-in-time read and is NOT what this migration relies on.
-- The ALTER TABLE ... ADD CONSTRAINT below is a VALIDATING add: PostgreSQL scans every existing
-- row as part of it, and the apply fails loudly with SQLSTATE 23514 naming
-- `source_resolution_source_system_supported_chk` if even one row would be invalidated. There
-- is no NOT VALID and no exclusion clause, so a row that appears between now and the apply
-- cannot be silently stranded -- it stops the migration, which is the data finding the issue
-- asks for.
--
-- NARROWED ON PURPOSE, AND ONLY HERE. This is a deliberate narrowing of exactly one form. Every
-- other value the previous expression accepted is re-asserted below by real inserts, so an
-- accidental wider narrowing cannot pass.
-- =====================================================================================

alter table plm.source_resolution
  drop constraint if exists source_resolution_source_system_supported_chk;

alter table plm.source_resolution
  add constraint source_resolution_source_system_supported_chk check (
    source_system in (
      'paramount','nbcu','disney_opa','disney_dcpvault','lucasfilm_dcpvault',
      'marvel_dcpvault','twentieth_century_dcpvault','wildbrain'
    )
    or (
      source_system like 'warner:%'
      and substring(source_system from length('warner:') + 1) !~ '^[[:space:]]*$'
    )
  );

comment on column plm.source_resolution.source_system is
  'Durable source vocabulary. A bare licensor token where the licensor has one portal and '
  'one ID space (paramount, nbcu, wildbrain); a licensor_portal token where either side is '
  'shared (disney_opa, disney_dcpvault, lucasfilm_dcpvault, marvel_dcpvault, '
  'twentieth_century_dcpvault); and warner:<source_namespace>, because a Warner source ID is '
  'unique only within its portal namespace. The Warner namespace must be present and '
  'non-blank: warner: with an empty or whitespace-only namespace is refused, because it names '
  'no source namespace and cannot be resolved back to a capture. Pinned by '
  'source_resolution_source_system_supported_chk.';

-- =====================================================================================
-- Self-verification.
--
-- BEHAVIOUR, NOT TEXT. Matching a substring of pg_get_constraintdef would pass for a
-- constraint that accepts everything and for one left NOT VALID, so the vocabulary is proved
-- by REAL INSERTS raising a REAL SQLSTATE.
--
-- THE PROBE IS A LIKE-COPY, NOT THE DURABLE TABLE. The migration verification cost guard
-- (scripts/check-migration-verify-cost.mjs, issue #1285) refuses a verification block that
-- names a plm object in a read-or-write context, and it is right to: a bounded probe must not
-- put a row, however briefly, into a governed durable-decision table inside the apply
-- transaction. `create temporary table ... (like ... including constraints including defaults)`
-- copies the CHECK constraints AS THE CATALOGUE HOLDS THEM at this instant, under their own
-- names, so the expressions exercised below are the deployed expressions. DEFAULTS are
-- included because two NOT NULL timestamp columns are only satisfiable through their defaults.
-- The copy is proved complete before it is trusted. The temporary table is ON COMMIT DROP.
--
-- A NOT VALID constraint would still reject new inserts, so behaviour alone cannot see it.
-- convalidated is therefore pinned in the catalogue alongside the constraint's identity.
--
-- MUTATION TEST. A narrowing block that always passes is the failure mode here, so step 0
-- proves the probe can tell the two expressions apart: it asserts that every value this file
-- newly refuses WAS accepted by the previous expression, restated literally. If the old
-- expression rejected them the block stops -- which would mean these probes were never testing
-- this change at all.
-- =====================================================================================
do $verify$
declare
  v_real_checks   integer;
  v_probe_checks  integer;
  v_count         integer;
  -- Everything 20260903015023 accepted, MINUS the empty-namespace Warner form, PLUS an
  -- arbitrary namespace proving the Warner side is still an open set.
  v_accepted      text[] := array[
    'paramount','nbcu','disney_opa','disney_dcpvault','lucasfilm_dcpvault',
    'marvel_dcpvault','twentieth_century_dcpvault','wildbrain',
    'warner:warner_product_catalogue','warner:warner_art_assets','warner:x',
    'warner:a b','warner: leading-space-is-still-a-namespace',
    -- Namespaces that CONTAIN whitespace but are not made ONLY of it -- one per whitespace
    -- character, leading, trailing and mixed. These prove the widened test did not over-narrow:
    -- it refuses a namespace made only of whitespace, never one that merely has whitespace in
    -- or around it.
    E'warner:\tx', E'warner:x\t', E'warner:\nx', E'warner:\r\nx',
    E'warner:\fx', E'warner:\vx', E'warner:v',
    E'warner: \t\n\r\f\v x'
  ];
  -- The three forms this file newly refuses. Each was accepted before it.
  --
  -- ALL FIVE whitespace characters -- space, tab, newline, carriage return, form feed and
  -- vertical tab -- alone, doubled and mixed, NOT just ordinary spaces. The space-only cases
  -- were the only ones the first draft of this file exercised, which is exactly why its
  -- one-argument btrim() defect survived its own verification block.
  v_newly_refused text[] := array[
    'warner:', 'warner: ', 'warner:   ',
    E'warner:\t', E'warner:\t\t',
    E'warner:\n', E'warner:\n\n',
    E'warner:\r', E'warner:\r\n',
    E'warner:\f', E'warner:\f\f',
    E'warner:\v', E'warner:\v\v',
    E'warner: \t\n\r\f\v'
  ];
  -- Off-vocabulary values that were already refused and must stay refused.
  v_still_refused text[] := array[
    'warner','wb','WARNER:abc','Warner:art','xwarner:abc','warner_art_assets',
    'wildbrain_dam','wildbrain:dam','WildBrain','disney','sega',
    'no_such_source_system'
  ];
  v_value         text;
  v_i             integer := 0;
  v_refused_ok    boolean;
  v_state         text;
begin
  -- 0. MUTATION TEST. The previous expression, restated literally, must ACCEPT every value
  --    this migration newly refuses. Otherwise the refusal pass below proves nothing.
  foreach v_value in array v_newly_refused loop
    if not (
      v_value in (
        'paramount','nbcu','disney_opa','disney_dcpvault','lucasfilm_dcpvault',
        'marvel_dcpvault','twentieth_century_dcpvault','wildbrain'
      ) or v_value like 'warner:%'
    ) then
      raise exception 'issue #2159: % is listed as newly refused, but the PREVIOUS vocabulary expression rejected it too; this migration would not be narrowing anything and the probes below would prove nothing', v_value;
    end if;
  end loop;

  -- 1. The constraint's identity, kind, table, validity and non-deferrability.
  select count(*) into v_count
  from pg_constraint
  where conrelid = 'plm.source_resolution'::regclass
    and conname = 'source_resolution_source_system_supported_chk'
    and contype = 'c'
    and convalidated
    and not condeferrable;
  if v_count <> 1 then
    raise exception 'issue #2159: expected exactly 1 validated, non-deferrable CHECK named source_resolution_source_system_supported_chk on the durable resolution table, found %', v_count;
  end if;

  -- 2. A complete copy of the deployed CHECK set, or the probes below prove nothing.
  select count(*) into v_real_checks
  from pg_constraint
  where conrelid = 'plm.source_resolution'::regclass and contype = 'c';

  create temporary table source_resolution_namespace_probe
    (like plm.source_resolution including constraints including defaults) on commit drop;

  select count(*) into v_probe_checks
  from pg_constraint
  where conrelid = 'source_resolution_namespace_probe'::regclass and contype = 'c';
  if v_probe_checks <> v_real_checks then
    raise exception 'issue #2159: the probe copy carries % CHECK constraint(s) but the durable resolution table carries %; the probes below would not be testing the deployed rules', v_probe_checks, v_real_checks;
  end if;

  select count(*) into v_count
  from pg_constraint
  where conrelid = 'source_resolution_namespace_probe'::regclass
    and conname = 'source_resolution_source_system_supported_chk'
    and contype = 'c';
  if v_count <> 1 then
    raise exception 'issue #2159: the probe copy does not carry the source-system vocabulary constraint under test (found % of it)', v_count;
  end if;

  -- 3. EVERY legitimate value must still be accepted -- the whole plain vocabulary, both real
  --    Warner namespaces, and arbitrary non-blank namespaces. A wider narrowing cannot pass.
  foreach v_value in array v_accepted loop
    v_i := v_i + 1;
    begin
      insert into source_resolution_namespace_probe
        (source_system, entity_kind, source_id, resolution_status)
      values (v_value, 'character', 'probe-' || v_i::text, 'unresolved');
    exception when others then
      raise exception 'issue #2159: source_system % must still be accepted by the durable resolution vocabulary but was refused with SQLSTATE %; this narrowing went further than the empty Warner namespace', v_value, sqlstate;
    end;
  end loop;

  select count(*) into v_count from source_resolution_namespace_probe;
  if v_count <> array_length(v_accepted, 1) then
    raise exception 'issue #2159: % accepted vocabulary value(s) were offered but % row(s) landed in the probe', array_length(v_accepted, 1), v_count;
  end if;

  -- 4. The empty and whitespace-only Warner namespaces must now be refused, and refused
  --    specifically by a CHECK (SQLSTATE 23514) rather than by some coincidental error.
  foreach v_value in array v_newly_refused loop
    v_i := v_i + 1;
    v_refused_ok := false;
    begin
      insert into source_resolution_namespace_probe
        (source_system, entity_kind, source_id, resolution_status)
      values (v_value, 'character', 'probe-' || v_i::text, 'unresolved');
    exception when others then
      v_state := sqlstate;
      if v_state <> '23514' then
        raise exception 'issue #2159: Warner value % with a blank namespace was refused with SQLSTATE % instead of a check violation', v_value, v_state;
      end if;
      v_refused_ok := true;
    end;
    if not v_refused_ok then
      raise exception 'issue #2159: Warner value % with a blank namespace was ACCEPTED; the empty-namespace hole this issue is about is still open', v_value;
    end if;
  end loop;

  -- 5. The vocabulary must still be a vocabulary: everything off it stays off it.
  foreach v_value in array v_still_refused loop
    v_i := v_i + 1;
    v_refused_ok := false;
    begin
      insert into source_resolution_namespace_probe
        (source_system, entity_kind, source_id, resolution_status)
      values (v_value, 'character', 'probe-' || v_i::text, 'unresolved');
    exception when others then
      v_state := sqlstate;
      if v_state <> '23514' then
        raise exception 'issue #2159: off-vocabulary source_system % was refused with SQLSTATE % instead of a check violation', v_value, v_state;
      end if;
      v_refused_ok := true;
    end;
    if not v_refused_ok then
      raise exception 'issue #2159: off-vocabulary source_system % was ACCEPTED by the durable resolution vocabulary; the constraint is not a vocabulary', v_value;
    end if;
  end loop;

  -- 6. Nothing landed behind a refusal: the accepted rows are still the only rows.
  select count(*) into v_count from source_resolution_namespace_probe;
  if v_count <> array_length(v_accepted, 1) then
    raise exception 'issue #2159: the probe holds % row(s) after the refusal passes, expected %', v_count, array_length(v_accepted, 1);
  end if;

  -- NO EXPLICIT DROP. `on commit drop` destroys the probe when the apply transaction commits;
  -- spelling a `drop table` out would emit a scratch name as a claimed object to
  -- scripts/check-pr-object-collisions.mjs.
end;
$verify$;
