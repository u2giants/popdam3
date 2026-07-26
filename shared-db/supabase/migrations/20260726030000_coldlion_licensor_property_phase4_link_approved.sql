-- Phase 4 migration — guarded link_approved mode for the approved ColdLion
-- licensor/property mapping set.
-- Migration: 20260726030000_coldlion_licensor_property_phase4_link_approved.sql
-- Plan: fix_coldlion_licensor_property_cutover.md (Phase 4 / §15.3 Phase 4 cold-start).
--
-- What this ships
-- --------------
-- Phase 4 (approved canonical linking) adds the `link_approved` mode promised by the
-- cutover plan §6.4 to the guarded ColdLion licensor/property lane:
--
--   plm.link_coldlion_licensors_properties_core(input jsonb, expected jsonb)
--       internal SECURITY DEFINER implementation holding ALL deep validation and
--       link logic. UNGRANTED: executable only by the database owner (migrations
--       and rolled-back contract tests) — never by service_role/anon/authenticated.
--       It links ONLY the human-approved mapping set: adds deterministic ColdLion
--       rows to core.taxonomy_source_ref BESIDE the existing DesignFlow refs and
--       sets each typed mirror row's licensor_id / property_id to the approved
--       canonical UUID. It can never create canonical rows and never writes any
--       canonical field.
--   plm.link_coldlion_licensors_properties_approved(input jsonb, expected jsonb)
--       the PINNED wrapper used by dispatch, and the only link path granted to
--       service_role. It rejects every expected contract except the exact
--       approved Phase 4 set (hash 1230f5a12d0f2a3029f1d3df17fc5b5f, count 542,
--       distinct_canonical 271) and then delegates to the ungranted core.
--   plm.sync_coldlion_licensors_properties(snapshot jsonb, mode text, link_expected jsonb)
--       re-declared with a mode dispatch: 'mirror_only' keeps the exact Phase 2A
--       behavior; 'link_approved' delegates to the function above;
--       'promote_approved' (Phase 5) still raises loudly.
--   public.sync_coldlion_licensors_properties(snapshot jsonb, mode text, link_expected jsonb)
--       thin SECURITY DEFINER wrapper (AGENTS §8.1 — plm/ingest are not
--       PostgREST-exposed). service_role only; browser roles get nothing.
--
-- The old 2-arg signatures are dropped inside this migration and replaced by the
-- 3-arg forms whose third argument defaults to null, so existing 2-arg callers
-- (the Phase 2 runner and Phase 2 contracts) keep working unchanged.
--
-- Approved-input contract (the guard that makes unapproved linking impossible)
-- --------------
-- link_approved takes the approved mapping payload PLUS a SEPARATE expected
-- contract argument {"hash","count","distinct_canonical"}. The expected values
-- come from the human-approved frozen input — never from the payload itself, so
-- a tampered or wrong payload cannot validate itself. Because that argument is
-- still caller-controlled, the PINNED WRAPPER PINS it: any expected contract
-- other than the exact approved Phase 4 set (hash 1230f5a12d0f2a3029f1d3df17fc5b5f,
-- count 542, distinct_canonical 271 — Albert Hazan's approval of the 542
-- exact-compatible proposed mappings) is rejected outright, so no caller can
-- authorize a different payload; only then does the ungranted core run the deep
-- validation below. Every failure raises P0001 and rolls the whole call back:
--   1. expected contract present, hash is 32 lowercase hex, count >= 1, and —
--      on the pinned wrapper, the only granted link path — identical to the
--      pinned approved Phase 4 contract;
--   2. input is an object with a mappings array, nonblank approved_by / approved_at_utc;
--   3. mapping count equals the expected count exactly;
--   4. every mapping has entity_type in ('licensor','property'), nonblank
--      company/division/mgTypeCode/mgCode, two-digit mgTypeCode, uuid-shaped canonical_id;
--   5. no duplicate composite source key inside the payload;
--   6. exact hash recomputed over the documented encoding — sorted
--      '<entity_type>|<company>/<division>/<mgTypeCode>/<mgCode>|<canonical_id>'
--      joined by newline, md5, C-collation sort to match the frozen JS encoding —
--      must equal the expected hash (Phase 4 approved set: 1230f5a12d0f2a3029f1d3df17fc5b5f);
--   7. distinct canonical UUID count equals the pinned expected
--      distinct_canonical (542 mappings -> 271 distinct canonical UUIDs);
--   8. LIVE typed re-verification of every mapping: the typed mirror row exists,
--      the canonical UUID exists in the TYPED canonical table, canonical code
--      equals mg_code (btrim), and normalized names agree (upper + whitespace
--      collapse). This kills cross-code links (NASA NA->X-NASA), cross-entity
--      links (FRIDA KAHLO licensor -> canonical FK property), links to missing
--      canonicals (ColdLion-only / ZAG), and links for canonical-only rows —
--      even if a payload were constructed with a self-consistent hash;
--   9. no conflicting existing coldlion source ref (same source_id, different
--      entity_table/entity_id) and no conflicting existing mirror link
--      (already linked to a different canonical UUID);
--  10. canonical-immutability guard: core.licensor / core.property row counts
--      must be identical before and after the call inside the transaction.
--
-- Effects per approved mapping (typed entity isolation: licensor mappings only
-- ever touch core.licensor / plm.erp_licensor; property mappings only ever touch
-- core.property / plm.erp_property):
--   * INSERT core.taxonomy_source_ref (entity_schema='core', entity_table=
--     'licensor'|'property', entity_id=approved UUID, source_system='coldlion',
--     source_table='merchGroupDetails', source_id=slash-joined
--     '<companyCode>/<divisionCode>/<mgTypeCode>/<mgCode>' — the §4.3 encoding,
--     never mgCode alone — source_code=mgCode, source_name=mirror name,
--     confidence='verified', raw=audit jsonb). Idempotent: an existing
--     same-entity ref is left untouched and counted as pre-existing.
--   * UPDATE the typed mirror row: licensor_id/property_id = approved UUID,
--     resolution_status='manually_matched' (Phase 1 schema: approved-link
--     state), resolution_reason citing the approved hash + approver,
--     resolved_at=now(), resolved_by=approver. Only rows whose link column is
--     still NULL are updated, so a committed re-run changes nothing and reports
--     zero set / all pre-existing (idempotent).
--   * ingest.sync_run accounting under source_name
--     'coldlion_licensors_properties_link_approved' (distinct from the
--     mirror_only source_name so the mirror count-drop guard never reads link
--     runs as 'prior' pulls).
--
-- Field-ownership contract (fix_coldlion_licensor_property_cutover.md §3, §5):
--   This mode writes ONLY core.taxonomy_source_ref rows, the typed mirror
--   link/resolution columns, and ingest.sync_run accounting. It MUST NOT write
--   core.licensor, core.property, core.property.licensor_id, core.*.status,
--   canonical UUIDs/codes/names/metadata, or plm.taxonomy_resolution_review.
--   There is no canonical-create path here: Phase 5 (promote_approved) is a
--   separate later approval and is NOT implemented.
--
-- Atomicity: the whole call is one statement; any guard failure raises and
-- rolls back everything, including the in-function sync_run row. The committed
-- durable failure row + two-consecutive alert is the RUNNER's job in a separate
-- transaction (coldlion-sync-common.mjs buildFailedSyncRunSql), exactly like
-- the Phase 2A mirror importer.

-- =====================================================================================
-- 1. Internal Phase 4 core: ALL deep validation + approved linking only.
--    UNGRANTED (see §4) — callable only by the database owner (migrations and
--    rolled-back contract tests). The granted paths reach it exclusively through
--    the pinned wrapper in §1b.
-- =====================================================================================
create or replace function plm.link_coldlion_licensors_properties_core(
  p_input jsonb,
  p_expected jsonb
)
returns table (
  sync_run_id             uuid,
  mode                    text,
  rows_seen               integer,
  rows_inserted           integer,
  rows_updated            integer,
  rows_unchanged          integer,
  licensor_rows           integer,
  property_rows           integer,
  division_count          integer,
  cross_entity_collisions integer,
  snapshot_hash           text
)
language plpgsql
security definer
set search_path = plm, ingest, core, app, extensions, public
as $$
declare
  v_expected_hash     text;
  v_expected_count    integer;
  v_expected_distinct integer;
  v_mappings          jsonb;
  v_approved_by       text;
  v_approved_at       text;
  v_count             integer;
  v_distinct          integer;
  v_hash              text;
  v_bad               integer;
  v_bad_list          text;
  v_lic_n             integer;
  v_prop_n            integer;
  v_div_n             integer;
  v_refs_pre          integer;
  v_refs_ins          integer;
  v_links_pre_lic     integer;
  v_links_pre_prop    integer;
  v_links_pre         integer;
  v_links_set_lic     integer;
  v_links_set_prop    integer;
  v_links_set         integer;
  v_lic_count_before  bigint;
  v_prop_count_before bigint;
  v_sync_id           uuid;
