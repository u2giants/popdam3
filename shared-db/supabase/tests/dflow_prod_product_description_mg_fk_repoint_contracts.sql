-- =====================================================================================
-- Core Product Type merchandise-group key contracts — migration 20261111183827
-- (dflow_prod half only), issue #5994. Proves that the three merchandise-group
-- foreign keys on dflow_prod.mg_combination_description reference
-- dflow_prod."merchGroup" (the table production items use) and no longer
-- core."merchGroup"; that a merchandise group present only in
-- dflow_prod."merchGroup" is accepted; that one present only in
-- core."merchGroup" is refused; that the migration refuses to run, changing
-- nothing, when a stored row would violate the new parent; and that re-apply
-- is a no-op.
--
-- HOW TO RUN
--   Against a throwaway database as the migration owner:
--       begin; \i supabase/tests/dflow_prod_product_description_mg_fk_repoint_contracts.sql
--   The whole file runs inside ONE transaction and ends in ROLLBACK, so it leaves
--   nothing behind. Negative tests run inside plpgsql blocks with SPECIFIC
--   exception handlers and assert the expected errcode, never `when others`.
--
-- SELF-CONTAINED FIXTURES
--   Environment-aware, as in dflow_prod_product_description_contracts.sql: on
--   the CI ephemeral stack the replay has created the real shapes (identity
--   keys); on a bare throwaway database this file creates plain-integer ones.
--   The prerequisite migrations are applied by \i first (idempotent where they
--   are already installed), then the migration under test.
--
-- EVERY VALUE IN THIS FILE IS INVENTED; no licensed wording appears here.
-- =====================================================================================

begin;

create schema if not exists core;
create schema if not exists dflow_prod;

create table if not exists core."merchGroup" (
  mg_id integer primary key,
  mg_code character varying,
  parent_id integer references core."merchGroup"(mg_id)
);
create table if not exists dflow_prod."merchGroup" (
  mg_id integer primary key,
  mg_code character varying
);
create table if not exists dflow_prod."itemHeader" (
  item_id_pk integer primary key,
  item_descr_name character varying,
  created_time_date timestamptz,
  udf_merchgroup01_id integer,
  udf_merchgroup02_id integer,
  udf_merchgroup03_id integer
);

do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_item_master_grants') then
    execute 'create role designflow_prod_item_master_grants';
  end if;
end
$role$;

-- Six invented merchandise-group ids, chosen above anything either table
-- holds: three in BOTH tables (shared), one ONLY in dflow_prod (the production
-- fault: a group ColdLion created that core does not carry), one ONLY in core.
do $fixture$
declare
  base int;
begin
  select greatest(
           coalesce((select max(mg_id) from core."merchGroup"), 0),
           coalesce((select max(mg_id) from dflow_prod."merchGroup"), 0)
         ) + 1000
  into base;

  insert into core."merchGroup" (mg_id, mg_code) overriding system value values
    (base + 1, 'ZZ-FK-MG01'), (base + 2, 'ZZ-FK-MG02'), (base + 3, 'ZZ-FK-MG03'),
    (base + 5, 'ZZ-FK-CORE-ONLY');
  insert into dflow_prod."merchGroup" (mg_id, mg_code) overriding system value values
    (base + 1, 'ZZ-FK-MG01'), (base + 2, 'ZZ-FK-MG02'), (base + 3, 'ZZ-FK-MG03'),
    (base + 4, 'ZZ-FK-PROD-ONLY');

  perform set_config('zz.fk.g1', (base + 1)::text, true);
  perform set_config('zz.fk.g2', (base + 2)::text, true);
  perform set_config('zz.fk.g3', (base + 3)::text, true);
  perform set_config('zz.fk.prod_only', (base + 4)::text, true);
  perform set_config('zz.fk.core_only', (base + 5)::text, true);
end
$fixture$;

