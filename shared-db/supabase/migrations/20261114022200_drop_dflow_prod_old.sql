-- shared-db issue #6301 - drop the empty leftover landing schema dflow_prod_old.
-- Fourth authoring. Version 20261113203604 (PR #6288) reached the live apply and
-- its dependent guard refused - correctly in principle; its 101 "outside
-- dependents" then proved to be pg_toast.pg_toast_* internal storage tables of
-- this schema's own empty tables (TOAST lives in the pg_toast schema by design
-- and travels with its parent under DROP CASCADE). The guard now excludes
-- pg_toast and pg_temp namespaces; the substantive property - no real outside
-- dependent - is preserved.
-- Owner authorization (Albert Hazan, chat 2026-11-13, verbatim: "drop the empty shelf").
-- Evidence: popcre/designflow-data-syncing#126 - zero readers; 127 empty tables,
-- 0 rows. Backup: gs://designflow-storage/backups/dflow-stale-cleanup-2026-11-12/prod_dflow_prod_old_schema.dump
--
-- CASCADE is required and safe here: RESTRICT refuses to drop a schema that still
-- CONTAINS objects (the 127 empty tables). The guard below enforces the dependent
-- case live (review finding #6268).

do $guard$
declare
  v_outside integer;
begin
  with inside as (
    select oid from pg_namespace where nspname = 'dflow_prod_old'
    union all
    select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'dflow_prod_old'
    union all
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'dflow_prod_old'
  ), dependents as (
    select d.objid,
           coalesce(
             (select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where c.oid = d.objid and d.classid = 'pg_class'::regclass),
             (select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where p.oid = d.objid and d.classid = 'pg_proc'::regclass),
             (select n.nspname from pg_rewrite rw join pg_class c on c.oid = rw.ev_class
               join pg_namespace n on n.oid = c.relnamespace
               where rw.oid = d.objid and d.classid = 'pg_rewrite'::regclass),
             (select n.nspname from pg_trigger t join pg_class c on c.oid = t.tgrelid
               join pg_namespace n on n.oid = c.relnamespace
               where t.oid = d.objid and d.classid = 'pg_trigger'::regclass),
             'internal') as dep_schema
      from pg_depend d
     where d.refobjid in (select oid from inside)
  )
  select count(*) into v_outside from dependents
   where dep_schema not in ('dflow_prod_old', 'internal')
     and dep_schema not like 'pg_toast%'
     and dep_schema not like 'pg_temp%';
  if v_outside > 0 then
    raise exception 'dflow_prod_old has % outside dependent object(s); refusing cascade drop', v_outside;
  end if;
end
$guard$;

drop schema if exists dflow_prod_old cascade;
