-- =====================================================================================
-- Issue #597 Phase 1 — seed core.product_size from the legacy MG04 merch-group mirror.
--
-- WHAT THIS SEEDS, AND WHY THE NUMBERS ADD UP
-- -------------------------------------------
-- Measured on preview 2026-08-09 from `dflow."merchGroup"` where mgTypeCode = '04':
--
--   division  legacy rows  distinct codes
--   CW001         202          190
--   EH001         263          161
--   SP001         187          187
--   EP001           9            9     <- Pages, NOT Size. Excluded.
--   -----------------------------------
--   total         661          547
--
-- The three Size divisions hold 538 distinct MG04 identities. Eight of them are the
-- historical, retired Size codes named in issue #597 (CW001 5B/8H/TT and EH001
-- 5B/8T/ET/M8/TT). 538 − 8 = 530, which is EXACTLY the 530-row direct ColdLion feed
-- count recorded in the 2026-08-07 comparison evidence (SP001 187, EH001 156,
-- CW001 187). That arithmetic is the reason this seed can be done offline, from the
-- mirror, without a network call to ColdLion and without hand-transcribing 530 rows.
--
-- WHY THE MIRROR AND NOT THE LIVE FEED
-- ------------------------------------
-- A migration must produce the same result every time it runs, on every database,
-- forever. A migration that fetches from an HTTP API cannot promise that: the feed
-- moves, the key rotates, the network fails, and the resulting database state
-- depends on the day it was applied. So the migration seeds the deterministic
-- identity set from the mirror, and the SEPARATE guarded importer (20260809170300)
-- reconciles labels and lifecycle against the live ColdLion feed on demand.
--
-- LABELS AT SEED TIME ARE THE LEGACY LABELS, AND SAY SO
-- -----------------------------------------------------
-- ColdLion is the authority for the label attached to an identity, and 11 labels are
-- known to differ from the legacy ones. Those 11 corrections arrive with the first
-- importer run. Until then every seeded row carries label_source =
-- 'designflow_legacy_mirror', so nothing has to guess whether a label is current.
-- Pretending the legacy label came from ColdLion would be the silent-failure version
-- of this, and it is exactly what the label_source column exists to prevent.
--
-- IDEMPOTENT. Re-running upserts on the identity tuple and re-asserts the counts.
-- =====================================================================================

do $$
declare
  -- Pinned to MIDDAY UTC on purpose. This database runs America/New_York; a
  -- midnight-UTC timestamp reads back through ::date as the PREVIOUS day, which has
  -- already produced wrong date evidence in this repo.
  v_retired_at constant timestamptz := timestamptz '2026-08-09 12:00:00+00';

  v_size_divisions constant text[] := array['CW001', 'EH001', 'SP001'];
  v_company        constant text   := 'EDGEHOME';

  v_expected_identities constant integer := 538;
  v_expected_active     constant integer := 530;
  v_expected_inactive   constant integer := 8;

  v_src_identities integer;
  v_src_rows       integer;
  v_ep001_leak     integer;
  v_historical_hit integer;
  v_after_total    integer;
  v_after_active   integer;
  v_after_inactive integer;
  v_after_refs     integer;
