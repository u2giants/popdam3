-- derived-from: none
--
-- Issue #2132 -- core.property cannot hold a SECOND code-less property, so the Warner
-- property "Mortal Kombat II (2026)" cannot be created at all.
--
-- Owner instruction, 2026-09-02: if the Warner Submissions site has a property, our
-- system needs it too, or submissions cannot be filed correctly.
--
-- ===========================================================================
-- PART 1 -- WHY THE UNIQUENESS CONSTRAINT HAS TO BE RELAXED FIRST
-- ===========================================================================
-- core.property has carried, since 20260621150815_app_core.sql:
--
--     unique nulls not distinct (licensor_id, code)      -- property_licensor_id_code_key
--
-- `code` is nullable, but NULLS NOT DISTINCT means two NULLs compare EQUAL, so a
-- licensor may hold AT MOST ONE code-less property. There are zero code-less rows in
-- the table today, which is the only reason nobody has hit this yet.
--
-- The codes on core.property are DesignFlow PLM merch-group codes. A property that
-- exists in a licensor portal but has not yet reached DesignFlow PLM legitimately has
-- no code, and Warner alone has more than one such property (Mortal Kombat (2021) and
-- Mortal Kombat Core: Video Game are in the same position and are deliberately NOT
-- created here -- their source evidence has not been checked to the standard below).
-- One NULL slot per licensor is therefore not enough, now or later.
--
-- This is also a LATENT IMPORT DEFECT, not only a blocker for this one row.
-- plm.import_master_data (20260624173000_plm_master_data_import.sql, lines 455-560)
-- matches an incoming property by source ref, then by code, then by case-insensitive
-- name, and INSERTs when none of the three match. Its insert is wrapped in
-- `exception when unique_violation`, whose handler re-looks-up by code or by name.
-- For a SECOND code-less property under the same licensor that handler finds nothing
-- (the code is NULL and the name genuinely differs), leaves core_property_id NULL, and
-- the taxonomy_source_ref insert that follows then fails on its NOT NULL entity_id.
-- The constraint converts an ordinary condition into an import abort.
--
-- WHAT PART 1 CHANGES, AND WHAT IT DELIBERATELY DOES NOT:
--   * The constraint KEEPS ITS NAME, property_licensor_id_code_key, so every existing
--     reference to it -- including the explanatory guard in
--     20260807030000_owner_ruling_coco_is_a_disney_license.sql -- still resolves.
--   * Non-NULL codes stay unique per licensor EXACTLY as today. Only the meaning of a
--     NULL code changes: "not yet known" stops behaving like a value.
--   * Nothing is dropped, no column changes type, and no row is touched by Part 1.
--   * It is idempotent: re-running leaves exactly the same end state and cannot fail on
--     a database where the constraint is already NULLS DISTINCT. If the constraint is
--     missing entirely it RAISES rather than inventing one -- an absent constraint means
--     this is not the database this migration was written for, and silently creating
--     uniqueness on an unverified table is worse than stopping.
--
-- ===========================================================================
-- PART 2 AND 3 -- THE CURATED ROW, AND WHY IT IS CURATED RATHER THAN IMPORTED
-- ===========================================================================
-- AGENTS.md section 6.4 (owner ruling 2026-08-03, docs/owner-rulings.md): the
-- DesignFlow PLM Master Data import is TRANSITIONAL, and curated Master Data OUTRANKS
-- it. A curated row must be recognisable as curated, or the next catch-up pull cannot
-- tell a deliberate human decision from an empty field.
--
-- The row below is therefore marked curated in metadata and deliberately does NOT
-- carry `plm_import_source`. Everything the importer writes carries that key; its
-- absence is the machine-readable statement that this row was not import-created.
-- BOTH paths below -- a fresh insert, and reuse of an existing same-name row --
-- converge on that one metadata end state, and the block at the end of this file
-- refuses the apply unless that end state is actually present.
--
-- CONVERGENCE IS ALREADY HANDLED -- no duplicate is created when DesignFlow PLM
-- eventually publishes this property. The importer's third matcher is a
-- case-insensitive name match under the same licensor, which finds this row, and its
-- update path uses `code = coalesce(v_source_code, code)`, which fills the code in.
--
-- THE SOURCE EVIDENCE (and nothing else -- AGENTS.md section 6.16: licence contracts
-- are not a data source and are not cited here).
-- Both Warner source extracts in plm.wb_property carry this property under ONE shared
-- Warner source identity, e01f0a1f-0ca6-42ac-8e9d-8e5e50421631:
--
--     plm.wb_property fce7424a-f157-40df-8be9-7c8fb321da5c
--         source_namespace = warner_product_catalogue   (Submissions)
--     plm.wb_property 9dd513ee-6cd8-4990-81a4-f999a6ce5831
--         source_namespace = warner_art_assets          (Creative)
--
-- A source identity shared across the two namespaces is DIRECT source evidence of
-- Creative-to-Submissions equivalence. It is not a name-similarity inference. Those
-- three identifiers are not merely recorded in metadata: the block below looks them up
-- in plm.wb_property first and RAISES unless they are exactly what is stated here, so a
-- wrong or stale identity cannot be written into a curated row silently.
--
-- Under licensor WARNER BROS the only Mortal Kombat row today is code MB
-- "MORTAL KOMBAT" (c0873079-36a4-4ab1-9aa0-1e8bedc6b274), the franchise-level row from
-- the 2026-06-25 DesignFlow PLM import. Warner's own catalogue already separates dated
-- titles at this level -- THE NUN 2018 versus THE NUN 2 2023, IT 2017 versus
-- IT CHAPTER TWO 2019 -- so a separate row is the established shape here.
--
-- EXACTLY ONE core.taxonomy_source_ref ROW IS CREATED. This is deliberate and must not
-- be "corrected" by adding a warner_art_assets twin:
--   * The five existing Warner refs (issue #640) key on the WARNER SOURCE IDENTITY,
--     not on the plm.wb_property primary key, so one ref already covers both
--     namespaces.
--   * core.taxonomy_source_ref is unique on (source_system, source_table, source_id),
--     and no property anywhere carries a warner_art_assets ref.
--   * The Creative side is tracked separately in
--     plm.creative_submission_property_resolution.
--
-- ===========================================================================
-- THE LICENSING WRITE GUARD -- WHY THE ROW IS CREATED IN TWO STEPS
-- ===========================================================================
-- core.property carries trigger property_licensing_write_guard
-- (20260817124545_licensing_write_authority_guard.sql, extended to DELETE by
-- 20260820183334). It refuses ANY canonical licensing write unless a
-- plm.licensing_write_authorization row, created in the SAME transaction and backend,
-- covers EXACTLY the columns the write changes. An INSERT into core.property always
-- counts as changing {licensor_id, name, code, status}.
--
-- The reviewed-create authorization kind, licensing_review_create, additionally refuses
-- an INSERT whose status is anything but 'potential'. A single insert straight to
-- 'active' is therefore impossible by design, and the promotion to 'active' is a second,
-- separately authorized, status-only write under the coldlion_status kind. That is the
-- shape established by 20260825050407_coldlion_paramount_five_approved_gate.sql and it
-- is followed here unchanged: the guard is neither disabled, widened, nor bypassed.
--
-- Each authorization is single-use -- the trigger stamps consumed_at as it accepts the
-- write -- so one is created immediately before each guarded statement, and only when
-- that statement is actually going to run. A re-apply with nothing to change creates no
-- authorization at all and leaves none outstanding.
--
-- Metadata is NOT a guarded column, so the metadata convergence write on the reuse path
-- needs no authorization and takes none.
--
-- Every statement below is idempotent and additive. Nothing is dropped or deleted.

-- ---------------------------------------------------------------------------
-- 1. Relax property_licensor_id_code_key to NULLS DISTINCT, keeping its name
-- ---------------------------------------------------------------------------
-- The guard runs FIRST and on its own. If the constraint this migration was written
-- against is not on the table, stop: creating uniqueness on an unverified table is far
-- worse than refusing to run.
do $guard_codeless_uniqueness$
declare
  v_nulls_not_distinct boolean;
begin
  select i.indnullsnotdistinct
    into v_nulls_not_distinct
  from pg_constraint c
  join pg_index i on i.indexrelid = c.conindid
  where c.conrelid = 'core.property'::regclass
    and c.conname = 'property_licensor_id_code_key'
    and c.contype = 'u';

  if v_nulls_not_distinct is null then
    raise exception
      'Issue #2132 cannot be applied: unique constraint property_licensor_id_code_key '
      'was not found on core.property. Do not weaken this check and do not create the '
      'constraint here -- re-verify the target database before proceeding.';
  end if;

  if not v_nulls_not_distinct then
    raise notice
      'Issue #2132: property_licensor_id_code_key is already NULLS DISTINCT. The two '
      'statements below re-state the same constraint, so the end state is unchanged.';
  end if;
end;
$guard_codeless_uniqueness$;

-- The swap itself is written as PLAIN, TOP-LEVEL DDL rather than conditional DDL inside
-- the block above, and that is deliberate. Post-apply catalog verification derives what
-- to go and look at by lexing this file; DDL hidden inside a dollar-quoted body is
-- invisible to it, and a migration from which no catalog object can be derived fails
-- enforcing mode because a green result would prove nothing. Written this way,
-- core.property is a derived target and the apply is actually checked.
--
-- Re-running is safe: the constraint exists in both states, so the drop always finds it
-- and the add always leaves the table in exactly one end state -- NULLS DISTINCT. It
-- cannot fail on an already-relaxed database; it re-states the same constraint.
alter table core.property drop constraint property_licensor_id_code_key;

alter table core.property
  add constraint property_licensor_id_code_key
  unique nulls distinct (licensor_id, code);

comment on constraint property_licensor_id_code_key on core.property is
  'Per licensor, a non-NULL property code is unique. NULLS DISTINCT since issue #2132: '
  'a NULL code means "not yet published by DesignFlow PLM", which is a normal condition '
  'that more than one property per licensor can be in at the same time. Before #2132 '
  'this was NULLS NOT DISTINCT, which allowed exactly one code-less property per '
  'licensor and aborted plm.import_master_data on the second.';

-- ---------------------------------------------------------------------------
-- 2 and 3. The curated property row and its single Warner source ref
-- ---------------------------------------------------------------------------
-- Order inside the block: resolve the licensor, prove the source evidence, create or
-- reuse the row under the licensing write guard, converge its metadata, promote it to
-- active under a second authorization, then record the one source ref.
do $curated_mortal_kombat_ii$
declare
  v_expected_licensor_id constant uuid := '88313675-0089-4072-87be-5b989df8a3fc';
  v_property_name        constant text := 'Mortal Kombat II (2026)';
  v_warner_source_id     constant text := 'e01f0a1f-0ca6-42ac-8e9d-8e5e50421631';
  v_catalogue_row_id     constant uuid := 'fce7424a-f157-40df-8be9-7c8fb321da5c';
  v_art_assets_row_id    constant uuid := '9dd513ee-6cd8-4990-81a4-f999a6ce5831';
  v_actor                constant text := 'shared-db migration 20260902222649';
  v_curated_metadata     constant jsonb := jsonb_build_object(
    'curated', true,
    'import_owned', false,
    'authorising_issue', 2132,
    'owner_instruction_date', '2026-09-02',
    'migration', '20260902222649',
    'curated_source', jsonb_build_object(
      'source_table', 'plm.wb_property',
      'warner_source_id', 'e01f0a1f-0ca6-42ac-8e9d-8e5e50421631',
      'source_systems', jsonb_build_array(
        'warner_product_catalogue',
        'warner_art_assets'
      )
    ),
    'curation_note',
      'Curated from the Warner source extracts under AGENTS.md section 6.4: '
      'curated Master Data outranks the transitional DesignFlow PLM import. '
      'plm_import_source is deliberately absent -- this row was not import-created. '
      'code is NULL because DesignFlow PLM has not published a merch-group code for '
      'this property yet; the importer fills it in on convergence via '
      'code = coalesce(v_source_code, code).'
  );
  v_licensor_id       uuid;
  v_property_id       uuid;
  v_property_status   app.entity_status;
  v_property_metadata jsonb;
  v_evidence_rows     integer;
  v_evidence_bad      integer;
  v_rows              integer;
begin
  -- Guarded lookup. The licensor is looked up by its business keys and then checked
  -- against the id this migration was written against; a mismatch means the row was
  -- re-created elsewhere and the reviewed evidence no longer applies.
  select id into v_licensor_id
  from core.licensor
  where code = 'WB' and name = 'WARNER BROS';

  if v_licensor_id is null then
    raise exception
      'Issue #2132 cannot be applied: core.licensor (code=WB, name=WARNER BROS) not '
      'found. Do not weaken this check -- re-check the target database before '
      'proceeding.';
  end if;

  if v_licensor_id <> v_expected_licensor_id then
    raise exception
      'Issue #2132 cannot be applied: core.licensor (code=WB, name=WARNER BROS) has id '
      '%, but this migration was authored against %. Re-check the target database '
      'before proceeding.', v_licensor_id, v_expected_licensor_id;
  end if;

  -- The source evidence is looked up, not assumed. A curated row whose recorded source
  -- identity is absent from the extracts would be an unfalsifiable claim, and a row id
  -- that has since moved to another identity would be a silent mis-attribution. The
  -- unique indexes on plm.wb_property allow at most one row per (namespace, source_id)
  -- and the table's own check constraint allows only these two namespaces, so the exact
  -- answer here is two rows -- one per namespace -- and any other answer stops the apply.
  select count(*),
         count(*) filter (
           where not (
             (w.source_namespace = 'warner_product_catalogue' and w.id = v_catalogue_row_id)
             or (w.source_namespace = 'warner_art_assets' and w.id = v_art_assets_row_id)
           )
         )
    into v_evidence_rows, v_evidence_bad
  from plm.wb_property w
  where w.source_id = v_warner_source_id;

  if v_evidence_rows = 0 then
    raise exception
      'Issue #2132 cannot be applied: no plm.wb_property row carries the Warner source '
      'identity %. The curated row would record source evidence that is not present in '
      'the Warner extracts. Do not weaken this check -- re-check the target database '
      'before proceeding.', v_warner_source_id;
  end if;

  if v_evidence_rows <> 2 or v_evidence_bad <> 0 then
    raise exception
      'Issue #2132 cannot be applied: Warner source identity % resolves to % '
      'plm.wb_property row(s), of which % are not the two reviewed rows (% under '
      'warner_product_catalogue and % under warner_art_assets). The '
      'Creative-to-Submissions equivalence recorded below rests on exactly those rows.',
      v_warner_source_id, v_evidence_rows, v_evidence_bad,
      v_catalogue_row_id, v_art_assets_row_id;
  end if;

  -- Idempotent: reuse an existing row under this licensor with the same name, matched
  -- case-insensitively exactly as plm.import_master_data matches it.
  select id, status, metadata
    into v_property_id, v_property_status, v_property_metadata
  from core.property
  where licensor_id = v_licensor_id
    and lower(name) = lower(v_property_name)
  order by created_at
  limit 1;

  if v_property_id is null then
    -- The licensing write guard requires a reviewed create to enter as 'potential'.
    -- protected_columns must equal the changed set EXACTLY, and an INSERT into
    -- core.property always counts as changing all four guarded columns.
    insert into plm.licensing_write_authorization (
      backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
      actor, protected_columns, expires_at
    )
    values (
      pg_backend_pid(), txid_current(), 'core.property', 'licensing_review_create',
      gen_random_uuid(),
      encode(extensions.digest('2132/create/' || v_property_name, 'sha256'), 'hex'),
      v_actor, array['licensor_id', 'name', 'code', 'status'],
      clock_timestamp() + interval '1 minute'
    );

    insert into core.property (licensor_id, name, code, status, metadata)
    values (v_licensor_id, v_property_name, null, 'potential', v_curated_metadata)
    returning id, status, metadata
      into v_property_id, v_property_status, v_property_metadata;
  else
    -- The reuse path must reach the SAME end state as the insert path, not merely avoid
    -- a duplicate. If the existing row is import-owned, though, stopping is the only
    -- safe answer: stripping an importer's provenance key to make a curated claim fit
    -- would destroy the evidence that the two systems disagree, and which of them owns
    -- the row is a decision for a person, not for this migration.
    if v_property_metadata ? 'plm_import_source' then
      raise exception
        'Issue #2132 cannot be applied: core.property % already exists under WARNER BROS '
        'named % and carries plm_import_source, so it is import-owned. Curating it here '
        'would overwrite that provenance. Resolve the ownership of this row before '
        're-running.', v_property_id, v_property_name;
    end if;

    if not (v_property_metadata @> v_curated_metadata) then
      update core.property
         set metadata = metadata || v_curated_metadata,
             updated_at = now()
       where id = v_property_id
       returning metadata into v_property_metadata;
    end if;
  end if;

  -- Promotion to 'active' is a separate, status-only guarded write, because
  -- licensing_review_create refuses any create that is not 'potential'. It runs only
  -- when the status is not already 'active', so a re-apply consumes nothing.
  if v_property_status is distinct from 'active' then
    insert into plm.licensing_write_authorization (
      backend_pid, transaction_id, target_table, write_kind, plan_id, plan_hash,
      actor, protected_columns, expires_at
    )
    values (
      pg_backend_pid(), txid_current(), 'core.property', 'coldlion_status',
      gen_random_uuid(),
      encode(extensions.digest('2132/activate/' || v_property_id::text, 'sha256'), 'hex'),
      v_actor, array['status'],
      clock_timestamp() + interval '1 minute'
    );

    update core.property
       set status = 'active'
     where id = v_property_id;

    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception
        'Issue #2132 cannot be applied: activating curated property % changed % row(s), '
        'expected exactly 1.', v_property_id, v_rows;
    end if;
  end if;

  -- Exactly one source ref, keyed on the Warner source identity shared by both
  -- namespaces. Guarded rather than blind: the unique key is
  -- (source_system, source_table, source_id).
  insert into core.taxonomy_source_ref (
    entity_schema,
    entity_table,
    entity_id,
    source_system,
    source_table,
    source_id,
    source_code,
    source_name,
    confidence,
    raw
  )
  select
    'core',
    'property',
    v_property_id,
    'warner_product_catalogue',
    'plm.wb_property',
    v_warner_source_id,
    null,
    v_property_name,
    'verified',
    jsonb_build_object(
      'authorising_issue', 2132,
      'owner_instruction_date', '2026-09-02',
      'namespace_scoped', true,
      'warner_source_id', v_warner_source_id,
      'source_evidence', jsonb_build_object(
        'warner_product_catalogue', jsonb_build_object(
          'source_table', 'plm.wb_property',
          'row_id', v_catalogue_row_id
        ),
        'warner_art_assets', jsonb_build_object(
          'source_table', 'plm.wb_property',
          'row_id', v_art_assets_row_id
        )
      ),
      'evidence_note',
        'The same Warner source identity appears in both the warner_product_catalogue '
        '(Submissions) and warner_art_assets (Creative) extracts, which is direct '
        'source evidence of Creative-to-Submissions equivalence rather than a '
        'name-similarity inference. Both row ids were looked up in the extracts before '
        'this row was written. One ref row covers both namespaces because the Warner '
        'refs key on the source identity, not on the plm.wb_property primary key; the '
        'Creative side is tracked in plm.creative_submission_property_resolution.'
    )
  where not exists (
    select 1
    from core.taxonomy_source_ref
    where source_system = 'warner_product_catalogue'
      and source_table = 'plm.wb_property'
      and source_id = v_warner_source_id
  );
end;
$curated_mortal_kombat_ii$;

-- ---------------------------------------------------------------------------
-- 4. Verification -- fail the apply rather than report a success it cannot prove
-- ---------------------------------------------------------------------------
do $verify_issue_2132$
declare
  v_expected_licensor_id constant uuid := '88313675-0089-4072-87be-5b989df8a3fc';
  v_property_name        constant text := 'Mortal Kombat II (2026)';
  v_warner_source_id     constant text := 'e01f0a1f-0ca6-42ac-8e9d-8e5e50421631';
  v_nulls_not_distinct   boolean;
  v_property_count       integer;
  v_property_id          uuid;
  v_property_code        text;
  v_property_status      app.entity_status;
  v_property_metadata    jsonb;
  v_ref_count            integer;
  v_ref_entity_schema    text;
  v_ref_entity_table     text;
  v_ref_entity_id        uuid;
begin
  -- 4a. The constraint exists, is unique, and now treats NULLs as distinct.
  select i.indnullsnotdistinct
    into v_nulls_not_distinct
  from pg_constraint c
  join pg_index i on i.indexrelid = c.conindid
  where c.conrelid = 'core.property'::regclass
    and c.conname = 'property_licensor_id_code_key'
    and c.contype = 'u';

  if v_nulls_not_distinct is null then
    raise exception
      'Issue #2132 verification failed: unique constraint property_licensor_id_code_key '
      'is missing from core.property after this migration.';
  end if;

  if v_nulls_not_distinct then
    raise exception
      'Issue #2132 verification failed: property_licensor_id_code_key is still '
      'NULLS NOT DISTINCT, so a licensor can still hold only one code-less property.';
  end if;

  -- 4b. Exactly one property row, under the expected licensor, with a NULL code, active,
  -- and carrying the curated metadata end state that BOTH paths above converge on.
  select count(*) into v_property_count
  from core.property
  where licensor_id = v_expected_licensor_id
    and lower(name) = lower(v_property_name);

  if v_property_count <> 1 then
    raise exception
      'Issue #2132 verification failed: expected exactly 1 core.property row for '
      'licensor % named %, found %.',
      v_expected_licensor_id, v_property_name, v_property_count;
  end if;

  select id, code, status, metadata
    into v_property_id, v_property_code, v_property_status, v_property_metadata
  from core.property
  where licensor_id = v_expected_licensor_id
    and lower(name) = lower(v_property_name);

  if v_property_code is not null then
    raise exception
      'Issue #2132 verification failed: core.property % carries code %, but this '
      'property has no DesignFlow PLM merch-group code and must be code-less.',
      v_property_id, v_property_code;
  end if;

  if v_property_status <> 'active' then
    raise exception
      'Issue #2132 verification failed: core.property % has status %, expected active. '
      'The guarded promotion from potential to active did not complete.',
      v_property_id, v_property_status;
  end if;

  if coalesce(v_property_metadata ->> 'curated', '') <> 'true' then
    raise exception
      'Issue #2132 verification failed: core.property % is not marked curated in '
      'metadata, so the next DesignFlow PLM catch-up pull cannot tell this deliberate '
      'row from an import artefact (AGENTS.md section 6.4).', v_property_id;
  end if;

  if v_property_metadata ? 'plm_import_source' then
    raise exception
      'Issue #2132 verification failed: core.property % carries plm_import_source, so it '
      'reads as import-created. A curated row must not carry that key.', v_property_id;
  end if;

  -- 4c. Exactly one matching source ref, bound to that property. The count is taken on
  -- the REAL unique key -- (source_system, source_table, source_id) -- and the entity
  -- binding is checked afterwards, so a ref that exists but points somewhere else is
  -- named as a mis-binding instead of being reported as a missing row.
  select count(*) into v_ref_count
  from core.taxonomy_source_ref
  where source_system = 'warner_product_catalogue'
    and source_table = 'plm.wb_property'
    and source_id = v_warner_source_id;

  if v_ref_count <> 1 then
    raise exception
      'Issue #2132 verification failed: expected exactly 1 core.taxonomy_source_ref row '
      'for the Warner source identity %, found %.', v_warner_source_id, v_ref_count;
  end if;

  select entity_schema, entity_table, entity_id
    into v_ref_entity_schema, v_ref_entity_table, v_ref_entity_id
  from core.taxonomy_source_ref
  where source_system = 'warner_product_catalogue'
    and source_table = 'plm.wb_property'
    and source_id = v_warner_source_id;

  if v_ref_entity_schema is distinct from 'core'
     or v_ref_entity_table is distinct from 'property'
     or v_ref_entity_id is distinct from v_property_id then
    raise exception
      'Issue #2132 verification failed: the Warner source ref for identity % is bound to '
      'entity %.% id %, not to core.property id %.',
      v_warner_source_id, v_ref_entity_schema, v_ref_entity_table, v_ref_entity_id,
      v_property_id;
  end if;

  raise notice
    'Issue #2132 verified: property_licensor_id_code_key is NULLS DISTINCT, curated '
    'property % (code NULL, active) exists under WARNER BROS with exactly one Warner '
    'source ref.', v_property_id;
end;
$verify_issue_2132$;
