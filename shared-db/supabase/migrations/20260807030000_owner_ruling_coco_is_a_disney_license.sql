-- Apply Albert Hazan's owner ruling of 2026-08-06: "Coco IS a Disney license."
--
-- Re-parents exactly ONE row: core.property COCO moves from licensor
-- `DTR - NO LICENSE` (ZZ) to `DISNEY` (DY). Nothing else in the database is touched.
--
-- AUTHORITY
-- ---------
-- The ruling is recorded in AGENTS.md section 6.10 ruling 1 and was re-approved by Albert
-- on 2026-08-07 as "Option 2" of
-- docs/verification/disney-licensor-identity-20260807/README.md section 6.
-- AGENTS.md section 6.6 rule 4(b) names this exact route as the ONLY compliant way to
-- repair a wrong parent while the DB Data Admin curation path is unbuilt: a shared-db
-- migration, branch + PR + preview-first, recording a named human's decision. A migration
-- that encodes a named human's decision IS hand curation; it is not the "inferred from
-- product data" thing that AGENTS.md section 6.6 bans.
--
-- ============================================================================
-- READ THIS FIRST: THIS CHANGE IS NOT DURABLE, AND THE REPO CURRENTLY SAYS IT IS
-- ============================================================================
-- AGENTS.md section 6.6 rule 5 states that migration `20260802170000` is "the migration
-- that stops plm.import_master_data force-setting core.property.licensor_id".
-- THAT SENTENCE IS WRONG. Verified against the file itself on 2026-08-07: its own
-- "WHAT DELIBERATELY DOES NOT CHANGE" header block (lines 34-39) reads
--
--     "The property UPDATE still sets `licensor_id = parent_core_licensor_id`. Whether
--      our curated parentage should outrank DesignFlow PLM's is an owner decision nobody
--      has made."
--
-- `20260802170000` preserves curated `status` ONLY. It does NOT preserve parentage.
-- There is therefore NO parentage-durability migration anywhere in this repository --
-- neither merged nor held. The re-parent below WILL be silently reverted by the next
-- SUCCESSFUL `plm.import_master_data()` run, on preview and production alike, because
-- that function unconditionally re-points every matched property at whatever parent
-- DesignFlow PLM reports.
--
-- Why the change is still correct to make now, rather than blocked:
--   * The PLM master-data lane has not succeeded since 2026-07-08 (AGENTS.md 6.4 / 6.10-A),
--     which is why every core.property row still carries updated_at 2026-07-08. The
--     COCO row measured on production on 2026-08-07 carries exactly that timestamp.
--     The revert risk is real but currently dormant.
--   * AGENTS.md section 6.6 states that for licensor->property parentage the CURATED value
--     wins, and that this is not an agent's judgement call: ColdLion transmits no
--     licensor->property relationship at all, so there is nothing upstream to defer to.
--   * The ruling record written below survives a revert even if the parent edge does not,
--     so the decision is not lost.
--
-- ACTION REQUIRED OF A HUMAN, NOT SATISFIED BY THIS MIGRATION: parentage durability must
-- be built (a forward change to plm.import_master_data that preserves curated
-- licensor_id) before the PLM lane is repaired, or this re-parent and every other curated
-- parent edge silently reverts the moment the lane comes back. This is escalated, not
-- assumed away. Do NOT "fix" it by weakening or deleting this note.
--
-- THE NAMESPACE TRAP -- WHY EVERY MATCH BELOW IS BY UUID
-- -----------------------------------------------------
-- core.property COCO has code `CC`. core.licensor COCA COLA ALSO has code `CC`. Property
-- codes and licensor codes are separate namespaces and they collide on exactly this
-- string. Albert's ruling 2 of 2026-08-06 (AGENTS.md 6.10) is explicit: "The CODE alone is
-- meaningless -- the DESCRIPTION decides the licensor." Accordingly every lookup in this
-- migration is BY PRIMARY KEY UUID, and `code` is only ever ASSERTED, never searched on.
-- Do not "simplify" this into a `where code = 'CC'` lookup.
--
-- PRODUCTION STATE MEASURED 2026-08-07, ref qsllyeztdwjgirsysgai, read-only, count(*)
-- ----------------------------------------------------------------------------------
--   core.licensor  DY  DISNEY            active  7d141a6f-e229-46a2-b3f5-0ba0c97dd820
--   core.licensor  ZZ  DTR - NO LICENSE  active  80276015-a751-4438-8c25-759c8dd005b2
--   core.licensor  CC  COCA COLA         active  c70e095c-2baf-404e-a2a3-c198a259a3e6  <- NOT the target
--   core.property  CC  COCO              active  5c03fc46-5a02-4da1-bcac-8969e74bbd8f  -> ZZ
--
--   Coca-Cola's OWN properties are `CCC` COCA COLA and `CCZ` COCA COLA ZERO, both already
--   under licensor CC. They are NOT under ZZ and are NOT touched by anything below.
--   There is no other property named like COCO or COCA anywhere in core.property.
--
-- BLAST RADIUS, MEASURED -- AND A CORRECTION TO THE EVIDENCE DOC
-- -------------------------------------------------------------
--   public.assets on property COCO ......... 15
--   ... of which licensor_id = DY (DISNEY) .. 15   <-- ALL of them, already
--   ... of which licensor_id = ZZ ...........  0
--   ... of which licensor_id is null ........  0
--   public.style_groups on property COCO ....  0
--   pim.product on property COCO ............  0
--
-- docs/verification/disney-licensor-identity-20260807/README.md section 5 predicted that
-- "15 public.assets rows change which licensor they roll up to (ZZ -> DY)" and that their
-- own licensor_id "may also need updating". MEASURED: it does not. All 15 asset rows
-- ALREADY carry licensor_id = DY on their own column, while their property pointed at ZZ.
-- Those rows were self-contradictory. This migration REMOVES that contradiction rather
-- than creating work: after it runs, asset.licensor_id and asset.property.licensor_id
-- agree for all 15. NO public.assets row is written by this migration. Zero rows change
-- in any table other than core.property (plus one audit row, see below).
--
-- THE UNIQUE-KEY CHECK THAT COULD HAVE FAILED
-- -------------------------------------------
-- core.property is keyed `UNIQUE NULLS NOT DISTINCT (licensor_id, code)`
-- (constraint property_licensor_id_code_key). Moving COCO to DY would violate it if a
-- property with code `CC` already existed under DY. Measured 2026-08-07: zero such rows.
-- The migration re-checks this at run time and aborts loudly rather than letting Postgres
-- surface a bare constraint-violation with no explanation.
--
-- REVERSAL
-- --------
-- One statement. The prior licensor UUID is stored in the row's own metadata under
-- `owner_ruling.previous_licensor_id`, so a reverser does not need this file:
--   update core.property set licensor_id = '80276015-a751-4438-8c25-759c8dd005b2'
--   where id = '5c03fc46-5a02-4da1-bcac-8969e74bbd8f';
-- Nothing is deleted, nothing cascades, no schema object is created or dropped.
--
-- IDEMPOTENCE
-- -----------
-- Safe to re-run. If COCO is already under DISNEY the migration says so with an explicit
-- NOTICE and changes nothing. It never passes quietly: every exit path either updates a
-- row or raises a NOTICE naming the reason.

