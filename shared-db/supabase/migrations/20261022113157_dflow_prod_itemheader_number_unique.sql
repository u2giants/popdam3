-- Issue #4576: the database itself now guarantees DesignFlow item numbers are unique.
-- Before this, only app code (designflow-item-master#131) kept them unique.
--
-- item_num_id = ColdLion style number; ref_num = generated LIB- number.
-- Partial: NULL and blank values are ignored.
--
-- Scope: dflow_prod."itemHeader" only (the live DesignFlow table). The stale
-- copies dflow."itemHeader" and plm."itemHeader" still hold legacy duplicates
-- (1,421 item_num_id and 60/61 ref_num values on 2026-10-22), so they are not indexed.
-- Production duplicates were cleaned on 2026-10-22 and verified at zero.
--
-- Not CONCURRENTLY: migrations run inside a transaction and the table is ~18.8k
-- rows, so the build lock is brief.
-- Rollback: drop index dflow_prod.itemheader_item_num_id_uq, dflow_prod.itemheader_ref_num_uq;

create unique index if not exists itemheader_item_num_id_uq
  on dflow_prod."itemHeader" (item_num_id)
  where nullif(btrim(item_num_id), '') is not null;

create unique index if not exists itemheader_ref_num_uq
  on dflow_prod."itemHeader" (ref_num)
  where nullif(btrim(ref_num), '') is not null;
