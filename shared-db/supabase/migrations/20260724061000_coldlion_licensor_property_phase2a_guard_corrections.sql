-- Phase 2A corrective migration — finalize independent completeness/raw-evidence guards.
-- Migration: 20260724061000_coldlion_licensor_property_phase2a_guard_corrections.sql
-- Plan: fix_coldlion_licensor_property_cutover.md (Phase 2 / §15.1 Phase 2A).
--
-- Why this is a separate timestamp
-- --------------
-- The first preview rehearsal applied 20260724060000 before review found that the
-- database-side implementation still needed to enforce configured all-division header
-- coverage, unique header keys, one page record per licensed pair, absolute count floors,
-- exact source payload hashing, and pair-based routing without adding mgTypeDesc to raw API
-- rows. Applied migrations are immutable, so this new migration re-declares the idempotent
-- Phase 2A functions with those final guards instead of rewriting preview history.
--
--   plm.sync_coldlion_licensors_properties(snapshot jsonb, mode text default 'mirror_only')
--       internal SECURITY DEFINER implementation. Validates the snapshot INDEPENDENTLY
--       of the runner (defense in depth) and upserts only Phase 1 mirror/evidence tables.
--   public.sync_coldlion_licensors_properties(snapshot jsonb, mode text)
--       thin SECURITY DEFINER wrapper so a serverless/service-role caller does not need
--       a raw DB password (AGENTS §8.1 — plm/ingest are not PostgREST-exposed).
--   api.coldlion_licensor_property_run_list(limit int)
--       read-only, admin-gated run-accounting surface (consistent with vendor precedent).
--
-- Mode contract: Phase 2A supports mirror_only ONLY. link_approved / promote_approved
-- are explicitly later phases (4/5); passing them here raises loudly.
--
-- Field-ownership contract (fix_coldlion_licensor_property_cutover.md §3, §5, §6.4)
--   This function may write ONLY:
--     * ingest.raw_record
--     * plm.merch_group_header            (refresh the division-aware header dictionary)
--     * plm.erp_licensor / plm.erp_property   (Phase 1 typed mirrors)
--     * plm.taxonomy_resolution_review    (OPEN conflict findings only — never resolve)
--     * ingest.sync_run                   (run accounting)
--   It MUST NOT write core.licensor, core.property, core.property.licensor_id,
--   core.*.status, core.taxonomy_source_ref, canonical UUIDs, aliases, parent edges,
--   or resolve any review finding. There is intentionally no link/create path here.
--
-- Guards enforced inside the function (§6.2) — independently of the runner:
--   * mode == 'mirror_only' (else raise)
--   * snapshot is a JSON object; headers/details/pairs/pages present and well-shaped
--   * non-empty headers and non-empty licensed entity sets
--   * required licensed divisions each carry one Licensor pair and one Property pair
--   * header dictionary keys unique; (company,division,type) -> single meaning
--   * semantic stability: a (division,type) that previously meant licensor/property must
--     still mean licensor/property (and must not be EH001/EP001 Big/Little Theme etc.)
--   * every fetched page reports terminalReached = true (no silent page skip)
--   * no composite natural-key collision with conflicting payload inside one snapshot
--   * nonblank mgCode and mgDesc on every detail row
--   * no unexplained count drop beyond the configurable threshold vs the prior run
--   * advisory-xact-lock so overlapping runs serialize
--   * empty payload aborts before any mirror write
--
-- Durable failure: like the guarded vendor sync, a failure inside this function rolls
-- back with the caller's transaction (including the in-function sync_run). The committed
-- durable failure row + two-consecutive alert is the RUNNER's job, recorded in a separate
-- transaction via coldlion-sync-common.mjs buildFailedSyncRunSql (source_name
-- 'coldlion_licensors_properties_api').

-- =====================================================================================
-- 1. Internal implementation
-- =====================================================================================
create or replace function plm.sync_coldlion_licensors_properties(
  p_snapshot jsonb,
  p_mode text default 'mirror_only'
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
  -- 0. Mode guard: Phase 2A is mirror_only only.
  -- ------------------------------------------------------------------
  if v_mode <> 'mirror_only' then
    raise exception
      'Phase 2A supports mirror_only mode only (received %). link_approved/promote_approved are introduced in later phases (4/5) and are intentionally not implemented here.',
      v_mode
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

comment on function plm.sync_coldlion_licensors_properties(jsonb, text) is
'MIRROR-ONLY guarded importer for ColdLion licensed-division licensor/property merch-group details into the Phase 1 typed mirrors. Validates mode, payload, required divisions, licensed-pair resolution, semantic header stability, terminal pagination, composite-key integrity, nonblank codes/names, configurable count-drop band, and serializes on an advisory lock. Writes ONLY ingest.raw_record, plm.merch_group_header, plm.erp_licensor, plm.erp_property, OPEN cross-entity-collision findings in plm.taxonomy_resolution_review, and ingest.sync_run. Never writes core.licensor, core.property, core.property.licensor_id, canonical status/UUIDs, or core.taxonomy_source_ref, and never resolves a review finding. Phase 2A: mirror_only only.';

-- =====================================================================================
-- 2. public wrapper (AGENTS §8.1) — serverless caller uses the service-role key,
--    not a raw DB password.
-- =====================================================================================
create or replace function public.sync_coldlion_licensors_properties(
  p_snapshot jsonb,
  p_mode text default 'mirror_only'
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
  return query select * from plm.sync_coldlion_licensors_properties(p_snapshot, p_mode);
end;
$$;

comment on function public.sync_coldlion_licensors_properties(jsonb, text) is
'Thin SECURITY DEFINER wrapper over plm.sync_coldlion_licensors_properties so a serverless/service-role caller imports the mirror without a raw DB password. mirror_only only (Phase 2A).';

revoke all on function plm.sync_coldlion_licensors_properties(jsonb, text) from public;
revoke all on function public.sync_coldlion_licensors_properties(jsonb, text) from public;
grant execute on function plm.sync_coldlion_licensors_properties(jsonb, text) to service_role;
grant execute on function public.sync_coldlion_licensors_properties(jsonb, text) to service_role;

-- =====================================================================================
-- 3. Read-only run-accounting surface (consistent with api.vendor_sync_run_list).
--    Admin-gated SECURITY DEFINER; ingests plm/ingest are not PostgREST-exposed.
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
    and source_name = 'coldlion_licensors_properties_api'
  order by started_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

comment on function api.coldlion_licensor_property_run_list(integer) is
'Read-only, admin-gated list of ColdLion licensor/property mirror-only sync runs (Phase 2A). Surfaces run accounting (counts, snapshot hash, mode, prior-run comparison) to DB Data Admin. plm/ingest are not PostgREST-exposed.';

revoke all on function api.coldlion_licensor_property_run_list(integer) from public;
grant execute on function api.coldlion_licensor_property_run_list(integer) to authenticated, service_role;
