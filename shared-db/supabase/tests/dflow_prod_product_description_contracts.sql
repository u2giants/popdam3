-- =====================================================================================
-- Core Product Type (product description tables) behavior contracts — migration
-- 20261108135128 (dflow_prod half), issue #5026. Mirrors the hardened sandbox
-- test (issue #5020, PR #5812): the governed deepseek review there proved the
-- original human-override guard could be bypassed three ways and that no
-- committed behavior test existed.
--
-- HOW TO RUN
--   Against a throwaway database as the migration owner:
--       begin; \i supabase/tests/dflow_prod_product_description_contracts.sql
--   The whole file runs inside ONE transaction and ends in ROLLBACK, so it leaves
--   nothing behind — including the schemas, fixtures and the grant role it
--   creates. Negative tests run inside plpgsql blocks with SPECIFIC exception
--   handlers and assert the expected errcode, never `when others`.
--
-- SELF-CONTAINED FIXTURES
--   A bare throwaway database carries no dflow_prod schema, so this test creates
--   the minimal fixture schemas/tables itself (invented values only), plus the
--   item-master grant role the production migration grants to, then applies the
--   real migration by \i and exercises it. The migration's self-check does NOT
--   refuse a database that also carries the stale `dflow` schema (the production
--   project does), so the CI ephemeral stack's two-schema shape is fine here.
--
-- EVERY VALUE IN THIS FILE IS INVENTED; no licensed wording appears here.
-- =====================================================================================

begin;

-- Environment-aware fixtures: on the CI ephemeral stack the replay creates the
-- real core/dflow_prod shapes with GENERATED ALWAYS identity keys; on a bare
-- throwaway database this file creates plain-integer fixtures. Ids are captured
-- into transaction-local settings so the rest of the file never hardcodes them.
create schema if not exists core;
create schema if not exists dflow_prod;

create table if not exists core."merchGroup" (
  mg_id integer primary key,
  mg_code character varying,
  parent_id integer references core."merchGroup"(mg_id)
);
create table if not exists dflow_prod."itemHeader" (
  item_id_pk integer primary key,
  item_descr_name character varying,
  created_time_date timestamptz,
  udf_merchgroup01_id integer references core."merchGroup"(mg_id),
  udf_merchgroup02_id integer,
  udf_merchgroup03_id integer
);

-- The production migration grants to designflow_prod_item_master_grants; on the
-- production project the role exists (verified live 2026-10-29). Everywhere else
-- it is created here and rolled back with everything else.
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'designflow_prod_item_master_grants') then
    execute 'create role designflow_prod_item_master_grants';
  end if;
end
$role$;

do $fixture$
declare
  mg_ident boolean; ih_ident boolean;
  g1 int; g2 int; g3 int; i1 int; i2 int; i3 int;
begin
  select a.attidentity <> '' into mg_ident
  from pg_attribute a
  where a.attrelid = 'core."merchGroup"'::regclass and a.attname = 'mg_id' and not a.attisdropped;
  if mg_ident then
    insert into core."merchGroup" (mg_code) values ('ZZ-CT-MG01') returning mg_id into g1;
    insert into core."merchGroup" (mg_code) values ('ZZ-CT-MG02') returning mg_id into g2;
    insert into core."merchGroup" (mg_code) values ('ZZ-CT-MG03') returning mg_id into g3;
  else
    insert into core."merchGroup" (mg_id, mg_code) values
      (90001, 'ZZ-CT-MG01'), (90002, 'ZZ-CT-MG02'), (90003, 'ZZ-CT-MG03');
    g1 := 90001; g2 := 90002; g3 := 90003;
  end if;

  select a.attidentity <> '' into ih_ident
  from pg_attribute a
  where a.attrelid = 'dflow_prod."itemHeader"'::regclass and a.attname = 'item_id_pk' and not a.attisdropped;
  if ih_ident then
    insert into dflow_prod."itemHeader" (item_descr_name, udf_merchgroup01_id, udf_merchgroup02_id, udf_merchgroup03_id)
      values ('ZZ fixture item one', g1, g2, g3) returning item_id_pk into i1;
    insert into dflow_prod."itemHeader" (item_descr_name, udf_merchgroup01_id, udf_merchgroup02_id, udf_merchgroup03_id)
      values ('ZZ fixture item two', g1, g2, g3) returning item_id_pk into i2;
    insert into dflow_prod."itemHeader" (item_descr_name, udf_merchgroup01_id, udf_merchgroup02_id, udf_merchgroup03_id)
      values ('ZZ fixture item three', g1, g2, g3) returning item_id_pk into i3;
  else
    insert into dflow_prod."itemHeader" (item_id_pk, item_descr_name, udf_merchgroup01_id, udf_merchgroup02_id, udf_merchgroup03_id) values
      (9001, 'ZZ fixture item one', g1, g2, g3),
      (9002, 'ZZ fixture item two', g1, g2, g3),
      (9003, 'ZZ fixture item three', g1, g2, g3);
    i1 := 9001; i2 := 9002; i3 := 9003;
  end if;

  perform set_config('zz.ct.g1', g1::text, true);
  perform set_config('zz.ct.g2', g2::text, true);
  perform set_config('zz.ct.g3', g3::text, true);
  perform set_config('zz.ct.i1', i1::text, true);
  perform set_config('zz.ct.i2', i2::text, true);
  perform set_config('zz.ct.i3', i3::text, true);