begin
  -- ------------------------------------------------------------------
  -- 0. The expected contract is a SEPARATE argument. The approved
  --    hash/count never travel inside the mapping payload, so a payload
  --    cannot validate itself.
  -- ------------------------------------------------------------------
  if jsonb_typeof(coalesce(p_expected, 'null'::jsonb)) <> 'object' then
    raise exception
      'link_approved requires an explicit expected contract {"hash","count","distinct_canonical"} as a separate argument — the approved values come from the human-approved frozen input, not from the payload'
      using errcode = 'P0001';
  end if;
  v_expected_hash := lower(btrim(coalesce(p_expected ->> 'hash', '')));
  if v_expected_hash !~ '^[0-9a-f]{32}$' then
    raise exception 'link_approved expected contract hash must be 32 lowercase hex characters (md5)'
      using errcode = 'P0001';
  end if;
  v_expected_count := nullif(p_expected ->> 'count', '')::integer;
  if v_expected_count is null or v_expected_count < 1 then
    raise exception 'link_approved expected contract count must be a positive integer'
      using errcode = 'P0001';
  end if;
  v_expected_distinct := nullif(p_expected ->> 'distinct_canonical', '')::integer;

  -- ------------------------------------------------------------------
  -- 1. Input shape.
  -- ------------------------------------------------------------------
  if jsonb_typeof(coalesce(p_input, 'null'::jsonb)) <> 'object' then
    raise exception 'link_approved input must be a JSON object {approved_by, approved_at_utc, mappings[]}'
      using errcode = 'P0001';
  end if;
  v_mappings := p_input -> 'mappings';
  if jsonb_typeof(v_mappings) <> 'array' then
    raise exception 'link_approved input.mappings must be a JSON array' using errcode = 'P0001';
  end if;
  v_approved_by := nullif(btrim(coalesce(p_input ->> 'approved_by', '')), '');
  if v_approved_by is null then
    raise exception 'link_approved input.approved_by is required (the human who approved this exact mapping set)'
      using errcode = 'P0001';
  end if;
  v_approved_at := nullif(btrim(coalesce(p_input ->> 'approved_at_utc', '')), '');
  if v_approved_at is null then
    raise exception 'link_approved input.approved_at_utc is required' using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 2. Exact count contract.
  -- ------------------------------------------------------------------
  v_count := jsonb_array_length(v_mappings);
  if v_count <> v_expected_count then
    raise exception
      'approved mapping count mismatch: input carries % mapping(s) but the approved contract expects % — refusing unapproved input',
      v_count, v_expected_count using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 3. Materialize the raw payload rows (dropped if a previous call in
  --    the same transaction already materialized them).
  -- ------------------------------------------------------------------
  drop table if exists pg_temp.p4_mappings;
  create temp table p4_mappings (
    entity_type       text not null,
    company_code      text not null,
    division_code     text not null,
    mg_type_code      text not null,
    mg_code           text not null,
    canonical_id_text text not null,
    canonical_uuid    uuid,
    source_id         text
  ) on commit drop;

  insert into pg_temp.p4_mappings (entity_type, company_code, division_code, mg_type_code, mg_code, canonical_id_text)
  select coalesce(x.value ->> 'entity_type', ''),
         coalesce(x.value ->> 'company_code', ''),
         coalesce(x.value ->> 'division_code', ''),
         coalesce(x.value ->> 'mg_type_code', ''),
         coalesce(x.value ->> 'mg_code', ''),
         coalesce(x.value ->> 'canonical_id', '')
  from jsonb_array_elements(v_mappings) x(value);

  -- ------------------------------------------------------------------
  -- 4. Per-mapping shape + typed contract (strict — no silent normalization;
  --    the approved encoding hashes the exact strings).
  -- ------------------------------------------------------------------
  select count(*),
         coalesce(string_agg(entity_type || ' ' || company_code || '/' || division_code || '/'
                             || mg_type_code || '/' || mg_code, ', ' order by company_code || '/'
                             || division_code || '/' || mg_type_code || '/' || mg_code collate "C"), '')
    into v_bad, v_bad_list
    from pg_temp.p4_mappings
    where entity_type not in ('licensor', 'property')
       or btrim(company_code) = ''
       or btrim(division_code) = ''
       or mg_type_code !~ '^[0-9]{2}$'
       or btrim(mg_code) = ''
       or canonical_id_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  if v_bad > 0 then
    raise exception
      'link_approved input shape invalid for % mapping(s) (entity_type must be licensor|property, keys nonblank, mgTypeCode two digits, canonical_id a uuid): %',
      v_bad, v_bad_list using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 5. No duplicate composite source key inside the payload.
  -- ------------------------------------------------------------------
  if exists (
    select 1 from pg_temp.p4_mappings
    group by company_code, division_code, mg_type_code, mg_code
    having count(*) > 1
  ) then
    raise exception 'duplicate composite source key in the approved input — each ColdLion source row may be linked exactly once'
      using errcode = 'P0001';
  end if;

  update pg_temp.p4_mappings
  set canonical_uuid = canonical_id_text::uuid,
      source_id = company_code || '/' || division_code || '/' || mg_type_code || '/' || mg_code;

  -- ------------------------------------------------------------------
  -- 6. Exact hash contract. The encoding is the frozen Phase 3/4 document:
  --    '<entity_type>|<company>/<division>/<mgTypeCode>/<mgCode>|<canonical_id>'
  --    sorted by the composite key (C collation — byte order, matching the JS
  --    code-unit sort used to freeze the approved set) and joined by newline.
  -- ------------------------------------------------------------------
  select md5(coalesce(string_agg(
           entity_type || '|' || source_id || '|' || canonical_id_text,
           E'\n' order by source_id collate "C"), md5('')))
    into v_hash
    from pg_temp.p4_mappings;
  if v_hash <> v_expected_hash then
    raise exception
      'approved mapping hash mismatch: recomputed % from the payload but the approved contract expects % — refusing unapproved or tampered input',
      v_hash, v_expected_hash using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 7. Distinct canonical contract (checked when supplied — the pinned
  --    production wrapper always supplies exactly 271).
  -- ------------------------------------------------------------------
  select count(distinct canonical_id_text) into v_distinct from pg_temp.p4_mappings;
  if v_expected_distinct is not null and v_distinct <> v_expected_distinct then
    raise exception
      'distinct canonical count mismatch: input maps to % distinct canonical UUIDs but the approved contract expects %',
      v_distinct, v_expected_distinct using errcode = 'P0001';
  end if;

  select count(*) filter (where entity_type = 'licensor'),
         count(*) filter (where entity_type = 'property'),
         count(distinct division_code)
    into v_lic_n, v_prop_n, v_div_n
    from pg_temp.p4_mappings;

  -- ------------------------------------------------------------------
  -- 8. Serialize against any concurrent mirror/link run (same lock family
  --    as the Phase 2A importer), then snapshot canonical counts for the
  --    no-create/no-delete proof.
  -- ------------------------------------------------------------------
  perform pg_advisory_xact_lock(hashtext('plm.sync_coldlion_licensors_properties')::bigint);

  select count(*) into v_lic_count_before from core.licensor;
  select count(*) into v_prop_count_before from core.property;

  -- ------------------------------------------------------------------
  -- 9. Open the run-accounting row.
  -- ------------------------------------------------------------------
  insert into ingest.sync_run (source_system, source_name, status, started_at, metadata)
  values ('coldlion', 'coldlion_licensors_properties_link_approved', 'running', now(),
          jsonb_build_object(
            'endpoint_group', 'phase4_approved_mapping_input',
            'mode', 'link_approved',
            'stage', 'running',
            'phase', '4',
            'approved_by', v_approved_by,
            'approved_at_utc', v_approved_at,
            'expected_hash', v_expected_hash,
            'expected_count', v_expected_count,
            'expected_distinct_canonical', v_expected_distinct))
  returning id into v_sync_id;

  -- ------------------------------------------------------------------
  -- 10. LIVE typed re-verification. Every approved mapping must STILL be an
  --     exact-compatible typed match against live data: typed mirror row
  --     exists, canonical UUID exists in the typed canonical table, canonical
  --     code equals mg_code (btrim), normalized names agree. Any drift since
  --     the mapping was approved aborts the whole run — no partial links.
  -- ------------------------------------------------------------------
  select count(*),
         coalesce(string_agg(offender, ', '), '')
    into v_bad, v_bad_list
    from (
      select m.entity_type || ' ' || m.source_id as offender
      from pg_temp.p4_mappings m
      left join plm.erp_licensor e
        on e.company_code = m.company_code and e.division_code = m.division_code
       and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
      left join core.licensor c on c.id = m.canonical_uuid
      where m.entity_type = 'licensor'
        and (e.mg_code is null
             or c.id is null
             or btrim(c.code) is distinct from btrim(m.mg_code)
             or upper(regexp_replace(btrim(c.name), '\s+', ' ', 'g'))
                  is distinct from upper(regexp_replace(btrim(e.name), '\s+', ' ', 'g')))
      union all
      select m.entity_type || ' ' || m.source_id as offender
      from pg_temp.p4_mappings m
      left join plm.erp_property e
        on e.company_code = m.company_code and e.division_code = m.division_code
       and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
      left join core.property c on c.id = m.canonical_uuid
      where m.entity_type = 'property'
        and (e.mg_code is null
             or c.id is null
             or btrim(c.code) is distinct from btrim(m.mg_code)
             or upper(regexp_replace(btrim(c.name), '\s+', ' ', 'g'))
                  is distinct from upper(regexp_replace(btrim(e.name), '\s+', ' ', 'g')))
    ) offenders;
  if v_bad > 0 then
    raise exception
      'link_approved live re-verification failed for % mapping(s): every approved mapping must still be an exact-compatible typed match (typed mirror row exists, canonical UUID exists in the typed table, canonical code equals mg_code, normalized names agree). Offending: %',
      v_bad, v_bad_list using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 11. Conflicting existing provenance: a coldlion ref for the same
  --     source_id pointing at a DIFFERENT entity aborts everything.
  -- ------------------------------------------------------------------
  select count(*),
         coalesce(string_agg(m.source_id, ', '), '')
    into v_bad, v_bad_list
    from pg_temp.p4_mappings m
    join core.taxonomy_source_ref r
      on r.source_system = 'coldlion' and r.source_table = 'merchGroupDetails'
     and r.source_id = m.source_id
    where r.entity_table is distinct from m.entity_type
       or r.entity_id is distinct from m.canonical_uuid;
  if v_bad > 0 then
    raise exception
      'conflicting existing coldlion source ref for % source key(s): an existing ref points at a different entity — aborting with no partial work. Offending: %',
      v_bad, v_bad_list using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 12. Conflicting existing mirror link: a mirror row already linked to a
  --     DIFFERENT canonical UUID aborts everything.
  -- ------------------------------------------------------------------
  select count(*),
         coalesce(string_agg(offender, ', '), '')
    into v_bad, v_bad_list
    from (
      select m.source_id as offender
      from pg_temp.p4_mappings m
      join plm.erp_licensor e
        on e.company_code = m.company_code and e.division_code = m.division_code
       and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
      where m.entity_type = 'licensor'
        and e.licensor_id is not null and e.licensor_id <> m.canonical_uuid
      union all
      select m.source_id as offender
      from pg_temp.p4_mappings m
      join plm.erp_property e
        on e.company_code = m.company_code and e.division_code = m.division_code
       and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
      where m.entity_type = 'property'
        and e.property_id is not null and e.property_id <> m.canonical_uuid
    ) offenders;
  if v_bad > 0 then
    raise exception
      'conflicting existing mirror link for % source key(s): mirror row already linked to a different canonical UUID — aborting with no partial work. Offending: %',
      v_bad, v_bad_list using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 13. Add the deterministic ColdLion source refs BESIDE the existing
  --     DesignFlow refs. Same-entity pre-existing refs are idempotently
  --     skipped (ON CONFLICT DO NOTHING) and counted as unchanged.
  -- ------------------------------------------------------------------
  select count(*) into v_refs_pre
    from pg_temp.p4_mappings m
    join core.taxonomy_source_ref r
      on r.source_system = 'coldlion' and r.source_table = 'merchGroupDetails'
     and r.source_id = m.source_id;

  insert into core.taxonomy_source_ref (
    entity_schema, entity_table, entity_id,
    source_system, source_table, source_id, source_code, source_name,
    confidence, raw
  )
  select 'core', e.entity_type, e.canonical_uuid,
         'coldlion', 'merchGroupDetails', e.source_id, e.mg_code, e.source_name,
         'verified',
         jsonb_build_object(
           'company_code', e.company_code,
           'division_code', e.division_code,
           'mg_type_code', e.mg_type_code,
           'mg_code', e.mg_code,
           'phase', '4',
           'approved_by', v_approved_by,
           'approved_at_utc', v_approved_at,
           'approved_mapping_hash', v_hash,
           'sync_run_id', v_sync_id)
  from (
    select m.entity_type, m.company_code, m.division_code, m.mg_type_code, m.mg_code,
           m.canonical_uuid, m.source_id, e.name as source_name
    from pg_temp.p4_mappings m
    join plm.erp_licensor e
      on e.company_code = m.company_code and e.division_code = m.division_code
     and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
    where m.entity_type = 'licensor'
    union all
    select m.entity_type, m.company_code, m.division_code, m.mg_type_code, m.mg_code,
           m.canonical_uuid, m.source_id, e.name as source_name
    from pg_temp.p4_mappings m
    join plm.erp_property e
      on e.company_code = m.company_code and e.division_code = m.division_code
     and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
    where m.entity_type = 'property'
  ) e
  on conflict (source_system, source_table, source_id) do nothing;
  get diagnostics v_refs_ins = row_count;

  if v_refs_ins + v_refs_pre <> v_count then
    raise exception
      'source-ref accounting mismatch: inserted % + pre-existing % <> approved count % — aborting',
      v_refs_ins, v_refs_pre, v_count using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 14. Link the typed mirror rows to the approved canonical UUIDs. Only
  --     NULL link columns are written, so a committed re-run is a no-op
  --     (idempotent) and resolved_at/resolved_by never churn.
  -- ------------------------------------------------------------------
  select count(*) into v_links_pre_lic
    from pg_temp.p4_mappings m
    join plm.erp_licensor e
      on e.company_code = m.company_code and e.division_code = m.division_code
     and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
    where m.entity_type = 'licensor' and e.licensor_id = m.canonical_uuid;
  select count(*) into v_links_pre_prop
    from pg_temp.p4_mappings m
    join plm.erp_property e
      on e.company_code = m.company_code and e.division_code = m.division_code
     and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
    where m.entity_type = 'property' and e.property_id = m.canonical_uuid;
  v_links_pre := v_links_pre_lic + v_links_pre_prop;

  update plm.erp_licensor e
  set licensor_id       = m.canonical_uuid,
      resolution_status = 'manually_matched',
      resolution_reason = 'phase4 link_approved: approved exact-compatible match (approved_mapping_hash='
                          || v_hash || ', approved_by=' || v_approved_by || ')',
      resolved_at       = now(),
      resolved_by       = v_approved_by
  from pg_temp.p4_mappings m
  where m.entity_type = 'licensor'
    and e.company_code = m.company_code and e.division_code = m.division_code
    and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
    and e.licensor_id is null;
  get diagnostics v_links_set_lic = row_count;

  update plm.erp_property e
  set property_id       = m.canonical_uuid,
      resolution_status = 'manually_matched',
      resolution_reason = 'phase4 link_approved: approved exact-compatible match (approved_mapping_hash='
                          || v_hash || ', approved_by=' || v_approved_by || ')',
      resolved_at       = now(),
      resolved_by       = v_approved_by
  from pg_temp.p4_mappings m
  where m.entity_type = 'property'
    and e.company_code = m.company_code and e.division_code = m.division_code
    and e.mg_type_code = m.mg_type_code and e.mg_code = m.mg_code
    and e.property_id is null;
  get diagnostics v_links_set_prop = row_count;

  v_links_set := v_links_set_lic + v_links_set_prop;
  if v_links_set + v_links_pre <> v_count then
    raise exception
      'mirror-link accounting mismatch: set % + pre-existing % <> approved count % — aborting',
      v_links_set, v_links_pre, v_count using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 15. Canonical-immutability guard: link_approved can never create or
  --     delete canonical rows.
  -- ------------------------------------------------------------------
  if (select count(*) from core.licensor) <> v_lic_count_before
     or (select count(*) from core.property) <> v_prop_count_before then
    raise exception
      'link_approved canonical-immutability guard tripped: core.licensor/core.property row counts changed inside the transaction (%/% before, %/% after) — aborting; link_approved never creates or deletes canonical rows',
      v_lic_count_before, v_prop_count_before,
      (select count(*) from core.licensor), (select count(*) from core.property)
      using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 16. Complete run accounting.
  -- ------------------------------------------------------------------
  update ingest.sync_run
  set status = 'succeeded',
      finished_at = now(),
      rows_seen = v_count,
      rows_inserted = v_refs_ins,
      rows_updated = v_links_set,
      rows_failed = 0,
      metadata = metadata || jsonb_build_object(
        'stage', 'succeeded',
        'mode', 'link_approved',
        'phase', '4',
        'approved_by', v_approved_by,
        'approved_at_utc', v_approved_at,
        'approved_mapping_hash', v_hash,
        'mappings', v_count,
        'distinct_canonical', v_distinct,
        'licensor_mappings', v_lic_n,
        'property_mappings', v_prop_n,
        'divisions', v_div_n,
        'source_refs_inserted', v_refs_ins,
        'source_refs_preexisting', v_refs_pre,
        'mirror_links_set', v_links_set,
        'mirror_links_set_licensor', v_links_set_lic,
        'mirror_links_set_property', v_links_set_prop,
        'mirror_links_preexisting', v_links_pre,
        'canonical_licensor_count_before', v_lic_count_before,
        'canonical_property_count_before', v_prop_count_before,
        'canonical_rows_created', 0,
        'canonical_rows_deleted', 0,
        'canonical_fields_changed', '{}'::jsonb)
  where id = v_sync_id;

  return query select v_sync_id, 'link_approved'::text, v_count, v_refs_ins, v_links_set,
                      v_refs_pre, v_lic_n, v_prop_n, v_div_n, 0, v_hash;

