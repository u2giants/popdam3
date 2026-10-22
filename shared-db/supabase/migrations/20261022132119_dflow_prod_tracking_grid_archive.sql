-- Issue #4585. Version reserved by migration-author claim #4586.
-- derived-from: 20261022014315
-- Production table for DesignFlow Production Tracking / Licensing Tracking Archive and
-- Unarchive (application PR popcre/designflow-frontend#352).
--
-- Owner ruling (Albert, chat, verbatim): "an archived order disappears only
-- from those two tracking screens and stays unchanged everywhere else." and
-- "everything archived anywhere in the system must be restorable with
-- Unarchive."
--
-- popcre-tracking-prod runs SCHEMA=dflow_prod, so its table-schema map resolves
-- "dflow_prod"."tracking_grid_archive". Same shape as the sandbox table:
--   grid_type 'prod_tracking'      -> row_id = production order header id
--   grid_type 'licensing_tracking' -> row_id = itemHeader item_id_pk
-- row_id is deliberately NOT a foreign key. Unarchive deletes the row.
--
-- Grants: dflow_prod uses per-table grants and no RLS. The tracking service
-- (helpers/trackingArchive.js) runs SELECT, INSERT ... ON CONFLICT DO NOTHING and
-- DELETE, so those three go to designflow_prod_tracking_grants, the NOLOGIN role
-- designflow_prod_tracking_runtime inherits (#2873). Deliberately the group, not the
-- runtime directly (unlike #4464/#4515): in production designflow_prod_backend_runtime
-- is also a member of that group, and popcre-tracking-prod still logs in as the backend
-- runtime until its own login switch (#4475; live read 21 Oct 2026 11:30 PM EDT showed
-- only backend_runtime sessions). A direct runtime grant would leave Archive at 503.
-- So both the tracking and backend runtimes reach this table; no other role does.
-- scripts/proofs/2873-* carry the three new expected entries. Not re-runnable on a
-- pre-existing table by design: CREATE TABLE fails loudly instead of accepting a
-- wrong-shaped object.
-- Rollback: drop table dflow_prod.tracking_grid_archive.

set lock_timeout = '5s';
set statement_timeout = '2min';

do $pre$
begin
  if to_regnamespace('dflow_prod') is null
  then raise exception '#4585: schema dflow_prod is missing'; end if;
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_tracking_runtime' and rolcanlogin)
  then raise exception '#4585: designflow_prod_tracking_runtime missing'; end if;
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_tracking_grants' and not rolcanlogin and not rolbypassrls)
  then raise exception '#4585: designflow_prod_tracking_grants missing or not a NOLOGIN NOBYPASSRLS role'; end if;
end
$pre$;

create table dflow_prod.tracking_grid_archive (
  grid_type text not null
    check (grid_type in ('prod_tracking', 'licensing_tracking')),
  row_id bigint not null,
  archived_at timestamptz not null default clock_timestamp(),
  archived_by_user_id integer,
  primary key (grid_type, row_id)
);

comment on table dflow_prod.tracking_grid_archive is
  'Rows hidden from the Production/Licensing Tracking grids by Archive; delete the row to Unarchive (#4585).';

grant select, insert, delete on table dflow_prod.tracking_grid_archive to designflow_prod_tracking_grants;

do $post$
declare v_bad text;
begin
  select string_agg(p, ',') into v_bad
  from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  where has_table_privilege('designflow_prod_tracking_grants', 'dflow_prod.tracking_grid_archive', p)
        is distinct from (p in ('SELECT','INSERT','DELETE'));
  if v_bad is not null then raise exception '#4585: tracking privilege matrix differs: %', v_bad; end if;
  if exists (select 1 from unnest(array['SELECT','INSERT','DELETE']) p
             where not has_table_privilege('designflow_prod_tracking_runtime', 'dflow_prod.tracking_grid_archive', p))
  then raise exception '#4585: tracking runtime cannot SELECT, INSERT and DELETE dflow_prod.tracking_grid_archive'; end if;
  if (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attnum)
      from pg_attribute a where a.attrelid = 'dflow_prod.tracking_grid_archive'::regclass and a.attnum > 0 and not a.attisdropped)
     is distinct from 'grid_type:text:true,row_id:bigint:true,archived_at:timestamp with time zone:true,archived_by_user_id:integer:false'
  then raise exception '#4585: dflow_prod.tracking_grid_archive columns differ'; end if;
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = 'dflow_prod.tracking_grid_archive'::regclass and c.contype = 'p')
     is distinct from 'PRIMARY KEY (grid_type, row_id)'
  then raise exception '#4585: primary key is not (grid_type, row_id)'; end if;
  if (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a
        on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid = 'dflow_prod.tracking_grid_archive'::regclass and a.attname = 'archived_at')
     is distinct from 'clock_timestamp()'
  then raise exception '#4585: archived_at default is not clock_timestamp()'; end if;
end
$post$;