\i supabase/migrations/20261108135128_dflow_prod_product_description_reissue.sql
\i supabase/migrations/20261110131508_dflow_prod_product_description_variant_key.sql

-- Put the keys back on the OLD parent so every run starts from the faulty
-- shape, whether or not the replay already applied the migration under test.
alter table dflow_prod.mg_combination_description
  drop constraint if exists mg_combination_description_mg01_id_fkey,
  drop constraint if exists mg_combination_description_mg02_id_fkey,
  drop constraint if exists mg_combination_description_mg03_id_fkey;
alter table dflow_prod.mg_combination_description
  add constraint mg_combination_description_mg01_id_fkey
    foreign key (mg01_id) references core."merchGroup"(mg_id),
  add constraint mg_combination_description_mg02_id_fkey
    foreign key (mg02_id) references core."merchGroup"(mg_id),
  add constraint mg_combination_description_mg03_id_fkey
    foreign key (mg03_id) references core."merchGroup"(mg_id);

-- A. The fault, reproduced: with the keys on core."merchGroup" a combination
-- whose MG03 exists only in dflow_prod."merchGroup" is refused (23503).
do $$
begin
  begin
    insert into dflow_prod.mg_combination_description
      (mg01_id, mg02_id, mg03_id, material, feature_set, description, status, run_id)
    values (current_setting('zz.fk.g1')::int, current_setting('zz.fk.g2')::int,
            current_setting('zz.fk.prod_only')::int, null, '', 'ZZ fixture sign', 'published', 'zz-fk-run');
    raise exception 'A: the old keys accepted a group that core."merchGroup" does not hold';
  exception when foreign_key_violation then
    null;
  end;
end $$;

-- B. Refusal with nothing changed: a stored row whose MG03 is only in
-- core."merchGroup" makes the migration stop at its pre-check (23503), and
-- the keys are still the old ones afterwards.
insert into dflow_prod.mg_combination_description
  (mg01_id, mg02_id, mg03_id, material, feature_set, description, status, run_id)
values (current_setting('zz.fk.g1')::int, current_setting('zz.fk.g2')::int,
        current_setting('zz.fk.core_only')::int, null, '', 'ZZ fixture core-only sign', 'review', 'zz-fk-run');

savepoint before_refused_apply;
\set ON_ERROR_STOP off
\i supabase/migrations/20261111183827_dflow_prod_product_description_mg_fk_repoint.sql
\set apply_refused :ERROR
\set ON_ERROR_STOP on
rollback to savepoint before_refused_apply;
\if :apply_refused
\else
do $$ begin raise exception 'B: the migration applied although a stored row is absent from dflow_prod."merchGroup"'; end $$;
\endif

do $$
declare
  on_core int;
begin
  select count(*) into on_core
  from pg_constraint
  where conrelid = 'dflow_prod.mg_combination_description'::regclass
    and contype = 'f' and confrelid = 'core."merchGroup"'::regclass;
  if on_core <> 3 then
    raise exception 'B: after a refused apply expected 3 keys still on core."merchGroup", found %', on_core;
  end if;
  if not exists (
    select 1 from dflow_prod.mg_combination_description
    where mg03_id = current_setting('zz.fk.core_only')::int
  ) then
    raise exception 'B: the refused apply lost the stored row';
  end if;
end $$;

-- The same refusal, asserted by errcode from inside plpgsql (the pre-check
-- logic verbatim), so B does not rest on psql's error handling alone.
do $$
declare
  missing bigint;
begin
  select count(*) into missing
  from dflow_prod.mg_combination_description c
  cross join lateral (values (c.mg01_id), (c.mg02_id), (c.mg03_id)) as v(mg_id)
  where not exists (select 1 from dflow_prod."merchGroup" m where m.mg_id = v.mg_id);
  if missing <> 1 then
    raise exception 'B: expected exactly 1 reference absent from dflow_prod."merchGroup", found %', missing;
  end if;
end $$;

delete from dflow_prod.mg_combination_description
where mg03_id = current_setting('zz.fk.core_only')::int;