do $coco$
declare
  -- Matched BY UUID ONLY. See "THE NAMESPACE TRAP" above.
  c_property_coco  constant uuid := '5c03fc46-5a02-4da1-bcac-8969e74bbd8f';
  c_licensor_disney constant uuid := '7d141a6f-e229-46a2-b3f5-0ba0c97dd820';
  c_licensor_nolic constant uuid := '80276015-a751-4438-8c25-759c8dd005b2';

  -- TIMEZONE. Pinned to midday UTC on the DATE OF THE RULING (2026-08-06), not now(),
  -- and deliberately not midnight. This server runs America/New_York (verified live
  -- 2026-08-07: current_setting('TimeZone') = 'America/New_York'), UTC-4 in August, so
  -- '2026-08-06 00:00:00+00' would read back as 2026-08-05 through ::date for any
  -- server-local reader and the audit trail would state the wrong day. Midday UTC =
  -- 08:00 America/New_York, so the date reads 2026-08-06 in BOTH zones. Same trap and
  -- same fix as 20260731220000 and 20260802171000.
  c_ruled_at       constant timestamptz := timestamptz '2026-08-06 12:00:00+00';
  c_ruler          constant text := 'Albert Hazan (owner)';

  v_prop_name      text;
  v_prop_code      text;
  v_current_lic    uuid;
  v_disney_code    text;
  v_disney_name    text;
  v_conflict       uuid;
  v_updated        integer;
