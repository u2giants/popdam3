-- #6409: retire 18 plain unique btree indexes that are byte-identical twins
-- of a constraint-owned index on the same table and columns. Part of the
-- #2326 program (plan Step 5, candidate family 3 'Duplicate indexes', split by
-- the 2026-11-15 evidence triage).
--
-- WHY
-- ---
-- Every pair has the same keys/order/uniqueness and no predicate/expression/
-- INCLUDE. The constraint-owned twin stays (required by its PRIMARY KEY /
-- UNIQUE constraint and by the repository contract tests). These twins are
-- pure write amplification: every INSERT/UPDATE on these tables maintains two
-- identical unique indexes (~2.9 MB of duplicate index at the 2026-09-04
-- capture).
--
-- SCOPE — the 18 drop names and their keepers (issue #6409's table)
-- ---------------------------------------------------------------
-- The same drop names live in TWO environments, and the schema mix differs:
-- shared preview carries both `dflow` and `dflow_prod`, shared production
-- carries `dflow_prod` (no `dflow` — it is gone there; verified read-only
-- 2026-11-15), and the DesignFlow sandbox carries `dflow` (no `dflow_prod`).
-- The `app`/`plm` names exist in more than one of those. A per-object
-- existence guard (the repository pattern for "cannot reference a missing
-- object": 20260729130000) therefore drops each twin wherever it exists and
-- no-ops elsewhere, so one file serves every governed lane.
--
--   drop: app.quote_auth_token_pkey                      keep: app.auth_token_pkey
--   drop: dflow.quote_auth_token_pkey                    keep: dflow.auth_token_pkey
--   drop: dflow_prod.quote_auth_token_pkey               keep: dflow_prod.auth_token_pkey
--   drop: dflow."GridLayout_pkey"                        keep: dflow."RFQLayout_pkey"
--   drop: dflow_prod."GridLayout_pkey"                   keep: dflow_prod."RFQLayout_pkey"
--   drop: plm."GridLayout_pkey"                          keep: plm."RFQLayout_pkey"
--   drop: dflow."StandardizedVersionDetail_pkey"         keep: dflow."StandardizedDetail_pkey"
--   drop: dflow_prod."StandardizedVersionDetail_pkey"    keep: dflow_prod."StandardizedDetail_pkey"
--   drop: plm."StandardizedVersionDetail_pkey"           keep: plm."StandardizedDetail_pkey"
--   drop: app."RolePermissions_unique_role_user_element"  keep: app."RolePermissions_RoleId_UserId_ElementId_key"
--   drop: dflow."RolePermissions_unique_role_user_element" keep: dflow."RolePermissions_RoleId_UserId_ElementId_key"
--   drop: dflow_prod."RolePermissions_unique_role_user_element" keep: dflow_prod."RolePermissions_RoleId_UserId_ElementId_key"
--   drop: dflow.item_prod_order_detail_associations_unique_pair
--     keep: dflow.item_prod_order_detail_associ_item_header_id_prod_order_det_key
--   drop: dflow_prod.item_prod_order_detail_associations_unique_pair
--     keep: dflow_prod.item_prod_order_detail_associ_item_header_id_prod_order_det_key
--   drop: plm.item_prod_order_detail_associations_unique_pair
--     keep: plm.item_prod_order_detail_associ_item_header_id_prod_order_det_key
--   drop: dflow.unique_item_stage                        keep: dflow.unique_item_stage_designflow_1774369813518
--   drop: dflow_prod.unique_item_stage                   keep: unique_item_stage_designflow_1774369813518 (production) /
--                                                             unique_item_stage_dflow_prod_1774369813518 (preview) — names diverge
--   drop: plm.unique_item_stage                          keep: plm.unique_item_stage_designflow_1774369813518
--
-- ROLLBACK (named, per index)
-- ---------------------------
-- Forward migration restoring the exact captured definitions — issue #6409's
-- CREATE UNIQUE INDEX set (the DDL for each dropped name). Bounded restore:
-- one forward migration with the needed DDL; verify presence via the #2043
-- catalog verifier (inverse assertion).
--
-- Drop path: repository proven pattern (20261022191243_retire_dam_search_
-- documents_text_indexes.sql) — plain DROP INDEX with lock_timeout fail-fast;
-- no CONCURRENTLY (the migration runner is transactional).

begin;

set local lock_timeout = '5s';

do $$
declare
  t record;
  dropped integer := 0;
  skipped text := '';
  missing text := '';
begin
  for t in
    select * from (values
      ('app', 'quote_auth_token_pkey'),
      ('dflow', 'quote_auth_token_pkey'),
      ('dflow_prod', 'quote_auth_token_pkey'),
      ('dflow', 'GridLayout_pkey'),
      ('dflow_prod', 'GridLayout_pkey'),
      ('plm', 'GridLayout_pkey'),
      ('dflow', 'StandardizedVersionDetail_pkey'),
      ('dflow_prod', 'StandardizedVersionDetail_pkey'),
      ('plm', 'StandardizedVersionDetail_pkey'),
      ('app', 'RolePermissions_unique_role_user_element'),
      ('dflow', 'RolePermissions_unique_role_user_element'),
      ('dflow_prod', 'RolePermissions_unique_role_user_element'),
      ('dflow', 'item_prod_order_detail_associations_unique_pair'),
      ('dflow_prod', 'item_prod_order_detail_associations_unique_pair'),
      ('plm', 'item_prod_order_detail_associations_unique_pair'),
      ('dflow', 'unique_item_stage'),
      ('dflow_prod', 'unique_item_stage'),
      ('plm', 'unique_item_stage')
    ) as v(sch, idx)
  loop
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = t.sch and c.relname = t.idx and c.relkind = 'i'
    ) then
      execute format('drop index if exists %I.%I', t.sch, t.idx);
      dropped := dropped + 1;
    else
      skipped := skipped || t.sch || '.' || t.idx || '; ';
    end if;
  end loop;

  raise notice '#6409: dropped % twin index(es); absent here (other lanes own them): %',
    dropped, skipped;

  -- Keepers: wherever the twin's table exists, some unique index on the SAME
  -- definition must remain after the drop (the keeper). Keeper NAMES diverge
  -- between preview and production for one pair (dflow_prod."licensingMilestone":
  -- unique_item_stage_designflow_1774369813518 on production,
  -- unique_item_stage_dflow_prod_1774369813518 on preview — verified read-only
  -- 2026-11-15), so the assertion is definition-based, not name-based.
  for t in
    select * from (values
      ('app', 'quote_auth_token', 'quote_auth_token_pkey', array['id']),
      ('dflow', 'quote_auth_token', 'quote_auth_token_pkey', array['id']),
      ('dflow_prod', 'quote_auth_token', 'quote_auth_token_pkey', array['id']),
      ('dflow', 'GridLayout', 'GridLayout_pkey', array['id']),
      ('dflow_prod', 'GridLayout', 'GridLayout_pkey', array['id']),
      ('plm', 'GridLayout', 'GridLayout_pkey', array['id']),
      ('dflow', 'StandardizedDetail', 'StandardizedVersionDetail_pkey', array['id']),
      ('dflow_prod', 'StandardizedDetail', 'StandardizedVersionDetail_pkey', array['id']),
      ('plm', 'StandardizedDetail', 'StandardizedVersionDetail_pkey', array['id']),
      ('app', 'RolePermissions', 'RolePermissions_unique_role_user_element', array['RoleId','UserId','ElementId']),
      ('dflow', 'RolePermissions', 'RolePermissions_unique_role_user_element', array['RoleId','UserId','ElementId']),
      ('dflow_prod', 'RolePermissions', 'RolePermissions_unique_role_user_element', array['RoleId','UserId','ElementId']),
      ('dflow', 'item_prod_order_detail_associations', 'item_prod_order_detail_associations_unique_pair', array['item_header_id','prod_order_detail_pkey']),
      ('dflow_prod', 'item_prod_order_detail_associations', 'item_prod_order_detail_associations_unique_pair', array['item_header_id','prod_order_detail_pkey']),
      ('plm', 'item_prod_order_detail_associations', 'item_prod_order_detail_associations_unique_pair', array['item_header_id','prod_order_detail_pkey']),
      ('dflow', 'licensingMilestone', 'unique_item_stage', array['itemheader_id_fk','stage']),
      ('dflow_prod', 'licensingMilestone', 'unique_item_stage', array['itemheader_id_fk','stage']),
      ('plm', 'licensingMilestone', 'unique_item_stage', array['itemheader_id_fk','stage'])
    ) as k(sch, tbl, twin, cols)
  loop
    if exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = k.sch and c.relname = k.tbl and c.relkind = 'r'
    ) then
      if not exists (
        select 1
        from pg_index ix
        join pg_class i on i.oid = ix.indexrelid
        join pg_class c on c.oid = ix.indrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = k.sch and c.relname = k.tbl
          and ix.indisunique
          and i.relname <> k.twin
          and (select array_agg(a.attname order by u.ord)
               from unnest(ix.indkey) with ordinality as u(attnum, ord)
               join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = u.attnum
              ) = k.cols
      ) then
        missing := missing || k.sch || '.' || k.tbl || '(' || array_to_string(k.cols, ',') || '); ';
      end if;
    end if;
  end loop;

  if missing <> '' then
    raise exception '#6409 keeper missing or not unique after twin drops: %', missing;
  end if;
end $$;

commit;
