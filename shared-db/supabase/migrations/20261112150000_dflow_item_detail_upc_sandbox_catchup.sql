-- #6136 / designflow-backend #401: catch-up apply of the UPC item-identity
-- contract (20260803150000, PR #430) for the DesignFlow sandbox.
-- derived-from: 20260803150000
--
-- WHY THIS EXISTS
-- The DesignFlow sandbox project (xupnyeifmpsacrqahwwm) never received
-- 20260803150000: the guarded sandbox route (issue #3428) postdates that
-- migration and no back-fill ran. Verified read-only on 2026-11-12: the
-- sandbox has dflow."itemDetail" (21,841 rows) with none of the four
-- identity/sync columns and no dflow.item_detail_upc view, while production
-- (qsllyeztdwjgirsysgai) and preview both carry the version. item-master
-- POST /detail/getItemUpcs therefore answers HTTP 500
-- ("relation dflow.item_detail_upc does not exist") for every item id on
-- alsand (designflow-backend #401).
--
-- The sandbox route cannot bind to PR #430 itself: it requires the source
-- PR's exact-head required checks to pass today, and the August check names
-- no longer exist (dry-run run 43239160984 REFUSED). This migration replays
-- the exact 20260803150000 statements — verbatim, all idempotent — under a
-- new version so the guarded route can apply it and record its ledger row.
--
-- NO-OP WHERE THE CONTRACT ALREADY EXISTS
-- Every statement is IF NOT EXISTS / CREATE OR REPLACE, so on preview and
-- production (columns, index and view already present) this changes nothing.
-- Semantics, column comments and the fail-closed view filter are unchanged
-- from #430; nothing is renamed, dropped or backfilled.

alter table dflow."itemDetail"
  add column if not exists item_num_id       varchar(50),
  add column if not exists compan_code_fk    integer,
  add column if not exists div_code_fk       integer,
  add column if not exists coldlion_synced_at timestamptz;

comment on column dflow."itemDetail".item_num_id is
  'ColdLion itemNo. Populated by designflow-data-syncing remapItemDetail. NULL means the row predates that mapping and its item is unknown — never guess it from whse_sku_id.';
comment on column dflow."itemDetail".compan_code_fk is
  'ColdLion companyCode. Part of the (item_num_id, compan_code_fk, div_code_fk) identity triple used to join to dflow."itemHeader".';
comment on column dflow."itemDetail".div_code_fk is
  'ColdLion divisionCode. Part of the (item_num_id, compan_code_fk, div_code_fk) identity triple used to join to dflow."itemHeader".';
comment on column dflow."itemDetail".coldlion_synced_at is
  'When this row was last written from ColdLion. NULL = never re-synced since the mapping was added; the UPC on such a row is a pre-2024 snapshot and must not be presented as current.';

create index if not exists idx_itemdetail_coldlion_identity
  on dflow."itemDetail" (item_num_id, compan_code_fk, div_code_fk)
  where item_num_id is not null;

create or replace view dflow.item_detail_upc
with (security_invoker = true) as
select
  d.item_pk,
  d.item_num_id,
  d.compan_code_fk,
  d.div_code_fk,
  d."UPC"   as upc,
  d."EAN"   as ean,
  d."GTIN"  as gtin,
  d.color_code_fk,
  d.size_code_fk,
  d.size_seq,
  d.whse_sku_id,
  d.item_active_status,
  d.coldlion_synced_at
from dflow."itemDetail" d
where d.item_num_id is not null
  and coalesce(d."UPC", '') <> '';

comment on view dflow.item_detail_upc is
  'One row per ColdLion itemDetail record that has a UPC AND a resolved item identity. Join to dflow."itemHeader" on (item_num_id, compan_code_fk, div_code_fk). Fails closed: returns zero rows until designflow-data-syncing maps itemNo/companyCode/divisionCode and re-syncs, which is deliberate — showing a 2023 UPC as current is worse than showing nothing. Catch-up apply of 20260803150000 for the DesignFlow sandbox (#6136).';
