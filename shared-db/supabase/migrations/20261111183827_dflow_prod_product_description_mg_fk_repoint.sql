-- derived-from: none
-- Issue #5994 (claim #6063): Core Product Type — repoint the three
-- merchandise-group foreign keys on dflow_prod.mg_combination_description
-- from core."merchGroup" to dflow_prod."merchGroup". PRODUCTION HALF ONLY
-- (schema `dflow_prod`, project qsllyeztdwjgirsysgai). Follows 20261108135128
-- (#5026), which created the keys, and 20261110131508 (#5994), which added the
-- variant key. Work issue popcre/designflow-item-master#150.
--
-- Why: the production item service is single-schema. dflow_prod."itemHeader"
-- takes its udf_merchgroup01/02/03 ids from dflow_prod."merchGroup", which
-- holds merchandise groups that core."merchGroup" does not. The first
-- production write of generated product names was refused at rehearsal on
-- mg_combination_description_mg03_id_fkey for exactly that reason; nothing was
-- written. The combination table must accept every merchandise group a
-- production item can carry, so its keys reference the same table the items
-- use. core."merchGroup" is NOT filled in: ColdLion owns merchandise groups.
--
-- There is deliberately NO sandbox half. On the DesignFlow non-production
-- project (schema `dflow`) the item service is multi-schema and resolves
-- merchGroup to core, which is what the sandbox keys already reference, and
-- core."merchGroup" there is a superset of dflow."merchGroup" (read live
-- 2026-11-11). The sandbox keys and rows are left exactly as they are.
--
-- Objects (this file): constraints mg_combination_description_mg01_id_fkey,
-- mg_combination_description_mg02_id_fkey and
-- mg_combination_description_mg03_id_fkey on
-- dflow_prod.mg_combination_description. No column, index, grant or row
-- changes. No grant is needed: PostgreSQL runs a foreign-key parent check as
-- the owner of the tables, not as the inserting role.
-- dflow_prod.item_product_description and the two _history tables carry no
-- merchandise-group key and are unchanged.
--
-- No data is written. dflow_prod.mg_combination_description held 0 rows on
-- production and preview when this was authored (read live 2026-11-11). With
-- rows present the change is still safe: the pre-check below refuses, before
-- anything is dropped, if any stored id is missing from the new parent, and
-- ADD CONSTRAINT validates every row again.
--
-- Idempotent: each key is dropped if present and added again; re-apply ends in
-- the same catalog state. The whole file runs in the runner's one transaction,
-- so the table is never visible without its keys.
-- Rollback (only while every stored id is also in core."merchGroup"): drop
-- the three constraints and add them again referencing core."merchGroup"(mg_id).

set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
declare
  missing bigint;
begin
  if to_regnamespace('dflow_prod') is null then
    raise exception '#5994/20261111183827 self-check: schema dflow_prod is missing — wrong database (this change has no sandbox half)'
      using errcode = 'feature_not_supported';
  end if;
  if to_regclass('dflow_prod.mg_combination_description') is null then
    raise exception '#5994/20261111183827 self-check: dflow_prod.mg_combination_description is missing — 20261108135128 has not been applied here'
      using errcode = 'feature_not_supported';
  end if;
  if not exists (
    select 1
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.conrelid = to_regclass('dflow_prod."merchGroup"')
      and con.contype = 'p'
      and array_length(con.conkey, 1) = 1
      and a.attname = 'mg_id'
      and a.atttypid = 'integer'::regtype
  ) then
    raise exception '#5994/20261111183827 self-check: dflow_prod."merchGroup" is missing or its primary key is not the integer column mg_id — cannot repoint the combination keys'
      using errcode = 'feature_not_supported';
  end if;

  -- Refuse before dropping anything if a stored combination names a
  -- merchandise group the new parent does not hold.
  select count(*) into missing
  from dflow_prod.mg_combination_description c
  cross join lateral (values (c.mg01_id), (c.mg02_id), (c.mg03_id)) as v(mg_id)
  where not exists (
    select 1 from dflow_prod."merchGroup" m where m.mg_id = v.mg_id
  );
  if missing > 0 then
    raise exception '#5994/20261111183827 pre-check: % merchandise-group reference(s) in dflow_prod.mg_combination_description are absent from dflow_prod."merchGroup" — nothing was changed', missing
      using errcode = 'foreign_key_violation';
  end if;
end $$;

alter table dflow_prod.mg_combination_description
  drop constraint if exists mg_combination_description_mg01_id_fkey,
  drop constraint if exists mg_combination_description_mg02_id_fkey,
  drop constraint if exists mg_combination_description_mg03_id_fkey;

alter table dflow_prod.mg_combination_description
  add constraint mg_combination_description_mg01_id_fkey
    foreign key (mg01_id) references dflow_prod."merchGroup"(mg_id),
  add constraint mg_combination_description_mg02_id_fkey
    foreign key (mg02_id) references dflow_prod."merchGroup"(mg_id),
  add constraint mg_combination_description_mg03_id_fkey
    foreign key (mg03_id) references dflow_prod."merchGroup"(mg_id);

-- Post-check: exactly these three keys, each on dflow_prod."merchGroup", and
-- no merchandise-group key left on core."merchGroup".
do $$
declare
  good int;
  stale int;
begin
  select
    count(*) filter (where con.confrelid = 'dflow_prod."merchGroup"'::regclass),
    count(*) filter (where con.confrelid = to_regclass('core."merchGroup"'))
  into good, stale
  from pg_constraint con
  where con.conrelid = 'dflow_prod.mg_combination_description'::regclass
    and con.contype = 'f'
    and con.conname in (
      'mg_combination_description_mg01_id_fkey',
      'mg_combination_description_mg02_id_fkey',
      'mg_combination_description_mg03_id_fkey'
    );
  if good <> 3 or stale <> 0 then
    raise exception '#5994/20261111183827 post-check: expected 3 keys on dflow_prod."merchGroup" and 0 on core."merchGroup", found % and %', good, stale;
  end if;
end $$;
