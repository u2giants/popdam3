-- derived-from: none
-- Issue #5994 (claim #5996): Core Product Type — several names per
-- merchandise-group combination. PRODUCTION HALF of the matched pair (schema
-- `dflow_prod`, project qsllyeztdwjgirsysgai). The sandbox half is the paired
-- version 20261110131459 (schema `dflow`, project xupnyeifmpsacrqahwwm).
-- Follows 20261108135128 (#5026), which created these tables. Work issue
-- popcre/designflow-item-master#150; plan plan_core-product-type.md (branch
-- sandbox-albert).
--
-- Why: the generator now splits one MG01+MG02+MG03 combination into several
-- product types by the material its members state and by the features they
-- state, so a combination row is identified by MG01+MG02+MG03 + material +
-- feature set instead of MG01+MG02+MG03 alone.
--
-- Objects (this file): columns material and feature_set on
-- dflow_prod.mg_combination_description and its _history copy, two CHECK
-- constraints, unique index dflow_prod.mg_combination_description_variant_key
-- (replacing constraint mg_combination_description_unique). No grants: the
-- table-level grants 20261108135128 gave designflow_prod_item_master_grants
-- already cover new columns, and an index carries no privileges.
-- dflow_prod.item_product_description is unchanged: its combination_fk
-- already references the combination row id, which names the exact variant.
-- The stale `dflow` schema on this project is not touched.
--
-- No data is written. All four product-description tables held 0 rows when
-- this was authored (read live 2026-11-10); with rows present the change is
-- still safe: every existing row becomes the (NULL, '') variant, which the
-- old key already kept unique.
--
-- Idempotent: IF NOT EXISTS / drop-if-exists-then-add; re-apply is a no-op.
-- Rollback (only while no combination has two variants): add constraint
-- mg_combination_description_unique unique (mg01_id, mg02_id, mg03_id), drop
-- index mg_combination_description_variant_key, drop the two CHECK
-- constraints, drop columns material and feature_set from both tables.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
begin
  if to_regnamespace('dflow_prod') is null then
    raise exception '#5994/20261110131508 self-check: schema dflow_prod is missing — wrong database for the production half (the sandbox half 20261110131459 applies on the sandbox project)'
      using errcode = 'feature_not_supported';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'dflow_prod' and c.relkind = 'r'
      and c.relname in ('mg_combination_description', 'mg_combination_description_history')
    having count(*) = 2
  ) then
    raise exception '#5994/20261110131508 self-check: dflow_prod.mg_combination_description or its history is missing — 20261108135128 has not been applied here'
      using errcode = 'feature_not_supported';
  end if;
end $$;

-- Variant identity: one merchandise-group combination may now carry several
-- product names, told apart by the material its members state and by the
-- features they state. `material` is NULL when no material is stated (never
-- an empty string); `feature_set` is the canonical '+'-joined feature list
-- (e.g. 'die-cut+foil') and '' when there is none. Existing rows, had there
-- been any, would become the (NULL, '') variant, which the old key already
-- kept unique.
alter table dflow_prod.mg_combination_description
  add column if not exists material text,
  add column if not exists feature_set text not null default '';

-- The history copy mirrors the live column list by name (the audit trigger
-- derives its insert list from the live table), so it gains the same columns.
alter table dflow_prod.mg_combination_description_history
  add column if not exists material text,
  add column if not exists feature_set text not null default '';

alter table dflow_prod.mg_combination_description
  drop constraint if exists mg_combination_description_material_check;
alter table dflow_prod.mg_combination_description
  add constraint mg_combination_description_material_check
  check (material is null or (material <> '' and material = btrim(material)));

alter table dflow_prod.mg_combination_description
  drop constraint if exists mg_combination_description_feature_set_check;
alter table dflow_prod.mg_combination_description
  add constraint mg_combination_description_feature_set_check
  check (feature_set = btrim(feature_set));

-- New key first, old key second: the table is never without a uniqueness rule.
-- NULLS NOT DISTINCT makes "no material stated" one variant, not many.
create unique index if not exists mg_combination_description_variant_key
  on dflow_prod.mg_combination_description (mg01_id, mg02_id, mg03_id, material, feature_set)
  nulls not distinct;

alter table dflow_prod.mg_combination_description
  drop constraint if exists mg_combination_description_unique;

comment on column dflow_prod.mg_combination_description.material is
  'Material the combination''s members state (e.g. mdf, canvas); NULL when none is stated. Part of the row identity.';
comment on column dflow_prod.mg_combination_description.feature_set is
  'Canonical +-joined features the members state (e.g. die-cut+foil); empty string when none. Part of the row identity.';
