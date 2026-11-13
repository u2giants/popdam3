-- derived-from: none
-- Claim #6225. Work issue popcre/designflow-item-master#205, plan
-- plan_merch-group-environment-parity.md step 2.2 (4) and decision D4.
-- DesignFlow NON-PRODUCTION ONLY: project xupnyeifmpsacrqahwwm. Never applied
-- to shared preview or shared production; refuses wherever dflow_prod exists.
--
-- Why: the twelve non-production services now read and write
-- dflow."merchGroup" (MERCH_GROUP_SCHEMA=dflow). The old core copies are
-- renamed, not dropped, so any reader that was missed fails loudly instead of
-- reading a stale list. Dropping them is plan step 3.2, after 14 quiet days.
-- core."merchGroup_11112026" is NOT touched (Uma's copy, plan Q3).
-- Refuses unless dflow and core are still identical (gate: comparison 0).
-- Foreign keys into core."merchGroup" (core.mg_category_merch_group) follow
-- the table by OID; nothing is deleted.
-- Rollback: rename both tables back (alter table ... rename to "merchGroup").

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $check$
begin
  if to_regnamespace('dflow_prod') is not null then
    raise exception '#205/20261113040728 self-check: schema dflow_prod exists here; this migration is DesignFlow non-production only'
      using errcode = 'feature_not_supported';
  end if;
end
$check$;

lock table core."merchGroup", core."merchGroupHeaders" in access exclusive mode;

do $parity$
declare
  n bigint;
begin
  if to_regclass('dflow."merchGroup"') is null or to_regclass('dflow."merchGroupHeaders"') is null then
    raise exception '#205/20261113040728 self-check: dflow."merchGroup" / "merchGroupHeaders" missing; refuse to retire the core copies';
  end if;
  select count(*) into n
  from core."merchGroup" c full join dflow."merchGroup" d using (mg_id)
  where c is distinct from d;
  if n <> 0 then
    raise exception '#205/20261113040728: core."merchGroup" differs from dflow in % rows; refuse to retire', n
      using errcode = 'check_violation';
  end if;
  select count(*) into n
  from core."merchGroupHeaders" c full join dflow."merchGroupHeaders" d using (id)
  where c is distinct from d;
  if n <> 0 then
    raise exception '#205/20261113040728: core."merchGroupHeaders" differs from dflow in % rows; refuse to retire', n
      using errcode = 'check_violation';
  end if;
end
$parity$;

alter table core."merchGroup" rename to "merchGroup_retired_20261112";
alter table core."merchGroupHeaders" rename to "merchGroupHeaders_retired_20261112";

commit;
