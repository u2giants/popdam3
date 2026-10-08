-- Issue #2873: least-privilege dflow_prod service identities. The expected
-- matrix below is the exact grant set; the catalog must match it in both
-- directions, and each runtime identity must be refused everything else.
begin;

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

do $t$
declare v_role text; v_diff text; v_ok boolean;
begin
  -- Role attributes and membership shape.
  foreach v_role in array array['backend','item_master','tracking','data_sync'] loop
    if not exists (select 1 from pg_roles where rolname='designflow_prod_'||v_role||'_grants' and not rolcanlogin and not rolinherit
                   and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls)
    then raise exception '#2873: grant role % attributes wrong', v_role; end if;
    if not exists (select 1 from pg_roles where rolname='designflow_prod_'||v_role||'_runtime' and rolcanlogin and rolinherit
                   and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls
                   and rolconnlimit = case v_role when 'backend' then 20 else 10 end)
    then raise exception '#2873: runtime role % attributes wrong', v_role; end if;
    if (select array_agg(r.rolname::text) from pg_auth_members m join pg_roles r on r.oid=m.roleid
        where m.member=('designflow_prod_'||v_role||'_runtime')::regrole) <> array['designflow_prod_'||v_role||'_grants']
    then raise exception '#2873: runtime role % must be a member of exactly its own grant role', v_role; end if;
    if exists (select 1 from information_schema.role_table_grants where grantee='designflow_prod_'||v_role||'_runtime')
       or exists (select 1 from pg_class c, aclexplode(c.relacl) a where a.grantee=('designflow_prod_'||v_role||'_runtime')::regrole)
    then raise exception '#2873: runtime role % holds a direct privilege', v_role; end if;
  end loop;

  -- Catalog equals the expected matrix, both directions.
  with actual as (
    select r.rolname::text grantee,
           case c.relkind when 'v' then 'view' when 'S' then 'sequence' else 'table' end kind,
           n.nspname||'.'||c.relname name, a.privilege_type priv
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid=a.grantee
    where r.rolname like 'designflow\_prod\_%\_grants'
    union all
    select r.rolname::text, 'function', n.nspname||'.'||p.proname, a.privilege_type
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee
    where r.rolname like 'designflow\_prod\_%\_grants'
  ), d as ((select * from actual except select * from t2873_expected) union all (select * from t2873_expected except select * from actual))
  select string_agg(format('%s %s %s %s', grantee, kind, name, priv), '; ') into v_diff from d;
  if v_diff is not null then raise exception '#2873: grant matrix drift: %', v_diff; end if;
  -- Function grants are compared by name above; refuse any overload so a name is one signature.
  select string_agg(distinct n.nspname||'.'||p.proname, ', ') into v_diff
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(p.proacl) a join pg_roles r on r.oid=a.grantee
  where r.rolname like 'designflow\_prod\_%\_grants'
    and (select count(*) from pg_proc q where q.pronamespace=p.pronamespace and q.proname=p.proname) <> 1;
  if v_diff is not null then raise exception '#2873: granted function has overloads: %', v_diff; end if;

  -- Schema boundary.
  foreach v_role in array array['backend','item_master','tracking','data_sync'] loop
    v_role := 'designflow_prod_'||v_role||'_runtime';
    if not has_schema_privilege(v_role,'dflow_prod','USAGE') or has_schema_privilege(v_role,'dflow_prod','CREATE')
    then raise exception '#2873: % schema dflow_prod privileges wrong', v_role; end if;
    if to_regnamespace('dflow') is not null and has_schema_privilege(v_role,'dflow','USAGE') then raise exception '#2873: % reaches dflow', v_role; end if;
    if to_regnamespace('plm') is not null and has_schema_privilege(v_role,'plm','USAGE') then raise exception '#2873: % reaches plm', v_role; end if;
    if to_regnamespace('hts_rag') is not null and has_schema_privilege(v_role,'hts_rag','USAGE') then raise exception '#2873: % reaches hts_rag', v_role; end if;
    if pg_has_role(v_role,'anon','USAGE') or pg_has_role(v_role,'authenticated','USAGE') or pg_has_role(v_role,'service_role','USAGE')
       or pg_has_role(v_role,'postgres','USAGE')
    then raise exception '#2873: % inherits a client or admin role', v_role; end if;
  end loop;
