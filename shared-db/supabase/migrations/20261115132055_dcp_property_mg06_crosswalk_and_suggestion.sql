-- Version: 20261115132055
-- Issue popcre/shared-db#6271 (claim) — DesignFlow Disney property-suggestion
-- (designflow-backend#408 steps 1-2).
--
-- Step 1: plm.dcp_property_mg06_crosswalk — maps each DCP film source_id to a
--   Coldlion MG06 mg_code (Disney divisions). Seeded only from existing exact
--   resolutions: dcp_opa_property_resolution (DCP -> OPA licensed_property_id)
--   joined to the OPA-to-MG06 mapping sheet (2026-10-15, reviewer-approved
--   Source ID column) and core.property exact code matches. Films whose chain
--   breaks are listed with confidence 'needs_review' or 'unmapped' — never
--   guessed.
--
-- Step 2: plm.suggested_property_for_sku(sku) — read-only ranked suggestion of
--   a SKU's Disney Property from the style-guide files it was made from. Built
--   on the 2026-11-10 back-test SQL with the Disney licensor restriction and
--   the crosswalk. Suggest-only; a person always confirms.

-- ============================================================
-- Step 1: crosswalk table
-- ============================================================

create table if not exists plm.dcp_property_mg06_crosswalk (
  dcp_source_id            text primary key,
  mg_code                  text,
  mg_desc                  text,
  opa_licensed_property_id bigint,
  provenance               text not null,
  confidence               text not null
    check (confidence in ('exact','strong_candidate','needs_review','unmapped')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table plm.dcp_property_mg06_crosswalk enable row level security;

-- Same role gate as every other plm.dcp_* table (dcp_vault_landing_contracts.sql
-- section C requires exactly one non-permissive SELECT policy to {authenticated}
-- with the common role gate).
create policy dcp_property_mg06_crosswalk_select
  on plm.dcp_property_mg06_crosswalk
  for select
  to authenticated
  using (
    app.has_role('administrator'::app.app_role)
    OR app.has_app_access('plm'::app.app_name)
    OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role])
  );

-- Read-only suggestion data: only the migration writes to this table.
-- Revoke UPDATE/DELETE from service_role to satisfy the plm.dcp_* privilege
-- contract (dcp_vault_landing_contracts.sql section B).
revoke update, delete on plm.dcp_property_mg06_crosswalk from service_role;
grant select on plm.dcp_property_mg06_crosswalk to authenticated;

comment on table plm.dcp_property_mg06_crosswalk is
  'DCP film source_id -> Coldlion MG06 mg_code crosswalk (Disney). '
  'Seeded from dcp_opa_property_resolution + OPA-to-MG06 mapping sheet + core.property. '
  'Suggest-only; Coldlion stays authoritative for MG codes.';
comment on column plm.dcp_property_mg06_crosswalk.dcp_source_id is
  'plm.dcp_property.source_id, e.g. dcpvault:properties/ar/aristocats';
comment on column plm.dcp_property_mg06_crosswalk.mg_code is
  'Coldlion MG06 mg_code (coldlion.merch_group_detail mg_type_code=06). NULL when unmapped.';
comment on column plm.dcp_property_mg06_crosswalk.confidence is
  'exact | strong_candidate | needs_review | unmapped';

-- Seed rows.
-- Chain: dcp_opa_property_resolution (DCP -> OPA, approved) joined to the
-- mapping sheet Source ID column (OPA -> MG06). confidence='exact' where the
-- sheet's Proposed Status is 'Exact unique'; 'strong_candidate' where the
-- sheet says 'Strong candidate, verify'.
--
-- lizzie-mcguire: chain DCP -> OPA 260 'Lizzie McGuire Movie' -> core.property
--   code MC1 'Lizzie McGuire Movie' (exact name match in core.property, whose
--   code IS the MG06 code). Not name-similarity: identical name + code column.
-- lion-king-the-umbrella: chain DCP -> OPA 139 'Lion King' has no MG06 in the
--   sheet. Back-test shows all 5 single-film SKUs use MG06 NG
--   'Lion King, The (2019)'. Recorded as needs_review, not exact.
-- robin-hood: chain DCP -> OPA 160 'Robin Hood'; no Robin Hood MG06 exists in
--   Coldlion. Recorded as unmapped (yields no suggestion, never a guess).

insert into plm.dcp_property_mg06_crosswalk
  (dcp_source_id, mg_code, mg_desc, opa_licensed_property_id, provenance, confidence)
values
  -- exact via mapping sheet (Proposed Status = 'Exact unique')
  ('dcpvault:properties/al/alice-in-wonderland',      'AW',  'Alice In Wonderland',
   99,          'opa_resolution+mapping_sheet', 'exact'),
  ('dcpvault:properties/ar/aristocats',               'AC',  'Aristocats',
   101,         'opa_resolution+mapping_sheet', 'exact'),
  ('dcpvault:properties/ca/cars',                     'CAR', 'Cars',
   177,         'opa_resolution+mapping_sheet', 'exact'),
  ('dcpvault:properties/di/disney-princess',          'PN',  'Disney Princess',
   52,          'opa_resolution+mapping_sheet', 'exact'),
  ('dcpvault:properties/di/disney-villains',          'DVN', 'Villains',
   57,          'opa_resolution+mapping_sheet', 'exact'),
  ('dcpvault:properties/en/encanto',                  'EC',  'Encanto',
   1159112952,  'opa_resolution+mapping_sheet', 'exact'),
  ('dcpvault:properties/fr/frozen',                   'FZ',  'Frozen',
   777,         'opa_resolution+mapping_sheet', 'exact'),
  ('dcpvault:properties/ho/hocus-pocus',              'HPS', 'Hocus Pocus',
   1017,        'opa_resolution+mapping_sheet', 'exact'),
  ('dcpvault:properties/mi/mickey-mouse-standard-character', 'MM', 'Standard Characters',
   361,         'opa_resolution+mapping_sheet', 'exact'),
  ('dcpvault:properties/ti/tim-burton-s-nightmare-before-christmas', 'NX', 'Nightmare Before Christmas',
   268,         'opa_resolution+mapping_sheet', 'exact'),
  ('dcpvault:properties/wi/winnie-the-pooh',          'WP',  'Winnie The Pooh',
   494,         'opa_resolution+mapping_sheet', 'exact'),
  ('dcpvault:properties/wi/wish',                     'WS',  'Wish',
   1159137990,  'opa_resolution+mapping_sheet', 'exact'),
  -- exact via core.property exact name+code (OPA 260 = MC1)
  ('dcpvault:properties/li/lizzie-mcguire',           'MC1', 'Lizzie McGuire Movie',
   260,         'opa_resolution+core_property_exact_name', 'exact'),
  -- strong candidate via mapping sheet ('Strong candidate, verify')
  ('dcpvault:properties/li/lilo-and-stitch-umbrella', 'LS',  'Disney Stitch Franchise',
   137,         'opa_resolution+mapping_sheet', 'strong_candidate'),
  -- needs_review: OPA 139 has no MG06; back-test confirms NG is what designers use
  ('dcpvault:properties/li/lion-king-the-umbrella',   'NG',  'Lion King, The (2019)',
   139,         'opa_resolution+backtest_evidence', 'needs_review'),
  -- unmapped: no Robin Hood MG06 exists in Coldlion
  ('dcpvault:properties/ro/robin-hood',               null,  null,
   160,         'opa_resolution_only', 'unmapped')
on conflict (dcp_source_id) do update
  set mg_code = excluded.mg_code,
      mg_desc = excluded.mg_desc,
      opa_licensed_property_id = excluded.opa_licensed_property_id,
      provenance = excluded.provenance,
      confidence = excluded.confidence,
      updated_at = now();

-- ============================================================
-- Step 2: suggested_property_for_sku
-- ============================================================

create or replace function plm.suggested_property_for_sku(p_sku text)
returns table (
  mg_code    text,
  mg_desc    text,
  file_count bigint,
  basis      text,
  file_names text[]
)
language sql
stable
as $function$
with
-- SKU's used files with a normalised name (lower, no extension)
files as (
  select distinct u.file_name,
         lower(regexp_replace(u.file_name, '\.[A-Za-z0-9]{2,5}$', '')) as norm_name
  from public.sku_files_used u
  where u.sku = p_sku
),
-- Match to DCP assets by normalised file name.  DCP assets are Disney-only
-- (DCP = Disney Consumer Products), so this join is inherently Disney.
-- Licensor restriction: the SKU's Coldlion MG05 licensor must be Disney
-- (mg_code DY or DS — one company, two spellings).  This removes
-- cross-licensor file-name collisions (Stitch file on a Care Bears SKU etc.).
-- Secondary check on the file's style-guide licensor where available.
dcp_match as (
  select f.file_name, a.id as asset_id
  from files f
  join plm.dcp_asset a
    on lower(regexp_replace(a.file_name, '\.[A-Za-z0-9]{2,5}$', '')) = f.norm_name
  where f.file_name in (
    select u2.file_name
    from public.sku_files_used u2
    left join public.style_guide_files sgf on sgf.id = u2.style_guide_file_id
    where u2.sku = p_sku
      and (sgf.licensor_name ilike '%disney%' or u2.style_guide_file_id is null)
  )
  -- SKU-level Disney restriction (MG05 = DY or DS)
  and exists (
    select 1 from coldlion.item_merch_group img
    where img.item_no = p_sku
      and img.slot_no = 5
      and img.mg_code in ('DY','DS')
  )
),
-- Film tags on those assets (ignoring classics)
films as (
  select distinct dm.file_name, p.source_id
  from dcp_match dm
  join plm.dcp_asset_property_observation o on o.dcp_asset_id = dm.asset_id
  join plm.dcp_property p on p.id = o.dcp_property_id
  where p.source_id <> 'dcpvault:properties/cl/classics'
),
-- Has classics tag?
has_classics as (
  select bool_or(p.source_id = 'dcpvault:properties/cl/classics') as val
  from dcp_match dm
  join plm.dcp_asset_property_observation o on o.dcp_asset_id = dm.asset_id
  join plm.dcp_property p on p.id = o.dcp_property_id
),
-- Count distinct non-classics films
nfilms as (
  select count(distinct source_id) as n from films
),
-- Map films to MG06 via the crosswalk (unmapped films yield no suggestion)
mapped as (
  select f.source_id, f.file_name, x.mg_code, x.mg_desc
  from films f
  join plm.dcp_property_mg06_crosswalk x on x.dcp_source_id = f.source_id
  where x.mg_code is not null
),
-- Aggregate per MG06
agg as (
  select m.mg_code,
         min(m.mg_desc) as mg_desc,
         count(distinct m.file_name) as file_count,
         array_agg(distinct m.file_name order by m.file_name) as file_names
  from mapped m
  group by m.mg_code
)
select a.mg_code,
       a.mg_desc,
       a.file_count,
       case
         when (select n from nfilms) <= 1 then 'single_film'
         when (select val from has_classics) then 'classics_multi'
         else 'multi_film'
       end as basis,
       a.file_names
from agg a
order by a.file_count desc, a.mg_code;
$function$;

comment on function plm.suggested_property_for_sku(text) is
  'Suggest a SKU Disney Property from its style-guide files. '
  'Ranked rows: mg_code, mg_desc, file_count, basis (single_film|multi_film|classics_multi), file_names. '
  'Suggest-only; designer confirms. Unmapped films yield no suggestion.';
