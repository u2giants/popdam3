# DesignFlow table index and naming standard (2026-11-05)

Every DesignFlow production table (`dflow_prod`, 134 tables, read live on 2026-11-05),
grouped by business area. Each group has one prefix.

**Naming standard (new tables only):** a new DesignFlow table takes its group's prefix,
in lowercase snake_case, for example `rfq_vendor_quote` or `sample_label`. Existing tables
keep their names. This index links each old name to its group, so old and new tables in
one area are found together. A new table outside every group needs a new group added
here first.

The "Permanent home" column lists the same-name table in `plm` / `core` / `app`, or the new
home to build. Nothing stays in `dflow_prod`: that schema is deleted at the end. The move order is in
[designflow-dflow-prod-move-groups-20261105.md](designflow-dflow-prod-move-groups-20261105.md).

## Grid layouts — prefix for new tables: `grid_`

| Table today | Permanent home |
|---|---|
| GridAccessLevel | plm.GridAccessLevel |
| GridChildrenLayout | plm.GridChildrenLayout |
| GridChildrenLayoutOrder | plm.GridChildrenLayoutOrder |
| GridLayout | plm.GridLayout |
| GridViewState | plm.GridViewState |
| grid_cell_notes | plm.grid_cell_notes |
| tracking_grid_archive | plm (new table needed) |

## User-defined fields — prefix for new tables: `udf_`

| Table today | Permanent home |
|---|---|
| UDFComponent | plm.UDFComponent |
| UDFElement | plm.UDFElement |
| UDFElementType | plm.UDFElementType |
| UDFGroup | plm.UDFGroup |
| UDFQuery | plm.UDFQuery |
| UDFTable | plm.UDFTable |

## Standardized product — prefix for new tables: `std_`

| Table today | Permanent home |
|---|---|
| StandardizedDetail | plm.StandardizedDetail |
| StandardizedGroup | plm.StandardizedGroup |
| StandardizedProductElement | plm.StandardizedProductElement |
| StandardizedProductElementValue | plm.StandardizedProductElementValue |
| StandardizedProductType | plm.StandardizedProductType |
| StandardizedSize | plm.StandardizedSize |
| StandardizedVendor | plm.StandardizedVendor |
| StandardizedVersion | plm.StandardizedVersion |

## Samples — prefix for new tables: `sample_`

| Table today | Permanent home |
|---|---|
| sample | plm.sample |
| sample_approval_event | plm (new table needed) |
| sample_attachment | plm.sample_attachment |
| sample_box | plm.sample_box |
| sample_carrier | plm (new table needed) |
| sample_comments | plm.sample_comments |
| sample_creation_batch | plm (new table needed) |
| sample_event | plm.sample_event |
| sample_factory_group | plm.sample_factory_group |
| sample_factory_visit | plm (new table needed) |
| sample_factory_visit_event | plm (new table needed) |
| sample_import_job | plm (new table needed) |
| sample_import_row | plm (new table needed) |
| sample_inventory_balance | plm (new table needed) |
| sample_movement | plm (new table needed) |
| sample_path_revision | plm (new table needed) |
| sample_piece_lineage | plm (new table needed) |
| sample_remote_request | plm (new table needed) |
| sample_remote_request_history | plm (new table needed) |
| sample_remote_request_item | plm (new table needed) |
| sample_reservation | plm (new table needed) |
| sample_shipment | plm (new table needed) |
| sample_shipment_item | plm.sample_shipment_item |
| sample_shipment_line | plm (new table needed) |
| sample_shipment_notice | plm (new table needed) |
| sample_shipment_notice_recipient | plm (new table needed) |
| sample_stop_closeout | plm (new table needed) |
| sample_workflow | plm (new table needed) |

## RFQ — prefix for new tables: `rfq_`

| Table today | Permanent home |
|---|---|
| RFQContainer | plm.RFQContainer |
| RFQGroup | plm.RFQGroup |
| RFQItem | plm.RFQItem |
| RFQItemDivision | plm.RFQItemDivision |
| RFQItemStatus | plm.RFQItemStatus |
| RFQStep | plm.RFQStep |
| RFQVendor | plm.RFQVendor |
| RFQWhse | plm.RFQWhse |

## Items — prefix for new tables: `item_`

