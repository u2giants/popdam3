-- =====================================================================================
-- Core Product Type variant key behavior contracts — migration 20261110131459 (dflow half),
-- issue #5994. Proves that one merchandise-group combination can hold several
-- names told apart by material and feature set, that true duplicates are still
-- refused (including two "no material stated" rows), that the audit copy and the
-- per-item pointer keep working, and that the migration is idempotent.
--
-- HOW TO RUN
--   Against a throwaway database as the migration owner:
--       begin; \i supabase/tests/dflow_product_description_variant_key_contracts.sql
--   The whole file runs inside ONE transaction and ends in ROLLBACK, so it leaves
--   nothing behind. Negative tests run inside plpgsql blocks with SPECIFIC
--   exception handlers and assert the expected errcode, never `when others`.
--
-- SELF-CONTAINED FIXTURES
--   Same environment-aware fixtures as dflow_product_description_contracts.sql: the
--   base migration is applied by \i first (idempotent where it is already
--   installed), then the migration under test.
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
\i supabase/migrations/20261110131459_dflow_product_description_variant_key.sql

-- A. Several names for ONE combination: variants differ by material, by
-- feature set, or both, and all coexist.
insert into dflow.mg_combination_description
  (mg01_id, mg02_id, mg03_id, material, feature_set, description, status, run_id)
select current_setting('zz.ct.g1')::int, current_setting('zz.ct.g2')::int, current_setting('zz.ct.g3')::int,
       v.material, v.feature_set, v.description, 'published', 'zz-variant-run'
from (values
  (null,        '',             'ZZ fixture sign'),
  ('zz-wood',   '',             'ZZ fixture wood sign'),
  ('zz-canvas', '',             'ZZ fixture canvas sign'),
  ('zz-wood',   'zz-cut+zz-foil', 'ZZ fixture shaped foil wood sign'),
  (null,        'zz-cut',       'ZZ fixture shaped sign')
) as v(material, feature_set, description);

do $$
declare
  n integer;
begin
  select count(*) into n from dflow.mg_combination_description
  where mg01_id = current_setting('zz.ct.g1')::int
    and mg02_id = current_setting('zz.ct.g2')::int
    and mg03_id = current_setting('zz.ct.g3')::int;
  if n <> 5 then
    raise exception 'contract A failed: expected 5 variants of one combination, found %', n;
  end if;
end $$;

-- A2. feature_set defaults to the empty string when a writer omits it.
insert into dflow.mg_combination_description (mg01_id, mg02_id, mg03_id, material, description, run_id)
values (current_setting('zz.ct.g2')::int, current_setting('zz.ct.g1')::int, current_setting('zz.ct.g3')::int,
        'zz-wood', 'ZZ default feature set', 'zz-variant-run');
do $$
begin
  if not exists (
    select 1 from dflow.mg_combination_description
    where description = 'ZZ default feature set' and feature_set = ''
  ) then
    raise exception 'contract A2 failed: feature_set did not default to the empty string';
  end if;
end $$;

-- B. The variant key refuses a true duplicate, each asserted by errcode 23505.
-- B2 is the NULLS NOT DISTINCT proof: two "no material stated" rows collide.
do $$
begin
  begin
    insert into dflow.mg_combination_description (mg01_id, mg02_id, mg03_id, material, feature_set)
    values (current_setting('zz.ct.g1')::int, current_setting('zz.ct.g2')::int, current_setting('zz.ct.g3')::int,
            'zz-wood', '');
    raise exception 'contract B1 failed: duplicate material variant was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into dflow.mg_combination_description (mg01_id, mg02_id, mg03_id, material, feature_set)
    values (current_setting('zz.ct.g1')::int, current_setting('zz.ct.g2')::int, current_setting('zz.ct.g3')::int,
            null, '');
    raise exception 'contract B2 failed: a second no-material variant was accepted (NULLs treated as distinct)';
  exception when unique_violation then null;
  end;
  begin
    insert into dflow.mg_combination_description (mg01_id, mg02_id, mg03_id, material, feature_set)
    values (current_setting('zz.ct.g1')::int, current_setting('zz.ct.g2')::int, current_setting('zz.ct.g3')::int,
            'zz-wood', 'zz-cut+zz-foil');
    raise exception 'contract B3 failed: duplicate material+feature variant was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- C. One spelling for "none": material is NULL (never ''), neither column