end $t$;

-- Live refusal controls as the Tracking runtime identity.
set local role designflow_prod_tracking_runtime;
do $r$
begin
  perform 1 from dflow_prod.sample limit 1;  -- allowed
  begin
    perform 1 from dflow_prod."RFQItem" limit 1;
    raise exception '#2873: tracking read a table outside its matrix';
  exception when insufficient_privilege then null; end;
  begin
    execute 'create table dflow_prod.t2873_forbidden(id int)';
    raise exception '#2873: tracking created a table';
  exception when insufficient_privilege then null; end;
  begin
    execute 'truncate dflow_prod.sample';
    raise exception '#2873: tracking truncated a table';
  exception when insufficient_privilege then null; end;
  if to_regnamespace('dflow') is not null then
    begin
      perform 1 from dflow.users limit 1;
      raise exception '#2873: tracking read legacy dflow';
    exception when insufficient_privilege then null; end;
  end if;
end $r$;
reset role;

-- And as the backend runtime identity: allowed read, refused sample-only write.
set local role designflow_prod_backend_runtime;
do $r$
begin
  perform 1 from dflow_prod."RFQItem" limit 1;
  begin
    execute 'truncate dflow_prod."RFQItem"';
    raise exception '#2873: backend truncated a table';
  exception when insufficient_privilege then null; end;
end $r$;
reset role;


-- Existing PUBLIC helpers execute as invoker and must not bypass caller access.
set local role designflow_prod_backend_runtime;
do $test$ begin begin perform dflow_prod.get_parent_id(null,null,null); raise exception 'UNSAFE: helper bypassed caller table privilege'; exception when insufficient_privilege then raise notice 'PASS: get_parent_id remains caller-limited'; end; begin perform dflow_prod.get_child_id(null,null,null,null,null,null); raise exception 'UNSAFE: child helper bypassed caller table privilege'; exception when insufficient_privilege then raise notice 'PASS: get_child_id remains caller-limited'; end; end $test$;
reset role;
set local role designflow_prod_item_master_runtime;
do $test$ begin begin perform dflow_prod.get_parent_id(null,null,null); raise exception 'UNSAFE: helper bypassed caller table privilege'; exception when insufficient_privilege then raise notice 'PASS: get_parent_id remains caller-limited'; end; begin perform dflow_prod.get_child_id(null,null,null,null,null,null); raise exception 'UNSAFE: child helper bypassed caller table privilege'; exception when insufficient_privilege then raise notice 'PASS: get_child_id remains caller-limited'; end; end $test$;
reset role;
set local role designflow_prod_tracking_runtime;
do $test$ begin begin perform dflow_prod.get_parent_id(null,null,null); raise exception 'UNSAFE: helper bypassed caller table privilege'; exception when insufficient_privilege then raise notice 'PASS: get_parent_id remains caller-limited'; end; begin perform dflow_prod.get_child_id(null,null,null,null,null,null); raise exception 'UNSAFE: child helper bypassed caller table privilege'; exception when insufficient_privilege then raise notice 'PASS: get_child_id remains caller-limited'; end; end $test$;
reset role;
set local role designflow_prod_data_sync_runtime;
do $test$ begin begin perform dflow_prod.get_parent_id(null,null,null); raise exception 'UNSAFE: helper bypassed caller table privilege'; exception when insufficient_privilege then raise notice 'PASS: get_parent_id remains caller-limited'; end; begin perform dflow_prod.get_child_id(null,null,null,null,null,null); raise exception 'UNSAFE: child helper bypassed caller table privilege'; exception when insufficient_privilege then raise notice 'PASS: get_child_id remains caller-limited'; end; end $test$;
reset role;
rollback;
