import type { ColumnState } from "ag-grid-community";
import { type CustomCellEditorProps } from "ag-grid-react";
import { type StyleTrackerFieldKey, type StyleTrackerJevRanking, type StyleTrackerLinkCandidate } from "@/lib/style-tracker-candidates";

export type FieldKey = StyleTrackerFieldKey;
export type RowData = Record<string, unknown>;

export type StyleRow = {
  id: string;
  source_sheet: string;
  source_row_number: number | null;
  tracker_type: "licensed" | "generic";
  sku: string | null;
  group_id: string | null;
  description: string | null;
  customer: string | null;
  customer_id: string | null;
  designer: string | null;
  commissioned: string | null;
  upc: string | null;
  customer_sku: string | null;
  licensor: string | null;
  license_status: string | null;
  royalty: string | null;
  concept_status: string | null;
  pre_production_status: string | null;
  production_status: string | null;
  default_vendor: string | null;
  discontinued: boolean | null;
  notes: string | null;
  row_data: RowData;
  match_status?: "matched" | "partial" | "needs_review" | "unmatched" | null;
  match_notes?: RowData | null;
  erp_item_id?: string | null;
  style_group_id?: string | null;
  company_id?: string | null;
  public_licensor_id?: string | null;
  core_licensor_id?: string | null;
  creative_designer_id?: string | null;
  canonical_designer_name?: string | null;
  canonical_customer_name?: string | null;
  factory_id?: string | null;
  plm_item_id?: string | null;
  rfq_groups?: Array<{
    id: number;
    name: string;
    linked_at: string | null;
  }> | null;
};

export type SheetColumn = {
  letter: string;
  header: string;
  headerTooltip?: string;
  width?: number;
  pinned?: "left";
  hide?: boolean;
  typedField?: keyof StyleRow;
  legacyKey?: string;
  linkKind?: FieldKey;
  optionKind?: "customer" | "licensor" | "designer" | "factory" | "packagingType";
  date?: boolean;
  yesNo?: boolean;
  number?: boolean;
};

export type ReviewItem = {
  key: string;
  fieldKey: FieldKey;
  label: string;
  rawValue: string;
  count: number;
};

export type LinkCandidate = StyleTrackerLinkCandidate;

export type JevRankingResponse = {
  ok: true;
  model: string;
  ranking: StyleTrackerJevRanking;
};

export type PickerOption = {
  id: string;
  name: string;
};

export type DescriptionSectionKey = "mg01" | "mg02" | "mg03" | "licensorProperty" | "artDescription" | "size";

export type DescriptionParts = Record<DescriptionSectionKey, string>;

export type DescriptionEditorOptions = {
  mg01: string[];
  mg02: (mg01: string) => string[];
  mg03: (mg01: string, mg02: string) => string[];
  licensorProperty: string[];
  size: string[];
};

export type DescriptionEditorProps = CustomCellEditorProps<StyleRow, string> & {
  options?: DescriptionEditorOptions;
};

export type AuditLogEntry = {
  id: string;
  event_type: "row_added" | "cell_update" | "value_resolution";
  style_tracker_row_id: string | null;
  source_sheet: string | null;
  source_row_number: number | null;
  field_key: FieldKey | string | null;
  column_letter: string | null;
  old_value: unknown;
  new_value: unknown;
  metadata: RowData | null;
  changed_by: string | null;
  changed_at: string;
  changed_by_label: string | null;
  changed_by_email: string | null;
};

export type AuditCell = {
  row: StyleRow;
  column: SheetColumn;
};

export type SavedView = {
  id: string;
  view_name: string;
  source_sheet: string;
  column_state: ColumnState[] | null;
  filter_model: Record<string, unknown> | null;
  updated_at: string;
};