end
$fixture$;

\i supabase/migrations/20261108135128_dflow_prod_product_description_reissue.sql

-- A. Positive chain: a published combination and its per-item row insert cleanly.
insert into dflow_prod.mg_combination_description
  (mg01_id, mg02_id, mg03_id, description, status, item_count, verified_count, verified_rate, run_id)
values (current_setting('zz.ct.g1')::int, current_setting('zz.ct.g2')::int, current_setting('zz.ct.g3')::int,
        'ZZ fixture blanket', 'published', 1, 1, 1.0000, 'zz-run-1');

insert into dflow_prod.item_product_description
  (item_fk, combination_fk, description, source, verified, run_id)
select current_setting('zz.ct.i1')::int, id, description, 'combination', true, 'zz-run-1'
from dflow_prod.mg_combination_description;

-- A2. Least-privilege proof AS the grants role: identity-sequence USAGE and
-- table grants let the application write, and the history tables refuse
-- mutation (append-only audit). Stacks whose permission model forbids the
-- test connection from taking or being granted the role (the CI ephemeral
-- harness) skip this with a NOTICE instead of failing on impersonation; the
-- assertions themselves are identical wherever the role is assumable.
do $a2$
begin
  if not pg_has_role(current_user, 'designflow_prod_item_master_grants', 'member') then
    begin
      execute format('grant designflow_prod_item_master_grants to %I', current_user);
    exception when insufficient_privilege then
      raise notice 'A2 role-path assertions skipped: % cannot take membership in designflow_prod_item_master_grants on this stack', current_user;
    end;
  end if;
  begin
    execute 'set role designflow_prod_item_master_grants';
    execute 'reset role';
  exception when insufficient_privilege then
    raise notice 'A2 role-path assertions skipped: SET ROLE designflow_prod_item_master_grants is not permitted for % on this stack', current_user;
    return;
  end;
  set role designflow_prod_item_master_grants;
  insert into dflow_prod.mg_combination_description
    (mg01_id, mg02_id, mg03_id, description, status, run_id)
  values (current_setting('zz.ct.g2')::int, current_setting('zz.ct.g1')::int, current_setting('zz.ct.g3')::int,
          'ZZ role fixture', 'pending', 'zz-run-2');
  insert into dflow_prod.item_product_description
    (item_fk, combination_fk, description, source, verified, run_id)
  values (current_setting('zz.ct.i2')::int,
          (select id from dflow_prod.mg_combination_description where run_id = 'zz-run-2'),
          'ZZ role fixture words', 'combination', false, 'zz-run-2');
  -- The audit trigger runs as its invoker, so this role UPDATE also proves the
  -- history table INSERT grant and the history identity sequence USAGE.
  update dflow_prod.item_product_description set description = 'ZZ role rewrite'
  where item_fk = current_setting('zz.ct.i2')::int;
  begin
    update dflow_prod.item_product_description_history set description = 'rewrite history'
    where item_fk = current_setting('zz.ct.i1')::int;
    raise exception 'contract A2 failed: grants role mutated an audit history row';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from dflow_prod.mg_combination_description_history;
    raise exception 'contract A2 failed: grants role deleted audit history';
  exception when insufficient_privilege then null;
  end;
  reset role;
end
$a2$;

