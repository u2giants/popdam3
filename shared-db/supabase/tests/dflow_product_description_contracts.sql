-- =====================================================================================
-- Core Product Type (product description tables) behavior contracts — migration
-- 20261106050346 (dflow half), issue #5020 / claim #5772, PR #5029. Written after a
-- governed deepseek review (REJECT) proved the original human-override guard could
-- be bypassed three ways and that no committed behavior test existed.
--
-- HOW TO RUN
--   Against a throwaway database as the migration owner:
--       begin; \i supabase/tests/dflow_product_description_contracts.sql
--   The whole file runs inside ONE transaction and ends in ROLLBACK, so it leaves
--   nothing behind — including the schemas it creates. Negative tests run inside
--   plpgsql blocks with SPECIFIC exception handlers and assert the expected
--   errcode, never `when others`.
--
-- SELF-CONTAINED FIXTURES
--   The CI ephemeral stack carries no dflow schema, so this test creates the
--   minimal fixture schemas/tables itself (invented values only), then applies the
--   real migration by \i and exercises it. On the sandbox project the same script
--   also passes: the migration is idempotent and its self-check only refuses the
--   PRODUCTION shape (dflow_prod present), never a database with dflow only.
--
-- EVERY VALUE IN THIS FILE IS INVENTED; no licensed wording appears here.
-- =====================================================================================

begin;

-- The CI ephemeral stack carries BOTH dflow and dflow_prod (production shape),
-- on which this migration must refuse by design. This test needs the sandbox
-- shape, so dflow_prod is dropped INSIDE the transaction; the final ROLLBACK
-- restores it untouched. On a bare throwaway database this is a no-op.
drop schema if exists dflow_prod cascade;

-- Environment-aware fixtures: on the CI ephemeral stack the replay creates the
-- real dflow schema and core."merchGroup" with GENERATED ALWAYS identity keys;
-- on a bare throwaway database this file creates plain-integer fixtures. Ids
-- are captured into transaction-local settings so the rest of the file never
-- hardcodes them.
create schema if not exists core;
create schema if not exists dflow;

create table if not exists core."merchGroup" (
  mg_id integer primary key,
  mg_code character varying,
  parent_id integer references core."merchGroup"(mg_id)
);
create table if not exists dflow."itemHeader" (
  item_id_pk integer primary key,
  item_descr_name character varying,
  created_time_date timestamptz,
  udf_merchgroup01_id integer references core."merchGroup"(mg_id),
  udf_merchgroup02_id integer,
  udf_merchgroup03_id integer
);

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
  where a.attrelid = 'dflow."itemHeader"'::regclass and a.attname = 'item_id_pk' and not a.attisdropped;
  if ih_ident then
    insert into dflow."itemHeader" (item_descr_name, udf_merchgroup01_id, udf_merchgroup02_id, udf_merchgroup03_id)
      values ('ZZ fixture item one', g1, g2, g3) returning item_id_pk into i1;
    insert into dflow."itemHeader" (item_descr_name, udf_merchgroup01_id, udf_merchgroup02_id, udf_merchgroup03_id)
      values ('ZZ fixture item two', g1, g2, g3) returning item_id_pk into i2;
    insert into dflow."itemHeader" (item_descr_name, udf_merchgroup01_id, udf_merchgroup02_id, udf_merchgroup03_id)
      values ('ZZ fixture item three', g1, g2, g3) returning item_id_pk into i3;
  else
    insert into dflow."itemHeader" (item_id_pk, item_descr_name, udf_merchgroup01_id, udf_merchgroup02_id, udf_merchgroup03_id) values
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

\i supabase/migrations/20261106050346_dflow_product_description.sql

-- A. Positive chain: a published combination and its per-item row insert cleanly.
insert into dflow.mg_combination_description
  (mg01_id, mg02_id, mg03_id, description, status, item_count, verified_count, verified_rate, run_id)
values (current_setting('zz.ct.g1')::int, current_setting('zz.ct.g2')::int, current_setting('zz.ct.g3')::int,
        'ZZ fixture blanket', 'published', 1, 1, 1.0000, 'zz-run-1');

insert into dflow.item_product_description
  (item_fk, combination_fk, description, source, verified, run_id)
select current_setting('zz.ct.i1')::int, id, description, 'combination', true, 'zz-run-1'
from dflow.mg_combination_description;

-- B. Machine writes the guard must refuse, each asserted by errcode 23514.
do $$
begin
  begin
    insert into dflow.item_product_description (item_fk, description, is_human_override, source, override_at)
    values (current_setting('zz.ct.i2')::int, 'machine claims a human', true, 'human', now());
    raise exception 'contract B1 failed: machine INSERT of an override row was accepted';
  exception when check_violation then null;
  end;
  begin
    -- B2: machine re-describe of a NON-override row must SUCCEED (blank beats
    -- wrong only by keeping groups publishable); a check_violation here is the
    -- bug, so the handler turns it into a loud failure.
    update dflow.item_product_description set description = 'machine pending rewrite' where item_fk = current_setting('zz.ct.i1')::int;
  exception when check_violation then
    raise exception 'contract B2 failed: guard must not protect non-override rows';
  end;
end $$;

-- C. Human session path: set, change, re-attribute and clear with the GUC on.
select set_config('app.product_description.human', 'on', true);
update dflow.item_product_description
set description = 'ZZ human words', is_human_override = true, source = 'human', override_at = now(), override_user_fk = 42
where item_fk = current_setting('zz.ct.i1')::int;
update dflow.item_product_description set description = 'ZZ human edit two' where item_fk = current_setting('zz.ct.i1')::int;
select set_config('app.product_description.human', '', true);

-- D. Guard holes the review proved closed: wrong GUC values are machine sessions.
do $$
begin
  begin
    perform set_config('app.product_description.human', 'off', true);
    update dflow.item_product_description set description = 'machine via off' where item_fk = current_setting('zz.ct.i1')::int;
    raise exception 'contract D1 failed: GUC value off bypassed the guard';
  exception when check_violation then null;
  end;
  begin
    perform set_config('app.product_description.human', '0', true);
    delete from dflow.item_product_description where item_fk = current_setting('zz.ct.i1')::int;
    raise exception 'contract D2 failed: machine DELETE of an override row was accepted';
  exception when check_violation then null;
  end;
  begin
    perform set_config('app.product_description.human', '', true);
    update dflow.item_product_description set override_user_fk = 31337 where item_fk = current_setting('zz.ct.i1')::int;
    raise exception 'contract D3 failed: machine attribution rewrite was accepted';
  exception when check_violation then null;
  end;
  perform set_config('app.product_description.human', '', true);
end $$;

-- E. Stats-only machine update on an override row stays allowed (no guard trip).
update dflow.item_product_description set verified = true, verify_score = 0.998 where item_fk = current_setting('zz.ct.i1')::int;

-- F. Audit history: every UPDATE landed the OLD row (at least the C/D/E edits).
do $$
declare
  n integer;
begin
  select count(*) into n from dflow.item_product_description_history where item_fk = current_setting('zz.ct.i1')::int;
  if n < 2 then
    raise exception 'contract F failed: expected at least 2 audit rows, found %', n;
  end if;
end $$;

-- G. source/override consistency check constraint.
do $$
begin
  begin
    insert into dflow.item_product_description (item_fk, description, is_human_override, source)
    values (current_setting('zz.ct.i3')::int, 'x', true, 'combination');
    raise exception 'contract G failed: override=true with source=combination accepted';
  exception when check_violation then null;
  end;
end $$;

-- H. Idempotent re-apply.
\i supabase/migrations/20261106050346_dflow_product_description.sql

rollback;
