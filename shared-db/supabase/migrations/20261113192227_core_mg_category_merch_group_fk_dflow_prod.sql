-- derived-from: none
-- Claim popcre/shared-db#6252. Work issue popcre/designflow-item-master#205,
-- plan plan_merch-group-environment-parity.md step 3.1 item (b).
-- PRODUCTION HALF (schema dflow_prod, project qsllyeztdwjgirsysgai). The
-- non-production half is the paired version 20261113192216 (schema dflow).
-- Promoted by the normal shared preview -> production lanes.
--
-- Why: production DesignFlow services read and write dflow_prod."merchGroup";
-- core."merchGroup" here is a stale copy. core.mg_category_merch_group's
-- merchandise-group key still references core."merchGroup", so groups created
-- in the app schema cannot be given a category. This repoints the same-named
-- key to dflow_prod."merchGroup". core."merchGroup" is not renamed or dropped.
--
-- Read-only before authoring (2026-11-13 11:15 AM EST): 58 link rows, 0 whose
-- merch_group_mg_id is absent from dflow_prod."merchGroup". The self-check
-- below refuses (never deletes) if any orphan appears before apply.
-- api.resolve_item_mg_category is not touched.
-- Rollback: drop the constraint and re-add it referencing
-- core."merchGroup"(mg_id) on delete cascade.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $check$
declare
  n bigint;
begin
  if to_regclass('dflow_prod."merchGroup"') is null then
    raise exception '#6252/20261113192227 self-check: dflow_prod."merchGroup" is missing; wrong database for the production half (non-production half is 20261113192216)'
      using errcode = 'feature_not_supported';
  end if;
  select count(*) into n
  from core.mg_category_merch_group l
  where not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = l.merch_group_mg_id);
  if n <> 0 then
    raise exception '#6252/20261113192227: % mg_category_merch_group rows reference merchandise groups absent from dflow_prod."merchGroup"; refuse (nothing deleted)', n
      using errcode = 'foreign_key_violation';
  end if;
end
$check$;

alter table core.mg_category_merch_group
  drop constraint mg_category_merch_group_merch_group_mg_id_fkey;

alter table core.mg_category_merch_group
  add constraint mg_category_merch_group_merch_group_mg_id_fkey
  foreign key (merch_group_mg_id) references dflow_prod."merchGroup"(mg_id)
  on delete cascade;

commit;
