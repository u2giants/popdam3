# DesignFlow services vs Cloud SQL schema `designflow`: read-only code scan

Scanned 2026-10-02 from shallow clones of branch `develop` of popcre/designflow-{backend,bff,item-master,tracking,data-syncing,frontend}, kept in this folder. No secret values are recorded here. Evidence paths are relative to this folder. Tests, docs and e2e code were excluded.

## 0. Headline findings
- **No Cloud SQL <-> Supabase sync exists in the code.** `designflow-data-syncing` copies **ColdLion ERP (x5.coldlion.com/EhpApi/...) into the service's own database**, which is whatever DB_HOST points at. In production that is Cloud SQL `designflow`. It never writes to Supabase `dflow` in production. Evidence: data-syncing/models/lib.model.js:805,852,912,939,993,1021.
- **Each service has ONE primary Sequelize connection, chosen entirely by environment variables:** `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`, `SCHEMA`, `DB_SSL`, `DB_PROVIDER`, `DB_EXPECTED_PORT`, `DB_NETWORK_PATH`, `DB_<FIELD>_SECRET_ID/_SECRET_VERSION`, `DEPLOY_ENV`/`NODE_ENV`, `MULTI_SCHEMA`, `DB_POOL_MAX/MIN/ACQUIRE/IDLE/EVICT`, `DB_CONNECT_TIMEOUT`, `DB_AUTH_RETRIES`, `DB_APPLICATION_NAME`.
  - The production contract accepts `DB_PROVIDER=cloud-sql` (port 5432, DB_SSL=false) **or** `DB_PROVIDER=supabase` (pooler port 6543, DB_SSL=true, a pooler host, a `postgres.<ref>` user).
  - The same contract is copied into all four DB services. Evidence: backend/config/database-connection-contract.js:54-110.
- **Schemas.** Production uses one schema: `SCHEMA` must be `designflow`, set through Sequelize's `schema` option. Non-production environments (on Supabase) use a per-model schema map in `config/table-schema-map.js`, with search_path `dflow, plm, core, app, public` set in an afterConnect hook.
  - That map already sends models to `dflow`, `plm`, `core` and `app`. It is effectively the target layout.
  - Examples: users, Roles, Factory, customers, comments and artists go to `dflow`. Master data goes to `core` (licenseList, merchGroup, properties_and_characters, vendor and others). AuditLog, auth_token and RolePermissions go to `app`. RFQ, item and sample tables go to `plm`.
  - Evidence: backend/config/table-schema-map.js:25-140; backend/models/db.js:24-43.
- **There is one secondary connection.** The backend HTS RAG store reads `HTS_RAG_DB_ENABLED` and `HTS_RAG_DB_{HOST,PORT,USER,PASSWORD,NAME,SCHEMA,SOURCE_ENVIRONMENT,SSL}`, with schema `hts_rag` on Supabase.
  - Cloud Build deploys it **off** (`HTS_RAG_DB_ENABLED=false`). It is switched on only when the substitution `_HTS_RAG_DB_ENABLED` is `'true'`, and the default is `'false'`. Evidence: backend/config/hts-rag-db.config.js:1-30; backend/cloudbuild.yaml:88,107-129,171.
  - A code comment says the nine `hts_rag_*` tables have no foreign keys into the PLM tables, so this is the one slice that can move early.
- **The BFF has no database access.** It is a pure proxy (bff/src/backendProxy.js, serviceMap.js).
- **The frontend has no Supabase client.** It only has a cosmetic `databaseProvider: 'supabase'|'cloudsql'` badge (frontend/src/app/config/database-provider.config.ts:1-14; environments/environment.*.ts).

