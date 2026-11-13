-- derived-from: none
-- Claim popcre/shared-db#6252. Work issue popcre/designflow-item-master#205,
-- plan plan_merch-group-environment-parity.md step 3.1 item (b).
-- DesignFlow NON-PRODUCTION ONLY: project xupnyeifmpsacrqahwwm. Never applied
-- to shared preview or shared production; refuses wherever dflow_prod exists.
-- The production half is the paired version 20261113192227 (dflow_prod).
--
-- Why: 20261113040728 renamed core."merchGroup" to
-- core."merchGroup_retired_20261112"; the foreign key
-- core.mg_category_merch_group.merch_group_mg_id followed the table by OID, so
-- merchandise groups created in dflow."merchGroup" since the switch cannot be
-- given a category. This repoints the same-named key to dflow."merchGroup".
--
-- Read-only before authoring (2026-11-13 11:20 AM EST): 58 link rows, 0 whose
-- merch_group_mg_id is absent from dflow."merchGroup". The self-check below
-- refuses (never deletes) if any orphan appears before apply.
-- Nothing is renamed or dropped except the one constraint being replaced.
-- api.resolve_item_mg_category is not touched.
-- Rollback: drop the constraint and re-add it referencing
-- core."merchGroup_retired_20261112"(mg_id) on delete cascade.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $check$
declare
  n bigint;
begin
  if to_regnamespace('dflow_prod') is not null then
    raise exception '#6252/20261113192216 self-check: schema dflow_prod exists here; this migration is DesignFlow non-production only (production half is 20261113192227)'
      using errcode = 'feature_not_supported';
  end if;
  if to_regclass('dflow."merchGroup"') is null then
    raise exception '#6252/20261113192216 self-check: dflow."merchGroup" is missing';
  end if;
  select count(*) into n
  from core.mg_category_merch_group l
  where not exists (select 1 from dflow."merchGroup" m where m.mg_id = l.merch_group_mg_id);
  if n <> 0 then
    raise exception '#6252/20261113192216: % mg_category_merch_group rows reference merchandise groups absent from dflow."merchGroup"; refuse (nothing deleted)', n
      using errcode = 'foreign_key_violation';
  end if;
end
$check$;

alter table core.mg_category_merch_group
  drop constraint mg_category_merch_group_merch_group_mg_id_fkey;

alter table core.mg_category_merch_group
  add constraint mg_category_merch_group_merch_group_mg_id_fkey
  foreign key (merch_group_mg_id) references dflow."merchGroup"(mg_id)
  on delete cascade;

commit;
