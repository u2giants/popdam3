-- =====================================================================================
-- description_convention v1 rows — migration 20261225130804 (dflow_prod), issue #7106.
-- Writes one current v1 row per division; a re-apply adds nothing; a division that
-- already has a current row is left untouched.
-- Runs inside the caller's transaction (CI wraps it in BEGIN ... ROLLBACK).
-- =====================================================================================
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create schema if not exists dflow_prod;
create table if not exists dflow_prod."itemHeader" (item_id_pk integer primary key);
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_item_master_grants') then
    execute 'create role designflow_prod_item_master_grants';
  end if;
end
$role$;

\i supabase/migrations/20261225091507_dflow_prod_assembled_item_description.sql
\i supabase/migrations/20261225130804_dflow_prod_description_convention_v1.sql
\i supabase/migrations/20261225130804_dflow_prod_description_convention_v1.sql

do $g$
declare n int;
begin
  select count(*) into n from dflow_prod.description_convention where is_current and version = 1
    and division_code in ('CW001','SP001','EH001');
  if n <> 3 then raise exception 'C1: expected 3 current v1 rows, found %', n; end if;
  select count(*) into n from dflow_prod.description_convention;
  if n <> 3 then raise exception 'C2: re-apply added rows (found %)', n; end if;
  if (select template->'parts'->0->>'key' from dflow_prod.description_convention where division_code = 'CW001') <> 'product_type' then
    raise exception 'C3: CW001 part order wrong';
  end if;
  if exists (select 1 from dflow_prod.description_convention, jsonb_array_elements(template->'parts') p
              where division_code = 'EH001' and p->>'key' in ('licensor','property')) then
    raise exception 'C4: EH001 must not print licensor/property';
  end if;
end
$g$;