## 1. Tables per service
Model names come from `sql.<Model>.<op>` calls (R = read, W = write). The table name usually matches the model name; check `tableName:` in models/db/*.js. For example, the model artPiece maps to table `art_piece`.

### backend (RFQ, master data, users/roles, grids, HTS)
- **Read only:** Roles, divisionCode, UDFElement, UDFElementType, UDFComponent, UDFTable, StandardizedSize/Version/Group/Detail/ProductType, RFQItemStatus, RFQStep, itemDepth, SeasonCode, companyCode, GridAccessLevel, GridChildrenLayoutOrder, ItemUserAssignment, ItemWorkflowAction, UIElements, properties_and_characters, property_character_associations, item_character_associations, HtsRagExtractionJob, HtsRagPrecedentRuling, HtsRagProductExample.
- **Read/write:** RFQItem, RFQVendor, RFQGroup, RFQContainer, RFQWhse, itemHeader, itemSize, itemAttachment, Factory, vendor, vendorGroup, customers, licenseList, merchGroup, users, RolePermissions, AdditionalUserEmail, auth_token, quote_auth_token, user_notification, AuditLog, AppSetting, AiCacheEvent, AgeGroup, Artist, ArtistTypes, ArtTypes, FOBCountry, deliveryLocation, GridLayout, GridChildrenLayout, GridViewState, GridCellNote, StandardizedProductElement, StandardizedVendor, comments, and every HtsRag* model (Ruling, Precedent, Determination, DebateRun, ProviderResponse, ReviewEvent, ProductFamilyAllowlist).
- **Write only:** email_logs.
- **Database functions called:** `set_item_user_assignment`, `record_item_workflow_action`, `item_workflow_handoff` (backend/services/rfq-workflow.service.js:159-240).
- **Raw SQL:** an insert into `public.hts_rag_rulings`, and a join to `"RFQItem"` (backend/helpers/rfqVendorRows.js:117).

### data-syncing
- **Read:** merchGroup, merchGroupHeaders, UDFTable, itemHeader, externalApi.
- **Write:**
  - ProdOrderHeader: upsert, updated only when the incoming row is newer (lib.model.js:149).
  - ProdOrderDetail, itemDetail, item_prod_order_detail_associations.
  - externalVendor and externalCustomer: bulkCreate (lib.model.js:998,1026).
  - Merch-group rows: findOrCreate (lib.model.js:240,344).
- **Other:** item images go to GCS/DigitalOcean storage, not the database.

### item-master
- **Read:** ProductCategory, users, merchGroup, GridAccessLevel, groups, RFQItem, LicenseFeedBacks, LicensingTime, SeasonCode, customers, divisionCode.
- **Read/write:** itemHeader, itemAttachment, itemType, artPiece (`art_piece`), artPieceAttachment, licensingStatus, licensingFeedbackReply, productUserAssignment, GridCellNote.
- **Write only:** AuditLog.
- **Other:** it also calls ColdLion directly, using env `COLDLION_API_KEY` (item-master/config/coldlion.config.js:69).

### tracking (samples, production tracking, licensing timelines)
- **Read:** RolePermissions, users, sample_carrier, sample_movement, merchGroup, GridAccessLevel, UDFTable, ProdOrderDetail, customers, itemAttachment, LicenseFeedBacks, externalCustomer, externalVendor, UIElements, Factory, vendor.
- **Read/write:** itemHeader, ProdOrderHeader, groups, GridCellNote, email_logs, DesignTeamTime, FactoryTime, LicensingTime, ProductTypeFactoryTime, licensingStatus, and these sample tables: sample, sample_attachment, sample_box, sample_comments, sample_creation_batch, sample_event, sample_factory_group, sample_factory_visit, sample_factory_visit_event, sample_import_job, sample_import_row, sample_path_revision, sample_shipment, sample_shipment_item, sample_shipment_line, sample_shipment_notice, sample_stop_closeout, sample_workflow.
- **Write only:** sample_shipment_notice_recipient.
- **Objects reached only through raw SQL (`qualifiedTable()`):** sample_remote_request, sample_remote_request_item, sample_remote_request_history, sample_reservation, sample_approval_event, sample_approval_current, sample_balance_by_location, sample_global_status, sample_piece_lineage, sample_visit_plan.
- **Database functions called:** post_sample_movement, post_sample_piece_split, post_sample_approval_event, post_sample_remote_request_event, reserve_sample_remote_request_item, pack_sample_reservation, claim_sample_shipment_notice.
- **Check before relying on these:** confirm the raw-SQL objects and functions exist in Cloud SQL `designflow`. They belong to the newer sample flows 3 and 4 and may exist only on Supabase `plm`.

### Tables used by more than one service
These must move together, or stay reachable from every service that uses them:
- itemHeader and merchGroup: all 4 services.
- UDFTable: 3 services.
- ProdOrderHeader/ProdOrderDetail: data-syncing, tracking, item-master.
- RFQItem: backend, item-master.
- licensingStatus: item-master, tracking.
- Also: users, GridAccessLevel, GridCellNote, customers, itemAttachment, groups, externalVendor/externalCustomer, AuditLog, RolePermissions/UIElements, email_logs, Factory/vendor.

## 2. Implicit links, written as `TableA.col -> TableB`
Model-level `references:` entries are Sequelize metadata only. `sequelize.sync()` is never called, so they do not prove that a real database foreign key exists. Compare them with the Cloud SQL capture before relying on them.

### backend/models/db/init-models.js
- vendor.factory_id_fk -> Factory (:34-35)
- divisionCode.company_name_fk -> companyCode.company_name (:37)
- comments.user_id -> users.id (:39)
- itemAttachment.comment_id -> comments.id (:40)
- ItemUserAssignment.user_id and .assigned_by_user_id -> users (:42-43)
- ItemWorkflowAction.actor_user_id -> users (:44)
- user_notification.workflow_action_id -> ItemWorkflowAction (:45)
- RolePermissions.RoleId -> Roles; RolePermissions.ElementId -> UIElements (:47-51)
- Model references: RolePermissions -> users.id, and UIElements refers to itself (RolePermissions.js:17-36, UIElements.js:26)
- ArtTypes, ArtistTypes, Artist and AgeGroup .created_by -> users (:53-63)
- ArtTypes.divisioncode_id and Artist.divisioncode_id -> divisionCode
- Artist.artist_type_id -> ArtistTypes
- Artist.art_source_id -> merchGroup.mg_id
- properties_and_characters.licensor_id -> licenseList (:78-85; the model reference points at licenseList.licenseList_id)
- property_character_associations.property_id and .character_id -> properties_and_characters (:65-94)
- property_character_associations -> licenseList (property_character_associations.js:27)
- item_character_associations.itemHeaderId -> itemHeader.item_id_pk (:96)
- item_character_associations.characterId -> properties_and_characters (:99)
- RFQItem lookup columns (:143-152):
  - rfqItem_customer -> customers.customers_id
  - rfqItem_active -> RFQItemStatus
  - rfqItem_depth -> itemDepth
  - rfqItem_delivery_loc -> deliveryLocation
  - rfqItem_rfq_group -> RFQGroup
  - rfqItem_step -> RFQStep
  - rfqItem_choosen_vendor -> Factory.id
  - rfq_container_id_fk -> RFQContainer
- RFQVendor.RFQitem_id_fk -> RFQItem.rfqItem_id (:155)
- RFQVendor.vendor_id_fk -> Factory.id (:162)
- GridLayout.col_id -> GridAccessLevel.col_id (:172)
- **Some associations are defined by rows in the `UDFTable` table, not by the schema.** At startup the code reads UDFTable rows with container_id='rfq' to find the primary table, the joined tables and their key columns (:103-140). Part of the RFQ grid's relationship graph is therefore stored as data, so UDFTable must move with the RFQ tables. The same comment and pattern appear in item-master (init-models.js:34).

### item-master/models/db/init-models.js
- itemAttachment.item_num_id_fk -> itemHeader.item_id_pk (:36)
- ProdOrderDetail <-> itemHeader (:38-47). In tracking this is ProdOrderDetail.itemNo -> itemHeader.item_num_id (tracking init-models.js:132).
- itemHeader.item_type_id_fk -> itemType.item_type_id (:48-49)
- art_piece_attachment.art_piece_id -> art_piece (:50)
- art_piece_attachment -> companyCode.comCode_id, divisionCode.divCode_id, users (artPieceAttachment.js:42-90)
- productUserAssignment -> itemHeader.item_id_pk and users (:54-70)
- licensingStatus.assignee_id and .assignor_id -> users (:72-73)
- licensingStatus.tagged_group_id -> groups (:76-77)
- licensingFeedbackReply -> licensingStatus and users (:81-95)
- itemHeader.udf_merchgroup01_id..udf_merchgroup04_id and udf_merchgroup05_fk_id..udf_merchgroup10_fk_id -> merchGroup.mg_id (:100-110; same in tracking :98)
- art_piece.licensor_id, property_id, style_guide_id, big_theme_id, little_theme_id, art_source_id, art_type_id, artist_id, age_group_id -> merchGroup.mg_id (:115-135; artPiece.js:22-104)
- art_piece.season_code_id -> SeasonCode.id
- art_piece -> divisionCode.divCode_id and users (artPiece.js:112-142)

### tracking/models/db/init-models.js
- These all point at itemHeader.item_id_pk (:35-73): itemAttachment.item_num_id_fk, licensingStatus.itemheader_id_fk, licensingMilestone, itemLicenseImage.itemheader_id_fk, comments.item_header_id.
- ProdOrderDetail.prodOrderNo -> ProdOrderHeader.prodOrderNo (:121-122)
- item_prod_order_detail_associations.itemHeaderId -> itemHeader.item_id_pk (:146-175)
- item_prod_order_detail_associations.prodOrderDetailPkey -> ProdOrderDetail.pkey (:146-175). Raw SQL uses the column names `item_header_id` and `prod_order_detail_pkey`.
- These all point at sample.sample_id_pk (:186-411): sample_event, sample_comments, sample_attachment, sample_shipment_item, sample_workflow, sample_factory_visit, sample_piece_lineage, sample_movement, sample_shipment_line, sample_stop_closeout.
- sample -> sample_factory_group and sample_box (:236-249)
- sample_comments -> users (:210)
- sample_workflow -> sample_creation_batch (:300-305)
- sample_path_revision -> sample_workflow (:319-324)
- sample_shipment -> sample_carrier (:336)
- sample_shipment_line -> sample_shipment (:350-355)
- sample_factory_visit_event -> sample_factory_visit (:371-372)
- sample_import_row -> sample_import_job (:422)

### Raw SQL joins
- ProdOrderHeader.prodOrderNo = ProdOrderDetail.prodOrderNo; the association table's prod_order_detail_pkey = ProdOrderDetail.pkey; itemHeader.item_id_pk = the association table's item_header_id (tracking/controllers/lead-time-templates.controller.js:150-152).
- itemHeader.item_num_id = ProdOrderDetail."itemNo", plus the association table and licensingStatus (tracking/helpers/prodTrackerDerived.js:305-330 and 665-716).
- Licensing rows -> itemHeader.item_id_pk; the assignee_ids jsonb array -> users (tracking/models/lic.model.js:110-112, 224, 965).
- vendor/Factory join (tracking/models/lib.model.js:138).
- sample_factory_visit -> sample_piece_lineage (sampleFactoryVisit.model.js:134).
- sample_remote_request_item -> sample_remote_request (sampleWorkflowFlow4.model.js:229-241, 570, 967).
- RFQVendor -> "RFQItem" (backend/helpers/rfqVendorRows.js:117).
- Workflow history -> users.id through original_actor_user_id (backend/services/rfq-workflow.service.js:239).

## 3. Transactions spanning several tables (those tables must stay in one database)
- **backend/services/rfq-workflow.service.js:159,212.** Covers RFQItem, ItemUserAssignment and users, plus the database functions set_item_user_assignment, record_item_workflow_action and item_workflow_handoff. It also sets the session values `request.designflow.actor_id` and `actor_email` through `set_config` (:56-58), so database-side functions or triggers read the actor from them.
- **backend/models/lib.model.js:621.** A read-only REPEATABLE READ shadow read of RFQItem with its lookup includes.
- **backend/services/role.service.js:87.** RolePermissions, inside an advisory lock.
- **backend hts-rag-*.service.js** (precedent, graduation, auto-promotion, authority-refresh, benchmark). Touches HtsRag* tables only, which are self-contained.
- **backend/helpers/archive-oldest-rfq.js:34.** RFQItem.
- **item-master/services/item_detail.service.js:492.** licensingStatus, licensingFeedbackReply, itemAttachment.
- **item-master/services/art_piece.service.js:719.** art_piece, art_piece_attachment.
- **tracking/controllers/lead-time-templates.controller.js:328,370.** FactoryTime and ProductTypeFactoryTime.
- **tracking sample models.** The whole sample_* family, with Factory and customers lookups, is one transactional cluster:
  - sample.model.js:892,1159
  - sampleShipment:405,632
  - sampleGroup:685,914
  - sampleGuidedCreate:328
  - sampleImport:274,437
  - sampleFactoryVisit: 8 transactions
  - sampleWorkflowFlow3: 4 transactions
  - sampleWorkflowFlow4: 8 transactions
  - sampleQaFixture:70

The resulting groups of tables that must move together:
- RFQ*, ItemUserAssignment, ItemWorkflowAction, users, and the workflow functions
- all sample_* tables
- licensingStatus, licensingFeedbackReply, itemAttachment
- art_piece, art_piece_attachment
- FactoryTime, ProductTypeFactoryTime
- HtsRag*

## 4. Database-level features in use
- **Advisory locks** (they must not collide with lock IDs already used on Supabase; see shared-db docs/advisory-lock-registry.md):
  - `pg_advisory_xact_lock(21461, 1)`: backend/services/role.service.js:88
  - `pg_advisory_xact_lock(21450, sample_id)`: tracking/models/sampleWorkflowFlow3.model.js:99
  - `pg_advisory_xact_lock(21460, sample_id)`: tracking/models/sampleWorkflowFlow4.model.js:713
- **Session settings** `request.designflow.actor_id` and `actor_email`, set with `set_config` (rfq-workflow.service.js:58). Database triggers or functions consume them.
- **Stored functions** listed in section 1. They must exist in whichever database a service points at.
- **Not found on develop:** LISTEN/NOTIFY, explicit `nextval` or sequences shared between tables, CREATE TRIGGER/TABLE/ALTER run at startup in models/db.js (the old inline migrations are gone), and `sequelize.sync()`.
- **Audit logging in the application.** Sequelize afterCreate, afterUpdate and afterBulkCreate hooks on every model write to AuditLog (backend/models/db/init-models.js:183-220; item-master init-models.js:138-175). AuditLog must therefore be writable from those services' connections.
- **Timers.** Only the connection-pool monitoring timer and the HTS debate scheduler (backend/helpers/hts-rag/debate-scheduler.js:43). There is no node-cron.
- **data-syncing scheduling.** Its endpoints are HTTP-triggered and protected by an `X-API-Key` header checked against `DFLOW_SYNC_API_KEY`. Whatever calls them on a schedule is outside these repos.
- **data-syncing data flow.** ColdLion into the database only: ProdOrderHeader upsert, ProdOrderDetail, externalVendor, externalCustomer, itemDetail, item_prod_order_detail_associations, and merch groups via findOrCreate. **None of the repos has a job that copies data between Cloud SQL and Supabase `dflow`.**

## 5. Supabase connections today
- **All four database services.** In non-production environments (develop, staging, sandbox, preview) the primary connection already goes to the Supabase pooler (port 6543, multi-schema). Production goes to Cloud SQL `designflow` (port 5432), and the contract already allows production `DB_PROVIDER=supabase`.
- **backend HTS RAG secondary database.** On Supabase, schema `hts_rag`, controlled by `HTS_RAG_DB_ENABLED` (Cloud Build default is false).
- **tracking/models/sampleGroup.model.js:340.** Only a code comment that mentions the unified-Supabase relationships map; there is no connection.
- **Frontend and BFF.** No connection.