begin
  if to_regclass('dflow."merchGroup"') is null then
    raise exception
      'core.product_size seed aborted: dflow."merchGroup" does not exist on this database'
      using errcode = 'P0001';
  end if;

  -- The eight historical retired Size identities, named by the owner in issue #597.
  create temporary table tmp_ps_historical (division_code text, code text) on commit drop;
  insert into tmp_ps_historical (division_code, code) values
    ('CW001', '5B'), ('CW001', '8H'), ('CW001', 'TT'),
    ('EH001', '5B'), ('EH001', '8T'), ('EH001', 'ET'),
    ('EH001', 'M8'), ('EH001', 'TT');

  -- Collapse the legacy rows to one row per identity. `distinct on` with an explicit
  -- ORDER BY makes the winner deterministic (highest legacy mg_id = most recent),
  -- rather than whichever row the planner happened to emit first.
  create temporary table tmp_ps_source on commit drop as
  select distinct on (mg."companyCode_fk", mg."divisionCode_fk", mg."mgTypeCode", mg.mg_code)
    btrim(mg."companyCode_fk")  as company_code,
    btrim(mg."divisionCode_fk") as division_code,
    btrim(mg."mgTypeCode")      as mg_type_code,
    btrim(mg.mg_code)           as code,
    mg.mg_desc                  as legacy_label,
    mg.mg_id                    as winning_legacy_id
  from dflow."merchGroup" mg
  where mg."mgTypeCode" = '04'
    and btrim(mg."companyCode_fk") = v_company
    and btrim(mg."divisionCode_fk") = any (v_size_divisions)
    and mg.mg_code is not null and btrim(mg.mg_code) <> ''
    and mg.mg_desc is not null and btrim(mg.mg_desc) <> ''
  order by mg."companyCode_fk", mg."divisionCode_fk", mg."mgTypeCode", mg.mg_code, mg.mg_id desc;

  select count(*) into v_src_identities from tmp_ps_source;

  select count(*) into v_src_rows
  from dflow."merchGroup" mg
  where mg."mgTypeCode" = '04'
    and btrim(mg."companyCode_fk") = v_company
    and btrim(mg."divisionCode_fk") = any (v_size_divisions);

  -- GUARD 1 — identity count. A drifted mirror must stop the seed, not seed less.
  if v_src_identities <> v_expected_identities then
    raise exception
      'core.product_size seed aborted: legacy MG04 mirror yields % distinct Size identities across CW001/EH001/SP001, expected % (from % legacy rows). Re-derive the expected counts against the live mirror before changing this number.',
      v_src_identities, v_expected_identities, v_src_rows
      using errcode = 'P0001';
  end if;

  -- GUARD 2 — EP001 must not be present in the candidate set at all. The table also
  -- refuses it with a CHECK, so this is defence in depth; it fails with a message
  -- that names the actual problem instead of a constraint violation.
  select count(*) into v_ep001_leak
  from tmp_ps_source
  where upper(division_code) = 'EP001';

  if v_ep001_leak > 0 then
    raise exception
      'core.product_size seed aborted: % EP001 rows reached the Size candidate set. MG04 in EP001 means Pages, not Size.',
      v_ep001_leak
      using errcode = 'P0001';
  end if;

  -- GUARD 3 — all eight named historical identities must actually be present.
  -- Without this, a mirror missing them would seed 530 rows and look correct.
  select count(*) into v_historical_hit
  from tmp_ps_historical h
  join tmp_ps_source s
    on s.division_code = h.division_code and s.code = h.code;

  if v_historical_hit <> v_expected_inactive then
    raise exception
      'core.product_size seed aborted: found % of the % named historical Size identities in the legacy mirror',
      v_historical_hit, v_expected_inactive
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------------
  -- Seed
  -- ---------------------------------------------------------------------------------
  insert into core.product_size (
    company_code, division_code, mg_type_code, code,
    label, legacy_label, label_source,
    status, retired_at, metadata
  )
  select
    s.company_code, s.division_code, s.mg_type_code, s.code,
    s.legacy_label,     -- seeded label == legacy label; the importer supersedes it
    s.legacy_label,
    'designflow_legacy_mirror',
    case when h.code is null then 'active' else 'inactive' end::app.entity_status,
    case when h.code is null then null else v_retired_at end,
    jsonb_build_object(
      'seeded_by', 'shared-db migration 20260809170200',
      'issue', 597,
      'winning_legacy_mg_id', s.winning_legacy_id,
      'retained_as_historical_inactive', (h.code is not null)
    )
  from tmp_ps_source s
  left join tmp_ps_historical h
    on h.division_code = s.division_code and h.code = s.code
  on conflict (company_code, division_code, mg_type_code, code) do update
  set legacy_label = excluded.legacy_label,
      metadata     = core.product_size.metadata || excluded.metadata,
      updated_at   = now();
  -- NOTE: the upsert deliberately does NOT overwrite `label`, `label_source`,
  -- `status` or `retired_at`. Re-running this seed must never undo a ColdLion
  -- label correction or a curated lifecycle decision made after cutover.

  -- Provenance: one row per LEGACY row (not per identity), so the 652 legacy Size
  -- rows behind the 538 identities all remain resolvable by their original mg_id.
  insert into core.product_size_source_ref (
    product_size_id, source_system, source_table, source_id,
    source_code, source_label, source_is_active, metadata
  )
  select
    ps.id,
    'designflow',
    'merchGroup',
    mg.mg_id::text,
    btrim(mg.mg_code),
    mg.mg_desc,
    mg."is_active",
    jsonb_build_object(
      'mgTypeCode', mg."mgTypeCode",
      'divisionCode', btrim(mg."divisionCode_fk"),
      'companyCode', btrim(mg."companyCode_fk"),
      'legacy_mod_time', mg."modTime"
    )
  from dflow."merchGroup" mg
  join core.product_size ps
    on ps.company_code  = btrim(mg."companyCode_fk")
   and ps.division_code = btrim(mg."divisionCode_fk")
   and ps.mg_type_code  = btrim(mg."mgTypeCode")
   and ps.code          = btrim(mg.mg_code)
  where mg."mgTypeCode" = '04'
    and btrim(mg."divisionCode_fk") = any (v_size_divisions)
  on conflict (source_system, source_table, source_id) do update
  set product_size_id  = excluded.product_size_id,
      source_code      = excluded.source_code,
      source_label     = excluded.source_label,
      source_is_active = excluded.source_is_active,
      metadata         = core.product_size_source_ref.metadata || excluded.metadata,
      captured_at      = now();

  -- ---------------------------------------------------------------------------------
  -- Assert the RESULT, not the ledger.
  -- ---------------------------------------------------------------------------------
  select count(*),
         count(*) filter (where status = 'active'),
         count(*) filter (where status <> 'active')
    into v_after_total, v_after_active, v_after_inactive
    from core.product_size;

  select count(*) into v_after_refs
    from core.product_size_source_ref
    where source_system = 'designflow' and source_table = 'merchGroup';

  if v_after_total <> v_expected_identities then
    raise exception 'core.product_size seed FAILED: % rows after seeding, expected %',
      v_after_total, v_expected_identities using errcode = 'P0001';
  end if;

  if v_after_active <> v_expected_active then
    raise exception 'core.product_size seed FAILED: % active rows after seeding, expected %',
      v_after_active, v_expected_active using errcode = 'P0001';
  end if;

  if v_after_inactive <> v_expected_inactive then
    raise exception 'core.product_size seed FAILED: % inactive rows after seeding, expected %',
      v_after_inactive, v_expected_inactive using errcode = 'P0001';
  end if;

  -- Every one of the eight named historical identities must be present AND inactive.
  if exists (
    select 1
    from tmp_ps_historical h
    left join core.product_size ps
      on ps.division_code = h.division_code and ps.code = h.code and ps.mg_type_code = '04'
    where ps.id is null or ps.status = 'active'
  ) then
    raise exception
      'core.product_size seed FAILED: at least one of the eight named historical Size identities is missing or still active'
      using errcode = 'P0001';
  end if;

  -- No EP001 identity may exist under any circumstances.
  if exists (select 1 from core.product_size where upper(division_code) = 'EP001') then
    raise exception
      'core.product_size seed FAILED: an EP001 (Pages) identity is present in core.product_size'
      using errcode = 'P0001';
  end if;

  raise notice
    'core.product_size seeded: % identities (% active, % inactive), % legacy source refs.',
    v_after_total, v_after_active, v_after_inactive, v_after_refs;
end;
$$;
