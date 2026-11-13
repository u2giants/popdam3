-- #2421 live proof probe (PopDAM). Read-only: catalog, pg_get_functiondef and
-- admin_config reads only; nothing is written and no rebuild is triggered.
-- Executed by shared-db-live-proof.mjs through the Supabase Management API
-- query endpoint. Returns one row whose `proof` JSON carries the installed
-- watermark machinery, the live watermark protocol state, and the operation
-- object the PopDAM worker updates.
WITH fn3 AS (
  SELECT p.oid, p.prosecdef, p.provolatile, p.proretset, p.proconfig,
         md5(pg_get_functiondef(p.oid)) AS body_md5
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.rebuild_style_groups_batch(uuid,integer,timestamptz)')
), fn2 AS (
  SELECT p.oid, md5(pg_get_functiondef(p.oid)) AS body_md5
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.rebuild_style_groups_batch(uuid,integer)')
), fnclear AS (
  SELECT md5(pg_get_functiondef(p.oid)) AS body_md5
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.clear_style_group_batch(uuid,integer)')
), fnkey AS (
  SELECT p.provolatile, p.proisstrict, p.proparallel,
         md5(pg_get_functiondef(p.oid)) AS body_md5
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.style_group_key_for_sku(text)')
), fnqueue AS (
  SELECT p.oid, p.prosecdef, p.provolatile, p.proconfig, pg_get_functiondef(p.oid) AS body
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.queue_nightly_rebuild_style_groups()')
), stamps_ok AS (
  SELECT count(*) AS n FROM (VALUES
    ('public.stamp_style_group_asset_change()'),
    ('public.stamp_style_group_definition_change()'),
    ('public.touch_style_group_tag_change()')
  ) e(signature)
  JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
  WHERE p.prosecdef AND p.provolatile = 'v'
    AND coalesce(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_temp']
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
), clocks AS (
  SELECT count(*) AS n FROM pg_attribute a
  JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE attrelid IN ('public.assets'::regclass, 'public.style_groups'::regclass)
    AND attname = 'style_group_changed_at' AND atttypid = 'timestamptz'::regtype
    AND attnotnull AND NOT attisdropped
    AND pg_get_expr(d.adbin, d.adrelid) = 'now()'
), triggers_ok AS (
  SELECT count(*) AS n FROM (VALUES
    ('public.assets', 'assets_style_group_change_clock', 'public.stamp_style_group_asset_change()', 23),
    ('public.style_groups', 'style_groups_style_group_change_clock', 'public.stamp_style_group_definition_change()', 23),
    ('public.style_group_tags', 'style_group_tags_change_clock', 'public.touch_style_group_tag_change()', 29)
  ) e(relation, name, signature, type)
  JOIN pg_trigger t ON t.tgrelid = to_regclass(e.relation) AND t.tgname = e.name
    AND t.tgfoid = to_regprocedure(e.signature) AND t.tgtype = e.type
    AND t.tgnargs = 0 AND NOT t.tgisinternal AND t.tgenabled = 'O'
), indexes_ok AS (
  SELECT count(*) AS n FROM (VALUES
    ('public.assets_style_group_changed_at_idx', 'style_group_changed_at, id', 'is_deleted = false'),
    ('public.style_groups_style_group_changed_at_idx', 'style_group_changed_at, id', ''),
    ('public.assets_ungrouped_style_cursor_idx', 'id)', 'style_group_id IS NULL')
  ) e(name, cols, pred)
  JOIN pg_index i ON i.indexrelid = to_regclass(e.name)
  WHERE i.indisvalid AND i.indisready
    AND position(e.cols in pg_get_indexdef(i.indexrelid)) > 0
    AND (e.pred = '' OR position(e.pred in pg_get_indexdef(i.indexrelid)) > 0)
), wm AS (
  SELECT value -> 'style-group-change-watermark' AS watermark,
         value -> 'rebuild-style-groups' AS rebuild_op,
         value -> 'style-group-counts-reconcile' AS counts_marker
  FROM admin_config
  WHERE key = 'BULK_OPERATIONS'
)
SELECT jsonb_build_object(
  'migration_applied', EXISTS(
    SELECT FROM supabase_migrations.schema_migrations WHERE version = '20261012012727'),
  'installed', jsonb_build_object(
    'recovery_rpc_two_arg', EXISTS(
      SELECT FROM fn2 WHERE body_md5 = '65c89b152f1d4aa49f3877043a16bd6b'),
    'recovery_rpc_two_arg_md5', (SELECT body_md5 FROM fn2),
    'watermark_rpc_three_arg', EXISTS(
      SELECT FROM fn3 WHERE body_md5 = '9222e39f7953290f2050123aa07811b6'
        AND prosecdef AND provolatile = 'v' AND proretset
        AND pg_get_function_result(oid) = 'TABLE(next_cursor uuid, groups_created integer, assets_assigned integer, assets_ungrouped integer, done boolean, rows_examined integer)'
        AND proconfig @> ARRAY['search_path=public', 'statement_timeout=120s', 'lock_timeout=0']
        AND has_function_privilege('service_role', oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')),
    'watermark_rpc_three_arg_md5', (SELECT body_md5 FROM fn3),
    'batch_clear_retained', EXISTS(
      SELECT FROM fnclear WHERE body_md5 = '3dbea0ab37aa21181efa966cbb4e1d8f'),
    'key_for_sku_retained', EXISTS(
      SELECT FROM fnkey WHERE body_md5 = '2edf6ba6ecea92b56defb5ddc811e701'
        AND provolatile = 'i' AND proisstrict AND proparallel = 's'),
    'stamp_functions', (SELECT n = 3 FROM stamps_ok),
    'queue_function', EXISTS(
      SELECT FROM fnqueue WHERE prosecdef AND provolatile = 'v'
        AND proconfig @> ARRAY['search_path=public']
        AND has_function_privilege('service_role', oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')),
    'queue_watermark_advance_guard', EXISTS(
      SELECT FROM fnqueue WHERE
        position('pending_run_id' in body) > 0
        AND position('last_successful_run_id' in body) > 0
        AND position('watermark_protocol' in body) > 0
        AND position('changed_cutoff' in body) > 0),
    'queue_weekly_full_pass', EXISTS(
      SELECT FROM fnqueue WHERE
        position('last_full_cutoff' in body) > 0
        AND position('rebuild_mode' in body) > 0
        AND position('incremental' in body) > 0
        AND position('7 days' in body) > 0),
    'change_clocks', (SELECT n = 2 FROM clocks),
    'change_triggers', (SELECT n = 3 FROM triggers_ok),
    'change_indexes', (SELECT n = 3 FROM indexes_ok)
  ),
  'watermark_state', (SELECT watermark FROM wm),
  'rebuild_op_state', (SELECT rebuild_op FROM wm),
  'counts_marker', (SELECT counts_marker FROM wm)
) AS proof;
