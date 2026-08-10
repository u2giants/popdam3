-- =====================================================================================
-- 20260810120000 -- two forward corrections on the eight plm.wb_* Warner STARLABS
-- landing tables, both against migration 20260810110000 in this same PR (#663).
--
-- WHY THIS IS A NEW MIGRATION AND NOT AN EDIT
--   20260810110000 is already applied to the preview branch rjyboqwcdzcocqgmsyel, so its
--   ledger row exists and the CLI will never re-run the file. Editing it would change
--   nothing in the database and would desynchronise file from ledger. AGENTS.md section 4
--   rule 4: the fix is always forward.
--
-- SCOPE: comments and grants on the 8 plm.wb_* tables. NOTHING ELSE. In particular the
--   RLS predicate is deliberately NOT changed -- see CORRECTION 1.
--
-- -------------------------------------------------------------------------------------
-- CORRECTION 1 -- the table comments make a SECURITY CLAIM THAT IS FALSE.
--
--   20260810110000 wrote eight `comment on table` statements asserting the read gate is
--   "administrator, plm app access, or the sales/licensing roles only", and the first of
--   them says outright: "vendor and viewer are excluded".
--
--   That is not what the policy does. The predicate it installed is
--
--       app.has_role('administrator')
--       or app.has_app_access('plm')
--       or app.has_any_role(array['sales','licensing']::app.app_role[])
--
--   and app.has_app_access (20260621150815_app_core.sql:397-411) is:
--
--       select app.has_role('administrator')
--       or exists (select 1 from app.app_access aa
--                  where aa.profile_id = app.current_profile_id()
--                    and aa.app = required_app
--                    and aa.revoked_at is null);
--
--   It looks at ONE thing: whether the caller's profile holds a non-revoked row in
--   app.app_access for that app. It NEVER looks at app.user_role and it NEVER looks at
--   the JWT role names. It is ROLE-INDEPENDENT BY CONSTRUCTION.
--
--   Therefore a principal whose only app role is `vendor` or `viewer` READS ALL EIGHT
--   WARNER TABLES the moment that profile has a `plm` app_access row -- franchise and
--   property names, STARLABS source ids, style-guide identities, character names and ids,
--   asset ids, filenames and metadata, and all four link tables. "vendor and viewer are
--   excluded" is false, and the softer wording on the other seven ("... roles only") is
--   misleading in the same direction, because `plm app access` is not a role and does not
--   behave like one.
--
--   WHAT THIS MIGRATION CHANGES, AND WHAT IT DELIBERATELY DOES NOT.
--   It changes the CLAIM to match the CODE. It does NOT touch the predicate.
--   The predicate is a pre-existing house pattern, copied verbatim from
--   20260807190000_opa_security_and_view_corrections.sql:73-81, and the same shape is in
--   use elsewhere in this database. Narrowing the app-access arm would change the access
--   model for every table that shares the pattern, which is an owner decision and is not
--   in scope for a comment defect. A false comment is fixed by correcting the comment.
--
--   Net effect on the access model: ZERO. This half of the migration is comments only.
--
-- -------------------------------------------------------------------------------------
-- CORRECTION 2 -- revoke INSERT from service_role on all 8 tables.
--
--   20260810110000 revoked UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN but
--   KEPT INSERT, reasoning that losing it "could silently strand a direct bulk-load path".
--   That reasoning does not hold:
--
--   (a) It would not be silent. A revoked INSERT raises 42501 insufficient_privilege at
--       the statement. That is loud, immediate and attributable -- the opposite of silent.
--       An over-broad INSERT is the failure mode that IS silent: unguarded rows landing in
--       a mirror table beside the guarded loader output, indistinguishable afterwards.
--
--   (b) Nothing consumes it. All eight loaders are plm.sync_wb_<entity>(jsonb, text,
--       numeric), all eight are SECURITY DEFINER owned by postgres
--       (20260810030000:727, 954, 1009, 1238), so they perform their writes with the
--       OWNER's privileges and never consume service_role's table grants. service_role
--       holds EXECUTE on the plm and public wrappers (20260810030000:970-971) and that is
--       the entire supported write path. A repo-wide search for every plm.wb_* table name
--       across tools/, apps/, .github/workflows/, scripts/ and supabase/ returns only the
--       two migrations that define these tables, the contract test, and two documents --
--       no reader and no writer.
--
--   After this migration service_role holds SELECT and nothing else on all eight tables.
--   The loaders are unaffected, and supabase/tests/wb_grants_rls_and_dam_order_list_invoker.sql
--   section D proves that by running one end to end from a non-postgres session_user.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- CORRECTION 2 -- service_role: SELECT only.
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
    execute format('revoke insert on plm.%I from service_role', t);
  end loop;
end;
$$;

-- -------------------------------------------------------------------------------------
-- CORRECTION 1 -- eight corrected comments.
--
-- Shared wording, and why each clause is true:
--   * "administrator, the sales or licensing roles, OR ANY PRINCIPAL HOLDING plm APP
--     ACCESS" -- the three arms of the predicate, named accurately.
--   * "app access is NOT a role: app.has_app_access checks only for a non-revoked
--     app.app_access row, so a vendor or viewer with plm app access CAN read this table"
--     -- this is the sentence 20260810110000 got backwards.
--   * "anon and unauthenticated readers are excluded" -- true: the policy is
--     `for select to authenticated`, and 20260810110000 revoked all from anon and PUBLIC.
--   * "service_role holds SELECT only" -- true as of this migration.
-- -------------------------------------------------------------------------------------

comment on table plm.wb_franchise_property is
  'RAW Warner Bros. STARLABS franchise/property extract. READ GATE (policy installed by '
  '20260810110000): administrator, the sales or licensing roles, or ANY principal holding '
  'plm app access. CORRECTION (20260810120000): plm app access is NOT a role -- '
  'app.has_app_access checks only for a non-revoked app.app_access row and ignores the '
  'caller''s roles entirely, so a vendor or a viewer whose profile has plm app access CAN '
  'read this table. The earlier comment claimed vendor and viewer were excluded; that was '
  'false. Only anon and unauthenticated readers are excluded. Loader writes go through '
  'plm.sync_wb_franchise_property (security definer, owned by postgres); service_role '
  'holds SELECT only. Business-confidential licensor data.';

comment on table plm.wb_style_guide is
  'RAW Warner Bros. STARLABS style-guide identities. READ GATE (policy installed by '
  '20260810110000): administrator, the sales or licensing roles, or ANY principal holding '
  'plm app access. CORRECTION (20260810120000): plm app access is NOT a role -- '
  'app.has_app_access checks only for a non-revoked app.app_access row and ignores the '
  'caller''s roles entirely, so a vendor or a viewer whose profile has plm app access CAN '
  'read this table. Only anon and unauthenticated readers are excluded. Loader writes go '
  'through plm.sync_wb_style_guide (security definer, owned by postgres); service_role '
  'holds SELECT only. Business-confidential licensor data.';

comment on table plm.wb_character is
  'RAW Warner Bros. STARLABS character extract. READ GATE (policy installed by '
  '20260810110000): administrator, the sales or licensing roles, or ANY principal holding '
  'plm app access. CORRECTION (20260810120000): plm app access is NOT a role -- '
  'app.has_app_access checks only for a non-revoked app.app_access row and ignores the '
  'caller''s roles entirely, so a vendor or a viewer whose profile has plm app access CAN '
  'read this table. Only anon and unauthenticated readers are excluded. Loader writes go '
  'through plm.sync_wb_character (security definer, owned by postgres); service_role holds '
  'SELECT only. Business-confidential licensor data.';

comment on table plm.wb_asset is
  'RAW Warner Bros. STARLABS asset extract (asset ids, filenames, metadata). READ GATE '
  '(policy installed by 20260810110000): administrator, the sales or licensing roles, or '
  'ANY principal holding plm app access. CORRECTION (20260810120000): plm app access is '
  'NOT a role -- app.has_app_access checks only for a non-revoked app.app_access row and '
  'ignores the caller''s roles entirely, so a vendor or a viewer whose profile has plm app '
  'access CAN read this table. Only anon and unauthenticated readers are excluded. Loader '
  'writes go through plm.sync_wb_asset (security definer, owned by postgres); service_role '
  'holds SELECT only. Business-confidential licensor data.';

comment on table plm.wb_asset_style_guide is
  'RAW Warner Bros. STARLABS asset<->style-guide link. READ GATE (policy installed by '
  '20260810110000): administrator, the sales or licensing roles, or ANY principal holding '
  'plm app access. CORRECTION (20260810120000): plm app access is NOT a role -- '
  'app.has_app_access checks only for a non-revoked app.app_access row and ignores the '
  'caller''s roles entirely, so a vendor or a viewer whose profile has plm app access CAN '
  'read this table. Only anon and unauthenticated readers are excluded. Loader writes go '
  'through plm.sync_wb_asset_style_guide (security definer, owned by postgres); '
  'service_role holds SELECT only.';

comment on table plm.wb_asset_franchise_property is
  'RAW Warner Bros. STARLABS asset<->franchise/property link. READ GATE (policy installed '
  'by 20260810110000): administrator, the sales or licensing roles, or ANY principal '
  'holding plm app access. CORRECTION (20260810120000): plm app access is NOT a role -- '
  'app.has_app_access checks only for a non-revoked app.app_access row and ignores the '
  'caller''s roles entirely, so a vendor or a viewer whose profile has plm app access CAN '
  'read this table. Only anon and unauthenticated readers are excluded. Loader writes go '
  'through plm.sync_wb_asset_franchise_property (security definer, owned by postgres); '
  'service_role holds SELECT only.';

comment on table plm.wb_asset_character is
  'RAW Warner Bros. STARLABS asset<->character link. READ GATE (policy installed by '
  '20260810110000): administrator, the sales or licensing roles, or ANY principal holding '
  'plm app access. CORRECTION (20260810120000): plm app access is NOT a role -- '
  'app.has_app_access checks only for a non-revoked app.app_access row and ignores the '
  'caller''s roles entirely, so a vendor or a viewer whose profile has plm app access CAN '
  'read this table. Only anon and unauthenticated readers are excluded. Loader writes go '
  'through plm.sync_wb_asset_character (security definer, owned by postgres); service_role '
  'holds SELECT only.';

comment on table plm.wb_property_character is
  'RAW Warner Bros. STARLABS property<->character link (the direct portal list). READ GATE '
  '(policy installed by 20260810110000): administrator, the sales or licensing roles, or '
  'ANY principal holding plm app access. CORRECTION (20260810120000): plm app access is '
  'NOT a role -- app.has_app_access checks only for a non-revoked app.app_access row and '
  'ignores the caller''s roles entirely, so a vendor or a viewer whose profile has plm app '
  'access CAN read this table. Only anon and unauthenticated readers are excluded. Loader '
  'writes go through plm.sync_wb_property_character (security definer, owned by postgres); '
  'service_role holds SELECT only.';
