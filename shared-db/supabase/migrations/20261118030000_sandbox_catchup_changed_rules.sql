-- Sandbox catch-up batch 12 (#6356): DesignFlow sandbox (xupnyeifmpsacrqahwwm) ONLY. Never apply to shared preview or production.
-- Brings rules that exist on both sides but differ into line with production. Sandbox pre-check 2026-11-16:
-- plm.dcp_opa_property_resolution(_member) 0 rows, coldlion.intake_window_state 0 rows, so every reshaped rule holds.
-- Foreign keys that differ only because production points at dflow_prod.* and the sandbox at its own dflow.* are
-- the same object (the drift check now maps one to the other). Six core.* user FKs that point at app.users on the
-- sandbox but dflow_prod.users in production are left for a later batch (they change which user table is trusted).
-- Not here: core.packaging_type policies (production's text names a person by email; a public repository cannot
-- carry it). Tracked on #6356.
-- derived-from: none

alter table plm.dcp_opa_property_resolution_member drop constraint dcp_opa_property_resolution_member_pkey;
alter table plm.dcp_opa_property_resolution_member alter column licensed_property_id drop not null;
alter table plm.dcp_opa_property_resolution_member alter column submission_source_system set not null;
alter table plm.dcp_opa_property_resolution_member alter column submission_source_table set not null;
alter table plm.dcp_opa_property_resolution_member alter column submission_source_id set not null;
alter table plm.dcp_opa_property_resolution_member add constraint dcp_opa_property_resolution_member_pkey
  primary key (resolution_id, submission_source_system, submission_source_table, submission_source_id);

alter table plm.dcp_opa_property_resolution drop constraint dcp_opa_property_resolution_identity_ck;
alter table plm.dcp_opa_property_resolution add constraint dcp_opa_property_resolution_identity_ck
  CHECK (((btrim(source_system) <> ''::text) AND (btrim(source_property_id) <> ''::text) AND (source_table ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'::text)));

alter table coldlion.intake_window_state drop constraint coldlion_intake_window_state_track_domain;
alter table coldlion.intake_window_state add constraint coldlion_intake_window_state_track_domain
  CHECK ((track = ANY (ARRAY['trailing'::text, 'forward'::text, 'created'::text, 'modified'::text])));

alter table plm.licensing_write_authorization drop constraint licensing_write_authorization_write_kind_check;
alter table plm.licensing_write_authorization add constraint licensing_write_authorization_write_kind_check
  CHECK ((write_kind = ANY (ARRAY['scrape_consolidation'::text, 'licensing_review_create'::text, 'coldlion_status'::text, 'canonical_merge'::text, 'owner_ruling_fr_inactivation'::text, 'owner_ruling_fr_removal'::text, 'owner_ruling_fk_removal'::text, 'owner_ruling_wb_property_reparent'::text])));

-- Production's key is plain UNIQUE (NULL codes may repeat); the sandbox's NULLS NOT DISTINCT is stricter.
alter table core.property drop constraint property_licensor_id_code_key;
alter table core.property add constraint property_licensor_id_code_key unique (licensor_id, code);

alter table plm."productUserAssignment" alter column created_date drop default;
alter table plm."productUserAssignment" alter column updated_date drop default;
alter table plm."productUserAssignment" drop constraint "productUserAssignment_item_id_fk_fkey";
alter table plm."productUserAssignment" add constraint "productUserAssignment_item_id_fk_fkey"
  FOREIGN KEY (item_id_fk) REFERENCES plm."itemHeader"(item_id_pk) ON UPDATE CASCADE ON DELETE CASCADE;

alter table plm."productUserAssignment" drop constraint "productUserAssignment_user_id_fk_fkey";
alter table plm."productUserAssignment" add constraint "productUserAssignment_user_id_fk_fkey"
  FOREIGN KEY (user_id_fk) REFERENCES dflow.users(id) ON UPDATE CASCADE;

drop index if exists app.user_notification_unread_user_created_idx;
create index user_notification_unread_user_created_idx ON app.user_notification USING btree (user_id_fk, created_at DESC, id DESC) WHERE (unread = true);

drop policy dcp_opa_property_resolution_member_read on plm.dcp_opa_property_resolution_member;
create policy dcp_opa_property_resolution_member_read on plm.dcp_opa_property_resolution_member as PERMISSIVE for SELECT to authenticated using (((EXISTS ( SELECT 1
   FROM plm.dcp_opa_property_resolution h
  WHERE ((h.resolution_id = dcp_opa_property_resolution_member.resolution_id) AND (h.creative_decision_state IS NULL)))) AND (app.has_role('administrator'::app.app_role) OR app.has_app_access('plm'::app.app_name) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role]))));
drop policy dcp_opa_property_resolution_read on plm.dcp_opa_property_resolution;
create policy dcp_opa_property_resolution_read on plm.dcp_opa_property_resolution as PERMISSIVE for SELECT to authenticated using (((creative_decision_state IS NULL) AND (app.has_role('administrator'::app.app_role) OR app.has_app_access('plm'::app.app_name) OR app.has_any_role(ARRAY['sales'::app.app_role, 'licensing'::app.app_role]))));