begin
  -- ---------------------------------------------------------------------
  -- Precondition 1: the DISNEY licensor exists, by UUID, and really is Disney.
  -- The code/name are ASSERTED, never used to find the row.
  -- ---------------------------------------------------------------------
  select code, name into v_disney_code, v_disney_name
  from core.licensor where id = c_licensor_disney;

  if v_disney_code is null then
    raise exception
      'Coco ruling aborted: core.licensor % (expected DISNEY / DY) does not exist. '
      'Re-verify the target database before proceeding -- do not weaken this check.',
      c_licensor_disney;
  end if;

  if v_disney_code <> 'DY' or v_disney_name <> 'DISNEY' then
    raise exception
      'Coco ruling aborted: core.licensor % is (code=%, name=%), not the expected '
      '(code=DY, name=DISNEY). The canonical Disney identity has moved; re-verify before '
      're-parenting anything.',
      c_licensor_disney, v_disney_code, v_disney_name;
  end if;

  -- ---------------------------------------------------------------------
  -- Precondition 2: exactly one COCO property, by UUID, and it really is COCO.
  -- Asserting the NAME is the whole point: Albert's ruling 2 of 2026-08-06 says the
  -- description decides, and `CC` alone cannot distinguish COCO from COCA COLA.
  -- ---------------------------------------------------------------------
  select name, code, licensor_id into v_prop_name, v_prop_code, v_current_lic
  from core.property where id = c_property_coco;

  if v_prop_name is null then
    raise exception
      'Coco ruling aborted: core.property % (expected COCO) does not exist. '
      'Re-verify the target database before proceeding -- do not weaken this check.',
      c_property_coco;
  end if;

  if v_prop_name <> 'COCO' then
    raise exception
      'Coco ruling aborted: core.property % is named "%", not "COCO". Refusing to '
      're-parent it. NOTE the namespace collision this guard exists for: property code '
      '"CC" is COCO but licensor code "CC" is COCA COLA. Moving a Coca-Cola row under '
      'DISNEY would be a licensing error, not a typo.',
      c_property_coco, v_prop_name;
  end if;

  if v_prop_code <> 'CC' then
    raise exception
      'Coco ruling aborted: core.property % ("COCO") has code "%", expected "CC". '
      'The row has been edited since this migration was written; re-verify before acting.',
      c_property_coco, v_prop_code;
  end if;

  -- ---------------------------------------------------------------------
  -- IDEMPOTENCE. Already applied -> say so out loud and stop. Never a silent no-op.
  --
  -- THIS `return` SITS BEFORE THE AUDIT BLOCK AT THE BOTTOM, AND THAT IS INTENDED.
  -- An already-correct row therefore does NOT get a core.taxonomy_owner_ruling row
  -- written by this run. Reviewed 2026-08-07 and deliberately left as is, because moving
  -- the audit block earlier could not achieve the backfill it looks like it would:
  -- core.taxonomy_owner_ruling does not exist on production (20260802171000 is held by
  -- AGENTS.md 6.5), and by the time it IS created there, THIS migration will already be
  -- recorded in the ledger and will never re-run whatever its body says. The backfill can
  -- only ever be done by a SEPARATE forward migration authored after the held one is
  -- promoted. Reordering here would buy nothing and would make the already-applied path
  -- do work its NOTICE says it is not doing.
  -- ---------------------------------------------------------------------
  if v_current_lic = c_licensor_disney then
    raise notice
      'Coco ruling: ALREADY APPLIED. core.property COCO (%) is already parented to '
      'DISNEY (%). No row changed, and no audit row written -- see the comment above.',
      c_property_coco, c_licensor_disney;
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- Precondition 3: it is where we think it is. If COCO has drifted to some THIRD
  -- licensor since 2026-08-07, a human must look before we overwrite that.
  -- ---------------------------------------------------------------------
  if v_current_lic is distinct from c_licensor_nolic then
    raise exception
      'Coco ruling aborted: core.property COCO is currently parented to licensor %, '
      'which is neither DTR - NO LICENSE (%) nor DISNEY (%). Somebody or something has '
      're-parented it since this migration was authored. A human must decide; this '
      'migration will not overwrite an unexpected parent.',
      v_current_lic, c_licensor_nolic, c_licensor_disney;
  end if;

  -- ---------------------------------------------------------------------
  -- Precondition 4: the (licensor_id, code) unique key will not be violated.
  -- Checked explicitly so the failure explains itself instead of arriving as a bare
  -- constraint violation on property_licensor_id_code_key.
  -- ---------------------------------------------------------------------
  select id into v_conflict
  from core.property
  where licensor_id = c_licensor_disney and code = v_prop_code and id <> c_property_coco;

  if v_conflict is not null then
    raise exception
      'Coco ruling aborted: core.property % already exists under DISNEY with code "%". '
      'Re-parenting COCO would violate property_licensor_id_code_key '
      '(UNIQUE NULLS NOT DISTINCT (licensor_id, code)). The two rows must be reconciled '
      'by a human first -- this is a merge decision, not a re-parent.',
      v_conflict, v_prop_code;
  end if;

  -- ---------------------------------------------------------------------
  -- Apply the ruling. ONE ROW. Two columns are written: `licensor_id`, which IS the
  -- ruling, and `metadata`, which records the provenance and the reversal pointer.
  -- (An earlier revision of this comment said "ONE column"; that was wrong.)
  -- The previous licensor UUID is preserved in metadata so the change is reversible
  -- without reading this file, and so a later reader can tell a curated value from an
  -- imported one (which is exactly what AGENTS.md 6.6 rule 4(b) asks a migration to record).
  -- ---------------------------------------------------------------------
  update core.property
  set licensor_id = c_licensor_disney,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'owner_ruling', jsonb_build_object(
          'ruled_by',             c_ruler,
          'ruled_on',             '2026-08-06',
          'ruling',               'Coco IS a Disney license',
          'previous_licensor_id', c_licensor_nolic::text,
          'previous_licensor',    'DTR - NO LICENSE (ZZ)',
          'migration',            '20260807030000',
          'durability_warning',   'plm.import_master_data() still force-sets '
                                  'core.property.licensor_id on every matched row. This '
                                  'curated parent reverts on the next successful PLM '
                                  'master-data sync until parentage durability is built.'
        )
      )
  where id = c_property_coco
    and licensor_id is distinct from c_licensor_disney;

  get diagnostics v_updated = row_count;

  -- Belt and braces: prove the write actually landed rather than trusting that the
  -- statement ran. "It applied successfully" is not evidence in this repository.
  if v_updated <> 1 then
    raise exception
      'Coco ruling aborted: expected to update exactly 1 core.property row, updated %. '
      'The database is not in the state this migration verified moments earlier.',
      v_updated;
  end if;

  perform 1 from core.property
   where id = c_property_coco and licensor_id = c_licensor_disney;
  if not found then
    raise exception
      'Coco ruling aborted: post-update read-back shows core.property COCO is NOT '
      'parented to DISNEY. Refusing to report success.';
  end if;

  raise notice
    'Coco ruling APPLIED: core.property COCO (%) re-parented from DTR - NO LICENSE (%) '
    'to DISNEY (%). 15 public.assets rows already carried licensor_id = DISNEY and were '
    'NOT written; this change makes them self-consistent.',
    c_property_coco, c_licensor_nolic, c_licensor_disney;

  -- ---------------------------------------------------------------------
  -- Durable ruling record -- CONDITIONAL ON PURPOSE.
  --
  -- core.taxonomy_owner_ruling is created by 20260802171000, which AGENTS.md section 6.5
  -- deliberately HOLDS from production. Verified live on production 2026-08-07:
  -- to_regclass('core.taxonomy_owner_ruling') returns NULL -- the table DOES NOT EXIST
  -- there. An unconditional insert would make this migration fail on production while
  -- succeeding on preview: a promotion-time break that preview could never catch.
  --
  -- So the insert is guarded by to_regclass AND executed dynamically.
  --
  -- WHY DYNAMICALLY -- the reason corrected 2026-08-07. An earlier revision of this
  -- comment claimed a static INSERT "would fail to PARSE on a database lacking the table,
  -- guard or no guard". That reasoning is WRONG: PL/pgSQL plans an embedded SQL statement
  -- lazily, the first time execution actually reaches it, so a static INSERT inside an
  -- IF branch that is never entered would not be planned and would not fail.
  --
  -- The real reasons to keep EXECUTE are about later runs, not this one:
  --   1. Plan caching. Once the branch IS entered on a database where the table exists,
  --      the plan is cached against that relation OID for the session. Dynamic EXECUTE
  --      keeps the statement re-planned and keeps this block's behaviour dependent only
  --      on the to_regclass check that immediately precedes it.
  --   2. It keeps the guard and the statement honest as a pair: nothing about this INSERT
  --      is resolved until the guard has already said the table is there.
  -- The to_regclass guard is what actually makes this safe on production, and it stays.
  -- When the held migration is promoted, this record can be backfilled; the parent edge
  -- above is applied either way and does not depend on the audit row.
  -- ---------------------------------------------------------------------
  if to_regclass('core.taxonomy_owner_ruling') is not null then
    execute $ins$
      insert into core.taxonomy_owner_ruling (
        entity_schema, entity_table, entity_id, entity_code, entity_name,
        ruling, ruled_by, ruled_at, ruling_evidence, action_taken, open_questions
      )
      select
        'core', 'property', $1, 'CC', 'COCO',
        'Coco IS a Disney license. The property COCO must be parented to licensor '
        'DISNEY (DY), not to DTR - NO LICENSE (ZZ).',
        $2, $3,
        'Owner ruling given 2026-08-06 (AGENTS.md section 6.10 ruling 1) and re-approved '
        '2026-08-07 as Option 2 of '
        'docs/verification/disney-licensor-identity-20260807/README.md section 6. '
        'Production state measured read-only 2026-08-07 (ref qsllyeztdwjgirsysgai) with '
        'count(*): core.property COCO (code CC) parented to ZZ DTR - NO LICENSE; 15 '
        'public.assets on that property, all 15 ALREADY carrying licensor_id = DISNEY; '
        '0 style groups; 0 pim products; no competing (DISNEY, CC) property. The legacy '
        'public.properties row for Coco was already filed under Disney (DS), so this '
        'ends a self-contradiction between the two taxonomies rather than creating one.',
        'APPLIED: core.property COCO.licensor_id changed from ZZ DTR - NO LICENSE to DY '
        'DISNEY, and metadata gained the provenance/reversal record. Exactly one ROW. '
        'NOT APPLIED, deliberately: no '
        'public.assets row was written (all 15 already read DISNEY); the legacy '
        'public.licensors / public.properties tables were not touched or retired '
        '(Option 3, declined); MARVEL and STAR WARS were not re-parented under DISNEY '
        '(Option 4, declined by the owner -- ColdLion pays royalties off them being '
        'separate licensors); the 103 unattributed DTR - NO LICENSE assets, the '
        'MIRACULOUS possible misfiling, and the CREATURE / AB / BOARDERLANDS / '
        'DESTINATIONS properties were all left alone.',
        'DURABILITY IS NOT IN FORCE. plm.import_master_data() still force-sets '
        'core.property.licensor_id on every matched row, so this curated parent reverts '
        'on the next successful PLM master-data sync. Migration 20260802170000 preserves '
        'curated STATUS only -- it explicitly does NOT preserve parentage, despite '
        'AGENTS.md section 6.6 rule 5 having claimed otherwise (corrected 2026-08-07). '
        'No parentage-durability migration exists anywhere in this repository. The lane '
        'has not succeeded since 2026-07-08, which masks the exposure without fixing it. '
        'Parentage durability must be built before the PLM lane is repaired.'
      where not exists (
        select 1 from core.taxonomy_owner_ruling
        where entity_table = 'property' and entity_id = $1 and ruled_at = $3
      )
    $ins$ using c_property_coco, c_ruler, c_ruled_at;
  else
    raise notice
      'Coco ruling: core.taxonomy_owner_ruling does not exist on this database (migration '
      '20260802171000 is held from production by AGENTS.md section 6.5), so the durable '
      'ruling record was SKIPPED. The parent edge above was still applied. Backfill the '
      'ruling row when the held migration is promoted.';
  end if;
end;
$coco$;
