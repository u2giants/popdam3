-- =====================================================================================
-- plm.item — additive SELECT policy for `authenticated` (issue #653, claim #698)
--
-- THE DEFECT
-- ----------
-- `api.dam_order_list` (20260810010000:409) left-joins `plm.item` (:516) to project
-- `item_number`, `item_style_number`, `item_name` and `item_description` (:475-478).
-- Since 20260810110000:183 set `security_invoker = true` on that view, the base-table
-- RLS of `plm.item` applies to the READER rather than to the view owner. `plm.item`'s
-- only SELECT policy is `plm_read`, created by the loop at
-- 20260621151155_api_rls_realtime.sql:436-462:
--
--     app.has_app_access('plm')
--     or app.has_role('administrator')
--     or app.has_any_role(array['sales','licensing']::app.app_role[])
--
-- PopDAM staff hold PopDAM app access (`app.app_access.app = 'dam'`; there is no
-- `popdam` label in the `app.app_name` enum) and the app-schema `designer` / `viewer`
-- role. They satisfy none of those arms — `app.has_app_access('plm')` is a different
-- app row, and `designer`/`viewer` are not in the administrator/sales/licensing list —
-- so the four item columns come back NULL for them
-- while `master_data_*`, `customer_name` and `vendor_name` on the same row populate
-- normally (those base tables already carry authenticated-wide or `designer`/`viewer`
-- SELECT policies).
--
-- THE FIX — OWNER RULING 2026-08-10, OPTION A
-- -------------------------------------------
-- Add an ADDITIVE permissive SELECT policy for `authenticated` on `plm.item`, exactly
-- matching the precedent this same workstream already set for `plm.production_order`
-- and `plm.production_order_line` at 20260810010000:302-312. Postgres ORs multiple
-- permissive SELECT policies together, so `plm_read` keeps working unchanged for the
-- PLM audience and the new policy simply widens the read audience.
--
-- THE SECURITY TRADE-OFF — A DECISION, NOT AN ACCIDENT
-- ----------------------------------------------------
-- This makes the WHOLE ITEM CATALOGUE (`plm.item`) readable by EVERY authenticated
-- account, not only by PopDAM staff and not only through `api.dam_order_list`. Item
-- number, style number, name and description stop being PLM-audience data. That is the
-- owner's explicitly accepted cost, ruled on 2026-08-10 (issue #653), and it is the
-- same cost already accepted for `plm.production_order` and `plm.production_order_line`
-- on 2026-08-10 under owner decision 8. If a future owner narrows that stance, the
-- correct move is to replace THIS policy with a tighter predicate — never to remove
-- `security_invoker` from the view.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ---------------------------------------
-- * It does NOT touch `api.dam_order_list` in any way. Reverting
--   `security_invoker = true` would "fix" the blank columns by silently re-exposing
--   `core.customer`, `core.factory` AND `plm.item` to every authenticated account
--   through the view — a strictly worse hole than the one accepted above, and one that
--   20260810110000 closed on purpose. The contract test asserts the setting is still
--   true so any future revert fails the suite loudly.
-- * It does NOT alter or drop `plm_read`, and does not widen WRITES: `plm_admin_write`
--   is untouched and ordinary staff still cannot write `plm.item`.
-- * It does NOT touch any other `plm.*` table. The 20260621151155:436 loop covers twelve
--   of them; this ruling is about `plm.item` alone.
-- * It adds no columns, grants, indexes or types. `authenticated` already holds SELECT
--   on `plm.item` from 20260621151155_api_rls_realtime.sql:473 (`grant select on all
--   tables in schema plm to authenticated`); a grant without a matching policy is
--   exactly why the columns were blank.
--
-- CONTRACT TEST: supabase/tests/dam_order_list_item_columns_contract.sql
-- =====================================================================================

begin;

drop policy if exists item_popdam_read on plm.item;
create policy item_popdam_read
  on plm.item
  for select to authenticated
  using (true);

comment on policy item_popdam_read on plm.item is
  'Owner ruling 2026-08-10 (issue #653), Option A. Additive permissive SELECT policy so PopDAM staff -- who hold dam app access and the designer/viewer role, and therefore satisfy none of the arms of plm_read -- can read the item facts api.dam_order_list projects. ACCEPTED TRADE-OFF: the entire item catalogue is readable by every authenticated account, matching production_order_popdam_read / production_order_line_popdam_read (20260810010000:302-312). Additive only: plm_read and plm_admin_write are unchanged and writes are not widened. Never fix a blank-column report by removing security_invoker from api.dam_order_list instead of adjusting this policy.';

commit;