exception when others then
  -- Rolls back with the caller transaction. The RUNNER records the committed
  -- durable failed sync_run + two-consecutive alert in a separate transaction
  -- (coldlion-sync-common.mjs buildFailedSyncRunSql), like the Phase 2A lane.
  if v_sync_id is not null then
    update ingest.sync_run
      set status = 'failed', finished_at = now(), error = sqlerrm,
          metadata = metadata || jsonb_build_object('stage', 'failed', 'mode', 'link_approved')
      where id = v_sync_id;
  end if;
  raise;
end;
$$;

comment on function plm.link_coldlion_licensors_properties_core(jsonb, jsonb) is
'Phase 4 deep-validation/linking CORE (fix_coldlion_licensor_property_cutover.md §6.4 link_approved). UNGRANTED: database-owner only — migrations and rolled-back contract tests call it directly; every granted path reaches it through plm.link_coldlion_licensors_properties_approved, which pins the expected contract to the exact approved Phase 4 set first. Validates a SEPARATE expected contract (hash/count/distinct_canonical — distinct checked when supplied), recomputes the exact approved mapping hash over the documented encoding (C-collation sort), and live re-verifies every mapping as an exact-compatible TYPED match (mirror row exists, canonical UUID exists in the typed table, code equals mg_code, normalized names agree). Writes ONLY deterministic coldlion core.taxonomy_source_ref rows (source_id = <company>/<division>/<mgTypeCode>/<mgCode>) beside the DesignFlow refs, typed mirror licensor_id/property_id links (resolution_status=manually_matched), and ingest.sync_run accounting under source_name coldlion_licensors_properties_link_approved. Idempotent: same-entity pre-existing refs/links are counted as unchanged. Never creates/updates/deletes core.licensor/core.property, never touches status/parents/codes/names/UUIDs, never resolves review findings. Atomic: any guard failure rolls back all work.';