-- A stored row the new parent DOES hold must survive the repoint unchanged.
insert into dflow_prod.mg_combination_description
  (mg01_id, mg02_id, mg03_id, material, feature_set, description, status, run_id)
values (current_setting('zz.fk.g1')::int, current_setting('zz.fk.g2')::int,
        current_setting('zz.fk.g3')::int, 'zz-wood', '', 'ZZ fixture wood sign', 'published', 'zz-fk-run');

\i supabase/migrations/20261111183827_dflow_prod_product_description_mg_fk_repoint.sql

-- C. Catalog shape: exactly the three named keys, each a single-column,
-- validated foreign key from its own column to dflow_prod."merchGroup"(mg_id);
-- none left on core."merchGroup".
do $$
declare
  n int;
  r record;
begin
  select count(*) into n
  from pg_constraint
  where conrelid = 'dflow_prod.mg_combination_description'::regclass
    and contype = 'f' and confrelid = 'core."merchGroup"'::regclass;
  if n <> 0 then
    raise exception 'C: % key(s) still reference core."merchGroup"', n;
  end if;

  for r in
    select * from (values
      ('mg_combination_description_mg01_id_fkey', 'mg01_id'),
      ('mg_combination_description_mg02_id_fkey', 'mg02_id'),
      ('mg_combination_description_mg03_id_fkey', 'mg03_id')
    ) as k(conname, colname)
  loop
    if not exists (
      select 1
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
      join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[1]
      where con.conrelid = 'dflow_prod.mg_combination_description'::regclass
        and con.conname = r.conname
        and con.contype = 'f'
        and con.convalidated
        and con.confrelid = 'dflow_prod."merchGroup"'::regclass
        and array_length(con.conkey, 1) = 1
        and a.attname = r.colname
        and pa.attname = 'mg_id'
    ) then
      raise exception 'C: % is not a validated key from % to dflow_prod."merchGroup"(mg_id)', r.conname, r.colname;
    end if;
  end loop;

  select count(*) into n
  from pg_constraint
  where conrelid = 'dflow_prod.mg_combination_description'::regclass
    and contype = 'f' and confrelid = 'dflow_prod."merchGroup"'::regclass;
  if n <> 3 then
    raise exception 'C: expected exactly 3 keys on dflow_prod."merchGroup", found %', n;
  end if;
end $$;

-- D. The stored row survived, unchanged.
do $$
declare
  n int;
begin
  select count(*) into n
  from dflow_prod.mg_combination_description
  where run_id = 'zz-fk-run' and material = 'zz-wood' and description = 'ZZ fixture wood sign'
    and mg03_id = current_setting('zz.fk.g3')::int;
  if n <> 1 then
    raise exception 'D: expected the stored row to survive the repoint, found % row(s)', n;
  end if;
end $$;

-- E. The fix: a group that exists only in dflow_prod."merchGroup" is now
-- accepted in each of the three positions.
insert into dflow_prod.mg_combination_description
  (mg01_id, mg02_id, mg03_id, material, feature_set, description, status, run_id)
values
  (current_setting('zz.fk.g1')::int, current_setting('zz.fk.g2')::int,
   current_setting('zz.fk.prod_only')::int, null, '', 'ZZ fixture sign three', 'published', 'zz-fk-run'),
  (current_setting('zz.fk.g1')::int, current_setting('zz.fk.prod_only')::int,
   current_setting('zz.fk.g3')::int, null, '', 'ZZ fixture sign two', 'published', 'zz-fk-run'),
  (current_setting('zz.fk.prod_only')::int, current_setting('zz.fk.g2')::int,
   current_setting('zz.fk.g3')::int, null, '', 'ZZ fixture sign one', 'published', 'zz-fk-run');

-- F. The keys still protect: a group that exists only in core."merchGroup",
-- and one that exists nowhere, are refused in each position (23503).
do $$
declare
  bad int;
  pos int;
  ids int[];
