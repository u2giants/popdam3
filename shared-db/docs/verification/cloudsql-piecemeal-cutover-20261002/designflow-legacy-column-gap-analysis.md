# DesignFlow legacy column gap analysis (2026-10-23, three passes)

Purpose: before DesignFlow moves from the legacy CloudSQL-shaped tables to the
normalized canonical tables, every column the application code uses must have
a home. Companion to `designflow-code-table-usage.md` (table level); this file
is column level. To be published via PR on 2026-10-23 at Albert's request.

Evidence basis: `types/database.types.ts` at `dd8fb725a`; code in the main
checkouts of `designflow-backend`, `-item-master`, `-tracking`,
`-data-syncing`, `-frontend/src` (nested worktrees, `node_modules`, shared-db
copies excluded). Live check (2026-10-23, read-only, production pooler): all 255 columns of the
18 main normalized targets (licensor, item, merch group, customer, factory,
RFQ group/item/vendor, production order/line, licensing status/feedback, art
piece, item attachment, product size, profile, activity, comment) match the
generated types; none of the "missing" columns exists live.

Legacy-shaped copies (`core."licenseList"`, `RFQItem`, `itemHeader`,
`ProdOrderHeader`, `customers`, `Factory`) still exist, and
`backend/config/table-schema-map.js` points non-production at them. Gaps below
are against the normalized targets.

## Rules used

- Albert, 2026-10-23: every field the application code uses must be present.
- Albert, 2026-10-23: the code decides; item merch group slots 12–14 get no
  column because only the sync writes them.
- Albert, 2026-10-23: of the 19 ColdLion-API fields the sync copies in but the
  app never reads, keep only three: movie art (`udf_yesno01`), character
  likeness (`udf_yesno03`) and the MG02 item-number code (merch group
  `ItemNoCode`). Leave out the other 16. Model-only and null-only columns are
  also not needed.

## Licensor / license

- `core.licensor`: `code`, `name`, `status`, `metadata`, timestamps. No royalty
  columns.
- Needed: `licenseList_royalty_rate`, `licenseList_fob_royalty_rate` (per
  license, not per licensor). Written at `backend/models/lib.model.js:250-272`;
  used heavily by the frontend RFQ and license screens. Needs a
  license-agreement table linked to licensor
  (`docs/normalized-licensing-master-dependency-audit-20260813.md`).
- Not needed: `licenseList_auditlog` (model only).
- Also open: no approved old-to-new ID mapping for `properties_and_characters`
  / `property_character_associations` into `core.property` / `core.character`
  / `core.style_guide`.

## Items (`itemHeader`) → `plm.item`

Already covered: `status`, `name`, `description`, `licensor_id`,
`property_id` (cover `item_active_status`, `item_descr_name`, merch slots
05/06 licensor/property).

Needed (read by app): dimensions and weights (`item_length/width/depth/
weight_size`, `carton_*`), `uom_*`, `hts_num_ext_fk`, `hts2_num_ext_fk`,
`retail_price`, `selling_price`, `udf_item_priceA`–`H`, `season_code_fk`,
`mfg_lead_time`, `innerpack_qty`, `vendor_code_fk`, `udf_freeform_*`,
`udf_date*`, `udf_int*` (each to be confirmed read in the crosswalk), plus:
`item_note`, `item_cost_ext`, `item_content`, `ref_num`, `dsn_ref_num`,
`div_code_fk`, `tags`, `discont_status`, `royalty_code_fk`,
`salesper_code_fk`, `productmanager`, `udfnum01`, `mod_user_fk`,
`item_displ_descr_name`, `art_piece_id`, `due_date`. Relations used by the item
detail screen: product user assignments, item attachments.

Needed by ruling (ColdLion): `udf_yesno01` (movie art), `udf_yesno03`
(character likeness).
Not needed (ColdLion sync-only, ruling): `old_item_num`, `compare_price`,
`item_cbm_size`, `origin_country_fk`, `costcomp1`–`5`, `udf_yesno02` (share
UPC). Not needed (only blanked): `udf_num02`–`10`, `udf_yesno04`–`15`.
`udfnum01` is read and stays (`udf_num01` is sync-only; see crosswalk §4).

`art_piece` (item-master) has nine merch group references with no canonical
foreign key.

### Merch group slots on the item

The merch group list itself is loaded from the API into `core.merch_group`.
Legacy columns are `udf_merchgroupNN_fk`, with companion `_fk_id` for 05–15
and `udf_merchgroup0N_id` for 01–03; the app reads the companions too.