-- =====================================================================================
-- 1b. Pinned production wrapper — the ONLY link path granted to service_role and
--     the target of the sync-lane dispatch. p_expected is caller-controlled, so
--     the database itself refuses anything except the exact human-approved Phase
--     4 set BEFORE any deep validation runs: hash
--     1230f5a12d0f2a3029f1d3df17fc5b5f, count 542, distinct_canonical 271 (Albert
--     Hazan's approval of the 542 exact-compatible proposed mappings). Anything
--     else — NASA, FRIDA KAHLO, ZAG, ColdLion-only, canonical-only, FRIENDS TV,
--     a trimmed or extended variant, Phase 5 creates — is rejected here. Count
--     and distinct are compared as raw text on purpose: any deviation
--     (reordered, reformatted, or self-consistent but unapproved) is a clean
--     rejection, never a cast error. distinct_canonical is therefore mandatory
--     on this path: it must equal the pinned 271, not merely be present.
-- =====================================================================================
create or replace function plm.link_coldlion_licensors_properties_approved(
  p_input jsonb,
  p_expected jsonb
)
returns table (
  sync_run_id             uuid,
  mode                    text,
  rows_seen               integer,
  rows_inserted           integer,
  rows_updated            integer,
  rows_unchanged          integer,
  licensor_rows           integer,
  property_rows           integer,
  division_count          integer,
  cross_entity_collisions integer,
  snapshot_hash           text
)
language plpgsql
security definer
set search_path = plm, ingest, core, app, extensions, public
as $$
begin
  if p_expected is null or jsonb_typeof(p_expected) <> 'object' then
    raise exception
      'link_approved requires an explicit expected contract {"hash","count","distinct_canonical"} as a separate argument — and only the pinned approved Phase 4 set is accepted (hash 1230f5a12d0f2a3029f1d3df17fc5b5f, count 542, distinct_canonical 271)'
      using errcode = 'P0001';
  end if;
  if lower(btrim(coalesce(p_expected ->> 'hash', ''))) <> '1230f5a12d0f2a3029f1d3df17fc5b5f'
     or btrim(coalesce(p_expected ->> 'count', '')) <> '542'
     or btrim(coalesce(p_expected ->> 'distinct_canonical', '')) <> '271' then
    raise exception
      'link_approved rejected: the expected contract does not match the pinned approved Phase 4 set (hash 1230f5a12d0f2a3029f1d3df17fc5b5f, count 542, distinct_canonical 271 — Albert Hazan approval of the 542 exact-compatible proposed mappings). No other payload can be authorized; NASA and every pending/not-linked row remain excluded and Phase 5 creates are not implemented'
      using errcode = 'P0001';
  end if;
  return query
    select * from plm.link_coldlion_licensors_properties_core(p_input, p_expected);
end;
$$;

comment on function plm.link_coldlion_licensors_properties_approved(jsonb, jsonb) is
'Phase 4 PINNED approved-linking wrapper — the only link path granted to service_role and the dispatch target of plm/public.sync_coldlion_licensors_properties link_approved mode. Accepts ONLY the exact approved Phase 4 expected contract (hash 1230f5a12d0f2a3029f1d3df17fc5b5f, count 542, distinct_canonical 271 — Albert Hazan approval of the 542 exact-compatible proposed mappings); every other contract is rejected before any validation runs, so caller-controlled expected values cannot authorize a different payload. Delegates all deep validation/linking to the UNGRANTED plm.link_coldlion_licensors_properties_core.';

-- =====================================================================================
-- 2. Re-declare the guarded lane with the §6.4 mode dispatch. The mirror_only
--    body is byte-identical to 20260724061000; only the mode guard changes:
--    link_approved now dispatches to the pinned Phase 4 wrapper instead of
--    raising, and promote_approved (Phase 5) still raises loudly.
-- =====================================================================================
drop function if exists public.sync_coldlion_licensors_properties(jsonb, text);
drop function if exists plm.sync_coldlion_licensors_properties(jsonb, text);

create or replace function plm.sync_coldlion_licensors_properties(
  p_snapshot jsonb,
  p_mode text default 'mirror_only',
  p_link_expected jsonb default null
)
returns table (
  sync_run_id             uuid,
  mode                    text,
  rows_seen               integer,
  rows_inserted           integer,
  rows_updated            integer,
  rows_unchanged          integer,
  licensor_rows           integer,
  property_rows           integer,
  division_count          integer,
  cross_entity_collisions integer,
  snapshot_hash           text
)
language plpgsql
security definer
set search_path = plm, ingest, app, extensions, public
as $$
declare
  v_sync_id        uuid;
  v_mode           text := coalesce(p_mode, 'mirror_only');
  v_company        text;
  v_headers        jsonb;
  v_details        jsonb;
  v_pairs          jsonb;
  v_pages          jsonb;
  v_config         jsonb;
  v_prior          jsonb;
  v_header_div     text[];
  v_required_div   text[];
  v_lic_floor      integer;
  v_prop_floor     integer;
  v_drop_pct       integer;
  v_pair_div       text;
  v_pair_type      text;
  v_pair_entity    text;
  v_meaning        text;
  v_seen           integer := 0;
  v_ins            integer := 0;
  v_upd            integer := 0;
  v_unch           integer := 0;
  v_lic_ins        integer := 0;
  v_lic_upd        integer := 0;
  v_lic_unch       integer := 0;
  v_lic_total      integer := 0;
  v_prop_ins       integer := 0;
  v_prop_upd       integer := 0;
  v_prop_unch      integer := 0;
  v_prop_total     integer := 0;
  v_collisions     integer := 0;
  v_prior_lic      integer;
  v_prior_prop     integer;
  v_snapshot_hash  text;
  v_term_bad       integer;
  v_division_count integer;
  v_divisions_fetched text[];
begin
  -- ------------------------------------------------------------------
  -- 0. Mode dispatch (§6.4): mirror_only = Phase 2 mirror import;
  --    link_approved = Phase 4 approved linking (routed through the PINNED
  --    wrapper — only the exact approved expected contract is accepted);
  --    promote_approved = Phase 5, intentionally not implemented.
  -- ------------------------------------------------------------------
  if v_mode = 'link_approved' then
    return query
      select * from plm.link_coldlion_licensors_properties_approved(p_snapshot, p_link_expected);
    return;
  end if;

  if v_mode <> 'mirror_only' then
    raise exception
      'Unsupported mode %. Supported modes: mirror_only (Phase 2 mirror import) and link_approved (Phase 4 approved linking, requires the separate expected contract). promote_approved is Phase 5 and is intentionally not implemented.',
      v_mode
      using errcode = 'P0001';
  end if;

  if p_link_expected is not null then
    raise exception
      'p_link_expected is only valid with mode link_approved (mirror_only takes no approved-mapping contract)'
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_snapshot, 'null'::jsonb)) <> 'object' then
    raise exception 'snapshot must be a JSON object' using errcode = 'P0001';
  end if;

  v_company  := p_snapshot ->> 'companyCode';
  v_headers  := coalesce(p_snapshot -> 'headers', '[]'::jsonb);
  v_details  := coalesce(p_snapshot -> 'details', '[]'::jsonb);
  v_pairs    := coalesce(p_snapshot -> 'pairs',   '[]'::jsonb);
  v_pages    := coalesce(p_snapshot -> 'pages',   '[]'::jsonb);
  v_config   := coalesce(p_snapshot -> 'config',  '{}'::jsonb);
  v_prior    := p_snapshot -> 'prior';

  if jsonb_typeof(v_headers) <> 'array' or jsonb_typeof(v_details) <> 'array'
     or jsonb_typeof(v_pairs) <> 'array' or jsonb_typeof(v_pages) <> 'array' then
    raise exception 'snapshot headers/details/pairs/pages must each be a JSON array'
      using errcode = 'P0001';
  end if;

  if v_company is null or btrim(v_company) = '' then
    raise exception 'snapshot.companyCode is required' using errcode = 'P0001';
  end if;

  -- Empty-payload guard: never write the mirror on an empty/headers-less pull. The
  -- runner records the durable failure; the function simply refuses to proceed.
  if jsonb_array_length(v_headers) = 0 then
    raise exception 'refusing to run on an empty /merchGroupHeaders pull (would orphan the mirror)'
      using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_pairs) = 0 then
    raise exception 'no licensed licensor/property type pairs resolved from headers — required divisions missing or semantics changed'
      using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_details) = 0 then
    raise exception 'refusing to run on an empty /merchGroupDetails pull (would erase the mirror)'
      using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 1. Concurrency: serialize overlapping runs (manual trigger racing the
  --    schedule, double-fire, etc.) on a transaction-scoped advisory lock.
  -- ------------------------------------------------------------------
  perform pg_advisory_xact_lock(hashtext('plm.sync_coldlion_licensors_properties')::bigint);

  -- ------------------------------------------------------------------
  -- 2. Open the run-accounting row.
  -- ------------------------------------------------------------------
  insert into ingest.sync_run (source_system, source_name, status, started_at, metadata)
  values ('coldlion', 'coldlion_licensors_properties_api', 'running', now(),
          jsonb_build_object(
            'endpoint_group', 'merchGroupHeaders+merchGroupDetails',
            'company_code', v_company,
            'mode', v_mode,
            'stage', 'running',
            'phase', '2A'))
  returning id into v_sync_id;

  -- ------------------------------------------------------------------
  -- 3. Validate — every guard raises and rolls the transaction back.
  -- ------------------------------------------------------------------
  -- 3a. Required dictionary and licensed divisions (all configurable).
  v_header_div := coalesce(
    (select array_agg(trim(d)) from jsonb_array_elements_text(v_config -> 'headerDivisions') d
       where trim(d) <> ''),
    array['CW001', 'SP001', 'EH001', 'EP001']::text[]);
  v_required_div := coalesce(
    (select array_agg(trim(d)) from jsonb_array_elements_text(v_config -> 'requiredDivisions') d
       where trim(d) <> ''),
    array['CW001', 'SP001']::text[]);
  if array_length(v_required_div, 1) is null then
    raise exception 'config.requiredDivisions must list at least one licensed division'
      using errcode = 'P0001';
  end if;
  if array_length(v_header_div, 1) is null then
    raise exception 'config.headerDivisions must list at least one division'
      using errcode = 'P0001';
  end if;

  for v_pair_div in select unnest(v_header_div) loop
    if not exists (
      select 1 from jsonb_array_elements(v_headers) h(value)
      where (h.value ->> 'companyCode') = v_company
        and (h.value ->> 'divisionCode') = v_pair_div
    ) then
      raise exception 'configured header division % is missing', v_pair_div
        using errcode = 'P0001';
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(v_headers) h(value)
    group by h.value ->> 'companyCode', h.value ->> 'divisionCode', h.value ->> 'mgTypeCode'
    having count(*) <> 1
  ) then
    raise exception 'duplicate header natural key: each (company,division,mgTypeCode) must occur exactly once'
      using errcode = 'P0001';
  end if;

  -- 3b. Pagination completeness: every reported page must have reached the terminal page.
  select count(*) filter (where (p.value ->> 'terminalReached')::boolean is distinct from true)
    into v_term_bad
    from jsonb_array_elements(v_pages) p(value);
  if v_term_bad > 0 then
    raise exception 'incomplete pagination: % page set(s) did not reach a terminal page (silent page skip not allowed)',
      v_term_bad using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_pages) <> jsonb_array_length(v_pairs)
     or exists (
       select 1
       from jsonb_array_elements(v_pairs) p(value)
       where (
         select count(*)
         from jsonb_array_elements(v_pages) pg(value)
         where (pg.value ->> 'divisionCode') = (p.value ->> 'divisionCode')
           and (pg.value ->> 'mgTypeCode') = (p.value ->> 'mgTypeCode')
       ) <> 1
     ) then
    raise exception 'every licensed pair must have exactly one matching page-accounting record'
      using errcode = 'P0001';
  end if;

  -- 3c. Licensed-pair resolution. Each declared pair must exist in the fetched headers
  --     with the SAME normalized meaning. This is the guard that refuses to treat
  --     EH001/EP001 05/06 (Big Theme / Product Line ...) as licensor/property.
  for v_pair_div, v_pair_type, v_pair_entity in
      select (p.value ->> 'divisionCode'), (p.value ->> 'mgTypeCode'),
             (p.value ->> 'entityType')
      from jsonb_array_elements(v_pairs) p(value)
  loop
    if v_pair_type is null or v_pair_type !~ '^[0-9]{2}$' then
      raise exception 'pair mgTypeCode must be two digits (got %)', v_pair_type using errcode = 'P0001';
    end if;

    select lower(btrim(coalesce(h.value ->> 'mgTypeDesc', '')))
      into v_meaning
      from jsonb_array_elements(v_headers) h(value)
      where (h.value ->> 'companyCode')  = v_company
        and (h.value ->> 'divisionCode') = v_pair_div
        and (h.value ->> 'mgTypeCode')   = v_pair_type
      limit 1;

    if v_meaning not in ('licensor', 'property') then
      raise exception
        'semantic guard: (division %, mgTypeCode %) header means "%" — not a licensed licensor/property slot (do not treat EH001/EP001 05/06 as licensor/property)',
        v_pair_div, v_pair_type, v_meaning using errcode = 'P0001';
    end if;
    if v_meaning <> v_pair_entity then
      raise exception
        'semantic mismatch: pair declares entityType % but (division %, mgTypeCode %) header means %',
        v_pair_entity, v_pair_div, v_pair_type, v_meaning using errcode = 'P0001';
    end if;
  end loop;

  -- 3d. Every required division must resolve BOTH a Licensor and a Property pair.
  for v_pair_div in select unnest(v_required_div) loop
    if (
      select count(*) from jsonb_array_elements(v_pairs) p(value)
      where (p.value ->> 'divisionCode') = v_pair_div
        and (p.value ->> 'entityType') = 'licensor'
    ) <> 1 then
      raise exception 'required licensed division % must have exactly one Licensor pair', v_pair_div
        using errcode = 'P0001';
    end if;
    if (
      select count(*) from jsonb_array_elements(v_pairs) p(value)
      where (p.value ->> 'divisionCode') = v_pair_div
        and (p.value ->> 'entityType') = 'property'
    ) <> 1 then
      raise exception 'required licensed division % must have exactly one Property pair', v_pair_div
        using errcode = 'P0001';
    end if;
  end loop;

  -- 3e. Semantic stability across runs: a (division,type) slot that ALREADY means
  --     licensor/property in the dictionary must not have silently flipped meaning, and a
  --     slot incoming as licensor/property must not previously have meant something else.
  --     Compares incoming header descs against the existing plm.merch_group_header.
  if exists (
    select 1
    from jsonb_array_elements(v_headers) inc(value)
    join plm.merch_group_header existing
      on existing.company_code  = (inc.value ->> 'companyCode')
     and existing.division_code = (inc.value ->> 'divisionCode')
     and existing.mg_type_code  = (inc.value ->> 'mgTypeCode')
    where lower(btrim(existing.mg_type_desc)) <> lower(btrim(coalesce(inc.value ->> 'mgTypeDesc', '')))
      and (lower(btrim(existing.mg_type_desc)) in ('licensor','property')
           or lower(btrim(inc.value ->> 'mgTypeDesc')) in ('licensor','property'))
  ) then
    raise exception
      'semantic header change detected: a (division,mgTypeCode) slot flipped meaning involving a licensed licensor/property slot between runs — investigate before importing'
      using errcode = 'P0001';
  end if;

  -- 3f. Natural-key integrity: no two detail rows may share the composite key
  --     (company,division,type,code) with a DIFFERENT payload (conflicting duplicate).
  if exists (
    select 1
    from (
      select (d.value ->> 'companyCode') as cc, (d.value ->> 'divisionCode') as dc,
             (d.value ->> 'mgTypeCode') as tc, (d.value ->> 'mgCode') as code
      from jsonb_array_elements(v_details) d(value)
      group by cc, dc, tc, code
      having count(distinct d.value) > 1
    ) dup
  ) then
    raise exception 'conflicting duplicate natural key: same (company,division,mgTypeCode,mgCode) with differing payload inside one snapshot'
      using errcode = 'P0001';
  end if;

  -- 3g. Nonblank codes/names. The mirror CHECKs enforce this too; this gives a clean,
  --     pre-import message.
  if exists (
    select 1 from jsonb_array_elements(v_details) d(value)
    where coalesce(btrim(d.value ->> 'mgCode'), '') = ''
       or coalesce(btrim(d.value ->> 'mgDesc'), '') = ''
  ) then
    raise exception 'detail rows must carry nonblank mgCode and mgDesc'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_details) d(value)
    where (d.value ->> 'companyCode') is distinct from v_company
       or (
         select count(*)
         from jsonb_array_elements(v_pairs) p(value)
         where (p.value ->> 'divisionCode') = (d.value ->> 'divisionCode')
           and (p.value ->> 'mgTypeCode') = (d.value ->> 'mgTypeCode')
       ) <> 1
  ) then
    raise exception 'every detail row must belong to exactly one resolved licensed pair for snapshot.companyCode'
      using errcode = 'P0001';
  end if;

  -- 3h. Configurable absolute floors plus count-drop guard vs the prior successful run.
  v_lic_floor := coalesce((v_config ->> 'licensorFloor')::integer, 5);
  v_prop_floor := coalesce((v_config ->> 'propertyFloor')::integer, 20);
  v_drop_pct := coalesce((v_config ->> 'maxCountDropPct')::integer, 50);
  v_prior_lic  := nullif(v_prior  ->> 'licensorCount', '')::integer;
  v_prior_prop := nullif(v_prior ->> 'propertyCount', '')::integer;
  select count(*) filter (where exists (
           select 1 from jsonb_array_elements(v_pairs) q(value)
           where (q.value ->> 'divisionCode') = (d.value ->> 'divisionCode')
             and (q.value ->> 'mgTypeCode') = (d.value ->> 'mgTypeCode')
             and (q.value ->> 'entityType') = 'licensor')),
         count(*) filter (where exists (
           select 1 from jsonb_array_elements(v_pairs) q(value)
           where (q.value ->> 'divisionCode') = (d.value ->> 'divisionCode')
             and (q.value ->> 'mgTypeCode') = (d.value ->> 'mgTypeCode')
             and (q.value ->> 'entityType') = 'property'))
    into v_lic_total, v_prop_total
    from jsonb_array_elements(v_details) d(value)
    where (d.value ->> 'companyCode') = v_company
      ;

  if v_lic_total < v_lic_floor then
    raise exception 'short licensor pull: % rows is below configured floor %',
      v_lic_total, v_lic_floor using errcode = 'P0001';
  end if;
  if v_prop_total < v_prop_floor then
    raise exception 'short property pull: % rows is below configured floor %',
      v_prop_total, v_prop_floor using errcode = 'P0001';
  end if;

  if v_prior_lic is not null and v_prior_lic > 0
     and v_lic_total < (v_prior_lic * (100 - v_drop_pct) / 100.0) then
    raise exception 'licensor count dropped from % to % (exceeds % percent drop threshold) — investigate before importing',
      v_prior_lic, v_lic_total, v_drop_pct using errcode = 'P0001';
  end if;
  if v_prior_prop is not null and v_prior_prop > 0
     and v_prop_total < (v_prior_prop * (100 - v_drop_pct) / 100.0) then
    raise exception 'property count dropped from % to % (exceeds % percent drop threshold) — investigate before importing',
      v_prior_prop, v_prop_total, v_drop_pct using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------
  -- 4. Refresh the all-division header dictionary (single dictionary — no second one).
  -- ------------------------------------------------------------------
  insert into plm.merch_group_header (
    company_code, division_code, mg_type_code, mg_type_desc,
    source_created_at, source_created_by, source_modified_at, source_modified_by,
    raw, source_hash, last_seen_at, last_sync_run_id
  )
  select (h.value ->> 'companyCode'), (h.value ->> 'divisionCode'),
         (h.value ->> 'mgTypeCode'), (h.value ->> 'mgTypeDesc'),
         nullif(h.value ->> 'createdTime','')::timestamptz, (h.value ->> 'createdUser'),
         nullif(h.value ->> 'modTime','')::timestamptz, (h.value ->> 'modUser'),
         h.value, md5(h.value::text), now(), v_sync_id
  from jsonb_array_elements(v_headers) h(value)
  on conflict (company_code, division_code, mg_type_code) do update set
    mg_type_desc       = excluded.mg_type_desc,
    source_created_at  = excluded.source_created_at,
    source_created_by  = excluded.source_created_by,
    source_modified_at = excluded.source_modified_at,
    source_modified_by = excluded.source_modified_by,
    raw                = excluded.raw,
    source_hash        = excluded.source_hash,
    last_seen_at       = now(),
    last_sync_run_id   = v_sync_id;

  -- ------------------------------------------------------------------
  -- 5. Bronze: land every detail raw row by encoded composite natural key.
  --    source_id is the deterministic, reversible encoding
  --    "<companyCode>/<divisionCode>/<mgTypeCode>/<mgCode>" — never mgCode alone (§4.3).
  -- ------------------------------------------------------------------
  insert into ingest.raw_record (sync_run_id, source_system, source_table, source_id, record_hash, payload, imported_at)
  select v_sync_id, 'coldlion', 'merchGroupDetails',
         concat_ws('/',
           (d.value ->> 'companyCode'),
           (d.value ->> 'divisionCode'),
           (d.value ->> 'mgTypeCode'),
           (d.value ->> 'mgCode')),
         md5(d.value::text), d.value, now()
  from jsonb_array_elements(v_details) d(value)
  on conflict (source_system, source_table, source_id) do update set
    sync_run_id = excluded.sync_run_id,
    record_hash = excluded.record_hash,
    payload     = excluded.payload,
    imported_at = excluded.imported_at;

  -- ------------------------------------------------------------------
  -- 6. Upsert the typed mirrors. Source-owned fields ONLY: name (mgDesc), source
  --    timestamps, raw, source_hash, last_seen, sync-run link. NEVER licensor_id /
  --    property_id, resolution_status, resolved_*, or any canonical field. Inserted /
  --    updated / unchanged accounting is computed BEFORE the upsert by joining the
  --    incoming projection against the existing mirror (a post-upsert join is ambiguous).
  -- ------------------------------------------------------------------
  -- 6a. Licensor accounting.
  select count(*),
         count(*) filter (where m.mg_code is null),
         count(*) filter (where m.mg_code is not null and m.source_hash is distinct from i.source_hash),
         count(*) filter (where m.mg_code is not null and m.source_hash is not distinct from i.source_hash)
    into v_lic_total, v_lic_ins, v_lic_upd, v_lic_unch
    from (
      select (d.value ->> 'companyCode') as company_code,
             (d.value ->> 'divisionCode') as division_code,
             (d.value ->> 'mgTypeCode') as mg_type_code,
             (d.value ->> 'mgCode') as mg_code,
             md5(d.value::text) as source_hash
      from jsonb_array_elements(v_details) d(value)
      where exists (
          select 1 from jsonb_array_elements(v_pairs) q(value)
          where (q.value ->> 'divisionCode') = (d.value ->> 'divisionCode')
            and (q.value ->> 'mgTypeCode')   = (d.value ->> 'mgTypeCode')
            and (q.value ->> 'entityType')   = 'licensor')
    ) i
    left join plm.erp_licensor m
      on m.company_code = i.company_code and m.division_code = i.division_code
     and m.mg_type_code = i.mg_type_code and m.mg_code = i.mg_code;

  -- 6b. Licensor upsert.
  insert into plm.erp_licensor (
    company_code, division_code, mg_type_code, mg_code, mg_type_desc, name,
    erp_created_at, erp_updated_at, raw, source_hash, last_seen_at, last_sync_run_id
  )
  select (d.value ->> 'companyCode'), (d.value ->> 'divisionCode'),
         (d.value ->> 'mgTypeCode'), (d.value ->> 'mgCode'),
         (select q.value ->> 'mgTypeDesc'
          from jsonb_array_elements(v_pairs) q(value)
          where (q.value ->> 'divisionCode') = (d.value ->> 'divisionCode')
            and (q.value ->> 'mgTypeCode') = (d.value ->> 'mgTypeCode')
            and (q.value ->> 'entityType') = 'licensor'),
         (d.value ->> 'mgDesc'),
         nullif(d.value ->> 'createdTime','')::timestamptz,
         nullif(d.value ->> 'modTime','')::timestamptz,
         d.value,
         md5(d.value::text),
         now(), v_sync_id
  from jsonb_array_elements(v_details) d(value)
  where exists (
      select 1 from jsonb_array_elements(v_pairs) q(value)
      where (q.value ->> 'divisionCode') = (d.value ->> 'divisionCode')
        and (q.value ->> 'mgTypeCode')   = (d.value ->> 'mgTypeCode')
        and (q.value ->> 'entityType')   = 'licensor')
  on conflict (company_code, division_code, mg_type_code, mg_code) do update set
    mg_type_desc     = excluded.mg_type_desc,
    name             = excluded.name,
    erp_created_at   = excluded.erp_created_at,
    erp_updated_at   = excluded.erp_updated_at,
    raw              = excluded.raw,
    source_hash      = excluded.source_hash,
    last_seen_at     = now(),
    last_sync_run_id = v_sync_id;

  -- 6c. Property accounting.
  select count(*),
         count(*) filter (where m.mg_code is null),
         count(*) filter (where m.mg_code is not null and m.source_hash is distinct from i.source_hash),
         count(*) filter (where m.mg_code is not null and m.source_hash is not distinct from i.source_hash)
    into v_prop_total, v_prop_ins, v_prop_upd, v_prop_unch
    from (
      select (d.value ->> 'companyCode') as company_code,
             (d.value ->> 'divisionCode') as division_code,
             (d.value ->> 'mgTypeCode') as mg_type_code,
             (d.value ->> 'mgCode') as mg_code,
             md5(d.value::text) as source_hash
      from jsonb_array_elements(v_details) d(value)
      where exists (
          select 1 from jsonb_array_elements(v_pairs) q(value)
          where (q.value ->> 'divisionCode') = (d.value ->> 'divisionCode')
            and (q.value ->> 'mgTypeCode')   = (d.value ->> 'mgTypeCode')
            and (q.value ->> 'entityType')   = 'property')
    ) i
    left join plm.erp_property m
      on m.company_code = i.company_code and m.division_code = i.division_code
     and m.mg_type_code = i.mg_type_code and m.mg_code = i.mg_code;

  -- 6d. Property upsert.
  insert into plm.erp_property (
    company_code, division_code, mg_type_code, mg_code, mg_type_desc, name,
    erp_created_at, erp_updated_at, raw, source_hash, last_seen_at, last_sync_run_id
  )
  select (d.value ->> 'companyCode'), (d.value ->> 'divisionCode'),
         (d.value ->> 'mgTypeCode'), (d.value ->> 'mgCode'),
         (select q.value ->> 'mgTypeDesc'
          from jsonb_array_elements(v_pairs) q(value)
          where (q.value ->> 'divisionCode') = (d.value ->> 'divisionCode')
            and (q.value ->> 'mgTypeCode') = (d.value ->> 'mgTypeCode')
            and (q.value ->> 'entityType') = 'property'),
         (d.value ->> 'mgDesc'),
         nullif(d.value ->> 'createdTime','')::timestamptz,
         nullif(d.value ->> 'modTime','')::timestamptz,
         d.value,
         md5(d.value::text),
         now(), v_sync_id
  from jsonb_array_elements(v_details) d(value)
  where exists (
      select 1 from jsonb_array_elements(v_pairs) q(value)
      where (q.value ->> 'divisionCode') = (d.value ->> 'divisionCode')
        and (q.value ->> 'mgTypeCode')   = (d.value ->> 'mgTypeCode')
        and (q.value ->> 'entityType')   = 'property')
  on conflict (company_code, division_code, mg_type_code, mg_code) do update set
    mg_type_desc     = excluded.mg_type_desc,
    name             = excluded.name,
    erp_created_at   = excluded.erp_created_at,
    erp_updated_at   = excluded.erp_updated_at,
    raw              = excluded.raw,
    source_hash      = excluded.source_hash,
    last_seen_at     = now(),
    last_sync_run_id = v_sync_id;

  v_seen := v_lic_total + v_prop_total;
  v_ins  := v_lic_ins  + v_prop_ins;
  v_upd  := v_lic_upd  + v_prop_upd;
  v_unch := v_lic_unch + v_prop_unch;

  -- ------------------------------------------------------------------
  -- 7. Cross-entity code-collision findings (the FR / 1P special case, §8.2).
  --    Purely source-driven: when one mgCode appears as BOTH a licensor and a property
  --    inside the same division, open a conflict finding on the property key so the row
  --    can never be auto cross-matched. The importer only opens/refreshes OPEN conflict
  --    findings; it never resolves them or touches canonical rows. A human override of
  --    the active finding's status is preserved (ON CONFLICT does not clobber status).
  -- ------------------------------------------------------------------
  insert into plm.taxonomy_resolution_review (
    entity_type, finding_scope, company_code, division_code, mg_type_code, mg_code,
    source_name, match_method, confidence, reason, evidence, status, resolution
  )
  select 'property', 'source',
         lic.company_code, lic.division_code, prop.mg_type_code, prop.mg_code,
         prop.mg_desc,
         'cross_entity_code', 'none',
         'mgCode ' || prop.mg_code || ' appears as both a licensor (' || lic.mg_desc
           || ') and a property (' || prop.mg_desc || ') in division ' || prop.division_code
           || '; do not cross-match entity types',
         jsonb_build_object(
           'collision', 'cross_entity_code',
           'licensor_mg_type_code', lic.mg_type_code,
           'licensor_mg_code', lic.mg_code,
           'licensor_name', lic.mg_desc,
           'property_mg_type_code', prop.mg_type_code,
           'property_mg_code', prop.mg_code,
           'property_name', prop.mg_desc),
         'conflict', 'conflict'
  from (
    select (d.value ->> 'companyCode') as company_code,
           (d.value ->> 'divisionCode') as division_code,
           (d.value ->> 'mgTypeCode') as mg_type_code,
           (d.value ->> 'mgCode') as mg_code,
           (d.value ->> 'mgDesc') as mg_desc
    from jsonb_array_elements(v_details) d(value)
    where exists (
      select 1 from jsonb_array_elements(v_pairs) q(value)
      where (q.value ->> 'divisionCode') = (d.value ->> 'divisionCode')
        and (q.value ->> 'mgTypeCode') = (d.value ->> 'mgTypeCode')
        and (q.value ->> 'entityType') = 'licensor')
  ) lic
  join (
    select (d.value ->> 'companyCode') as company_code,
           (d.value ->> 'divisionCode') as division_code,
           (d.value ->> 'mgTypeCode') as mg_type_code,
           (d.value ->> 'mgCode') as mg_code,
           (d.value ->> 'mgDesc') as mg_desc
    from jsonb_array_elements(v_details) d(value)
    where exists (
      select 1 from jsonb_array_elements(v_pairs) q(value)
      where (q.value ->> 'divisionCode') = (d.value ->> 'divisionCode')
        and (q.value ->> 'mgTypeCode') = (d.value ->> 'mgTypeCode')
        and (q.value ->> 'entityType') = 'property')
  ) prop
    on prop.company_code = lic.company_code
   and prop.division_code = lic.division_code
   and prop.mg_code = lic.mg_code
  on conflict (entity_type, company_code, division_code, mg_type_code, mg_code)
    where finding_scope = 'source' and status in ('open', 'quarantined', 'conflict')
  do update set
    match_method = excluded.match_method,
    confidence   = excluded.confidence,
    reason       = excluded.reason,
    evidence     = excluded.evidence,
    updated_at   = now();

  get diagnostics v_collisions = row_count;

  -- ------------------------------------------------------------------
  -- 8. Snapshot hash (replayability evidence) over the stable field set, plus the
  --    set of divisions actually mirrored (for run accounting).
  -- ------------------------------------------------------------------
  select coalesce(md5(string_agg(
    md5(d.value::text),
    '|' order by (d.value ->> 'divisionCode'), (d.value ->> 'mgTypeCode'), (d.value ->> 'mgCode')
  )), md5('')) into v_snapshot_hash
  from jsonb_array_elements(v_details) d(value);

  select coalesce(array_agg(distinct div order by div), '{}'::text[]) into v_divisions_fetched
  from (select (d.value ->> 'divisionCode') as div
        from jsonb_array_elements(v_details) d(value)) s;
  v_division_count := coalesce(array_length(v_divisions_fetched, 1), 0);

  -- ------------------------------------------------------------------
  -- 9. Complete run accounting.
  -- ------------------------------------------------------------------
  update ingest.sync_run
  set status = 'succeeded',
      finished_at = now(),
      rows_seen = v_seen,
      rows_inserted = v_ins,
      rows_updated = v_upd,
      rows_failed = 0,
      metadata = metadata || jsonb_build_object(
        'stage', 'succeeded',
        'mode', v_mode,
        'company_code', v_company,
        'header_divisions', to_jsonb(v_header_div),
        'required_divisions', to_jsonb(v_required_div),
        'divisions_fetched', to_jsonb(v_divisions_fetched),
        'licensor_rows', v_lic_total,
        'property_rows', v_prop_total,
        'rows_inserted', v_ins,
        'rows_updated', v_upd,
        'rows_unchanged', v_unch,
        'licensor_inserted', v_lic_ins,
        'licensor_updated', v_lic_upd,
        'licensor_unchanged', v_lic_unch,
        'property_inserted', v_prop_ins,
        'property_updated', v_prop_upd,
        'property_unchanged', v_prop_unch,
        'cross_entity_collisions', v_collisions,
        'snapshot_hash', v_snapshot_hash,
        'prior_run', v_prior,
        'licensor_floor', v_lic_floor,
        'property_floor', v_prop_floor,
        'count_drop_threshold_pct', v_drop_pct)
  where id = v_sync_id;

  return query select v_sync_id, v_mode, v_seen, v_ins, v_upd, v_unch,
                      v_lic_total, v_prop_total, v_division_count, v_collisions, v_snapshot_hash;

