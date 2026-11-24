-- =====================================================================================
-- item_description_parts DELETE guard contracts — migration 20261225120103 (dflow_prod),
-- issue #7041. Direct DELETE is refused with check_violation; deleting the item still
-- cascades its parts rows away; re-apply is idempotent. EVERY VALUE IS INVENTED.
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
\i supabase/migrations/20261225120103_dflow_prod_item_description_parts_no_delete.sql
\i supabase/migrations/20261225120103_dflow_prod_item_description_parts_no_delete.sql

do $g$
declare n int; pt bigint; conv bigint; p1 bigint;
begin
  insert into dflow_prod."itemHeader" (item_id_pk) overriding system value values (987654322);
  insert into dflow_prod.product_type (name, source) values ('ZZ delete-guard type', 'seed') returning id into pt;
  insert into dflow_prod.description_convention (division_code, version, template)
    values ('ZZDG1', 1, '{}') returning id into conv;
  insert into dflow_prod.item_description_parts (item_fk, product_type_id, convention_id, assembled_description)
    values (987654322, pt, conv, 'ZZ dg') returning id into p1;
  begin
    delete from dflow_prod.item_description_parts where id = p1;
    raise exception 'K1 direct delete of a parts row accepted';
  exception when check_violation then null; end;
  -- K2: deleting the item still cascades its parts rows away.
  delete from dflow_prod."itemHeader" where item_id_pk = 987654322;
  select count(*) into n from dflow_prod.item_description_parts where id = p1;
  if n <> 0 then raise exception 'K2 cascade from itemHeader did not remove the parts row'; end if;
end
$g$;
