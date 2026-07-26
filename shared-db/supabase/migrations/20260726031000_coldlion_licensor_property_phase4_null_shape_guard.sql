-- Phase 4 corrective migration — null-safe JSON shape guards in the UNGRANTED core.
-- Migration: 20260726031000_coldlion_licensor_property_phase4_null_shape_guard.sql
--
-- Why this exists
-- --------------
-- Preview rollback-contract execution of the Phase 4 suite found a real bug in
-- plm.link_coldlion_licensors_properties_core (shipped in 20260726030000, already
-- applied to preview — per AGENTS §4.4 the applied migration is never edited):
--
--   if jsonb_typeof(v_mappings) <> 'array' then ...
--
-- v_mappings is p_input -> 'mappings', which is SQL NULL when the key is missing.
-- jsonb_typeof(NULL) is NULL, and NULL <> 'array' evaluates UNKNOWN, so the guard
-- silently passed and the documented rejection ('link_approved input.mappings must
-- be a JSON array') never fired — validation then degraded into downstream NULL
-- propagation instead of the documented typed failure.
--
-- Fix: the JSON type checks in this function compare with IS DISTINCT FROM, so a
-- NULL/missing value trips the documented guard. For every non-NULL input the
-- comparison is exactly equivalent to the old <> form, so all other behavior is
-- unchanged. The function is CREATE OR REPLACEd with the SAME signature, owner,
-- SECURITY DEFINER, and search_path as 20260726030000, and it remains UNGRANTED
-- (owner-only; the pinned wrapper reaches it as owner; privileges are preserved
-- by CREATE OR REPLACE and re-asserted below for documentation).
--
-- Changed lines (3), relative to 20260726030000:
--   section 0 expected-contract check:  jsonb_typeof(coalesce(p_expected,'null'::jsonb)) <> 'object'  -> is distinct from 'object'
--   section 1 input check:              jsonb_typeof(coalesce(p_input,'null'::jsonb)) <> 'object'     -> is distinct from 'object'
--   section 1 mappings check (the bug): jsonb_typeof(v_mappings) <> 'array'                           -> is distinct from 'array'

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
  if jsonb_typeof(coalesce(p_expected, 'null'::jsonb)) is distinct from 'object' then
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
  -- 1. Input shape. IS DISTINCT FROM: a NULL/missing mappings key must
  --    trip the documented guard (jsonb_typeof(NULL) is NULL, and
  --    NULL <> 'array' evaluates UNKNOWN and would silently pass).
  -- ------------------------------------------------------------------
  if jsonb_typeof(coalesce(p_input, 'null'::jsonb)) is distinct from 'object' then
    raise exception 'link_approved input must be a JSON object {approved_by, approved_at_utc, mappings[]}'
      using errcode = 'P0001';
  end if;
  v_mappings := p_input -> 'mappings';
  if jsonb_typeof(v_mappings) is distinct from 'array' then
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

-- Privileges: CREATE OR REPLACE preserves existing grants; the core was and stays
-- UNGRANTED. Re-asserted here so the invariant is explicit in this corrective file.
revoke all on function plm.link_coldlion_licensors_properties_core(jsonb, jsonb) from public;
revoke all on function plm.link_coldlion_licensors_properties_core(jsonb, jsonb) from service_role, authenticated, anon;
