-- designflow-tracking#130 / #7156: DesignFlow Item Master runtime reads Stage Catalog
-- licensing durations (plm.stage_list, plm.stage, plm.stage_duration) by column directly
-- via designflow_prod_item_master_runtime and can never write to any Stage Catalog table,
-- read hidden/maintainers columns, or read tracker/option tables.
begin;

do $a$
declare
  tbl text;
  priv text;
  v_bad text;
begin
  if not has_schema_privilege('designflow_prod_item_master_runtime', 'plm', 'USAGE')
     or has_schema_privilege('designflow_prod_item_master_runtime', 'plm', 'CREATE') then
    raise exception 'designflow_prod_item_master_runtime is not bound to plm USAGE-only access';
  end if;

  foreach tbl in array array[
    'plm.stage_list', 'plm.stage', 'plm.stage_duration',
    'plm.stage_dependency', 'plm.licensor_stage_option',
    'plm.prod_stage_progress', 'plm.prod_stage_option'
  ] loop
    foreach priv in array array['INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_any_column_privilege('designflow_prod_item_master_runtime', tbl, priv) then
        raise exception 'designflow_prod_item_master_runtime has % on %', priv, tbl;
      end if;
    end loop;
    foreach priv in array array['SELECT', 'DELETE', 'TRUNCATE', 'TRIGGER'] loop
      if has_table_privilege('designflow_prod_item_master_runtime', tbl, priv) then
        raise exception 'designflow_prod_item_master_runtime has table-wide % on %', priv, tbl;
      end if;
    end loop;
    -- Ensure Stage Catalog table privileges are never held via the shared grant role (#7156).
    if has_any_column_privilege('designflow_prod_item_master_grants', tbl, 'SELECT,INSERT,UPDATE,REFERENCES')
       or has_table_privilege('designflow_prod_item_master_grants', tbl, 'DELETE,TRUNCATE,TRIGGER') then
      raise exception 'designflow_prod_item_master_grants unexpectedly holds Stage Catalog privileges on %', tbl;
    end if;
    if has_any_column_privilege('designflow_prod_backend_runtime', tbl, 'SELECT,INSERT,UPDATE,REFERENCES')
       or has_table_privilege('designflow_prod_backend_runtime', tbl, 'DELETE,TRUNCATE,TRIGGER') then
      raise exception 'designflow_prod_backend_runtime unexpectedly holds Stage Catalog privileges on %', tbl;
    end if;
  end loop;

  -- Exact permitted columns on the 3 Stage Catalog tables.
  with granted_cols as (
    select c.relname, att.attname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
    where n.nspname = 'plm'
      and c.relname in ('stage_list', 'stage', 'stage_duration')
      and has_column_privilege('designflow_prod_item_master_runtime', c.oid, att.attname, 'SELECT')
  ), want_cols as (
    select * from (values
      ('stage_list', 'id'),
      ('stage_list', 'key'),
      ('stage', 'id'),
      ('stage', 'list_id'),
      ('stage', 'done_signal'),
      ('stage', 'active'),
      ('stage_duration', 'stage_id'),
      ('stage_duration', 'scope_kind'),
      ('stage_duration', 'scope_value'),
      ('stage_duration', 'duration')
    ) v(relname, attname)
  )
  select string_agg(coalesce(g.relname, w.relname) || '.' || coalesce(g.attname, w.attname), ', ') into v_bad
  from granted_cols g
  full join want_cols w on w.relname = g.relname and w.attname = g.attname
  where g.relname is null or w.relname is null;
  if v_bad is not null then
    raise exception 'item_master Stage Catalog column SELECT ACL differs from exact matrix: %', v_bad;
  end if;

  foreach tbl in array array['plm.stage_dependency', 'plm.licensor_stage_option', 'plm.prod_stage_progress', 'plm.prod_stage_option'] loop
    if has_any_column_privilege('designflow_prod_item_master_runtime', tbl, 'SELECT') then
      raise exception 'item_master must not read %', tbl;
    end if;
  end loop;

  if (select count(*) from pg_policies
      where schemaname = 'plm'
        and ((tablename = 'stage_list' and policyname = 'stage_list_dflow_prod_item_master_read')
          or (tablename = 'stage' and policyname = 'stage_dflow_prod_item_master_read')
          or (tablename = 'stage_duration' and policyname = 'stage_duration_dflow_prod_item_master_read'))
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
        and qual = 'true'
        and roles = array['designflow_prod_item_master_runtime'::name]) <> 3 then
    raise exception 'expected 3 exact PERMISSIVE USING (true) SELECT-only Stage Catalog RLS policies for designflow_prod_item_master_runtime';
  end if;
end
$a$;

do $b$
declare
  v_count int;
begin
  begin
    set local role designflow_prod_item_master_runtime;
  exception when insufficient_privilege then
    raise warning 'B NOT EXERCISED: % cannot SET ROLE designflow_prod_item_master_runtime; A-section assertions only', current_user;
    return;
  end;

  select count(*) into v_count
  from plm.stage_duration sd
  join plm.stage s on s.id = sd.stage_id
  join plm.stage_list sl on sl.id = s.list_id
  where sl.key = 'licensing' and s.active and sd.scope_kind = 'licensor';
  if v_count = 0 then
    raise exception 'B1 designflow_prod_item_master_runtime read 0 licensing duration rows from Stage Catalog';
  end if;

  begin
    perform maintainers from plm.stage_list limit 1;
    raise exception 'B2 designflow_prod_item_master_runtime unexpectedly read plm.stage_list.maintainers';
  exception when insufficient_privilege then null; end;

  begin
    perform shown_on_tracker from plm.stage limit 1;
    raise exception 'B3 designflow_prod_item_master_runtime unexpectedly read plm.stage.shown_on_tracker';
  exception when insufficient_privilege then null; end;

  begin
    perform id from plm.stage_duration limit 1;
    raise exception 'B4 designflow_prod_item_master_runtime unexpectedly read plm.stage_duration.id';
  exception when insufficient_privilege then null; end;

  begin
    perform 1 from plm.prod_stage_progress limit 1;
    raise exception 'B5 designflow_prod_item_master_runtime unexpectedly read plm.prod_stage_progress';
  exception when insufficient_privilege then null; end;
end
$b$;

rollback;