begin
  foreach bad in array array[current_setting('zz.fk.core_only')::int,
                             current_setting('zz.fk.core_only')::int + 500]
  loop
    for pos in 1..3 loop
      ids := array[current_setting('zz.fk.g1')::int, current_setting('zz.fk.g2')::int,
                   current_setting('zz.fk.g3')::int];
      ids[pos] := bad;
      begin
        insert into dflow_prod.mg_combination_description
          (mg01_id, mg02_id, mg03_id, material, feature_set, description, status, run_id)
        values (ids[1], ids[2], ids[3], 'zz-refused', '', 'ZZ fixture refused', 'review', 'zz-fk-run');
        raise exception 'F: id % was accepted in position % although dflow_prod."merchGroup" does not hold it', bad, pos;
      exception when foreign_key_violation then
        null;
      end;
    end loop;
  end loop;
end $$;

-- G. A referenced merchandise group cannot be deleted from under a
-- combination (default NO ACTION, as before): 23503.
do $$
begin
  begin
    delete from dflow_prod."merchGroup" where mg_id = current_setting('zz.fk.prod_only')::int;
    raise exception 'G: a referenced merchandise group was deleted';
  exception when foreign_key_violation then
    null;
  end;
end $$;

-- H. The application's grants role can still insert a combination; the parent
-- check does not need its own privilege on dflow_prod."merchGroup". Stacks
-- that forbid the test connection from assuming the role skip with a NOTICE,
-- exactly as the other product-description contract tests do.
do $h$
begin
  if not pg_has_role(current_user, 'designflow_prod_item_master_grants', 'member') then
    begin
      execute format('grant designflow_prod_item_master_grants to %I', current_user);
    exception when insufficient_privilege then
      raise notice 'H role-path assertions skipped: % cannot take membership in designflow_prod_item_master_grants on this stack', current_user;
    end;
  end if;
  begin
    execute 'set role designflow_prod_item_master_grants';
    execute 'reset role';
  exception when insufficient_privilege then
    raise notice 'H role-path assertions skipped: SET ROLE designflow_prod_item_master_grants is not permitted for % on this stack', current_user;
    return;
  end;
  set role designflow_prod_item_master_grants;
  insert into dflow_prod.mg_combination_description
    (mg01_id, mg02_id, mg03_id, material, feature_set, description, status, run_id)
  values (current_setting('zz.fk.g1')::int, current_setting('zz.fk.g2')::int,
          current_setting('zz.fk.prod_only')::int, 'zz-canvas', '', 'ZZ fixture canvas sign', 'published', 'zz-fk-role-run');
  reset role;
  if not exists (select 1 from dflow_prod.mg_combination_description where run_id = 'zz-fk-role-run') then
    raise exception 'H: the grants-role insert of a production-only group did not land';
  end if;
end
$h$;

-- I. Idempotent re-apply: same three keys, same rows.
\i supabase/migrations/20261111183827_dflow_prod_product_description_mg_fk_repoint.sql

do $$
declare
  n int;
begin
  select count(*) into n
  from pg_constraint
  where conrelid = 'dflow_prod.mg_combination_description'::regclass and contype = 'f';
  if n <> 3 then
    raise exception 'I: expected exactly 3 foreign keys after re-apply, found %', n;
  end if;
  select count(*) into n
  from pg_constraint
  where conrelid = 'dflow_prod.mg_combination_description'::regclass
    and contype = 'f' and confrelid = 'dflow_prod."merchGroup"'::regclass and convalidated;
  if n <> 3 then
    raise exception 'I: expected 3 validated keys on dflow_prod."merchGroup" after re-apply, found %', n;
  end if;
  select count(*) into n from dflow_prod.mg_combination_description where run_id = 'zz-fk-run';
  if n <> 4 then
    raise exception 'I: expected 4 fixture rows after re-apply, found %', n;
  end if;
end $$;

rollback;