exception when others then
  -- Rolls back with the caller transaction (this is the durable-failure root cause).
  -- The RUNNER records the committed failed sync_run + two-consecutive alert in a
  -- separate transaction via coldlion-sync-common.mjs buildFailedSyncRunSql.
  if v_sync_id is not null then
    update ingest.sync_run
      set status = 'failed', finished_at = now(), error = sqlerrm,
          metadata = metadata || jsonb_build_object('stage', 'failed', 'mode', v_mode)
      where id = v_sync_id;
  end if;
  raise;
end;
$$;

comment on function plm.sync_coldlion_licensors_properties(jsonb, text, jsonb) is
'Guarded ColdLion licensed-division licensor/property lane with the §6.4 mode dispatch. mirror_only (Phase 2A, unchanged): validates mode, payload, required divisions, licensed-pair resolution, semantic header stability, terminal pagination, composite-key integrity, nonblank codes/names, configurable count-drop band, advisory-lock serialization; writes ONLY ingest.raw_record, plm.merch_group_header, plm.erp_licensor, plm.erp_property, OPEN cross-entity-collision findings, and ingest.sync_run. link_approved (Phase 4): delegates to plm.link_coldlion_licensors_properties_approved with the separate expected contract — adds approved coldlion source refs + typed mirror links only. promote_approved (Phase 5): intentionally not implemented. mirror_only never writes core.licensor, core.property, core.property.licensor_id, canonical status/UUIDs, or core.taxonomy_source_ref; link_approved never creates or rewrites canonical rows.';