| Slots | Use | Column needed |
|---|---|---|
| 01–10 | read by item-master library/numbering, backend autofill, tracking, frontend | yes (incl. id companions) |
| 11 | read by the frontend item detail screen only | yes |
| 15 | read by autofill, tracking, item-master, frontend | yes |
| 12–14 | written only by data-syncing | no (ruling) |
| 16–25 | only set to null | no |

## Merch groups → `core.merch_group`

Already covered: code, description, `parent_id`.
Needed: `is_active`, `mgTypeCode`, `mgCode2`, `mgCategory`, `companyCode_fk`,
`divisionCode_fk`, `modUser`.
Needed by ruling (ColdLion): `ItemNoCode` (MG02 item-number code).
Not needed (ColdLion sync-only): `createdUser`.

## Vendors / factories

- `core.vendor` mirrors legacy 1:1; `vendor_passw` needs a security review.
- `core.factory` needed: `factory_nickname`, `factory_access`. Not needed:
  `sort_order` (no factory use found).

## Customers → `core.customer`

Needed: `customers_dilution`, `customers_logistic_load`, `customers_logo`.
Not needed (model only): `_level`, `_subscription`, `_subleveladmin`,
`_notificationsms`, `_notificationemail`, `_expire`, `_passw`, `_auditlog`.

## RFQ → `plm.rfq_item` / RFQ vendor

`plm.rfq_item` has only item, group, status, target cost.

`RFQItem` needed (all `rfqItem_` prefixed): gen/lic pricing across
fob/whse/poe/mddp (sale, sell, royalty, net sell, margin, entered values),
`fob_cost`, `landed_cost`, `duty_rate*`, `freight`, `cbm*`, `case_pack`,
`quantity`, `dilution`, `comp_retail`, `wholesale`, `license`, `royalty`,
`step`, `choosen_vendor`, `agent`, `udf1`–`4`, `picture`, `tech_pack_link`.

`RFQVendor` needed (`RFQVendor_` prefixed): `amount`, `cbm_pc`, `carton_*`,
`lead_time`, `price_terms`, `fob_country`, `fob_port`, `quote_date`,
`requote_requested`, `std_vendor_id_fk`, archive flags, `note`, `status`, plus
`req_status`, `vendor_id_fk`.

`UDFTable` drives part of the RFQ grid joins and must move with it.

## Production orders → `plm.production_order` / lines

Already covered: dates, status, container; line `case_pack`, `unit_cost`.
Header needed: hang-tag, safety-test, photo, inspection and doc tracking flags,
deposit/payment columns, `currencyCode`, `payTermCode`, `prod_cost`, `cbm`,
`svn`, `mg5`. Line needed: `wipQty`, `merchGroup05Desc`.
Not needed: `vendorProc`, `agentProc`, `forwarderProc`, `CostSheetFkey`,
`BOMFKey`, `MovedQty`, `CancelledQty` (model only); `colorCode`, `sizeCode`
(sync only).

## Third pass (2026-10-23): every remaining table

How the app reaches the database: Sequelize models only; no `.rpc()`, views or
DB functions. Only raw SQL is boot-time DDL in `backend/models/db.js:75-256`
(adds columns to RFQItem, RFQVendor, customers, vendor, Factory, users,
GridViewState, app_settings, ai_cache_events, grid_cell_notes; seeds
UIElements/RolePermissions) and one SELECT in `autofill.service.js:88`. Every
table the app uses exists at least as a same-name legacy copy in `plm`/`dflow`.
Gaps below are against normalized homes.

### Item variations (`itemDetail`)
No column is read by the app (only joined at `tracking/models/lib.model.js:216`).
Every populated column is ColdLion sync-only (`data-syncing/helpers/utility.js:264-354`):
keys, label/dim/prepack/size/color codes, UPC/EAN/GTIN, statuses, prices,
HTS, royalty, salesperson, season, vendor, uom, dimensions, packing, merch
groups 01–14, UDFs, audit. All other columns are always null. Per the ColdLion
ruling, no normalized columns needed unless Albert names some.

### RFQ steps, containers, warehouses, groups
Missing (read): `RFQGroup.IsLegacy` (`lib.model.js:2000,2047`), the whole
RFQStep definition (`RFQStep_title`, `_status`, `_access_level`,
`_notified_user_level`; `lib.model.js:2121-2122,3124-3127,4497`),
`RFQContainer_price` and `RFQWhse_price` (`rfqListQuery.js:100-104,156`).
`RFQGroup_name` → `rfq_group.name`. Lookups `RFQItemStatus`,
`deliveryLocation`: no normalized home.

### UDF / custom grid definitions
`UDFTable_name`, `UDFTable_primary_id`, `UDFElement_id_fk`
(`lib.model.js:497,889`; frontend editor) and UDFComponent/UDFElement/
UDFElementType/UDFGroup (name, layer, visibility, width, height, data_key,
display_name): no normalized home.

