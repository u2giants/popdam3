-- =====================================================================================
-- Non-production merchGroup parity contracts — migration 20261111222527, issue #6086
-- (work issue popcre/designflow-item-master#205).
--
-- Proves: dflow."merchGroup" / "merchGroupHeaders" end identical to their core
-- copies (differing rows updated, missing rows inserted with their ids), no
-- dflow row is deleted, the identity sequence lands above the max id, the three
-- combination keys reference dflow."merchGroup" and are validated, the taxonomy
-- link core.mg_category_merch_group is left on core, and a re-run is a no-op.
--
-- HOW TO RUN: psql -f this file against a throwaway database as the migration owner.
-- One transaction, ends in ROLLBACK. Every value is invented.
-- =====================================================================================

begin;

-- The CI stack is production-shaped (dflow_prod present), where the migration
-- refuses by design; drop it inside the transaction to get the sandbox shape.
drop schema if exists dflow_prod cascade;

create schema if not exists core;
create schema if not exists dflow;

-- Bare-database fixtures (skipped where the CI replay already created them).
do $fx$
begin
  if to_regclass('core."merchGroup"') is null then
    create table core."merchGroup" (
      mg_id integer generated always as identity primary key,
      mg_code varchar, mg_desc varchar, "ItemNoCode" varchar, "mgTypeCode" varchar,
      "createdTime" varchar, "createdUser" varchar, "modTime" varchar, "modUser" varchar,
      "companyCode_fk" varchar, "divisionCode_fk" varchar, "divisionCode_id_fk" integer,
      "companyCode_id_fk" integer, is_active boolean, parent_id integer,
      "mgCode2" varchar(20), "mgCategory" varchar(20));
  end if;
  if to_regclass('dflow."merchGroup"') is null then
    create table dflow."merchGroup" (like core."merchGroup" including identity);
    alter table dflow."merchGroup" add primary key (mg_id);
  end if;
  if to_regclass('core."merchGroupHeaders"') is null then
    create table core."merchGroupHeaders" (
      id integer generated always as identity primary key,
      "companyCode" varchar, "divisionCode" varchar, "mgTypeCode" varchar, "mgTypeDesc" varchar,
      "createdTime" varchar, "createdUser" varchar, "modTime" varchar, "modUser" varchar,
      "divisionCode_id_fk" integer, "companyCode_id_fk" integer);
  end if;
  if to_regclass('dflow."merchGroupHeaders"') is null then
    create table dflow."merchGroupHeaders" (like core."merchGroupHeaders" including identity);
    alter table dflow."merchGroupHeaders" add primary key (id);
  end if;
  if to_regclass('dflow.mg_combination_description') is null then
    create table dflow.mg_combination_description (
      id bigint generated always as identity primary key,
      mg01_id integer not null constraint mg_combination_description_mg01_id_fkey references core."merchGroup"(mg_id),
      mg02_id integer constraint mg_combination_description_mg02_id_fkey references core."merchGroup"(mg_id),
      mg03_id integer constraint mg_combination_description_mg03_id_fkey references core."merchGroup"(mg_id));
  end if;
  if to_regclass('core.mg_category_merch_group') is null then
    create table core.mg_category_merch_group (
      merch_group_mg_id integer primary key
        constraint mg_category_merch_group_merch_group_mg_id_fkey references core."merchGroup"(mg_id) on delete cascade);
  end if;
end
$fx$;

-- Start from known contents inside the transaction.
delete from dflow.mg_combination_description;
-- core: ids 900001..900003; dflow: 900001 stale, 900002 missing, 900003 equal.
insert into core."merchGroup" (mg_id, mg_code, mg_desc, "mgTypeCode", is_active) overriding system value values
  (900001, 'ZA', 'Fresh name', '01', true),
  (900002, 'ZB', 'New group', '02', true),
  (900003, 'ZC', 'Same', '03', false);
insert into dflow."merchGroup" (mg_id, mg_code, mg_desc, "mgTypeCode", is_active) overriding system value values
  (900001, 'ZA', 'Old name', '01', false),
  (900003, 'ZC', 'Same', '03', false)
on conflict do nothing;
update dflow."merchGroup" set mg_desc = 'Old name', is_active = false where mg_id = 900001;
insert into core."merchGroupHeaders" (id, "mgTypeCode", "mgTypeDesc") overriding system value values (910001, '01', 'Type'), (910002, '02', 'Other');
insert into dflow."merchGroupHeaders" (id, "mgTypeCode", "mgTypeDesc") overriding system value values (910001, '01', 'Old type');
insert into dflow.mg_combination_description (mg01_id, mg02_id, mg03_id) values (900001, 900002, 900003);

\i supabase/migrations/20261111222527_dflow_merch_group_nonprod_parity.sql

do $a$
declare n bigint; s text; v bigint;
begin
  select count(*) into n from core."merchGroup" c full join dflow."merchGroup" d using (mg_id) where c is distinct from d;
  if n <> 0 then raise exception 'contract A failed: % merchGroup rows differ', n; end if;
  if (select mg_desc from dflow."merchGroup" where mg_id = 900001) <> 'Fresh name' then
    raise exception 'contract A2 failed: stale row not updated'; end if;
  if not exists (select 1 from dflow."merchGroup" where mg_id = 900002) then
    raise exception 'contract A3 failed: missing row not inserted with its id'; end if;
  select count(*) into n from core."merchGroupHeaders" c full join dflow."merchGroupHeaders" d using (id) where c is distinct from d;
  if n <> 0 then raise exception 'contract B failed: % header rows differ', n; end if;
  s := pg_get_serial_sequence('dflow."merchGroup"', 'mg_id');
  execute format('select last_value from %s', s) into v;
  if v < (select max(mg_id) from dflow."merchGroup") then
    raise exception 'contract C failed: sequence % below max id', v; end if;
  select count(*) into n from pg_constraint
   where conrelid = 'dflow.mg_combination_description'::regclass and contype = 'f'
     and conname in ('mg_combination_description_mg01_id_fkey','mg_combination_description_mg02_id_fkey','mg_combination_description_mg03_id_fkey')
     and confrelid = 'dflow."merchGroup"'::regclass and convalidated;
  if n <> 3 then raise exception 'contract D failed: % of 3 keys on dflow."merchGroup"', n; end if;
  if not exists (select 1 from pg_constraint where conrelid = 'core.mg_category_merch_group'::regclass
                 and contype = 'f' and confrelid = 'core."merchGroup"'::regclass) then
    raise exception 'contract E failed: taxonomy link was moved'; end if;
end
$a$;

-- Re-run is a no-op.
\i supabase/migrations/20261111222527_dflow_merch_group_nonprod_parity.sql

do $r$
begin
  if (select count(*) from pg_constraint where conrelid = 'dflow.mg_combination_description'::regclass
        and contype = 'f' and confrelid = 'dflow."merchGroup"'::regclass) <> 3 then
    raise exception 'contract F failed: re-run changed the keys'; end if;
end
$r$;

select 'dflow_merch_group_nonprod_parity_contracts: all contracts passed' as result;

rollback;