-- B. Machine writes the guard must refuse, each asserted by errcode 23514.
do $$
begin
  begin
    insert into dflow_prod.item_product_description (item_fk, description, is_human_override, source, override_at)
    values (current_setting('zz.ct.i2')::int, 'machine claims a human', true, 'human', now());
    raise exception 'contract B1 failed: machine INSERT of an override row was accepted';
  exception when check_violation then null;
  end;
  begin
    -- B2: machine re-describe of a NON-override row must SUCCEED (blank beats
    -- wrong only by keeping groups publishable); a check_violation here is the
    -- bug, so the handler turns it into a loud failure.
    update dflow_prod.item_product_description set description = 'machine pending rewrite' where item_fk = current_setting('zz.ct.i1')::int;
  exception when check_violation then
    raise exception 'contract B2 failed: guard must not protect non-override rows';
  end;
  begin
    insert into dflow_prod.item_product_description (item_fk, description, source)
    values (current_setting('zz.ct.i3')::int, 'machine claims human source', 'human');
    raise exception 'contract B3 failed: machine INSERT claiming source=human was accepted';
  exception when check_violation then null;
  end;
end $$;

-- C. Human session path: set, change, re-attribute and clear with the GUC on.
select set_config('app.product_description.human', 'on', true);
update dflow_prod.item_product_description
set description = 'ZZ human words', is_human_override = true, source = 'human', override_at = now(), override_user_fk = 42
where item_fk = current_setting('zz.ct.i1')::int;
update dflow_prod.item_product_description set description = 'ZZ human edit two' where item_fk = current_setting('zz.ct.i1')::int;
select set_config('app.product_description.human', '', true);

-- D. Guard holes the review proved closed: wrong GUC values are machine sessions.
do $$
begin
  begin
    perform set_config('app.product_description.human', 'off', true);
    update dflow_prod.item_product_description set description = 'machine via off' where item_fk = current_setting('zz.ct.i1')::int;
    raise exception 'contract D1 failed: GUC value off bypassed the guard';
  exception when check_violation then null;
  end;
  begin
    perform set_config('app.product_description.human', '0', true);
    delete from dflow_prod.item_product_description where item_fk = current_setting('zz.ct.i1')::int;
    raise exception 'contract D2 failed: machine DELETE of an override row was accepted';
  exception when check_violation then null;
  end;
  begin
    perform set_config('app.product_description.human', '', true);
    update dflow_prod.item_product_description set override_user_fk = 31337 where item_fk = current_setting('zz.ct.i1')::int;
    raise exception 'contract D3 failed: machine attribution rewrite was accepted';
  exception when check_violation then null;
  end;
  perform set_config('app.product_description.human', '', true);
end $$;

-- E. Stats-only machine update on an override row stays allowed (no guard trip).
update dflow_prod.item_product_description set verified = true, verify_score = 0.998 where item_fk = current_setting('zz.ct.i1')::int;

-- F. Audit history: every UPDATE landed the OLD row (at least the C/D/E edits).
do $$
declare
  n integer;
begin
  select count(*) into n from dflow_prod.item_product_description_history where item_fk = current_setting('zz.ct.i1')::int;
  if n < 2 then
    raise exception 'contract F failed: expected at least 2 audit rows, found %', n;
  end if;
end $$;

-- G. source/override consistency check constraint.
do $$
begin
  begin
    insert into dflow_prod.item_product_description (item_fk, description, is_human_override, source)
    values (current_setting('zz.ct.i3')::int, 'x', true, 'combination');
    raise exception 'contract G failed: override=true with source=combination accepted';
  exception when check_violation then null;
  end;
end $$;

-- G2. The override-source CHECK is an independent backstop: with the human GUC
-- on, the guard lets the row through and the CONSTRAINT must refuse it.
select set_config('app.product_description.human', 'on', true);
do $$
begin
  begin
    insert into dflow_prod.item_product_description (item_fk, description, is_human_override, source)
    values (current_setting('zz.ct.i3')::int, 'x', true, 'combination');
    raise exception 'contract G2 failed: override=true with source=combination accepted under the human GUC';
  exception when check_violation then null;
  end;
end $$;
select set_config('app.product_description.human', '', true);

-- H. Idempotent re-apply.
\i supabase/migrations/20261108135128_dflow_prod_product_description_reissue.sql

rollback;
