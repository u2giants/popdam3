-- derived-from: none
-- Claim #6224. Work issue popcre/designflow-item-master#205, plan
-- plan_merch-group-environment-parity.md step 2.2 (2): catch-up copy.
-- DesignFlow NON-PRODUCTION ONLY: project xupnyeifmpsacrqahwwm (sandbox,
-- develop and staging share it). Never applied to shared preview or shared
-- production; the self-check below refuses wherever dflow_prod exists.
--
-- Why: 20261111222527 made dflow."merchGroup" / "merchGroupHeaders" equal to
-- the live core copies on 2026-11-11. The twelve non-production services kept
-- writing core until tonight's switch, so rows changed in core since then
-- (read-only 2026-11-12 11:06 PM EST: 180 merchGroup rows, 8 header rows) are
-- copied again, by the same set-based statements, immediately before the
-- services are switched to dflow. ColdLion writes are paused for the switch.
-- NO ROW IS DELETED (D3); ids are preserved (D2). Idempotent.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $check$
begin
  if to_regnamespace('dflow_prod') is not null then
    raise exception '#205/20261113040717 self-check: schema dflow_prod exists here; this migration is DesignFlow non-production only'
      using errcode = 'feature_not_supported';
  end if;
end
$check$;

do $check2$
begin
  if to_regclass('core."merchGroup"') is null or to_regclass('dflow."merchGroup"') is null
     or to_regclass('core."merchGroupHeaders"') is null or to_regclass('dflow."merchGroupHeaders"') is null then
    raise exception '#205/20261113040717 self-check: a required merchGroup / merchGroupHeaders table is missing'
      using errcode = 'feature_not_supported';
  end if;
end
$check2$;

lock table core."merchGroup", core."merchGroupHeaders" in share mode;
lock table dflow."merchGroup", dflow."merchGroupHeaders" in exclusive mode;

update dflow."merchGroup" d
set mg_code = c.mg_code,
    mg_desc = c.mg_desc,
    "ItemNoCode" = c."ItemNoCode",
    "mgTypeCode" = c."mgTypeCode",
    "createdTime" = c."createdTime",
    "createdUser" = c."createdUser",
    "modTime" = c."modTime",
    "modUser" = c."modUser",
    "companyCode_fk" = c."companyCode_fk",
    "divisionCode_fk" = c."divisionCode_fk",
    "divisionCode_id_fk" = c."divisionCode_id_fk",
    "companyCode_id_fk" = c."companyCode_id_fk",
    is_active = c.is_active,
    parent_id = c.parent_id,
    "mgCode2" = c."mgCode2",
    "mgCategory" = c."mgCategory"
from core."merchGroup" c
where c.mg_id = d.mg_id
  and row(d.*) is distinct from row(c.*);

insert into dflow."merchGroup" (
  mg_id, mg_code, mg_desc, "ItemNoCode", "mgTypeCode", "createdTime", "createdUser",
  "modTime", "modUser", "companyCode_fk", "divisionCode_fk", "divisionCode_id_fk",
  "companyCode_id_fk", is_active, parent_id, "mgCode2", "mgCategory")
overriding system value
select
  c.mg_id, c.mg_code, c.mg_desc, c."ItemNoCode", c."mgTypeCode", c."createdTime", c."createdUser",
  c."modTime", c."modUser", c."companyCode_fk", c."divisionCode_fk", c."divisionCode_id_fk",
  c."companyCode_id_fk", c.is_active, c.parent_id, c."mgCode2", c."mgCategory"
from core."merchGroup" c
where not exists (select 1 from dflow."merchGroup" d where d.mg_id = c.mg_id)
order by c.mg_id;

update dflow."merchGroupHeaders" d
set "companyCode" = c."companyCode",
    "divisionCode" = c."divisionCode",
    "mgTypeCode" = c."mgTypeCode",
    "mgTypeDesc" = c."mgTypeDesc",
    "createdTime" = c."createdTime",
    "createdUser" = c."createdUser",
    "modTime" = c."modTime",
    "modUser" = c."modUser",
    "divisionCode_id_fk" = c."divisionCode_id_fk",
    "companyCode_id_fk" = c."companyCode_id_fk"
from core."merchGroupHeaders" c
where c.id = d.id
  and row(d.*) is distinct from row(c.*);

insert into dflow."merchGroupHeaders" (
  id, "companyCode", "divisionCode", "mgTypeCode", "mgTypeDesc", "createdTime", "createdUser",
  "modTime", "modUser", "divisionCode_id_fk", "companyCode_id_fk")
overriding system value
select
  c.id, c."companyCode", c."divisionCode", c."mgTypeCode", c."mgTypeDesc", c."createdTime", c."createdUser",
  c."modTime", c."modUser", c."divisionCode_id_fk", c."companyCode_id_fk"
from core."merchGroupHeaders" c
where not exists (select 1 from dflow."merchGroupHeaders" d where d.id = c.id)
order by c.id;

do $seq$
declare
  s text;
  m bigint;
begin
  s := pg_get_serial_sequence('dflow."merchGroup"', 'mg_id');
  select greatest(coalesce((select max(mg_id) from core."merchGroup"), 0),
                  coalesce((select max(mg_id) from dflow."merchGroup"), 0)) into m;
  if s is not null and m > 0 then
    perform setval(s, m, true);
  end if;
  s := pg_get_serial_sequence('dflow."merchGroupHeaders"', 'id');
  select greatest(coalesce((select max(id) from core."merchGroupHeaders"), 0),
                  coalesce((select max(id) from dflow."merchGroupHeaders"), 0)) into m;
  if s is not null and m > 0 then
    perform setval(s, m, true);
  end if;
end
$seq$;
do $parity$
declare
  n bigint;
begin
  select count(*) into n
  from core."merchGroup" c full join dflow."merchGroup" d using (mg_id)
  where c is distinct from d;
  if n <> 0 then
    raise exception '#205/20261113040717: dflow."merchGroup" still differs from core in % rows (a dflow-only row is never deleted here; investigate)', n
      using errcode = 'check_violation';
  end if;
  select count(*) into n
  from core."merchGroupHeaders" c full join dflow."merchGroupHeaders" d using (id)
  where c is distinct from d;
  if n <> 0 then
    raise exception '#205/20261113040717: dflow."merchGroupHeaders" still differs from core in % rows', n
      using errcode = 'check_violation';
  end if;
end
$parity$;

commit;