-- carries stray whitespace, and feature_set is never NULL.
do $$
begin
  begin
    insert into dflow.mg_combination_description (mg01_id, mg02_id, mg03_id, material, feature_set)
    values (current_setting('zz.ct.g3')::int, current_setting('zz.ct.g2')::int, current_setting('zz.ct.g1')::int, '', '');
    raise exception 'contract C1 failed: empty-string material was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into dflow.mg_combination_description (mg01_id, mg02_id, mg03_id, material, feature_set)
    values (current_setting('zz.ct.g3')::int, current_setting('zz.ct.g2')::int, current_setting('zz.ct.g1')::int, ' zz-wood', '');
    raise exception 'contract C2 failed: padded material was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into dflow.mg_combination_description (mg01_id, mg02_id, mg03_id, material, feature_set)
    values (current_setting('zz.ct.g3')::int, current_setting('zz.ct.g2')::int, current_setting('zz.ct.g1')::int, null, 'zz-cut ');
    raise exception 'contract C3 failed: padded feature_set was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into dflow.mg_combination_description (mg01_id, mg02_id, mg03_id, material, feature_set)
    values (current_setting('zz.ct.g3')::int, current_setting('zz.ct.g2')::int, current_setting('zz.ct.g1')::int, null, null);
    raise exception 'contract C4 failed: NULL feature_set was accepted';
  exception when not_null_violation then null;
  end;
end $$;

-- D. Upsert on the full variant identity: the new unique index is usable as
-- the ON CONFLICT arbiter, including for the no-material variant.
insert into dflow.mg_combination_description
  (mg01_id, mg02_id, mg03_id, material, feature_set, description, status, run_id)
values (current_setting('zz.ct.g1')::int, current_setting('zz.ct.g2')::int, current_setting('zz.ct.g3')::int,
        null, '', 'ZZ fixture sign rewritten', 'published', 'zz-variant-run-2')
on conflict (mg01_id, mg02_id, mg03_id, material, feature_set)
do update set description = excluded.description, run_id = excluded.run_id;

do $$
declare
  n integer;
begin
  select count(*) into n from dflow.mg_combination_description
  where mg01_id = current_setting('zz.ct.g1')::int
    and mg02_id = current_setting('zz.ct.g2')::int
    and mg03_id = current_setting('zz.ct.g3')::int
    and material is null and feature_set = '';
  if n <> 1 then
    raise exception 'contract D failed: upsert left % no-material rows instead of 1', n;
  end if;
  if not exists (
    select 1 from dflow.mg_combination_description
    where description = 'ZZ fixture sign rewritten' and run_id = 'zz-variant-run-2'
  ) then
    raise exception 'contract D failed: upsert did not update the existing variant row';
  end if;
end $$;

-- E. Audit history carries the variant identity of the OLD row.
update dflow.mg_combination_description set description = 'ZZ fixture wood sign v2'
where material = 'zz-wood' and feature_set = 'zz-cut+zz-foil'
  and mg01_id = current_setting('zz.ct.g1')::int;
do $$
begin
  if not exists (
    select 1 from dflow.mg_combination_description_history
    where material = 'zz-wood' and feature_set = 'zz-cut+zz-foil'
      and description = 'ZZ fixture shaped foil wood sign'
  ) then
    raise exception 'contract E failed: history row does not carry material and feature_set of the old row';
  end if;
  if not exists (
    select 1 from dflow.mg_combination_description_history
    where material is null and feature_set = '' and description = 'ZZ fixture sign'
  ) then
    raise exception 'contract E failed: the upsert''s old no-material row was not audited';
  end if;
