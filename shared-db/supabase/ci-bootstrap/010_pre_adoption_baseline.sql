-- =====================================================================================
-- CAPTURED PRE-ADOPTION BASELINE  --  CI-ONLY BOOTSTRAP, NOT A MIGRATION
-- =====================================================================================
-- WHAT THIS IS
-- ------------
-- This repository's migration history is NOT self-contained (issue #754). The repo was
-- adopted on top of an ALREADY-POPULATED database, so a set of objects -- public.assets,
-- the legacy popdam tables, the plm.* legacy mirrors -- exist in preview and production
-- with no migration here that creates them. Replaying supabase/migrations from empty
-- therefore applied 363 of 429 and FAILED 66, and 26 of the 40 contract tests could not
-- run at all (they were quarantined in supabase/tests/ci-quarantine.txt).
--
-- This file is the missing starting point: the SCHEMA ONLY of every relation that exists
-- in production but that no migration in this repository creates.
--
-- WHY IT IS NOT A MIGRATION, AND MUST NOT BECOME ONE
-- --------------------------------------------------
-- A new migration inserted at the FRONT of an already-applied sequence cannot re-run
-- against preview or production: their ledgers are years past this point, and a
-- back-dated version is exactly what the Guard B backdating check exists to stop. The
-- deployed databases already contain every object below -- applying it there would be a
-- no-op at best and a conflict at worst. The ONLY consumer that needs it is a from-empty
-- replay, which only ever happens inside the ephemeral database in the CI runner.
-- So it lives here, outside supabase/migrations/, and is applied only by
-- .github/workflows/database-contract-tests.yml.
--
-- DELIBERATE OMISSION -- public.update_bulk_operation / public.update_bulk_operations_batch
-- ---------------------------------------------------------------------------------
-- Both used to be captured here. They are now owned by
-- supabase/migrations/*_popdam_bulk_operation_revision_lease.sql
-- (deliberately matched by NAME, not by version: this migration has been re-reserved
--  three times as later versions landed on main, and each rename left this comment
--  pointing at a file that no longer existed -- see issue #1182)
-- (issue #1171), which drops the old three-argument update_bulk_operation and creates a
-- six-argument compare-and-swap/submission-lease version in its place.
--
-- Because this file is applied AFTER pass 1, re-capturing the pre-adoption bodies here
-- would (a) leave TWO update_bulk_operation overloads so that every legacy two- or
-- three-argument call fails with "function ... is not unique", and (b) silently replace
-- the guarded update_bulk_operations_batch body with the unguarded one, so CI would prove
-- the opposite of the contract. Do not re-add them when this snapshot is regenerated.
--
-- HOW IT IS APPLIED (two-pass replay -- read the workflow)
-- -------------------------------------------------------
-- PASS 1 replays every migration from empty and records which fail.
-- THEN this file is applied.
-- PASS 2 re-runs only the migrations that failed in pass 1.
-- The bootstrap deliberately runs BETWEEN the passes rather than before pass 1, because
-- some columns below are typed with enums that supabase/migrations/20260621150714_
-- foundation.sql creates (app.entity_status). Running before pass 1 would force this file
-- to create those types itself, and foundation's unguarded CREATE TYPE would then fail --
-- turning one gap into a worse one.
--
-- HOW IT WAS CAPTURED, AND HOW TO RE-CAPTURE IT
-- ---------------------------------------------
-- Generated read-only from production (qsllyeztdwjgirsysgai) via the Supabase Management
-- API query endpoint with read_only:true. The object set is computed, not hand-picked:
-- every relation in public/plm/dam/dflow/core/api that no `CREATE TABLE|VIEW` in
-- supabase/migrations/ names. See supabase/ci-bootstrap/README.md for the exact procedure.
--
-- SCHEMA ONLY. NO ROWS. NOT ONE. No production data, no personal data, no licensed data
-- is captured here, and none may ever be added. Test data belongs in
-- 020_test_fixture_seed.sql and is synthetic.
--
-- WHEN THIS FILE IS WRONG
-- -----------------------
-- It is a snapshot of production's CURRENT shape for these objects, which is the shape a
-- from-empty replay must reach. If a future migration in this repo starts creating one of
-- these objects itself, DELETE it from here -- otherwise pass 2 will report a duplicate
-- and the workflow will tell you. Re-capture after any out-of-band change to a legacy
-- table. The workflow prints the pass-1 and pass-2 failure counts on every run, so drift
-- here is visible, not silent.
-- =====================================================================================

set client_min_messages = warning;

create schema if not exists public;
create schema if not exists core;
create schema if not exists dam;
create schema if not exists dflow;
create schema if not exists plm;
create schema if not exists api;

-- The DAM search migrations need pgvector; the CLI's local stack does not enable it.
create extension if not exists vector with schema extensions;

do $bootstrap$ begin
  CREATE TYPE public.app_name AS ENUM ('popdam', 'styleguides');
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TYPE public.art_source AS ENUM ('freelancer', 'straight_style_guide', 'style_guide_composition');
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TYPE public.asset_status AS ENUM ('pending', 'processing', 'tagged', 'error');
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TYPE public.asset_type AS ENUM ('art_piece', 'product', 'packaging', 'tech_pack', 'photography');
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TYPE public.checkout_status AS ENUM ('active', 'checkin_queued', 'uploading', 'verifying', 'complete', 'discarded', 'error', 'conflict');
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TYPE public.file_type AS ENUM ('psd', 'ai', 'jpg', 'png', 'pdf');
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TYPE public.queue_status AS ENUM ('pending', 'claimed', 'processing', 'completed', 'failed');
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TYPE public.workflow_status AS ENUM ('product_ideas', 'concept_approved', 'in_development', 'freelancer_art', 'discontinued', 'in_process', 'customer_adopted', 'licensor_approved', 'other');
exception when duplicate_object then null; end $bootstrap$;

-- ------------------------------------------------------------------------------------
-- Sequences backing the serial columns below.
-- ------------------------------------------------------------------------------------
create sequence if not exists core."vendorGroup_id_seq";
create sequence if not exists core.age_group_id_seq;
create sequence if not exists core.art_types_id_seq;
create sequence if not exists core.artist_types_id_seq;
create sequence if not exists plm."DesignTeamTime_id_seq";
create sequence if not exists plm."FactoryTime_id_seq";
create sequence if not exists plm."LicensingTime_id_seq";
create sequence if not exists plm."licensingFeedbackReply_id_seq";
create sequence if not exists plm."licensingMilestone_id_seq";
create sequence if not exists plm.art_piece_attachment_id_seq;
create sequence if not exists plm.groups_id_seq;
create sequence if not exists plm.item_character_associations_id_seq;

-- ------------------------------------------------------------------------------------
-- Tables -- schema only, captured from production, minus every column a migration adds (125)
-- ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.age_group (
  id integer DEFAULT nextval('core.age_group_id_seq'::regclass) NOT NULL,
  name character varying(255) NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by integer NOT NULL,
  updated_at timestamp with time zone,
  updated_by integer);
CREATE TABLE IF NOT EXISTS core.art_types (
  id integer DEFAULT nextval('core.art_types_id_seq'::regclass) NOT NULL,
  code character varying(255) NOT NULL,
  name character varying(255) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by integer NOT NULL,
  updated_at timestamp with time zone,
  updated_by integer,
  is_active boolean DEFAULT true NOT NULL,
  divisioncode_id integer NOT NULL);
CREATE TABLE IF NOT EXISTS core.artist_types (
  id integer DEFAULT nextval('core.artist_types_id_seq'::regclass) NOT NULL,
  code character varying(255) NOT NULL,
  name character varying(255) NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by integer NOT NULL,
  updated_at timestamp with time zone,
  updated_by integer);
CREATE TABLE IF NOT EXISTS core."externalCustomer" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "companyCode" character varying,
  "customerCode" character varying NOT NULL,
  active character varying,
  address1 character varying,
  address2 character varying,
  "aRCustomerCode" character varying,
  city character varying,
  "countryCode" character varying,
  "customerDesc" character varying,
  "customerTypeCode" character varying,
  "faxNo" character varying,
  "phoneNo" character varying,
  state character varying,
  "useConsolidatedInvoice" character varying,
  "zipCode" character varying,
  "parentCustomerCode" character varying,
  "customerDBA" character varying,
  udf01 character varying,
  udf02 character varying,
  udf03 character varying,
  udf04 character varying,
  "udfDate01" character varying,
  "udfDate02" character varying,
  "oldCustomerCode" character varying,
  "vendorNumber" character varying,
  address3 character varying,
  "regionCode" character varying,
  "dsCat" character varying,
  "salesPersonCode1" character varying,
  "salesPersonCode2" character varying,
  "commissionPerc1" character varying,
  "commissionPerc2" character varying,
  "factorCode" character varying,
  "currencyCode" character varying,
  "glCode" character varying,
  "createdTime" character varying,
  "createdUser" character varying,
  "modTime" character varying,
  "modUser" character varying);
CREATE TABLE IF NOT EXISTS core."externalVendor" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "companyCode" character varying,
  "vendorCode" character varying NOT NULL,
  "vendorDesc" character varying,
  address1 character varying,
  address2 character varying,
  city character varying,
  state character varying,
  "zipCode" character varying,
  "phoneNo" character varying,
  "faxNo" character varying,
  email character varying,
  udf01 character varying,
  udf02 character varying,
  udf03 character varying,
  udf04 character varying,
  "udfDate01" character varying,
  "udfDate02" character varying,
  "countryCode" character varying,
  active character varying,
  address3 character varying,
  "payTermCode" character varying,
  "glCode" character varying,
  "separateCheck" character varying,
  "femaExpDate" character varying,
  "nbcExpDate" character varying,
  "modUser" character varying,
  "modTime" character varying,
  "createdUser" character varying,
  "createdTime" character varying);
CREATE TABLE IF NOT EXISTS core."licenseList" (
  "licenseList_id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "licenseList_code" character varying(255),
  "licenseList_title" character varying(255),
  "licenseList_status" character varying(255),
  "licenseList_auditlog" character varying(255),
  "licenseList_royalty_rate" double precision,
  "licenseList_airbyte_emitted_at" timestamp with time zone,
  "licenseList_airbyte_licenses_hashid" text,
  "licenseList_fob_royalty_rate" double precision);
CREATE TABLE IF NOT EXISTS core."merchGroup" (
  mg_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  mg_code character varying,
  mg_desc character varying,
  "ItemNoCode" character varying,
  "mgTypeCode" character varying,
  "createdTime" character varying,
  "createdUser" character varying,
  "modTime" character varying,
  "modUser" character varying,
  "companyCode_fk" character varying,
  "divisionCode_fk" character varying,
  "divisionCode_id_fk" integer,
  "companyCode_id_fk" integer,
  is_active boolean DEFAULT false,
  parent_id integer,
  "mgCode2" character varying(20),
  "mgCategory" character varying(20));
CREATE TABLE IF NOT EXISTS core."merchGroupHeaders" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "companyCode" character varying,
  "divisionCode" character varying,
  "mgTypeCode" character varying,
  "mgTypeDesc" character varying,
  "createdTime" character varying,
  "createdUser" character varying,
  "modTime" character varying,
  "modUser" character varying,
  "divisionCode_id_fk" integer,
  "companyCode_id_fk" integer);
CREATE TABLE IF NOT EXISTS core."merchGroupMaster" (
  mg_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  mg_code character varying,
  mg_desc character varying,
  "ItemNoCode" character varying,
  "mgTypeCode" character varying,
  "createdTime" timestamp without time zone,
  "createdUser" character varying(100),
  "modTime" timestamp without time zone,
  "modUser" character varying(100),
  "companyCode_fk" character varying,
  "divisionCode_fk" character varying,
  "divisionCode_id_fk" integer,
  "companyCode_id_fk" integer,
  is_active boolean DEFAULT true,
  "mgCode2" character varying(20),
  "mgCategory" character varying(20));
CREATE TABLE IF NOT EXISTS core."merchGroupRelations" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  grand_parent_mg_id integer,
  parent_mg_id integer NOT NULL,
  child_mg_id integer NOT NULL,
  "divisionCode_id_fk" integer NOT NULL,
  "createdTime" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "createdUser" integer NOT NULL,
  "modTime" timestamp without time zone,
  "modUser" integer,
  is_active boolean DEFAULT true);
CREATE TABLE IF NOT EXISTS core.properties_and_characters (
  id integer NOT NULL,
  name character varying(255) NOT NULL,
  type character varying(50) NOT NULL,
  licensor_id integer NOT NULL,
  source_licensed_property_id character varying(100),
  source_character_id character varying(100),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS core.property_character_associations (
  property_id integer NOT NULL,
  character_id integer NOT NULL,
  licensor_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS core.vendor (
  vendor_id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  vendor_name character varying(255),
  vendor_email character varying(255),
  vendor_phone1 character varying(255),
  vendor_phone2 character varying(255),
  vendor_status character varying(255),
  vendor_country character varying(255),
  vendor_address1 character varying(255),
  vendor_address2 character varying(255),
  vendor_access character varying(255),
  vendor_passw character varying,
  vendor_lastname character varying,
  vendor_company_nickname character varying,
  vendor_company_name character varying,
  "vendor_wechatId" character varying,
  factory_id_fk integer,
  vendor_profile_photo text);
CREATE TABLE IF NOT EXISTS core."vendorGroup" (
  id integer DEFAULT nextval('core."vendorGroup_id_seq"'::regclass) NOT NULL,
  name character varying(255) NOT NULL,
  factory_ids integer[] DEFAULT '{}'::integer[]);
CREATE TABLE IF NOT EXISTS plm."ContainerHeader" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  fkey integer,
  "CompanyCode" character varying,
  "ContainerNo" character varying,
  "ShipmentNo" character varying,
  "ContainerType" character varying,
  "SealNo" character varying,
  "ProNo" character varying,
  "ContainerVolume" character varying,
  "WarehouseCode" character varying,
  "TotalCartons" character varying,
  "EstWhseArrivalDate" character varying,
  "WhseArrivalDate" character varying,
  "ContainerRecvd" character varying,
  "ReceiveFkey" character varying,
  "ReceiveNo" character varying,
  "ContainerSize" character varying,
  "EDI943Proc" character varying,
  "EDI943ProcDate" character varying,
  "ContainerStatus" character varying,
  "LFDDate" character varying,
  "ContainerPriority" character varying,
  "Remarks" character varying,
  "TotalQty" character varying,
  "ShipViaCode" character varying);
CREATE TABLE IF NOT EXISTS plm."DesignTeamTime" (
  id integer DEFAULT nextval('plm."DesignTeamTime_id_seq"'::regclass) NOT NULL,
  product_category character varying(100),
  product_subtype character varying(200) NOT NULL,
  brief_mins integer DEFAULT 0,
  design_mins integer DEFAULT 0,
  techpack_mins integer DEFAULT 0,
  revision_mins integer DEFAULT 0,
  files_mins integer DEFAULT 0,
  total_hours numeric(10,4),
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL);
CREATE TABLE IF NOT EXISTS plm."DesignTeamTimes" (
  id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  nickname_id_fk integer NOT NULL,
  brief_time integer NOT NULL,
  design_time integer NOT NULL,
  tech_packing_time integer NOT NULL,
  revisions_time integer NOT NULL,
  files_factory_time integer NOT NULL);
CREATE TABLE IF NOT EXISTS plm."FOBCountry" (
  "FOBCountry_id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "FOBCountry_title" character varying(255),
  "FOBCountry_status" character varying(255));
CREATE TABLE IF NOT EXISTS plm."FactoryTime" (
  id integer DEFAULT nextval('plm."FactoryTime_id_seq"'::regclass) NOT NULL,
  product_category character varying(100),
  product_subtype character varying(200) NOT NULL,
  sampling_days integer DEFAULT 0,
  resampling_days integer DEFAULT 0,
  mass_production_days integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL);
CREATE TABLE IF NOT EXISTS plm."FactoryTimes" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  sampling_time integer,
  resampling_time integer,
  mass_production_time integer,
  nickname_id_fk integer);
CREATE TABLE IF NOT EXISTS plm."GridAccessLevel" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  col_id character varying,
  col_access_level character varying,
  access boolean,
  grid_id character varying);
CREATE TABLE IF NOT EXISTS plm."GridChildrenLayout" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  field character varying NOT NULL,
  filter character varying,
  hide character varying,
  "cellRenderer" character varying,
  "checkboxSelection" character varying,
  "rowDrag" character varying,
  "rowGroup" character varying,
  width integer,
  col_pinned character varying,
  col_order integer,
  user_id_fk integer,
  layout_name character varying,
  "GridLayout_id_fk" integer,
  grid_id character varying,
  std_prod_id_fk integer,
  "columnGroupShow" character varying,
  "headerName" character varying,
  factory_id_fk integer);
CREATE TABLE IF NOT EXISTS plm."GridChildrenLayoutOrder" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  field character varying,
  layout_name character varying,
  user_id_fk integer,
  col_order integer,
  hide character varying,
  "cellRenderer" character varying,
  "checkboxSelection" character varying,
  "rowDrag" character varying,
  "rowGroup" character varying,
  width integer,
  col_pinned character varying,
  "GridLayout_id_fk" character varying,
  grid_id character varying,
  std_prod_id_fk integer,
  "columnGroupShow" character varying,
  "headerName" character varying,
  factory_id_fk integer,
  filter character varying);
CREATE TABLE IF NOT EXISTS plm."GridLayout" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  field character varying,
  filter character varying,
  hide character varying,
  "cellRenderer" character varying,
  "checkboxSelection" character varying,
  "rowDrag" character varying,
  "rowGroup" character varying,
  width integer,
  "companyCode_name" character varying,
  "divisionCode_name" character varying,
  col_pinned character varying,
  col_order integer,
  user_id_fk integer,
  layout_name character varying,
  col_id character varying,
  grid_id character varying,
  "headerName" character varying,
  std_prod_id_fk integer,
  editable boolean,
  "cellEditor" character varying);
CREATE TABLE IF NOT EXISTS plm."GridViewState" (
  id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  user_id_fk integer,
  grid_id character varying(100) NOT NULL,
  view_name character varying(255) NOT NULL,
  column_state jsonb,
  filter_model jsonb,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  is_default boolean DEFAULT false NOT NULL);
CREATE TABLE IF NOT EXISTS plm."LicenseFeedBacks" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  phase character varying,
  status character varying,
  explanation character varying,
  duplicable boolean,
  "order" character varying,
  access character varying,
  item_order integer);
CREATE TABLE IF NOT EXISTS plm."LicensingTime" (
  id integer DEFAULT nextval('plm."LicensingTime_id_seq"'::regclass) NOT NULL,
  licensor_name character varying(100) NOT NULL,
  submission_days integer DEFAULT 0,
  resubmission_days integer DEFAULT 0,
  pps_approval_days integer DEFAULT 0,
  total_days integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL);
CREATE TABLE IF NOT EXISTS plm."LicensingTimes" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  linesheet_submission_time integer,
  linesheet_resubmission_time integer,
  submission_time integer,
  resubmission_time integer,
  pps_approval_time integer,
  licensor_id_fk integer);
CREATE TABLE IF NOT EXISTS plm."OrderLeadTime" (
  order_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  product_type_id_fk integer,
  licensor_id_fk integer,
  design_number integer,
  design_techpacking_time integer,
  licensing_time integer,
  sampling_time integer,
  mass_production_time integer,
  total_lead_time integer);
CREATE TABLE IF NOT EXISTS plm."ProdOrderDetail" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "CompanyCode" character varying,
  "DivisionCode" character varying,
  "CustomerCode" character varying,
  "ProdSeq" integer,
  "prodLineSeq" integer,
  "StageSeq" integer,
  "StageCode" character varying,
  "itemNo" character varying,
  "colorCode" character varying,
  "labelCode" character varying,
  "dimCode" character varying,
  "prepackCode" character varying,
  "sizeCode" character varying,
  "wipQty" integer,
  "CancelledQty" integer,
  "MovedQty" integer,
  "ProdCost" integer,
  "UOMCode" character varying,
  "ShipDate" date,
  "OrigShipDate" date,
  "DueDate" date,
  "OrigDueDate" date,
  "ShipCancelDate" date,
  "OrigShipCancelDate" date,
  "WarehouseCode" character varying,
  "ShipmentFkey" integer,
  "ContainerFkey" integer,
  "ReceiveFkey" integer,
  "prodQty" integer,
  "VendorCode" character varying,
  "createdTime" timestamp with time zone,
  "createdUser" character varying,
  "modTime" timestamp without time zone,
  "modUser" character varying,
  "ProdLineFkey" integer,
  "ContainerDtlFkey" integer,
  "RecvDtlFkey" integer,
  "SalesOrderFkey" integer,
  "SalesOrderNo" integer,
  "CostSheetFkey" integer,
  "BOMFKey" integer,
  "AllocatableWip" character varying,
  "ProdOrderCancelType" character varying,
  "UDF01" character varying,
  "VendorInvoiceFKey" integer,
  "EDI943Proc" character varying,
  "SizeExplosionCode" character varying,
  "CustPONumber" character varying,
  "prodOrderNo" character varying,
  "itemPkey" integer,
  "merchGroup05Desc" character varying,
  "itemDesc" character varying,
  pkey integer NOT NULL);
CREATE TABLE IF NOT EXISTS plm."ProdOrderHeader" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "prodOrderNo" character varying NOT NULL,
  "companyCode" character varying,
  "prodTypeCode" character varying,
  "seasonCode" character varying,
  "shipDate" character varying,
  "dueDate" character varying,
  "shipCancelDate" character varying,
  "origShipDate" character varying,
  "origDueDate" character varying,
  "origShipCancelDate" character varying,
  "prodOrderDate" character varying,
  "prodCountry" character varying,
  "freightForwarderCode" character varying,
  "currencyCode" character varying,
  "warehouseCode" character varying,
  "uDF01" character varying,
  "uDFDate01" character varying,
  "uDFDate02" character varying,
  lcno character varying,
  "vendorCode" character varying,
  "prodRevNo" character varying,
  "prodRevDate" character varying,
  "hangTagsOrdered" character varying,
  "hangTagOrderedDate" character varying,
  "hangTagReceived" character varying,
  "hangTagReceivedDate" character varying,
  "arrivalPortCode" character varying,
  "shipPortCode" character varying,
  "carrierCode" character varying,
  "payTermCode" character varying,
  "prodCostType" character varying,
  "salesOrderNo" character varying,
  "vendorProc" character varying,
  "vendorProcDate" character varying,
  "agentProc" character varying,
  "agentProcDate" character varying,
  "forwarderProc" character varying,
  "forwarderProcDate" character varying,
  "cutterCode" character varying,
  "sewerCode" character varying,
  "prodPrinterCode" character varying,
  "vendorConfirm" character varying,
  "vendorConfirmDate" character varying,
  "customerPONo" character varying,
  "exchangeRatePkey" character varying,
  printed character varying,
  "depositAmount" character varying,
  "depositPaid" character varying,
  "depositBalance" character varying,
  "depositDate" character varying,
  "prodReferenceNo" character varying,
  "discountPerc" character varying,
  "shipViaCode" character varying,
  "depositPosted" character varying,
  "aPTransactionNo" character varying,
  "postedDate" character varying,
  "massProductionDays" character varying,
  "ftySalesRep" character varying,
  "customerCode" character varying,
  comment character varying,
  "prodQty" double precision,
  dlvy_loc_fk integer,
  prod_cost character varying,
  mg5 character varying,
  cust_order_date character varying,
  sent_po_date character varying,
  vendor_start_date character varying,
  item_not_prepro_approved character varying,
  prepro_approval_date character varying,
  calculate_fob_delivery character varying,
  cal_arrival_date character varying,
  adjusted_cust_start_date character varying,
  cust_start character varying,
  cust_cxl character varying,
  price_ticket_needed boolean,
  ticket_order_date character varying,
  tickets_receive_date character varying,
  safety_test_needed boolean,
  safety_test_date character varying,
  safety_test_passed boolean,
  photo_needed boolean,
  photo_recived boolean,
  inspection_result character varying,
  inspection_comment character varying,
  svn character varying,
  cbm character varying,
  vendor_comment character varying,
  "containerNo" character varying,
  actual_etd character varying,
  "actual_Whse_eta" character varying,
  num_docs character varying,
  doc_qc boolean,
  doc_inv boolean,
  doc_pl boolean,
  doc_bl boolean,
  doc_fcr boolean,
  doc_ctpat boolean,
  doc_tsca boolean,
  doc_athome boolean,
  ok_to_pay_date character varying,
  conditions_not_met character varying,
  paid_date character varying,
  container_recvd character varying,
  sample_aprov_lead_days character varying,
  modtime timestamp without time zone,
  "createdTime" timestamp with time zone,
  "createdUser" character varying,
  "modUser" character varying,
  udfnum01 character varying,
  mass_prod_start_date date,
  packing_start_date date,
  inspection_start_date date,
  factory_committed_prod_start character varying(255),
  actual_prod_start character varying(255),
  actual_prod_complete character varying(255),
  material_arrival_date character varying(255),
  assembly_start_date character varying(255),
  qc_inspection_date character varying(255),
  sample_start_date character varying(255),
  buyer_approval_date date,
  ticket_tracking_number character varying(255),
  booking_number character varying(255),
  freight_forwarder_name character varying(255));
CREATE TABLE IF NOT EXISTS plm."ProdPaymentTerms" (
  id integer,
  "CompanyCode" character varying,
  "PayTermCode" character varying,
  "PayTermDesc" character varying,
  "PaymentTermType" character varying,
  "PaymentDueDays" character varying,
  "PaymentDiscDays" character varying,
  "PaymentCutOffDay" character varying,
  "PaymentFixedDueDay" character varying);
CREATE TABLE IF NOT EXISTS plm."ProdShipmentTransitTime" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "ArrivalPortCode" character varying,
  "ArrivalTransitTime" character varying,
  "CompanyCode" character varying,
  "ShipPortCode" character varying,
  "WarehouseCode" character varying,
  "WhseTransitTime" character varying);
CREATE TABLE IF NOT EXISTS plm."ProductNickname" (
  id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  nickname character varying(255) NOT NULL,
  material_id_fk integer,
  construction_id_fk integer,
  feature_id_fk integer,
  size_id_fk integer,
  licensor_id_fk integer,
  property_id_fk integer,
  sub_format_id_fk integer,
  art_source_id_fk integer,
  artist_id_fk integer,
  treatment_id_fk integer,
  group_id_fk integer,
  demographic_id_fk integer);
CREATE TABLE IF NOT EXISTS plm."RFQContainer" (
  "RFQContainer_id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "RFQContainer_price" double precision,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS plm."RFQGroup" (
  "RFQGroup_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "RFQGroup_name" character varying,
  "IsLegacy" boolean,
  data_added timestamp without time zone DEFAULT now(),
  user_id_fk integer,
  "HasDuplicates" boolean);
CREATE TABLE IF NOT EXISTS plm."RFQItem" (
  "rfqItem_id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "rfqItem_style_number" character varying(255),
  "rfqItem_notes" character varying(255),
  "rfqItem_depth" integer,
  "rfqItem_freight" character varying(255),
  "rfqItem_picture" character varying(255),
  "rfqItem_auditlog" character varying(255),
  "rfqItem_customer" integer,
  "rfqItem_dilution" character varying(255),
  "rfqItem_fob_cost" character varying(255),
  "rfqItem_quantity" character varying(255),
  "rfqItem_size_l_w" integer,
  "rfqItem_case_pack" character varying(255),
  "rfqItem_duty_rate" character varying(255),
  "rfqItem_tech_pack_link" character varying(255),
  "rfqItem_wholesale" character varying(255),
  "rfqItem_gen_fob_margin" character varying(255),
  "rfqItem_gen_ldp_margin" character varying(255),
  "rfqItem_gen_poe_margin" character varying(255),
  "rfqItem_comp_retail" character varying(255),
  "rfqItem_default_cbm" character varying(255),
  "rfqItem_description" character varying(255),
  "rfqItem_gen_fob_netsell" character varying(255),
  "rfqItem_gen_fob_royalty" character varying(255),
  "rfqItem_landed_cost" character varying(255),
  "rfqItem_gen_whse_netsell" character varying(255),
  "rfqItem_gen_whse_royalty" character varying(255),
  "rfqItem_gen_poe_netsell" character varying(255),
  "rfqItem_gen_poe_royalty" character varying(255),
  "rfqItem_created_date" timestamp with time zone,
  "rfqItem_date_modified" timestamp without time zone,
  "rfqItem_delivery_loc" integer,
  "rfqItem_picturethumb" character varying(255),
  "rfqItem_quote_update" character varying(255),
  "rfqItem_cbm_per_piece" character varying(255),
  "rfqItem_gen_fob_pricesale" character varying(255),
  "rfqItem_gen_fob_sellprice" character varying(255),
  "rfqItem_gen_whse_pricesale" character varying(255),
  "rfqItem_gen_whse_sellprice" character varying(255),
  "rfqItem_logistic_load" character varying(255),
  "rfqItem_gen_poe_pricesale" character varying(255),
  "rfqItem_gen_poe_sellprice" character varying(255),
  "rfqItem_price_per_cbm" character varying(255),
  "rfqItem_standardized_products" character varying(255),
  "rfqItem_gen_mddp_pricesale" character varying(255),
  "rfqItem_gen_mddp_sellprice" character varying(255),
  "rfqItem_gen_mddp_royalty" character varying(255),
  "rfqItem_warehouse" character varying(255),
  "rfqItem_active" integer,
  "rfqItem_archive" integer,
  "rfqItem_rfq_group" integer,
  "rfqItem_step" integer,
  "rfqItem_cbm_per_price" character varying,
  "rfqItem_agent" character varying,
  "rfqItem_udf1" integer,
  "rfqItem_udf2" integer,
  "rfqItem_udf3" integer,
  "rfqItem_udf4" integer,
  "rfqItem_gen_mddp_netsell" character varying,
  "rfqItem_gen_mddp_margin" character varying,
  "rfqItem_lic_mddp_pricesale" character varying,
  "rfqItem_lic_mddp_sellprice" character varying,
  "rfqItem_lic_mddp_royalty" character varying,
  "rfqItem_lic_mddp_netsell" character varying,
  "rfqItem_lic_mddp_margin" character varying,
  "rfqItem_lic_poe_pricesale" character varying,
  "rfqItem_lic_poe_sellprice" character varying,
  "rfqItem_lic_poe_royalty" character varying,
  "rfqItem_lic_poe_netsell" character varying,
  "rfqItem_lic_poe_margin" character varying,
  "rfqItem_lic_fob_pricesale" character varying,
  "rfqItem_lic_fob_sellprice" character varying,
  "rfqItem_lic_fob_royalty" character varying,
  "rfqItem_lic_fob_netsell" character varying,
  "rfqItem_lic_fob_margin" character varying,
  "rfqItem_lic_whse_pricesale" character varying,
  "rfqItem_lic_whse_sellprice" character varying,
  "rfqItem_lic_whse_royalty" character varying,
  "rfqItem_lic_whse_netsell" character varying,
  "rfqItem_lic_whse_margin" character varying,
  "rfqItem_gen_whse_margin" character varying,
  "rfqItem_license" character varying,
  "rfqItem_royalty" double precision,
  "rfqItem_gen_fob_entered_sell_price" double precision,
  "rfqItem_gen_mddp_entered_sell_price" double precision,
  "rfqItem_gen_poe_entered_sell_price" double precision,
  "rfqItem_gen_whse_entered_sell_price" double precision,
  "rfqItem_lic_fob_entered_sell_price" double precision,
  "rfqItem_lic_mddp_entered_sell_price" double precision,
  "rfqItem_lic_poe_entered_sell_price" double precision,
  "rfqItem_lic_whse_entered_sell_price" double precision,
  "rfqItem_gen_fob_entered_margin" double precision,
  "rfqItem_gen_mddp_entered_margin" double precision,
  "rfqItem_gen_poe_entered_margin" double precision,
  "rfqItem_gen_whse_entered_margin" double precision,
  "rfqItem_lic_fob_entered_margin" double precision,
  "rfqItem_lic_poe_entered_margin" double precision,
  "rfqItem_lic_mddp_entered_margin" double precision,
  "rfqItem_lic_whse_entered_margin" double precision,
  "rfqItem_divCode_id_fk" character varying,
  "rfqItem_duty_rate_dollar_amount" character varying,
  "rfqItem_choosen_vendor" integer,
  "rfqItem_adam_fix" character varying,
  rfq_container_id_fk integer,
  "rfqItem_container_price" double precision,
  "rfqItem_copied_from_id" integer,
  "rfqItem_is_landed_cost_manual" boolean DEFAULT false NOT NULL,
  "rfqItem_requested_price_cells" text,
  "rfqItem_factories_step_at" timestamp without time zone,
  "rfqItem_copied_by" integer,
  "rfqItem_copied_on" timestamp with time zone,
  "rfqItem_duty_rate_equation" character varying(500),
  "rfqItem_price_sales_snapshots" text,
  "rfqItem_source_item_id" integer,
  "rfqItem_source_item_num" character varying(255));
CREATE TABLE IF NOT EXISTS plm."RFQItemDivision" (
  "RFQItemDivision_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "RFQItem_id_fk" integer,
  "divisionCode_id_fk" integer);
CREATE TABLE IF NOT EXISTS plm."RFQItemStatus" (
  "RFQItemStatus_id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "RFQItemStatus_code" character varying(255),
  "RFQItemStatus_title" character varying(255),
  "RFQItemStatus_status" character varying(255),
  "RFQItemStatus_auditlog" character varying(255),
  "RFQItemStatus_airbyte_emitted_at" timestamp with time zone,
  "RFQItemStatus_airbyte_productions_hashid" text);
CREATE TABLE IF NOT EXISTS plm."RFQStep" (
  "RFQStep_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "RFQStep_title" character varying,
  "RFQStep_status" character varying,
  "RFQStep_access_level" character varying,
  "RFQStep_notified_user_level" character varying);
CREATE TABLE IF NOT EXISTS plm."RFQVendor" (
  "RFQVendor_id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "RFQVendor_amount" character varying(255),
  "RFQVendor_cbm_pc" character varying(255),
  "RFQVendor_status" character varying(255),
  "RFQitem_id_fk" integer,
  "RFQVendor_note" character varying,
  carton_width double precision,
  carton_height double precision,
  carton_length double precision,
  req_status integer,
  vendor_id_fk integer,
  quote_date date,
  std_vendor_id_fk character varying,
  "RFQVendor_suggested_note" character varying,
  "RFQVendor_suggested_amount" character varying(255),
  "RFQVendor_suggested_cbm_pc" character varying(255),
  suggested_carton_height double precision,
  suggested_carton_width double precision,
  suggested_carton_length double precision,
  lead_time integer,
  price_terms character varying(255),
  fob_country character varying(255),
  fob_port character varying(255),
  requote_requested boolean DEFAULT false,
  "RFQVendor_archive_optout" boolean DEFAULT false,
  "RFQVendor_archived" boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS plm."RFQWhse" (
  "RFQWhse_id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "RFQWhse_price" double precision);
CREATE TABLE IF NOT EXISTS plm."SeasonCode" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "seasonCode" character varying,
  "seasonDesc" character varying,
  active character varying,
  "shipStartDate" character varying,
  "shipEndDate" character varying,
  "startDate" character varying,
  "endDate" character varying,
  "companyCode" character varying,
  "divisionCode" character varying,
  "modTime" character varying,
  "modUser" character varying,
  "createdUser" character varying,
  "createdTime" character varying);
CREATE TABLE IF NOT EXISTS plm."ShippingPort" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "PortCode" character varying,
  "PortDesc" character varying,
  "CountryCode" character varying,
  "UNLcode" character varying);
CREATE TABLE IF NOT EXISTS plm."StandardizedDetail" (
  id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  std_v_id_fk integer,
  std_size_id_fk integer,
  std_prod_id_fk integer);
CREATE TABLE IF NOT EXISTS plm."StandardizedGroup" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  title character varying,
  customer_id_fk integer,
  std_prod_id_fk integer,
  depth_id_fk integer,
  "casePack" character varying,
  qty character varying);
CREATE TABLE IF NOT EXISTS plm."StandardizedProductElement" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  title character varying,
  std_prod_id_fk integer,
  type character varying);
CREATE TABLE IF NOT EXISTS plm."StandardizedProductElementValue" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  value character varying,
  std_prod_el_id_fk integer,
  std_prod_id_fk integer);
CREATE TABLE IF NOT EXISTS plm."StandardizedProductType" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  prod_name character varying,
  prod_status character varying,
  prod_img_thumbnail character varying,
  prod_img_fullsize character varying,
  material_id_fk integer,
  construction_id_fk integer);
CREATE TABLE IF NOT EXISTS plm."StandardizedSize" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  size_in_id_fk integer,
  size_cm_id_fk integer,
  std_group_id_fk integer,
  std_prod_id_fk integer,
  status character varying);
CREATE TABLE IF NOT EXISTS plm."StandardizedVendor" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  price double precision,
  std_item_id_fk integer,
  factory_id_fk integer,
  std_prod_id_fk integer,
  "pKey" character varying NOT NULL,
  highlighted character varying,
  width character varying,
  length character varying,
  height character varying,
  quote_date date);
CREATE TABLE IF NOT EXISTS plm."StandardizedVersion" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  title character varying,
  std_prod_id_fk integer,
  treatment_id_fk integer);
CREATE TABLE IF NOT EXISTS plm."UDFComponent" (
  "UDFComponent_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "UDFComponent_name" character varying(100) NOT NULL);
CREATE TABLE IF NOT EXISTS plm."UDFElement" (
  "UDFElement_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "UDFElement_display_name" character varying NOT NULL,
  "UDFElement_layer" integer NOT NULL,
  "UDFElement_visibility" character varying(1) NOT NULL,
  "UDFElement_width" character varying(10) NOT NULL,
  "UDFElement_height" character varying(10) NOT NULL,
  "UDFElement_data_key" character varying(50) NOT NULL,
  "UDFGroup_id_fk" integer NOT NULL,
  "UDFElement_component_id_fk" integer NOT NULL,
  "UDFElement_type_id_fk" integer NOT NULL,
  "UDFElement_table_id_fk" integer NOT NULL);
CREATE TABLE IF NOT EXISTS plm."UDFElementType" (
  "UDFElementType_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "UDFElementType_name" character varying(50) NOT NULL);
CREATE TABLE IF NOT EXISTS plm."UDFGroup" (
  "UDFGroup_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "UDFGroup_name" character varying(50) NOT NULL,
  "UDFGroup_layer" character varying(50) NOT NULL);
CREATE TABLE IF NOT EXISTS plm."UDFQuery" (
  "UDFQuery_id" integer NOT NULL,
  "UDFQuery_column_name" character varying NOT NULL,
  "UDFQuery_condition" character varying NOT NULL);
CREATE TABLE IF NOT EXISTS plm."UDFTable" (
  "UDFTable_id" integer NOT NULL,
  "UDFTable_name" character varying(50) NOT NULL,
  "UDFTable_primary_id" character varying NOT NULL,
  "UDFElement_id_fk" integer NOT NULL,
  "UDFTable_associate_type" character varying(50) NOT NULL,
  "UDFComponent_id_fk" integer NOT NULL,
  "UDFTable_foreignKey" character varying(100) NOT NULL,
  "UDFTable_targetKey" character varying(100) NOT NULL,
  "UDFTable_query_id_fk" integer,
  container_id character varying,
  nickname character varying);
CREATE TABLE IF NOT EXISTS plm.art_piece_attachment (
  id integer DEFAULT nextval('plm.art_piece_attachment_id_seq'::regclass) NOT NULL,
  uuid uuid NOT NULL,
  type character varying(100),
  display_type character varying(50),
  primary_image boolean DEFAULT true NOT NULL,
  link character varying(255),
  file_name character varying(255),
  company_code integer NOT NULL,
  divisioncode_id integer NOT NULL,
  art_piece_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  created_by integer NOT NULL,
  updated_at timestamp with time zone,
  updated_by integer,
  is_active boolean DEFAULT true NOT NULL);
CREATE TABLE IF NOT EXISTS plm."companyCode" (
  "comCode_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "compCode_cl_id" character varying NOT NULL,
  company_name character varying(100) NOT NULL);
CREATE TABLE IF NOT EXISTS plm."deliveryLocation" (
  "deliveryLocation_id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "deliveryLocation_code" character varying(255),
  "deliveryLocation_title" character varying(255),
  "deliveryLocation_status" character varying(255),
  "deliveryLocation_auditlog" character varying(255),
  "deliveryLocation_airbyte_emitted_at" timestamp with time zone,
  "deliveryLocation_airbyte_deliverys_hashid" text);
CREATE TABLE IF NOT EXISTS plm."divisionCode" (
  "divCode_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "divCode_code" character varying NOT NULL,
  division_name character varying(50) NOT NULL,
  company_name_fk character varying,
  external_divisoncode character varying,
  is_divcode_active boolean);
CREATE TABLE IF NOT EXISTS plm."externalApi" (
  "externalApi_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "externalApi_method" character varying(50) NOT NULL,
  "externalApi_hostname" character varying NOT NULL,
  "externalApi_company_id" character varying(50) NOT NULL,
  "externalApi_path" character varying,
  "externalApi_port" integer);
CREATE TABLE IF NOT EXISTS plm.grid_cell_notes (
  id uuid NOT NULL,
  grid_type character varying(50) NOT NULL,
  row_id character varying(255) NOT NULL,
  col_id character varying(255) NOT NULL,
  note_text text,
  note_author character varying(255),
  note_read_only boolean DEFAULT false NOT NULL,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL);
CREATE TABLE IF NOT EXISTS plm.groups (
  id integer DEFAULT nextval('plm.groups_id_seq'::regclass) NOT NULL,
  name character varying(255) NOT NULL,
  member_user_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  teams_chat_id character varying(255),
  teams_conversation_id character varying(255),
  teams_service_url character varying(500),
  teams_app_installed_at timestamp with time zone,
  teams_members_hash character varying(64),
  teams_sync_status character varying(50),
  teams_sync_error text,
  teams_conversation_reference jsonb);
CREATE TABLE IF NOT EXISTS plm."itemAttachment" (
  item_attachment_id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  attachment_type character varying(50) NOT NULL,
  attachment_display_name character varying NOT NULL,
  attachment_link character varying NOT NULL,
  item_num_id_fk integer NOT NULL,
  "item_attachment_createdTime" character varying,
  "item_attachment_createdUser" character varying,
  "item_attachment_modTime" character varying,
  "item_attachment_modUser" character varying,
  "item_attachment_fileName" character varying,
  "companyCode_name" character varying,
  "divisionCode_name" character varying(100),
  "item_attachment_colorCode" character varying(100),
  "item_attachment_resourceId" integer,
  comment_id integer,
  uuid uuid,
  primary_image boolean DEFAULT false,
  licensing_attachment boolean,
  licensing_feedback_id_fk integer,
  license_status character varying,
  dsn_ref_num character varying(50));
CREATE TABLE IF NOT EXISTS plm."itemDepth" (
  "itemDepth_id" integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  "itemDepth_code" character varying,
  "itemDepth_title" character varying,
  "itemDepth_status" character varying,
  "itemDepth_auditlog" character varying,
  "itemDepth_airbyte_emitted_at" timestamp with time zone,
  "itemDepth_airbyte_depths_hashid" text);
CREATE TABLE IF NOT EXISTS plm."itemDetail" (
  item_pk integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  label_code_fk character varying,
  dim_code_fk character varying,
  prepack_code_fk character varying,
  size_code_fk character varying,
  "UPC" character varying,
  "EAN" character varying,
  "GTIN" character varying,
  item_status_hed character varying,
  uom_code_hed_fk character varying,
  retail_pric_hed numeric,
  item_cost_hed_ext numeric,
  udf_merchgroup01 character varying,
  udf_merchgroup02 character varying,
  udf_merchgroup03 character varying,
  udf_merchgroup04 character varying,
  udf_merchgroup05 character varying,
  udf_merchgroup06 character varying,
  udf_merchgroup07 character varying,
  udf_merchgroup08 character varying,
  udf_merchgroup09 character varying,
  udf_merchgroup10 character varying,
  udf_merchgroup11 character varying,
  udf_merchgroup12 character varying,
  udf_merchgroup13 character varying,
  udf_merchgroup14 character varying,
  udf_merchgroup15 character varying,
  udf_merchgroup16 character varying,
  udf_merchgroup17 character varying,
  udf_merchgroup18 character varying,
  udf_merchgroup19 character varying,
  udf_merchgroup20 character varying,
  udf_merchgroup21 character varying,
  udf_merchgroup22 character varying,
  udf_merchgroup23 character varying,
  udf_merchgroup24 character varying,
  udf_merchgroup25 character varying,
  udf_freeform_01 character varying(50),
  udf_freeform_02 character varying(50),
  udf_freeform_03 character varying(50),
  udf_freeform_04 character varying(50),
  udf_freeform_05 character varying(50),
  udf_freeform_06 character varying(50),
  udf_freeform_07 character varying(50),
  udf_freeform_08 character varying(50),
  udf_freeform_09 character varying(50),
  udf_freeform_10 character varying(50),
  udf_freeform_11 character varying(50),
  udf_freeform_12 character varying(50),
  udf_freeform_13 character varying(50),
  udf_freeform_14 character varying(50),
  udf_freeform_15 character varying(50),
  udf_freeform_16 character varying(50),
  udf_freeform_17 character varying(50),
  udf_freeform_18 character varying(50),
  udf_freeform_19 character varying(50),
  udf_freeform_20 character varying(50),
  udf_date01 timestamp without time zone,
  udf_date02 timestamp without time zone,
  udf_date03 timestamp without time zone,
  udf_date04 timestamp without time zone,
  udf_date05 timestamp without time zone,
  udf_date06 timestamp without time zone,
  udf_date07 timestamp without time zone,
  udf_date08 timestamp without time zone,
  udf_date09 timestamp without time zone,
  udf_date10 timestamp without time zone,
  udf_date11 timestamp without time zone,
  udf_date12 timestamp without time zone,
  udf_date13 timestamp without time zone,
  udf_date14 timestamp without time zone,
  udf_date15 timestamp without time zone,
  udf_date16 timestamp without time zone,
  udf_date17 timestamp without time zone,
  udf_date18 timestamp without time zone,
  udf_date19 timestamp without time zone,
  udf_date20 timestamp without time zone,
  hts_num_hed_ext_fk character varying,
  item_length_size_hed numeric,
  item_width_size_hed numeric,
  item_depth_size_hed numeric,
  item_weight_size_hed numeric,
  uom_size_fk_hed character varying,
  uom_weight_fk_hed character varying,
  innerpk_qty_hed integer,
  created_user_fk character varying,
  created_timedate timestamp without time zone,
  mod_timedate timestamp without time zone,
  mod_user_fk character varying,
  royalty_code_fk character varying,
  "udf_item_priceA" numeric,
  "udf_item_priceB" numeric,
  "udf_item_priceC" numeric,
  "udf_item_priceD" numeric,
  "udf_item_priceE" numeric,
  "udf_item_priceF" numeric,
  "udf_item_priceG" numeric,
  "udf_item_priceH" numeric,
  carton_qty integer,
  base_qty_hed integer,
  color_code_fk character varying,
  size_seq integer,
  "GenerateUPC" character varying,
  size_allowed_hed character varying,
  "share_UPC" character varying,
  vendor_code_hed_fk character varying,
  selling_price_hed numeric,
  item_content_hed character varying,
  reserved_qty integer,
  pack_type_hed character varying,
  udf_int01 integer,
  udf_int02 integer,
  udf_int03 integer,
  udf_int04 integer,
  udf_int05 integer,
  udf_int06 integer,
  udf_int07 integer,
  udf_int08 integer,
  udf_int09 integer,
  udf_int10 integer,
  udf_num01 numeric,
  udf_num02 numeric,
  udf_num03 numeric,
  udf_num04 numeric,
  udf_num05 numeric,
  udf_num06 numeric,
  udf_num07 numeric,
  udf_num08 numeric,
  udf_num09 numeric,
  udf_num10 numeric,
  non_inv_item character varying,
  udf_yesno01 character varying,
  udf_yesno02 character varying,
  udf_yesno03 character varying,
  udf_yesno04 character varying,
  udf_yesno05 character varying,
  udf_yesno06 character varying,
  udf_yesno07 character varying,
  udf_yesno08 character varying,
  udf_yesno09 character varying,
  udf_yesno10 character varying,
  udf_yesno11 character varying,
  udf_yesno12 character varying,
  udf_yesno13 character varying,
  udf_yesno14 character varying,
  udf_yesno15 character varying,
  carton_packtype_fk character varying,
  carton_code_ext character varying,
  carton_length_size_hed numeric,
  carton_width_size_hed numeric,
  carton_depth_size_hed numeric,
  carton_weight_size_hed numeric,
  "NMFC_code_hed" character varying,
  compare_price_hed numeric,
  whse_sku_id character varying,
  item_cbm_size numeric,
  season_code_hed character varying,
  size_explo_code_hed_ext character varying,
  ds_cat character varying,
  item_active_status character varying,
  item_avail_status character varying,
  discont_status character varying,
  upc_created_timedate timestamp without time zone,
  salesperson_fk character varying);
CREATE TABLE IF NOT EXISTS plm."itemHeader" (
  item_id_pk integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_user_fk character varying(20),
  created_time_date timestamp without time zone,
  item_active_status character varying(1),
  discont_status character varying(1),
  mod_time_date timestamp without time zone,
  mod_user_fk character varying(20),
  dsn_ref_num character varying(200),
  item_descr_name character varying(100),
  item_displ_descr_name character varying(40),
  item_length_size numeric,
  item_width_size numeric,
  item_depth_size character varying(50),
  item_weight_size numeric,
  uom_size_fk character varying(8),
  uom_weight_fk character varying(8),
  item_note character varying,
  item_content character varying(20),
  item_avail_status character varying(1),
  item_cbm_size numeric,
  "udf_item_priceA" numeric,
  "udf_item_priceB" numeric,
  "udf_item_priceC" numeric,
  "udf_item_priceD" numeric,
  "udf_item_priceE" numeric,
  "udf_item_priceF" numeric,
  "udf_item_priceG" numeric,
  "udf_item_priceH" numeric,
  item_cost_ext numeric,
  hts_num_ext_fk character varying(16),
  hts2_num_ext_fk character varying(16),
  innerpack_qty integer,
  giftwrap character varying(1),
  base_qty integer,
  carton_length_size numeric,
  carton_width_size numeric,
  carton_depth_size numeric,
  carton_weight_size numeric,
  carton_code_ext character varying(10),
  carton_packtype_fk character varying(20),
  carton_qty integer,
  "AllowedSizes_ext" character varying,
  udf_merchgroup01 character varying(20),
  udf_merchgroup02 character varying(20),
  udf_merchgroup03 character varying(20),
  udf_merchgroup04 character varying(20),
  udf_merchgroup05_fk character varying(20),
  udf_merchgroup06_fk character varying(20),
  udf_merchgroup07_fk character varying(20),
  udf_merchgroup08_fk character varying(100),
  udf_merchgroup09_fk character varying(100),
  udf_merchgroup10_fk character varying(100),
  udf_merchgroup11_fk character varying(20),
  udf_merchgroup12_fk character varying(20),
  udf_merchgroup13_fk character varying(20),
  udf_merchgroup14_fk character varying(20),
  udf_merchgroup15_fk character varying(20),
  udf_merchgroup16_fk character varying(20),
  udf_merchgroup17_fk character varying(20),
  udf_merchgroup18_fk character varying(20),
  udf_merchgroup19_fk character varying(20),
  udf_merchgroup20_fk character varying(20),
  udf_merchgroup21_fk character varying(20),
  udf_merchgroup22_fk character varying(20),
  udf_merchgroup23_fk character varying(20),
  udf_merchgroup24_fk character varying(20),
  udf_merchgroup25_fk character varying(20),
  origin_country_fk character varying(4),
  season_code_fk character varying(20),
  pack_type character varying(20),
  retail_price numeric,
  selling_price numeric,
  mfg_lead_time integer,
  size_explo_code_ext character varying(20),
  size_range_code_ext character varying(20),
  udf_freeform_01 character varying(50),
  udf_freeform_02 character varying(50),
  udf_freeform_03 character varying(50),
  udf_freeform_04 character varying(50),
  udf_freeform_05 character varying(50),
  udf_freeform_06 character varying(50),
  udf_freeform_07 character varying(50),
  udf_freeform_08 character varying(50),
  udf_freeform_09 character varying(50),
  udf_freeform_10 character varying(50),
  udf_freeform_11 character varying(50),
  udf_freeform_12 character varying(50),
  udf_freeform_13 character varying(50),
  udf_freeform_14 character varying(50),
  udf_freeform_15 character varying(50),
  udf_freeform_16 character varying(50),
  udf_freeform_17 character varying(50),
  udf_freeform_18 character varying(50),
  udf_freeform_19 character varying(50),
  udf_freeform_20 character varying(50),
  udf_date01 timestamp without time zone,
  udf_date02 timestamp without time zone,
  udf_date03 timestamp without time zone,
  udf_date04 timestamp without time zone,
  udf_date05 timestamp without time zone,
  udf_date06 timestamp without time zone,
  udf_date07 timestamp without time zone,
  udf_date08 timestamp without time zone,
  udf_date09 timestamp without time zone,
  udf_date10 timestamp without time zone,
  udf_date11 timestamp without time zone,
  udf_date12 timestamp without time zone,
  udf_date13 timestamp without time zone,
  udf_date14 timestamp without time zone,
  udf_date15 timestamp without time zone,
  udf_date16 timestamp without time zone,
  udf_date17 timestamp without time zone,
  udf_date18 timestamp without time zone,
  udf_date19 timestamp without time zone,
  udf_date20 timestamp without time zone,
  udf_int01 integer,
  udf_int02 integer,
  udf_int03 integer,
  udf_int04 integer,
  udf_int05 integer,
  udf_int06 integer,
  udf_int07 integer,
  udf_int08 integer,
  udf_int09 integer,
  udf_int10 integer,
  udf_num01 numeric,
  udf_num02 numeric,
  udf_num03 numeric,
  udf_num04 numeric,
  udf_num05 numeric,
  udf_num06 numeric,
  udf_num07 numeric,
  udf_num08 numeric,
  udf_num09 numeric,
  udf_num10 numeric,
  non_inv_item character varying(1),
  udf_yesno01 character varying(1),
  udf_yesno02 character varying(1),
  udf_yesno03 character varying(1),
  udf_yesno04 character varying(1),
  udf_yesno05 character varying(1),
  udf_yesno06 character varying(1),
  udf_yesno07 character varying(1),
  udf_yesno08 character varying(1),
  udf_yesno09 character varying(1),
  udf_yesno10 character varying(1),
  udf_yesno11 character varying(1),
  udf_yesno12 character varying(1),
  udf_yesno13 character varying(1),
  udf_yesno14 character varying(1),
  udf_yesno15 character varying(1),
  uom_code character varying(8),
  vendor_code_fk character varying(8),
  old_item_num character varying(20),
  "OH_min_qty" integer,
  ds_cat character varying(20),
  compare_price numeric,
  costcomp1 numeric,
  costcomp2 numeric,
  costcomp3 numeric,
  costcomp4 numeric,
  costcomp5 numeric,
  comm_code_ext character varying(10),
  royalty_code_fk character varying(20),
  royalty2_code_fk character varying(20),
  salesper_code_fk character varying(20),
  salesper2_code_fk character varying(20),
  product_manager_fk character varying(20),
  item_num_id character varying(100),
  compan_code_fk integer,
  div_code_fk integer,
  lic_comment character varying,
  lic_compnay character varying,
  lic_sample_no character varying,
  lic_item_desc character varying,
  lic_licensorcode character varying,
  lic_concept_submiteed character varying,
  lic_concept_submitted_date character varying,
  lic_concept_approved character varying,
  lic_concept_approved_date character varying,
  lic_sample_requested character varying,
  lic_sample_requested_date character varying,
  lic_sample_made character varying,
  lic_sample_made_date character varying,
  lic_vendor_sent character varying,
  lic_vendor_sent_date character varying,
  lic_office_received character varying,
  lic_office_received_date character varying,
  lic_office_sent character varying,
  lic_office_sent_date character varying,
  lic_dev_received character varying,
  lic_dev_sample_recv_date character varying,
  lic_dev_sample_sent character varying,
  lic_dev_sample_sent_date character varying,
  lic_prepo_approved character varying,
  lic_prepo_approved_date character varying,
  lic_prepo_rejected character varying,
  lic_prepo_rejected_date character varying,
  lic_brand_assurance_number character varying,
  lic_order_placed character varying,
  lic_order_placed_date character varying,
  lic_concept_rejected character varying,
  lic_concept_rejected_date character varying,
  udfnum01 character varying,
  ref_num character varying,
  productmanager character varying,
  compan_code character varying,
  div_code character varying,
  is_item_active boolean,
  is_item_old boolean,
  udf_merchgroup01_id integer,
  udf_merchgroup02_id integer,
  udf_merchgroup03_id integer,
  udf_merchgroup04_id integer,
  udf_merchgroup05_fk_id integer,
  udf_merchgroup06_fk_id integer,
  udf_merchgroup07_fk_id integer,
  udf_merchgroup08_fk_id integer,
  udf_merchgroup09_fk_id integer,
  udf_merchgroup10_fk_id integer,
  season_code_fk_id integer,
  udf_merchgroup15_fk_id integer,
  tags character varying(500),
  art_piece_id integer,
  lic_tracking_updated_date timestamp with time zone,
  due_date timestamp with time zone,
  item_type_id_fk integer,
  sample_start_date character varying(255));
CREATE TABLE IF NOT EXISTS plm."itemLicenseImage" (
  id integer GENERATED ALWAYS AS IDENTITY NOT NULL,
  itemheader_id_fk integer NOT NULL,
  phase character varying,
  image_link character varying NOT NULL,
  thumb_link character varying,
  created_user character varying,
  created_time timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS plm."itemSize" (
  "itemSize_id" integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "itemSize_code" character varying(255),
  "itemSize_title" character varying(255),
  "itemSize_status" character varying(255),
  "itemSize_auditlog" character varying(255),
  "itemSize_airbyte_emitted_at" timestamp with time zone,
  "itemSize_airbyte_sizes_hashid" text,
  "itemSize_unit" character varying);
CREATE TABLE IF NOT EXISTS plm."itemType" (
  item_type_id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  item_type_name character varying(100) NOT NULL,
  item_type_description text NOT NULL,
  item_type_img_thumbnail character varying(255) NOT NULL,
  item_type_img_fullsize character varying(255) NOT NULL,
  item_type_status character varying(16) DEFAULT 'ACTIVE'::character varying NOT NULL,
  created_user_fk character varying(20),
  created_time_date timestamp with time zone,
  mod_user_fk character varying(20),
  mod_time_date timestamp with time zone);
CREATE TABLE IF NOT EXISTS plm.item_character_associations (
  id integer DEFAULT nextval('plm.item_character_associations_id_seq'::regclass) NOT NULL,
  item_header_id integer NOT NULL,
  character_id integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS plm.item_prod_order_detail_associations (
  id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  item_header_id integer NOT NULL,
  prod_order_detail_pkey integer NOT NULL,
  matched_item_number character varying(100) NOT NULL,
  master_quantity numeric,
  match_source character varying(50) DEFAULT 'item_number'::character varying NOT NULL,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL);
CREATE TABLE IF NOT EXISTS plm."licensingFeedbackReply" (
  id integer DEFAULT nextval('plm."licensingFeedbackReply_id_seq"'::regclass) NOT NULL,
  licensing_status_id_fk integer NOT NULL,
  comment text NOT NULL,
  created_by integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  tagged_user_ids jsonb DEFAULT '[]'::jsonb,
  attachments jsonb DEFAULT '[]'::jsonb);
CREATE TABLE IF NOT EXISTS plm."licensingMilestone" (
  id integer DEFAULT nextval('plm."licensingMilestone_id_seq"'::regclass) NOT NULL,
  itemheader_id_fk integer NOT NULL,
  stage character varying(50) NOT NULL,
  milestone_date timestamp without time zone NOT NULL,
  checked_by_user_id integer,
  checked_by_name character varying(255),
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS plm."licensingStatus" (
  id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  date character varying,
  feedback character varying,
  package boolean,
  status character varying,
  "from" character varying,
  moduser character varying,
  itemheader_id_fk integer,
  attachments jsonb,
  assignor_id integer,
  assignee_id integer,
  tagged_group_id integer,
  pop_comments text,
  assignee_ids jsonb DEFAULT '[]'::jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS plm."productUserAssignment" (
  id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  item_id_fk integer NOT NULL,
  role character varying(50) NOT NULL,
  user_id_fk integer NOT NULL,
  created_by_fk integer,
  created_date timestamp with time zone NOT NULL,
  updated_by_fk integer,
  updated_date timestamp with time zone NOT NULL);
CREATE TABLE IF NOT EXISTS plm.sample (
  sample_id_pk integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  origin character varying(20) NOT NULL,
  direction character varying(10) NOT NULL,
  sample_name character varying(255),
  quantity integer,
  retail_price numeric(12,2),
  fob_cost numeric(12,2),
  customer_id_fk integer,
  courier character varying(20),
  tracking_number character varying(255),
  factory_id_fk integer,
  item_id_fk integer,
  prod_order_no_fk character varying(255),
  factory_group_id_fk integer,
  box_id_fk integer,
  status character varying(40) NOT NULL,
  office_location character varying(20),
  next_stop character varying(50),
  final_destination character varying(50),
  notes text,
  "sample_createdTime" character varying(255),
  "sample_createdUser" character varying(255),
  "sample_modTime" character varying(255),
  "sample_modUser" character varying(255));
CREATE TABLE IF NOT EXISTS plm.sample_attachment (
  sample_attachment_id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  attachment_type character varying(50) NOT NULL,
  attachment_display_name character varying(255),
  attachment_link character varying(255) NOT NULL,
  sample_id_fk integer NOT NULL,
  primary_image boolean DEFAULT false,
  uuid uuid,
  "sample_attachment_fileName" character varying(255),
  "sample_attachment_createdTime" character varying(255),
  "sample_attachment_createdUser" character varying(255),
  "sample_attachment_modTime" character varying(255),
  "sample_attachment_modUser" character varying(255));
CREATE TABLE IF NOT EXISTS plm.sample_box (
  box_id_pk integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  box_label character varying(255),
  direction character varying(10),
  status character varying(40),
  origin_office character varying(20),
  dest_office character varying(20),
  final_destination character varying(50),
  tracking_number character varying(255),
  shipped_date timestamp with time zone,
  notes text,
  "box_createdTime" character varying(255),
  "box_createdUser" character varying(255),
  "box_modTime" character varying(255),
  "box_modUser" character varying(255));
CREATE TABLE IF NOT EXISTS plm.sample_comments (
  id integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  comment text NOT NULL,
  sample_id_fk integer NOT NULL,
  user_id integer NOT NULL,
  parent_id integer,
  inserted_date timestamp with time zone NOT NULL);
CREATE TABLE IF NOT EXISTS plm.sample_event (
  event_id_pk integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  sample_id_fk integer,
  box_id_fk integer,
  factory_group_id_fk integer,
  event_type character varying(30) NOT NULL,
  from_status character varying(40),
  to_status character varying(40),
  office_location character varying(20),
  event_user_id_fk integer,
  event_user character varying(255),
  event_time timestamp with time zone NOT NULL,
  notes text);
CREATE TABLE IF NOT EXISTS plm.sample_factory_group (
  factory_group_id_pk integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  group_name character varying(255),
  factory_id_fk integer,
  origin character varying(20),
  direction character varying(10),
  status character varying(40),
  office_location character varying(20),
  notes text,
  "group_createdTime" character varying(255),
  "group_createdUser" character varying(255),
  "group_modTime" character varying(255),
  "group_modUser" character varying(255));
CREATE TABLE IF NOT EXISTS plm.sample_shipment_item (
  shipment_item_id_pk integer GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  sample_id_fk integer NOT NULL,
  box_id_fk integer,
  factory_group_id_fk integer,
  leg_type character varying(20),
  added_date timestamp with time zone,
  added_user character varying(255));
CREATE TABLE IF NOT EXISTS public.admin_config (
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid);
CREATE TABLE IF NOT EXISTS public.agent_pairings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  pairing_code text NOT NULL,
  agent_type text NOT NULL,
  agent_name text DEFAULT ''::text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  consumed_by_agent_id uuid,
  agent_registration_id uuid);
CREATE TABLE IF NOT EXISTS public.agent_registrations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  agent_name text NOT NULL,
  agent_type text DEFAULT 'bridge'::text NOT NULL,
  agent_key_hash text NOT NULL,
  last_heartbeat timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.ai_sentinel_cleanup_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  ai_asset_id uuid NOT NULL,
  ai_filename text NOT NULL,
  ai_relative_path text NOT NULL,
  replacement_asset_id uuid,
  replacement_filename text,
  replacement_relative_path text,
  replacement_had_thumbnail boolean,
  replacement_queued_for_thumbnail boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.app_access (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  app app_name NOT NULL,
  granted_at timestamp with time zone DEFAULT now() NOT NULL,
  granted_by uuid);
CREATE TABLE IF NOT EXISTS public.asset_characters (
  asset_id uuid NOT NULL,
  character_id uuid NOT NULL);
CREATE TABLE IF NOT EXISTS public.asset_checkouts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  asset_id uuid NOT NULL,
  user_id uuid NOT NULL,
  device_id uuid,
  status checkout_status DEFAULT 'active'::checkout_status NOT NULL,
  checked_out_at timestamp with time zone DEFAULT now() NOT NULL,
  checked_in_at timestamp with time zone,
  source_hash text NOT NULL,
  source_size bigint NOT NULL,
  checkin_hash text,
  checkin_size bigint,
  upload_method text,
  synology_upload_user text,
  error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  source_provider text,
  source_local_path text,
  seafile_library_id text,
  seafile_path text,
  source_version text,
  last_helper_heartbeat_at timestamp with time zone,
  verified_at timestamp with time zone,
  expected_quick_hash text,
  final_hash text,
  final_size bigint,
  verify_attempts integer DEFAULT 0 NOT NULL,
  verify_deadline_at timestamp with time zone,
  verify_resolve_at timestamp with time zone,
  verify_last_attempt_at timestamp with time zone,
  verify_failed_at timestamp with time zone,
  verify_error text,
  redrive_count integer DEFAULT 0 NOT NULL,
  redrive_requested boolean DEFAULT false NOT NULL,
  resolution text);
CREATE TABLE IF NOT EXISTS public.asset_path_history (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  asset_id uuid NOT NULL,
  old_relative_path text NOT NULL,
  new_relative_path text NOT NULL,
  detected_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.asset_tags (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  asset_id uuid NOT NULL,
  tag text NOT NULL,
  source text DEFAULT 'manual'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid);
CREATE TABLE IF NOT EXISTS public.assets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  filename text NOT NULL,
  relative_path text NOT NULL,
  file_type file_type NOT NULL,
  file_size bigint DEFAULT 0,
  width integer DEFAULT 0,
  height integer DEFAULT 0,
  artboards integer DEFAULT 1,
  thumbnail_url text,
  thumbnail_error text,
  is_licensed boolean DEFAULT false,
  is_deleted boolean DEFAULT false,
  licensor_id uuid,
  property_id uuid,
  product_subtype_id uuid,
  asset_type asset_type,
  art_source art_source,
  big_theme text,
  little_theme text,
  design_ref text,
  design_style text,
  ai_description text,
  scene_description text,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  workflow_status workflow_status DEFAULT 'other'::workflow_status,
  status asset_status DEFAULT 'pending'::asset_status,
  quick_hash text NOT NULL,
  quick_hash_version integer DEFAULT 1 NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_scanned_at timestamp with time zone,
  modified_at timestamp with time zone NOT NULL,
  file_created_at timestamp with time zone,
  ingested_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  sku text,
  mg01_code text,
  mg01_name text,
  mg02_code text,
  mg02_name text,
  mg03_code text,
  mg03_name text,
  size_code text,
  size_name text,
  licensor_code text,
  licensor_name text,
  property_code text,
  property_name text,
  sku_sequence text,
  product_category text,
  division_code text,
  division_name text,
  style_group_id uuid,
  ai_tagged_at timestamp with time zone,
  primary_sort_tier smallint DEFAULT 10 NOT NULL,
  designer_name text,
  technical_designer_name text,
  freelancer_name text,
  cover_description text,
  pdf_page2_url text,
  updated_at timestamp with time zone DEFAULT now(),
  ai_model text,
  stage text,
  customer text,
  program text);
CREATE TABLE IF NOT EXISTS public.characters (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  property_id uuid NOT NULL,
  name text NOT NULL,
  external_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  usage_count integer DEFAULT 0 NOT NULL,
  is_priority boolean DEFAULT false NOT NULL);
CREATE TABLE IF NOT EXISTS public.erp_enrichment_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  source text NOT NULL,
  confidence real,
  run_id uuid,
  applied_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.erp_items_current (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  external_id text NOT NULL,
  style_number text,
  item_description text,
  mg_category text,
  mg01_code text,
  mg02_code text,
  mg03_code text,
  mg04_code text,
  mg05_code text,
  mg06_code text,
  size_code text,
  licensor_code text,
  property_code text,
  division_code text,
  erp_updated_at timestamp with time zone,
  synced_at timestamp with time zone DEFAULT now() NOT NULL,
  sync_run_id uuid,
  source_system text DEFAULT 'designflow'::text NOT NULL,
  raw_mg_fields jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  dismissed boolean DEFAULT false NOT NULL,
  prepack_code text,
  prepack_codes jsonb);
CREATE TABLE IF NOT EXISTS public.erp_items_raw (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  sync_run_id uuid,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.erp_sync_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  total_fetched integer DEFAULT 0,
  total_upserted integer DEFAULT 0,
  total_errors integer DEFAULT 0,
  error_samples jsonb DEFAULT '[]'::jsonb,
  run_metadata jsonb DEFAULT '{}'::jsonb,
  created_by text);
CREATE TABLE IF NOT EXISTS public.helper_devices (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  device_name text NOT NULL,
  device_os text NOT NULL,
  helper_version text NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  registered_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.helper_tokens (
  id text NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL,
  asset_id uuid,
  checkout_id uuid,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.hygiene_findings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  asset_id uuid,
  relative_path text NOT NULL,
  filename text NOT NULL,
  check_type text NOT NULL,
  severity text DEFAULT 'warning'::text NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb NOT NULL,
  scan_session_id text,
  found_by_agent text,
  found_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  review_notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  email text NOT NULL,
  role app_role DEFAULT 'user'::app_role,
  invited_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  accepted_at timestamp with time zone,
  apps app_name[] DEFAULT ARRAY['popdam'::app_name] NOT NULL);
CREATE TABLE IF NOT EXISTS public.licensors (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  external_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.pdf_text_samples (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  asset_id uuid,
  filename text NOT NULL,
  relative_path text NOT NULL,
  extraction_method text NOT NULL,
  extracted_text text,
  page_count integer,
  char_count integer DEFAULT 0 NOT NULL,
  extraction_error text,
  sampled_at timestamp with time zone DEFAULT now() NOT NULL,
  thumbnail_url text);
CREATE TABLE IF NOT EXISTS public.processing_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  asset_id uuid NOT NULL,
  job_type text NOT NULL,
  status queue_status DEFAULT 'pending'::queue_status,
  agent_id text,
  claimed_at timestamp with time zone,
  completed_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.prod_order_headers_current (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  external_id text NOT NULL,
  prod_order_number text NOT NULL,
  style_number text NOT NULL,
  order_status text,
  customer_code text,
  customer_name text,
  quantity numeric,
  due_date date,
  order_date date,
  erp_updated_at timestamp with time zone,
  synced_at timestamp with time zone DEFAULT now() NOT NULL,
  sync_run_id uuid,
  raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.prod_order_headers_raw (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  sync_run_id uuid,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.prod_order_sync_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  total_fetched integer DEFAULT 0 NOT NULL,
  total_upserted integer DEFAULT 0 NOT NULL,
  total_errors integer DEFAULT 0 NOT NULL,
  error_samples jsonb DEFAULT '[]'::jsonb NOT NULL,
  run_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by text DEFAULT 'admin-api'::text NOT NULL);
CREATE TABLE IF NOT EXISTS public.product_categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  external_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.product_category_predictions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  erp_item_id uuid,
  external_id text NOT NULL,
  predicted_category text NOT NULL,
  confidence real NOT NULL,
  rationale text,
  classification_source text DEFAULT 'ai'::text NOT NULL,
  ai_model text,
  ai_prompt_version text,
  status text DEFAULT 'pending'::text NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  input_context jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.product_subtypes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  type_id uuid NOT NULL,
  name text NOT NULL,
  external_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.product_types (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  category_id uuid NOT NULL,
  name text NOT NULL,
  external_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid NOT NULL,
  email text,
  full_name text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.properties (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  licensor_id uuid NOT NULL,
  name text NOT NULL,
  external_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.render_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  asset_id uuid NOT NULL,
  status queue_status DEFAULT 'pending'::queue_status,
  claimed_by text,
  claimed_at timestamp with time zone,
  completed_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  lease_expires_at timestamp with time zone,
  attempts integer DEFAULT 0 NOT NULL);
CREATE TABLE IF NOT EXISTS public.scanner_ai_ignores (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  relative_path text NOT NULL,
  reason text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  snoozed_until timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.sku_files_used (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sku text NOT NULL,
  file_name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  style_guide_file_id uuid,
  source text,
  match_best_score real,
  match_attempts integer DEFAULT 0 NOT NULL,
  last_match_attempt_at timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.style_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sku text NOT NULL,
  folder_path text NOT NULL,
  primary_asset_id uuid,
  asset_count integer DEFAULT 0,
  workflow_status workflow_status DEFAULT 'other'::workflow_status,
  is_licensed boolean DEFAULT false,
  licensor_code text,
  licensor_name text,
  property_code text,
  property_name text,
  product_category text,
  division_code text,
  division_name text,
  mg01_code text,
  mg01_name text,
  mg02_code text,
  mg02_name text,
  mg03_code text,
  mg03_name text,
  size_code text,
  size_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  latest_file_date timestamp with time zone,
  licensor_id uuid,
  property_id uuid,
  primary_asset_type text,
  primary_thumbnail_url text,
  primary_thumbnail_error text,
  designer_name text,
  technical_designer_name text,
  freelancer_name text,
  designer_conflict boolean DEFAULT false NOT NULL,
  cover_description text,
  stage text,
  customer text,
  program text);
CREATE TABLE IF NOT EXISTS public.style_guide_crawl_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  agent_id text,
  roots_scanned text[],
  files_found integer,
  error_message text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  inaccessible_roots text[]);
CREATE TABLE IF NOT EXISTS public.style_guide_files (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  crawl_run_id uuid,
  root_label text NOT NULL,
  relative_path text NOT NULL,
  directory_path text NOT NULL,
  filename text NOT NULL,
  basename_no_ext text NOT NULL,
  file_extension text,
  style_guide_folder text,
  property_folder text,
  normalized_name text NOT NULL,
  normalized_style_guide_folder text,
  size_bytes bigint,
  modified_at timestamp with time zone,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  licensor_name text GENERATED ALWAYS AS (split_part(relative_path, '/'::text, 1)) STORED,
  thumbnail_url text,
  thumbnail_error text);
CREATE TABLE IF NOT EXISTS public.style_guide_render_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  style_guide_file_id uuid NOT NULL,
  status queue_status DEFAULT 'pending'::queue_status NOT NULL,
  claimed_by text,
  claimed_at timestamp with time zone,
  completed_at timestamp with time zone,
  error_message text,
  lease_expires_at timestamp with time zone,
  attempts integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.tiff_optimization_queue (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  relative_path text NOT NULL,
  filename text NOT NULL,
  file_size bigint NOT NULL,
  file_modified_at timestamp with time zone NOT NULL,
  file_created_at timestamp with time zone,
  compression_type text,
  status text DEFAULT 'scanned'::text NOT NULL,
  mode text,
  new_file_size bigint,
  new_filename text,
  new_file_modified_at timestamp with time zone,
  new_file_created_at timestamp with time zone,
  original_backed_up boolean DEFAULT false,
  original_deleted boolean DEFAULT false,
  error_message text,
  scan_session_id text,
  claimed_by text,
  claimed_at timestamp with time zone,
  processed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  role app_role NOT NULL);

-- ------------------------------------------------------------------------------------
-- Primary keys, unique constraints and checks (157)
-- ------------------------------------------------------------------------------------
ALTER TABLE core.age_group ADD CONSTRAINT age_group_pkey PRIMARY KEY (id);
ALTER TABLE core.art_types ADD CONSTRAINT art_types_code_key UNIQUE (code);
ALTER TABLE core.art_types ADD CONSTRAINT art_types_name_key UNIQUE (name);
ALTER TABLE core.art_types ADD CONSTRAINT art_types_pkey PRIMARY KEY (id);
ALTER TABLE core.artist_types ADD CONSTRAINT artist_types_code_key UNIQUE (code);
ALTER TABLE core.artist_types ADD CONSTRAINT artist_types_pkey PRIMARY KEY (id);
ALTER TABLE core."externalCustomer" ADD CONSTRAINT "externalCustomer_pkey" PRIMARY KEY ("customerCode");
ALTER TABLE core."externalVendor" ADD CONSTRAINT "externalVendor_pkey" PRIMARY KEY ("vendorCode");
ALTER TABLE core."licenseList" ADD CONSTRAINT "licenseList_pkey" PRIMARY KEY ("licenseList_id");
ALTER TABLE core."merchGroup" ADD CONSTRAINT "merchGroup_pkey" PRIMARY KEY (mg_id);
ALTER TABLE core."merchGroupHeaders" ADD CONSTRAINT "merchGroupHeaders_pkey" PRIMARY KEY (id);
ALTER TABLE core."merchGroupMaster" ADD CONSTRAINT "merchGroupMaster_pkey" PRIMARY KEY (mg_id);
ALTER TABLE core."merchGroupRelations" ADD CONSTRAINT "merchGroupRelations_check" CHECK ((parent_mg_id <> child_mg_id));
ALTER TABLE core."merchGroupRelations" ADD CONSTRAINT "merchGroupRelations_pkey" PRIMARY KEY (id);
ALTER TABLE core.properties_and_characters ADD CONSTRAINT properties_and_characters_pkey PRIMARY KEY (id);
ALTER TABLE core.property_character_associations ADD CONSTRAINT property_character_associations_pkey PRIMARY KEY (property_id, character_id, licensor_id);
ALTER TABLE core.vendor ADD CONSTRAINT vendor_pkey PRIMARY KEY (vendor_id);
ALTER TABLE core."vendorGroup" ADD CONSTRAINT "vendorGroup_pkey" PRIMARY KEY (id);
ALTER TABLE plm."ContainerHeader" ADD CONSTRAINT "ContainerHeader_pkey" PRIMARY KEY (id);
ALTER TABLE plm."DesignTeamTime" ADD CONSTRAINT "DesignTeamTime_pkey" PRIMARY KEY (id);
ALTER TABLE plm."DesignTeamTimes" ADD CONSTRAINT "DesignTeamTimes_pkey" PRIMARY KEY (id);
ALTER TABLE plm."FOBCountry" ADD CONSTRAINT "FOBCountry_pkey" PRIMARY KEY ("FOBCountry_id");
ALTER TABLE plm."FactoryTime" ADD CONSTRAINT "FactoryTime_pkey" PRIMARY KEY (id);
ALTER TABLE plm."FactoryTimes" ADD CONSTRAINT "FactoryTimes_pkey" PRIMARY KEY (id);
ALTER TABLE plm."GridAccessLevel" ADD CONSTRAINT "RFQCustomLayout_pkey" PRIMARY KEY (id);
ALTER TABLE plm."GridChildrenLayout" ADD CONSTRAINT "GridChildrenLayout_pkey" PRIMARY KEY (field);
ALTER TABLE plm."GridChildrenLayoutOrder" ADD CONSTRAINT "GridChildrenLayoutOrder_pkey" PRIMARY KEY (id);
ALTER TABLE plm."GridLayout" ADD CONSTRAINT "RFQLayout_pkey" PRIMARY KEY (id);
ALTER TABLE plm."GridViewState" ADD CONSTRAINT "GridViewState_pkey" PRIMARY KEY (id);
ALTER TABLE plm."LicenseFeedBacks" ADD CONSTRAINT "LicenseFeedBacks_pkey" PRIMARY KEY (id);
ALTER TABLE plm."LicensingTime" ADD CONSTRAINT "LicensingTime_pkey" PRIMARY KEY (id);
ALTER TABLE plm."LicensingTimes" ADD CONSTRAINT "LicensingTimes_pkey" PRIMARY KEY (id);
ALTER TABLE plm."OrderLeadTime" ADD CONSTRAINT "OrderLeadTime_pkey" PRIMARY KEY (order_id);
ALTER TABLE plm."ProdOrderDetail" ADD CONSTRAINT "ProdOrderDetail_pkey1" PRIMARY KEY (pkey);
ALTER TABLE plm."ProdOrderHeader" ADD CONSTRAINT "ProdOrderHeader_pkey" PRIMARY KEY ("prodOrderNo");
ALTER TABLE plm."ProdShipmentTransitTime" ADD CONSTRAINT "ProdShipmentTransitTime_pkey" PRIMARY KEY (id);
ALTER TABLE plm."ProductNickname" ADD CONSTRAINT "ProductNickname_pkey" PRIMARY KEY (id);
ALTER TABLE plm."RFQContainer" ADD CONSTRAINT "RFQContainer_pkey" PRIMARY KEY ("RFQContainer_id");
ALTER TABLE plm."RFQGroup" ADD CONSTRAINT "RFQGroup_pkey" PRIMARY KEY ("RFQGroup_id");
ALTER TABLE plm."RFQItem" ADD CONSTRAINT "RFQItem_pkey" PRIMARY KEY ("rfqItem_id");
ALTER TABLE plm."RFQItemDivision" ADD CONSTRAINT "RFQItemLicense_pkey" PRIMARY KEY ("RFQItemDivision_id");
ALTER TABLE plm."RFQItemStatus" ADD CONSTRAINT "RFQItemStatus_pkey" PRIMARY KEY ("RFQItemStatus_id");
ALTER TABLE plm."RFQStep" ADD CONSTRAINT "RFQStep_pkey" PRIMARY KEY ("RFQStep_id");
ALTER TABLE plm."RFQVendor" ADD CONSTRAINT "RFQVendor_pkey" PRIMARY KEY ("RFQVendor_id");
ALTER TABLE plm."RFQWhse" ADD CONSTRAINT "RFQWhse_pkey" PRIMARY KEY ("RFQWhse_id");
ALTER TABLE plm."SeasonCode" ADD CONSTRAINT "SeasonCode_pkey" PRIMARY KEY (id);
ALTER TABLE plm."ShippingPort" ADD CONSTRAINT "ShippingPort_pkey" PRIMARY KEY (id);
ALTER TABLE plm."StandardizedDetail" ADD CONSTRAINT "StandardizedDetail_pkey" PRIMARY KEY (id);
ALTER TABLE plm."StandardizedGroup" ADD CONSTRAINT "StandardizedGroup_pkey" PRIMARY KEY (id);
ALTER TABLE plm."StandardizedProductElement" ADD CONSTRAINT "StandardizedProductElement_pkey" PRIMARY KEY (id);
ALTER TABLE plm."StandardizedProductElementValue" ADD CONSTRAINT "StandardizedProductElementValue_pkey" PRIMARY KEY (id);
ALTER TABLE plm."StandardizedProductType" ADD CONSTRAINT "StandardizedProduct_pkey" PRIMARY KEY (id);
ALTER TABLE plm."StandardizedSize" ADD CONSTRAINT "StandardizedSize_pkey" PRIMARY KEY (id);
ALTER TABLE plm."StandardizedVendor" ADD CONSTRAINT "StandardizedVendor_pkey" PRIMARY KEY ("pKey");
ALTER TABLE plm."StandardizedVersion" ADD CONSTRAINT "StandardizedVersion_pkey" PRIMARY KEY (id);
ALTER TABLE plm."UDFComponent" ADD CONSTRAINT "UDFComponent_pkey" PRIMARY KEY ("UDFComponent_id");
ALTER TABLE plm."UDFElement" ADD CONSTRAINT "UDFElement_pkey" PRIMARY KEY ("UDFElement_id");
ALTER TABLE plm."UDFElementType" ADD CONSTRAINT "UDFElementType_pkey" PRIMARY KEY ("UDFElementType_id");
ALTER TABLE plm."UDFGroup" ADD CONSTRAINT "UDFGroup_pkey" PRIMARY KEY ("UDFGroup_id");
ALTER TABLE plm."UDFQuery" ADD CONSTRAINT "UDFQuery_pkey" PRIMARY KEY ("UDFQuery_column_name");
ALTER TABLE plm."UDFTable" ADD CONSTRAINT "UDFTable_pkey" PRIMARY KEY ("UDFTable_id");
ALTER TABLE plm.art_piece_attachment ADD CONSTRAINT art_piece_attachment_pkey PRIMARY KEY (id);
ALTER TABLE plm."companyCode" ADD CONSTRAINT "companyCode_pkey" PRIMARY KEY ("comCode_id");
ALTER TABLE plm."deliveryLocation" ADD CONSTRAINT "deliveryLocation_pkey" PRIMARY KEY ("deliveryLocation_id");
ALTER TABLE plm."divisionCode" ADD CONSTRAINT "DivisionCode_pkey" PRIMARY KEY ("divCode_id");
ALTER TABLE plm."externalApi" ADD CONSTRAINT "externalApi_pkey" PRIMARY KEY ("externalApi_id");
ALTER TABLE plm.grid_cell_notes ADD CONSTRAINT grid_cell_notes_pkey PRIMARY KEY (id);
ALTER TABLE plm.groups ADD CONSTRAINT groups_pkey PRIMARY KEY (id);
ALTER TABLE plm."itemAttachment" ADD CONSTRAINT "itemPackage_pkey" PRIMARY KEY (item_attachment_id);
ALTER TABLE plm."itemDepth" ADD CONSTRAINT "itemDepth_pkey" PRIMARY KEY ("itemDepth_id");
ALTER TABLE plm."itemDetail" ADD CONSTRAINT "itemDetail_pkey" PRIMARY KEY (item_pk);
ALTER TABLE plm."itemHeader" ADD CONSTRAINT "itemHeader_pkey" PRIMARY KEY (item_id_pk);
ALTER TABLE plm."itemLicenseImage" ADD CONSTRAINT "itemLicenseImage_pkey" PRIMARY KEY (id);
ALTER TABLE plm."itemSize" ADD CONSTRAINT "itemSize_pkey" PRIMARY KEY ("itemSize_id");
ALTER TABLE plm."itemType" ADD CONSTRAINT "itemType_pkey" PRIMARY KEY (item_type_id);
ALTER TABLE plm.item_character_associations ADD CONSTRAINT item_character_associations_item_header_id_key UNIQUE (item_header_id);
ALTER TABLE plm.item_character_associations ADD CONSTRAINT item_character_associations_pkey PRIMARY KEY (id);
ALTER TABLE plm.item_prod_order_detail_associations ADD CONSTRAINT item_prod_order_detail_associ_item_header_id_prod_order_det_key UNIQUE (item_header_id, prod_order_detail_pkey);
ALTER TABLE plm.item_prod_order_detail_associations ADD CONSTRAINT item_prod_order_detail_associations_pkey PRIMARY KEY (id);
ALTER TABLE plm."licensingFeedbackReply" ADD CONSTRAINT "licensingFeedbackReply_pkey" PRIMARY KEY (id);
ALTER TABLE plm."licensingMilestone" ADD CONSTRAINT "licensingMilestone_pkey" PRIMARY KEY (id);
ALTER TABLE plm."licensingMilestone" ADD CONSTRAINT unique_item_stage_designflow_1774369813518 UNIQUE (itemheader_id_fk, stage);
ALTER TABLE plm."licensingStatus" ADD CONSTRAINT "licensingStatus_pkey" PRIMARY KEY (id);
ALTER TABLE plm."productUserAssignment" ADD CONSTRAINT "productUserAssignment_pkey" PRIMARY KEY (id);
ALTER TABLE plm.sample ADD CONSTRAINT sample_pkey PRIMARY KEY (sample_id_pk);
ALTER TABLE plm.sample_attachment ADD CONSTRAINT sample_attachment_pkey PRIMARY KEY (sample_attachment_id);
ALTER TABLE plm.sample_box ADD CONSTRAINT sample_box_pkey PRIMARY KEY (box_id_pk);
ALTER TABLE plm.sample_comments ADD CONSTRAINT sample_comments_pkey PRIMARY KEY (id);
ALTER TABLE plm.sample_event ADD CONSTRAINT sample_event_pkey PRIMARY KEY (event_id_pk);
ALTER TABLE plm.sample_factory_group ADD CONSTRAINT sample_factory_group_pkey PRIMARY KEY (factory_group_id_pk);
ALTER TABLE plm.sample_shipment_item ADD CONSTRAINT sample_shipment_item_pkey PRIMARY KEY (shipment_item_id_pk);
ALTER TABLE public.admin_config ADD CONSTRAINT admin_config_pkey PRIMARY KEY (key);
ALTER TABLE public.agent_pairings ADD CONSTRAINT agent_pairings_agent_type_check CHECK ((agent_type = ANY (ARRAY['bridge'::text, 'windows-render'::text])));
ALTER TABLE public.agent_pairings ADD CONSTRAINT agent_pairings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'consumed'::text, 'expired'::text])));
ALTER TABLE public.agent_pairings ADD CONSTRAINT agent_pairings_pkey PRIMARY KEY (id);
ALTER TABLE public.agent_pairings ADD CONSTRAINT agent_pairings_pairing_code_key UNIQUE (pairing_code);
ALTER TABLE public.agent_registrations ADD CONSTRAINT agent_registrations_pkey PRIMARY KEY (id);
ALTER TABLE public.agent_registrations ADD CONSTRAINT agent_registrations_agent_key_hash_key UNIQUE (agent_key_hash);
ALTER TABLE public.agent_registrations ADD CONSTRAINT agent_registrations_agent_name_key UNIQUE (agent_name);
ALTER TABLE public.ai_sentinel_cleanup_log ADD CONSTRAINT ai_sentinel_cleanup_log_pkey PRIMARY KEY (id);
ALTER TABLE public.app_access ADD CONSTRAINT app_access_pkey PRIMARY KEY (id);
ALTER TABLE public.app_access ADD CONSTRAINT app_access_user_id_app_key UNIQUE (user_id, app);
ALTER TABLE public.asset_characters ADD CONSTRAINT asset_characters_pkey PRIMARY KEY (asset_id, character_id);
ALTER TABLE public.asset_checkouts ADD CONSTRAINT asset_checkouts_pkey PRIMARY KEY (id);
ALTER TABLE public.asset_path_history ADD CONSTRAINT asset_path_history_pkey PRIMARY KEY (id);
ALTER TABLE public.asset_tags ADD CONSTRAINT asset_tags_pkey PRIMARY KEY (id);
ALTER TABLE public.asset_tags ADD CONSTRAINT asset_tags_asset_id_tag_key UNIQUE (asset_id, tag);
ALTER TABLE public.assets ADD CONSTRAINT assets_pkey PRIMARY KEY (id);
ALTER TABLE public.assets ADD CONSTRAINT assets_relative_path_unique UNIQUE (relative_path);
ALTER TABLE public.characters ADD CONSTRAINT characters_pkey PRIMARY KEY (id);
ALTER TABLE public.characters ADD CONSTRAINT characters_external_id_key UNIQUE (external_id);
ALTER TABLE public.erp_enrichment_log ADD CONSTRAINT erp_enrichment_log_pkey PRIMARY KEY (id);
ALTER TABLE public.erp_items_current ADD CONSTRAINT erp_items_current_pkey PRIMARY KEY (id);
ALTER TABLE public.erp_items_current ADD CONSTRAINT erp_items_current_external_id_key UNIQUE (external_id);
ALTER TABLE public.erp_items_raw ADD CONSTRAINT erp_items_raw_pkey PRIMARY KEY (id);
ALTER TABLE public.erp_sync_runs ADD CONSTRAINT erp_sync_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.helper_devices ADD CONSTRAINT helper_devices_device_os_check CHECK ((device_os = ANY (ARRAY['windows'::text, 'macos'::text])));
ALTER TABLE public.helper_devices ADD CONSTRAINT helper_devices_pkey PRIMARY KEY (id);
ALTER TABLE public.helper_tokens ADD CONSTRAINT helper_tokens_action_check CHECK ((action = ANY (ARRAY['checkout'::text, 'checkin'::text, 'open'::text, 'reveal'::text, 'discard'::text])));
ALTER TABLE public.helper_tokens ADD CONSTRAINT helper_tokens_pkey PRIMARY KEY (id);
ALTER TABLE public.hygiene_findings ADD CONSTRAINT hygiene_findings_pkey PRIMARY KEY (id);
ALTER TABLE public.invitations ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);
ALTER TABLE public.invitations ADD CONSTRAINT invitations_email_key UNIQUE (email);
ALTER TABLE public.licensors ADD CONSTRAINT licensors_pkey PRIMARY KEY (id);
ALTER TABLE public.licensors ADD CONSTRAINT licensors_external_id_key UNIQUE (external_id);
ALTER TABLE public.pdf_text_samples ADD CONSTRAINT pdf_text_samples_pkey PRIMARY KEY (id);
ALTER TABLE public.pdf_text_samples ADD CONSTRAINT pdf_text_samples_asset_id_unique UNIQUE (asset_id);
ALTER TABLE public.processing_queue ADD CONSTRAINT processing_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.prod_order_headers_current ADD CONSTRAINT prod_order_headers_current_pkey PRIMARY KEY (id);
ALTER TABLE public.prod_order_headers_current ADD CONSTRAINT prod_order_headers_current_external_id_key UNIQUE (external_id);
ALTER TABLE public.prod_order_headers_raw ADD CONSTRAINT prod_order_headers_raw_pkey PRIMARY KEY (id);
ALTER TABLE public.prod_order_sync_runs ADD CONSTRAINT prod_order_sync_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.product_categories ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);
ALTER TABLE public.product_categories ADD CONSTRAINT product_categories_external_id_key UNIQUE (external_id);
ALTER TABLE public.product_category_predictions ADD CONSTRAINT product_category_predictions_pkey PRIMARY KEY (id);
ALTER TABLE public.product_subtypes ADD CONSTRAINT product_subtypes_pkey PRIMARY KEY (id);
ALTER TABLE public.product_subtypes ADD CONSTRAINT product_subtypes_external_id_key UNIQUE (external_id);
ALTER TABLE public.product_types ADD CONSTRAINT product_types_pkey PRIMARY KEY (id);
ALTER TABLE public.product_types ADD CONSTRAINT product_types_external_id_key UNIQUE (external_id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);
ALTER TABLE public.properties ADD CONSTRAINT properties_pkey PRIMARY KEY (id);
ALTER TABLE public.properties ADD CONSTRAINT properties_external_id_key UNIQUE (external_id);
ALTER TABLE public.render_queue ADD CONSTRAINT render_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.scanner_ai_ignores ADD CONSTRAINT scanner_ai_ignores_pkey PRIMARY KEY (id);
ALTER TABLE public.scanner_ai_ignores ADD CONSTRAINT scanner_ai_ignores_relative_path_key UNIQUE (relative_path);
ALTER TABLE public.sku_files_used ADD CONSTRAINT sku_files_used_pkey PRIMARY KEY (id);
ALTER TABLE public.sku_files_used ADD CONSTRAINT sku_files_used_sku_file_name_key UNIQUE (sku, file_name);
ALTER TABLE public.style_groups ADD CONSTRAINT style_groups_pkey PRIMARY KEY (id);
ALTER TABLE public.style_groups ADD CONSTRAINT style_groups_sku_key UNIQUE (sku);
ALTER TABLE public.style_guide_crawl_runs ADD CONSTRAINT style_guide_crawl_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.style_guide_files ADD CONSTRAINT style_guide_files_pkey PRIMARY KEY (id);
ALTER TABLE public.style_guide_files ADD CONSTRAINT style_guide_files_root_path_unique UNIQUE (root_label, relative_path);
ALTER TABLE public.style_guide_render_queue ADD CONSTRAINT style_guide_render_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.tiff_optimization_queue ADD CONSTRAINT tiff_optimization_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.tiff_optimization_queue ADD CONSTRAINT tiff_optimization_queue_relative_path_key UNIQUE (relative_path);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);

-- ------------------------------------------------------------------------------------
-- PRE-ADOPTION FUNCTIONS (60)
-- ------------------------------------------------------------------------------------
-- Functions, exactly like the tables above, that exist in production and that no
-- migration in this repository creates. This is not an optional extra. Without
-- public.has_role() the very first reconcile migration aborts, and the eighteen
-- migrations downstream of it never create their own tables either -- which is exactly
-- what the first measured run showed: 66 pass-1 failures fell only to 41.
--
-- They come BEFORE the indexes because some index predicates call them
-- (public.is_style_guide_source_pdf), and AFTER the tables because some read them.
-- ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_queue_render()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Skip junk files (macOS resource forks, system files)
  IF NEW.filename LIKE '._%' OR
     NEW.filename = '.DS_Store' OR
     NEW.filename = '.localized' OR
     NEW.filename = 'Thumbs.db' OR
     NEW.filename = 'desktop.ini' OR
     NEW.filename LIKE '~%' THEN
    RETURN NEW;
  END IF;

  -- Queue ANY file type that has a thumbnail error and no thumbnail
  IF NEW.thumbnail_error IS NOT NULL
     AND NEW.thumbnail_url IS NULL THEN
    INSERT INTO public.render_queue (asset_id, status)
    VALUES (NEW.id, 'pending')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_pdf_files_used()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id    uuid;
  v_total int := 0;
BEGIN
  FOR v_id IN (
    SELECT DISTINCT asset_id
    FROM pdf_text_samples
    WHERE asset_id IS NOT NULL
      AND extracted_text IS NOT NULL
      AND char_count > 100
  ) LOOP
    v_total := v_total + parse_pdf_files_used(v_id);
  END LOOP;
  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_assign_style_groups(p_assignments jsonb)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rows AS (
    SELECT
      (x->>'asset_id')::uuid AS asset_id,
      (x->>'style_group_id')::uuid AS style_group_id
    FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb)) AS x
  ),
  upd AS (
    UPDATE public.assets a
    SET style_group_id = r.style_group_id
    FROM rows r
    WHERE a.id = r.asset_id
      AND a.is_deleted = false
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_insert_pdf_text_samples(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_count int;
BEGIN
  SET LOCAL app.skip_parse_pdf_trigger = '1';

  INSERT INTO pdf_text_samples (
    asset_id, filename, relative_path, extraction_method,
    extracted_text, page_count, char_count, extraction_error,
    thumbnail_url, sampled_at
  )
  SELECT
    NULLIF(elem->>'asset_id', '')::uuid,
    elem->>'filename',
    elem->>'relative_path',
    elem->>'extraction_method',
    NULLIF(elem->>'extracted_text', ''),
    (elem->>'page_count')::int,
    COALESCE((elem->>'char_count')::int, 0),
    NULLIF(elem->>'extraction_error', ''),
    NULLIF(elem->>'thumbnail_url', ''),
    now()
  FROM jsonb_array_elements(p_rows) AS elem
  ON CONFLICT (asset_id) DO UPDATE SET
    filename          = EXCLUDED.filename,
    relative_path     = EXCLUDED.relative_path,
    extraction_method = EXCLUDED.extraction_method,
    extracted_text    = EXCLUDED.extracted_text,
    page_count        = EXCLUDED.page_count,
    char_count        = EXCLUDED.char_count,
    extraction_error  = EXCLUDED.extraction_error,
    thumbnail_url     = EXCLUDED.thumbnail_url,
    sampled_at        = EXCLUDED.sampled_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_jobs(p_agent_id text, p_batch_size integer DEFAULT 5)
 RETURNS SETOF processing_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.processing_queue
  SET status = 'claimed', agent_id = p_agent_id, claimed_at = now()
  WHERE id IN (
    SELECT id FROM public.processing_queue
    WHERE status = 'pending'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  RETURNING *;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_pdf_backfill_batch(p_limit integer DEFAULT 25)
 RETURNS TABLE(id uuid, filename text, relative_path text, needs_thumbnail boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    a.id,
    a.filename,
    a.relative_path,
    (a.thumbnail_url IS NULL) AS needs_thumbnail
  FROM assets a
  WHERE a.is_deleted = false
    AND public.is_style_guide_source_pdf(a.file_type::text, a.filename)
    AND NOT EXISTS (
      SELECT 1 FROM pdf_text_samples pts WHERE pts.asset_id = a.id
    )
  ORDER BY a.id
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.claim_render_jobs(p_agent_id text, p_batch_size integer DEFAULT 1, p_lease_minutes integer DEFAULT 5, p_max_attempts integer DEFAULT 5)
 RETURNS TABLE(id uuid, asset_id uuid, attempts integer, lease_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT rq.id
    FROM render_queue rq
    WHERE (
      -- Pending jobs
      rq.status = 'pending'
      OR
      -- Expired-lease claimed jobs (crashed agent)
      (rq.status = 'claimed' AND rq.lease_expires_at IS NOT NULL AND rq.lease_expires_at < now())
    )
    AND rq.attempts < p_max_attempts
    ORDER BY rq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE render_queue rq
  SET
    status = 'claimed',
    claimed_by = p_agent_id,
    claimed_at = now(),
    lease_expires_at = now() + (p_lease_minutes || ' minutes')::interval,
    attempts = rq.attempts + 1
  FROM claimable
  WHERE rq.id = claimable.id
  RETURNING rq.id, rq.asset_id, rq.attempts, rq.lease_expires_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_sg_render_jobs(p_agent_id text, p_batch_size integer DEFAULT 1, p_lease_minutes integer DEFAULT 5, p_max_attempts integer DEFAULT 3)
 RETURNS TABLE(id uuid, style_guide_file_id uuid, attempts integer, lease_expires_at timestamp with time zone)
 LANGUAGE sql
AS $function$
  UPDATE public.style_guide_render_queue q
  SET
    status = 'claimed',
    claimed_by = p_agent_id,
    claimed_at = now(),
    lease_expires_at = now() + (p_lease_minutes || ' minutes')::interval,
    attempts = q.attempts + 1
  WHERE q.id IN (
    SELECT id FROM public.style_guide_render_queue
    WHERE
      (status = 'pending' OR (status = 'claimed' AND lease_expires_at < now()))
      AND attempts < p_max_attempts
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  RETURNING q.id, q.style_guide_file_id, q.attempts, q.lease_expires_at;
$function$;

CREATE OR REPLACE FUNCTION public.claim_tiff_jobs(p_agent_id text, p_batch_size integer DEFAULT 1, p_lease_minutes integer DEFAULT 10)
 RETURNS TABLE(id uuid, relative_path text, filename text, file_size bigint, file_modified_at timestamp with time zone, file_created_at timestamp with time zone, mode text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT tq.id
    FROM tiff_optimization_queue tq
    WHERE tq.status IN ('queued_test', 'queued_process')
    ORDER BY tq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE tiff_optimization_queue tq
  SET
    status = 'processing',
    claimed_by = p_agent_id,
    claimed_at = now()
  FROM claimable
  WHERE tq.id = claimable.id
  RETURNING tq.id, tq.relative_path, tq.filename, tq.file_size, tq.file_modified_at, tq.file_created_at,
    CASE WHEN tq.status = 'queued_test' THEN 'test' ELSE 'process' END AS mode;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_mega_group_tags_batch()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM asset_tags
  WHERE ctid IN (
    SELECT at2.ctid
    FROM asset_tags at2
    JOIN assets a ON a.id = at2.asset_id
    WHERE at2.source = 'ai'
      AND a.style_group_id IN (
        '038e1fda-f413-495d-981a-f2bfbe3b604e',
        '0ef04984-f645-469b-9775-a0c8e3eb416a',
        '6241f8d1-1c75-4e4c-918f-28e73d8f3bc3',
        '2f8c7f5e-a76d-4310-b571-7202e847cb76',
        '4978fbe3-d604-477b-abe0-536cad1d706b',
        'ac2bbd81-648f-43a1-b1cf-4bb0bdd78d79'
      )
      AND a.ai_tagged_at IS NULL
      AND a.is_deleted = false
    LIMIT 10000
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_mega_group_tags_batch(p_cursor uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 5, p_min_group_size integer DEFAULT 50)
 RETURNS TABLE(next_cursor uuid, groups_processed integer, tags_deleted integer, characters_deleted integer, metadata_cleared integer, done boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_group record;
  v_groups_processed int := 0;
  v_tags_deleted int := 0;
  v_chars_deleted int := 0;
  v_meta_cleared int := 0;
  v_last_id uuid;
  v_group_count int := 0;
  v_batch_tags int;
  v_batch_chars int;
  v_batch_meta int;
BEGIN
  FOR v_group IN
    SELECT sg.id
    FROM style_groups sg
    WHERE sg.asset_count >= p_min_group_size
      AND (p_cursor IS NULL OR sg.id > p_cursor)
    ORDER BY sg.id
    LIMIT p_batch_size
  LOOP
    v_group_count := v_group_count + 1;
    v_last_id := v_group.id;

    -- 1) Delete contaminated tags from NON-directly-tagged assets (ai_tagged_at IS NULL)
    --    These assets only have propagated tags — delete all AI tags.
    WITH non_tagged_assets AS (
      SELECT a.id FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
    ),
    del_tags_null AS (
      DELETE FROM asset_tags at
      USING non_tagged_assets nta
      WHERE at.asset_id = nta.id
        AND at.source = 'ai'
      RETURNING 1
    ),
    -- 2) Delete contaminated tags from DIRECTLY-tagged assets
    --    Keep tags created within 5 min of ai_tagged_at; delete the rest.
    tagged_assets AS (
      SELECT a.id, a.ai_tagged_at FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
    ),
    del_tags_late AS (
      DELETE FROM asset_tags at
      USING tagged_assets ta
      WHERE at.asset_id = ta.id
        AND at.source = 'ai'
        AND at.created_at > ta.ai_tagged_at + interval '5 minutes'
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM del_tags_null) + (SELECT count(*) FROM del_tags_late)
    INTO v_batch_tags;

    v_tags_deleted := v_tags_deleted + COALESCE(v_batch_tags, 0);

    -- 3) Delete contaminated asset_characters (same logic)
    WITH non_tagged_assets AS (
      SELECT a.id FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
    ),
    del_chars_null AS (
      DELETE FROM asset_characters ac
      USING non_tagged_assets nta
      WHERE ac.asset_id = nta.id
      RETURNING 1
    ),
    tagged_assets AS (
      SELECT a.id, a.ai_tagged_at FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
    )
    SELECT (SELECT count(*) FROM del_chars_null)
    INTO v_batch_chars;

    v_chars_deleted := v_chars_deleted + COALESCE(v_batch_chars, 0);

    -- 4) Clear propagated metadata on non-tagged assets
    WITH cleared AS (
      UPDATE assets a
      SET
        big_theme = NULL,
        little_theme = NULL,
        design_style = NULL,
        cover_description = NULL
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
        AND (a.big_theme IS NOT NULL OR a.little_theme IS NOT NULL
             OR a.design_style IS NOT NULL OR a.cover_description IS NOT NULL)
      RETURNING 1
    )
    SELECT count(*) INTO v_batch_meta FROM cleared;

    v_meta_cleared := v_meta_cleared + COALESCE(v_batch_meta, 0);
    v_groups_processed := v_groups_processed + 1;
  END LOOP;

  RETURN QUERY SELECT
    v_last_id,
    v_groups_processed,
    v_tags_deleted,
    v_chars_deleted,
    v_meta_cleared,
    (v_group_count < p_batch_size);
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_style_group_batch(p_last_id uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 200)
 RETURNS TABLE(cleared_count integer, last_id uuid, has_more boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
 SET lock_timeout TO '0'
AS $function$
DECLARE
  v_start_id uuid := COALESCE(p_last_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_cleared integer;
  v_last uuid;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    p_batch_size := 1;
  END IF;

  WITH batch AS (
    SELECT a.id
    FROM public.assets a
    WHERE a.is_deleted = false
      AND a.style_group_id IS NOT NULL
      AND a.id > v_start_id
    ORDER BY a.id ASC
    LIMIT p_batch_size
  ),
  upd AS (
    UPDATE public.assets a
    SET style_group_id = NULL
    FROM batch b
    WHERE a.id = b.id
    RETURNING a.id
  )
  SELECT COUNT(*)::integer,
         (SELECT u.id FROM upd u ORDER BY u.id DESC LIMIT 1)
  INTO v_cleared, v_last
  FROM upd;

  RETURN QUERY SELECT
    COALESCE(v_cleared, 0),
    v_last,
    COALESCE(v_cleared, 0) = p_batch_size;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_primary_sort_tier()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  fn        text    := lower(NEW.filename);
  base_name text    := lower(regexp_replace(NEW.filename, '\.[^.]+$', ''));
  has_thumb boolean := (NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_error IS NULL);
  is_photo34   boolean := (base_name LIKE '%3-4%');
  is_mockup    boolean := (fn LIKE '%mockup%' OR fn LIKE '%mock up%');
  is_art       boolean := (fn LIKE '%art%');
  is_techpack  boolean := (fn LIKE '%tech pack%' OR fn LIKE '%techpack%' OR fn LIKE '%tech_pack%');
  is_pkg       boolean := (fn LIKE '%packaging%');
BEGIN
  IF    is_photo34                                                              THEN NEW.primary_sort_tier :=  1;
  ELSIF is_mockup   AND has_thumb                                               THEN NEW.primary_sort_tier :=  2;
  ELSIF is_art      AND has_thumb                                               THEN NEW.primary_sort_tier :=  3;
  ELSIF is_techpack AND has_thumb                                               THEN NEW.primary_sort_tier :=  4;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_techpack AND NOT is_pkg
        AND has_thumb                                                           THEN NEW.primary_sort_tier :=  5;
  ELSIF is_pkg      AND has_thumb                                               THEN NEW.primary_sort_tier :=  6;
  ELSIF is_mockup                                                               THEN NEW.primary_sort_tier :=  7;
  ELSIF is_art                                                                  THEN NEW.primary_sort_tier :=  8;
  ELSIF is_techpack                                                             THEN NEW.primary_sort_tier :=  9;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_techpack AND NOT is_pkg         THEN NEW.primary_sort_tier := 10;
  ELSE                                                                               NEW.primary_sort_tier := 11;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.count_pdf_backfill_remaining()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT COUNT(*)
  FROM assets a
  WHERE a.is_deleted = false
    AND public.is_style_guide_source_pdf(a.file_type::text, a.filename)
    AND NOT EXISTS (
      SELECT 1 FROM pdf_text_samples pts WHERE pts.asset_id = a.id
    );
$function$;

CREATE OR REPLACE FUNCTION public.deactivate_stale_sg_files(p_root_label text, p_run_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE style_guide_files
  SET is_active = false
  WHERE root_label = p_root_label
    AND crawl_run_id != p_run_id
    AND is_active = true;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_readonly_query(query_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  result jsonb;
  trimmed text;
BEGIN
  trimmed := lower(trim(query_text));
  
  -- Allow SELECT and WITH...SELECT (CTEs)
  IF NOT (trimmed ~ '^select\s' OR trimmed ~ '^with\s') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;
  
  IF trimmed ~ '\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute)\b' THEN
    RAISE EXCEPTION 'Query contains forbidden keywords';
  END IF;

  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;
  
  RETURN COALESCE(result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_ai_pdf_duplicates()
 RETURNS TABLE(id uuid, filename text, relative_path text, thumbnail_url text, style_group_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    a.id,
    a.filename,
    a.relative_path,
    a.thumbnail_url,
    a.style_group_id
  FROM assets a
  WHERE a.file_type = 'ai'
    AND a.is_deleted = false
    AND EXISTS (
      SELECT 1 FROM assets p
      WHERE p.file_type = 'pdf'
        AND p.is_deleted = false
        -- Same directory (everything before the last slash, or empty string for root)
        AND regexp_replace(p.relative_path, '/[^/]*$', '') = regexp_replace(a.relative_path, '/[^/]*$', '')
        -- Same base filename, case-insensitive (strip final extension)
        AND lower(regexp_replace(p.filename, '\.[^.]+$', '')) = lower(regexp_replace(a.filename, '\.[^.]+$', ''))
    )
  ORDER BY a.relative_path;
$function$;

CREATE OR REPLACE FUNCTION public.get_filter_counts(p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_min_date timestamptz;
  v_search text;
  v_file_types text[];
  v_statuses text[];
  v_workflow_statuses text[];
  v_is_licensed boolean;
  v_licensor_id uuid;
  v_property_id uuid;
  v_asset_types text[];
  v_art_sources text[];
  v_tag_filter text;
  v_stages text[];
  v_customer text;
  v_program text;
  v_result jsonb := '{}'::jsonb;
BEGIN
  SELECT (value #>> '{}')::timestamptz INTO v_min_date
  FROM admin_config WHERE key = 'THUMBNAIL_MIN_DATE';
  IF v_min_date IS NULL THEN
    v_min_date := '2020-01-01'::timestamptz;
  END IF;

  v_search := p_filters ->> 'search';
  v_is_licensed := (p_filters ->> 'isLicensed')::boolean;
  v_licensor_id := (p_filters ->> 'licensorId')::uuid;
  v_property_id := (p_filters ->> 'propertyId')::uuid;
  v_tag_filter := p_filters ->> 'tagFilter';
  v_customer := p_filters ->> 'customer';
  v_program := p_filters ->> 'program';

  IF p_filters ? 'fileType' AND jsonb_array_length(p_filters -> 'fileType') > 0 THEN
    SELECT array_agg(x::text) INTO v_file_types FROM jsonb_array_elements_text(p_filters -> 'fileType') x;
  END IF;
  IF p_filters ? 'status' AND jsonb_array_length(p_filters -> 'status') > 0 THEN
    SELECT array_agg(x::text) INTO v_statuses FROM jsonb_array_elements_text(p_filters -> 'status') x;
  END IF;
  IF p_filters ? 'workflowStatus' AND jsonb_array_length(p_filters -> 'workflowStatus') > 0 THEN
    SELECT array_agg(x::text) INTO v_workflow_statuses FROM jsonb_array_elements_text(p_filters -> 'workflowStatus') x;
  END IF;
  IF p_filters ? 'assetType' AND jsonb_array_length(p_filters -> 'assetType') > 0 THEN
    SELECT array_agg(x::text) INTO v_asset_types FROM jsonb_array_elements_text(p_filters -> 'assetType') x;
  END IF;
  IF p_filters ? 'artSource' AND jsonb_array_length(p_filters -> 'artSource') > 0 THEN
    SELECT array_agg(x::text) INTO v_art_sources FROM jsonb_array_elements_text(p_filters -> 'artSource') x;
  END IF;
  IF p_filters ? 'stage' AND jsonb_array_length(p_filters -> 'stage') > 0 THEN
    SELECT array_agg(x::text) INTO v_stages FROM jsonb_array_elements_text(p_filters -> 'stage') x;
  END IF;

  WITH base AS MATERIALIZED (
    SELECT file_type, status, workflow_status, stage, is_licensed
    FROM assets
    WHERE is_deleted = false
      AND (modified_at >= v_min_date OR file_created_at >= v_min_date OR thumbnail_url IS NOT NULL)
      AND (v_search IS NULL OR filename ILIKE '%' || v_search || '%')
      AND (v_licensor_id IS NULL OR licensor_id = v_licensor_id)
      AND (v_property_id IS NULL OR property_id = v_property_id)
      AND (v_asset_types IS NULL OR asset_type::text = ANY(v_asset_types))
      AND (v_art_sources IS NULL OR art_source::text = ANY(v_art_sources))
      AND (v_tag_filter IS NULL OR v_tag_filter = ANY(tags))
      AND (v_customer IS NULL OR customer = v_customer)
      AND (v_program IS NULL OR program = v_program)
  )
  SELECT jsonb_build_object(
    'fileType', COALESCE((
      SELECT jsonb_object_agg(file_type::text, cnt) FROM (
        SELECT file_type, count(*) AS cnt FROM base
        WHERE (v_statuses IS NULL OR status::text = ANY(v_statuses))
          AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
          AND (v_stages IS NULL OR stage = ANY(v_stages))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY file_type
      ) s
    ), '{}'::jsonb),
    'status', COALESCE((
      SELECT jsonb_object_agg(status::text, cnt) FROM (
        SELECT status, count(*) AS cnt FROM base
        WHERE (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
          AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
          AND (v_stages IS NULL OR stage = ANY(v_stages))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY status
      ) s
    ), '{}'::jsonb),
    'workflowStatus', COALESCE((
      SELECT jsonb_object_agg(workflow_status, cnt) FROM (
        SELECT workflow_status, count(*) AS cnt FROM base
        WHERE workflow_status IS NOT NULL
          AND (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
          AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
          AND (v_stages IS NULL OR stage = ANY(v_stages))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY workflow_status
      ) s
    ), '{}'::jsonb),
    'stage', COALESCE((
      SELECT jsonb_object_agg(stage, cnt) FROM (
        SELECT stage, count(*) AS cnt FROM base
        WHERE stage IS NOT NULL
          AND (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
          AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
          AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY stage
      ) s
    ), '{}'::jsonb),
    'isLicensed', (
      SELECT jsonb_build_object(
        'true', COALESCE(sum(CASE WHEN is_licensed = true THEN 1 ELSE 0 END), 0),
        'false', COALESCE(sum(CASE WHEN is_licensed = false OR is_licensed IS NULL THEN 1 ELSE 0 END), 0)
      ) FROM base
      WHERE (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
        AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
        AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
        AND (v_stages IS NULL OR stage = ANY(v_stages))
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sg_preview_stats()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH file_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE is_active)                                                                                                                                                              AS total_active,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NOT NULL)                                                                                                                                AS has_preview,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND thumbnail_error IS NULL     AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff'))   AS renderable_no_preview,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND thumbnail_error IS NOT NULL AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff'))   AS render_errored,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL                                 AND lower(file_extension) NOT IN ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')) AS unsupported
    FROM public.style_guide_files
  ),
  queue_stats AS (
    SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'claimed')) AS queued_now
    FROM public.style_guide_render_queue
  )
  SELECT json_build_object(
    'total_active',          fs.total_active,
    'has_preview',           fs.has_preview,
    'renderable_no_preview', fs.renderable_no_preview,
    'render_errored',        fs.render_errored,
    'unsupported',           fs.unsupported,
    'queued_now',            qs.queued_now
  )
  FROM file_stats fs, queue_stats qs;
$function$;

CREATE OR REPLACE FUNCTION public.get_sg_render_queue_stats()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'pending',   COUNT(*) FILTER (WHERE status = 'pending'),
    'claimed',   COUNT(*) FILTER (WHERE status = 'claimed'),
    'completed', COUNT(*) FILTER (WHERE status = 'completed'),
    'failed',    COUNT(*) FILTER (WHERE status = 'failed')
  )
  FROM style_guide_render_queue;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _invitation record;
  _email text;
  _full_name text;
  _provider text;
  _app public.app_name;
BEGIN
  _email := lower(NEW.email);
  _full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    _email
  );
  _provider := NEW.raw_app_meta_data->>'provider';

  -- Company SSO users come from managed identity providers and bypass
  -- invitation rows. Azure is the active UI path; Authentik is retained for
  -- existing/backend compatibility.
  IF _provider IN ('authentik', 'azure') THEN
    INSERT INTO public.profiles (user_id, email, full_name)
    VALUES (NEW.id, _email, _full_name)
    ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          updated_at = now();

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.app_access (user_id, app)
    VALUES (NEW.id, 'popdam'::public.app_name)
    ON CONFLICT (user_id, app) DO NOTHING;

    RETURN NEW;
  END IF;

  -- Google and email/password remain invitation-only.
  SELECT * INTO _invitation
  FROM public.invitations
  WHERE lower(email) = _email AND accepted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF _invitation IS NULL THEN
    RAISE EXCEPTION 'Access denied: no valid invitation found for %', _email;
  END IF;

  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, _email, _full_name)
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _invitation.role)
  ON CONFLICT (user_id, role) DO NOTHING;

  FOREACH _app IN ARRAY COALESCE(_invitation.apps, ARRAY['popdam']::public.app_name[])
  LOOP
    INSERT INTO public.app_access (user_id, app, granted_by)
    VALUES (NEW.id, _app, _invitation.invited_by)
    ON CONFLICT (user_id, app) DO NOTHING;
  END LOOP;

  IF NEW.invited_at IS NULL OR NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.invitations
    SET accepted_at = now()
    WHERE id = _invitation.id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_user_confirmed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.invitations
    SET accepted_at = now()
    WHERE email = NEW.email AND accepted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_app_access(_user_id uuid, _app app_name)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = _user_id AND app = _app
  )
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$;

CREATE OR REPLACE FUNCTION public.infer_path_attrs(p_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  segs text[];
  idx  int;
  s    text;
  c1   text;
  cust text := NULL;
  prog text := NULL;
BEGIN
  IF p_path IS NULL OR p_path = '' THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;

  segs := string_to_array(p_path, '/');
  idx  := array_position(segs, '____New Structure');
  IF idx IS NULL THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;

  s := NULLIF(segs[idx + 1], '');
  IF s IS NULL THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;

  -- Customer / program are only reliably encoded in the "In Development / Customer Adopted" branch.
  IF s = 'In Development' AND segs[idx + 2] = 'Customer Adopted' THEN
    c1 := NULLIF(segs[idx + 3], '');
    IF c1 IS NULL THEN
      cust := NULL; prog := NULL;
    ELSIF c1 = '_FINISHED' THEN
      -- wrapper bucket: _FINISHED / <Customer>_finished / <Program> / <SKU>
      cust := NULLIF(regexp_replace(COALESCE(segs[idx + 4], ''), '_finished$', '', 'i'), '');
      prog := NULLIF(segs[idx + 5], '');
    ELSIF left(c1, 1) = '_' THEN
      -- status buckets (_NOT APPROVED, _REJECTED, _No Customer, _NOT SUBMITTED): no real customer
      cust := NULL; prog := NULL;
    ELSE
      cust := c1;
      prog := NULLIF(segs[idx + 4], '');
    END IF;

    -- Guard: the program slot must be a real program folder, not the SKU folder or a file.
    IF prog IS NOT NULL THEN
      IF prog ~ '\.[A-Za-z0-9]+$' THEN
        prog := NULL;  -- looks like a filename
      ELSIF prog !~ '[[:space:]]' AND prog ~ '^[A-Za-z]{1,6}[0-9][A-Za-z0-9]*$' AND length(prog) >= 8 THEN
        prog := NULL;  -- looks like a SKU code (no program folder present)
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('stage', s, 'customer', cust, 'program', prog);
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_style_guide_source_pdf(p_file_type text, p_filename text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_file_type = 'pdf' AND p_filename IS NOT NULL AND (
    p_filename ILIKE '%licensing sheet%' OR p_filename ILIKE '%licensing_sheet%' OR
    p_filename ILIKE '%license sheet%'   OR p_filename ILIKE '%license_sheet%'   OR
    p_filename ILIKE '%tech pack%'       OR p_filename ILIKE '%tech_pack%'       OR
    p_filename ILIKE '%techpack%'
  );
$function$;

CREATE OR REPLACE FUNCTION public.normalize_for_sg_match(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT regexp_replace(lower(regexp_replace(p, '\.[^.]+$', '')), '[^a-z0-9]', '', 'g')
$function$;

CREATE OR REPLACE FUNCTION public.parse_pdf_files_used(p_asset_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_sku     text;
  v_ftype   text;
  v_fname   text;
  v_text    text;
  v_lines   text[];
  v_in_sect boolean := false;
  v_line    text;
  v_trimmed text;
  v_count   int := 0;
  v_entry   text;
  v_inline  text;
BEGIN
  SELECT sku, file_type::text, filename INTO v_sku, v_ftype, v_fname FROM assets WHERE id = p_asset_id;
  IF v_sku IS NULL OR v_sku = '' THEN RETURN 0; END IF;

  -- Style Guide Sources are parsed ONLY from licensing-sheet / tech-pack PDFs.
  IF NOT public.is_style_guide_source_pdf(v_ftype, v_fname) THEN RETURN 0; END IF;

  SELECT extracted_text INTO v_text
  FROM pdf_text_samples
  WHERE asset_id = p_asset_id AND extracted_text IS NOT NULL
  ORDER BY sampled_at DESC LIMIT 1;
  IF v_text IS NULL THEN RETURN 0; END IF;

  v_lines := string_to_array(v_text, E'\n');
  FOREACH v_line IN ARRAY v_lines LOOP
    v_trimmed := trim(v_line);

    IF v_trimmed ~* '^\s*(files?\s+used|source\s+files?|art\s+files?|design\s+files?)\s*:' THEN
      v_in_sect := true;
      v_inline := trim(regexp_replace(v_trimmed, '(?i)^\s*(files?\s+used|source\s+files?|art\s+files?|design\s+files?)\s*:\s*', ''));
      IF v_inline <> '' THEN
        FOREACH v_entry IN ARRAY string_to_array(v_inline, ',') LOOP
          v_entry := trim(v_entry);
          IF v_entry <> '' AND length(v_entry) >= 2 AND NOT v_entry ~ '^\d+$' THEN
            INSERT INTO sku_files_used (sku, file_name, source)
            VALUES (v_sku, v_entry, 'pdf_text')
            ON CONFLICT (sku, file_name) DO NOTHING;
            v_count := v_count + 1;
          END IF;
        END LOOP;
        v_in_sect := false;
      END IF;
      CONTINUE;
    END IF;

    IF v_in_sect THEN
      IF v_trimmed = '' OR v_trimmed ~ '^\S[^:]*:\s*$' THEN
        v_in_sect := false;
        CONTINUE;
      END IF;
      IF v_trimmed ~ '^\d+$' OR length(v_trimmed) < 2 THEN CONTINUE; END IF;
      INSERT INTO sku_files_used (sku, file_name, source)
      VALUES (v_sku, v_trimmed, 'pdf_text')
      ON CONFLICT (sku, file_name) DO NOTHING;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.propagate_group_tags_batch(p_cursor uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 100)
 RETURNS TABLE(next_cursor uuid, propagated integer, skipped integer, done boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
 SET lock_timeout TO '0'
AS $function$
DECLARE
  v_next_cursor uuid;
  v_total_propagated int := 0;
  v_group_count int := 0;
  v_batch_propagated int;
  v_file_specific_tags text[] := ARRAY[
    'art_piece','art piece','product','product shot','product photo',
    'packaging','package','tech_pack','tech pack','technical pack',
    'photography','photo','mockup','mock up','mock-up',
    'front view','back view','side view','flat lay','flatlay',
    'render','3d render'
  ];
BEGIN
  FOR v_next_cursor IN
    SELECT sg.id
    FROM style_groups sg
    WHERE (p_cursor IS NULL OR sg.id > p_cursor)
    ORDER BY sg.id
    LIMIT p_batch_size
  LOOP
    v_group_count := v_group_count + 1;

    WITH source_asset AS (
      SELECT a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      FROM assets a
      WHERE a.style_group_id = v_next_cursor
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
      ORDER BY a.primary_sort_tier ASC, a.ai_tagged_at ASC
      LIMIT 1
    ),
    source_tags AS (
      SELECT at2.tag
      FROM asset_tags at2
      JOIN source_asset sa ON sa.id = at2.asset_id
      WHERE at2.source = 'ai'
        AND lower(trim(at2.tag)) != ALL(v_file_specific_tags)
    ),
    source_chars AS (
      SELECT ac.character_id
      FROM asset_characters ac
      JOIN source_asset sa ON sa.id = ac.asset_id
    ),
    siblings AS (
      SELECT a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      FROM assets a
      CROSS JOIN source_asset sa
      WHERE a.style_group_id = v_next_cursor
        AND a.is_deleted = false
        AND a.id != sa.id
    ),
    inserted_tags AS (
      INSERT INTO asset_tags (asset_id, tag, source)
      SELECT s.id, st.tag, 'ai'
      FROM siblings s
      CROSS JOIN source_tags st
      ON CONFLICT (asset_id, tag) DO NOTHING
      RETURNING 1
    ),
    inserted_chars AS (
      INSERT INTO asset_characters (asset_id, character_id)
      SELECT s.id, sc.character_id
      FROM siblings s
      CROSS JOIN source_chars sc
      ON CONFLICT (asset_id, character_id) DO NOTHING
      RETURNING 1
    ),
    meta_updates AS (
      UPDATE assets a
      SET
        licensor_id = COALESCE(a.licensor_id, sa.licensor_id),
        property_id = COALESCE(a.property_id, sa.property_id),
        is_licensed = CASE WHEN a.is_licensed = true THEN true ELSE COALESCE(sa.is_licensed, a.is_licensed) END,
        big_theme = COALESCE(a.big_theme, sa.big_theme),
        little_theme = COALESCE(a.little_theme, sa.little_theme),
        design_style = COALESCE(a.design_style, sa.design_style),
        cover_description = COALESCE(a.cover_description, sa.cover_description)
      FROM source_asset sa, siblings s
      WHERE a.id = s.id
        AND (
          (a.licensor_id IS NULL AND sa.licensor_id IS NOT NULL) OR
          (a.property_id IS NULL AND sa.property_id IS NOT NULL) OR
          (a.is_licensed IS NOT TRUE AND sa.is_licensed = true) OR
          (a.big_theme IS NULL AND sa.big_theme IS NOT NULL) OR
          (a.little_theme IS NULL AND sa.little_theme IS NOT NULL) OR
          (a.design_style IS NULL AND sa.design_style IS NOT NULL) OR
          (a.cover_description IS NULL AND sa.cover_description IS NOT NULL)
        )
      RETURNING 1
    )
    SELECT
      (SELECT count(*)::int FROM inserted_tags) + (SELECT count(*)::int FROM inserted_chars)
    INTO v_batch_propagated;

    v_total_propagated := v_total_propagated + COALESCE(v_batch_propagated, 0);
  END LOOP;

  RETURN QUERY SELECT
    v_next_cursor,
    v_total_propagated,
    0::int,
    (v_group_count < p_batch_size);
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_nightly_rebuild_style_groups()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current jsonb;
  v_status  text;
  v_now     timestamptz := now();
  v_state   jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  SELECT value INTO v_current
  FROM admin_config
  WHERE key = 'BULK_OPERATIONS';

  v_current := COALESCE(v_current, '{}'::jsonb);
  v_status  := v_current->'rebuild-style-groups'->>'status';

  -- Skip if already running or queued
  IF v_status IN ('running', 'queued') THEN
    RETURN;
  END IF;

  v_state := jsonb_build_object(
    'status',         'queued',
    'cursor',         0,
    'params',         jsonb_build_object('force_restart', true),
    'started_at',     v_now::text,
    'updated_at',     v_now::text,
    'progress',       '{}'::jsonb,
    'run_id',         gen_random_uuid()::text,
    'queue_position', (EXTRACT(EPOCH FROM v_now) * 1000)::bigint,
    'requested_by',   'pg_cron'
  );

  v_current := jsonb_set(v_current, ARRAY['rebuild-style-groups'], v_state);

  INSERT INTO admin_config (key, value, updated_at)
  VALUES ('BULK_OPERATIONS', v_current, v_now)
  ON CONFLICT (key) DO UPDATE
    SET value      = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_sg_render_jobs_by_ids(p_file_ids uuid[])
 RETURNS integer
 LANGUAGE sql
AS $function$
  WITH inserted AS (
    INSERT INTO public.style_guide_render_queue (style_guide_file_id)
    SELECT t.id
    FROM unnest(p_file_ids) AS t(id)
    JOIN public.style_guide_files f ON f.id = t.id
    WHERE f.thumbnail_url IS NULL
      AND f.thumbnail_error IS NULL
      AND lower(f.file_extension) IN ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
      AND NOT EXISTS (
        SELECT 1 FROM public.style_guide_render_queue q
        WHERE q.style_guide_file_id = t.id
          AND q.status IN ('pending', 'claimed')
      )
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_style_group_stats_batch(p_cursor uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 200, p_sub text DEFAULT 'counts'::text)
 RETURNS TABLE(next_cursor uuid, processed integer, sub text, done boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
 SET lock_timeout TO '0'
AS $function$
DECLARE
  v_ids uuid[];
  v_count int;
  v_last_id uuid;
  v_done boolean;
BEGIN
  -- Fetch batch of style_group IDs using keyset pagination
  SELECT array_agg(sg.id ORDER BY sg.id), count(*)::int
  INTO v_ids, v_count
  FROM (
    SELECT sg2.id
    FROM style_groups sg2
    WHERE (p_cursor IS NULL OR sg2.id > p_cursor)
    ORDER BY sg2.id
    LIMIT p_batch_size
  ) sg;

  v_done := (v_count < p_batch_size);

  IF v_count = 0 THEN
    -- No more groups in this sub-stage
    IF p_sub = 'counts' THEN
      -- Signal transition to primaries
      RETURN QUERY SELECT NULL::uuid, 0, 'counts_done'::text, false;
    ELSE
      -- Primaries done = fully complete
      RETURN QUERY SELECT NULL::uuid, 0, 'complete'::text, true;
    END IF;
    RETURN;
  END IF;

  v_last_id := v_ids[array_length(v_ids, 1)];

  IF p_sub = 'counts' THEN
    -- Refresh counts + latest_file_date for this batch
    PERFORM refresh_style_group_counts_batch(v_ids);

    IF v_done THEN
      -- Counts exhausted → signal transition
      RETURN QUERY SELECT v_last_id, v_count, 'counts_done'::text, false;
    ELSE
      RETURN QUERY SELECT v_last_id, v_count, 'counts'::text, false;
    END IF;

  ELSIF p_sub = 'primaries' THEN
    -- Refresh primary asset selection for this batch
    PERFORM refresh_style_group_primaries(v_ids);

    RETURN QUERY SELECT v_last_id, v_count, p_sub, v_done;

  ELSE
    RAISE EXCEPTION 'Unknown sub-stage: %', p_sub;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_group_on_asset_hard_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.style_group_id IS NOT NULL THEN
    PERFORM refresh_style_group_counts_batch(ARRAY[OLD.style_group_id]);
    PERFORM refresh_style_group_primaries(ARRAY[OLD.style_group_id]);
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_primary_on_asset_soft_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only act when this asset is currently the group's primary
  IF NEW.style_group_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM style_groups
       WHERE id = NEW.style_group_id
         AND primary_asset_id = NEW.id
     )
  THEN
    PERFORM refresh_style_group_primaries(ARRAY[NEW.style_group_id]);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_style_group_counts()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  UPDATE public.style_groups sg
  SET
    asset_count = COALESCE(agg.asset_count, 0),
    latest_file_date = agg.latest_file_date,
    updated_at = now()
  FROM (
    SELECT
      sg2.id AS style_group_id,
      COUNT(a.id)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.style_groups sg2
    LEFT JOIN public.assets a
      ON a.style_group_id = sg2.id
      AND a.is_deleted = false
    GROUP BY sg2.id
  ) agg
  WHERE sg.id = agg.style_group_id;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_batch(p_group_ids uuid[])
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
 SET lock_timeout TO '0'
AS $function$
  WITH agg AS (
    SELECT
      sg.id AS style_group_id,
      COUNT(a.id)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id
      AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    GROUP BY sg.id
  ),
  upd AS (
    UPDATE public.style_groups sg
    SET
      asset_count             = agg.asset_count,
      latest_file_date        = agg.latest_file_date,
      -- Clear primary fields for empty groups so they disappear from the library
      primary_asset_id        = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_id END,
      primary_asset_type      = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_type END,
      primary_thumbnail_url   = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_url END,
      primary_thumbnail_error = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_error END,
      updated_at              = now()
    FROM agg
    WHERE sg.id = agg.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_on_asset_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT style_group_id)
      INTO v_group_ids
      FROM new_table
     WHERE style_group_id IS NOT NULL;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT style_group_id)
      INTO v_group_ids
      FROM old_table
     WHERE style_group_id IS NOT NULL;

  ELSE -- UPDATE: only care about rows where is_deleted or style_group_id actually changed
    SELECT array_agg(DISTINCT grp)
      INTO v_group_ids
      FROM (
        SELECT o.style_group_id AS grp
          FROM old_table o
          JOIN new_table n ON n.id = o.id
         WHERE (o.is_deleted IS DISTINCT FROM n.is_deleted
                OR o.style_group_id IS DISTINCT FROM n.style_group_id)
           AND o.style_group_id IS NOT NULL
        UNION
        SELECT n.style_group_id AS grp
          FROM old_table o
          JOIN new_table n ON n.id = o.id
         WHERE (o.is_deleted IS DISTINCT FROM n.is_deleted
                OR o.style_group_id IS DISTINCT FROM n.style_group_id)
           AND n.style_group_id IS NOT NULL
      ) t;
  END IF;

  IF v_group_ids IS NOT NULL AND array_length(v_group_ids, 1) > 0 THEN
    PERFORM public.refresh_style_group_counts_batch(v_group_ids);
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_style_group_primaries(p_group_ids uuid[])
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
 SET lock_timeout TO '0'
AS $function$
  WITH picked AS (
    SELECT DISTINCT ON (sg.id)
      sg.id AS style_group_id,
      a.id AS primary_asset_id,
      a.asset_type::text AS primary_asset_type,
      a.thumbnail_url AS primary_thumbnail_url,
      a.thumbnail_error AS primary_thumbnail_error
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    ORDER BY sg.id, a.primary_sort_tier ASC, a.created_at ASC
  ),
  upd AS (
    UPDATE public.style_groups sg SET
      primary_asset_id = picked.primary_asset_id,
      primary_asset_type = picked.primary_asset_type,
      primary_thumbnail_url = picked.primary_thumbnail_url,
      primary_thumbnail_error = picked.primary_thumbnail_error,
      updated_at = now()
    FROM picked WHERE sg.id = picked.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_style_guide_matviews()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.style_guide_file_groups;
  REFRESH MATERIALIZED VIEW public.style_guide_folders;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requeue_all_failed_sg_jobs(p_limit integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  UPDATE public.style_guide_render_queue
  SET
    status        = 'pending',
    error_message = NULL,
    completed_at  = NULL,
    claimed_at    = NULL,
    claimed_by    = NULL
  WHERE id IN (
    SELECT id FROM public.style_guide_render_queue
    WHERE status = 'failed'
    LIMIT p_limit
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_stale_jobs(p_timeout_minutes integer DEFAULT 30)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected int;
BEGIN
  UPDATE public.processing_queue
  SET status = 'pending', agent_id = NULL, claimed_at = NULL
  WHERE status IN ('claimed', 'processing')
    AND claimed_at < now() - (p_timeout_minutes || ' minutes')::interval;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_sku_files_used()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE v_count int;
BEGIN
  UPDATE sku_files_used u
  SET style_guide_file_id = (
    SELECT s.id
    FROM style_guide_files s
    WHERE s.is_active = true
      AND normalize_for_sg_match(s.filename) = normalize_for_sg_match(u.file_name)
    ORDER BY s.modified_at DESC NULLS LAST
    LIMIT 1
  )
  WHERE style_guide_file_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_sku_files_used_fuzzy(p_threshold real DEFAULT 0.6)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  r        record;
  v_id     uuid;
  v_score  real;
  v_linked int := 0;
BEGIN
  FOR r IN
    SELECT id, file_name FROM sku_files_used WHERE style_guide_file_id IS NULL
  LOOP
    v_id := NULL; v_score := NULL;

    SELECT f.id, similarity(lower(f.filename), lower(r.file_name))
      INTO v_id, v_score
    FROM style_guide_files f
    WHERE f.is_active AND lower(f.filename) % lower(r.file_name)
    ORDER BY similarity(lower(f.filename), lower(r.file_name)) DESC
    LIMIT 1;

    UPDATE sku_files_used
       SET style_guide_file_id  = CASE WHEN v_score >= p_threshold THEN v_id
                                       ELSE style_guide_file_id END,
           match_best_score      = GREATEST(COALESCE(match_best_score, 0), COALESCE(v_score, 0)),
           match_attempts        = match_attempts + 1,
           last_match_attempt_at = now()
     WHERE id = r.id;

    IF v_id IS NOT NULL AND v_score >= p_threshold THEN v_linked := v_linked + 1; END IF;
  END LOOP;
  RETURN v_linked;
END;
$function$;

CREATE OR REPLACE FUNCTION public.retry_sg_render_errors(p_file_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids    uuid[];
  v_queued int;
BEGIN
  SELECT ARRAY_AGG(id) INTO v_ids
  FROM (
    SELECT id
    FROM public.style_guide_files
    WHERE is_active
      AND thumbnail_url IS NULL
      AND thumbnail_error IS NOT NULL
      AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
      AND (p_file_ids IS NULL OR id = ANY(p_file_ids))
    LIMIT CASE WHEN p_file_ids IS NULL THEN p_limit ELSE NULL END
  ) sub;

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.style_guide_files SET thumbnail_error = NULL WHERE id = ANY(v_ids);
  SELECT public.queue_sg_render_jobs_by_ids(v_ids) INTO v_queued;
  RETURN v_queued;
END;
$function$;

CREATE OR REPLACE FUNCTION public.retry_sg_render_errors(p_file_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_queued int;
BEGIN
  -- Disable statement timeout for this bulk operation; it may touch tens of thousands of rows.
  SET LOCAL statement_timeout = 0;

  SELECT ARRAY_AGG(id) INTO v_ids
  FROM public.style_guide_files
  WHERE is_active
    AND thumbnail_url IS NULL
    AND thumbnail_error IS NOT NULL
    AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
    AND (p_file_ids IS NULL OR id = ANY(p_file_ids));

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.style_guide_files SET thumbnail_error = NULL WHERE id = ANY(v_ids);
  SELECT public.queue_sg_render_jobs_by_ids(v_ids) INTO v_queued;
  RETURN v_queued;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_full_reconcile_style_group_stats()
 RETURNS TABLE(counts_updated integer, primaries_updated integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_cursor         uuid := NULL;
  v_batch_ids      uuid[];
  v_batch_size     int  := 500;
  v_batch_count    int;
  v_counts_updated int  := 0;
  v_prim_updated   int  := 0;
BEGIN
  -- Phase 1: recompute asset_count for every group in one UPDATE+JOIN pass;
  --          also clears primary fields on groups that are now empty.
  WITH agg AS (
    SELECT
      sg.id                        AS style_group_id,
      COUNT(a.id)::integer         AS asset_count,
      MAX(a.modified_at)           AS latest_file_date
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id AND a.is_deleted = false
    GROUP BY sg.id
  ),
  upd AS (
    UPDATE public.style_groups sg SET
      asset_count             = agg.asset_count,
      latest_file_date        = agg.latest_file_date,
      primary_asset_id        = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_id        END,
      primary_asset_type      = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_type      END,
      primary_thumbnail_url   = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_url   END,
      primary_thumbnail_error = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_error END,
      updated_at              = now()
    FROM agg
    WHERE sg.id = agg.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_counts_updated FROM upd;

  -- Phase 2: re-pick primary asset for every group, batched to avoid huge arrays.
  LOOP
    SELECT array_agg(id ORDER BY id), COUNT(*)::int
    INTO v_batch_ids, v_batch_count
    FROM (
      SELECT id FROM public.style_groups
      WHERE (v_cursor IS NULL OR id > v_cursor)
      ORDER BY id
      LIMIT v_batch_size
    ) sub;

    EXIT WHEN v_batch_count = 0;

    PERFORM public.refresh_style_group_primaries(v_batch_ids);
    v_prim_updated := v_prim_updated + v_batch_count;
    v_cursor := v_batch_ids[array_length(v_batch_ids, 1)];

    EXIT WHEN v_batch_count < v_batch_size;
  END LOOP;

  RETURN QUERY SELECT v_counts_updated, v_prim_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_assets_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_style_group_cover(p_group_id uuid, p_asset_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_asset assets%ROWTYPE;
BEGIN
  -- Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Fetch the asset and verify it belongs to this style group
  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id AND is_deleted = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;
  IF v_asset.style_group_id IS DISTINCT FROM p_group_id THEN
    RAISE EXCEPTION 'Asset does not belong to this style group';
  END IF;

  -- Update only the cover columns
  UPDATE public.style_groups
  SET
    primary_asset_id        = p_asset_id,
    primary_asset_type      = v_asset.asset_type,
    primary_thumbnail_url   = v_asset.thumbnail_url,
    primary_thumbnail_error = v_asset.thumbnail_error,
    updated_at              = now()
  WHERE id = p_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_asset_tags_to_array()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_asset_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_asset_id := OLD.asset_id;
  ELSE
    v_asset_id := NEW.asset_id;
  END IF;

  UPDATE public.assets
  SET tags = COALESCE(
    (SELECT array_agg(at.tag ORDER BY at.tag) FROM public.asset_tags at WHERE at.asset_id = v_asset_id),
    '{}'::text[]
  )
  WHERE id = v_asset_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_cover_description_to_style_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id uuid;
  v_desc text;
BEGIN
  v_group_id := NEW.style_group_id;
  IF v_group_id IS NULL THEN RETURN NEW; END IF;

  -- Use cover_description from the group's primary asset, or fallback to first non-null in group
  SELECT COALESCE(
    (SELECT a.cover_description FROM public.assets a
     JOIN public.style_groups sg ON sg.primary_asset_id = a.id
     WHERE sg.id = v_group_id AND a.cover_description IS NOT NULL),
    (SELECT a.cover_description FROM public.assets a
     WHERE a.style_group_id = v_group_id AND a.is_deleted = false AND a.cover_description IS NOT NULL
     LIMIT 1)
  ) INTO v_desc;

  UPDATE public.style_groups
  SET cover_description = v_desc, updated_at = now()
  WHERE id = v_group_id AND (cover_description IS DISTINCT FROM v_desc);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_designer_to_style_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id uuid;
  v_conflict boolean := false;
  v_designer text;
  v_tech_designer text;
  v_freelancer text;
  v_designers text[];
  v_tech_designers text[];
  v_freelancers text[];
BEGIN
  v_group_id := NEW.style_group_id;
  IF v_group_id IS NULL THEN RETURN NEW; END IF;

  SELECT
    array_agg(DISTINCT a.designer_name) FILTER (WHERE a.designer_name IS NOT NULL),
    array_agg(DISTINCT a.technical_designer_name) FILTER (WHERE a.technical_designer_name IS NOT NULL),
    array_agg(DISTINCT a.freelancer_name) FILTER (WHERE a.freelancer_name IS NOT NULL)
  INTO v_designers, v_tech_designers, v_freelancers
  FROM public.assets a
  WHERE a.style_group_id = v_group_id AND a.is_deleted = false;

  v_designer := v_designers[1];
  v_tech_designer := v_tech_designers[1];
  v_freelancer := v_freelancers[1];

  IF array_length(v_designers, 1) > 1
     OR array_length(v_tech_designers, 1) > 1
     OR array_length(v_freelancers, 1) > 1 THEN
    v_conflict := true;
  END IF;

  UPDATE public.style_groups
  SET designer_name = v_designer,
      technical_designer_name = v_tech_designer,
      freelancer_name = v_freelancer,
      designer_conflict = v_conflict,
      updated_at = now()
  WHERE id = v_group_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_primary_asset_on_thumbnail()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.style_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Case 1: Group has no primary — assign when asset has a thumbnail.
  -- Covers INSERT (asset indexed with thumbnail already set) and
  -- UPDATE where thumbnail just appeared (OLD.thumbnail_url IS NULL).
  IF NEW.thumbnail_url IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.thumbnail_url IS NULL)
  THEN
    UPDATE public.style_groups sg
    SET primary_asset_id        = NEW.id,
        primary_asset_type      = NEW.asset_type::text,
        primary_thumbnail_url   = NEW.thumbnail_url,
        primary_thumbnail_error = NEW.thumbnail_error,
        updated_at              = now()
    WHERE sg.id = NEW.style_group_id
      AND sg.primary_asset_id IS NULL;
  END IF;

  -- Case 2: This asset IS already the primary — keep cached fields in sync.
  UPDATE public.style_groups sg
  SET primary_thumbnail_url   = NEW.thumbnail_url,
      primary_thumbnail_error = NEW.thumbnail_error,
      updated_at              = now()
  WHERE sg.id = NEW.style_group_id
    AND sg.primary_asset_id = NEW.id
    AND (sg.primary_thumbnail_url  IS DISTINCT FROM NEW.thumbnail_url
         OR sg.primary_thumbnail_error IS DISTINCT FROM NEW.thumbnail_error);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_parse_pdf_files_used()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Allow bulk-insert RPC to suppress this per-row trigger via session variable
  IF current_setting('app.skip_parse_pdf_trigger', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.asset_id IS NOT NULL AND NEW.extracted_text IS NOT NULL THEN
    PERFORM parse_pdf_files_used(NEW.asset_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_resolve_sku_file_used()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.style_guide_file_id IS NULL THEN
    SELECT id INTO NEW.style_guide_file_id
    FROM style_guide_files
    WHERE is_active = true
      AND normalize_for_sg_match(filename) = normalize_for_sg_match(NEW.file_name)
    ORDER BY modified_at DESC NULLS LAST
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_set_asset_path_attrs()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE j jsonb;
BEGIN
  j := public.infer_path_attrs(NEW.relative_path);
  NEW.stage    := j ->> 'stage';
  NEW.customer := j ->> 'customer';
  NEW.program  := j ->> 'program';
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_set_sg_path_attrs()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE j jsonb;
BEGIN
  j := public.infer_path_attrs(NEW.folder_path);
  NEW.stage    := j ->> 'stage';
  NEW.customer := j ->> 'customer';
  NEW.program  := j ->> 'program';
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_asset_checkouts_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;


-- Second pass: resolves forward references between the functions above.

CREATE OR REPLACE FUNCTION public.auto_queue_render()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Skip junk files (macOS resource forks, system files)
  IF NEW.filename LIKE '._%' OR
     NEW.filename = '.DS_Store' OR
     NEW.filename = '.localized' OR
     NEW.filename = 'Thumbs.db' OR
     NEW.filename = 'desktop.ini' OR
     NEW.filename LIKE '~%' THEN
    RETURN NEW;
  END IF;

  -- Queue ANY file type that has a thumbnail error and no thumbnail
  IF NEW.thumbnail_error IS NOT NULL
     AND NEW.thumbnail_url IS NULL THEN
    INSERT INTO public.render_queue (asset_id, status)
    VALUES (NEW.id, 'pending')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_pdf_files_used()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id    uuid;
  v_total int := 0;
BEGIN
  FOR v_id IN (
    SELECT DISTINCT asset_id
    FROM pdf_text_samples
    WHERE asset_id IS NOT NULL
      AND extracted_text IS NOT NULL
      AND char_count > 100
  ) LOOP
    v_total := v_total + parse_pdf_files_used(v_id);
  END LOOP;
  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_assign_style_groups(p_assignments jsonb)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH rows AS (
    SELECT
      (x->>'asset_id')::uuid AS asset_id,
      (x->>'style_group_id')::uuid AS style_group_id
    FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb)) AS x
  ),
  upd AS (
    UPDATE public.assets a
    SET style_group_id = r.style_group_id
    FROM rows r
    WHERE a.id = r.asset_id
      AND a.is_deleted = false
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_insert_pdf_text_samples(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_count int;
BEGIN
  SET LOCAL app.skip_parse_pdf_trigger = '1';

  INSERT INTO pdf_text_samples (
    asset_id, filename, relative_path, extraction_method,
    extracted_text, page_count, char_count, extraction_error,
    thumbnail_url, sampled_at
  )
  SELECT
    NULLIF(elem->>'asset_id', '')::uuid,
    elem->>'filename',
    elem->>'relative_path',
    elem->>'extraction_method',
    NULLIF(elem->>'extracted_text', ''),
    (elem->>'page_count')::int,
    COALESCE((elem->>'char_count')::int, 0),
    NULLIF(elem->>'extraction_error', ''),
    NULLIF(elem->>'thumbnail_url', ''),
    now()
  FROM jsonb_array_elements(p_rows) AS elem
  ON CONFLICT (asset_id) DO UPDATE SET
    filename          = EXCLUDED.filename,
    relative_path     = EXCLUDED.relative_path,
    extraction_method = EXCLUDED.extraction_method,
    extracted_text    = EXCLUDED.extracted_text,
    page_count        = EXCLUDED.page_count,
    char_count        = EXCLUDED.char_count,
    extraction_error  = EXCLUDED.extraction_error,
    thumbnail_url     = EXCLUDED.thumbnail_url,
    sampled_at        = EXCLUDED.sampled_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_jobs(p_agent_id text, p_batch_size integer DEFAULT 5)
 RETURNS SETOF processing_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.processing_queue
  SET status = 'claimed', agent_id = p_agent_id, claimed_at = now()
  WHERE id IN (
    SELECT id FROM public.processing_queue
    WHERE status = 'pending'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  RETURNING *;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_pdf_backfill_batch(p_limit integer DEFAULT 25)
 RETURNS TABLE(id uuid, filename text, relative_path text, needs_thumbnail boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    a.id,
    a.filename,
    a.relative_path,
    (a.thumbnail_url IS NULL) AS needs_thumbnail
  FROM assets a
  WHERE a.is_deleted = false
    AND public.is_style_guide_source_pdf(a.file_type::text, a.filename)
    AND NOT EXISTS (
      SELECT 1 FROM pdf_text_samples pts WHERE pts.asset_id = a.id
    )
  ORDER BY a.id
  LIMIT p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.claim_render_jobs(p_agent_id text, p_batch_size integer DEFAULT 1, p_lease_minutes integer DEFAULT 5, p_max_attempts integer DEFAULT 5)
 RETURNS TABLE(id uuid, asset_id uuid, attempts integer, lease_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT rq.id
    FROM render_queue rq
    WHERE (
      -- Pending jobs
      rq.status = 'pending'
      OR
      -- Expired-lease claimed jobs (crashed agent)
      (rq.status = 'claimed' AND rq.lease_expires_at IS NOT NULL AND rq.lease_expires_at < now())
    )
    AND rq.attempts < p_max_attempts
    ORDER BY rq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE render_queue rq
  SET
    status = 'claimed',
    claimed_by = p_agent_id,
    claimed_at = now(),
    lease_expires_at = now() + (p_lease_minutes || ' minutes')::interval,
    attempts = rq.attempts + 1
  FROM claimable
  WHERE rq.id = claimable.id
  RETURNING rq.id, rq.asset_id, rq.attempts, rq.lease_expires_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_sg_render_jobs(p_agent_id text, p_batch_size integer DEFAULT 1, p_lease_minutes integer DEFAULT 5, p_max_attempts integer DEFAULT 3)
 RETURNS TABLE(id uuid, style_guide_file_id uuid, attempts integer, lease_expires_at timestamp with time zone)
 LANGUAGE sql
AS $function$
  UPDATE public.style_guide_render_queue q
  SET
    status = 'claimed',
    claimed_by = p_agent_id,
    claimed_at = now(),
    lease_expires_at = now() + (p_lease_minutes || ' minutes')::interval,
    attempts = q.attempts + 1
  WHERE q.id IN (
    SELECT id FROM public.style_guide_render_queue
    WHERE
      (status = 'pending' OR (status = 'claimed' AND lease_expires_at < now()))
      AND attempts < p_max_attempts
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  RETURNING q.id, q.style_guide_file_id, q.attempts, q.lease_expires_at;
$function$;

CREATE OR REPLACE FUNCTION public.claim_tiff_jobs(p_agent_id text, p_batch_size integer DEFAULT 1, p_lease_minutes integer DEFAULT 10)
 RETURNS TABLE(id uuid, relative_path text, filename text, file_size bigint, file_modified_at timestamp with time zone, file_created_at timestamp with time zone, mode text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH claimable AS (
    SELECT tq.id
    FROM tiff_optimization_queue tq
    WHERE tq.status IN ('queued_test', 'queued_process')
    ORDER BY tq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  UPDATE tiff_optimization_queue tq
  SET
    status = 'processing',
    claimed_by = p_agent_id,
    claimed_at = now()
  FROM claimable
  WHERE tq.id = claimable.id
  RETURNING tq.id, tq.relative_path, tq.filename, tq.file_size, tq.file_modified_at, tq.file_created_at,
    CASE WHEN tq.status = 'queued_test' THEN 'test' ELSE 'process' END AS mode;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_mega_group_tags_batch()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM asset_tags
  WHERE ctid IN (
    SELECT at2.ctid
    FROM asset_tags at2
    JOIN assets a ON a.id = at2.asset_id
    WHERE at2.source = 'ai'
      AND a.style_group_id IN (
        '038e1fda-f413-495d-981a-f2bfbe3b604e',
        '0ef04984-f645-469b-9775-a0c8e3eb416a',
        '6241f8d1-1c75-4e4c-918f-28e73d8f3bc3',
        '2f8c7f5e-a76d-4310-b571-7202e847cb76',
        '4978fbe3-d604-477b-abe0-536cad1d706b',
        'ac2bbd81-648f-43a1-b1cf-4bb0bdd78d79'
      )
      AND a.ai_tagged_at IS NULL
      AND a.is_deleted = false
    LIMIT 10000
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_mega_group_tags_batch(p_cursor uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 5, p_min_group_size integer DEFAULT 50)
 RETURNS TABLE(next_cursor uuid, groups_processed integer, tags_deleted integer, characters_deleted integer, metadata_cleared integer, done boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_group record;
  v_groups_processed int := 0;
  v_tags_deleted int := 0;
  v_chars_deleted int := 0;
  v_meta_cleared int := 0;
  v_last_id uuid;
  v_group_count int := 0;
  v_batch_tags int;
  v_batch_chars int;
  v_batch_meta int;
BEGIN
  FOR v_group IN
    SELECT sg.id
    FROM style_groups sg
    WHERE sg.asset_count >= p_min_group_size
      AND (p_cursor IS NULL OR sg.id > p_cursor)
    ORDER BY sg.id
    LIMIT p_batch_size
  LOOP
    v_group_count := v_group_count + 1;
    v_last_id := v_group.id;

    -- 1) Delete contaminated tags from NON-directly-tagged assets (ai_tagged_at IS NULL)
    --    These assets only have propagated tags — delete all AI tags.
    WITH non_tagged_assets AS (
      SELECT a.id FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
    ),
    del_tags_null AS (
      DELETE FROM asset_tags at
      USING non_tagged_assets nta
      WHERE at.asset_id = nta.id
        AND at.source = 'ai'
      RETURNING 1
    ),
    -- 2) Delete contaminated tags from DIRECTLY-tagged assets
    --    Keep tags created within 5 min of ai_tagged_at; delete the rest.
    tagged_assets AS (
      SELECT a.id, a.ai_tagged_at FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
    ),
    del_tags_late AS (
      DELETE FROM asset_tags at
      USING tagged_assets ta
      WHERE at.asset_id = ta.id
        AND at.source = 'ai'
        AND at.created_at > ta.ai_tagged_at + interval '5 minutes'
      RETURNING 1
    )
    SELECT
      (SELECT count(*) FROM del_tags_null) + (SELECT count(*) FROM del_tags_late)
    INTO v_batch_tags;

    v_tags_deleted := v_tags_deleted + COALESCE(v_batch_tags, 0);

    -- 3) Delete contaminated asset_characters (same logic)
    WITH non_tagged_assets AS (
      SELECT a.id FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
    ),
    del_chars_null AS (
      DELETE FROM asset_characters ac
      USING non_tagged_assets nta
      WHERE ac.asset_id = nta.id
      RETURNING 1
    ),
    tagged_assets AS (
      SELECT a.id, a.ai_tagged_at FROM assets a
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
    )
    SELECT (SELECT count(*) FROM del_chars_null)
    INTO v_batch_chars;

    v_chars_deleted := v_chars_deleted + COALESCE(v_batch_chars, 0);

    -- 4) Clear propagated metadata on non-tagged assets
    WITH cleared AS (
      UPDATE assets a
      SET
        big_theme = NULL,
        little_theme = NULL,
        design_style = NULL,
        cover_description = NULL
      WHERE a.style_group_id = v_group.id
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NULL
        AND (a.big_theme IS NOT NULL OR a.little_theme IS NOT NULL
             OR a.design_style IS NOT NULL OR a.cover_description IS NOT NULL)
      RETURNING 1
    )
    SELECT count(*) INTO v_batch_meta FROM cleared;

    v_meta_cleared := v_meta_cleared + COALESCE(v_batch_meta, 0);
    v_groups_processed := v_groups_processed + 1;
  END LOOP;

  RETURN QUERY SELECT
    v_last_id,
    v_groups_processed,
    v_tags_deleted,
    v_chars_deleted,
    v_meta_cleared,
    (v_group_count < p_batch_size);
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_style_group_batch(p_last_id uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 200)
 RETURNS TABLE(cleared_count integer, last_id uuid, has_more boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
 SET lock_timeout TO '0'
AS $function$
DECLARE
  v_start_id uuid := COALESCE(p_last_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_cleared integer;
  v_last uuid;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    p_batch_size := 1;
  END IF;

  WITH batch AS (
    SELECT a.id
    FROM public.assets a
    WHERE a.is_deleted = false
      AND a.style_group_id IS NOT NULL
      AND a.id > v_start_id
    ORDER BY a.id ASC
    LIMIT p_batch_size
  ),
  upd AS (
    UPDATE public.assets a
    SET style_group_id = NULL
    FROM batch b
    WHERE a.id = b.id
    RETURNING a.id
  )
  SELECT COUNT(*)::integer,
         (SELECT u.id FROM upd u ORDER BY u.id DESC LIMIT 1)
  INTO v_cleared, v_last
  FROM upd;

  RETURN QUERY SELECT
    COALESCE(v_cleared, 0),
    v_last,
    COALESCE(v_cleared, 0) = p_batch_size;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_primary_sort_tier()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  fn        text    := lower(NEW.filename);
  base_name text    := lower(regexp_replace(NEW.filename, '\.[^.]+$', ''));
  has_thumb boolean := (NEW.thumbnail_url IS NOT NULL AND NEW.thumbnail_error IS NULL);
  is_photo34   boolean := (base_name LIKE '%3-4%');
  is_mockup    boolean := (fn LIKE '%mockup%' OR fn LIKE '%mock up%');
  is_art       boolean := (fn LIKE '%art%');
  is_techpack  boolean := (fn LIKE '%tech pack%' OR fn LIKE '%techpack%' OR fn LIKE '%tech_pack%');
  is_pkg       boolean := (fn LIKE '%packaging%');
BEGIN
  IF    is_photo34                                                              THEN NEW.primary_sort_tier :=  1;
  ELSIF is_mockup   AND has_thumb                                               THEN NEW.primary_sort_tier :=  2;
  ELSIF is_art      AND has_thumb                                               THEN NEW.primary_sort_tier :=  3;
  ELSIF is_techpack AND has_thumb                                               THEN NEW.primary_sort_tier :=  4;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_techpack AND NOT is_pkg
        AND has_thumb                                                           THEN NEW.primary_sort_tier :=  5;
  ELSIF is_pkg      AND has_thumb                                               THEN NEW.primary_sort_tier :=  6;
  ELSIF is_mockup                                                               THEN NEW.primary_sort_tier :=  7;
  ELSIF is_art                                                                  THEN NEW.primary_sort_tier :=  8;
  ELSIF is_techpack                                                             THEN NEW.primary_sort_tier :=  9;
  ELSIF NOT is_mockup AND NOT is_art AND NOT is_techpack AND NOT is_pkg         THEN NEW.primary_sort_tier := 10;
  ELSE                                                                               NEW.primary_sort_tier := 11;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.count_pdf_backfill_remaining()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT COUNT(*)
  FROM assets a
  WHERE a.is_deleted = false
    AND public.is_style_guide_source_pdf(a.file_type::text, a.filename)
    AND NOT EXISTS (
      SELECT 1 FROM pdf_text_samples pts WHERE pts.asset_id = a.id
    );
$function$;

CREATE OR REPLACE FUNCTION public.deactivate_stale_sg_files(p_root_label text, p_run_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE style_guide_files
  SET is_active = false
  WHERE root_label = p_root_label
    AND crawl_run_id != p_run_id
    AND is_active = true;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_readonly_query(query_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '15s'
AS $function$
DECLARE
  result jsonb;
  trimmed text;
BEGIN
  trimmed := lower(trim(query_text));
  
  -- Allow SELECT and WITH...SELECT (CTEs)
  IF NOT (trimmed ~ '^select\s' OR trimmed ~ '^with\s') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;
  
  IF trimmed ~ '\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute)\b' THEN
    RAISE EXCEPTION 'Query contains forbidden keywords';
  END IF;

  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;
  
  RETURN COALESCE(result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_ai_pdf_duplicates()
 RETURNS TABLE(id uuid, filename text, relative_path text, thumbnail_url text, style_group_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT
    a.id,
    a.filename,
    a.relative_path,
    a.thumbnail_url,
    a.style_group_id
  FROM assets a
  WHERE a.file_type = 'ai'
    AND a.is_deleted = false
    AND EXISTS (
      SELECT 1 FROM assets p
      WHERE p.file_type = 'pdf'
        AND p.is_deleted = false
        -- Same directory (everything before the last slash, or empty string for root)
        AND regexp_replace(p.relative_path, '/[^/]*$', '') = regexp_replace(a.relative_path, '/[^/]*$', '')
        -- Same base filename, case-insensitive (strip final extension)
        AND lower(regexp_replace(p.filename, '\.[^.]+$', '')) = lower(regexp_replace(a.filename, '\.[^.]+$', ''))
    )
  ORDER BY a.relative_path;
$function$;

CREATE OR REPLACE FUNCTION public.get_filter_counts(p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_min_date timestamptz;
  v_search text;
  v_file_types text[];
  v_statuses text[];
  v_workflow_statuses text[];
  v_is_licensed boolean;
  v_licensor_id uuid;
  v_property_id uuid;
  v_asset_types text[];
  v_art_sources text[];
  v_tag_filter text;
  v_stages text[];
  v_customer text;
  v_program text;
  v_result jsonb := '{}'::jsonb;
BEGIN
  SELECT (value #>> '{}')::timestamptz INTO v_min_date
  FROM admin_config WHERE key = 'THUMBNAIL_MIN_DATE';
  IF v_min_date IS NULL THEN
    v_min_date := '2020-01-01'::timestamptz;
  END IF;

  v_search := p_filters ->> 'search';
  v_is_licensed := (p_filters ->> 'isLicensed')::boolean;
  v_licensor_id := (p_filters ->> 'licensorId')::uuid;
  v_property_id := (p_filters ->> 'propertyId')::uuid;
  v_tag_filter := p_filters ->> 'tagFilter';
  v_customer := p_filters ->> 'customer';
  v_program := p_filters ->> 'program';

  IF p_filters ? 'fileType' AND jsonb_array_length(p_filters -> 'fileType') > 0 THEN
    SELECT array_agg(x::text) INTO v_file_types FROM jsonb_array_elements_text(p_filters -> 'fileType') x;
  END IF;
  IF p_filters ? 'status' AND jsonb_array_length(p_filters -> 'status') > 0 THEN
    SELECT array_agg(x::text) INTO v_statuses FROM jsonb_array_elements_text(p_filters -> 'status') x;
  END IF;
  IF p_filters ? 'workflowStatus' AND jsonb_array_length(p_filters -> 'workflowStatus') > 0 THEN
    SELECT array_agg(x::text) INTO v_workflow_statuses FROM jsonb_array_elements_text(p_filters -> 'workflowStatus') x;
  END IF;
  IF p_filters ? 'assetType' AND jsonb_array_length(p_filters -> 'assetType') > 0 THEN
    SELECT array_agg(x::text) INTO v_asset_types FROM jsonb_array_elements_text(p_filters -> 'assetType') x;
  END IF;
  IF p_filters ? 'artSource' AND jsonb_array_length(p_filters -> 'artSource') > 0 THEN
    SELECT array_agg(x::text) INTO v_art_sources FROM jsonb_array_elements_text(p_filters -> 'artSource') x;
  END IF;
  IF p_filters ? 'stage' AND jsonb_array_length(p_filters -> 'stage') > 0 THEN
    SELECT array_agg(x::text) INTO v_stages FROM jsonb_array_elements_text(p_filters -> 'stage') x;
  END IF;

  WITH base AS MATERIALIZED (
    SELECT file_type, status, workflow_status, stage, is_licensed
    FROM assets
    WHERE is_deleted = false
      AND (modified_at >= v_min_date OR file_created_at >= v_min_date OR thumbnail_url IS NOT NULL)
      AND (v_search IS NULL OR filename ILIKE '%' || v_search || '%')
      AND (v_licensor_id IS NULL OR licensor_id = v_licensor_id)
      AND (v_property_id IS NULL OR property_id = v_property_id)
      AND (v_asset_types IS NULL OR asset_type::text = ANY(v_asset_types))
      AND (v_art_sources IS NULL OR art_source::text = ANY(v_art_sources))
      AND (v_tag_filter IS NULL OR v_tag_filter = ANY(tags))
      AND (v_customer IS NULL OR customer = v_customer)
      AND (v_program IS NULL OR program = v_program)
  )
  SELECT jsonb_build_object(
    'fileType', COALESCE((
      SELECT jsonb_object_agg(file_type::text, cnt) FROM (
        SELECT file_type, count(*) AS cnt FROM base
        WHERE (v_statuses IS NULL OR status::text = ANY(v_statuses))
          AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
          AND (v_stages IS NULL OR stage = ANY(v_stages))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY file_type
      ) s
    ), '{}'::jsonb),
    'status', COALESCE((
      SELECT jsonb_object_agg(status::text, cnt) FROM (
        SELECT status, count(*) AS cnt FROM base
        WHERE (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
          AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
          AND (v_stages IS NULL OR stage = ANY(v_stages))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY status
      ) s
    ), '{}'::jsonb),
    'workflowStatus', COALESCE((
      SELECT jsonb_object_agg(workflow_status, cnt) FROM (
        SELECT workflow_status, count(*) AS cnt FROM base
        WHERE workflow_status IS NOT NULL
          AND (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
          AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
          AND (v_stages IS NULL OR stage = ANY(v_stages))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY workflow_status
      ) s
    ), '{}'::jsonb),
    'stage', COALESCE((
      SELECT jsonb_object_agg(stage, cnt) FROM (
        SELECT stage, count(*) AS cnt FROM base
        WHERE stage IS NOT NULL
          AND (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
          AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
          AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
          AND (v_is_licensed IS NULL OR is_licensed = v_is_licensed)
        GROUP BY stage
      ) s
    ), '{}'::jsonb),
    'isLicensed', (
      SELECT jsonb_build_object(
        'true', COALESCE(sum(CASE WHEN is_licensed = true THEN 1 ELSE 0 END), 0),
        'false', COALESCE(sum(CASE WHEN is_licensed = false OR is_licensed IS NULL THEN 1 ELSE 0 END), 0)
      ) FROM base
      WHERE (v_file_types IS NULL OR file_type::text = ANY(v_file_types))
        AND (v_statuses IS NULL OR status::text = ANY(v_statuses))
        AND (v_workflow_statuses IS NULL OR workflow_status::text = ANY(v_workflow_statuses))
        AND (v_stages IS NULL OR stage = ANY(v_stages))
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_sg_preview_stats()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH file_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE is_active)                                                                                                                                                              AS total_active,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NOT NULL)                                                                                                                                AS has_preview,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND thumbnail_error IS NULL     AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff'))   AS renderable_no_preview,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL AND thumbnail_error IS NOT NULL AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff'))   AS render_errored,
      COUNT(*) FILTER (WHERE is_active AND thumbnail_url IS NULL                                 AND lower(file_extension) NOT IN ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')) AS unsupported
    FROM public.style_guide_files
  ),
  queue_stats AS (
    SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'claimed')) AS queued_now
    FROM public.style_guide_render_queue
  )
  SELECT json_build_object(
    'total_active',          fs.total_active,
    'has_preview',           fs.has_preview,
    'renderable_no_preview', fs.renderable_no_preview,
    'render_errored',        fs.render_errored,
    'unsupported',           fs.unsupported,
    'queued_now',            qs.queued_now
  )
  FROM file_stats fs, queue_stats qs;
$function$;

CREATE OR REPLACE FUNCTION public.get_sg_render_queue_stats()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'pending',   COUNT(*) FILTER (WHERE status = 'pending'),
    'claimed',   COUNT(*) FILTER (WHERE status = 'claimed'),
    'completed', COUNT(*) FILTER (WHERE status = 'completed'),
    'failed',    COUNT(*) FILTER (WHERE status = 'failed')
  )
  FROM style_guide_render_queue;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _invitation record;
  _email text;
  _full_name text;
  _provider text;
  _app public.app_name;
BEGIN
  _email := lower(NEW.email);
  _full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    _email
  );
  _provider := NEW.raw_app_meta_data->>'provider';

  -- Company SSO users come from managed identity providers and bypass
  -- invitation rows. Azure is the active UI path; Authentik is retained for
  -- existing/backend compatibility.
  IF _provider IN ('authentik', 'azure') THEN
    INSERT INTO public.profiles (user_id, email, full_name)
    VALUES (NEW.id, _email, _full_name)
    ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          updated_at = now();

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.app_access (user_id, app)
    VALUES (NEW.id, 'popdam'::public.app_name)
    ON CONFLICT (user_id, app) DO NOTHING;

    RETURN NEW;
  END IF;

  -- Google and email/password remain invitation-only.
  SELECT * INTO _invitation
  FROM public.invitations
  WHERE lower(email) = _email AND accepted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF _invitation IS NULL THEN
    RAISE EXCEPTION 'Access denied: no valid invitation found for %', _email;
  END IF;

  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, _email, _full_name)
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, _invitation.role)
  ON CONFLICT (user_id, role) DO NOTHING;

  FOREACH _app IN ARRAY COALESCE(_invitation.apps, ARRAY['popdam']::public.app_name[])
  LOOP
    INSERT INTO public.app_access (user_id, app, granted_by)
    VALUES (NEW.id, _app, _invitation.invited_by)
    ON CONFLICT (user_id, app) DO NOTHING;
  END LOOP;

  IF NEW.invited_at IS NULL OR NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.invitations
    SET accepted_at = now()
    WHERE id = _invitation.id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_user_confirmed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.invitations
    SET accepted_at = now()
    WHERE email = NEW.email AND accepted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_app_access(_user_id uuid, _app app_name)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_access
    WHERE user_id = _user_id AND app = _app
  )
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$;

CREATE OR REPLACE FUNCTION public.infer_path_attrs(p_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  segs text[];
  idx  int;
  s    text;
  c1   text;
  cust text := NULL;
  prog text := NULL;
BEGIN
  IF p_path IS NULL OR p_path = '' THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;

  segs := string_to_array(p_path, '/');
  idx  := array_position(segs, '____New Structure');
  IF idx IS NULL THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;

  s := NULLIF(segs[idx + 1], '');
  IF s IS NULL THEN
    RETURN jsonb_build_object('stage', NULL, 'customer', NULL, 'program', NULL);
  END IF;

  -- Customer / program are only reliably encoded in the "In Development / Customer Adopted" branch.
  IF s = 'In Development' AND segs[idx + 2] = 'Customer Adopted' THEN
    c1 := NULLIF(segs[idx + 3], '');
    IF c1 IS NULL THEN
      cust := NULL; prog := NULL;
    ELSIF c1 = '_FINISHED' THEN
      -- wrapper bucket: _FINISHED / <Customer>_finished / <Program> / <SKU>
      cust := NULLIF(regexp_replace(COALESCE(segs[idx + 4], ''), '_finished$', '', 'i'), '');
      prog := NULLIF(segs[idx + 5], '');
    ELSIF left(c1, 1) = '_' THEN
      -- status buckets (_NOT APPROVED, _REJECTED, _No Customer, _NOT SUBMITTED): no real customer
      cust := NULL; prog := NULL;
    ELSE
      cust := c1;
      prog := NULLIF(segs[idx + 4], '');
    END IF;

    -- Guard: the program slot must be a real program folder, not the SKU folder or a file.
    IF prog IS NOT NULL THEN
      IF prog ~ '\.[A-Za-z0-9]+$' THEN
        prog := NULL;  -- looks like a filename
      ELSIF prog !~ '[[:space:]]' AND prog ~ '^[A-Za-z]{1,6}[0-9][A-Za-z0-9]*$' AND length(prog) >= 8 THEN
        prog := NULL;  -- looks like a SKU code (no program folder present)
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('stage', s, 'customer', cust, 'program', prog);
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_style_guide_source_pdf(p_file_type text, p_filename text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_file_type = 'pdf' AND p_filename IS NOT NULL AND (
    p_filename ILIKE '%licensing sheet%' OR p_filename ILIKE '%licensing_sheet%' OR
    p_filename ILIKE '%license sheet%'   OR p_filename ILIKE '%license_sheet%'   OR
    p_filename ILIKE '%tech pack%'       OR p_filename ILIKE '%tech_pack%'       OR
    p_filename ILIKE '%techpack%'
  );
$function$;

CREATE OR REPLACE FUNCTION public.normalize_for_sg_match(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT regexp_replace(lower(regexp_replace(p, '\.[^.]+$', '')), '[^a-z0-9]', '', 'g')
$function$;

CREATE OR REPLACE FUNCTION public.parse_pdf_files_used(p_asset_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_sku     text;
  v_ftype   text;
  v_fname   text;
  v_text    text;
  v_lines   text[];
  v_in_sect boolean := false;
  v_line    text;
  v_trimmed text;
  v_count   int := 0;
  v_entry   text;
  v_inline  text;
BEGIN
  SELECT sku, file_type::text, filename INTO v_sku, v_ftype, v_fname FROM assets WHERE id = p_asset_id;
  IF v_sku IS NULL OR v_sku = '' THEN RETURN 0; END IF;

  -- Style Guide Sources are parsed ONLY from licensing-sheet / tech-pack PDFs.
  IF NOT public.is_style_guide_source_pdf(v_ftype, v_fname) THEN RETURN 0; END IF;

  SELECT extracted_text INTO v_text
  FROM pdf_text_samples
  WHERE asset_id = p_asset_id AND extracted_text IS NOT NULL
  ORDER BY sampled_at DESC LIMIT 1;
  IF v_text IS NULL THEN RETURN 0; END IF;

  v_lines := string_to_array(v_text, E'\n');
  FOREACH v_line IN ARRAY v_lines LOOP
    v_trimmed := trim(v_line);

    IF v_trimmed ~* '^\s*(files?\s+used|source\s+files?|art\s+files?|design\s+files?)\s*:' THEN
      v_in_sect := true;
      v_inline := trim(regexp_replace(v_trimmed, '(?i)^\s*(files?\s+used|source\s+files?|art\s+files?|design\s+files?)\s*:\s*', ''));
      IF v_inline <> '' THEN
        FOREACH v_entry IN ARRAY string_to_array(v_inline, ',') LOOP
          v_entry := trim(v_entry);
          IF v_entry <> '' AND length(v_entry) >= 2 AND NOT v_entry ~ '^\d+$' THEN
            INSERT INTO sku_files_used (sku, file_name, source)
            VALUES (v_sku, v_entry, 'pdf_text')
            ON CONFLICT (sku, file_name) DO NOTHING;
            v_count := v_count + 1;
          END IF;
        END LOOP;
        v_in_sect := false;
      END IF;
      CONTINUE;
    END IF;

    IF v_in_sect THEN
      IF v_trimmed = '' OR v_trimmed ~ '^\S[^:]*:\s*$' THEN
        v_in_sect := false;
        CONTINUE;
      END IF;
      IF v_trimmed ~ '^\d+$' OR length(v_trimmed) < 2 THEN CONTINUE; END IF;
      INSERT INTO sku_files_used (sku, file_name, source)
      VALUES (v_sku, v_trimmed, 'pdf_text')
      ON CONFLICT (sku, file_name) DO NOTHING;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.propagate_group_tags_batch(p_cursor uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 100)
 RETURNS TABLE(next_cursor uuid, propagated integer, skipped integer, done boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
 SET lock_timeout TO '0'
AS $function$
DECLARE
  v_next_cursor uuid;
  v_total_propagated int := 0;
  v_group_count int := 0;
  v_batch_propagated int;
  v_file_specific_tags text[] := ARRAY[
    'art_piece','art piece','product','product shot','product photo',
    'packaging','package','tech_pack','tech pack','technical pack',
    'photography','photo','mockup','mock up','mock-up',
    'front view','back view','side view','flat lay','flatlay',
    'render','3d render'
  ];
BEGIN
  FOR v_next_cursor IN
    SELECT sg.id
    FROM style_groups sg
    WHERE (p_cursor IS NULL OR sg.id > p_cursor)
    ORDER BY sg.id
    LIMIT p_batch_size
  LOOP
    v_group_count := v_group_count + 1;

    WITH source_asset AS (
      SELECT a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      FROM assets a
      WHERE a.style_group_id = v_next_cursor
        AND a.is_deleted = false
        AND a.ai_tagged_at IS NOT NULL
      ORDER BY a.primary_sort_tier ASC, a.ai_tagged_at ASC
      LIMIT 1
    ),
    source_tags AS (
      SELECT at2.tag
      FROM asset_tags at2
      JOIN source_asset sa ON sa.id = at2.asset_id
      WHERE at2.source = 'ai'
        AND lower(trim(at2.tag)) != ALL(v_file_specific_tags)
    ),
    source_chars AS (
      SELECT ac.character_id
      FROM asset_characters ac
      JOIN source_asset sa ON sa.id = ac.asset_id
    ),
    siblings AS (
      SELECT a.id, a.licensor_id, a.property_id, a.is_licensed,
             a.big_theme, a.little_theme, a.design_style, a.cover_description
      FROM assets a
      CROSS JOIN source_asset sa
      WHERE a.style_group_id = v_next_cursor
        AND a.is_deleted = false
        AND a.id != sa.id
    ),
    inserted_tags AS (
      INSERT INTO asset_tags (asset_id, tag, source)
      SELECT s.id, st.tag, 'ai'
      FROM siblings s
      CROSS JOIN source_tags st
      ON CONFLICT (asset_id, tag) DO NOTHING
      RETURNING 1
    ),
    inserted_chars AS (
      INSERT INTO asset_characters (asset_id, character_id)
      SELECT s.id, sc.character_id
      FROM siblings s
      CROSS JOIN source_chars sc
      ON CONFLICT (asset_id, character_id) DO NOTHING
      RETURNING 1
    ),
    meta_updates AS (
      UPDATE assets a
      SET
        licensor_id = COALESCE(a.licensor_id, sa.licensor_id),
        property_id = COALESCE(a.property_id, sa.property_id),
        is_licensed = CASE WHEN a.is_licensed = true THEN true ELSE COALESCE(sa.is_licensed, a.is_licensed) END,
        big_theme = COALESCE(a.big_theme, sa.big_theme),
        little_theme = COALESCE(a.little_theme, sa.little_theme),
        design_style = COALESCE(a.design_style, sa.design_style),
        cover_description = COALESCE(a.cover_description, sa.cover_description)
      FROM source_asset sa, siblings s
      WHERE a.id = s.id
        AND (
          (a.licensor_id IS NULL AND sa.licensor_id IS NOT NULL) OR
          (a.property_id IS NULL AND sa.property_id IS NOT NULL) OR
          (a.is_licensed IS NOT TRUE AND sa.is_licensed = true) OR
          (a.big_theme IS NULL AND sa.big_theme IS NOT NULL) OR
          (a.little_theme IS NULL AND sa.little_theme IS NOT NULL) OR
          (a.design_style IS NULL AND sa.design_style IS NOT NULL) OR
          (a.cover_description IS NULL AND sa.cover_description IS NOT NULL)
        )
      RETURNING 1
    )
    SELECT
      (SELECT count(*)::int FROM inserted_tags) + (SELECT count(*)::int FROM inserted_chars)
    INTO v_batch_propagated;

    v_total_propagated := v_total_propagated + COALESCE(v_batch_propagated, 0);
  END LOOP;

  RETURN QUERY SELECT
    v_next_cursor,
    v_total_propagated,
    0::int,
    (v_group_count < p_batch_size);
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_nightly_rebuild_style_groups()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current jsonb;
  v_status  text;
  v_now     timestamptz := now();
  v_state   jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'));

  SELECT value INTO v_current
  FROM admin_config
  WHERE key = 'BULK_OPERATIONS';

  v_current := COALESCE(v_current, '{}'::jsonb);
  v_status  := v_current->'rebuild-style-groups'->>'status';

  -- Skip if already running or queued
  IF v_status IN ('running', 'queued') THEN
    RETURN;
  END IF;

  v_state := jsonb_build_object(
    'status',         'queued',
    'cursor',         0,
    'params',         jsonb_build_object('force_restart', true),
    'started_at',     v_now::text,
    'updated_at',     v_now::text,
    'progress',       '{}'::jsonb,
    'run_id',         gen_random_uuid()::text,
    'queue_position', (EXTRACT(EPOCH FROM v_now) * 1000)::bigint,
    'requested_by',   'pg_cron'
  );

  v_current := jsonb_set(v_current, ARRAY['rebuild-style-groups'], v_state);

  INSERT INTO admin_config (key, value, updated_at)
  VALUES ('BULK_OPERATIONS', v_current, v_now)
  ON CONFLICT (key) DO UPDATE
    SET value      = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_sg_render_jobs_by_ids(p_file_ids uuid[])
 RETURNS integer
 LANGUAGE sql
AS $function$
  WITH inserted AS (
    INSERT INTO public.style_guide_render_queue (style_guide_file_id)
    SELECT t.id
    FROM unnest(p_file_ids) AS t(id)
    JOIN public.style_guide_files f ON f.id = t.id
    WHERE f.thumbnail_url IS NULL
      AND f.thumbnail_error IS NULL
      AND lower(f.file_extension) IN ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
      AND NOT EXISTS (
        SELECT 1 FROM public.style_guide_render_queue q
        WHERE q.style_guide_file_id = t.id
          AND q.status IN ('pending', 'claimed')
      )
    RETURNING 1
  )
  SELECT count(*)::int FROM inserted;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_style_group_stats_batch(p_cursor uuid DEFAULT NULL::uuid, p_batch_size integer DEFAULT 200, p_sub text DEFAULT 'counts'::text)
 RETURNS TABLE(next_cursor uuid, processed integer, sub text, done boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
 SET lock_timeout TO '0'
AS $function$
DECLARE
  v_ids uuid[];
  v_count int;
  v_last_id uuid;
  v_done boolean;
BEGIN
  -- Fetch batch of style_group IDs using keyset pagination
  SELECT array_agg(sg.id ORDER BY sg.id), count(*)::int
  INTO v_ids, v_count
  FROM (
    SELECT sg2.id
    FROM style_groups sg2
    WHERE (p_cursor IS NULL OR sg2.id > p_cursor)
    ORDER BY sg2.id
    LIMIT p_batch_size
  ) sg;

  v_done := (v_count < p_batch_size);

  IF v_count = 0 THEN
    -- No more groups in this sub-stage
    IF p_sub = 'counts' THEN
      -- Signal transition to primaries
      RETURN QUERY SELECT NULL::uuid, 0, 'counts_done'::text, false;
    ELSE
      -- Primaries done = fully complete
      RETURN QUERY SELECT NULL::uuid, 0, 'complete'::text, true;
    END IF;
    RETURN;
  END IF;

  v_last_id := v_ids[array_length(v_ids, 1)];

  IF p_sub = 'counts' THEN
    -- Refresh counts + latest_file_date for this batch
    PERFORM refresh_style_group_counts_batch(v_ids);

    IF v_done THEN
      -- Counts exhausted → signal transition
      RETURN QUERY SELECT v_last_id, v_count, 'counts_done'::text, false;
    ELSE
      RETURN QUERY SELECT v_last_id, v_count, 'counts'::text, false;
    END IF;

  ELSIF p_sub = 'primaries' THEN
    -- Refresh primary asset selection for this batch
    PERFORM refresh_style_group_primaries(v_ids);

    RETURN QUERY SELECT v_last_id, v_count, p_sub, v_done;

  ELSE
    RAISE EXCEPTION 'Unknown sub-stage: %', p_sub;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_group_on_asset_hard_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.style_group_id IS NOT NULL THEN
    PERFORM refresh_style_group_counts_batch(ARRAY[OLD.style_group_id]);
    PERFORM refresh_style_group_primaries(ARRAY[OLD.style_group_id]);
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_primary_on_asset_soft_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only act when this asset is currently the group's primary
  IF NEW.style_group_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM style_groups
       WHERE id = NEW.style_group_id
         AND primary_asset_id = NEW.id
     )
  THEN
    PERFORM refresh_style_group_primaries(ARRAY[NEW.style_group_id]);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_style_group_counts()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  UPDATE public.style_groups sg
  SET
    asset_count = COALESCE(agg.asset_count, 0),
    latest_file_date = agg.latest_file_date,
    updated_at = now()
  FROM (
    SELECT
      sg2.id AS style_group_id,
      COUNT(a.id)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.style_groups sg2
    LEFT JOIN public.assets a
      ON a.style_group_id = sg2.id
      AND a.is_deleted = false
    GROUP BY sg2.id
  ) agg
  WHERE sg.id = agg.style_group_id;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_batch(p_group_ids uuid[])
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
 SET lock_timeout TO '0'
AS $function$
  WITH agg AS (
    SELECT
      sg.id AS style_group_id,
      COUNT(a.id)::integer AS asset_count,
      MAX(a.modified_at) AS latest_file_date
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id
      AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    GROUP BY sg.id
  ),
  upd AS (
    UPDATE public.style_groups sg
    SET
      asset_count             = agg.asset_count,
      latest_file_date        = agg.latest_file_date,
      -- Clear primary fields for empty groups so they disappear from the library
      primary_asset_id        = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_id END,
      primary_asset_type      = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_type END,
      primary_thumbnail_url   = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_url END,
      primary_thumbnail_error = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_error END,
      updated_at              = now()
    FROM agg
    WHERE sg.id = agg.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_style_group_counts_on_asset_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT style_group_id)
      INTO v_group_ids
      FROM new_table
     WHERE style_group_id IS NOT NULL;

  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT style_group_id)
      INTO v_group_ids
      FROM old_table
     WHERE style_group_id IS NOT NULL;

  ELSE -- UPDATE: only care about rows where is_deleted or style_group_id actually changed
    SELECT array_agg(DISTINCT grp)
      INTO v_group_ids
      FROM (
        SELECT o.style_group_id AS grp
          FROM old_table o
          JOIN new_table n ON n.id = o.id
         WHERE (o.is_deleted IS DISTINCT FROM n.is_deleted
                OR o.style_group_id IS DISTINCT FROM n.style_group_id)
           AND o.style_group_id IS NOT NULL
        UNION
        SELECT n.style_group_id AS grp
          FROM old_table o
          JOIN new_table n ON n.id = o.id
         WHERE (o.is_deleted IS DISTINCT FROM n.is_deleted
                OR o.style_group_id IS DISTINCT FROM n.style_group_id)
           AND n.style_group_id IS NOT NULL
      ) t;
  END IF;

  IF v_group_ids IS NOT NULL AND array_length(v_group_ids, 1) > 0 THEN
    PERFORM public.refresh_style_group_counts_batch(v_group_ids);
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_style_group_primaries(p_group_ids uuid[])
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
 SET lock_timeout TO '0'
AS $function$
  WITH picked AS (
    SELECT DISTINCT ON (sg.id)
      sg.id AS style_group_id,
      a.id AS primary_asset_id,
      a.asset_type::text AS primary_asset_type,
      a.thumbnail_url AS primary_thumbnail_url,
      a.thumbnail_error AS primary_thumbnail_error
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id AND a.is_deleted = false
    WHERE sg.id = ANY(p_group_ids)
    ORDER BY sg.id, a.primary_sort_tier ASC, a.created_at ASC
  ),
  upd AS (
    UPDATE public.style_groups sg SET
      primary_asset_id = picked.primary_asset_id,
      primary_asset_type = picked.primary_asset_type,
      primary_thumbnail_url = picked.primary_thumbnail_url,
      primary_thumbnail_error = picked.primary_thumbnail_error,
      updated_at = now()
    FROM picked WHERE sg.id = picked.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upd;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_style_guide_matviews()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.style_guide_file_groups;
  REFRESH MATERIALIZED VIEW public.style_guide_folders;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requeue_all_failed_sg_jobs(p_limit integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int;
BEGIN
  UPDATE public.style_guide_render_queue
  SET
    status        = 'pending',
    error_message = NULL,
    completed_at  = NULL,
    claimed_at    = NULL,
    claimed_by    = NULL
  WHERE id IN (
    SELECT id FROM public.style_guide_render_queue
    WHERE status = 'failed'
    LIMIT p_limit
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_stale_jobs(p_timeout_minutes integer DEFAULT 30)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected int;
BEGIN
  UPDATE public.processing_queue
  SET status = 'pending', agent_id = NULL, claimed_at = NULL
  WHERE status IN ('claimed', 'processing')
    AND claimed_at < now() - (p_timeout_minutes || ' minutes')::interval;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_sku_files_used()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE v_count int;
BEGIN
  UPDATE sku_files_used u
  SET style_guide_file_id = (
    SELECT s.id
    FROM style_guide_files s
    WHERE s.is_active = true
      AND normalize_for_sg_match(s.filename) = normalize_for_sg_match(u.file_name)
    ORDER BY s.modified_at DESC NULLS LAST
    LIMIT 1
  )
  WHERE style_guide_file_id IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_sku_files_used_fuzzy(p_threshold real DEFAULT 0.6)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  r        record;
  v_id     uuid;
  v_score  real;
  v_linked int := 0;
BEGIN
  FOR r IN
    SELECT id, file_name FROM sku_files_used WHERE style_guide_file_id IS NULL
  LOOP
    v_id := NULL; v_score := NULL;

    SELECT f.id, similarity(lower(f.filename), lower(r.file_name))
      INTO v_id, v_score
    FROM style_guide_files f
    WHERE f.is_active AND lower(f.filename) % lower(r.file_name)
    ORDER BY similarity(lower(f.filename), lower(r.file_name)) DESC
    LIMIT 1;

    UPDATE sku_files_used
       SET style_guide_file_id  = CASE WHEN v_score >= p_threshold THEN v_id
                                       ELSE style_guide_file_id END,
           match_best_score      = GREATEST(COALESCE(match_best_score, 0), COALESCE(v_score, 0)),
           match_attempts        = match_attempts + 1,
           last_match_attempt_at = now()
     WHERE id = r.id;

    IF v_id IS NOT NULL AND v_score >= p_threshold THEN v_linked := v_linked + 1; END IF;
  END LOOP;
  RETURN v_linked;
END;
$function$;

CREATE OR REPLACE FUNCTION public.retry_sg_render_errors(p_file_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids    uuid[];
  v_queued int;
BEGIN
  SELECT ARRAY_AGG(id) INTO v_ids
  FROM (
    SELECT id
    FROM public.style_guide_files
    WHERE is_active
      AND thumbnail_url IS NULL
      AND thumbnail_error IS NOT NULL
      AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'eps', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
      AND (p_file_ids IS NULL OR id = ANY(p_file_ids))
    LIMIT CASE WHEN p_file_ids IS NULL THEN p_limit ELSE NULL END
  ) sub;

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.style_guide_files SET thumbnail_error = NULL WHERE id = ANY(v_ids);
  SELECT public.queue_sg_render_jobs_by_ids(v_ids) INTO v_queued;
  RETURN v_queued;
END;
$function$;

CREATE OR REPLACE FUNCTION public.retry_sg_render_errors(p_file_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
  v_queued int;
BEGIN
  -- Disable statement timeout for this bulk operation; it may touch tens of thousands of rows.
  SET LOCAL statement_timeout = 0;

  SELECT ARRAY_AGG(id) INTO v_ids
  FROM public.style_guide_files
  WHERE is_active
    AND thumbnail_url IS NULL
    AND thumbnail_error IS NOT NULL
    AND lower(file_extension) IN ('pdf', 'ai', 'psd', 'jpg', 'jpeg', 'png', 'tif', 'tiff')
    AND (p_file_ids IS NULL OR id = ANY(p_file_ids));

  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.style_guide_files SET thumbnail_error = NULL WHERE id = ANY(v_ids);
  SELECT public.queue_sg_render_jobs_by_ids(v_ids) INTO v_queued;
  RETURN v_queued;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_full_reconcile_style_group_stats()
 RETURNS TABLE(counts_updated integer, primaries_updated integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_cursor         uuid := NULL;
  v_batch_ids      uuid[];
  v_batch_size     int  := 500;
  v_batch_count    int;
  v_counts_updated int  := 0;
  v_prim_updated   int  := 0;
BEGIN
  -- Phase 1: recompute asset_count for every group in one UPDATE+JOIN pass;
  --          also clears primary fields on groups that are now empty.
  WITH agg AS (
    SELECT
      sg.id                        AS style_group_id,
      COUNT(a.id)::integer         AS asset_count,
      MAX(a.modified_at)           AS latest_file_date
    FROM public.style_groups sg
    LEFT JOIN public.assets a
      ON a.style_group_id = sg.id AND a.is_deleted = false
    GROUP BY sg.id
  ),
  upd AS (
    UPDATE public.style_groups sg SET
      asset_count             = agg.asset_count,
      latest_file_date        = agg.latest_file_date,
      primary_asset_id        = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_id        END,
      primary_asset_type      = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_asset_type      END,
      primary_thumbnail_url   = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_url   END,
      primary_thumbnail_error = CASE WHEN agg.asset_count = 0 THEN NULL ELSE sg.primary_thumbnail_error END,
      updated_at              = now()
    FROM agg
    WHERE sg.id = agg.style_group_id
    RETURNING 1
  )
  SELECT COUNT(*)::int INTO v_counts_updated FROM upd;

  -- Phase 2: re-pick primary asset for every group, batched to avoid huge arrays.
  LOOP
    SELECT array_agg(id ORDER BY id), COUNT(*)::int
    INTO v_batch_ids, v_batch_count
    FROM (
      SELECT id FROM public.style_groups
      WHERE (v_cursor IS NULL OR id > v_cursor)
      ORDER BY id
      LIMIT v_batch_size
    ) sub;

    EXIT WHEN v_batch_count = 0;

    PERFORM public.refresh_style_group_primaries(v_batch_ids);
    v_prim_updated := v_prim_updated + v_batch_count;
    v_cursor := v_batch_ids[array_length(v_batch_ids, 1)];

    EXIT WHEN v_batch_count < v_batch_size;
  END LOOP;

  RETURN QUERY SELECT v_counts_updated, v_prim_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_assets_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_style_group_cover(p_group_id uuid, p_asset_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_asset assets%ROWTYPE;
BEGIN
  -- Must be authenticated
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Fetch the asset and verify it belongs to this style group
  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id AND is_deleted = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset not found';
  END IF;
  IF v_asset.style_group_id IS DISTINCT FROM p_group_id THEN
    RAISE EXCEPTION 'Asset does not belong to this style group';
  END IF;

  -- Update only the cover columns
  UPDATE public.style_groups
  SET
    primary_asset_id        = p_asset_id,
    primary_asset_type      = v_asset.asset_type,
    primary_thumbnail_url   = v_asset.thumbnail_url,
    primary_thumbnail_error = v_asset.thumbnail_error,
    updated_at              = now()
  WHERE id = p_group_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_asset_tags_to_array()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_asset_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_asset_id := OLD.asset_id;
  ELSE
    v_asset_id := NEW.asset_id;
  END IF;

  UPDATE public.assets
  SET tags = COALESCE(
    (SELECT array_agg(at.tag ORDER BY at.tag) FROM public.asset_tags at WHERE at.asset_id = v_asset_id),
    '{}'::text[]
  )
  WHERE id = v_asset_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_cover_description_to_style_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id uuid;
  v_desc text;
BEGIN
  v_group_id := NEW.style_group_id;
  IF v_group_id IS NULL THEN RETURN NEW; END IF;

  -- Use cover_description from the group's primary asset, or fallback to first non-null in group
  SELECT COALESCE(
    (SELECT a.cover_description FROM public.assets a
     JOIN public.style_groups sg ON sg.primary_asset_id = a.id
     WHERE sg.id = v_group_id AND a.cover_description IS NOT NULL),
    (SELECT a.cover_description FROM public.assets a
     WHERE a.style_group_id = v_group_id AND a.is_deleted = false AND a.cover_description IS NOT NULL
     LIMIT 1)
  ) INTO v_desc;

  UPDATE public.style_groups
  SET cover_description = v_desc, updated_at = now()
  WHERE id = v_group_id AND (cover_description IS DISTINCT FROM v_desc);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_designer_to_style_group()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_group_id uuid;
  v_conflict boolean := false;
  v_designer text;
  v_tech_designer text;
  v_freelancer text;
  v_designers text[];
  v_tech_designers text[];
  v_freelancers text[];
BEGIN
  v_group_id := NEW.style_group_id;
  IF v_group_id IS NULL THEN RETURN NEW; END IF;

  SELECT
    array_agg(DISTINCT a.designer_name) FILTER (WHERE a.designer_name IS NOT NULL),
    array_agg(DISTINCT a.technical_designer_name) FILTER (WHERE a.technical_designer_name IS NOT NULL),
    array_agg(DISTINCT a.freelancer_name) FILTER (WHERE a.freelancer_name IS NOT NULL)
  INTO v_designers, v_tech_designers, v_freelancers
  FROM public.assets a
  WHERE a.style_group_id = v_group_id AND a.is_deleted = false;

  v_designer := v_designers[1];
  v_tech_designer := v_tech_designers[1];
  v_freelancer := v_freelancers[1];

  IF array_length(v_designers, 1) > 1
     OR array_length(v_tech_designers, 1) > 1
     OR array_length(v_freelancers, 1) > 1 THEN
    v_conflict := true;
  END IF;

  UPDATE public.style_groups
  SET designer_name = v_designer,
      technical_designer_name = v_tech_designer,
      freelancer_name = v_freelancer,
      designer_conflict = v_conflict,
      updated_at = now()
  WHERE id = v_group_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_primary_asset_on_thumbnail()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.style_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Case 1: Group has no primary — assign when asset has a thumbnail.
  -- Covers INSERT (asset indexed with thumbnail already set) and
  -- UPDATE where thumbnail just appeared (OLD.thumbnail_url IS NULL).
  IF NEW.thumbnail_url IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.thumbnail_url IS NULL)
  THEN
    UPDATE public.style_groups sg
    SET primary_asset_id        = NEW.id,
        primary_asset_type      = NEW.asset_type::text,
        primary_thumbnail_url   = NEW.thumbnail_url,
        primary_thumbnail_error = NEW.thumbnail_error,
        updated_at              = now()
    WHERE sg.id = NEW.style_group_id
      AND sg.primary_asset_id IS NULL;
  END IF;

  -- Case 2: This asset IS already the primary — keep cached fields in sync.
  UPDATE public.style_groups sg
  SET primary_thumbnail_url   = NEW.thumbnail_url,
      primary_thumbnail_error = NEW.thumbnail_error,
      updated_at              = now()
  WHERE sg.id = NEW.style_group_id
    AND sg.primary_asset_id = NEW.id
    AND (sg.primary_thumbnail_url  IS DISTINCT FROM NEW.thumbnail_url
         OR sg.primary_thumbnail_error IS DISTINCT FROM NEW.thumbnail_error);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_parse_pdf_files_used()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Allow bulk-insert RPC to suppress this per-row trigger via session variable
  IF current_setting('app.skip_parse_pdf_trigger', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.asset_id IS NOT NULL AND NEW.extracted_text IS NOT NULL THEN
    PERFORM parse_pdf_files_used(NEW.asset_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_fn_resolve_sku_file_used()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.style_guide_file_id IS NULL THEN
    SELECT id INTO NEW.style_guide_file_id
    FROM style_guide_files
    WHERE is_active = true
      AND normalize_for_sg_match(filename) = normalize_for_sg_match(NEW.file_name)
    ORDER BY modified_at DESC NULLS LAST
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_set_asset_path_attrs()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE j jsonb;
BEGIN
  j := public.infer_path_attrs(NEW.relative_path);
  NEW.stage    := j ->> 'stage';
  NEW.customer := j ->> 'customer';
  NEW.program  := j ->> 'program';
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_set_sg_path_attrs()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE j jsonb;
BEGIN
  j := public.infer_path_attrs(NEW.folder_path);
  NEW.stage    := j ->> 'stage';
  NEW.customer := j ->> 'customer';
  NEW.program  := j ->> 'program';
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_asset_checkouts_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;


-- ------------------------------------------------------------------------------------
-- Indexes (151)
-- ------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS age_group_created_by_fkey ON core.age_group USING btree (created_by);
CREATE INDEX IF NOT EXISTS age_group_updated_by_fkey ON core.age_group USING btree (updated_by);
CREATE INDEX IF NOT EXISTS art_types_created_by_fkey ON core.art_types USING btree (created_by);
CREATE INDEX IF NOT EXISTS art_types_divisioncode_id_fkey ON core.art_types USING btree (divisioncode_id);
CREATE INDEX IF NOT EXISTS art_types_updated_by_fkey ON core.art_types USING btree (updated_by);
CREATE INDEX IF NOT EXISTS artist_types_created_by_fkey ON core.artist_types USING btree (created_by);
CREATE INDEX IF NOT EXISTS artist_types_updated_by_fkey ON core.artist_types USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_relations_child ON core."merchGroupRelations" USING btree (child_mg_id);
CREATE INDEX IF NOT EXISTS idx_relations_grand_parent ON core."merchGroupRelations" USING btree (grand_parent_mg_id);
CREATE INDEX IF NOT EXISTS idx_relations_parent ON core."merchGroupRelations" USING btree (parent_mg_id);
CREATE UNIQUE INDEX uniq_grand_parent_parent_child ON core."merchGroupRelations" USING btree (grand_parent_mg_id, parent_mg_id, child_mg_id);
CREATE UNIQUE INDEX uniq_parent_child_no_grand ON core."merchGroupRelations" USING btree (parent_mg_id, child_mg_id) WHERE (grand_parent_mg_id IS NULL);
CREATE INDEX IF NOT EXISTS idx_properties_licensor_id ON core.properties_and_characters USING btree (licensor_id);
CREATE INDEX IF NOT EXISTS idx_properties_name ON core.properties_and_characters USING btree (name);
CREATE UNIQUE INDEX unique_character_entity ON core.properties_and_characters USING btree (licensor_id, source_licensed_property_id, source_character_id) WHERE ((type)::text = 'CHARACTER'::text);
CREATE UNIQUE INDEX unique_property_entity ON core.properties_and_characters USING btree (licensor_id, source_licensed_property_id) WHERE ((type)::text = 'PROPERTY'::text);
CREATE INDEX IF NOT EXISTS idx_property_character_associations_character_id ON core.property_character_associations USING btree (character_id);
CREATE INDEX IF NOT EXISTS idx_property_character_associations_licensor_id ON core.property_character_associations USING btree (licensor_id);
CREATE INDEX IF NOT EXISTS idx_property_character_associations_property_id ON core.property_character_associations USING btree (property_id);
CREATE UNIQUE INDEX "GridLayout_pkey" ON plm."GridLayout" USING btree (id);
CREATE UNIQUE INDEX "GridViewState_user_grid_view" ON plm."GridViewState" USING btree (user_id_fk, grid_id, view_name);
CREATE UNIQUE INDEX "ProdOrderDetail_pkey" ON plm."ProdOrderDetail" USING btree (id);
CREATE INDEX IF NOT EXISTS "idx_rfqItem_copied_from_id" ON plm."RFQItem" USING btree ("rfqItem_copied_from_id") WHERE ("rfqItem_copied_from_id" IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rfqitem_choosen_vendor ON plm."RFQItem" USING btree ("rfqItem_choosen_vendor");
CREATE INDEX IF NOT EXISTS idx_rfqitem_container ON plm."RFQItem" USING btree (rfq_container_id_fk);
CREATE INDEX IF NOT EXISTS idx_rfqitem_customer ON plm."RFQItem" USING btree ("rfqItem_customer");
CREATE INDEX IF NOT EXISTS idx_rfqitem_delivery_loc ON plm."RFQItem" USING btree ("rfqItem_delivery_loc");
CREATE INDEX IF NOT EXISTS idx_rfqitem_divcode ON plm."RFQItem" USING btree ("rfqItem_divCode_id_fk");
CREATE INDEX IF NOT EXISTS idx_rfqitem_home_list ON plm."RFQItem" USING btree ("rfqItem_active", "rfqItem_id" DESC) WHERE ("rfqItem_archive" IS NULL);
CREATE INDEX IF NOT EXISTS idx_rfqitem_rfq_group ON plm."RFQItem" USING btree ("rfqItem_rfq_group");
CREATE INDEX IF NOT EXISTS idx_rfqitem_step ON plm."RFQItem" USING btree ("rfqItem_step");
CREATE INDEX IF NOT EXISTS idx_rfqvendor_item_fk ON plm."RFQVendor" USING btree ("RFQitem_id_fk");
CREATE INDEX IF NOT EXISTS idx_rfqvendor_vendor_archived ON plm."RFQVendor" USING btree (vendor_id_fk, "RFQVendor_archived");
CREATE UNIQUE INDEX "StandardizedVersionDetail_pkey" ON plm."StandardizedDetail" USING btree (id);
CREATE INDEX IF NOT EXISTS art_piece_attachment_art_piece_id_fkey ON plm.art_piece_attachment USING btree (art_piece_id);
CREATE INDEX IF NOT EXISTS art_piece_attachment_company_code_fkey ON plm.art_piece_attachment USING btree (company_code);
CREATE INDEX IF NOT EXISTS art_piece_attachment_created_by_fkey ON plm.art_piece_attachment USING btree (created_by);
CREATE INDEX IF NOT EXISTS art_piece_attachment_divisioncode_id_fkey ON plm.art_piece_attachment USING btree (divisioncode_id);
CREATE INDEX IF NOT EXISTS art_piece_attachment_updated_by_fkey ON plm.art_piece_attachment USING btree (updated_by);
CREATE UNIQUE INDEX grid_cell_notes_grid_row_col_uq ON plm.grid_cell_notes USING btree (grid_type, row_id, col_id);
CREATE INDEX IF NOT EXISTS grid_cell_notes_grid_type_idx ON plm.grid_cell_notes USING btree (grid_type);
CREATE INDEX IF NOT EXISTS "idx_itemLicenseImage_item" ON plm."itemLicenseImage" USING btree (itemheader_id_fk);
CREATE INDEX IF NOT EXISTS idx_itemlicenseimage_item ON plm."itemLicenseImage" USING btree (itemheader_id_fk);
CREATE UNIQUE INDEX "itemType_name_key" ON plm."itemType" USING btree (item_type_name);
CREATE INDEX IF NOT EXISTS "itemType_status_idx" ON plm."itemType" USING btree (item_type_status);
CREATE INDEX IF NOT EXISTS idx_item_character_associations_character_id ON plm.item_character_associations USING btree (character_id);
CREATE INDEX IF NOT EXISTS item_prod_order_detail_associations_item_header_idx ON plm.item_prod_order_detail_associations USING btree (item_header_id);
CREATE INDEX IF NOT EXISTS item_prod_order_detail_associations_matched_item_number_idx ON plm.item_prod_order_detail_associations USING btree (matched_item_number);
CREATE INDEX IF NOT EXISTS item_prod_order_detail_associations_prod_detail_idx ON plm.item_prod_order_detail_associations USING btree (prod_order_detail_pkey);
CREATE UNIQUE INDEX item_prod_order_detail_associations_unique_pair ON plm.item_prod_order_detail_associations USING btree (item_header_id, prod_order_detail_pkey);
CREATE INDEX IF NOT EXISTS idx_licensing_feedback_reply_status ON plm."licensingFeedbackReply" USING btree (licensing_status_id_fk);
CREATE UNIQUE INDEX unique_item_stage ON plm."licensingMilestone" USING btree (itemheader_id_fk, stage);
CREATE UNIQUE INDEX "productUserAssignment_item_role_key" ON plm."productUserAssignment" USING btree (item_id_fk, role);
CREATE INDEX IF NOT EXISTS "productUserAssignment_user_idx" ON plm."productUserAssignment" USING btree (user_id_fk);
CREATE INDEX IF NOT EXISTS idx_sample_box_id_fk ON plm.sample USING btree (box_id_fk);
CREATE INDEX IF NOT EXISTS idx_sample_attachment_sample_id_fk ON plm.sample_attachment USING btree (sample_id_fk);
CREATE INDEX IF NOT EXISTS idx_sample_event_sample_id_fk ON plm.sample_event USING btree (sample_id_fk);
CREATE INDEX IF NOT EXISTS idx_agent_pairings_code ON public.agent_pairings USING btree (pairing_code) WHERE (status = 'pending'::text);
CREATE INDEX IF NOT EXISTS idx_agent_registrations_last_heartbeat ON public.agent_registrations USING btree (last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_ai_sentinel_cleanup_log_asset ON public.ai_sentinel_cleanup_log USING btree (ai_asset_id);
CREATE INDEX IF NOT EXISTS idx_app_access_user_id ON public.app_access USING btree (user_id);
CREATE UNIQUE INDEX asset_checkouts_one_active_per_asset ON public.asset_checkouts USING btree (asset_id) WHERE (status = ANY (ARRAY['active'::checkout_status, 'checkin_queued'::checkout_status, 'uploading'::checkout_status, 'verifying'::checkout_status]));
CREATE INDEX IF NOT EXISTS asset_checkouts_awaiting_verification ON public.asset_checkouts USING btree (verify_deadline_at) WHERE ((status = 'verifying'::checkout_status) AND (source_provider = 'seafile'::text));
CREATE INDEX IF NOT EXISTS idx_asset_path_history_asset_id_detected_at ON public.asset_path_history USING btree (asset_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_tags_asset_id ON public.asset_tags USING btree (asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_tags_source ON public.asset_tags USING btree (source);
CREATE INDEX IF NOT EXISTS idx_assets_file_type ON public.assets USING btree (file_type);
CREATE INDEX IF NOT EXISTS idx_assets_status ON public.assets USING btree (status);
CREATE INDEX IF NOT EXISTS idx_assets_workflow_status ON public.assets USING btree (workflow_status);
CREATE INDEX IF NOT EXISTS idx_assets_is_licensed ON public.assets USING btree (is_licensed);
CREATE INDEX IF NOT EXISTS idx_assets_modified_at ON public.assets USING btree (modified_at);
CREATE INDEX IF NOT EXISTS idx_assets_file_created_at ON public.assets USING btree (file_created_at);
CREATE INDEX IF NOT EXISTS idx_assets_licensor_id ON public.assets USING btree (licensor_id);
CREATE INDEX IF NOT EXISTS idx_assets_property_id ON public.assets USING btree (property_id);
CREATE INDEX IF NOT EXISTS idx_assets_product_subtype_id ON public.assets USING btree (product_subtype_id);
CREATE INDEX IF NOT EXISTS idx_assets_quick_hash ON public.assets USING btree (quick_hash);
CREATE INDEX IF NOT EXISTS idx_assets_tags ON public.assets USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_assets_is_deleted ON public.assets USING btree (is_deleted);
CREATE INDEX IF NOT EXISTS idx_assets_filename_trgm ON public.assets USING gin (filename extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_relative_path_trgm ON public.assets USING gin (relative_path extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_style_group_id ON public.assets USING btree (style_group_id);
CREATE INDEX IF NOT EXISTS idx_assets_ai_tagged_at ON public.assets USING btree (ai_tagged_at) WHERE (ai_tagged_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_assets_clear_style_cursor ON public.assets USING btree (id) WHERE ((is_deleted = false) AND (style_group_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_assets_primary_sort_tier ON public.assets USING btree (style_group_id, primary_sort_tier, created_at) WHERE (is_deleted = false);
CREATE INDEX IF NOT EXISTS idx_assets_compat_audit ON public.assets USING btree (id) WHERE ((file_type = 'ai'::file_type) AND (is_deleted = false) AND (thumbnail_url IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_assets_pdf_not_deleted ON public.assets USING btree (file_type, id) WHERE (is_deleted = false);
CREATE INDEX IF NOT EXISTS idx_assets_stage ON public.assets USING btree (stage);
CREATE INDEX IF NOT EXISTS idx_assets_customer ON public.assets USING btree (customer);
CREATE INDEX IF NOT EXISTS idx_assets_program ON public.assets USING btree (program);
CREATE INDEX IF NOT EXISTS idx_assets_program_trgm ON public.assets USING gin (program extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_customer_trgm ON public.assets USING gin (customer extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_facet_counts ON public.assets USING btree (is_deleted) INCLUDE (file_type, status, workflow_status, stage, is_licensed, modified_at, file_created_at, thumbnail_url, style_group_id) WHERE (is_deleted = false);
CREATE INDEX IF NOT EXISTS idx_characters_is_priority ON public.characters USING btree (is_priority) WHERE (is_priority = true);
CREATE INDEX IF NOT EXISTS idx_characters_usage_count ON public.characters USING btree (usage_count);
CREATE INDEX IF NOT EXISTS idx_eel_target_id ON public.erp_enrichment_log USING btree (target_id);
CREATE INDEX IF NOT EXISTS idx_eel_run_id ON public.erp_enrichment_log USING btree (run_id);
CREATE INDEX IF NOT EXISTS idx_erp_items_current_style_number ON public.erp_items_current USING btree (style_number);
CREATE INDEX IF NOT EXISTS idx_erp_items_current_mg_category ON public.erp_items_current USING btree (mg_category);
CREATE INDEX IF NOT EXISTS idx_erp_items_current_synced_at ON public.erp_items_current USING btree (synced_at);
CREATE INDEX IF NOT EXISTS idx_erp_items_current_dismissed ON public.erp_items_current USING btree (dismissed) WHERE (dismissed = true);
CREATE INDEX IF NOT EXISTS idx_erp_items_raw_external_id ON public.erp_items_raw USING btree (external_id);
CREATE INDEX IF NOT EXISTS idx_erp_items_raw_sync_run_id ON public.erp_items_raw USING btree (sync_run_id);
CREATE UNIQUE INDEX erp_sync_runs_one_running ON public.erp_sync_runs USING btree ((true)) WHERE (status = 'running'::text);
CREATE INDEX IF NOT EXISTS idx_hygiene_findings_check_type ON public.hygiene_findings USING btree (check_type);
CREATE INDEX IF NOT EXISTS idx_hygiene_findings_status ON public.hygiene_findings USING btree (status);
CREATE INDEX IF NOT EXISTS idx_hygiene_findings_asset_id ON public.hygiene_findings USING btree (asset_id);
CREATE INDEX IF NOT EXISTS idx_hygiene_findings_relative_path ON public.hygiene_findings USING btree (relative_path);
CREATE UNIQUE INDEX uq_hygiene_findings_path_check ON public.hygiene_findings USING btree (relative_path, check_type) WHERE (status <> 'resolved'::text);
CREATE INDEX IF NOT EXISTS idx_pdf_text_samples_asset_id ON public.pdf_text_samples USING btree (asset_id);
CREATE INDEX IF NOT EXISTS idx_pdf_text_samples_sampled_at ON public.pdf_text_samples USING btree (sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON public.processing_queue USING btree (status);
CREATE INDEX IF NOT EXISTS idx_prod_order_headers_current_style_number ON public.prod_order_headers_current USING btree (style_number);
CREATE INDEX IF NOT EXISTS idx_prod_order_headers_current_prod_order_number ON public.prod_order_headers_current USING btree (prod_order_number);
CREATE INDEX IF NOT EXISTS idx_prod_order_headers_current_due_date ON public.prod_order_headers_current USING btree (due_date);
CREATE INDEX IF NOT EXISTS idx_prod_order_headers_raw_external_id ON public.prod_order_headers_raw USING btree (external_id);
CREATE INDEX IF NOT EXISTS idx_prod_order_headers_raw_sync_run_id ON public.prod_order_headers_raw USING btree (sync_run_id);
CREATE INDEX IF NOT EXISTS idx_prod_order_sync_runs_started_at ON public.prod_order_sync_runs USING btree (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcp_status ON public.product_category_predictions USING btree (status);
CREATE INDEX IF NOT EXISTS idx_pcp_erp_item_id ON public.product_category_predictions USING btree (erp_item_id);
CREATE INDEX IF NOT EXISTS idx_render_queue_status ON public.render_queue USING btree (status);
CREATE UNIQUE INDEX uq_render_queue_asset_active ON public.render_queue USING btree (asset_id) WHERE (status = ANY (ARRAY['pending'::queue_status, 'claimed'::queue_status]));
CREATE INDEX IF NOT EXISTS idx_scanner_ai_ignores_path ON public.scanner_ai_ignores USING btree (relative_path);
CREATE INDEX IF NOT EXISTS sku_files_used_sku_idx ON public.sku_files_used USING btree (sku);
CREATE INDEX IF NOT EXISTS sku_files_used_style_guide_file_id_idx ON public.sku_files_used USING btree (style_guide_file_id) WHERE (style_guide_file_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_style_groups_sku ON public.style_groups USING btree (sku);
CREATE INDEX IF NOT EXISTS idx_style_groups_latest_file_date ON public.style_groups USING btree (latest_file_date);
CREATE INDEX IF NOT EXISTS idx_style_groups_licensor_id ON public.style_groups USING btree (licensor_id);
CREATE INDEX IF NOT EXISTS idx_style_groups_property_id ON public.style_groups USING btree (property_id);
CREATE INDEX IF NOT EXISTS idx_sg_stage ON public.style_groups USING btree (stage);
CREATE INDEX IF NOT EXISTS idx_sg_customer ON public.style_groups USING btree (customer);
CREATE INDEX IF NOT EXISTS idx_sg_program ON public.style_groups USING btree (program);
CREATE INDEX IF NOT EXISTS idx_sgf_root_label ON public.style_guide_files USING btree (root_label);
CREATE INDEX IF NOT EXISTS idx_sgf_directory_path ON public.style_guide_files USING btree (directory_path);
CREATE INDEX IF NOT EXISTS idx_sgf_normalized_name ON public.style_guide_files USING btree (normalized_name);
CREATE INDEX IF NOT EXISTS idx_sgf_is_active ON public.style_guide_files USING btree (is_active);
CREATE INDEX IF NOT EXISTS idx_sgf_crawl_run_id ON public.style_guide_files USING btree (crawl_run_id);
CREATE INDEX IF NOT EXISTS idx_sgf_style_guide_folder ON public.style_guide_files USING btree (style_guide_folder);
CREATE INDEX IF NOT EXISTS idx_sgf_property_folder ON public.style_guide_files USING btree (property_folder);
CREATE INDEX IF NOT EXISTS idx_sgf_licensor_name ON public.style_guide_files USING btree (licensor_name);
CREATE INDEX IF NOT EXISTS idx_sgf_render_errored ON public.style_guide_files USING btree (id) WHERE (is_active AND (thumbnail_url IS NULL) AND (thumbnail_error IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_style_guide_files_filename_trgm ON public.style_guide_files USING gin (lower(filename) extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_style_guide_files_active_modified ON public.style_guide_files USING btree (modified_at DESC NULLS LAST, filename) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_sgrq_status ON public.style_guide_render_queue USING btree (status);
CREATE INDEX IF NOT EXISTS idx_sgrq_file_id ON public.style_guide_render_queue USING btree (style_guide_file_id);
CREATE INDEX IF NOT EXISTS idx_sgrq_created_at ON public.style_guide_render_queue USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sgrq_status_created_at ON public.style_guide_render_queue USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sgrq_file_status ON public.style_guide_render_queue USING btree (style_guide_file_id, status);
CREATE INDEX IF NOT EXISTS idx_tiff_opt_status ON public.tiff_optimization_queue USING btree (status);
CREATE INDEX IF NOT EXISTS idx_tiff_opt_compression ON public.tiff_optimization_queue USING btree (compression_type);
CREATE INDEX IF NOT EXISTS tiff_optimization_queue_claimed_by_idx ON public.tiff_optimization_queue USING btree (claimed_by) WHERE (claimed_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS tiff_optimization_queue_claimed_at_idx ON public.tiff_optimization_queue USING btree (claimed_at) WHERE (claimed_at IS NOT NULL);

-- ------------------------------------------------------------------------------------
-- Foreign keys (only where the target is also in this baseline) (54)
-- ------------------------------------------------------------------------------------
ALTER TABLE core.art_types ADD CONSTRAINT art_types_divisioncode_id_fkey FOREIGN KEY (divisioncode_id) REFERENCES plm."divisionCode"("divCode_id");
ALTER TABLE core."merchGroupRelations" ADD CONSTRAINT "merchGroupRelations_child_mg_id_fkey" FOREIGN KEY (child_mg_id) REFERENCES core."merchGroupMaster"(mg_id) ON DELETE CASCADE;
ALTER TABLE core."merchGroupRelations" ADD CONSTRAINT "merchGroupRelations_grand_parent_mg_id_fkey" FOREIGN KEY (grand_parent_mg_id) REFERENCES core."merchGroupMaster"(mg_id) ON DELETE CASCADE;
ALTER TABLE core."merchGroupRelations" ADD CONSTRAINT "merchGroupRelations_parent_mg_id_fkey" FOREIGN KEY (parent_mg_id) REFERENCES core."merchGroupMaster"(mg_id) ON DELETE CASCADE;
ALTER TABLE core.properties_and_characters ADD CONSTRAINT properties_and_characters_licensor_id_fkey FOREIGN KEY (licensor_id) REFERENCES core."licenseList"("licenseList_id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE core.property_character_associations ADD CONSTRAINT property_character_associations_character_id_fkey FOREIGN KEY (character_id) REFERENCES core.properties_and_characters(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE core.property_character_associations ADD CONSTRAINT property_character_associations_licensor_id_fkey FOREIGN KEY (licensor_id) REFERENCES core."licenseList"("licenseList_id") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE core.property_character_associations ADD CONSTRAINT property_character_associations_property_id_fkey FOREIGN KEY (property_id) REFERENCES core.properties_and_characters(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE plm."RFQItem" ADD CONSTRAINT "fk_rfqItem_copied_from" FOREIGN KEY ("rfqItem_copied_from_id") REFERENCES plm."RFQItem"("rfqItem_id") ON DELETE SET NULL;
ALTER TABLE plm.art_piece_attachment ADD CONSTRAINT art_piece_attachment_company_code_fkey FOREIGN KEY (company_code) REFERENCES plm."companyCode"("comCode_id");
ALTER TABLE plm.art_piece_attachment ADD CONSTRAINT art_piece_attachment_divisioncode_id_fkey FOREIGN KEY (divisioncode_id) REFERENCES plm."divisionCode"("divCode_id");
ALTER TABLE plm."itemLicenseImage" ADD CONSTRAINT "itemLicenseImage_itemheader_id_fk_fkey" FOREIGN KEY (itemheader_id_fk) REFERENCES plm."itemHeader"(item_id_pk) ON DELETE CASCADE;
ALTER TABLE plm.item_character_associations ADD CONSTRAINT item_character_associations_character_id_fkey FOREIGN KEY (character_id) REFERENCES core.properties_and_characters(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE plm.item_character_associations ADD CONSTRAINT item_character_associations_item_header_id_fkey FOREIGN KEY (item_header_id) REFERENCES plm."itemHeader"(item_id_pk) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE plm.item_prod_order_detail_associations ADD CONSTRAINT item_prod_order_detail_associations_item_header_id_fkey FOREIGN KEY (item_header_id) REFERENCES plm."itemHeader"(item_id_pk) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE plm.item_prod_order_detail_associations ADD CONSTRAINT item_prod_order_detail_associations_prod_order_detail_pkey_fkey FOREIGN KEY (prod_order_detail_pkey) REFERENCES plm."ProdOrderDetail"(pkey) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE plm."licensingFeedbackReply" ADD CONSTRAINT "licensingFeedbackReply_licensing_status_id_fk_fkey" FOREIGN KEY (licensing_status_id_fk) REFERENCES plm."licensingStatus"(id) ON DELETE CASCADE;
ALTER TABLE plm."licensingStatus" ADD CONSTRAINT "licensingStatus_tagged_group_id_fkey" FOREIGN KEY (tagged_group_id) REFERENCES plm.groups(id);
ALTER TABLE plm."productUserAssignment" ADD CONSTRAINT "productUserAssignment_item_id_fk_fkey" FOREIGN KEY (item_id_fk) REFERENCES plm."itemHeader"(item_id_pk) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE plm.sample ADD CONSTRAINT sample_box_id_fk_fkey FOREIGN KEY (box_id_fk) REFERENCES plm.sample_box(box_id_pk) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE plm.sample ADD CONSTRAINT sample_factory_group_id_fk_fkey FOREIGN KEY (factory_group_id_fk) REFERENCES plm.sample_factory_group(factory_group_id_pk) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE plm.sample_attachment ADD CONSTRAINT sample_attachment_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES plm.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE plm.sample_comments ADD CONSTRAINT sample_comments_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES plm.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE plm.sample_event ADD CONSTRAINT sample_event_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES plm.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE plm.sample_shipment_item ADD CONSTRAINT sample_shipment_item_box_id_fk_fkey FOREIGN KEY (box_id_fk) REFERENCES plm.sample_box(box_id_pk) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE plm.sample_shipment_item ADD CONSTRAINT sample_shipment_item_sample_id_fk_fkey FOREIGN KEY (sample_id_fk) REFERENCES plm.sample(sample_id_pk) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public.agent_pairings ADD CONSTRAINT agent_pairings_agent_registration_id_fkey FOREIGN KEY (agent_registration_id) REFERENCES agent_registrations(id) ON DELETE CASCADE;
ALTER TABLE public.asset_characters ADD CONSTRAINT asset_characters_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
ALTER TABLE public.asset_characters ADD CONSTRAINT asset_characters_character_id_fkey FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE;
ALTER TABLE public.asset_checkouts ADD CONSTRAINT asset_checkouts_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT;
ALTER TABLE public.asset_checkouts ADD CONSTRAINT asset_checkouts_device_id_fkey FOREIGN KEY (device_id) REFERENCES helper_devices(id);
ALTER TABLE public.asset_path_history ADD CONSTRAINT asset_path_history_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
ALTER TABLE public.asset_tags ADD CONSTRAINT asset_tags_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
ALTER TABLE public.assets ADD CONSTRAINT assets_product_subtype_id_fkey FOREIGN KEY (product_subtype_id) REFERENCES product_subtypes(id) ON DELETE SET NULL;
ALTER TABLE public.assets ADD CONSTRAINT assets_style_group_id_fkey FOREIGN KEY (style_group_id) REFERENCES style_groups(id) ON DELETE SET NULL;
ALTER TABLE public.characters ADD CONSTRAINT characters_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
ALTER TABLE public.erp_items_current ADD CONSTRAINT erp_items_current_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES erp_sync_runs(id) ON DELETE SET NULL;
ALTER TABLE public.erp_items_raw ADD CONSTRAINT erp_items_raw_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES erp_sync_runs(id) ON DELETE SET NULL;
ALTER TABLE public.helper_tokens ADD CONSTRAINT helper_tokens_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
ALTER TABLE public.helper_tokens ADD CONSTRAINT helper_tokens_checkout_id_fkey FOREIGN KEY (checkout_id) REFERENCES asset_checkouts(id) ON DELETE SET NULL;
ALTER TABLE public.hygiene_findings ADD CONSTRAINT hygiene_findings_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
ALTER TABLE public.pdf_text_samples ADD CONSTRAINT pdf_text_samples_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
ALTER TABLE public.processing_queue ADD CONSTRAINT processing_queue_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
ALTER TABLE public.prod_order_headers_current ADD CONSTRAINT prod_order_headers_current_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES prod_order_sync_runs(id) ON DELETE SET NULL;
ALTER TABLE public.prod_order_headers_raw ADD CONSTRAINT prod_order_headers_raw_sync_run_id_fkey FOREIGN KEY (sync_run_id) REFERENCES prod_order_sync_runs(id) ON DELETE SET NULL;
ALTER TABLE public.product_category_predictions ADD CONSTRAINT product_category_predictions_erp_item_id_fkey FOREIGN KEY (erp_item_id) REFERENCES erp_items_current(id) ON DELETE CASCADE;
ALTER TABLE public.product_subtypes ADD CONSTRAINT product_subtypes_type_id_fkey FOREIGN KEY (type_id) REFERENCES product_types(id) ON DELETE CASCADE;
ALTER TABLE public.product_types ADD CONSTRAINT product_types_category_id_fkey FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE CASCADE;
ALTER TABLE public.properties ADD CONSTRAINT properties_licensor_id_fkey FOREIGN KEY (licensor_id) REFERENCES licensors(id) ON DELETE CASCADE;
ALTER TABLE public.render_queue ADD CONSTRAINT render_queue_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE;
ALTER TABLE public.sku_files_used ADD CONSTRAINT sku_files_used_style_guide_file_id_fkey FOREIGN KEY (style_guide_file_id) REFERENCES style_guide_files(id) ON DELETE SET NULL;
ALTER TABLE public.style_groups ADD CONSTRAINT style_groups_primary_asset_id_fkey FOREIGN KEY (primary_asset_id) REFERENCES assets(id) ON DELETE SET NULL;
ALTER TABLE public.style_guide_files ADD CONSTRAINT style_guide_files_crawl_run_id_fkey FOREIGN KEY (crawl_run_id) REFERENCES style_guide_crawl_runs(id) ON DELETE SET NULL;
ALTER TABLE public.style_guide_render_queue ADD CONSTRAINT style_guide_render_queue_style_guide_file_id_fkey FOREIGN KEY (style_guide_file_id) REFERENCES style_guide_files(id) ON DELETE CASCADE;

-- ------------------------------------------------------------------------------------
-- Views (1)
-- ------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.sg_archive_usage AS  WITH usage AS (
         SELECT f.licensor_name,
            f.property_folder,
            max(sg.latest_file_date) AS most_recent_design_date,
            count(DISTINCT u_1.id) AS design_ref_count,
            count(DISTINCT u_1.sku) AS designs_using
           FROM ((sku_files_used u_1
             JOIN style_groups sg ON ((sg.sku = u_1.sku)))
             JOIN style_guide_files f ON ((f.id = u_1.style_guide_file_id)))
          GROUP BY f.licensor_name, f.property_folder
        ), guides AS (
         SELECT style_guide_files.licensor_name,
            style_guide_files.property_folder,
            count(*) AS total_files,
            count(*) FILTER (WHERE style_guide_files.is_active) AS active_files,
            max(style_guide_files.modified_at) AS newest_sg_file_date
           FROM style_guide_files
          GROUP BY style_guide_files.licensor_name, style_guide_files.property_folder
        )
 SELECT g.licensor_name,
    g.property_folder,
    g.total_files,
    g.active_files,
    g.newest_sg_file_date,
    u.most_recent_design_date,
    COALESCE(u.designs_using, (0)::bigint) AS designs_using,
    COALESCE(u.design_ref_count, (0)::bigint) AS design_ref_count,
    ((u.most_recent_design_date IS NULL) OR (u.most_recent_design_date < (now() - '3 years'::interval))) AS archive_candidate
   FROM (guides g
     LEFT JOIN usage u ON (((u.licensor_name = g.licensor_name) AND (NOT (u.property_folder IS DISTINCT FROM g.property_folder)))));

-- ------------------------------------------------------------------------------------
-- PRE-ADOPTION TRIGGERS (25)
-- ------------------------------------------------------------------------------------
-- Triggers on the tables above that no migration in this repository creates. Without
-- them 20260723113000_dam_core_licensor_property_cutover aborts on a trigger it expects
-- to find ("trigger set_assets_updated_at for table assets does not exist"), so these
-- are as load-bearing as the functions they call. Guarded, because CREATE TRIGGER is not
-- CREATE OR REPLACE-able here and a migration may adopt one later.
-- ------------------------------------------------------------------------------------
do $bootstrap$ begin
  CREATE TRIGGER on_auth_user_email_confirmed AFTER UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_user_confirmed();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER asset_checkouts_updated_at BEFORE UPDATE ON public.asset_checkouts FOR EACH ROW EXECUTE FUNCTION update_asset_checkouts_updated_at();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_sync_asset_tags AFTER INSERT OR DELETE OR UPDATE ON public.asset_tags FOR EACH ROW EXECUTE FUNCTION sync_asset_tags_to_array();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER set_assets_updated_at BEFORE UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION set_assets_updated_at();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_auto_queue_render AFTER INSERT OR UPDATE OF thumbnail_error, thumbnail_url ON public.assets FOR EACH ROW EXECUTE FUNCTION auto_queue_render();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_compute_primary_sort_tier BEFORE INSERT OR UPDATE OF filename, relative_path, thumbnail_url, thumbnail_error ON public.assets FOR EACH ROW EXECUTE FUNCTION compute_primary_sort_tier();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_refresh_group_on_asset_hard_delete AFTER DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION refresh_group_on_asset_hard_delete();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_refresh_primary_on_asset_soft_delete AFTER UPDATE OF is_deleted ON public.assets FOR EACH ROW WHEN (((new.is_deleted = true) AND (old.is_deleted = false))) EXECUTE FUNCTION refresh_primary_on_asset_soft_delete();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_refresh_sg_counts_on_delete AFTER DELETE ON public.assets REFERENCING OLD TABLE AS old_table FOR EACH STATEMENT EXECUTE FUNCTION refresh_style_group_counts_on_asset_change();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_refresh_sg_counts_on_insert AFTER INSERT ON public.assets REFERENCING NEW TABLE AS new_table FOR EACH STATEMENT EXECUTE FUNCTION refresh_style_group_counts_on_asset_change();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_refresh_sg_counts_on_update AFTER UPDATE ON public.assets REFERENCING OLD TABLE AS old_table NEW TABLE AS new_table FOR EACH STATEMENT EXECUTE FUNCTION refresh_style_group_counts_on_asset_change();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_set_path_attrs BEFORE INSERT OR UPDATE OF relative_path ON public.assets FOR EACH ROW EXECUTE FUNCTION trg_set_asset_path_attrs();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_sync_cover_description_to_style_group AFTER INSERT OR UPDATE OF cover_description, style_group_id ON public.assets FOR EACH ROW EXECUTE FUNCTION sync_cover_description_to_style_group();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_sync_designer_to_style_group AFTER INSERT OR UPDATE OF designer_name, technical_designer_name, freelancer_name, style_group_id ON public.assets FOR EACH ROW EXECUTE FUNCTION sync_designer_to_style_group();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_sync_primary_on_thumbnail AFTER INSERT OR UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION sync_primary_asset_on_thumbnail();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER update_characters_updated_at BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER set_erp_items_current_updated_at BEFORE UPDATE ON public.erp_items_current FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER update_licensors_updated_at BEFORE UPDATE ON public.licensors FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_pdf_text_samples_parse_files AFTER INSERT ON public.pdf_text_samples FOR EACH ROW EXECUTE FUNCTION trg_fn_parse_pdf_files_used();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER update_prod_order_headers_current_updated_at BEFORE UPDATE ON public.prod_order_headers_current FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER update_properties_updated_at BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_resolve_sku_file_used BEFORE INSERT ON public.sku_files_used FOR EACH ROW EXECUTE FUNCTION trg_fn_resolve_sku_file_used();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER trg_set_path_attrs BEFORE INSERT OR UPDATE OF folder_path ON public.style_groups FOR EACH ROW EXECUTE FUNCTION trg_set_sg_path_attrs();
exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin
  CREATE TRIGGER update_style_groups_updated_at BEFORE UPDATE ON public.style_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
exception when duplicate_object then null; end $bootstrap$;

-- ------------------------------------------------------------------------------------
-- PRE-ADOPTION ROW SECURITY AND GRANTS (512 statements)
-- ------------------------------------------------------------------------------------
-- The objects above arrive from production with their access rules, and those rules are
-- part of the contract, not decoration. Several tests assert them directly, and several
-- more simply cannot run without them: with the grants missing, three contract tests
-- failed on "permission denied for function has_app_access" and "permission denied for
-- table style_tracker_item_bridge" even though every object they needed existed.
--
-- Policies are guarded so a migration that adopts one later does not collide.
-- ------------------------------------------------------------------------------------

-- Row-level security switched on (40)
alter table public.admin_config enable row level security;
alter table public.agent_pairings enable row level security;
alter table public.agent_registrations enable row level security;
alter table public.ai_sentinel_cleanup_log enable row level security;
alter table public.app_access enable row level security;
alter table public.asset_characters enable row level security;
alter table public.asset_checkouts enable row level security;
alter table public.asset_path_history enable row level security;
alter table public.asset_tags enable row level security;
alter table public.assets enable row level security;
alter table public.characters enable row level security;
alter table public.erp_enrichment_log enable row level security;
alter table public.erp_items_current enable row level security;
alter table public.erp_items_raw enable row level security;
alter table public.erp_sync_runs enable row level security;
alter table public.helper_devices enable row level security;
alter table public.helper_tokens enable row level security;
alter table public.hygiene_findings enable row level security;
alter table public.invitations enable row level security;
alter table public.licensors enable row level security;
alter table public.pdf_text_samples enable row level security;
alter table public.processing_queue enable row level security;
alter table public.prod_order_headers_current enable row level security;
alter table public.prod_order_headers_raw enable row level security;
alter table public.prod_order_sync_runs enable row level security;
alter table public.product_categories enable row level security;
alter table public.product_category_predictions enable row level security;
alter table public.product_subtypes enable row level security;
alter table public.product_types enable row level security;
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.render_queue enable row level security;
alter table public.scanner_ai_ignores enable row level security;
alter table public.sku_files_used enable row level security;
alter table public.style_groups enable row level security;
alter table public.style_guide_crawl_runs enable row level security;
alter table public.style_guide_files enable row level security;
alter table public.style_guide_render_queue enable row level security;
alter table public.tiff_optimization_queue enable row level security;
alter table public.user_roles enable row level security;

-- Row-security policies (67)
do $bootstrap$ begin create policy "Admin delete admin_config" on public.admin_config for delete to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin update admin_config" on public.admin_config for update to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin write admin_config" on public.admin_config for insert to authenticated with check (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "anon can read SCAN_REQUEST for Realtime watcher" on public.admin_config for select to anon using ((key = 'SCAN_REQUEST'::text)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage agent_pairings" on public.agent_pairings for all to public using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "authenticated users can read agent_registrations" on public.agent_registrations for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage agent_registrations" on public.agent_registrations for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admins manage app_access" on public.app_access for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Users read own app_access" on public.app_access for select to authenticated using ((user_id = auth.uid())); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Authenticated read asset_characters" on public.asset_characters for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin write asset_characters" on public.asset_characters for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "users update own checkouts" on public.asset_checkouts for update to public using ((user_id = auth.uid())); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "users insert own checkouts" on public.asset_checkouts for insert to public with check ((user_id = auth.uid())); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "authenticated users see all checkouts" on public.asset_checkouts for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Authenticated read asset_path_history" on public.asset_path_history for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Authenticated read asset_tags" on public.asset_tags for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage asset_tags" on public.asset_tags for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admins can update assets" on public.assets for update to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admins can insert assets" on public.assets for insert to authenticated with check (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Authenticated users can read visible assets" on public.assets for select to authenticated using ((is_deleted = false)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin write characters" on public.characters for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Authenticated read characters" on public.characters for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage erp_enrichment_log" on public.erp_enrichment_log for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage erp_items_current" on public.erp_items_current for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage erp_items_raw" on public.erp_items_raw for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage erp_sync_runs" on public.erp_sync_runs for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "users update own devices" on public.helper_devices for update to public using ((user_id = auth.uid())); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "users insert own devices" on public.helper_devices for insert to public with check ((user_id = auth.uid())); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "users see own devices" on public.helper_devices for select to public using ((user_id = auth.uid())); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "users see own tokens" on public.helper_tokens for select to public using ((user_id = auth.uid())); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "users insert own tokens" on public.helper_tokens for insert to public with check ((user_id = auth.uid())); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage hygiene_findings" on public.hygiene_findings for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage invitations" on public.invitations for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin write licensors" on public.licensors for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Authenticated read licensors" on public.licensors for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "admin full access pdf_text_samples" on public.pdf_text_samples for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage processing_queue" on public.processing_queue for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Authenticated users can read prod_order_headers_current" on public.prod_order_headers_current for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admins manage prod_order_headers_current" on public.prod_order_headers_current for all to public using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Service role manages prod_order_headers_current" on public.prod_order_headers_current for all to service_role using (true) with check (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admins manage prod_order_headers_raw" on public.prod_order_headers_raw for all to public using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Service role manages prod_order_headers_raw" on public.prod_order_headers_raw for all to service_role using (true) with check (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admins manage prod_order_sync_runs" on public.prod_order_sync_runs for all to public using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Service role manages prod_order_sync_runs" on public.prod_order_sync_runs for all to service_role using (true) with check (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin write product_categories" on public.product_categories for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Authenticated read product_categories" on public.product_categories for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage product_category_predictions" on public.product_category_predictions for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin write product_subtypes" on public.product_subtypes for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Authenticated read product_subtypes" on public.product_subtypes for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Authenticated read product_types" on public.product_types for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin write product_types" on public.product_types for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admins read all profiles" on public.profiles for select to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Users read own profile" on public.profiles for select to authenticated using ((user_id = auth.uid())); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Users update own profile" on public.profiles for update to authenticated using ((user_id = auth.uid())); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Authenticated read properties" on public.properties for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin write properties" on public.properties for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage render_queue" on public.render_queue for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "service role all" on public.sku_files_used for all to service_role using (true) with check (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "authenticated read" on public.sku_files_used for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admins can manage style_groups" on public.style_groups for all to public using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "authenticated read style_guide_crawl_runs" on public.style_guide_crawl_runs for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "admin full access style_guide_crawl_runs" on public.style_guide_crawl_runs for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "authenticated read style_guide_files" on public.style_guide_files for select to authenticated using (true); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "admin full access style_guide_files" on public.style_guide_files for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage style_guide_render_queue" on public.style_guide_render_queue for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admin manage tiff_optimization_queue" on public.tiff_optimization_queue for all to public using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;
do $bootstrap$ begin create policy "Admins manage user_roles" on public.user_roles for all to authenticated using (has_role(auth.uid(), 'admin'::app_role)); exception when duplicate_object then null; end $bootstrap$;

-- Table and view grants (163)
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.admin_config to service_role;
grant MAINTAIN, REFERENCES, SELECT, TRIGGER on public.admin_config to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.admin_config to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.admin_config to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.agent_pairings to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.agent_pairings to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.agent_pairings to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.agent_pairings to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.agent_registrations to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.agent_registrations to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.agent_registrations to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.agent_registrations to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.ai_sentinel_cleanup_log to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.ai_sentinel_cleanup_log to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.ai_sentinel_cleanup_log to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.ai_sentinel_cleanup_log to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.app_access to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.app_access to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.app_access to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.app_access to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_characters to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_characters to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_characters to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_characters to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_checkouts to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_checkouts to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_checkouts to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_checkouts to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_path_history to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_path_history to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_path_history to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_path_history to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_tags to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_tags to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_tags to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.asset_tags to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.assets to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.assets to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.assets to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.assets to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.characters to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.characters to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.characters to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.characters to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_enrichment_log to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_enrichment_log to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_enrichment_log to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_enrichment_log to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_items_current to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_items_current to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_items_current to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_items_current to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_items_raw to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_items_raw to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_items_raw to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_items_raw to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_sync_runs to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_sync_runs to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_sync_runs to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.erp_sync_runs to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.helper_devices to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.helper_devices to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.helper_devices to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.helper_devices to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.helper_tokens to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.helper_tokens to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.helper_tokens to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.helper_tokens to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.hygiene_findings to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.hygiene_findings to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.hygiene_findings to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.hygiene_findings to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invitations to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invitations to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invitations to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.invitations to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.licensors to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.licensors to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.licensors to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.licensors to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.pdf_text_samples to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.pdf_text_samples to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.pdf_text_samples to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.pdf_text_samples to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.processing_queue to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.processing_queue to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.processing_queue to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.processing_queue to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_headers_current to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_headers_current to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_headers_current to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_headers_current to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_headers_raw to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_headers_raw to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_headers_raw to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_headers_raw to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_sync_runs to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_sync_runs to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_sync_runs to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prod_order_sync_runs to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_categories to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_categories to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_categories to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_categories to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_category_predictions to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_category_predictions to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_category_predictions to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_category_predictions to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_subtypes to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_subtypes to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_subtypes to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_subtypes to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_types to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_types to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_types to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.product_types to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.profiles to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.profiles to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.profiles to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.profiles to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.properties to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.properties to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.properties to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.properties to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.render_queue to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.render_queue to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.render_queue to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.render_queue to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.scanner_ai_ignores to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.scanner_ai_ignores to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.scanner_ai_ignores to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.scanner_ai_ignores to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sg_archive_usage to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sg_archive_usage to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sg_archive_usage to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sku_files_used to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sku_files_used to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sku_files_used to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.sku_files_used to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_groups to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_groups to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_groups to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_groups to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_crawl_runs to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_crawl_runs to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_crawl_runs to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_crawl_runs to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_files to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_files to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_files to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_files to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_render_queue to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_render_queue to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_render_queue to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.style_guide_render_queue to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tiff_optimization_queue to postgres;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tiff_optimization_queue to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tiff_optimization_queue to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.tiff_optimization_queue to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.user_roles to service_role;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.user_roles to anon;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.user_roles to authenticated;
grant DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.user_roles to postgres;

-- Function grants (239)
grant EXECUTE on function public.auto_queue_render() to public;
grant EXECUTE on function public.auto_queue_render() to service_role;
grant EXECUTE on function public.auto_queue_render() to anon;
grant EXECUTE on function public.auto_queue_render() to authenticated;
grant EXECUTE on function public.auto_queue_render() to postgres;
grant EXECUTE on function public.backfill_pdf_files_used() to anon;
grant EXECUTE on function public.backfill_pdf_files_used() to authenticated;
grant EXECUTE on function public.backfill_pdf_files_used() to service_role;
grant EXECUTE on function public.backfill_pdf_files_used() to public;
grant EXECUTE on function public.backfill_pdf_files_used() to postgres;
grant EXECUTE on function public.bulk_assign_style_groups(p_assignments jsonb) to service_role;
grant EXECUTE on function public.bulk_assign_style_groups(p_assignments jsonb) to postgres;
grant EXECUTE on function public.bulk_assign_style_groups(p_assignments jsonb) to authenticated;
grant EXECUTE on function public.bulk_insert_pdf_text_samples(p_rows jsonb) to service_role;
grant EXECUTE on function public.bulk_insert_pdf_text_samples(p_rows jsonb) to authenticated;
grant EXECUTE on function public.bulk_insert_pdf_text_samples(p_rows jsonb) to postgres;
grant EXECUTE on function public.claim_jobs(p_agent_id text, p_batch_size integer) to authenticated;
grant EXECUTE on function public.claim_jobs(p_agent_id text, p_batch_size integer) to service_role;
grant EXECUTE on function public.claim_jobs(p_agent_id text, p_batch_size integer) to postgres;
grant EXECUTE on function public.claim_pdf_backfill_batch(p_limit integer) to postgres;
grant EXECUTE on function public.claim_pdf_backfill_batch(p_limit integer) to service_role;
grant EXECUTE on function public.claim_pdf_backfill_batch(p_limit integer) to authenticated;
grant EXECUTE on function public.claim_render_jobs(p_agent_id text, p_batch_size integer, p_lease_minutes integer, p_max_attempts integer) to postgres;
grant EXECUTE on function public.claim_render_jobs(p_agent_id text, p_batch_size integer, p_lease_minutes integer, p_max_attempts integer) to authenticated;
grant EXECUTE on function public.claim_render_jobs(p_agent_id text, p_batch_size integer, p_lease_minutes integer, p_max_attempts integer) to service_role;
grant EXECUTE on function public.claim_sg_render_jobs(p_agent_id text, p_batch_size integer, p_lease_minutes integer, p_max_attempts integer) to postgres;
grant EXECUTE on function public.claim_sg_render_jobs(p_agent_id text, p_batch_size integer, p_lease_minutes integer, p_max_attempts integer) to authenticated;
grant EXECUTE on function public.claim_sg_render_jobs(p_agent_id text, p_batch_size integer, p_lease_minutes integer, p_max_attempts integer) to anon;
grant EXECUTE on function public.claim_sg_render_jobs(p_agent_id text, p_batch_size integer, p_lease_minutes integer, p_max_attempts integer) to service_role;
grant EXECUTE on function public.claim_sg_render_jobs(p_agent_id text, p_batch_size integer, p_lease_minutes integer, p_max_attempts integer) to public;
grant EXECUTE on function public.claim_tiff_jobs(p_agent_id text, p_batch_size integer, p_lease_minutes integer) to authenticated;
grant EXECUTE on function public.claim_tiff_jobs(p_agent_id text, p_batch_size integer, p_lease_minutes integer) to service_role;
grant EXECUTE on function public.claim_tiff_jobs(p_agent_id text, p_batch_size integer, p_lease_minutes integer) to postgres;
grant EXECUTE on function public.cleanup_mega_group_tags_batch() to postgres;
grant EXECUTE on function public.cleanup_mega_group_tags_batch() to authenticated;
grant EXECUTE on function public.cleanup_mega_group_tags_batch(p_cursor uuid, p_batch_size integer, p_min_group_size integer) to service_role;
grant EXECUTE on function public.cleanup_mega_group_tags_batch(p_cursor uuid, p_batch_size integer, p_min_group_size integer) to postgres;
grant EXECUTE on function public.cleanup_mega_group_tags_batch(p_cursor uuid, p_batch_size integer, p_min_group_size integer) to authenticated;
grant EXECUTE on function public.cleanup_mega_group_tags_batch() to service_role;
grant EXECUTE on function public.clear_style_group_batch(p_last_id uuid, p_batch_size integer) to service_role;
grant EXECUTE on function public.clear_style_group_batch(p_last_id uuid, p_batch_size integer) to postgres;
grant EXECUTE on function public.clear_style_group_batch(p_last_id uuid, p_batch_size integer) to authenticated;
grant EXECUTE on function public.compute_primary_sort_tier() to postgres;
grant EXECUTE on function public.compute_primary_sort_tier() to authenticated;
grant EXECUTE on function public.compute_primary_sort_tier() to anon;
grant EXECUTE on function public.compute_primary_sort_tier() to public;
grant EXECUTE on function public.compute_primary_sort_tier() to service_role;
grant EXECUTE on function public.count_pdf_backfill_remaining() to authenticated;
grant EXECUTE on function public.count_pdf_backfill_remaining() to service_role;
grant EXECUTE on function public.count_pdf_backfill_remaining() to postgres;
grant EXECUTE on function public.deactivate_stale_sg_files(p_root_label text, p_run_id uuid) to service_role;
grant EXECUTE on function public.deactivate_stale_sg_files(p_root_label text, p_run_id uuid) to authenticated;
grant EXECUTE on function public.deactivate_stale_sg_files(p_root_label text, p_run_id uuid) to postgres;
grant EXECUTE on function public.execute_readonly_query(query_text text) to postgres;
grant EXECUTE on function public.execute_readonly_query(query_text text) to service_role;
grant EXECUTE on function public.find_ai_pdf_duplicates() to service_role;
grant EXECUTE on function public.find_ai_pdf_duplicates() to authenticated;
grant EXECUTE on function public.find_ai_pdf_duplicates() to postgres;
grant EXECUTE on function public.get_filter_counts(p_filters jsonb) to service_role;
grant EXECUTE on function public.get_filter_counts(p_filters jsonb) to postgres;
grant EXECUTE on function public.get_filter_counts(p_filters jsonb) to authenticated;
grant EXECUTE on function public.get_sg_preview_stats() to authenticated;
grant EXECUTE on function public.get_sg_preview_stats() to postgres;
grant EXECUTE on function public.get_sg_preview_stats() to service_role;
grant EXECUTE on function public.get_sg_render_queue_stats() to postgres;
grant EXECUTE on function public.get_sg_render_queue_stats() to service_role;
grant EXECUTE on function public.get_sg_render_queue_stats() to authenticated;
grant EXECUTE on function public.handle_new_user() to public;
grant EXECUTE on function public.handle_new_user() to authenticated;
grant EXECUTE on function public.handle_new_user() to service_role;
grant EXECUTE on function public.handle_new_user() to anon;
grant EXECUTE on function public.handle_new_user() to postgres;
grant EXECUTE on function public.handle_user_confirmed() to authenticated;
grant EXECUTE on function public.handle_user_confirmed() to anon;
grant EXECUTE on function public.handle_user_confirmed() to postgres;
grant EXECUTE on function public.handle_user_confirmed() to public;
grant EXECUTE on function public.handle_user_confirmed() to service_role;
grant EXECUTE on function public.has_app_access(_user_id uuid, _app app_name) to anon;
grant EXECUTE on function public.has_app_access(_user_id uuid, _app app_name) to authenticated;
grant EXECUTE on function public.has_app_access(_user_id uuid, _app app_name) to postgres;
grant EXECUTE on function public.has_app_access(_user_id uuid, _app app_name) to public;
grant EXECUTE on function public.has_app_access(_user_id uuid, _app app_name) to service_role;
grant EXECUTE on function public.has_role(_user_id uuid, _role app_role) to service_role;
grant EXECUTE on function public.has_role(_user_id uuid, _role app_role) to authenticated;
grant EXECUTE on function public.has_role(_user_id uuid, _role app_role) to anon;
grant EXECUTE on function public.has_role(_user_id uuid, _role app_role) to postgres;
grant EXECUTE on function public.has_role(_user_id uuid, _role app_role) to public;
grant EXECUTE on function public.infer_path_attrs(p_path text) to public;
grant EXECUTE on function public.infer_path_attrs(p_path text) to anon;
grant EXECUTE on function public.infer_path_attrs(p_path text) to authenticated;
grant EXECUTE on function public.infer_path_attrs(p_path text) to postgres;
grant EXECUTE on function public.infer_path_attrs(p_path text) to service_role;
grant EXECUTE on function public.is_style_guide_source_pdf(p_file_type text, p_filename text) to service_role;
grant EXECUTE on function public.is_style_guide_source_pdf(p_file_type text, p_filename text) to public;
grant EXECUTE on function public.is_style_guide_source_pdf(p_file_type text, p_filename text) to postgres;
grant EXECUTE on function public.is_style_guide_source_pdf(p_file_type text, p_filename text) to authenticated;
grant EXECUTE on function public.is_style_guide_source_pdf(p_file_type text, p_filename text) to anon;
grant EXECUTE on function public.normalize_for_sg_match(p text) to public;
grant EXECUTE on function public.normalize_for_sg_match(p text) to service_role;
grant EXECUTE on function public.normalize_for_sg_match(p text) to anon;
grant EXECUTE on function public.normalize_for_sg_match(p text) to authenticated;
grant EXECUTE on function public.normalize_for_sg_match(p text) to postgres;
grant EXECUTE on function public.parse_pdf_files_used(p_asset_id uuid) to service_role;
grant EXECUTE on function public.parse_pdf_files_used(p_asset_id uuid) to postgres;
grant EXECUTE on function public.parse_pdf_files_used(p_asset_id uuid) to authenticated;
grant EXECUTE on function public.parse_pdf_files_used(p_asset_id uuid) to anon;
grant EXECUTE on function public.parse_pdf_files_used(p_asset_id uuid) to public;
grant EXECUTE on function public.propagate_group_tags_batch(p_cursor uuid, p_batch_size integer) to service_role;
grant EXECUTE on function public.propagate_group_tags_batch(p_cursor uuid, p_batch_size integer) to authenticated;
grant EXECUTE on function public.propagate_group_tags_batch(p_cursor uuid, p_batch_size integer) to postgres;
grant EXECUTE on function public.queue_nightly_rebuild_style_groups() to service_role;
grant EXECUTE on function public.queue_nightly_rebuild_style_groups() to authenticated;
grant EXECUTE on function public.queue_nightly_rebuild_style_groups() to postgres;
grant EXECUTE on function public.queue_sg_render_jobs_by_ids(p_file_ids uuid[]) to postgres;
grant EXECUTE on function public.queue_sg_render_jobs_by_ids(p_file_ids uuid[]) to authenticated;
grant EXECUTE on function public.queue_sg_render_jobs_by_ids(p_file_ids uuid[]) to anon;
grant EXECUTE on function public.queue_sg_render_jobs_by_ids(p_file_ids uuid[]) to service_role;
grant EXECUTE on function public.queue_sg_render_jobs_by_ids(p_file_ids uuid[]) to public;
grant EXECUTE on function public.reconcile_style_group_stats_batch(p_cursor uuid, p_batch_size integer, p_sub text) to postgres;
grant EXECUTE on function public.reconcile_style_group_stats_batch(p_cursor uuid, p_batch_size integer, p_sub text) to service_role;
grant EXECUTE on function public.reconcile_style_group_stats_batch(p_cursor uuid, p_batch_size integer, p_sub text) to authenticated;
grant EXECUTE on function public.refresh_group_on_asset_hard_delete() to anon;
grant EXECUTE on function public.refresh_group_on_asset_hard_delete() to service_role;
grant EXECUTE on function public.refresh_group_on_asset_hard_delete() to public;
grant EXECUTE on function public.refresh_group_on_asset_hard_delete() to postgres;
grant EXECUTE on function public.refresh_group_on_asset_hard_delete() to authenticated;
grant EXECUTE on function public.refresh_primary_on_asset_soft_delete() to anon;
grant EXECUTE on function public.refresh_primary_on_asset_soft_delete() to authenticated;
grant EXECUTE on function public.refresh_primary_on_asset_soft_delete() to postgres;
grant EXECUTE on function public.refresh_primary_on_asset_soft_delete() to public;
grant EXECUTE on function public.refresh_primary_on_asset_soft_delete() to service_role;
grant EXECUTE on function public.refresh_style_group_counts() to service_role;
grant EXECUTE on function public.refresh_style_group_counts() to authenticated;
grant EXECUTE on function public.refresh_style_group_counts() to postgres;
grant EXECUTE on function public.refresh_style_group_counts_batch(p_group_ids uuid[]) to authenticated;
grant EXECUTE on function public.refresh_style_group_counts_batch(p_group_ids uuid[]) to service_role;
grant EXECUTE on function public.refresh_style_group_counts_batch(p_group_ids uuid[]) to postgres;
grant EXECUTE on function public.refresh_style_group_counts_on_asset_change() to authenticated;
grant EXECUTE on function public.refresh_style_group_counts_on_asset_change() to anon;
grant EXECUTE on function public.refresh_style_group_counts_on_asset_change() to public;
grant EXECUTE on function public.refresh_style_group_counts_on_asset_change() to postgres;
grant EXECUTE on function public.refresh_style_group_counts_on_asset_change() to service_role;
grant EXECUTE on function public.refresh_style_group_primaries(p_group_ids uuid[]) to postgres;
grant EXECUTE on function public.refresh_style_group_primaries(p_group_ids uuid[]) to service_role;
grant EXECUTE on function public.refresh_style_group_primaries(p_group_ids uuid[]) to authenticated;
grant EXECUTE on function public.refresh_style_guide_matviews() to service_role;
grant EXECUTE on function public.refresh_style_guide_matviews() to authenticated;
grant EXECUTE on function public.refresh_style_guide_matviews() to postgres;
grant EXECUTE on function public.requeue_all_failed_sg_jobs(p_limit integer) to service_role;
grant EXECUTE on function public.requeue_all_failed_sg_jobs(p_limit integer) to authenticated;
grant EXECUTE on function public.requeue_all_failed_sg_jobs(p_limit integer) to postgres;
grant EXECUTE on function public.reset_stale_jobs(p_timeout_minutes integer) to authenticated;
grant EXECUTE on function public.reset_stale_jobs(p_timeout_minutes integer) to postgres;
grant EXECUTE on function public.reset_stale_jobs(p_timeout_minutes integer) to service_role;
grant EXECUTE on function public.resolve_sku_files_used() to anon;
grant EXECUTE on function public.resolve_sku_files_used() to service_role;
grant EXECUTE on function public.resolve_sku_files_used() to public;
grant EXECUTE on function public.resolve_sku_files_used() to postgres;
grant EXECUTE on function public.resolve_sku_files_used() to authenticated;
grant EXECUTE on function public.resolve_sku_files_used_fuzzy(p_threshold real) to public;
grant EXECUTE on function public.resolve_sku_files_used_fuzzy(p_threshold real) to postgres;
grant EXECUTE on function public.resolve_sku_files_used_fuzzy(p_threshold real) to authenticated;
grant EXECUTE on function public.resolve_sku_files_used_fuzzy(p_threshold real) to anon;
grant EXECUTE on function public.resolve_sku_files_used_fuzzy(p_threshold real) to service_role;
grant EXECUTE on function public.retry_sg_render_errors(p_file_ids uuid[]) to service_role;
grant EXECUTE on function public.retry_sg_render_errors(p_file_ids uuid[]) to postgres;
grant EXECUTE on function public.retry_sg_render_errors(p_file_ids uuid[]) to authenticated;
grant EXECUTE on function public.retry_sg_render_errors(p_file_ids uuid[], p_limit integer) to service_role;
grant EXECUTE on function public.retry_sg_render_errors(p_file_ids uuid[], p_limit integer) to postgres;
grant EXECUTE on function public.retry_sg_render_errors(p_file_ids uuid[], p_limit integer) to authenticated;
grant EXECUTE on function public.run_full_reconcile_style_group_stats() to service_role;
grant EXECUTE on function public.run_full_reconcile_style_group_stats() to anon;
grant EXECUTE on function public.run_full_reconcile_style_group_stats() to authenticated;
grant EXECUTE on function public.run_full_reconcile_style_group_stats() to postgres;
grant EXECUTE on function public.run_full_reconcile_style_group_stats() to public;
grant EXECUTE on function public.set_assets_updated_at() to authenticated;
grant EXECUTE on function public.set_assets_updated_at() to postgres;
grant EXECUTE on function public.set_assets_updated_at() to public;
grant EXECUTE on function public.set_assets_updated_at() to service_role;
grant EXECUTE on function public.set_assets_updated_at() to anon;
grant EXECUTE on function public.set_style_group_cover(p_group_id uuid, p_asset_id uuid) to authenticated;
grant EXECUTE on function public.set_style_group_cover(p_group_id uuid, p_asset_id uuid) to postgres;
grant EXECUTE on function public.set_style_group_cover(p_group_id uuid, p_asset_id uuid) to service_role;
grant EXECUTE on function public.sync_asset_tags_to_array() to authenticated;
grant EXECUTE on function public.sync_asset_tags_to_array() to service_role;
grant EXECUTE on function public.sync_asset_tags_to_array() to public;
grant EXECUTE on function public.sync_asset_tags_to_array() to postgres;
grant EXECUTE on function public.sync_asset_tags_to_array() to anon;
grant EXECUTE on function public.sync_cover_description_to_style_group() to service_role;
grant EXECUTE on function public.sync_cover_description_to_style_group() to public;
grant EXECUTE on function public.sync_cover_description_to_style_group() to postgres;
grant EXECUTE on function public.sync_cover_description_to_style_group() to authenticated;
grant EXECUTE on function public.sync_cover_description_to_style_group() to anon;
grant EXECUTE on function public.sync_designer_to_style_group() to service_role;
grant EXECUTE on function public.sync_designer_to_style_group() to anon;
grant EXECUTE on function public.sync_designer_to_style_group() to authenticated;
grant EXECUTE on function public.sync_designer_to_style_group() to postgres;
grant EXECUTE on function public.sync_designer_to_style_group() to public;
grant EXECUTE on function public.sync_primary_asset_on_thumbnail() to anon;
grant EXECUTE on function public.sync_primary_asset_on_thumbnail() to authenticated;
grant EXECUTE on function public.sync_primary_asset_on_thumbnail() to postgres;
grant EXECUTE on function public.sync_primary_asset_on_thumbnail() to public;
grant EXECUTE on function public.sync_primary_asset_on_thumbnail() to service_role;
grant EXECUTE on function public.trg_fn_parse_pdf_files_used() to anon;
grant EXECUTE on function public.trg_fn_parse_pdf_files_used() to authenticated;
grant EXECUTE on function public.trg_fn_parse_pdf_files_used() to postgres;
grant EXECUTE on function public.trg_fn_parse_pdf_files_used() to public;
grant EXECUTE on function public.trg_fn_parse_pdf_files_used() to service_role;
grant EXECUTE on function public.trg_fn_resolve_sku_file_used() to service_role;
grant EXECUTE on function public.trg_fn_resolve_sku_file_used() to anon;
grant EXECUTE on function public.trg_fn_resolve_sku_file_used() to authenticated;
grant EXECUTE on function public.trg_fn_resolve_sku_file_used() to postgres;
grant EXECUTE on function public.trg_fn_resolve_sku_file_used() to public;
grant EXECUTE on function public.trg_set_asset_path_attrs() to service_role;
grant EXECUTE on function public.trg_set_asset_path_attrs() to authenticated;
grant EXECUTE on function public.trg_set_asset_path_attrs() to anon;
grant EXECUTE on function public.trg_set_asset_path_attrs() to public;
grant EXECUTE on function public.trg_set_asset_path_attrs() to postgres;
grant EXECUTE on function public.trg_set_sg_path_attrs() to postgres;
grant EXECUTE on function public.trg_set_sg_path_attrs() to anon;
grant EXECUTE on function public.trg_set_sg_path_attrs() to authenticated;
grant EXECUTE on function public.trg_set_sg_path_attrs() to service_role;
grant EXECUTE on function public.trg_set_sg_path_attrs() to public;
grant EXECUTE on function public.update_asset_checkouts_updated_at() to postgres;
grant EXECUTE on function public.update_asset_checkouts_updated_at() to anon;
grant EXECUTE on function public.update_asset_checkouts_updated_at() to authenticated;
grant EXECUTE on function public.update_asset_checkouts_updated_at() to public;
grant EXECUTE on function public.update_asset_checkouts_updated_at() to service_role;
grant EXECUTE on function public.update_updated_at_column() to postgres;
grant EXECUTE on function public.update_updated_at_column() to anon;
grant EXECUTE on function public.update_updated_at_column() to authenticated;
grant EXECUTE on function public.update_updated_at_column() to service_role;
grant EXECUTE on function public.update_updated_at_column() to public;

-- ------------------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN
-- ------------------------------------------------------------------------------------
-- * Any column that a migration in this repository ADDs to one of the tables above.
--   This file is the PRE-adoption shape. Leaving such a column in would make that
--   migration abort with "column already exists" and, because a migration is applied in
--   a single transaction, lose every other statement in its file too.
-- * Any index or constraint whose name a migration creates on the same table, for the
--   same reason.
-- * Any foreign key whose target is created by a migration rather than by this file.
-- * Any row. Not one.
-- ------------------------------------------------------------------------------------
