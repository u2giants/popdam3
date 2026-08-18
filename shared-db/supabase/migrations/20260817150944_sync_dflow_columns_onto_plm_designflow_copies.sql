set lock_timeout = '5s';
set statement_timeout = '5min';

alter table plm."RFQItem"
  add column if not exists "rfqItem_gen_fob_buyer_target" double precision,
  add column if not exists "rfqItem_gen_fob_buyer_margin" double precision,
  add column if not exists "rfqItem_gen_poe_buyer_target" double precision,
  add column if not exists "rfqItem_gen_poe_buyer_margin" double precision,
  add column if not exists "rfqItem_gen_whse_buyer_target" double precision,
  add column if not exists "rfqItem_gen_whse_buyer_margin" double precision,
  add column if not exists "rfqItem_gen_mddp_buyer_target" double precision,
  add column if not exists "rfqItem_gen_mddp_buyer_margin" double precision,
  add column if not exists "rfqItem_lic_fob_buyer_target" double precision,
  add column if not exists "rfqItem_lic_fob_buyer_margin" double precision,
  add column if not exists "rfqItem_lic_poe_buyer_target" double precision,
  add column if not exists "rfqItem_lic_poe_buyer_margin" double precision,
  add column if not exists "rfqItem_lic_whse_buyer_target" double precision,
  add column if not exists "rfqItem_lic_whse_buyer_margin" double precision,
  add column if not exists "rfqItem_lic_mddp_buyer_target" double precision,
  add column if not exists "rfqItem_lic_mddp_buyer_margin" double precision;

update plm."RFQItem" as p
set
  "rfqItem_gen_fob_buyer_target" = d."rfqItem_gen_fob_buyer_target",
  "rfqItem_gen_fob_buyer_margin" = d."rfqItem_gen_fob_buyer_margin",
  "rfqItem_gen_poe_buyer_target" = d."rfqItem_gen_poe_buyer_target",
  "rfqItem_gen_poe_buyer_margin" = d."rfqItem_gen_poe_buyer_margin",
  "rfqItem_gen_whse_buyer_target" = d."rfqItem_gen_whse_buyer_target",
  "rfqItem_gen_whse_buyer_margin" = d."rfqItem_gen_whse_buyer_margin",
  "rfqItem_gen_mddp_buyer_target" = d."rfqItem_gen_mddp_buyer_target",
  "rfqItem_gen_mddp_buyer_margin" = d."rfqItem_gen_mddp_buyer_margin",
  "rfqItem_lic_fob_buyer_target" = d."rfqItem_lic_fob_buyer_target",
  "rfqItem_lic_fob_buyer_margin" = d."rfqItem_lic_fob_buyer_margin",
  "rfqItem_lic_poe_buyer_target" = d."rfqItem_lic_poe_buyer_target",
  "rfqItem_lic_poe_buyer_margin" = d."rfqItem_lic_poe_buyer_margin",
  "rfqItem_lic_whse_buyer_target" = d."rfqItem_lic_whse_buyer_target",
  "rfqItem_lic_whse_buyer_margin" = d."rfqItem_lic_whse_buyer_margin",
  "rfqItem_lic_mddp_buyer_target" = d."rfqItem_lic_mddp_buyer_target",
  "rfqItem_lic_mddp_buyer_margin" = d."rfqItem_lic_mddp_buyer_margin"
from dflow."RFQItem" as d
where p."rfqItem_id" = d."rfqItem_id";

alter table plm."GridViewState"
  add column if not exists column_group_state jsonb;

update plm."GridViewState" as p
set column_group_state = d.column_group_state
from dflow."GridViewState" as d
where p.id = d.id;

alter table plm."itemDetail"
  add column if not exists coldlion_synced_at timestamptz,
  add column if not exists compan_code_fk integer,
  add column if not exists div_code_fk integer,
  add column if not exists item_num_id varchar(50);

update plm."itemDetail" as p
set
  coldlion_synced_at = d.coldlion_synced_at,
  compan_code_fk = d.compan_code_fk,
  div_code_fk = d.div_code_fk,
  item_num_id = d.item_num_id
from dflow."itemDetail" as d
where p.item_pk = d.item_pk;
