-- =====================================================================================
-- 20260810110000 -- forward corrections to three HIGH findings raised against PR #663
-- (issues #627 Warner STARLABS landing, #624 PopDAM OrderList).
--
-- WHY THIS IS A NEW MIGRATION AND NOT AN EDIT
--   All nine migrations in PR #663 are already applied to the preview branch
--   rjyboqwcdzcocqgmsyel, so their ledger rows exist and the CLI will never re-run
--   those files. Editing one would change nothing in the database and would
--   desynchronise file from ledger. AGENTS.md section 4 rule 4: the fix is always
--   forward. This migration is the fix.
--
-- SCOPE: plm.wb_* (8 tables) and api.dam_order_list. Nothing else is touched.
--
-- -------------------------------------------------------------------------------------
-- FIX 1 -- service_role keeps the complete unmitigated default on all 8 plm.wb_* tables.
--
--   plm carries a standing `alter default privileges in schema plm grant all on tables
--   to service_role` (20260710135975_reconcile_service_role_grants.sql:14). It fires at
--   CREATE TABLE time, before any GRANT in a migration runs. A narrower GRANT never
--   removes a bit; only REVOKE does. 20260810030000 grants
--   `select, insert, update, delete` and revokes nothing, so on preview today
--   service_role holds SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   *and MAINTAIN* on every plm.wb_* table (verified by has_table_privilege against
--   preview, PostgreSQL 17.6 -- MAINTAIN is real on this server, it is not theoretical).
--   Paramount (20260810090000:78) revokes truncate+trigger; NBCU (20260810080000:71)
--   revokes update+delete+truncate. Warner revoked nothing at all.
--
--   THE DECISION, STATED EXPLICITLY: revoke UPDATE, DELETE, TRUNCATE, REFERENCES,
--   TRIGGER and MAINTAIN. KEEP SELECT and INSERT. This is strictly stronger than both
--   Paramount's and NBCU's posture, and it adds the two bits neither of them removed
--   (REFERENCES and MAINTAIN).
--
--   WHY THE LOADERS DO NOT BREAK. Every Warner loader is
--   plm.sync_wb_<entity>(jsonb, text, numeric), and all eight are SECURITY DEFINER owned
--   by `postgres` (verified on preview: pg_proc.prosecdef = true, proowner = postgres).
--   A SECURITY DEFINER function performs its writes with the OWNER's privileges, so the
--   loaders never consume service_role's table grants. service_role only needs EXECUTE
--   on the wrappers, which 20260810030000 already grants and this migration leaves
--   alone. No file in this repository (tools/, .github/workflows/, apps/) writes a
--   plm.wb_* table directly.
--
--   WHY INSERT IS KEPT. Removing INSERT would be safe against every writer that exists
--   in this repository, but the Warner capture is driven from outside it (the STARLABS
--   extraction), and INSERT is the one bit whose loss could silently strand a direct
--   bulk-load path that is not enumerable from here. Its blast radius is bounded and
--   detectable -- extra raw rows in a landing table, visible and deletable by the owner.
--   UPDATE, DELETE, TRUNCATE are the irreversible ones and they go. TRIGGER and
--   REFERENCES let a caller attach behaviour or a dependency to a landing table, which
--   no loader needs. MAINTAIN (PG17) permits VACUUM/ANALYZE/REINDEX/CLUSTER/REFRESH,
--   also nothing a loader needs.
--
--   PUBLIC and anon are revoked belt-and-braces, matching Paramount.
--
-- -------------------------------------------------------------------------------------
-- FIX 2 -- Warner's read policy was `using (true)`: every signed-in account, including
--   vendor and viewer, could read all 8 Warner tables -- franchise and property names,
--   STARLABS source ids, style-guide identities, character names and ids, asset ids,
--   filenames and metadata, and all four link tables. anon was correctly excluded.
--
--   20260810030000:134-136 claims the posture "matches plm.opa_property_character".
--   That has been FALSE since 20260807190000_opa_security_and_view_corrections.sql:73-81
--   replaced the OPA policy with a role gate and called the loose version a HIGH
--   finding. Warner cited a precedent that no longer existed.
--
--   The predicate below is copied verbatim from that migration (lines 73-81).
--
-- -------------------------------------------------------------------------------------
-- FIX 3 -- api.dam_order_list is effectively a SECURITY DEFINER view.
--   20260810010000:409 creates it with no `with (security_invoker = true)` and :532
--   grants SELECT to authenticated. security_invoker defaults to FALSE, so the view runs
--   as its owner (postgres, BYPASSRLS) and the RLS on its base tables does not apply to
--   reads through it. The comment at :398 asserts the opposite; it is corrected here.
--   AGENTS.md lines 1798-1803 record three views of this exact shape leaking ~16,600
--   rows. Warner got this right in the same PR (20260810030000:3038, 3068).
--
--   Measured pre-fix effect on preview: the view returns 0 rows today because
--   plm.production_order and plm.production_order_line are empty. The escalation is
--   nonetheless real and would bite the moment orders land: the view joins core.customer
--   (864 rows on preview) and core.factory, whose SELECT policies are restricted to
--   administrator/sales/licensing, and plm.item, restricted to plm app access. Under a
--   definer view every authenticated account would read those columns regardless.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- FIX 1
-- -------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'wb_franchise_property','wb_style_guide','wb_character','wb_asset',
    'wb_asset_style_guide','wb_asset_franchise_property','wb_asset_character',
    'wb_property_character'
  ]
  loop
    execute format(
      'revoke update, delete, truncate, references, trigger, maintain on plm.%I from service_role', t);
    execute format('revoke all on plm.%I from public', t);
    execute format('revoke all on plm.%I from anon', t);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------------------
