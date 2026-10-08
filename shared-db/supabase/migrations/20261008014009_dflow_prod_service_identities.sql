-- Issue #2873. Version reserved by migration-author claim #4076.
-- derived-from: none
-- Least-privilege dflow_prod service identities for the DesignFlow production
-- cutover (popcre/designflow-backend#94): one NOLOGIN grant role and one LOGIN
-- runtime identity for each of backend, Item Master, Tracking and Data Sync.
--
-- The grant matrix below is the exact union of what each service's current
-- production (`main`) and cutover (`develop`) code reads and writes in
-- single-schema mode: Sequelize models and the operations the code performs on
-- them, raw SQL, the canonical functions each service calls, serial sequences of
-- tables it inserts into, and the tables written by the SECURITY INVOKER
-- functions and triggers those calls reach. Identity columns need no sequence
-- grant. The full evidence (file:line per object) is published on #2873.
--
-- Boundaries:
--   * Privileges sit only on the NOLOGIN grant roles. Each LOGIN role holds only
--     membership (INHERIT) in its own grant role and nothing else, and is
--     NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS with a
--     connection limit (Qwen 3.8 Max review conditions, #2873, 2026-09-23).
--   * No password is set here. Credentials are provisioned separately through
--     1Password and ALTER ROLE ... PASSWORD after canonical promotion; until
--     then the LOGIN roles cannot authenticate.
--   * Only USAGE on schema dflow_prod. No CREATE, TRUNCATE, REFERENCES, TRIGGER,
--     ownership, or any access to dflow, plm, public or hts_rag. Backend HTS
--     access stays on designflow_hts_prod_runtime / worker and is not touched.
--   * Owner decision 2026-09-23 (docs/security/pg-net-direct-login-rule.md):
--     these four are trusted in-house server services, the only permitted kind
--     of new direct login. Like every role they inherit Supabase's PUBLIC grant
--     on schema `net` (pg_net), which cannot be removed; that is accepted.
--   * No application rows change.
-- Depends on #2874, #2875 and #3737 (objects granted below).

begin;

do $pre$
declare v_missing text;
begin
  if exists (select 1 from pg_roles where rolname like 'designflow\_prod\_%\_grants' or rolname like 'designflow\_prod\_%\_runtime')
  then raise exception '#2873: a designflow_prod service role already exists'; end if;
  select string_agg(x, ', ') into v_missing from (values
    ('table','dflow_prod."AdditionalUserEmail"'),
    ('table','dflow_prod."AuditLog"'),
    ('table','dflow_prod."FOBCountry"'),
    ('table','dflow_prod."Factory"'),
    ('table','dflow_prod."GridAccessLevel"'),
    ('table','dflow_prod."GridChildrenLayout"'),
    ('table','dflow_prod."GridChildrenLayoutOrder"'),
    ('table','dflow_prod."GridLayout"'),
    ('table','dflow_prod."GridViewState"'),
    ('table','dflow_prod."RFQContainer"'),
    ('table','dflow_prod."RFQGroup"'),
    ('table','dflow_prod."RFQItem"'),
    ('table','dflow_prod."RFQItemStatus"'),
    ('table','dflow_prod."RFQStep"'),
    ('table','dflow_prod."RFQVendor"'),
    ('table','dflow_prod."RFQWhse"'),
    ('table','dflow_prod."RolePermissions"'),
    ('table','dflow_prod."Roles"'),
    ('table','dflow_prod."SeasonCode"'),
    ('table','dflow_prod."StandardizedDetail"'),
    ('table','dflow_prod."StandardizedGroup"'),
    ('table','dflow_prod."StandardizedProductElement"'),
    ('table','dflow_prod."StandardizedProductElementValue"'),
    ('table','dflow_prod."StandardizedProductType"'),
    ('table','dflow_prod."StandardizedSize"'),
    ('table','dflow_prod."StandardizedVendor"'),
    ('table','dflow_prod."StandardizedVersion"'),
    ('table','dflow_prod."UDFComponent"'),
    ('table','dflow_prod."UDFElement"'),
    ('table','dflow_prod."UDFElementType"'),
    ('table','dflow_prod."UDFGroup"'),
    ('table','dflow_prod."UDFTable"'),
    ('table','dflow_prod."UIElements"'),
    ('table','dflow_prod."age_group"'),
    ('table','dflow_prod."ai_cache_events"'),
    ('table','dflow_prod."app_settings"'),
    ('table','dflow_prod."art_types"'),
    ('table','dflow_prod."artist_types"'),
    ('table','dflow_prod."artists"'),
    ('table','dflow_prod."auth_token"'),
    ('table','dflow_prod."comments"'),
    ('table','dflow_prod."companyCode"'),
    ('table','dflow_prod."customers"'),
    ('table','dflow_prod."deliveryLocation"'),
    ('table','dflow_prod."divisionCode"'),
    ('table','dflow_prod."email_logs"'),
    ('table','dflow_prod."grid_cell_notes"'),
    ('table','dflow_prod."itemAttachment"'),
    ('table','dflow_prod."itemDepth"'),
    ('table','dflow_prod."itemHeader"'),
    ('table','dflow_prod."itemSize"'),
    ('table','dflow_prod."item_character_associations"'),
    ('table','dflow_prod."item_user_assignment"'),
    ('table','dflow_prod."item_workflow_action"'),
    ('table','dflow_prod."licenseList"'),
    ('table','dflow_prod."merchGroup"'),
    ('table','dflow_prod."merchGroupHeaders"'),
    ('table','dflow_prod."properties_and_characters"'),
    ('table','dflow_prod."property_character_associations"'),
    ('table','dflow_prod."quote_auth_token"'),
    ('table','dflow_prod."user_notification"'),
    ('table','dflow_prod."users"'),
    ('table','dflow_prod."vendor"'),
    ('table','dflow_prod."vendorGroup"'),
    ('view','dflow_prod."item_workflow_handoff"'),
    ('sequence','dflow_prod."AdditionalUserEmail_id_seq"'),
    ('sequence','dflow_prod."AuditLog_id_seq"'),
    ('sequence','dflow_prod."FOBCountry_FOBCountry_id_seq"'),
    ('sequence','dflow_prod."Factory_id_seq"'),
    ('sequence','dflow_prod."GridChildrenLayoutOrder_id_seq"'),
    ('sequence','dflow_prod."GridChildrenLayout_id_seq"'),
    ('sequence','dflow_prod."GridViewState_id_seq"'),
    ('sequence','dflow_prod."RFQContainer_RFQContainer_id_seq"'),
    ('sequence','dflow_prod."RFQCustomLayout_RFQCustomLayout_id_seq"'),
    ('sequence','dflow_prod."RFQGroup_RFQGroup_id_seq"'),
    ('sequence','dflow_prod."RFQItem_rfqItem_id_seq"'),
    ('sequence','dflow_prod."RFQLayout_id_seq"'),
    ('sequence','dflow_prod."RFQVendor_RFQVendor_id_seq"'),
    ('sequence','dflow_prod."RolePermissions_Id_seq"'),
    ('sequence','dflow_prod."StandardizedDetail_id_seq"'),
    ('sequence','dflow_prod."StandardizedGroup_id_seq"'),
    ('sequence','dflow_prod."StandardizedProductElement_id_seq"'),
    ('sequence','dflow_prod."StandardizedProductType_id_seq"'),
    ('sequence','dflow_prod."StandardizedSize_id_seq"'),
    ('sequence','dflow_prod."StandardizedVendor_id_seq"'),
    ('sequence','dflow_prod."StandardizedVersion_id_seq1"'),
    ('sequence','dflow_prod."UIElements_Id_seq"'),
    ('sequence','dflow_prod."deliveryLocation_deliveryLocation_id_seq"'),
    ('sequence','dflow_prod."itemDepth__id_seq"'),
    ('sequence','dflow_prod."itemPackage_item_package_id_seq"'),
    ('sequence','dflow_prod."itemSize_itemSize_id_seq"'),
    ('sequence','dflow_prod."licenseList_licenseList_id_seq"'),
    ('sequence','dflow_prod."signUpToken_id_seq"'),
    ('sequence','dflow_prod."vendorGroup_id_seq"'),
    ('sequence','dflow_prod."age_group_id_seq"'),
    ('sequence','dflow_prod."art_types_id_seq"'),
    ('sequence','dflow_prod."artist_types_id_seq"'),
    ('sequence','dflow_prod."artists_id_seq"'),
    ('sequence','dflow_prod."auth_token_id_seq"'),
    ('sequence','dflow_prod."comments_id_seq"'),
    ('sequence','dflow_prod."customers_customers_id_seq"'),
    ('sequence','dflow_prod."email_logs_id_seq"'),
    ('sequence','dflow_prod."user_notification_id_seq"'),
    ('sequence','dflow_prod."users_id_seq"'),
    ('sequence','dflow_prod."vendor_vendor_id_seq"'),
    ('function','dflow_prod.record_item_workflow_action'),
    ('function','dflow_prod.set_item_user_assignment'),
    ('table','dflow_prod."LicenseFeedBacks"'),
    ('table','dflow_prod."LicensingTime"'),
    ('table','dflow_prod."ProdOrderDetail"'),
    ('table','dflow_prod."art_piece"'),
    ('table','dflow_prod."art_piece_attachment"'),
    ('table','dflow_prod."groups"'),
    ('table','dflow_prod."itemType"'),
    ('table','dflow_prod."licensingFeedbackReply"'),
    ('table','dflow_prod."licensingStatus"'),
    ('table','dflow_prod."productUserAssignment"'),
    ('sequence','dflow_prod."itemHeader_item_num_id_pk _seq"'),
    ('sequence','dflow_prod."itemType_item_type_id_seq"'),
    ('sequence','dflow_prod."licensingFeedbackReply_id_seq"'),
    ('sequence','dflow_prod."licensingStatus_id_seq"'),
    ('sequence','dflow_prod."productUserAssignment_id_seq"'),
    ('sequence','dflow_prod."art_piece_attachment_id_seq"'),
    ('sequence','dflow_prod."art_piece_id_seq"'),
    ('table','dflow_prod."DesignTeamTime"'),
    ('table','dflow_prod."FactoryTime"'),
    ('table','dflow_prod."ProdOrderHeader"'),
    ('table','dflow_prod."externalCustomer"'),
    ('table','dflow_prod."externalVendor"'),
    ('table','dflow_prod."itemLicenseImage"'),
    ('table','dflow_prod."item_prod_order_detail_associations"'),
    ('table','dflow_prod."product_type_factory_time"'),
    ('table','dflow_prod."sample"'),
    ('table','dflow_prod."sample_approval_event"'),
    ('table','dflow_prod."sample_attachment"'),
    ('table','dflow_prod."sample_box"'),
    ('table','dflow_prod."sample_carrier"'),
    ('table','dflow_prod."sample_comments"'),
    ('table','dflow_prod."sample_creation_batch"'),
    ('table','dflow_prod."sample_event"'),
    ('table','dflow_prod."sample_factory_group"'),
    ('table','dflow_prod."sample_factory_visit"'),
    ('table','dflow_prod."sample_factory_visit_event"'),
    ('table','dflow_prod."sample_import_job"'),
    ('table','dflow_prod."sample_import_row"'),
    ('table','dflow_prod."sample_inventory_balance"'),
    ('table','dflow_prod."sample_movement"'),
    ('table','dflow_prod."sample_path_revision"'),
    ('table','dflow_prod."sample_piece_lineage"'),
    ('table','dflow_prod."sample_remote_request"'),
    ('table','dflow_prod."sample_remote_request_history"'),
    ('table','dflow_prod."sample_remote_request_item"'),
    ('table','dflow_prod."sample_reservation"'),
    ('table','dflow_prod."sample_shipment"'),
    ('table','dflow_prod."sample_shipment_item"'),
    ('table','dflow_prod."sample_shipment_line"'),
    ('table','dflow_prod."sample_shipment_notice"'),
    ('table','dflow_prod."sample_shipment_notice_recipient"'),
    ('table','dflow_prod."sample_stop_closeout"'),
    ('table','dflow_prod."sample_workflow"'),
    ('view','dflow_prod."sample_approval_current"'),
    ('view','dflow_prod."sample_balance_by_location"'),
    ('view','dflow_prod."sample_global_status"'),
    ('view','dflow_prod."sample_in_transit"'),
    ('view','dflow_prod."sample_open_stop_work"'),
    ('view','dflow_prod."sample_receipt_discrepancy"'),
    ('view','dflow_prod."sample_visit_plan"'),
    ('sequence','dflow_prod."FactoryTime_id_seq"'),
    ('sequence','dflow_prod."groups_id_seq"'),
    ('sequence','dflow_prod."sample_attachment_sample_attachment_id_seq"'),
    ('sequence','dflow_prod."sample_box_box_id_pk_seq"'),
    ('sequence','dflow_prod."sample_comments_id_seq"'),
    ('sequence','dflow_prod."sample_event_event_id_pk_seq"'),
    ('sequence','dflow_prod."sample_factory_group_factory_group_id_pk_seq"'),
    ('sequence','dflow_prod."sample_sample_id_pk_seq"'),
    ('sequence','dflow_prod."sample_shipment_item_shipment_item_id_pk_seq"'),
    ('function','dflow_prod.claim_sample_shipment_notice'),
    ('function','dflow_prod.pack_sample_reservation'),
    ('function','dflow_prod.post_sample_approval_event'),
    ('function','dflow_prod.post_sample_movement'),
    ('function','dflow_prod.post_sample_piece_split'),
    ('function','dflow_prod.post_sample_remote_request_event'),
    ('function','dflow_prod.reserve_sample_remote_request_item'),
    ('table','dflow_prod."externalApi"'),
    ('table','dflow_prod."itemDetail"'),
    ('sequence','dflow_prod."ProdOrderDetail_id_seq"'),
    ('sequence','dflow_prod."ProdOrderHeader_id_seq"'),
    ('sequence','dflow_prod."externalCustomer_id_seq"'),
    ('sequence','dflow_prod."externalVendor_id_seq"'),
    ('sequence','dflow_prod."itemDetail_item_pk_seq"'),
    ('sequence','dflow_prod."item_prod_order_detail_associations_id_seq"')
  ) v(kind, name) cross join lateral (select v.kind||' '||v.name as x) z
  where case v.kind
    -- Exact objects: one function per name (no overloads), and the right relation kind.
    when 'function' then (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dflow_prod' and p.proname=split_part(v.name,'.',2)) <> 1
    when 'sequence' then not exists (select 1 from pg_class c where c.oid=to_regclass(v.name) and c.relkind='S')
    when 'view' then not exists (select 1 from pg_class c where c.oid=to_regclass(v.name) and c.relkind='v')
    else not exists (select 1 from pg_class c where c.oid=to_regclass(v.name) and c.relkind in ('r','p')) end;
  if v_missing is not null then raise exception '#2873: dflow_prod objects missing, overloaded or of the wrong kind: %', v_missing; end if;
end $pre$;

create role designflow_prod_backend_grants nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role designflow_prod_backend_runtime login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 20;
grant designflow_prod_backend_grants to designflow_prod_backend_runtime with inherit true, set false, admin false;
comment on role designflow_prod_backend_grants is 'NOLOGIN least-privilege dflow_prod grants for DesignFlow designflow-backend (#2873).';
comment on role designflow_prod_backend_runtime is 'LOGIN runtime identity for DesignFlow designflow-backend on dflow_prod; holds only designflow_prod_backend_grants. Trusted in-house server service; can reach pg_net via PUBLIC (owner decision 2026-09-23). Password set outside this repository (#2873).';

create role designflow_prod_item_master_grants nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role designflow_prod_item_master_runtime login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 10;
grant designflow_prod_item_master_grants to designflow_prod_item_master_runtime with inherit true, set false, admin false;
comment on role designflow_prod_item_master_grants is 'NOLOGIN least-privilege dflow_prod grants for DesignFlow designflow-item-master (#2873).';
comment on role designflow_prod_item_master_runtime is 'LOGIN runtime identity for DesignFlow designflow-item-master on dflow_prod; holds only designflow_prod_item_master_grants. Trusted in-house server service; can reach pg_net via PUBLIC (owner decision 2026-09-23). Password set outside this repository (#2873).';

create role designflow_prod_tracking_grants nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role designflow_prod_tracking_runtime login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 10;
grant designflow_prod_tracking_grants to designflow_prod_tracking_runtime with inherit true, set false, admin false;
comment on role designflow_prod_tracking_grants is 'NOLOGIN least-privilege dflow_prod grants for DesignFlow designflow-tracking (#2873).';
comment on role designflow_prod_tracking_runtime is 'LOGIN runtime identity for DesignFlow designflow-tracking on dflow_prod; holds only designflow_prod_tracking_grants. Trusted in-house server service; can reach pg_net via PUBLIC (owner decision 2026-09-23). Password set outside this repository (#2873).';

create role designflow_prod_data_sync_grants nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role designflow_prod_data_sync_runtime login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 10;
grant designflow_prod_data_sync_grants to designflow_prod_data_sync_runtime with inherit true, set false, admin false;
comment on role designflow_prod_data_sync_grants is 'NOLOGIN least-privilege dflow_prod grants for DesignFlow designflow-data-syncing (#2873).';
comment on role designflow_prod_data_sync_runtime is 'LOGIN runtime identity for DesignFlow designflow-data-syncing on dflow_prod; holds only designflow_prod_data_sync_grants. Trusted in-house server service; can reach pg_net via PUBLIC (owner decision 2026-09-23). Password set outside this repository (#2873).';

grant usage on schema dflow_prod to designflow_prod_backend_grants, designflow_prod_item_master_grants, designflow_prod_tracking_grants, designflow_prod_data_sync_grants;

-- designflow-backend
grant select, insert on table dflow_prod."AdditionalUserEmail" to designflow_prod_backend_grants;
grant select, insert on table dflow_prod."AuditLog" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."FOBCountry" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."Factory" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."GridAccessLevel" to designflow_prod_backend_grants;
grant select, insert on table dflow_prod."GridChildrenLayout" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."GridChildrenLayoutOrder" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."GridLayout" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."GridViewState" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."RFQContainer" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."RFQGroup" to designflow_prod_backend_grants;
grant select, insert, update, delete on table dflow_prod."RFQItem" to designflow_prod_backend_grants;
grant select on table dflow_prod."RFQItemStatus" to designflow_prod_backend_grants;
grant select, update on table dflow_prod."RFQStep" to designflow_prod_backend_grants;
grant select, insert, update, delete on table dflow_prod."RFQVendor" to designflow_prod_backend_grants;
grant select, update on table dflow_prod."RFQWhse" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."RolePermissions" to designflow_prod_backend_grants;
grant select on table dflow_prod."Roles" to designflow_prod_backend_grants;
grant select on table dflow_prod."SeasonCode" to designflow_prod_backend_grants;
grant select, insert on table dflow_prod."StandardizedDetail" to designflow_prod_backend_grants;
grant select, insert on table dflow_prod."StandardizedGroup" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."StandardizedProductElement" to designflow_prod_backend_grants;
grant select on table dflow_prod."StandardizedProductElementValue" to designflow_prod_backend_grants;
grant select, insert on table dflow_prod."StandardizedProductType" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."StandardizedSize" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."StandardizedVendor" to designflow_prod_backend_grants;
grant select, insert on table dflow_prod."StandardizedVersion" to designflow_prod_backend_grants;
grant select on table dflow_prod."UDFComponent" to designflow_prod_backend_grants;
grant select on table dflow_prod."UDFElement" to designflow_prod_backend_grants;
grant select on table dflow_prod."UDFElementType" to designflow_prod_backend_grants;
grant select on table dflow_prod."UDFGroup" to designflow_prod_backend_grants;
grant select on table dflow_prod."UDFTable" to designflow_prod_backend_grants;
grant select, insert on table dflow_prod."UIElements" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."age_group" to designflow_prod_backend_grants;
grant select, insert on table dflow_prod."ai_cache_events" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."app_settings" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."art_types" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."artist_types" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."artists" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."auth_token" to designflow_prod_backend_grants;
grant select, insert, update, delete on table dflow_prod."comments" to designflow_prod_backend_grants;
grant select on table dflow_prod."companyCode" to designflow_prod_backend_grants;
grant select, insert, update, delete on table dflow_prod."customers" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."deliveryLocation" to designflow_prod_backend_grants;
grant select on table dflow_prod."divisionCode" to designflow_prod_backend_grants;
grant insert on table dflow_prod."email_logs" to designflow_prod_backend_grants;
grant select, insert, update, delete on table dflow_prod."grid_cell_notes" to designflow_prod_backend_grants;
grant select, insert, update, delete on table dflow_prod."itemAttachment" to designflow_prod_backend_grants;
grant select, insert, update, delete on table dflow_prod."itemDepth" to designflow_prod_backend_grants;
grant select, update on table dflow_prod."itemHeader" to designflow_prod_backend_grants;
grant select, insert, update, delete on table dflow_prod."itemSize" to designflow_prod_backend_grants;
grant select on table dflow_prod."item_character_associations" to designflow_prod_backend_grants;
grant select on table dflow_prod."item_user_assignment" to designflow_prod_backend_grants;
grant select on table dflow_prod."item_workflow_action" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."licenseList" to designflow_prod_backend_grants;
grant select, update on table dflow_prod."merchGroup" to designflow_prod_backend_grants;
grant select on table dflow_prod."merchGroupHeaders" to designflow_prod_backend_grants;
grant select on table dflow_prod."properties_and_characters" to designflow_prod_backend_grants;
grant select on table dflow_prod."property_character_associations" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."quote_auth_token" to designflow_prod_backend_grants;
grant select, insert, update, delete on table dflow_prod."user_notification" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."users" to designflow_prod_backend_grants;
grant select, insert, update on table dflow_prod."vendor" to designflow_prod_backend_grants;
grant select, insert, update, delete on table dflow_prod."vendorGroup" to designflow_prod_backend_grants;
grant select on table dflow_prod."item_workflow_handoff" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."AdditionalUserEmail_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."AuditLog_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."FOBCountry_FOBCountry_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."Factory_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."GridChildrenLayoutOrder_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."GridChildrenLayout_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."GridViewState_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."RFQContainer_RFQContainer_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."RFQCustomLayout_RFQCustomLayout_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."RFQGroup_RFQGroup_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."RFQItem_rfqItem_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."RFQLayout_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."RFQVendor_RFQVendor_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."RolePermissions_Id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."StandardizedDetail_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."StandardizedGroup_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."StandardizedProductElement_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."StandardizedProductType_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."StandardizedSize_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."StandardizedVendor_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."StandardizedVersion_id_seq1" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."UIElements_Id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."deliveryLocation_deliveryLocation_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."itemDepth__id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."itemPackage_item_package_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."itemSize_itemSize_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."licenseList_licenseList_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."signUpToken_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."vendorGroup_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."age_group_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."art_types_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."artist_types_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."artists_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."auth_token_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."comments_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."customers_customers_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."email_logs_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."user_notification_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."users_id_seq" to designflow_prod_backend_grants;
grant usage on sequence dflow_prod."vendor_vendor_id_seq" to designflow_prod_backend_grants;
grant execute on function dflow_prod.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb) to designflow_prod_backend_grants;
grant execute on function dflow_prod.set_item_user_assignment(integer,text,integer,boolean,jsonb) to designflow_prod_backend_grants;

-- designflow-item-master
grant insert on table dflow_prod."AuditLog" to designflow_prod_item_master_grants;
grant select on table dflow_prod."GridAccessLevel" to designflow_prod_item_master_grants;
grant select on table dflow_prod."GridLayout" to designflow_prod_item_master_grants;
grant select on table dflow_prod."LicenseFeedBacks" to designflow_prod_item_master_grants;
grant select on table dflow_prod."LicensingTime" to designflow_prod_item_master_grants;
grant select on table dflow_prod."ProdOrderDetail" to designflow_prod_item_master_grants;
grant select on table dflow_prod."RFQItem" to designflow_prod_item_master_grants;
grant select on table dflow_prod."SeasonCode" to designflow_prod_item_master_grants;
grant select, insert, delete on table dflow_prod."art_piece" to designflow_prod_item_master_grants;
grant select, insert, delete on table dflow_prod."art_piece_attachment" to designflow_prod_item_master_grants;
grant select on table dflow_prod."customers" to designflow_prod_item_master_grants;
grant select on table dflow_prod."divisionCode" to designflow_prod_item_master_grants;
grant select, insert, update, delete on table dflow_prod."grid_cell_notes" to designflow_prod_item_master_grants;
grant select on table dflow_prod."groups" to designflow_prod_item_master_grants;
grant select, insert, update on table dflow_prod."itemAttachment" to designflow_prod_item_master_grants;
grant select, insert on table dflow_prod."itemHeader" to designflow_prod_item_master_grants;
grant select, insert on table dflow_prod."itemType" to designflow_prod_item_master_grants;
grant select, insert, update, delete on table dflow_prod."licensingFeedbackReply" to designflow_prod_item_master_grants;
grant select, insert, update, delete on table dflow_prod."licensingStatus" to designflow_prod_item_master_grants;
grant select on table dflow_prod."merchGroup" to designflow_prod_item_master_grants;
grant select, insert, update, delete on table dflow_prod."productUserAssignment" to designflow_prod_item_master_grants;
grant select on table dflow_prod."users" to designflow_prod_item_master_grants;
grant usage on sequence dflow_prod."AuditLog_id_seq" to designflow_prod_item_master_grants;
grant usage on sequence dflow_prod."itemHeader_item_num_id_pk _seq" to designflow_prod_item_master_grants;
grant usage on sequence dflow_prod."itemPackage_item_package_id_seq" to designflow_prod_item_master_grants;
grant usage on sequence dflow_prod."itemType_item_type_id_seq" to designflow_prod_item_master_grants;
grant usage on sequence dflow_prod."licensingFeedbackReply_id_seq" to designflow_prod_item_master_grants;
grant usage on sequence dflow_prod."licensingStatus_id_seq" to designflow_prod_item_master_grants;
grant usage on sequence dflow_prod."productUserAssignment_id_seq" to designflow_prod_item_master_grants;
grant usage on sequence dflow_prod."art_piece_attachment_id_seq" to designflow_prod_item_master_grants;
grant usage on sequence dflow_prod."art_piece_id_seq" to designflow_prod_item_master_grants;

-- designflow-tracking
grant select, update on table dflow_prod."DesignTeamTime" to designflow_prod_tracking_grants;
grant select on table dflow_prod."Factory" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."FactoryTime" to designflow_prod_tracking_grants;
grant select on table dflow_prod."GridAccessLevel" to designflow_prod_tracking_grants;
grant select on table dflow_prod."GridLayout" to designflow_prod_tracking_grants;
grant select on table dflow_prod."LicenseFeedBacks" to designflow_prod_tracking_grants;
grant select, update on table dflow_prod."LicensingTime" to designflow_prod_tracking_grants;
grant select on table dflow_prod."ProdOrderDetail" to designflow_prod_tracking_grants;
grant select, update on table dflow_prod."ProdOrderHeader" to designflow_prod_tracking_grants;
grant select on table dflow_prod."RolePermissions" to designflow_prod_tracking_grants;
grant select on table dflow_prod."UDFTable" to designflow_prod_tracking_grants;
grant select on table dflow_prod."UIElements" to designflow_prod_tracking_grants;
grant select on table dflow_prod."comments" to designflow_prod_tracking_grants;
grant select on table dflow_prod."customers" to designflow_prod_tracking_grants;
grant select on table dflow_prod."deliveryLocation" to designflow_prod_tracking_grants;
grant select, insert on table dflow_prod."email_logs" to designflow_prod_tracking_grants;
grant select on table dflow_prod."externalCustomer" to designflow_prod_tracking_grants;
grant select on table dflow_prod."externalVendor" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."grid_cell_notes" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."groups" to designflow_prod_tracking_grants;
grant select, insert on table dflow_prod."itemAttachment" to designflow_prod_tracking_grants;
grant select, update on table dflow_prod."itemHeader" to designflow_prod_tracking_grants;
grant select on table dflow_prod."itemLicenseImage" to designflow_prod_tracking_grants;
grant select on table dflow_prod."item_prod_order_detail_associations" to designflow_prod_tracking_grants;
grant select on table dflow_prod."licensingStatus" to designflow_prod_tracking_grants;
grant select on table dflow_prod."merchGroup" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."product_type_factory_time" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."sample" to designflow_prod_tracking_grants;
grant select, insert, delete on table dflow_prod."sample_approval_event" to designflow_prod_tracking_grants;
grant select, insert, delete on table dflow_prod."sample_attachment" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."sample_box" to designflow_prod_tracking_grants;
grant select on table dflow_prod."sample_carrier" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."sample_comments" to designflow_prod_tracking_grants;
grant select, insert, delete on table dflow_prod."sample_creation_batch" to designflow_prod_tracking_grants;
grant select, insert, delete on table dflow_prod."sample_event" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."sample_factory_group" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."sample_factory_visit" to designflow_prod_tracking_grants;
grant select, insert, delete on table dflow_prod."sample_factory_visit_event" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."sample_import_job" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."sample_import_row" to designflow_prod_tracking_grants;
grant select, insert, update on table dflow_prod."sample_inventory_balance" to designflow_prod_tracking_grants;
grant select, insert on table dflow_prod."sample_movement" to designflow_prod_tracking_grants;
grant select, insert, delete on table dflow_prod."sample_path_revision" to designflow_prod_tracking_grants;
grant select, insert, delete on table dflow_prod."sample_piece_lineage" to designflow_prod_tracking_grants;
grant select, insert, delete on table dflow_prod."sample_remote_request" to designflow_prod_tracking_grants;
grant select, delete on table dflow_prod."sample_remote_request_history" to designflow_prod_tracking_grants;
grant select, insert, delete on table dflow_prod."sample_remote_request_item" to designflow_prod_tracking_grants;
grant select, delete on table dflow_prod."sample_reservation" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."sample_shipment" to designflow_prod_tracking_grants;
grant select, insert, delete on table dflow_prod."sample_shipment_item" to designflow_prod_tracking_grants;
grant select, insert, update on table dflow_prod."sample_shipment_line" to designflow_prod_tracking_grants;
grant select, insert, update on table dflow_prod."sample_shipment_notice" to designflow_prod_tracking_grants;
grant insert on table dflow_prod."sample_shipment_notice_recipient" to designflow_prod_tracking_grants;
grant select, insert, update on table dflow_prod."sample_stop_closeout" to designflow_prod_tracking_grants;
grant select, insert, update, delete on table dflow_prod."sample_workflow" to designflow_prod_tracking_grants;
grant select on table dflow_prod."users" to designflow_prod_tracking_grants;
grant select on table dflow_prod."sample_approval_current" to designflow_prod_tracking_grants;
grant select on table dflow_prod."sample_balance_by_location" to designflow_prod_tracking_grants;
grant select on table dflow_prod."sample_global_status" to designflow_prod_tracking_grants;
grant select on table dflow_prod."sample_in_transit" to designflow_prod_tracking_grants;
grant select on table dflow_prod."sample_open_stop_work" to designflow_prod_tracking_grants;
grant select on table dflow_prod."sample_receipt_discrepancy" to designflow_prod_tracking_grants;
grant select on table dflow_prod."sample_visit_plan" to designflow_prod_tracking_grants;
grant usage on sequence dflow_prod."FactoryTime_id_seq" to designflow_prod_tracking_grants;
grant usage on sequence dflow_prod."itemPackage_item_package_id_seq" to designflow_prod_tracking_grants;
grant usage on sequence dflow_prod."email_logs_id_seq" to designflow_prod_tracking_grants;
grant usage on sequence dflow_prod."groups_id_seq" to designflow_prod_tracking_grants;
grant usage on sequence dflow_prod."sample_attachment_sample_attachment_id_seq" to designflow_prod_tracking_grants;
grant usage on sequence dflow_prod."sample_box_box_id_pk_seq" to designflow_prod_tracking_grants;
grant usage on sequence dflow_prod."sample_comments_id_seq" to designflow_prod_tracking_grants;
grant usage on sequence dflow_prod."sample_event_event_id_pk_seq" to designflow_prod_tracking_grants;
grant usage on sequence dflow_prod."sample_factory_group_factory_group_id_pk_seq" to designflow_prod_tracking_grants;
grant usage on sequence dflow_prod."sample_sample_id_pk_seq" to designflow_prod_tracking_grants;
grant usage on sequence dflow_prod."sample_shipment_item_shipment_item_id_pk_seq" to designflow_prod_tracking_grants;
grant execute on function dflow_prod.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text) to designflow_prod_tracking_grants;
grant execute on function dflow_prod.post_sample_approval_event(integer,text,text,boolean,text,text,text,text,integer,text,text,text) to designflow_prod_tracking_grants;
grant execute on function dflow_prod.post_sample_movement(integer,integer,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,bigint,text,text) to designflow_prod_tracking_grants;
grant execute on function dflow_prod.post_sample_piece_split(integer,jsonb,text,text,text,text,text,text,text) to designflow_prod_tracking_grants;
grant execute on function dflow_prod.post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb) to designflow_prod_tracking_grants;
grant execute on function dflow_prod.reserve_sample_remote_request_item(uuid,text,text,text,text) to designflow_prod_tracking_grants;
grant execute on function dflow_prod.claim_sample_shipment_notice(bigint) to designflow_prod_tracking_grants;

