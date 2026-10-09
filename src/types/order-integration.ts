/** Result shapes returned by shared-db migration 20261009073649. */

export type OrderTrackingWorkflowSource =
  | "master_data"
  | "at_import"
  | "unavailable"
  | "ambiguous";

export type OrderTrackingComponent = {
  line_id: string;
  sku: string | null;
  assortment: string | null;
  quantity: number | null;
  case_pack: number | null;
  cases: number | null;
  order_depth_inches: number | null;
  ship_to: string | null;
  start_ship_date: string | null;
  cancel_date: string | null;
  customer_po_number: string | null;
  cases_error: string | null;
  description: string | null;
  license_status: string | null;
  workflow_source: OrderTrackingWorkflowSource | null;
  test_report: string | null;
  professional_photos: string | null;
  parent_cases: number | null;
  parent_quantity: number | null;
  sample_depth_raw: string | null;
  sample_depth_source_row: number | null;
  contractual_sample_reorder: boolean | null;
  snapshot_test_report: string | null;
  snapshot_professional_photos: string | null;
  snapshot_contractual_sample_reorder: boolean | null;
  sample_depth_inches: number | null;
  default_vendor: string | null;
  sample_vendor: string | null;
};

/** One result row from public.get_dam_order_tracking. */
export type OrderTrackingRow = {
  order_id: string;
  production_order_number: string;
  order_date: string | null;
  order_voided_at: string | null;
  customer_name: string | null;
  vendor_name: string | null;
  factory_id: string | null;
  company_id: string | null;
  line_count: number;
  total_cases: number | null;
  invalid_case_lines: number;
  missing_test_reports: number;
  missing_photos: number;
  unresolved_product_lines: number;
  order_type: string | null;
  start_ship_date: string | null;
  cancel_date: string | null;
  cargo_forecast_date: string | null;
  customer_po_number: string | null;
  customer_suffix: string | null;
  components: OrderTrackingComponent[] | null;
  sent_po_date: string | null;
  vendor_delivery_date: string | null;
  seal_container_forecast: string | null;
  booking_state: string | null;
  etd: string | null;
  eta: string | null;
  warehouse_date: string | null;
  days_delay: number | null;
  worksheet_days_remaining: number | null;
  container_booking_group: string | null;
  mbl: string | null;
  close_tracking: boolean | null;
  agent: string | null;
  cbm: number | null;
  comment: string | null;
  vessel: string | null;
  sent_to_coldlion: boolean | null;
  worksheet_done: boolean | null;
  inspection_passed: string | null;
  inspection_note: string | null;
  document_invoice: boolean | null;
  document_packing_list: boolean | null;
  document_bill_of_lading: boolean | null;
  document_tsca: boolean | null;
  document_lacey_act: boolean | null;
  document_telex: boolean | null;
  request_wire: boolean | null;
  payment_note: string | null;
  tracking_updated_at: string | null;
  svn_number: string | null;
  booking_string: string | null;
  days_delay_status: string | null;
  seal_container_forecast_status: string | null;
  unknown_case_groups: number;
};

/** Row from api.dam_order_sample_depth. */
export type SampleDepth = {
  sku_normalized: string;
  customer_normalized: string;
  depth_inches: number | null;
  depth_raw: string | null;
  source_workbook_id: string | null;
  source_row_number: number | null;
  updated_at: string;
  updated_by: string | null;
};

/** Row from api.dam_order_customer_settings. */
export type CustomerSuffix = {
  customer_normalized: string;
  suffix: string;
  updated_at: string;
  updated_by: string | null;
};

/** Row from api.dam_order_vendor_statistics. */
export type VendorStatistic = {
  factory_id: string | null;
  vendor_name: string;
  order_count: number;
  closed_orders: number;
  open_orders: number;
  last_sent_po_date: string | null;
  activity_status: "Active" | "Inactive";
};