-- FIX 2 -- predicate copied verbatim from 20260807190000:73-81.
-- -------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'wb_franchise_property','wb_style_guide','wb_character','wb_asset',
    'wb_asset_style_guide','wb_asset_franchise_property','wb_asset_character',
    'wb_property_character'
  ]
  loop
    execute format('drop policy if exists %I on plm.%I', t || '_read', t);
    execute format($p$
      create policy %I on plm.%I
        for select to authenticated
        using (
          app.has_role('administrator')
          or app.has_app_access('plm')
          or app.has_any_role(array['sales', 'licensing']::app.app_role[])
        )
    $p$, t || '_read', t);
  end loop;
end;
$$;

comment on table plm.wb_franchise_property is
  'RAW Warner Bros. STARLABS franchise/property extract. READ IS RESTRICTED '
  '(migration 20260810110000): administrator, plm app access, or the sales/licensing '
  'roles only. It is NOT readable by every authenticated account; vendor and viewer are '
  'excluded. Loader writes go through plm.sync_wb_franchise_property (security definer); '
  'service_role holds SELECT and INSERT only -- no UPDATE, DELETE, TRUNCATE, REFERENCES, '
  'TRIGGER or MAINTAIN. Business-confidential licensor data.';

comment on table plm.wb_style_guide is
  'RAW Warner Bros. STARLABS style-guide identities. READ IS RESTRICTED (migration '
  '20260810110000): administrator, plm app access, or the sales/licensing roles only. '
  'Loader writes go through plm.sync_wb_style_guide (security definer); service_role '
  'holds SELECT and INSERT only. Business-confidential licensor data.';

comment on table plm.wb_character is
  'RAW Warner Bros. STARLABS character extract. READ IS RESTRICTED (migration '
  '20260810110000): administrator, plm app access, or the sales/licensing roles only. '
  'Loader writes go through plm.sync_wb_character (security definer); service_role holds '
  'SELECT and INSERT only. Business-confidential licensor data.';

comment on table plm.wb_asset is
  'RAW Warner Bros. STARLABS asset extract (asset ids, filenames, metadata). READ IS '
  'RESTRICTED (migration 20260810110000): administrator, plm app access, or the '
  'sales/licensing roles only. Loader writes go through plm.sync_wb_asset (security '
  'definer); service_role holds SELECT and INSERT only. Business-confidential licensor data.';

comment on table plm.wb_asset_style_guide is
  'RAW Warner Bros. STARLABS asset<->style-guide link. READ IS RESTRICTED (migration '
  '20260810110000): administrator, plm app access, or the sales/licensing roles only. '
  'Loader writes go through plm.sync_wb_asset_style_guide (security definer); '
  'service_role holds SELECT and INSERT only.';

comment on table plm.wb_asset_franchise_property is
  'RAW Warner Bros. STARLABS asset<->franchise/property link. READ IS RESTRICTED '
  '(migration 20260810110000): administrator, plm app access, or the sales/licensing '
  'roles only. Loader writes go through plm.sync_wb_asset_franchise_property (security '
  'definer); service_role holds SELECT and INSERT only.';

comment on table plm.wb_asset_character is
  'RAW Warner Bros. STARLABS asset<->character link. READ IS RESTRICTED (migration '
  '20260810110000): administrator, plm app access, or the sales/licensing roles only. '
  'Loader writes go through plm.sync_wb_asset_character (security definer); service_role '
  'holds SELECT and INSERT only.';

comment on table plm.wb_property_character is
  'RAW Warner Bros. STARLABS property<->character link (the direct portal list). READ IS '
  'RESTRICTED (migration 20260810110000): administrator, plm app access, or the '
  'sales/licensing roles only. Loader writes go through plm.sync_wb_property_character '
  '(security definer); service_role holds SELECT and INSERT only.';

-- -------------------------------------------------------------------------------------
-- FIX 3
-- -------------------------------------------------------------------------------------
alter view api.dam_order_list set (security_invoker = true);

comment on view api.dam_order_list is
  'PopDAM /orders serving contract. SECURITY INVOKER -- set by migration 20260810110000; '
  'the view was created WITHOUT it in 20260810010000, which made it run as its owner '
  '(postgres, BYPASSRLS) and bypass the RLS on core.customer, core.factory, plm.item and '
  'the production_order tables for every authenticated reader. RLS on the base tables now '
  'applies to reads through this view. Live item/Master Data values plus the immutable '
  'order_list_snapshot fallback, with explicit master_data_match_status and link '
  'diagnostics. Read-only: writes go through public.create_dam_order / update_dam_order / '
  'link_dam_order_line.';
