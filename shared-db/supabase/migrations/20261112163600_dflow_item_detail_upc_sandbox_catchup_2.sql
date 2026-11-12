-- #6136 / designflow-backend #401: reissue of the sandbox UPC catch-up as a
-- new reserved version.
-- derived-from: none
--
-- HISTORY
-- 20261112150000 (PR #6137, same #6136 claim) declared
-- `derived-from: 20260803150000`. It merged and the automatic promotion
-- applied it to preview and production (pure no-op: those databases already
-- hold the 20260803150000 contract). The DesignFlow sandbox route then
-- REFUSED it (dry-run run 43247505616): the sandbox ledger lacks the base
-- version 20260803150000, a re-derived body may not be applied to a database
-- missing its base, and the guard's override flag is not an input of the
-- sandbox workflow. The applied version cannot be edited (guard: a version is
-- applied once, fix forward under a new reserved version), so this file
-- reissues the exact same idempotent statements as a new version with a
-- from-scratch declaration.
--
-- WHY `none` IS ACCURATE
-- On the only database this version will actually change — the DesignFlow
-- sandbox (xupnyeifmpsacrqahwwm) — every object below is created FROM
-- SCRATCH: the sandbox has dflow."itemDetail" (21,841 rows) with none of the
-- four identity/sync columns, no partial index and no view (verified
-- read-only 2026-11-12). No prior body is replaced there. On preview and
-- production every statement is an IF NOT EXISTS / CREATE OR REPLACE no-op
-- over the identical 20260803150000 / 20261112150000 body.
--
-- BUSINESS CONTRACT (unchanged, from PR #430 / shared-db docs
-- upc-item-identity-contract.md): the join key from a UPC row to an item is
-- the full ColdLion identity triple (item_num_id, compan_code_fk,
-- div_code_fk), never the item number alone. No backfill: the identity
-- columns stay NULL until designflow-data-syncing maps itemNo/companyCode/
-- divisionCode and re-syncs, so the view fails closed (zero rows) until then.

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
  'One row per ColdLion itemDetail record that has a UPC AND a resolved item identity. Join to dflow."itemHeader" on (item_num_id, compan_code_fk, div_code_fk). Fails closed: returns zero rows until designflow-data-syncing maps itemNo/companyCode/divisionCode and re-syncs, which is deliberate — showing a 2023 UPC as current is worse than showing nothing. Catch-up for the DesignFlow sandbox (#6136; reissue of 20261112150000).';
