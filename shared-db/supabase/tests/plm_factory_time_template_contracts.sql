-- #2724 contracts: plm."FactoryTime" templates and plm.product_type_factory_time.
-- Synthetic rows only; the CI runner wraps this file in begin/rollback.

do $$
declare
  template_a integer;
  template_b integer;
begin
  -- Shape.
  if (select is_nullable from information_schema.columns
       where table_schema = 'plm' and table_name = 'FactoryTime' and column_name = 'name') <> 'NO' then
    raise exception 'FactoryTime.name must be NOT NULL';
  end if;
  if (select is_nullable from information_schema.columns
       where table_schema = 'plm' and table_name = 'FactoryTime' and column_name = 'product_subtype') <> 'YES' then
    raise exception 'FactoryTime.product_subtype must be nullable';
  end if;
  if (select column_default from information_schema.columns
       where table_schema = 'plm' and table_name = 'FactoryTime' and column_name = 'resampling_days') is not null then
    raise exception 'FactoryTime.resampling_days must have no default';
  end if;

  -- A template needs only a name; empty stays empty.
  insert into plm."FactoryTime"(name, created_at, updated_at)
  values ('zztest Canvas Standard', now(), now())
  returning id into template_a;
  if exists (select 1 from plm."FactoryTime"
              where id = template_a and (resampling_days is not null or tags <> '{}'::text[] or product_subtype is not null)) then
    raise exception 'new template did not keep resampling/subtype empty and tags empty';
  end if;

  insert into plm."FactoryTime"(name, description, tags, sampling_days, resampling_days, mass_production_days, updated_by, created_at, updated_at)
  values ('zztest Plaques', 'synthetic', array['wall','wood'], 10, 5, 45, 'tester@fixture.invalid', now(), now())
  returning id into template_b;

  -- Name unique ignoring case and surrounding spaces.
  begin
    insert into plm."FactoryTime"(name, created_at, updated_at) values ('  ZZTEST canvas standard ', now(), now());
    raise exception 'case-insensitive duplicate template name was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into plm."FactoryTime"(name, created_at, updated_at) values ('   ', now(), now());
    raise exception 'blank template name was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into plm."FactoryTime"(name, mass_production_days, created_at, updated_at) values ('zztest negative', -1, now(), now());
    raise exception 'negative lead time was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into plm."FactoryTime"(name, tags, created_at, updated_at) values ('zztest null tag', array['a', null], now(), now());
    raise exception 'null tag element was accepted';
  exception when check_violation then null;
  end;

  -- Many product types may share one template; one template per product type.
  insert into plm.product_type_factory_time(mg_category, mg01_code, mg02_code, factory_time_id, assigned_by)
  values ('zzWall', 'D', 'F2', template_a, 'tester@fixture.invalid'),
         ('zzWorkspace', 'S', 'P2', template_a, 'tester@fixture.invalid');

  begin
    insert into plm.product_type_factory_time(mg_category, mg01_code, mg02_code, factory_time_id, assigned_by)
    values ('zzWall', 'D', 'F2', template_b, 'tester@fixture.invalid');
    raise exception 'second assignment for one product type was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into plm.product_type_factory_time(mg_category, mg01_code, mg02_code, factory_time_id, assigned_by)
    values ('zzWall ', 'D', 'F3', template_b, 'tester@fixture.invalid');
    raise exception 'untrimmed product type key was accepted';
  exception when check_violation then null;
  end;

  -- Reassignment keeps the previous template id.
  update plm.product_type_factory_time
     set previous_factory_time_id = factory_time_id, factory_time_id = template_b
   where mg_category = 'zzWall' and mg01_code = 'D' and mg02_code = 'F2';

  -- Deleting an in-use template is refused by the database.
  begin
    delete from plm."FactoryTime" where id = template_a;
    raise exception 'in-use template was deleted';
  -- ON DELETE RESTRICT surfaces as foreign_key_violation on some server
  -- versions and restrict_violation on others; the contract is the refusal.
  exception when restrict_violation or foreign_key_violation then null;
  end;

  -- A template referenced only as a previous value can be deleted once unused.
  delete from plm.product_type_factory_time where mg_category = 'zzWorkspace';
  delete from plm."FactoryTime" where id = template_a;
  if exists (select 1 from plm."FactoryTime" where id = template_a) then
    raise exception 'unused template could not be deleted';
  end if;

  -- No browser or service-role access to the new table.
  if has_table_privilege('anon', 'plm.product_type_factory_time', 'SELECT')
     or has_table_privilege('authenticated', 'plm.product_type_factory_time', 'SELECT')
     or has_table_privilege('service_role', 'plm.product_type_factory_time', 'SELECT') then
    raise exception 'product_type_factory_time is readable outside the owner';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'plm.product_type_factory_time'::regclass) then
    raise exception 'product_type_factory_time must have row level security enabled';
  end if;
end $$;