-- designflow-data-syncing
grant select, insert on table dflow_prod."ProdOrderDetail" to designflow_prod_data_sync_grants;
grant select, insert, update on table dflow_prod."ProdOrderHeader" to designflow_prod_data_sync_grants;
grant select on table dflow_prod."UDFTable" to designflow_prod_data_sync_grants;
grant select on table dflow_prod."externalApi" to designflow_prod_data_sync_grants;
grant insert on table dflow_prod."externalCustomer" to designflow_prod_data_sync_grants;
grant insert on table dflow_prod."externalVendor" to designflow_prod_data_sync_grants;
grant select on table dflow_prod."itemAttachment" to designflow_prod_data_sync_grants;
grant insert on table dflow_prod."itemDetail" to designflow_prod_data_sync_grants;
grant select on table dflow_prod."itemHeader" to designflow_prod_data_sync_grants;
grant select, insert, update on table dflow_prod."item_prod_order_detail_associations" to designflow_prod_data_sync_grants;
grant select on table dflow_prod."merchGroup" to designflow_prod_data_sync_grants;
grant select on table dflow_prod."merchGroupHeaders" to designflow_prod_data_sync_grants;
grant usage on sequence dflow_prod."ProdOrderDetail_id_seq" to designflow_prod_data_sync_grants;
grant usage on sequence dflow_prod."ProdOrderHeader_id_seq" to designflow_prod_data_sync_grants;
grant usage on sequence dflow_prod."externalCustomer_id_seq" to designflow_prod_data_sync_grants;
grant usage on sequence dflow_prod."externalVendor_id_seq" to designflow_prod_data_sync_grants;
grant usage on sequence dflow_prod."itemDetail_item_pk_seq" to designflow_prod_data_sync_grants;
grant usage on sequence dflow_prod."item_prod_order_detail_associations_id_seq" to designflow_prod_data_sync_grants;