end $$;

-- F. Items of ONE combination point at their exact variant row through the
-- unchanged combination_fk; no extra item column is needed.
insert into dflow.item_product_description (item_fk, combination_fk, description, source, verified, run_id)
select current_setting('zz.ct.i1')::int, id, description, 'combination', true, 'zz-variant-run'
from dflow.mg_combination_description
where mg01_id = current_setting('zz.ct.g1')::int and material = 'zz-wood' and feature_set = '';
insert into dflow.item_product_description (item_fk, combination_fk, description, source, verified, run_id)
select current_setting('zz.ct.i2')::int, id, description, 'combination', true, 'zz-variant-run'
from dflow.mg_combination_description
where mg01_id = current_setting('zz.ct.g1')::int and material = 'zz-canvas' and feature_set = '';

do $$
declare
  n integer;
begin
  select count(distinct c.id) into n
  from dflow.item_product_description i
  join dflow.mg_combination_description c on c.id = i.combination_fk
  where i.item_fk in (current_setting('zz.ct.i1')::int, current_setting('zz.ct.i2')::int)
    and c.mg01_id = current_setting('zz.ct.g1')::int
    and i.description = c.description;
  if n <> 2 then
    raise exception 'contract F failed: two items of one combination resolved to % variant rows instead of 2', n;
  end if;
end $$;

-- G. Catalog shape: the old three-column key is gone, the new key is a valid
-- unique NULLS NOT DISTINCT index over exactly the five identity columns, and
-- the history copy has every live column (the audit insert list is by name).
do $$
declare
  cols text;
  missing text;
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'dflow.mg_combination_description'::regclass
      and conname = 'mg_combination_description_unique'
  ) then
    raise exception 'contract G failed: constraint mg_combination_description_unique still exists';
  end if;
  select string_agg(a.attname, ',' order by k.ord) into cols
  from pg_index x
  join pg_class ic on ic.oid = x.indexrelid
  cross join lateral unnest(x.indkey) with ordinality as k(attnum, ord)
  join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
  where x.indrelid = 'dflow.mg_combination_description'::regclass
    and ic.relname = 'mg_combination_description_variant_key'
    and x.indisunique and x.indisvalid and x.indnullsnotdistinct and x.indpred is null;
  if cols is distinct from 'mg01_id,mg02_id,mg03_id,material,feature_set' then
    raise exception 'contract G failed: variant key is missing or has the wrong shape (columns: %)', cols;
  end if;
  select string_agg(l.attname, ',') into missing
  from pg_attribute l
  where l.attrelid = 'dflow.mg_combination_description'::regclass
    and l.attnum > 0 and not l.attisdropped
    and not exists (
      select 1 from pg_attribute h
      where h.attrelid = 'dflow.mg_combination_description_history'::regclass
        and h.attname = l.attname and h.atttypid = l.atttypid and not h.attisdropped
    );
  if missing is not null then
    raise exception 'contract G failed: history copy lacks live column(s) %', missing;
  end if;
end $$;

-- I. Idempotent re-apply: nothing is lost, nothing is duplicated.
\i supabase/migrations/20261110131459_dflow_product_description_variant_key.sql

do $$
declare
  n integer;
begin
  select count(*) into n from dflow.mg_combination_description where run_id like 'zz-variant-run%';
  if n <> 6 then
    raise exception 'contract I failed: expected 6 variant fixture rows after re-apply, found %', n;
  end if;
  if (select count(*) from pg_index x join pg_class ic on ic.oid = x.indexrelid
      where x.indrelid = 'dflow.mg_combination_description'::regclass
        and ic.relname = 'mg_combination_description_variant_key') <> 1 then
    raise exception 'contract I failed: variant key missing or duplicated after re-apply';
  end if;
end $$;

rollback;
