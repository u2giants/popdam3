begin;

-- shared-db#4350 (claim #4355): Stage Catalog seed counts, access, the trigger
-- function and every trigger path, and the constraints. Rolled back.
do $$
declare
  v_tables text[] := array['plm.stage_list','plm.stage','plm.stage_duration',
    'plm.stage_dependency','plm.licensor_stage_option','plm.prod_stage_progress'];
  v_fn oid := to_regprocedure('plm.stage_catalog_bump_version()');
  v_list integer;
  v_lic integer;
  v_stage integer;
  v_stage2 integer;
  v_new integer;
  v integer;
begin
  -- Seed.
  if (select count(*) from plm.stage_list) <> 5
     or (select count(*) from plm.stage) <> 24
     or (select count(*) from plm.stage_duration) <> 637
     or (select count(*) from plm.licensor_stage_option where enabled) <> 16
     or (select count(*) from plm.licensor_stage_option) <> 32
     or (select count(*) from plm.stage_dependency) <> 0
     or (select count(*) from plm.prod_stage_progress) <> 0
     or (select count(*) from plm.stage where shown_on_tracker) <> 12
     or (select count(*) from plm.stage where counts_toward_total) <> 10 then
    raise exception 'stage catalog seed counts are wrong';
  end if;
  -- shared-db#4373 (claim #4402): the tracker-order/options migration updates 14
  -- seeded stage rows, so each list's version reflects exactly those bumps.
  if (select string_agg(key || '=' || version, ',' order by key) from plm.stage_list)
     <> 'design=1,licensing=4,production=7,sampling=5,shipping=2' then
    raise exception 'seeded list versions after #4373 are wrong: %',
      (select string_agg(key || '=' || version, ',' order by key) from plm.stage_list);
  end if;
  -- Re-baseline to 1 (inside this rolled-back test only) so the trigger-path
  -- arithmetic below keeps proving exactly one bump per change.
  alter table plm.stage_list disable trigger stage_list_bump_version;
  update plm.stage_list set version = 1;
  alter table plm.stage_list enable trigger stage_list_bump_version;
  if (select maintainers from plm.stage_list where key = 'sampling') <> '{36,41}'::integer[] then
    raise exception 'sampling maintainers must be Yuchen (36) and Ilona (41)';
  end if;

  -- Access: RLS on, no policy, no browser privilege on any of the six tables.
  if (select count(*) from unnest(v_tables) t(name)
       where (select relrowsecurity from pg_class where oid = t.name::regclass)) <> 6 then
    raise exception 'all six stage catalog tables must have RLS enabled';
  end if;
  if exists (select 1 from pg_policy where polrelid = any (select t::regclass from unnest(v_tables) t)) then
    raise exception 'stage catalog tables must have no RLS policy';
  end if;
  if exists (select 1 from pg_roles r cross join unnest(v_tables) t(name)
             cross join unnest(array['select','insert','update','delete']) p(priv)
             where r.rolname in ('anon','authenticated')
               and has_table_privilege(r.rolname, t.name, p.priv)) then
    raise exception 'browser roles must have no privilege on the stage catalog';
  end if;

  -- Trigger function and the five triggers bound to it.
  if v_fn is null or (select count(*) from pg_proc p where p.oid = v_fn
       and not p.prosecdef and p.prorettype = 'trigger'::regtype and p.provolatile = 'v'
       and 'search_path=""' = any (p.proconfig)) <> 1 then
    raise exception 'plm.stage_catalog_bump_version must be security invoker, return trigger, empty search_path';
  end if;
  if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'browser roles must not execute the trigger function';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role')
     and not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'service_role must execute the trigger function so its writes can fire the triggers';
  end if;
  -- Timing and events: stage_list BEFORE UPDATE (type 19); children AFTER INSERT/UPDATE/DELETE (type 29).
  if (select tgtype from pg_trigger where tgrelid = 'plm.stage_list'::regclass and tgname = 'stage_list_bump_version') <> 19
     or exists (select 1 from pg_trigger where tgfoid = v_fn and not tgisinternal
                  and tgrelid <> 'plm.stage_list'::regclass and tgtype <> 29) then
    raise exception 'trigger timing or events are wrong';
  end if;
  if (select count(*) from pg_trigger g
       where g.tgfoid = v_fn and not g.tgisinternal
         and (g.tgrelid, g.tgname) in (
           ('plm.stage_list'::regclass, 'stage_list_bump_version'),
           ('plm.stage'::regclass, 'stage_bump_version'),
           ('plm.stage_duration'::regclass, 'stage_duration_bump_version'),
           ('plm.stage_dependency'::regclass, 'stage_dependency_bump_version'),
           ('plm.licensor_stage_option'::regclass, 'licensor_stage_option_bump_version'))) <> 5 then
    raise exception 'the five version triggers must call plm.stage_catalog_bump_version';
  end if;

  -- Every trigger path bumps the owning list exactly once.
  select id into v_list from plm.stage_list where key = 'production';
  select id into v_lic from plm.stage_list where key = 'licensing';
  select id into v_stage from plm.stage where list_id = v_list and position = 1;
  select id into v_stage2 from plm.stage where list_id = v_list and position = 2;

  update plm.stage set pending_label = pending_label || ' x' where id = v_stage;          -- stage update
  insert into plm.stage (list_id, position, name, pending_label)
    values (v_list, 99, 'contract-test', 'contract-test') returning id into v_new;     -- stage insert
  insert into plm.stage_duration (stage_id, scope_kind, scope_value, duration)
    values (v_stage, 'product_type', 'contract-test', 1);                             -- duration insert
  delete from plm.stage_duration where stage_id = v_stage and scope_value = 'contract-test'; -- duration delete
  insert into plm.stage_dependency (stage_id, depends_on_stage_id, kind)
    values (v_stage, v_stage2, 'hard');                                               -- dependency insert
  delete from plm.stage_dependency where stage_id = v_stage;                          -- dependency delete
  delete from plm.stage where id = v_new;                                             -- stage delete
  if (select version from plm.stage_list where id = v_list) <> 8 then
    raise exception 'production list must be at version 8 after seven changes, found %',
      (select version from plm.stage_list where id = v_list);
  end if;

  update plm.licensor_stage_option set enabled = not enabled where licensor_name = 'Disney'; -- 2 rows
  delete from plm.licensor_stage_option where licensor_name = 'Peanuts';                     -- 2 rows
  insert into plm.licensor_stage_option (licensor_name, stage_id)
    select 'contract-test', id from plm.stage where list_id = v_lic and applies_to = 'licensor_specific'; -- 2 rows
  if (select version from plm.stage_list where id = v_lic) <> 7 then
    raise exception 'licensing list must be at version 7 after six option row changes, found %',
      (select version from plm.stage_list where id = v_lic);
  end if;
  if exists (select 1 from plm.stage_list where key in ('design','sampling','shipping') and version <> 1) then
    raise exception 'unrelated lists must not be bumped';
  end if;

  -- Cross-list paths: each change bumps every list it touches, exactly once.
  select id into v_new from plm.stage where list_id = (select id from plm.stage_list where key = 'sampling') and position = 2;
  insert into plm.stage_dependency (stage_id, depends_on_stage_id, kind)
    values (v_stage, v_new, 'soft');                                                  -- production depends on sampling
  if (select version from plm.stage_list where key = 'sampling') <> 2
     or (select version from plm.stage_list where id = v_list) <> 9 then
    raise exception 'a cross-list dependency insert must bump both lists once';
  end if;
  update plm.stage_dependency set allowed_early_days = 2 where stage_id = v_stage and depends_on_stage_id = v_new; -- dependency update
  if (select version from plm.stage_list where key = 'sampling') <> 3
     or (select version from plm.stage_list where id = v_list) <> 10 then
    raise exception 'a cross-list dependency update must bump both lists once';
  end if;
  update plm.stage_duration set duration = duration + 1
   where id = (select min(d.id) from plm.stage_duration d join plm.stage s on s.id = d.stage_id
               where s.list_id = (select id from plm.stage_list where key = 'design'));    -- duration update
  if (select version from plm.stage_list where key = 'design') <> 2 then
    raise exception 'a duration update must bump its list once';
  end if;
  update plm.stage set list_id = (select id from plm.stage_list where key = 'shipping'), position = 50
   where id = v_stage2;                                                               -- stage moves lists
  if (select version from plm.stage_list where key = 'shipping') <> 2
     or (select version from plm.stage_list where id = v_list) <> 11 then
    raise exception 'moving a stage between lists must bump both lists once';
  end if;
  delete from plm.stage_list where key = 'shipping';                                  -- list delete cascades
  if exists (select 1 from plm.stage where id = v_stage2)
     or exists (select 1 from plm.stage_dependency where stage_id = v_stage2 or depends_on_stage_id = v_stage2) then
    raise exception 'deleting a list must cascade to its stages and their dependencies';
  end if;

  select version into v from plm.stage_list where id = v_list;
  update plm.stage_list set name = name where id = v_list;
  if (select version from plm.stage_list where id = v_list) <> v then
    raise exception 'a no-op list update must not bump the version';
  end if;
  update plm.stage_list set name = name || ' x' where id = v_list;
  if (select version from plm.stage_list where id = v_list) <> v + 1 then
    raise exception 'a list edit must bump the version once';
  end if;

  -- Constraints.
  begin
    insert into plm.stage_dependency (stage_id, depends_on_stage_id, kind) values (v_stage, v_stage, 'soft');
    raise exception 'self dependency must be refused';
  exception when check_violation then null;
  end;
  insert into plm.prod_stage_progress (prod_order_header_id, sku, stage_id) values (-1, null, v_stage);
  insert into plm.prod_stage_progress (prod_order_header_id, sku, stage_id) values (-1, 'SKU-A', v_stage);
  insert into plm.prod_stage_progress (prod_order_header_id, sku, stage_id) values (-1, 'SKU-B', v_stage);
  begin
    insert into plm.prod_stage_progress (prod_order_header_id, sku, stage_id) values (-1, null, v_stage);
    raise exception 'duplicate PO-level progress must be refused';
  exception when unique_violation then null;
  end;
  begin
    insert into plm.prod_stage_progress (prod_order_header_id, sku, stage_id) values (-1, 'SKU-A', v_stage);
    raise exception 'duplicate SKU progress must be refused';
  exception when unique_violation then null;
  end;
  begin
    insert into plm.prod_stage_progress (prod_order_header_id, sku, stage_id) values (-1, '', v_stage);
    raise exception 'empty SKU must be refused';
  exception when check_violation then null;
  end;
  insert into plm.prod_stage_progress (prod_order_header_id, sku, stage_id) values (-1, 'SKU-A', v_stage)
    on conflict (prod_order_header_id, coalesce(sku, ''), stage_id) do update set done_at = current_date;
  if (select count(*) from plm.prod_stage_progress where prod_order_header_id = -1) <> 3 then
    raise exception 'progress upsert must update in place';
  end if;
end;
$$;

rollback;