### Attachments
`item_attachment` covers link, type, item. Missing: `attachment_display_name`,
`item_attachment_fileName`, `primary_image`, `comment_id`, `uuid`
(`lib.model.js:82-83,3699,3715`; `comment.service.js:23`). `artPieceAttachment`
has `plm.art_piece_attachment`.

### Lookup lists
Missing normalized table: season (`autofill.service.js:219`), FOB country
(`lib.model.js:3916`), division (`admin.service.js:270`), company (no
`core.company` though `plm.item.company_id` exists), delivery location, RFQ
item status, item type (maybe `core.product_type`, unconfirmed). `itemSize` →
`core.product_size` but no unit column. `itemDepth` → `core.product_depth`.
`plm.reference_value` may be the intended generic home — unconfirmed.
Already homed: age group, art types, artist, artist types, vendor group,
merch group headers.

### Licensing
`licensingStatus` → `plm.licensing_status`; missing: `assignee_ids`,
`assignor_id`, `pop_comments`, `package`, `from`, `tagged_group_id`,
`attachments` (`item-master/services/item_detail.service.js:29,54,184,381,459,773,874`;
`helpers/licensingTimeline.js:327`).
Reply → `plm.licensing_feedback`; missing `tagged_user_ids`, `attachments`
(`:906,909`). `LicenseFeedBacks` catalog (status, item_order, explanation): no
normalized table. `LicensingTime`, `DesignTeamTime`, `FactoryTime` lead-time
tables: no normalized home. `licensingMilestone`: model only, not needed.
`itemLicenseImage`, `groups` (teams): legacy copies only.

### Comments and notifications
`sample_comments` → `app.comment` but no parent/thread column. Legacy
`comments`: unused. `user_notification` → `app.notification` (type/event into
payload); OK.

### Screen layouts
`GridLayout`, `GridChildrenLayout(Order)`, `GridAccessLevel`, `GridViewState`:
no normalized home (read by `grid.service.js:15`, `std.service.js:41-69`,
`lib.model.js:656,3973`). `grid_cell_notes`: already fine.

### Standardized products
Eight `Standardized*` tables (detail, group, product element/value, type,
size, vendor, version) read at `lib.model.js:1894,2409-2438`,
`std.service.js:563,1198`: no normalized home.

### Users, roles, permissions
`users` → `app.profile`; missing `passw`, `graph_photo_synced_at`,
`office_location` (samples), separate first/last name and photo fields.
`RolePermissions` + `UIElements` (element-level access): no normalized home.
`productUserAssignment` (per-item role): no normalized home.
`AdditionalUserEmail`, `auth_token`, `quote_auth_token`, `email_logs`,
`app_settings`, `ai_cache_events`: legacy-shaped `app.*` copies.

### Art pieces
`plm.art_piece` missing: `art_number`, `tags`, `licensor_id`, `property_id`,
`style_guide_id`, season/big theme/little theme/age group/division ids,
`is_active` (`item-master/services/art_piece.service.js:17-74`).
`property_character_associations` missing `licensor_id` (derivable).

### Samples
`sample`, `sample_attachment`, `sample_box`, `sample_comments`,
`sample_event`, `sample_factory_group`, `sample_shipment_item`: heavily read by
tracking; no normalized model.

### Audit history
`AuditLog` → `app.activity`; missing `oldValue`, `newValue`, `element_id`.

### Other
`externalVendor`, `externalCustomer` (`core.*` legacy-shaped),
`item_prod_order_detail_associations`, `externalApi`,
`item_character_associations`: legacy copies only.

### Not needed
Model files only: `ShippingPort`, `ProdShipmentTransitTime`,
`ProdPaymentTerms`, `RFQItemDivision`, `productions`, `licensingMilestone`,
legacy `comments`. No legacy table exists for cost sheets, BOM, colours, uom,
royalty or salesperson codes (codes live only on ColdLion item columns).

### Caveats
Columns flagged here come from model fields matched in logic files; the
crosswalk must confirm each. The boot-time DDL writes to unqualified names and
depends on which schema copy is active.

## Next steps

1. Done 2026-10-23: decision recorded in `designflow-legacy-column-crosswalk.md` §3
   (every area with an app-read column is carried; as-is vs reshape in §2).
2. Done 2026-10-23: `designflow-legacy-column-crosswalk.csv` (923 columns; private, link in `docs/private-data-artifacts.md`).
3. One issue per business area, claim the objects (`shared-db-change`); start
   with license agreements, then items.
4. Regenerate types and re-run the crosswalk until it shows zero gaps.
