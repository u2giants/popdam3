-- derived-from: none
-- Claim popcre/shared-db#6345. Work issue popcre/designflow-item-master#205,
-- plan plan_merch-group-environment-parity.md step 3.2.
-- PRODUCTION SHAPE (schema dflow_prod), promoted by the normal shared preview ->
-- production lanes. Mirrors the non-production rename 20261113040728.
--
-- Why: production DesignFlow services read and write dflow_prod."merchGroup";
-- core."merchGroup" / "merchGroupHeaders" are stale copies. They are renamed,
-- never dropped, to core."merchGroup_retired_<YYYYMMDD>" and
-- core."merchGroupHeaders_retired_<YYYYMMDD>", the date being the apply date
-- (America/New_York), so a missed reader fails loudly. Dropping is a later,
-- separate step after 14 quiet days.
-- Not touched: core."merchGroup_11112026", dflow_prod."merchGroup_pr90_bad",
-- schema dflow_prod_old.
-- No-op where already retired (core."merchGroup" absent and a retired copy
-- present). Refuses if any foreign key from another table still references
-- either table (20261115060819 repointed the last ten), or if any view or
-- function depends on them.
-- Rollback: rename both tables back.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $retire$
declare
  sfx text := to_char(now() at time zone 'America/New_York', 'YYYYMMDD');
  n bigint;
begin
  if to_regnamespace('dflow_prod') is null or to_regclass('dflow_prod."merchGroup"') is null then
    raise exception '#205/20261115085448 self-check: dflow_prod."merchGroup" missing; production-shape migration only (non-production is 20261113040728)'
      using errcode = 'feature_not_supported';
  end if;

  if to_regclass('core."merchGroup"') is null and to_regclass('core."merchGroupHeaders"') is null then
    if exists (select 1 from pg_class c where c.relnamespace = 'core'::regnamespace
               and c.relname like 'merchGroup\_retired\_%') then
      raise notice '#205/20261115085448: core copies already retired; no-op';
      return;
    end if;
    raise exception '#205/20261115085448: core."merchGroup" and its retired copy are both absent; refuse'
      using errcode = 'undefined_table';
  end if;
  if to_regclass('core."merchGroup"') is null or to_regclass('core."merchGroupHeaders"') is null then
    raise exception '#205/20261115085448: only one of core."merchGroup" / "merchGroupHeaders" exists; refuse'
      using errcode = 'undefined_table';
  end if;

  lock table core."merchGroup", core."merchGroupHeaders" in access exclusive mode;

  select count(*) into n from pg_constraint
  where contype = 'f'
    and confrelid in ('core."merchGroup"'::regclass, 'core."merchGroupHeaders"'::regclass)
    and conrelid not in ('core."merchGroup"'::regclass, 'core."merchGroupHeaders"'::regclass);
  if n <> 0 then
    raise exception '#205/20261115085448: % foreign keys still reference the core copies; refuse', n
      using errcode = 'dependent_objects_still_exist';
  end if;

  select count(*) into n from pg_depend d join pg_rewrite r on r.oid = d.objid
  where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_class'::regclass
    and d.refobjid in ('core."merchGroup"'::regclass, 'core."merchGroupHeaders"'::regclass)
    and r.ev_class not in ('core."merchGroup"'::regclass, 'core."merchGroupHeaders"'::regclass);
  if n <> 0 then
    raise exception '#205/20261115085448: % views depend on the core copies; refuse', n
      using errcode = 'dependent_objects_still_exist';
  end if;

  execute format('alter table core."merchGroup" rename to %I', 'merchGroup_retired_' || sfx);
  execute format('alter table core."merchGroupHeaders" rename to %I', 'merchGroupHeaders_retired_' || sfx);
end
$retire$;

commit;