| Table today | Permanent home |
|---|---|
| ProductNickname | plm.ProductNickname |
| itemAttachment | plm.itemAttachment |
| itemDepth | plm.itemDepth |
| itemDetail | plm.itemDetail |
| itemHeader | plm.itemHeader |
| itemLicenseImage | plm.itemLicenseImage |
| itemSize | plm.itemSize |
| itemType | plm.itemType |
| item_character_associations | plm.item_character_associations |
| item_customer_selling | plm (new table needed) |
| item_prod_order_detail_associations | plm.item_prod_order_detail_associations |
| item_user_assignment | plm.item_user_assignment |
| item_workflow_action | plm.item_workflow_action |
| productUserAssignment | plm.productUserAssignment |

## Production orders — prefix for new tables: `po_`

| Table today | Permanent home |
|---|---|
| ContainerHeader | plm.ContainerHeader |
| FOBCountry | plm.FOBCountry |
| FactoryTime | plm.FactoryTime |
| FactoryTimes | plm.FactoryTimes |
| OrderLeadTime | plm.OrderLeadTime |
| ProdOrderDetail | plm.ProdOrderDetail |
| ProdOrderHeader | plm.ProdOrderHeader |
| ProdPaymentTerms | plm.ProdPaymentTerms |
| ProdShipmentTransitTime | plm.ProdShipmentTransitTime |
| ShippingPort | plm.ShippingPort |
| deliveryLocation | plm.deliveryLocation |
| prod_order_milestone_schedule | plm.prod_order_milestone_schedule |
| product_type_factory_time | plm.product_type_factory_time |

## Licensing — prefix for new tables: `lic_`

| Table today | Permanent home |
|---|---|
| LicenseFeedBacks | plm.LicenseFeedBacks |
| LicensingTime | plm.LicensingTime |
| LicensingTimes | plm.LicensingTimes |
| groups | plm.groups |
| licenseList | core.licenseList |
| licensingFeedbackReply | plm.licensingFeedbackReply |
| licensingMilestone | plm.licensingMilestone |
| licensingStatus | plm.licensingStatus |

## Merch groups and taxonomy — prefix for new tables: `merch_`

| Table today | Permanent home |
|---|---|
| SeasonCode | plm.SeasonCode |
| age_group | core.age_group |
| companyCode | plm.companyCode |
| divisionCode | plm.divisionCode |
| merchGroup | core.merchGroup |
| merchGroupHeaders | core.merchGroupHeaders |
| merchGroupMaster | core.merchGroupMaster |
| merchGroupRelations | core.merchGroupRelations |
| merchGroup_04112026 | deleted 2026-11-05 (backup kept in 1Password; #5748) |
| merchGroup_pr90_bad | retire (old backup copy; archive then drop) |
| product_category | core.product_category |
| properties_and_characters | core.property / core.character (owner ruling: shared core) |
| property_character_associations | core.property_character_associations |

## Art — prefix for new tables: `art_`

| Table today | Permanent home |
|---|---|
| art_piece | plm.art_piece |
| art_piece_attachment | plm.art_piece_attachment |
| art_types | core.art_types |
| artist_types | core.artist_types |
| artists | core.artist (owner ruling: shared core) |

## Design time — prefix for new tables: `design_`

| Table today | Permanent home |
|---|---|
| DesignTeamTime | plm.DesignTeamTime |
| DesignTeamTimes | plm.DesignTeamTimes |

## Users and access — prefix for new tables: `user_`

| Table today | Permanent home |
|---|---|
| AdditionalUserEmail | app.AdditionalUserEmail |
| RolePermissions | app.RolePermissions |
| Roles | app.role |
| UIElements | app.UIElements |
| auth_token | app.auth_token |
| quote_auth_token | app.quote_auth_token |
| user_notification | app.user_notification |
| user_roles | app.user_role |
| users | core (owner ruling: shared core; replaces app.users copy) |

## Vendors, factories and customers — prefix for new tables: `party_`

| Table today | Permanent home |
|---|---|
| Factory | core.factory (owner ruling: shared core) |
| customers | core.customer (owner ruling: shared core) |
| externalCustomer | core.externalCustomer |
| externalVendor | core.externalVendor |
| vendor | core.vendor |
| vendorGroup | core.vendorGroup |
| vendor_wechat_identity | core (new table needed) |

## Logs and settings — prefix for new tables: `log_`

| Table today | Permanent home |
|---|---|
| AuditLog | app.AuditLog |
| ai_cache_events | app.ai_cache_events |
| app_settings | app.app_settings |
| comments | app.comment |
| email_logs | app.email_logs |
| externalApi | plm.externalApi |

