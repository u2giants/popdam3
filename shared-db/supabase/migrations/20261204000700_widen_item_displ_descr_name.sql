-- #6587: ColdLion item display descriptions exceed varchar(40) (longest 45,
-- 56 of 19,573 items on 2026-11-17), so the production item refresh rejects them.
-- Owner: DesignFlow must accept the full ColdLion text; never truncate.
-- Widening varchar needs no table rewrite and no data change. 100 leaves headroom.
alter table dflow_prod."itemHeader" alter column item_displ_descr_name type character varying(100);
alter table plm."itemHeader" alter column item_displ_descr_name type character varying(100);