-- =====================================================================================
-- 3. public wrapper (AGENTS §8.1) — serverless caller uses the service-role key,
--    not a raw DB password.
-- =====================================================================================
create or replace function public.sync_coldlion_licensors_properties(
  p_snapshot jsonb,
  p_mode text default 'mirror_only',
  p_link_expected jsonb default null
)
returns table (
  sync_run_id             uuid,
  mode                    text,
  rows_seen               integer,
  rows_inserted           integer,
  rows_updated            integer,
  rows_unchanged          integer,
  licensor_rows           integer,
  property_rows           integer,
  division_count          integer,
  cross_entity_collisions integer,
  snapshot_hash           text
)
language plpgsql
security definer
set search_path = public, plm
as $$
begin
  return query select * from plm.sync_coldlion_licensors_properties(p_snapshot, p_mode, p_link_expected);
end;
$$;

comment on function public.sync_coldlion_licensors_properties(jsonb, text, jsonb) is
'Thin SECURITY DEFINER wrapper over plm.sync_coldlion_licensors_properties so a serverless/service-role caller uses the guarded lane without a raw DB password. Modes: mirror_only (Phase 2) and link_approved (Phase 4 — requires the separate expected contract, pinned to the exact approved set). promote_approved (Phase 5) is intentionally not implemented.';

