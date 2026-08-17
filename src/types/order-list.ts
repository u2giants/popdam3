// Types for the PopDAM OrderList page.
//
// `api.dam_order_list` lives in the `api` schema, which is not covered by the
// generated `src/integrations/supabase/types.ts` (that file only carries the
// `public` schema). These types describe the view contract by hand; the same
// pattern is used by `useDamCustomers` for other `api.*` views. Keep them in
// step with shared-db migration `20260810010000_popdam_order_list_contract.sql`.

export type OrderListMatchStatus =
  | "matched"
  | "unmatched"
  | "ambiguous"
  | "manual"
  | "not_applicable";

export type OrderListStyleType = "licensed" | "generic";

/** One row of `api.dam_order_list`: one order line joined to its order header and Master Data. */
export type OrderListRow = {
  order_line_id: string;
  order_id: string;

  // Order (header) facts
  production_order_number: string | null;
  order_status: string | null;
  company_id: string | null;
  customer_name: string | null;
  factory_id: string | null;
  vendor_name: string | null;
  ordering_company: string | null;
  order_date: string | null;
  sent_po_date: string | null;
  seal_container_date: string | null;
  vendor_delivery_date: string | null;
  requested_ship_date: string | null;
  actual_ship_date: string | null;
  booking_state: string | null;
  etd: string | null;
  eta: string | null;
  warehouse_date: string | null;
  container_booking_group: string | null;
  mbl: string | null;
  close_tracking: boolean | null;
  order_voided_at: string | null;
  order_void_reason: string | null;

  // Line facts
  line_number: string | null;
  order_person: string | null;
  order_type: string | null;
  customer_suffix: string | null;
  customer_po_number: string | null;
  assortment_id: string | null;
  assortment_component_ordinal: number | null;
  sku: string | null;
  sku_normalized: string | null;
  quantity_ordered: number | null;
  quantity_shipped: number | null;
  unit_cost: number | null;
  order_depth_inches: number | null;
  case_pack: number | null;
  cases_reported: number | null;
  ship_to: string | null;
  start_ship_date: string | null;
  start_ship_raw: string | null;
  cancel_date: string | null;
  cancel_raw: string | null;
  cargo_forecast_date: string | null;
  cargo_forecast_raw: string | null;
  test_report: string | null;
  professional_photos: string | null;
  contractual_sample_reorder: boolean | null;
  line_status: string | null;
  line_voided_at: string | null;
  line_void_reason: string | null;

  // Link + Master Data
  source_style_type: OrderListStyleType | null;
  master_data_match_status: OrderListMatchStatus;
  item_id: string | null;
  item_number: string | null;
  item_style_number: string | null;
  item_name: string | null;
  item_description: string | null;
  style_tracker_bridge_id: string | null;
  style_tracker_row_id: string | null;
  master_data_tracker_type: OrderListStyleType | null;
  master_data_description: string | null;
  master_data_license_status: string | null;
  master_data_licensor: string | null;
  master_data_default_vendor: string | null;
  master_data_customer: string | null;

  // Immutable import/creation snapshot
  snapshot_sku: string | null;
  snapshot_description: string | null;
  snapshot_license_status: string | null;
  snapshot_style_type: string | null;
  snapshot_source_row: string | null;

  // Diagnostics
  item_link_missing: boolean | null;
  item_link_type_mismatch: boolean | null;

  google_source_id: string | null;
  coldlion_source_id: string | null;
  line_created_at: string | null;
  line_updated_at: string | null;
};

/** Fields on the order header that `public.update_dam_order` accepts as a patch. */
export type OrderHeaderPatch = Partial<{
  production_order_number: string | null;
  /** The RPC calls this `status`; the view exposes it as `order_status`. */
  status: string | null;
  order_date: string | null;
  sent_po_date: string | null;
  seal_container_date: string | null;
  vendor_delivery_date: string | null;
  requested_ship_date: string | null;
  actual_ship_date: string | null;
  booking_state: string | null;
  etd: string | null;
  eta: string | null;
  warehouse_date: string | null;
  container_booking_group: string | null;
  mbl: string | null;
  close_tracking: boolean | null;
}>;

/** Fields on an order line that `public.update_dam_order` accepts as a patch. */
export type OrderLinePatch = Partial<{
  line_number: string | null;
  /** The RPC calls this `status`; the view exposes it as `line_status`. */
  status: string | null;
  order_person: string | null;
  order_type: string | null;
  customer_suffix: string | null;
  customer_po_number: string | null;
  assortment_id: string | null;
  sku: string | null;
  quantity_ordered: number | null;
  quantity_shipped: number | null;
  unit_cost: number | null;
  order_depth_inches: number | null;
  case_pack: number | null;
  cases_reported: number | null;
  ship_to: string | null;
  start_ship_date: string | null;
  cancel_date: string | null;
  cargo_forecast_date: string | null;
  test_report: string | null;
  professional_photos: string | null;
  contractual_sample_reorder: boolean | null;
  source_style_type: string | null;
}>;

/** Payload sent to `public.update_dam_order`. */
export type OrderUpdatePayload = {
  p_order_id: string;
  p_order_patch: OrderHeaderPatch;
  p_line_patches: Array<{ id: string } & OrderLinePatch>;
};

/** Payload sent to `public.create_dam_order`. */
export type OrderCreatePayload = {
  p_order: OrderHeaderPatch;
  p_lines: OrderLinePatch[];
};

/** A Master Data row eligible to be linked to an order line. */
export type OrderListLinkCandidate = {
  style_tracker_row_id: string;
  plm_item_id: string | null;
  sku: string | null;
  tracker_type: OrderListStyleType | null;
  description: string | null;
  license_status: string | null;
  licensor: string | null;
  default_vendor: string | null;
};

/** A per-user saved layout in `public.order_list_user_views`. */
export type OrderListSavedView = {
  id: string;
  view_name: string;
  column_state: unknown;
  filter_model: unknown;
  sort_model: unknown;
  updated_at: string;
};
