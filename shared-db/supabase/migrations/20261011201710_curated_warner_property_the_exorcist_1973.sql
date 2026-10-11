-- derived-from: 20260902222649_property_codeless_uniqueness_and_mortal_kombat_ii_2026.sql
--
-- Issue popcre/shared-db#4172 (for PopDAM u2giants/popdam3#95) -- add the Warner property
-- "Exorcist, The (1973)" to curated Master Data so PopDAM can reclassify the 11 assets of
-- SKU AAH62NBEX01, which currently carry no licensor and no property.
--
-- Owner ruling, Albert Hazan, 2026-10-11 (verbatim, from his chat): "all licensing
-- questions can be answered by the licensor scrapes."
--
-- SOURCE EVIDENCE (Warner scrape only; AGENTS.md section 6.16 -- contracts are not cited):
-- both Warner extracts in plm.wb_property carry this property under ONE shared Warner
-- source identity, 67830330-59a0-4d42-8765-c88e10814332:
--     plm.wb_property fc188413-63d4-4ff2-b676-df26ab19e303  warner_product_catalogue (Submissions)
--     plm.wb_property 53c4e8ca-26a9-44b0-a8fb-35b2c87315cb  warner_art_assets        (Creative)
-- The name is the scrape label verbatim: inside an authorized licensor scrape's coverage
-- that source owns the official Property name (docs/business-rules/licensing-master-data.md).
-- A third, source-id-less natural-key fallback row with the same label exists in
-- warner_art_assets; it is not used as identity evidence.
--
-- SHAPE: this is the issue #2132 (Mortal Kombat II) pattern, unchanged -- a code-less
-- curated row created 'potential' under a licensing_review_create authorization, promoted
-- to 'active' under a separate status-only coldlion_status authorization, and exactly one
-- core.taxonomy_source_ref keyed on the Warner source identity. The licensing write guard
-- is neither disabled, widened nor bypassed. Part 1 of that migration (NULLS DISTINCT on
-- property_licensor_id_code_key) is already applied and is not repeated. Active status is
-- used because PopDAM holds live merchandise for this property (SKU AAH62NBEX01) and
-- Warner's signed entitlement schedule controls Warner status (licensing-master-data.md).
--
-- Every statement is idempotent and additive. Nothing is dropped or deleted.

do $curated_the_exorcist_1973$
declare
  v_expected_licensor_id constant uuid := '88313675-0089-4072-87be-5b989df8a3fc';
  v_property_name        constant text := 'Exorcist, The (1973)';
  v_warner_source_id     constant text := '67830330-59a0-4d42-8765-c88e10814332';
  v_catalogue_row_id     constant uuid := 'fc188413-63d4-4ff2-b676-df26ab19e303';
  v_art_assets_row_id    constant uuid := '53c4e8ca-26a9-44b0-a8fb-35b2c87315cb';
  v_actor                constant text := 'shared-db migration 20261011201710';
  v_curated_metadata     constant jsonb := jsonb_build_object(
    'curated', true,
    'import_owned', false,
    'authorising_issue', 4172,
    'owner_instruction_date', '2026-10-11',
    'migration', '20261011201710',
    'curated_source', jsonb_build_object(
      'source_table', 'plm.wb_property',
      'warner_source_id', '67830330-59a0-4d42-8765-c88e10814332',
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
      'Issue #4172 cannot be applied: core.licensor (code=WB, name=WARNER BROS) not '
      'found. Do not weaken this check -- re-check the target database before '
      'proceeding.';
  end if;

  if v_licensor_id <> v_expected_licensor_id then
    raise exception
      'Issue #4172 cannot be applied: core.licensor (code=WB, name=WARNER BROS) has id '
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
      'Issue #4172 cannot be applied: no plm.wb_property row carries the Warner source '
      'identity %. The curated row would record source evidence that is not present in '
      'the Warner extracts. Do not weaken this check -- re-check the target database '
      'before proceeding.', v_warner_source_id;
  end if;

  if v_evidence_rows <> 2 or v_evidence_bad <> 0 then
    raise exception
      'Issue #4172 cannot be applied: Warner source identity % resolves to % '
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
      encode(extensions.digest('4172/create/' || v_property_name, 'sha256'), 'hex'),
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
        'Issue #4172 cannot be applied: core.property % already exists under WARNER BROS '
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
      encode(extensions.digest('4172/activate/' || v_property_id::text, 'sha256'), 'hex'),
      v_actor, array['status'],
      clock_timestamp() + interval '1 minute'
    );

    update core.property
       set status = 'active'
     where id = v_property_id;

    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception
        'Issue #4172 cannot be applied: activating curated property % changed % row(s), '
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
      'authorising_issue', 4172,
      'owner_instruction_date', '2026-10-11',
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
$curated_the_exorcist_1973$;

-- ---------------------------------------------------------------------------
-- 4. Verification -- fail the apply rather than report a success it cannot prove
-- ---------------------------------------------------------------------------
do $verify_issue_4172$
declare
  v_expected_licensor_id constant uuid := '88313675-0089-4072-87be-5b989df8a3fc';
  v_property_name        constant text := 'Exorcist, The (1973)';
  v_warner_source_id     constant text := '67830330-59a0-4d42-8765-c88e10814332';
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
  -- 4a. Exactly one property row, under the expected licensor, with a NULL code, active,
  -- and carrying the curated metadata end state that BOTH paths above converge on.
  select count(*) into v_property_count
  from core.property
  where licensor_id = v_expected_licensor_id
    and lower(name) = lower(v_property_name);

  if v_property_count <> 1 then
    raise exception
      'Issue #4172 verification failed: expected exactly 1 core.property row for '
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
      'Issue #4172 verification failed: core.property % carries code %, but this '
      'property has no DesignFlow PLM merch-group code and must be code-less.',
      v_property_id, v_property_code;
  end if;

  if v_property_status <> 'active' then
    raise exception
      'Issue #4172 verification failed: core.property % has status %, expected active. '
      'The guarded promotion from potential to active did not complete.',
      v_property_id, v_property_status;
  end if;

  if coalesce(v_property_metadata ->> 'curated', '') <> 'true' then
    raise exception
      'Issue #4172 verification failed: core.property % is not marked curated in '
      'metadata, so the next DesignFlow PLM catch-up pull cannot tell this deliberate '
      'row from an import artefact (AGENTS.md section 6.4).', v_property_id;
  end if;

  if v_property_metadata ? 'plm_import_source' then
    raise exception
      'Issue #4172 verification failed: core.property % carries plm_import_source, so it '
      'reads as import-created. A curated row must not carry that key.', v_property_id;
  end if;

  -- 4b. Exactly one matching source ref, bound to that property. The count is taken on
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
      'Issue #4172 verification failed: expected exactly 1 core.taxonomy_source_ref row '
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
      'Issue #4172 verification failed: the Warner source ref for identity % is bound to '
      'entity %.% id %, not to core.property id %.',
      v_warner_source_id, v_ref_entity_schema, v_ref_entity_table, v_ref_entity_id,
      v_property_id;
  end if;

  raise notice
    'Issue #4172 verified: curated '
    'property % (code NULL, active) exists under WARNER BROS with exactly one Warner '
    'source ref.', v_property_id;
end;
$verify_issue_4172$;