-- =====================================================================================
-- 4. Privileges — service_role only, and ONLY through the pinned paths. The deep
--    Phase 4 core is deliberately UNGRANTED: the database owner (migrations) and
--    rolled-back contract tests call it directly, and the SECURITY DEFINER pinned
--    wrapper reaches it as owner. Browser roles (anon/authenticated) can never
--    trigger an import, a link run, or the core.
-- =====================================================================================
revoke all on function plm.link_coldlion_licensors_properties_core(jsonb, jsonb) from public;
revoke all on function plm.link_coldlion_licensors_properties_core(jsonb, jsonb) from service_role, authenticated, anon;
revoke all on function plm.link_coldlion_licensors_properties_approved(jsonb, jsonb) from public;
revoke all on function plm.sync_coldlion_licensors_properties(jsonb, text, jsonb) from public;
revoke all on function public.sync_coldlion_licensors_properties(jsonb, text, jsonb) from public;
grant execute on function plm.link_coldlion_licensors_properties_approved(jsonb, jsonb) to service_role;
grant execute on function plm.sync_coldlion_licensors_properties(jsonb, text, jsonb) to service_role;
grant execute on function public.sync_coldlion_licensors_properties(jsonb, text, jsonb) to service_role;

-- =====================================================================================
-- 5. Read-only run-accounting surface — now includes Phase 4 link runs alongside
--    Phase 2 mirror runs (the link lane uses its own source_name so the mirror
--    count-drop guard never mistakes a link run for a prior pull).
-- =====================================================================================
create or replace function api.coldlion_licensor_property_run_list(p_limit integer default 50)
returns setof ingest.sync_run
language sql
stable
security definer
set search_path = api, ingest, app
as $$
  select *
  from ingest.sync_run
  where app.has_role('administrator')
    and source_name in ('coldlion_licensors_properties_api', 'coldlion_licensors_properties_link_approved')
  order by started_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

comment on function api.coldlion_licensor_property_run_list(integer) is
'Read-only, admin-gated list of ColdLion licensor/property sync runs: Phase 2 mirror_only imports (coldlion_licensors_properties_api) and Phase 4 link_approved runs (coldlion_licensors_properties_link_approved). Surfaces run accounting (counts, snapshot/approved-mapping hash, mode, prior-run comparison) to DB Data Admin. plm/ingest are not PostgREST-exposed.';

revoke all on function api.coldlion_licensor_property_run_list(integer) from public;
grant execute on function api.coldlion_licensor_property_run_list(integer) to authenticated, service_role;
