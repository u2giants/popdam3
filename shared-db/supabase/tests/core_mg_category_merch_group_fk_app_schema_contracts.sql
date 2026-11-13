-- =====================================================================================
-- mg_category_merch_group merchandise-group key contracts — migration 20261113192227
-- (production half), claim #6252, work issue popcre/designflow-item-master#205
-- step 3.1 (b). The non-production half 20261113192216 is the same statements on
-- dflow."merchGroup" and is proven read-only on the sandbox after its lane apply.
--
-- Proves: the key references dflow_prod."merchGroup"(mg_id) and is validated; a
-- group present only in dflow_prod."merchGroup" can be categorised; one present
-- only in core."merchGroup" is refused; the migration refuses (foreign_key_violation,
-- nothing deleted) when a link row has no group in dflow_prod; re-apply is a no-op.
--
-- HOW TO RUN: psql -f this file against the CI replay database (production-shaped)
-- as the migration owner. One transaction, ends in ROLLBACK. Every value is invented.
-- =====================================================================================

\set mig `sed -e '/^begin;$/d' -e '/^commit;$/d' supabase/migrations/20261113192227_core_mg_category_merch_group_fk_dflow_prod.sql`

begin;

do $fx$
declare
  base int;
  cat uuid;
begin
  if to_regclass('dflow_prod."merchGroup"') is null or to_regclass('core.mg_category_merch_group') is null then
    raise exception 'fixture: needs the production-shaped CI replay (dflow_prod."merchGroup", core.mg_category_merch_group)';
  end if;
  select id into strict cat from core.mg_category order by code limit 1;
  select greatest(coalesce((select max(mg_id) from core."merchGroup"), 0),
                  coalesce((select max(mg_id) from dflow_prod."merchGroup"), 0)) + 1000 into base;
  insert into core."merchGroup" (mg_id, mg_code, mg_desc, "mgTypeCode", is_active)
    overriding system value values (base + 2, 'ZZ6252C', 'core only', '01', true);
  insert into dflow_prod."merchGroup" (mg_id, mg_code, mg_desc, "mgTypeCode", is_active)
    overriding system value values (base + 1, 'ZZ6252P', 'app only', '01', true);
  perform set_config('zz.app_only', (base + 1)::text, true);
  perform set_config('zz.core_only', (base + 2)::text, true);
  perform set_config('zz.cat', cat::text, true);
end
$fx$;

-- Install the migration (no-op re-apply where the replay already applied it).
:mig

do $a$
declare
  app_only int := current_setting('zz.app_only')::int;
  core_only int := current_setting('zz.core_only')::int;
  cat uuid := current_setting('zz.cat')::uuid;
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'core.mg_category_merch_group'::regclass
                   and conname = 'mg_category_merch_group_merch_group_mg_id_fkey'
                   and confrelid = 'dflow_prod."merchGroup"'::regclass and convalidated) then
    raise exception 'contract A failed: key does not reference dflow_prod."merchGroup" validated'; end if;

  insert into core.mg_category_merch_group (mg_category_id, merch_group_mg_id) values (cat, app_only);

  begin
    insert into core.mg_category_merch_group (mg_category_id, merch_group_mg_id) values (cat, core_only);
    raise exception 'contract C failed: a core-only group was accepted';
  exception when foreign_key_violation then null;
  end;

  -- D: put the old key back, store a core-only link, and the migration must refuse.
  delete from core.mg_category_merch_group where merch_group_mg_id = app_only;
  alter table core.mg_category_merch_group drop constraint mg_category_merch_group_merch_group_mg_id_fkey;
  alter table core.mg_category_merch_group add constraint mg_category_merch_group_merch_group_mg_id_fkey
    foreign key (merch_group_mg_id) references core."merchGroup"(mg_id) on delete cascade;
  insert into core.mg_category_merch_group (mg_category_id, merch_group_mg_id) values (cat, core_only);
end
$a$;

savepoint before_refusal;
\set ON_ERROR_STOP 0
:mig
\set ON_ERROR_STOP 1
rollback to savepoint before_refusal;

do $d$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'mg_category_merch_group_merch_group_mg_id_fkey'
                   and confrelid = 'core."merchGroup"'::regclass) then
    raise exception 'contract D failed: migration changed the key despite an orphan'; end if;
  if not exists (select 1 from core.mg_category_merch_group
                 where merch_group_mg_id = current_setting('zz.core_only')::int) then
    raise exception 'contract D failed: orphan link row was deleted'; end if;
  delete from core.mg_category_merch_group where merch_group_mg_id = current_setting('zz.core_only')::int;
end
$d$;

-- E: clean state -> migration repoints again; a second run is a no-op.
:mig
:mig

do $e$
begin
  if (select count(*) from pg_constraint
      where conrelid = 'core.mg_category_merch_group'::regclass
        and conname = 'mg_category_merch_group_merch_group_mg_id_fkey'
        and confrelid = 'dflow_prod."merchGroup"'::regclass and convalidated) <> 1 then
    raise exception 'contract E failed: re-apply did not leave exactly one validated key on dflow_prod'; end if;
  raise notice 'PASS #6252 mg_category_merch_group key contracts';
end
$e$;

rollback;