do $post$
declare v_role text;
begin
  foreach v_role in array array['designflow_prod_backend_runtime','designflow_prod_item_master_runtime','designflow_prod_tracking_runtime','designflow_prod_data_sync_runtime'] loop
    if exists (select 1 from pg_roles where rolname=v_role and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or not rolcanlogin or rolconnlimit < 1))
    then raise exception '#2873 VERIFY FAILED: % attributes', v_role; end if;
    if (select count(*) from pg_auth_members m where m.member=(select oid from pg_roles where rolname=v_role)) <> 1
    then raise exception '#2873 VERIFY FAILED: % must hold exactly one membership', v_role; end if;
    if has_schema_privilege(v_role,'dflow_prod','CREATE') or has_schema_privilege(v_role,'dflow','USAGE')
       or has_schema_privilege(v_role,'hts_rag','USAGE') or (to_regnamespace('plm') is not null and has_schema_privilege(v_role,'plm','USAGE'))
    then raise exception '#2873 VERIFY FAILED: % has a forbidden schema privilege', v_role; end if;
  end loop;
  if exists (select 1 from information_schema.role_table_grants g
             where g.grantee like 'designflow\_prod\_%' and (g.table_schema <> 'dflow_prod' or g.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')))
  then raise exception '#2873 VERIFY FAILED: forbidden table privilege granted'; end if;
end $post$;

commit;
