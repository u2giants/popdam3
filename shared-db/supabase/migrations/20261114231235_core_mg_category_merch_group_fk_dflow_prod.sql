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
--
-- Replaces version 20261113192227 (PR #6254), which exhausted its automatic
-- promotion attempts and was never applied to any ledger (read 2026-11-14):
-- the production preview rehearsal
-- refused four times because preview's dflow_prod."merchGroup" holds 0 rows
-- (it is never seeded) while its link table holds 58. ONLY when
-- dflow_prod."merchGroup" is empty (preview, fresh databases) the orphan
-- refusal is skipped and the key is added NOT VALID, so existing rows are not
-- checked but every new row is. Wherever the table holds any row (production:
-- 4,417), the full orphan refusal and a validated key apply unchanged.
-- Rollback: drop the constraint and re-add it referencing
-- core."merchGroup"(mg_id) on delete cascade.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $check$
declare
  n bigint;
  parent_empty boolean;
begin
  if to_regclass('dflow_prod."merchGroup"') is null then
    raise exception '#6252/20261114231235 self-check: dflow_prod."merchGroup" is missing; wrong database for the production half (non-production half is 20261113192216)'
      using errcode = 'feature_not_supported';
  end if;
  parent_empty := not exists (select 1 from dflow_prod."merchGroup");
  alter table core.mg_category_merch_group
    drop constraint if exists mg_category_merch_group_merch_group_mg_id_fkey;
  if parent_empty then
    raise notice '#6252/20261114231235: dflow_prod."merchGroup" is empty (unseeded preview or fresh database); adding the key NOT VALID, orphan check skipped';
    alter table core.mg_category_merch_group
      add constraint mg_category_merch_group_merch_group_mg_id_fkey
      foreign key (merch_group_mg_id) references dflow_prod."merchGroup"(mg_id)
      on delete cascade not valid;
    return;
  end if;
  select count(*) into n
  from core.mg_category_merch_group l
  where not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = l.merch_group_mg_id);
  if n <> 0 then
    raise exception '#6252/20261114231235: % mg_category_merch_group rows reference merchandise groups absent from dflow_prod."merchGroup"; refuse (nothing deleted)', n
      using errcode = 'foreign_key_violation';
  end if;
  alter table core.mg_category_merch_group
    add constraint mg_category_merch_group_merch_group_mg_id_fkey
    foreign key (merch_group_mg_id) references dflow_prod."merchGroup"(mg_id)
    on delete cascade;
end
$check$;

commit;
