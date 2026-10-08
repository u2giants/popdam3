-- Issue #2873. Version reserved by migration-author claim #4076 (reissued from
-- merged-stranded 20261008014009 through immutable retirement d4076b1c).
-- derived-from: none
-- Re-runnable forward replacement of 20261008014009, which preview applied but
-- which can never clear production risk sign-off. On a database that already
-- holds the identities (preview) it verifies them exactly and re-grants
-- idempotently; on one that does not (production) it creates them.
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
--   * Only USAGE on schema dflow_prod is granted. No CREATE, TRUNCATE, REFERENCES,
--     TRIGGER, grant option, ownership, or any grant on dflow, plm, hts_rag or
--     public. Schema public keeps only the PUBLIC defaults every role inherits
--     (USAGE, no CREATE); the post-check proves that exactly. Backend HTS
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
  -- Re-runnable: any pre-existing designflow_prod service role must be one of the
  -- eight exact names; an unknown one refuses. Exact attributes are proven below.
  if exists (select 1 from pg_roles where (rolname like 'designflow\_prod\_%\_grants' or rolname like 'designflow\_prod\_%\_runtime')
             and rolname not in (select s||'_'||k from unnest(array['designflow_prod_backend','designflow_prod_item_master','designflow_prod_tracking','designflow_prod_data_sync']) s, unnest(array['grants','runtime']) k))
  then raise exception '#2873: an unexpected designflow_prod service role exists'; end if;
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
    -- Exact signature the GRANT uses, and no overload of that name.
    when 'function' then (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dflow_prod' and p.proname=split_part(v.name,'.',2)) <> 1
      or to_regprocedure((array['dflow_prod.record_item_workflow_action(integer,integer,text,uuid,text,text,boolean,text,text,text,jsonb)','dflow_prod.set_item_user_assignment(integer,text,integer,boolean,jsonb)','dflow_prod.pack_sample_reservation(uuid,integer,bigint,text,text,text,text,text,text,text,text)','dflow_prod.post_sample_approval_event(integer,text,text,boolean,text,text,text,text,integer,text,text,text)','dflow_prod.post_sample_movement(integer,integer,text,text,text,text,text,text,text,text,text,integer,bigint,integer,text,text,bigint,text,text)','dflow_prod.post_sample_piece_split(integer,jsonb,text,text,text,text,text,text,text)','dflow_prod.post_sample_remote_request_event(uuid,text,text,text,text,text,text,jsonb)','dflow_prod.reserve_sample_remote_request_item(uuid,text,text,text,text)','dflow_prod.claim_sample_shipment_notice(bigint)'])[array_position(array['dflow_prod.record_item_workflow_action','dflow_prod.set_item_user_assignment','dflow_prod.pack_sample_reservation','dflow_prod.post_sample_approval_event','dflow_prod.post_sample_movement','dflow_prod.post_sample_piece_split','dflow_prod.post_sample_remote_request_event','dflow_prod.reserve_sample_remote_request_item','dflow_prod.claim_sample_shipment_notice'], v.name)]) is null
    when 'sequence' then not exists (select 1 from pg_class c where c.oid=to_regclass(v.name) and c.relkind='S')
    when 'view' then not exists (select 1 from pg_class c where c.oid=to_regclass(v.name) and c.relkind='v')
    else not exists (select 1 from pg_class c where c.oid=to_regclass(v.name) and c.relkind in ('r','p')) end;
  if v_missing is not null then raise exception '#2873: dflow_prod objects missing, overloaded or of the wrong kind: %', v_missing; end if;
end $pre$;

do $r_backend$
begin
  if to_regrole('designflow_prod_backend_grants') is null then
    create role designflow_prod_backend_grants nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if to_regrole('designflow_prod_backend_runtime') is null then
    create role designflow_prod_backend_runtime login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 20;
  end if;
end $r_backend$;
grant designflow_prod_backend_grants to designflow_prod_backend_runtime with inherit true, set false, admin false;
comment on role designflow_prod_backend_grants is 'NOLOGIN least-privilege dflow_prod grants for DesignFlow designflow-backend (#2873).';
comment on role designflow_prod_backend_runtime is 'LOGIN runtime identity for DesignFlow designflow-backend on dflow_prod; holds only designflow_prod_backend_grants. Trusted in-house server service; can reach pg_net via PUBLIC (owner decision 2026-09-23). Password set outside this repository (#2873).';

do $r_item_master$
begin
  if to_regrole('designflow_prod_item_master_grants') is null then
    create role designflow_prod_item_master_grants nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if to_regrole('designflow_prod_item_master_runtime') is null then
    create role designflow_prod_item_master_runtime login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 10;
  end if;
end $r_item_master$;
grant designflow_prod_item_master_grants to designflow_prod_item_master_runtime with inherit true, set false, admin false;
comment on role designflow_prod_item_master_grants is 'NOLOGIN least-privilege dflow_prod grants for DesignFlow designflow-item-master (#2873).';
comment on role designflow_prod_item_master_runtime is 'LOGIN runtime identity for DesignFlow designflow-item-master on dflow_prod; holds only designflow_prod_item_master_grants. Trusted in-house server service; can reach pg_net via PUBLIC (owner decision 2026-09-23). Password set outside this repository (#2873).';

do $r_tracking$
begin
  if to_regrole('designflow_prod_tracking_grants') is null then
    create role designflow_prod_tracking_grants nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if to_regrole('designflow_prod_tracking_runtime') is null then
    create role designflow_prod_tracking_runtime login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 10;
  end if;
end $r_tracking$;
grant designflow_prod_tracking_grants to designflow_prod_tracking_runtime with inherit true, set false, admin false;
comment on role designflow_prod_tracking_grants is 'NOLOGIN least-privilege dflow_prod grants for DesignFlow designflow-tracking (#2873).';
comment on role designflow_prod_tracking_runtime is 'LOGIN runtime identity for DesignFlow designflow-tracking on dflow_prod; holds only designflow_prod_tracking_grants. Trusted in-house server service; can reach pg_net via PUBLIC (owner decision 2026-09-23). Password set outside this repository (#2873).';

do $r_data_sync$
begin
  if to_regrole('designflow_prod_data_sync_grants') is null then
    create role designflow_prod_data_sync_grants nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if to_regrole('designflow_prod_data_sync_runtime') is null then
    create role designflow_prod_data_sync_runtime login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 10;
  end if;
end $r_data_sync$;
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

create temporary table t2873_expected(grantee text, kind text, name text, priv text) on commit drop;
insert into t2873_expected values
  ('designflow_prod_backend_grants','table','dflow_prod.AdditionalUserEmail','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.AdditionalUserEmail','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.AuditLog','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.AuditLog','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.FOBCountry','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.FOBCountry','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.FOBCountry','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.Factory','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.Factory','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.Factory','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridAccessLevel','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridAccessLevel','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridAccessLevel','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridChildrenLayout','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridChildrenLayout','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridChildrenLayoutOrder','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridChildrenLayoutOrder','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridChildrenLayoutOrder','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridLayout','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridLayout','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridLayout','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridViewState','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridViewState','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.GridViewState','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQContainer','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQContainer','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQContainer','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQGroup','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQGroup','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQGroup','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQItem','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQItem','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQItem','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQItem','DELETE'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQItemStatus','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQStep','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQStep','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQVendor','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQVendor','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQVendor','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQVendor','DELETE'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQWhse','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RFQWhse','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.RolePermissions','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RolePermissions','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.RolePermissions','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.Roles','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.SeasonCode','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedDetail','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedDetail','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedGroup','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedGroup','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedProductElement','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedProductElement','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedProductElement','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedProductElementValue','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedProductType','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedProductType','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedSize','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedSize','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedSize','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedVendor','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedVendor','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedVendor','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedVersion','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.StandardizedVersion','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.UDFComponent','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.UDFElement','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.UDFElementType','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.UDFGroup','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.UDFTable','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.UIElements','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.UIElements','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.age_group','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.age_group','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.age_group','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.ai_cache_events','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.ai_cache_events','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.app_settings','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.app_settings','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.app_settings','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.art_types','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.art_types','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.art_types','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.artist_types','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.artist_types','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.artist_types','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.artists','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.artists','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.artists','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.auth_token','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.auth_token','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.auth_token','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.comments','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.comments','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.comments','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.comments','DELETE'),
  ('designflow_prod_backend_grants','table','dflow_prod.companyCode','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.customers','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.customers','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.customers','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.customers','DELETE'),
  ('designflow_prod_backend_grants','table','dflow_prod.deliveryLocation','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.deliveryLocation','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.deliveryLocation','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.divisionCode','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.email_logs','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.grid_cell_notes','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.grid_cell_notes','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.grid_cell_notes','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.grid_cell_notes','DELETE'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemAttachment','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemAttachment','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemAttachment','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemAttachment','DELETE'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemDepth','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemDepth','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemDepth','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemDepth','DELETE'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemHeader','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemHeader','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemSize','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemSize','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemSize','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.itemSize','DELETE'),
  ('designflow_prod_backend_grants','table','dflow_prod.item_character_associations','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.item_user_assignment','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.item_workflow_action','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.licenseList','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.licenseList','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.licenseList','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.merchGroup','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.merchGroup','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.merchGroupHeaders','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.properties_and_characters','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.property_character_associations','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.quote_auth_token','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.quote_auth_token','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.quote_auth_token','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.user_notification','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.user_notification','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.user_notification','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.user_notification','DELETE'),
  ('designflow_prod_backend_grants','table','dflow_prod.users','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.users','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.users','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.vendor','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.vendor','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.vendor','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.vendorGroup','SELECT'),
  ('designflow_prod_backend_grants','table','dflow_prod.vendorGroup','INSERT'),
  ('designflow_prod_backend_grants','table','dflow_prod.vendorGroup','UPDATE'),
  ('designflow_prod_backend_grants','table','dflow_prod.vendorGroup','DELETE'),
  ('designflow_prod_backend_grants','view','dflow_prod.item_workflow_handoff','SELECT'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.AdditionalUserEmail_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.AuditLog_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.FOBCountry_FOBCountry_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.Factory_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.GridChildrenLayoutOrder_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.GridChildrenLayout_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.GridViewState_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.RFQContainer_RFQContainer_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.RFQCustomLayout_RFQCustomLayout_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.RFQGroup_RFQGroup_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.RFQItem_rfqItem_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.RFQLayout_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.RFQVendor_RFQVendor_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.RolePermissions_Id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.StandardizedDetail_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.StandardizedGroup_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.StandardizedProductElement_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.StandardizedProductType_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.StandardizedSize_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.StandardizedVendor_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.StandardizedVersion_id_seq1','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.UIElements_Id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.deliveryLocation_deliveryLocation_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.itemDepth__id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.itemPackage_item_package_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.itemSize_itemSize_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.licenseList_licenseList_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.signUpToken_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.vendorGroup_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.age_group_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.art_types_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.artist_types_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.artists_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.auth_token_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.comments_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.customers_customers_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.email_logs_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.user_notification_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.users_id_seq','USAGE'),
  ('designflow_prod_backend_grants','sequence','dflow_prod.vendor_vendor_id_seq','USAGE'),
  ('designflow_prod_backend_grants','function','dflow_prod.record_item_workflow_action','EXECUTE'),
  ('designflow_prod_backend_grants','function','dflow_prod.set_item_user_assignment','EXECUTE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.AuditLog','INSERT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.GridAccessLevel','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.GridLayout','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.LicenseFeedBacks','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.LicensingTime','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.ProdOrderDetail','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.RFQItem','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.SeasonCode','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.art_piece','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.art_piece','INSERT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.art_piece','DELETE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.art_piece_attachment','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.art_piece_attachment','INSERT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.art_piece_attachment','DELETE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.customers','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.divisionCode','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.grid_cell_notes','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.grid_cell_notes','INSERT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.grid_cell_notes','UPDATE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.grid_cell_notes','DELETE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.groups','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.itemAttachment','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.itemAttachment','INSERT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.itemAttachment','UPDATE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.itemHeader','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.itemHeader','INSERT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.itemType','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.itemType','INSERT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.licensingFeedbackReply','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.licensingFeedbackReply','INSERT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.licensingFeedbackReply','UPDATE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.licensingFeedbackReply','DELETE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.licensingStatus','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.licensingStatus','INSERT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.licensingStatus','UPDATE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.licensingStatus','DELETE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.merchGroup','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.productUserAssignment','SELECT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.productUserAssignment','INSERT'),
  ('designflow_prod_item_master_grants','table','dflow_prod.productUserAssignment','UPDATE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.productUserAssignment','DELETE'),
  ('designflow_prod_item_master_grants','table','dflow_prod.users','SELECT'),
  ('designflow_prod_item_master_grants','sequence','dflow_prod.AuditLog_id_seq','USAGE'),
  ('designflow_prod_item_master_grants','sequence','dflow_prod.itemHeader_item_num_id_pk _seq','USAGE'),
  ('designflow_prod_item_master_grants','sequence','dflow_prod.itemPackage_item_package_id_seq','USAGE'),
  ('designflow_prod_item_master_grants','sequence','dflow_prod.itemType_item_type_id_seq','USAGE'),
  ('designflow_prod_item_master_grants','sequence','dflow_prod.licensingFeedbackReply_id_seq','USAGE'),
  ('designflow_prod_item_master_grants','sequence','dflow_prod.licensingStatus_id_seq','USAGE'),
  ('designflow_prod_item_master_grants','sequence','dflow_prod.productUserAssignment_id_seq','USAGE'),
  ('designflow_prod_item_master_grants','sequence','dflow_prod.art_piece_attachment_id_seq','USAGE'),
  ('designflow_prod_item_master_grants','sequence','dflow_prod.art_piece_id_seq','USAGE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.DesignTeamTime','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.DesignTeamTime','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.Factory','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.FactoryTime','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.FactoryTime','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.FactoryTime','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.FactoryTime','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.GridAccessLevel','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.GridLayout','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.LicenseFeedBacks','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.LicensingTime','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.LicensingTime','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.ProdOrderDetail','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.ProdOrderHeader','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.ProdOrderHeader','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.RolePermissions','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.UDFTable','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.UIElements','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.comments','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.customers','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.deliveryLocation','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.email_logs','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.email_logs','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.externalCustomer','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.externalVendor','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.grid_cell_notes','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.grid_cell_notes','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.grid_cell_notes','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.grid_cell_notes','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.groups','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.groups','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.groups','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.groups','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.itemAttachment','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.itemAttachment','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.itemHeader','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.itemHeader','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.itemLicenseImage','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.item_prod_order_detail_associations','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.licensingStatus','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.merchGroup','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.product_type_factory_time','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.product_type_factory_time','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.product_type_factory_time','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.product_type_factory_time','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_approval_event','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_approval_event','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_approval_event','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_attachment','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_attachment','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_attachment','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_box','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_box','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_box','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_box','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_carrier','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_comments','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_comments','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_comments','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_comments','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_creation_batch','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_creation_batch','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_creation_batch','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_event','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_event','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_event','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_factory_group','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_factory_group','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_factory_group','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_factory_group','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_factory_visit','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_factory_visit','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_factory_visit','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_factory_visit','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_factory_visit_event','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_factory_visit_event','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_factory_visit_event','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_import_job','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_import_job','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_import_job','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_import_job','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_import_row','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_import_row','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_import_row','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_import_row','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_inventory_balance','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_inventory_balance','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_inventory_balance','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_movement','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_movement','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_path_revision','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_path_revision','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_path_revision','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_piece_lineage','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_piece_lineage','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_piece_lineage','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_remote_request','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_remote_request','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_remote_request','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_remote_request_history','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_remote_request_history','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_remote_request_item','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_remote_request_item','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_remote_request_item','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_reservation','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_reservation','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment_item','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment_item','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment_item','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment_line','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment_line','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment_line','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment_notice','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment_notice','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment_notice','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_shipment_notice_recipient','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_stop_closeout','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_stop_closeout','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_stop_closeout','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_workflow','SELECT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_workflow','INSERT'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_workflow','UPDATE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.sample_workflow','DELETE'),
  ('designflow_prod_tracking_grants','table','dflow_prod.users','SELECT'),
  ('designflow_prod_tracking_grants','view','dflow_prod.sample_approval_current','SELECT'),
  ('designflow_prod_tracking_grants','view','dflow_prod.sample_balance_by_location','SELECT'),
  ('designflow_prod_tracking_grants','view','dflow_prod.sample_global_status','SELECT'),
  ('designflow_prod_tracking_grants','view','dflow_prod.sample_in_transit','SELECT'),
  ('designflow_prod_tracking_grants','view','dflow_prod.sample_open_stop_work','SELECT'),
  ('designflow_prod_tracking_grants','view','dflow_prod.sample_receipt_discrepancy','SELECT'),
  ('designflow_prod_tracking_grants','view','dflow_prod.sample_visit_plan','SELECT'),
  ('designflow_prod_tracking_grants','sequence','dflow_prod.FactoryTime_id_seq','USAGE'),
  ('designflow_prod_tracking_grants','sequence','dflow_prod.itemPackage_item_package_id_seq','USAGE'),
  ('designflow_prod_tracking_grants','sequence','dflow_prod.email_logs_id_seq','USAGE'),
  ('designflow_prod_tracking_grants','sequence','dflow_prod.groups_id_seq','USAGE'),
  ('designflow_prod_tracking_grants','sequence','dflow_prod.sample_attachment_sample_attachment_id_seq','USAGE'),
  ('designflow_prod_tracking_grants','sequence','dflow_prod.sample_box_box_id_pk_seq','USAGE'),
  ('designflow_prod_tracking_grants','sequence','dflow_prod.sample_comments_id_seq','USAGE'),
  ('designflow_prod_tracking_grants','sequence','dflow_prod.sample_event_event_id_pk_seq','USAGE'),
  ('designflow_prod_tracking_grants','sequence','dflow_prod.sample_factory_group_factory_group_id_pk_seq','USAGE'),
  ('designflow_prod_tracking_grants','sequence','dflow_prod.sample_sample_id_pk_seq','USAGE'),
  ('designflow_prod_tracking_grants','sequence','dflow_prod.sample_shipment_item_shipment_item_id_pk_seq','USAGE'),
  ('designflow_prod_tracking_grants','function','dflow_prod.claim_sample_shipment_notice','EXECUTE'),
  ('designflow_prod_tracking_grants','function','dflow_prod.pack_sample_reservation','EXECUTE'),
  ('designflow_prod_tracking_grants','function','dflow_prod.post_sample_approval_event','EXECUTE'),
  ('designflow_prod_tracking_grants','function','dflow_prod.post_sample_movement','EXECUTE'),
  ('designflow_prod_tracking_grants','function','dflow_prod.post_sample_piece_split','EXECUTE'),
  ('designflow_prod_tracking_grants','function','dflow_prod.post_sample_remote_request_event','EXECUTE'),
  ('designflow_prod_tracking_grants','function','dflow_prod.reserve_sample_remote_request_item','EXECUTE'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.ProdOrderDetail','SELECT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.ProdOrderDetail','INSERT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.ProdOrderHeader','SELECT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.ProdOrderHeader','INSERT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.ProdOrderHeader','UPDATE'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.UDFTable','SELECT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.externalApi','SELECT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.externalCustomer','INSERT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.externalVendor','INSERT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.itemAttachment','SELECT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.itemDetail','INSERT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.itemHeader','SELECT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.item_prod_order_detail_associations','SELECT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.item_prod_order_detail_associations','INSERT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.item_prod_order_detail_associations','UPDATE'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.merchGroup','SELECT'),
  ('designflow_prod_data_sync_grants','table','dflow_prod.merchGroupHeaders','SELECT'),
  ('designflow_prod_data_sync_grants','sequence','dflow_prod.ProdOrderDetail_id_seq','USAGE'),
  ('designflow_prod_data_sync_grants','sequence','dflow_prod.ProdOrderHeader_id_seq','USAGE'),
  ('designflow_prod_data_sync_grants','sequence','dflow_prod.externalCustomer_id_seq','USAGE'),
  ('designflow_prod_data_sync_grants','sequence','dflow_prod.externalVendor_id_seq','USAGE'),
  ('designflow_prod_data_sync_grants','sequence','dflow_prod.itemDetail_item_pk_seq','USAGE'),
  ('designflow_prod_data_sync_grants','sequence','dflow_prod.item_prod_order_detail_associations_id_seq','USAGE');

do $post$
declare v_svc text; v_limit int; v_diff text;
begin
  if (select count(*) from t2873_expected) <> 427 then raise exception '#2873 VERIFY FAILED: expected matrix is not 427 entries'; end if;
  foreach v_svc in array array['backend','item_master','tracking','data_sync'] loop
    v_limit := case v_svc when 'backend' then 20 else 10 end;
    -- Exact role attributes (created here or pre-existing from preview).
    if not exists (select 1 from pg_roles where rolname='designflow_prod_'||v_svc||'_grants' and not rolcanlogin and not rolinherit
                   and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls)
    then raise exception '#2873 VERIFY FAILED: designflow_prod_%_grants attributes', v_svc; end if;
    if not exists (select 1 from pg_roles where rolname='designflow_prod_'||v_svc||'_runtime' and rolcanlogin and rolinherit
                   and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls
                   and rolconnlimit = v_limit)
    then raise exception '#2873 VERIFY FAILED: designflow_prod_%_runtime attributes or connection limit (expected %)', v_svc, v_limit; end if;
    -- Exactly one membership: runtime in its own grant role, INHERIT true, SET false, ADMIN false.
    if (select count(*) from pg_auth_members m where m.member=('designflow_prod_'||v_svc||'_runtime')::regrole) <> 1
       or not exists (select 1 from pg_auth_members m
                      where m.member=('designflow_prod_'||v_svc||'_runtime')::regrole
                        and m.roleid=('designflow_prod_'||v_svc||'_grants')::regrole
                        and m.inherit_option and not m.set_option and not m.admin_option)
    then raise exception '#2873 VERIFY FAILED: designflow_prod_%_runtime membership', v_svc; end if;
    -- The grant role is a member of nothing and has no member but its own runtime.
    if exists (select 1 from pg_auth_members m where m.member=('designflow_prod_'||v_svc||'_grants')::regrole)
       or exists (select 1 from pg_auth_members m where m.roleid=('designflow_prod_'||v_svc||'_grants')::regrole
                  and m.member<>('designflow_prod_'||v_svc||'_runtime')::regrole)
    then raise exception '#2873 VERIFY FAILED: designflow_prod_%_grants membership', v_svc; end if;
    -- Schemas, each guarded identically: USAGE on dflow_prod only; nothing on dflow,
    -- plm or hts_rag; public keeps only the PUBLIC defaults (no CREATE).
    if not has_schema_privilege('designflow_prod_'||v_svc||'_runtime','dflow_prod','USAGE')
       or has_schema_privilege('designflow_prod_'||v_svc||'_runtime','dflow_prod','CREATE')
       or (to_regnamespace('dflow') is not null and has_schema_privilege('designflow_prod_'||v_svc||'_runtime','dflow','USAGE'))
       or (to_regnamespace('plm') is not null and has_schema_privilege('designflow_prod_'||v_svc||'_runtime','plm','USAGE'))
       or (to_regnamespace('hts_rag') is not null and has_schema_privilege('designflow_prod_'||v_svc||'_runtime','hts_rag','USAGE'))
       or (to_regnamespace('public') is not null and has_schema_privilege('designflow_prod_'||v_svc||'_runtime','public','CREATE'))
    then raise exception '#2873 VERIFY FAILED: designflow_prod_%_runtime has a forbidden schema privilege', v_svc; end if;
  end loop;
  -- Direct schema ACL entries: only USAGE on dflow_prod to the grant roles, no grant option.
  if exists (select 1 from pg_namespace n cross join lateral aclexplode(n.nspacl) a join pg_roles r on r.oid=a.grantee
             where r.rolname like 'designflow\_prod\_%'
               and not (n.nspname='dflow_prod' and a.privilege_type='USAGE' and r.rolname like 'designflow\_prod\_%\_grants' and not a.is_grantable))
  then raise exception '#2873 VERIFY FAILED: unexpected schema privilege'; end if;
  -- Relation and function privileges of every designflow_prod role equal the published
  -- 427-entry matrix in both directions (so runtime roles hold none directly).
  with actual as (
    select r.rolname::text grantee,
           case c.relkind when 'v' then 'view' when 'S' then 'sequence' else 'table' end kind,
           n.nspname||'.'||c.relname name, a.privilege_type priv
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid=a.grantee
    where r.rolname like 'designflow\_prod\_%'
    union all
    select r.rolname::text, 'function', n.nspname||'.'||p.proname, a.privilege_type
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee
    where r.rolname like 'designflow\_prod\_%'
  ), d as ((select * from actual except select * from t2873_expected) union all (select * from t2873_expected except select * from actual))
  select string_agg(format('%s %s %s %s', grantee, kind, name, priv), '; ') into v_diff from d;
  if v_diff is not null then raise exception '#2873 VERIFY FAILED: grant matrix drift: %', v_diff; end if;
  -- Column-level grants, grant options, ownership and default privileges: none.
  if exists (select 1 from pg_attribute t cross join lateral aclexplode(t.attacl) a join pg_roles r on r.oid=a.grantee
             where r.rolname like 'designflow\_prod\_%')
     or exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid=a.grantee
             where r.rolname like 'designflow\_prod\_%' and a.is_grantable)
     or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee
             where r.rolname like 'designflow\_prod\_%' and a.is_grantable)
  then raise exception '#2873 VERIFY FAILED: column grant or grant option present'; end if;
  if exists (select 1 from pg_class c join pg_roles r on r.oid=c.relowner where r.rolname like 'designflow\_prod\_%')
     or exists (select 1 from pg_proc p join pg_roles r on r.oid=p.proowner where r.rolname like 'designflow\_prod\_%')
     or exists (select 1 from pg_namespace n join pg_roles r on r.oid=n.nspowner where r.rolname like 'designflow\_prod\_%')
     or exists (select 1 from pg_default_acl d join pg_roles r on r.oid=d.defaclrole where r.rolname like 'designflow\_prod\_%')
  then raise exception '#2873 VERIFY FAILED: ownership or default privileges held'; end if;
end $post$;


commit;
