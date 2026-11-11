-- derived-from: none
-- Issue #6086 (claim #6087). Work issue popcre/designflow-item-master#205,
-- plan plan_merch-group-environment-parity.md Phase 1 (steps 1.2 and 1.3).
-- DesignFlow NON-PRODUCTION ONLY: project xupnyeifmpsacrqahwwm (sandbox,
-- develop and staging share it). Never applied to shared preview or shared
-- production; the self-check below refuses wherever dflow_prod exists.
--
-- Why: non-production services read merchandise groups from core."merchGroup"
-- while production reads them from its own app schema (dflow_prod). Decision
-- D1 on #205 moves non-production to dflow."merchGroup". This migration only
-- prepares that move; no service is switched here.
--
-- What:
--   1. dflow."merchGroup" and dflow."merchGroupHeaders" are made identical to
--      their core copies: differing shared rows updated, missing rows inserted
--      with their ids (OVERRIDING SYSTEM VALUE), identity sequences set above
--      the max id of both copies. Set-based; no id is hard-coded; NO ROW IS
--      DELETED (D3). A dflow-only row (none when authored) stops the migration.
--   2. Table privileges the core copies hold are granted on the dflow copies
--      (read through aclexplode; both were owner-only when authored).
--   3. The three dflow.mg_combination_description_mg0N_id_fkey keys are
--      repointed to dflow."merchGroup"(mg_id): new key NOT VALID, VALIDATE,
--      old key dropped, new key renamed to the old name.
--   Deliberately left: core.mg_category_merch_group -> core."merchGroup"
--   (plan O3; core taxonomy link of #1163, core canonical intent #4706).
--
-- Idempotent: re-running updates/inserts nothing and skips keys already on
-- dflow."merchGroup".
-- Rollback for step 3 only: repoint the three keys back to core."merchGroup"
-- the same way. Steps 1-2 need no rollback (the app does not read dflow yet).

set lock_timeout = '5s';
set statement_timeout = '5min';

do $check$
begin
  if to_regnamespace('dflow_prod') is not null then
    raise exception '#6086/20261111222527 self-check: schema dflow_prod exists here; this is a production-shaped project and this migration is DesignFlow non-production only'
      using errcode = 'feature_not_supported';
  end if;
end
$check$;

-- Kept in its own block: the sandbox lane never conditions a statement that
-- names the absent dflow_prod schema together with a live schema.
do $check2$
begin
  if to_regclass('core."merchGroup"') is null or to_regclass('dflow."merchGroup"') is null
     or to_regclass('core."merchGroupHeaders"') is null or to_regclass('dflow."merchGroupHeaders"') is null
     or to_regclass('dflow.mg_combination_description') is null then
    raise exception '#6086/20261111222527 self-check: a required merchGroup / merchGroupHeaders / mg_combination_description table is missing'
      using errcode = 'feature_not_supported';
  end if;
end
$check2$;

-- 1. Rows -----------------------------------------------------------------

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
    raise exception '#6086/20261111222527: dflow."merchGroup" still differs from core in % rows (a dflow-only row is never deleted here; investigate)', n
      using errcode = 'check_violation';
  end if;
  select count(*) into n
  from core."merchGroupHeaders" c full join dflow."merchGroupHeaders" d using (id)
  where c is distinct from d;
  if n <> 0 then
    raise exception '#6086/20261111222527: dflow."merchGroupHeaders" still differs from core in % rows', n
      using errcode = 'check_violation';
  end if;
end
$parity$;

-- 2. Grants (copied from the core copies; owner and PUBLIC-less ACLs are a no-op)

do $grants$
declare
  pair record;
  g record;
begin
  for pair in
    select * from (values
      ('core."merchGroup"'::regclass, 'dflow."merchGroup"'::regclass),
      ('core."merchGroupHeaders"'::regclass, 'dflow."merchGroupHeaders"'::regclass)
    ) v(src, dst)
  loop
    for g in
      select a.grantee, a.privilege_type, a.is_grantable
      from pg_class c, lateral aclexplode(c.relacl) a
      where c.oid = pair.src and a.grantee <> c.relowner
    loop
      execute format('grant %s on table %s to %s%s',
        g.privilege_type, pair.dst,
        case when g.grantee = 0 then 'public' else quote_ident(g.grantee::regrole::text) end,
        case when g.is_grantable then ' with grant option' else '' end);
    end loop;
  end loop;
end
$grants$;

-- 3. Repoint the three combination keys --------------------------------------

do $fk$
declare
  col text;
  old_name text;
  tmp_name text;
begin
  foreach col in array array['mg01_id', 'mg02_id', 'mg03_id'] loop
    old_name := 'mg_combination_description_' || col || '_fkey';
    tmp_name := old_name || '_dflow';
    if exists (select 1 from pg_constraint
               where conrelid = 'dflow.mg_combination_description'::regclass
                 and conname = old_name and confrelid = 'dflow."merchGroup"'::regclass) then
      continue;
    end if;
    execute format('alter table dflow.mg_combination_description drop constraint if exists %I', tmp_name);
    execute format('alter table dflow.mg_combination_description add constraint %I foreign key (%I) references dflow."merchGroup"(mg_id) not valid', tmp_name, col);
    execute format('alter table dflow.mg_combination_description validate constraint %I', tmp_name);
    execute format('alter table dflow.mg_combination_description drop constraint if exists %I', old_name);
    execute format('alter table dflow.mg_combination_description rename constraint %I to %I', tmp_name, old_name);
  end loop;
end
$fk$;
