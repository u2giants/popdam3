import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CellValueChangedEvent, ColDef, ColumnState, DefaultMenuItem, GetContextMenuItemsParams, GridReadyEvent, MenuItemDef } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry, iconSetMaterial, themeQuartz } from "ag-grid-community";
import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import { AgGridReact, type CustomCellEditorProps, type CustomCellRendererProps, type CustomHeaderProps } from "ag-grid-react";
import { Check, ChevronDown, Clock3, Columns3, Database, Pencil, Plus, RefreshCw, RotateCcw, Save, Search, Star, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAppearance } from "@/hooks/useAppearance";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import {
  filterStyleTrackerCandidates,
  normalizeStyleTrackerValue,
  type StyleTrackerFieldKey,
  type StyleTrackerLinkCandidate,
} from "@/lib/style-tracker-candidates";
import { approvalHighlightForRow } from "@/lib/style-tracker-row-highlighting";
import { MASTER_DATA_DEFAULT_PAGE_SIZE, MASTER_DATA_PAGE_SIZE_OPTIONS } from "@/lib/master-data-pagination";
import { cn } from "@/lib/utils";

LicenseManager.setLicenseKey("");
ModuleRegistry.registerModules([AllCommunityModule, AllEnterpriseModule]);

type FieldKey = StyleTrackerFieldKey;
type RowData = Record<string, unknown>;

type StyleRow = {
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

type SheetColumn = {
  letter: string;
  header: string;
  width?: number;
  pinned?: "left";
  hide?: boolean;
  typedField?: keyof StyleRow;
  legacyKey?: string;
  linkKind?: FieldKey;
  optionKind?: "customer" | "licensor" | "designer" | "factory" | "packagingType";
};

type ReviewItem = {
  key: string;
  fieldKey: FieldKey;
  label: string;
  rawValue: string;
  count: number;
};

type LinkCandidate = StyleTrackerLinkCandidate;

type PickerOption = {
  id: string;
  name: string;
};

type DescriptionSectionKey = "productMaterial" | "licensorProperty" | "artDescription" | "size";

type DescriptionParts = Record<DescriptionSectionKey, string>;

type DescriptionEditorOptions = {
  productMaterial: string[];
  licensorProperty: string[];
  size: string[];
};

type DescriptionEditorProps = CustomCellEditorProps<StyleRow, string> & {
  options?: DescriptionEditorOptions;
};

type AuditLogEntry = {
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

type AuditCell = {
  row: StyleRow;
  column: SheetColumn;
};

type SavedView = {
  id: string;
  view_name: string;
  source_sheet: string;
  column_state: ColumnState[] | null;
  filter_model: Record<string, unknown> | null;
  updated_at: string;
};

const DEFAULT_ROW_LIMIT = 2500;
const MANUAL_CANDIDATE_LIMIT = 100;

const COMMON_PRODUCT_MATERIAL_OPTIONS = [
  "2pc Canvas Set",
  "3pc Canvas Set",
  "4pc Canvas Set",
  "Coir Doormat",
  "Figural Resin Pencil Cup",
  "PE Rattan 2-Tier Wall Shelf",
  "Printed Canvas",
  "Printed Glass Shadowbox",
  "Printed Wood Wall Decor",
  "Resin Tabletop Decor",
  "Wood Wall Shelf",
];

const APPROVED_LICENSOR_PROPERTY_OPTIONS = [
  "ATLA",
  "Coca-Cola",
  "Disney Mickey Mouse",
  "Disney Mickey Mouse Christmas",
  "Disney Minnie Mouse Valentine's",
  "Disney Princess",
  "HTTYD",
  "Marvel Avengers",
  "Marvel Comics Spider-Man",
  "Marvel Spider-Man",
  "Marvel Universe",
  "NBCU Shrek",
  "Paramount Mean Girls",
  "Peanuts Snoopy Harvest",
  "SEGA Classic Sonic",
  "SEGA Modern Sonic",
  "SEGA Sonic",
  "SpongeBob",
  "Star Wars",
  "Strawberry Shortcake",
  "TMNT",
  "WB Friday the 13th",
];

const COMMON_SIZE_OPTIONS = [
  "8x10\"",
  "11x14\"",
  "12x12\"",
  "12x16\"",
  "16x20\"",
  "16x20\" x1.2\"",
  "18x24\"",
  "20x20\"",
  "24x24\" x1.5\"",
  "24x36\"",
];

const SIZE_AT_END_RE = /(?:^|\s)(\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*(?:"|in))?(?:\s*[x×]\s*\d+(?:\.\d+)?\s*(?:"|in)?)?)$/i;

const licensedColumns: SheetColumn[] = [
  { letter: "A", header: "Print Fair Row#", width: 118, hide: true, legacyKey: "print_fair_row" },
  { letter: "B", header: "Style # / SKU", width: 150, pinned: "left", typedField: "sku", legacyKey: "style_sku", linkKind: "sku" },
  { letter: "PKG", header: "Packaging Type", width: 175, legacyKey: "packaging_type", optionKind: "packagingType" },
  { letter: "D", header: "Description", width: 270, typedField: "description", legacyKey: "description" },
  { letter: "E", header: "Originally Designed For", width: 190, typedField: "customer_id", legacyKey: "originally_designed_for", linkKind: "customer", optionKind: "customer" },
  { letter: "F", header: "Designer", width: 135, typedField: "designer", legacyKey: "designer", linkKind: "designer" },
  { letter: "G", header: "New BA# commissioned", width: 170, typedField: "commissioned", legacyKey: "commissioned" },
  { letter: "H", header: "RFQ Code", width: 130, legacyKey: "rfq_code" },
  { letter: "I", header: "Legacy BA#", width: 130, hide: true, legacyKey: "legacy_ba" },
  { letter: "J", header: "BA#", width: 115, legacyKey: "ba" },
  { letter: "K", header: "UPC", width: 150, typedField: "upc", legacyKey: "upc" },
  { letter: "L", header: "Customer SKU", width: 150, typedField: "customer_sku", legacyKey: "customer_sku" },
  { letter: "M", header: "Licensor", width: 130, typedField: "licensor", legacyKey: "licensor", linkKind: "licensor" },
  { letter: "N", header: "License Status", width: 155, typedField: "license_status", legacyKey: "license_status" },
  { letter: "O", header: "Concept Sent", width: 145, typedField: "concept_status", legacyKey: "concept_sent" },
  { letter: "P", header: "Concept Resubmit", width: 165, legacyKey: "concept_resubmit" },
  { letter: "Q", header: "Concept Resubmitted", width: 175, legacyKey: "concept_resubmitted" },
  { letter: "R", header: "Concept Approval", width: 165, legacyKey: "concept_approval" },
  { letter: "S", header: "Concept Approved with Comments", width: 225, legacyKey: "concept_approved_with_comments" },
  { letter: "T", header: "Request Pre Production Sample", width: 235, legacyKey: "request_pre_production_sample" },
  { letter: "U", header: "Sample Vendor", width: 160, legacyKey: "sample_vendor", optionKind: "factory" },
  { letter: "W", header: "Sample Photos Received", width: 200, legacyKey: "sample_photos_received" },
  { letter: "X", header: "Pre Production Sent", width: 185, typedField: "pre_production_status", legacyKey: "pre_production_sent" },
  { letter: "Y", header: "Pre Production Resubmit", width: 205, legacyKey: "pre_production_resubmit" },
  { letter: "Z", header: "Pre Production Resubmitted", width: 225, legacyKey: "pre_production_resubmitted" },
  { letter: "AA", header: "Pre Production approved w/comment", width: 255, legacyKey: "pre_production_approved_comment" },
  { letter: "AB", header: "Pre Production Approval", width: 210, legacyKey: "pre_production_approval" },
  { letter: "AC", header: "Production Approval", width: 190, typedField: "production_status", legacyKey: "production_approval" },
  { letter: "AD", header: "Default Vendor(Sales)", width: 195, typedField: "default_vendor", legacyKey: "default_vendor_sales", linkKind: "factory" },
  { letter: "AE", header: "Ordered Cont Sample", width: 190, legacyKey: "ordered_cont_sample" },
  { letter: "AF", header: "Ordered Proff Photos", width: 185, legacyKey: "ordered_proff_photos" },
  { letter: "AG", header: "Ordered Test Report", width: 180, legacyKey: "ordered_test_report" },
  { letter: "AH", header: "Professional Photos", width: 180, legacyKey: "professional_photos" },
  { letter: "AI", header: "Test report", width: 150, legacyKey: "test_report" },
  { letter: "AK", header: "Discontinued", width: 145, typedField: "discontinued", legacyKey: "discontinued" },
  { letter: "AL", header: "Customer Exclusive", width: 180, legacyKey: "customer_exclusive" },
  { letter: "AM", header: "Annual Samples to Need Order", width: 220, legacyKey: "annual_samples_need_order" },
  { letter: "AN", header: "Annual Samples Ordered", width: 205, legacyKey: "annual_samples_ordered" },
  { letter: "AO", header: "Contractual Samples RE-Order", width: 235, legacyKey: "contractual_samples_reorder" },
  { letter: "AQ", header: "TP Assigned", width: 135, legacyKey: "tp_assigned" },
  { letter: "AU", header: "Note:", width: 300, typedField: "notes", legacyKey: "note" },
];

const genericColumns: SheetColumn[] = [
  { letter: "A", header: "A", width: 130 },
  { letter: "B", header: "Style # / SKU", width: 150, pinned: "left", typedField: "sku", legacyKey: "style_sku", linkKind: "sku" },
  { letter: "PKG", header: "Packaging Type", width: 175, legacyKey: "packaging_type", optionKind: "packagingType" },
  { letter: "D", header: "Description", width: 270, typedField: "description", legacyKey: "description" },
  { letter: "E", header: "Special Customer", width: 170, typedField: "customer_id", legacyKey: "special_customer", linkKind: "customer", optionKind: "customer" },
  { letter: "F", header: "Designer", width: 135, typedField: "designer", legacyKey: "designer", linkKind: "designer" },
  { letter: "G", header: "commissioned", width: 140, typedField: "commissioned", legacyKey: "commissioned" },
  { letter: "H", header: "UPC", width: 150, typedField: "upc", legacyKey: "upc" },
  { letter: "I", header: "Customer SKU", width: 150, typedField: "customer_sku", legacyKey: "customer_sku" },
  { letter: "R", header: "Request Pre Production Sample", width: 235, legacyKey: "request_pre_production_sample" },
  { letter: "S", header: "Sample Vendor", width: 160, legacyKey: "sample_vendor", optionKind: "factory" },
  { letter: "T", header: "RFQ Code", width: 150, legacyKey: "rfq_code" },
  { letter: "U", header: "Sample Received", width: 170, legacyKey: "sample_received" },
  { letter: "V", header: "Pre Production Sent", width: 185, typedField: "pre_production_status", legacyKey: "pre_production_sent" },
  { letter: "W", header: "Pre Production Approval", width: 210, legacyKey: "pre_production_approval" },
  { letter: "X", header: "Production Approval", width: 190, typedField: "production_status", legacyKey: "production_approval" },
  { letter: "Y", header: "Default Vendor(Sales)", width: 195, typedField: "default_vendor", legacyKey: "default_vendor_sales", linkKind: "factory" },
  { letter: "Z", header: "Ordered David sample", width: 190, legacyKey: "ordered_david_sample" },
  { letter: "AA", header: "Ordered Proff Photos", width: 185, legacyKey: "ordered_proff_photos" },
  { letter: "AB", header: "Ordered Test Report", width: 180, legacyKey: "ordered_test_report" },
  { letter: "AC", header: "Professional Photos", width: 180, legacyKey: "professional_photos" },
  { letter: "AD", header: "Test report", width: 150, legacyKey: "test_report" },
  { letter: "AF", header: "Discontinued", width: 145, typedField: "discontinued", legacyKey: "discontinued" },
];

const configs = [
  { name: "License.Style", label: "Licensed", trackerType: "licensed", columns: licensedColumns },
  { name: "Generic.Style", label: "Generic", trackerType: "generic", columns: genericColumns },
] as const;

const lightGridTheme = themeQuartz.withPart(iconSetMaterial).withParams({
  accentColor: "#2563eb",
  backgroundColor: "#ffffff",
  borderColor: "#d9e2ef",
  browserColorScheme: "light",
  chromeBackgroundColor: "#f8fafc",
  foregroundColor: "#0f172a",
  headerBackgroundColor: "#eef2f7",
  headerTextColor: "#334155",
  oddRowBackgroundColor: "#fbfdff",
  rowHoverColor: "#eef6ff",
  spacing: 6,
  fontSize: 13,
  headerFontSize: 12,
});

const darkGridTheme = themeQuartz.withPart(iconSetMaterial).withParams({
  accentColor: "#38bdf8",
  backgroundColor: "#0b1120",
  borderColor: "#263247",
  browserColorScheme: "dark",
  chromeBackgroundColor: "#111827",
  foregroundColor: "#e5e7eb",
  headerBackgroundColor: "#111827",
  headerTextColor: "#cbd5e1",
  oddRowBackgroundColor: "#0f172a",
  rowHoverColor: "#172033",
  spacing: 6,
  fontSize: 13,
  headerFontSize: 12,
});

function valueFor(row: StyleRow | undefined, column: SheetColumn) {
  if (!row) return "";
  const typed = column.typedField ? row[column.typedField] : null;
  return typed ?? row.row_data?.[column.letter] ?? (column.legacyKey ? row.row_data?.[column.legacyKey] : "") ?? "";
}

function displayValueFor(row: StyleRow | undefined, column: SheetColumn) {
  if (!row) return "";
  if (column.optionKind === "customer") return row.canonical_customer_name ?? row.customer ?? "";
  if (column.optionKind === "designer") return row.canonical_designer_name ?? row.designer ?? "";
  return valueFor(row, column);
}

function normalized(value: string) {
  return normalizeStyleTrackerValue(value);
}

function fieldValue(row: StyleRow, field: FieldKey) {
  if (field === "sku") return row.sku;
  if (field === "customer") return row.customer;
  if (field === "licensor") return row.licensor;
  if (field === "designer") return row.designer;
  return row.default_vendor;
}

function fieldLabel(field: FieldKey) {
  if (field === "sku") return "Style # / SKU";
  if (field === "customer") return "Customer";
  if (field === "licensor") return "Licensor";
  if (field === "designer") return "Designer";
  return "Vendor";
}

function hasFieldMatch(row: StyleRow, field: FieldKey) {
  if (field === "sku") return Boolean(row.erp_item_id || row.style_group_id || row.plm_item_id);
  if (field === "customer") return Boolean(row.customer_id || row.company_id);
  if (field === "licensor") return Boolean(row.public_licensor_id || row.core_licensor_id);
  if (field === "designer") return Boolean(row.creative_designer_id);
  return Boolean(row.factory_id);
}

function hasManualResolution(row: StyleRow, fieldKey: FieldKey) {
  const manualByField = row.match_notes?.manual_resolutions;
  if (manualByField && typeof manualByField === "object" && !Array.isArray(manualByField)) {
    if (Object.hasOwn(manualByField, fieldKey)) return true;
  }
  return manualResolutionField(row) === fieldKey;
}

function manualResolutionField(row: StyleRow) {
  const manual = row.match_notes?.manual_resolution;
  if (!manual || typeof manual !== "object" || Array.isArray(manual)) return null;
  const field = (manual as Record<string, unknown>).field_key;
  return typeof field === "string" ? field : null;
}

function fuzzyCandidate(row: StyleRow | undefined, field: FieldKey) {
  const fuzzy = row?.match_notes?.fuzzy;
  if (!fuzzy || typeof fuzzy !== "object" || Array.isArray(fuzzy)) return null;
  return (fuzzy as Record<string, unknown>)[field] ?? null;
}

function statusFor(row: StyleRow | undefined, column: SheetColumn) {
  if (!row || !column.linkKind) return null;
  if (fuzzyCandidate(row, column.linkKind)) return "needs_review";
  if (hasFieldMatch(row, column.linkKind)) return "matched";
  return "unmatched";
}

function buildUpdate(row: StyleRow, column: SheetColumn, value: unknown) {
  const nextValue = value === "" ? null : column.typedField === "discontinued" ? ["true", "yes", "1"].includes(String(value).toLowerCase()) : String(value);
  if (column.optionKind === "customer") {
    const rowData = { ...(row.row_data ?? {}) };
    delete rowData[column.letter];
    if (column.legacyKey) delete rowData[column.legacyKey];
    return { row_data: rowData, customer_id: nextValue, customer: null };
  }
  const rowData = { ...(row.row_data ?? {}), [column.letter]: nextValue };
  if (column.legacyKey) rowData[column.legacyKey] = nextValue;
  const payload: Partial<StyleRow> & { row_data: RowData } = { row_data: rowData };
  if (column.typedField) (payload[column.typedField] as unknown) = nextValue;
  return payload;
}

function columnLabel(sourceSheet: string | null | undefined, letter: string | null | undefined) {
  if (!letter) return "field";
  const config = configs.find((item) => item.name === sourceSheet) ?? configs[0];
  const column = config.columns.find((item) => item.letter === letter);
  return column ? `${column.header} (${letter})` : letter;
}

function displayAuditValue(value: unknown) {
  if (value === null || value === undefined) return "blank";
  if (typeof value === "string") return value || "blank";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const label = record.target_label ?? record.local_value ?? record.raw_value ?? record.resolution_type;
    if (typeof label === "string" && label) return label;
  }
  return JSON.stringify(value);
}

function auditTitle(entry: AuditLogEntry) {
  if (entry.event_type === "row_added") return `Added row ${entry.source_row_number ?? ""}`.trim();
  if (entry.event_type === "value_resolution") {
    const metadata = entry.metadata ?? {};
    const rawValue = typeof metadata.raw_value === "string" ? metadata.raw_value : "";
    return `${fieldLabel((entry.field_key as FieldKey) ?? "sku")} match${rawValue ? `: ${rawValue}` : ""}`;
  }
  return `${columnLabel(entry.source_sheet, entry.column_letter)} changed`;
}

function auditDescription(entry: AuditLogEntry) {
  if (entry.event_type === "row_added") return "New Master Data row created.";
  if (entry.event_type === "value_resolution") {
    const metadata = entry.metadata ?? {};
    const kind = metadata.resolution_type === "canonical" ? "Linked to" : "Kept in Master Data as";
    return `${kind} ${displayAuditValue(entry.new_value)}.`;
  }
  return `${displayAuditValue(entry.old_value)} -> ${displayAuditValue(entry.new_value)}`;
}

function formatAuditTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function fetchRows(sourceSheet: string, showAll: boolean) {
  const rows: StyleRow[] = [];
  const maxRows = showAll ? Number.POSITIVE_INFINITY : DEFAULT_ROW_LIMIT;
  for (let from = 0; rows.length < maxRows; from += 1000) {
    const to = Math.min(from + 999, maxRows - 1);
    const { data, error } = await (supabase as any)
      .from("style_tracker_rows_with_bridge")
      .select("*")
      .eq("source_sheet", sourceSheet)
      .order("source_row_number", { ascending: false })
      .range(from, to);
    if (error) throw error;
    rows.push(...((data ?? []) as StyleRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function fetchCellAuditLog(cell: AuditCell | null) {
  if (!cell) return [] as AuditLogEntry[];
  const { data, error } = await (supabase as any)
    .from("style_tracker_audit_log_with_user")
    .select("*")
    .eq("style_tracker_row_id", cell.row.id)
    .eq("column_letter", cell.column.letter)
    .order("changed_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as AuditLogEntry[];
}

function activeViewStorageKey(sourceSheet: string) {
  return `master-data-active-view:${sourceSheet}`;
}

async function fetchSavedViews(userId: string | undefined, sourceSheet: string) {
  if (!userId) return [] as SavedView[];
  const { data, error } = await (supabase as any)
    .from("style_tracker_user_views")
    .select("id, view_name, source_sheet, column_state, filter_model, updated_at")
    .eq("user_id", userId)
    .eq("source_sheet", sourceSheet)
    .order("view_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SavedView[];
}

async function fetchCount(sourceSheet: string) {
  const { count, error } = await (supabase as any)
    .from("style_tracker_rows_with_bridge")
    .select("id", { count: "exact", head: true })
    .eq("source_sheet", sourceSheet);
  if (error) throw error;
  return count ?? 0;
}

async function searchCandidates(item: ReviewItem | null) {
  if (!item) return [] as LinkCandidate[];
  if (item.fieldKey === "designer") {
    const options = await fetchDesignerRecords();
    return options
      .map((designer) => ({
        target_schema: "core",
        target_table: "creative_designer",
        target_id: designer.id,
        target_label: designer.name,
        score: designerCandidateScore(item.rawValue, designer.name),
      }))
      .filter((candidate) => candidate.score >= 0.55)
      .sort((a, b) => b.score - a.score || a.target_label.localeCompare(b.target_label))
      .slice(0, 8);
  }
  const fuzzy = await (supabase as any).rpc("search_style_tracker_link_candidates", {
    p_field_key: item.fieldKey,
    p_query: item.rawValue,
    p_limit: 8,
    p_match_mode: "fuzzy",
  });
  if (fuzzy.error) throw fuzzy.error;
  const fuzzyCandidates = filterStyleTrackerCandidates(item.rawValue, (fuzzy.data ?? []) as LinkCandidate[]);
  if (fuzzyCandidates.length) return fuzzyCandidates.slice(0, 8);
  if (item.fieldKey === "sku") return [];
  const all = await (supabase as any).rpc("search_style_tracker_link_candidates", {
    p_field_key: item.fieldKey,
    p_query: item.rawValue,
    p_limit: 500,
    p_match_mode: "all",
  });
  if (all.error) throw all.error;
  return filterStyleTrackerCandidates(item.rawValue, (all.data ?? []) as LinkCandidate[]).slice(0, 8);
}

async function searchManualCandidates(item: ReviewItem | null, query: string, showAll: boolean) {
  if (!item) return [] as LinkCandidate[];
  const term = query.trim();
  if (!showAll && term.length < 2) return [] as LinkCandidate[];

  if (!showAll && item.fieldKey !== "designer") {
    const { data, error } = await (supabase as any).rpc("search_style_tracker_link_candidates", {
      p_field_key: item.fieldKey,
      p_query: term,
      p_limit: MANUAL_CANDIDATE_LIMIT,
      p_match_mode: "fuzzy",
    });
    if (error) throw error;
    return (data ?? []) as LinkCandidate[];
  }

  return fetchCandidateTableRows(item.fieldKey, term, showAll);
}

async function fetchCandidateTableRows(fieldKey: FieldKey, query: string, showAll: boolean) {
  const term = query.trim();
  if (fieldKey === "sku") {
    let q = (supabase as any)
      .from("style_groups")
      .select("id, sku")
      .not("sku", "is", null)
      .order("sku", { ascending: true })
      .limit(MANUAL_CANDIDATE_LIMIT);
    if (term) q = q.ilike("sku", `%${term}%`);
    else if (!showAll) return [] as LinkCandidate[];
    const { data, error } = await q;
    if (error) throw error;
    return ((data ?? []) as { id: string; sku: string | null }[])
      .filter((row) => row.id && row.sku)
      .map((row) => ({
        target_schema: "public",
        target_table: "style_groups",
        target_id: row.id,
        target_label: row.sku!,
        score: term ? 0.5 : 0,
      }));
  }

  const tableByField: Partial<Record<FieldKey, string>> = {
    customer: "customer",
    licensor: "licensor",
    designer: "creative_designer",
    factory: "factory",
  };
  const table = tableByField[fieldKey];
  if (!table) return [] as LinkCandidate[];

  let q = (supabase as any)
    .schema("core")
    .from(table)
    .select("id, name")
    .not("name", "is", null)
    .order("name", { ascending: true })
    .limit(MANUAL_CANDIDATE_LIMIT);
  if (term) q = q.ilike("name", `%${term}%`);
  else if (!showAll) return [] as LinkCandidate[];

  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as { id: string; name: string | null }[])
    .filter((row) => row.id && row.name)
    .map((row) => ({
      target_schema: "core",
      target_table: table,
      target_id: row.id,
      target_label: row.name!,
      score: term ? 0.5 : 0,
    }));
}

async function fetchCustomerOptions() {
  const { data, error } = await (supabase as any)
    .schema("api")
    .from("dam_customer_list")
    .select("id, name, display_name")
    .order("display_name", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { id: string; name: string; display_name: string | null }[])
    .map((customer) => ({ id: customer.id, name: customer.display_name?.trim() || customer.name.trim() }))
    .filter((customer) => customer.id && customer.name);
}

async function fetchLicensorOptions() {
  const { data, error } = await (supabase as any)
    .schema("core")
    .from("licensor")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) throw error;
  return compactPickerOptions(data);
}

async function fetchDesignerRecords() {
  const { data, error } = await (supabase as any)
    .schema("core")
    .from("creative_designer")
    .select("id, name")
    .eq("status", "active")
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as PickerOption[]).filter((row) => row.id && row.name);
}

async function fetchDesignerOptions() {
  return compactPickerOptions(await fetchDesignerRecords());
}

/**
 * Vendor picker options from api.dam_factory_list (global active/potential AND
 * DAM extension active). Do not read core.factory directly from the browser.
 * Labels prefer curated display_name. Values remain free-text names until the
 * separate additive factory_id FK tranche lands (not part of this Step 11 change).
 */
async function fetchFactoryOptions() {
  const { data, error } = await (supabase as any)
    .schema("api")
    .from("dam_factory_list")
    .select("id, name, display_name")
    .order("display_name", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return compactPickerOptions(
    ((data ?? []) as { id: string; name: string | null; display_name: string | null }[]).map((row) => ({
      id: row.id,
      name: row.display_name?.trim() || row.name?.trim() || "",
    })),
  );
}

async function fetchPackagingTypeOptions() {
  const { data, error } = await (supabase as any)
    .schema("core")
    .from("packaging_type")
    .select("id, name")
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return compactPickerOptions(data);
}

function designerCandidateScore(rawValue: string, candidateName: string) {
  const raw = normalized(rawValue);
  const candidate = normalized(candidateName);
  if (!raw || !candidate) return 0;
  if (raw === candidate) return 1;

  const candidateParts = candidate.split(" ");
  const rawParts = raw.split(/\s*(?:\/|&|\band\b|,)\s*/).filter(Boolean);
  if (rawParts.length > 1) return 0;
  const firstName = candidateParts[0];
  if (rawParts.some((part) => part === firstName || (part.length >= 4 && candidateParts.includes(part)))) return 0.96;

  return 1 - levenshtein(raw, candidate) / Math.max(raw.length, candidate.length);
}

function levenshtein(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= b.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

function compactPickerOptions(rows: unknown) {
  const seen = new Set<string>();
  return ((rows as PickerOption[] | null) ?? [])
    .map((row) => row.name?.trim())
    .filter((name): name is string => Boolean(name))
    .filter((name) => {
      const key = normalized(name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function compactStringOptions(values: Iterable<string | null | undefined>, limit = 500) {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const value of values) {
    const option = value?.replace(/\s+/g, " ").trim();
    if (!option) continue;
    const key = normalized(option);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(option);
    if (options.length >= limit) break;
  }
  return options.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

async function fetchPropertyOptions() {
  const { data, error } = await (supabase as any)
    .schema("core")
    .from("property")
    .select("id, name, licensor:licensor_id(name)")
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return compactStringOptions(
    ((data ?? []) as { name?: string | null; licensor?: { name?: string | null } | { name?: string | null }[] | null }[]).map((row) => {
      const licensor = Array.isArray(row.licensor) ? row.licensor[0]?.name : row.licensor?.name;
      return [licensor, row.name].map((part) => part?.trim()).filter(Boolean).join(" ");
    }),
    1200,
  );
}

async function fetchProductMaterialOptions() {
  const { data, error } = await (supabase as any)
    .schema("core")
    .from("product_material")
    .select("id, name")
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(1000);
  if (error) return compactStringOptions(COMMON_PRODUCT_MATERIAL_OPTIONS, 500);
  return compactPickerOptions(data);
}

async function fetchSizeOptions() {
  const coreSize = await (supabase as any)
    .schema("core")
    .from("product_size")
    .select("id, name")
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(1000);
  if (!coreSize.error) return compactPickerOptions(coreSize.data);

  const styleGroupSizes = await (supabase as any)
    .from("style_groups")
    .select("size_name")
    .not("size_name", "is", null)
    .limit(1000);
  if (styleGroupSizes.error) return compactStringOptions(COMMON_SIZE_OPTIONS, 500);
  return compactStringOptions(
    ((styleGroupSizes.data ?? []) as { size_name?: string | null }[]).map((row) => row.size_name),
    500,
  );
}

function buildLicensorPropertyOptions(properties: string[]) {
  return compactStringOptions([...APPROVED_LICENSOR_PROPERTY_OPTIONS, ...properties], 1200);
}

function parseDescriptionParts(value: unknown, options: DescriptionEditorOptions): DescriptionParts {
  let remaining = String(value ?? "").replace(/\s+/g, " ").trim();
  const parts: DescriptionParts = {
    productMaterial: "",
    licensorProperty: "",
    artDescription: "",
    size: "",
  };

  const sizeMatch = remaining.match(SIZE_AT_END_RE);
  if (sizeMatch?.[1]) {
    parts.size = sizeMatch[1].replace(/\s*[x×]\s*/g, "x").replace(/\s+/g, " ").trim();
    remaining = remaining.slice(0, sizeMatch.index).trim();
  }

  const productOption = longestPrefixMatch(remaining, options.productMaterial);
  if (productOption) {
    parts.productMaterial = productOption;
    remaining = remaining.slice(productOption.length).trim();
  }

  const licensorPropertyOption = longestPrefixMatch(remaining, options.licensorProperty);
  if (licensorPropertyOption) {
    parts.licensorProperty = licensorPropertyOption;
    remaining = remaining.slice(licensorPropertyOption.length).trim();
  }

  parts.artDescription = remaining;
  return parts;
}

function longestPrefixMatch(value: string, options: string[]) {
  const normalizedValue = normalized(value);
  if (!normalizedValue) return "";
  return [...options]
    .sort((a, b) => b.length - a.length)
    .find((option) => {
      const key = normalized(option);
      return normalizedValue === key || normalizedValue.startsWith(`${key} `);
    }) ?? "";
}

function assembleDescription(parts: DescriptionParts) {
  return [parts.productMaterial, parts.licensorProperty, parts.artDescription, parts.size]
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

function optionSet(options: string[]) {
  return new Set(options.map((option) => normalized(option)));
}

function validateDescriptionSelection(value: unknown, options: DescriptionEditorOptions) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const parts = parseDescriptionParts(text, options);
  const missing: string[] = [];
  if (!optionSet(options.productMaterial).has(normalized(parts.productMaterial))) missing.push("Product Type + Material");
  if (!optionSet(options.licensorProperty).has(normalized(parts.licensorProperty))) missing.push("Licensor + Property");
  if (!optionSet(options.size).has(normalized(parts.size))) missing.push("Size");
  return missing.length ? `Choose approved values for ${missing.join(", ")}.` : null;
}

function DescriptionBuilderEditor(props: DescriptionEditorProps) {
  const options = props.options ?? {
    productMaterial: COMMON_PRODUCT_MATERIAL_OPTIONS,
    licensorProperty: APPROVED_LICENSOR_PROPERTY_OPTIONS,
    size: COMMON_SIZE_OPTIONS,
  };
  const initialParts = useMemo(() => parseDescriptionParts(props.value ?? "", options), [options, props.value]);
  const [parts, setParts] = useState<DescriptionParts>(initialParts);
  const [activeSection, setActiveSection] = useState<DescriptionSectionKey>("productMaterial");
  const inputRefs = useRef<Record<DescriptionSectionKey, HTMLInputElement | null>>({
    productMaterial: null,
    licensorProperty: null,
    artDescription: null,
    size: null,
  });

  useEffect(() => {
    window.setTimeout(() => inputRefs.current.productMaterial?.focus(), 0);
  }, []);

  const updatePart = (section: DescriptionSectionKey, value: string) => {
    setParts((current) => {
      const next = { ...current, [section]: value };
      props.onValueChange(assembleDescription(next));
      return next;
    });
  };

  const activeOptions = activeSection === "artDescription" ? [] : options[activeSection];
  const activeValue = parts[activeSection];
  const filteredOptions = activeOptions
    .filter((option) => normalized(option).includes(normalized(activeValue)))
    .slice(0, 80);

  const selectOption = (option: string) => {
    updatePart(activeSection, option);
    inputRefs.current[activeSection]?.focus();
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      props.stopEditing();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      props.stopEditing(true);
    }
  };

  const sections: { key: DescriptionSectionKey; label: string; placeholder: string; className: string }[] = [
    { key: "productMaterial", label: "Product Type + Material", placeholder: "Coir Doormat", className: "min-w-[190px] flex-[1.05]" },
    { key: "licensorProperty", label: "Licensor + Property", placeholder: "Marvel Spider-Man", className: "min-w-[190px] flex-[1.05]" },
    { key: "artDescription", label: "Art Description", placeholder: "Building Hopping", className: "min-w-[190px] flex-1" },
    { key: "size", label: "Size", placeholder: "16x20\" x1.2\"", className: "min-w-[140px] flex-[0.75]" },
  ];

  return (
    <div className="w-[min(920px,calc(100vw-2rem))] rounded-md border border-border bg-popover p-2 shadow-lg" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex min-h-14 overflow-hidden rounded-md border border-input bg-background">
        {sections.map((section, index) => (
          <label key={section.key} className={cn("flex flex-col justify-center gap-0.5 px-2 py-1.5", index > 0 && "border-l border-border/70", section.className)}>
            <span className="truncate text-[10px] font-medium uppercase text-muted-foreground">{section.label}</span>
            <input
              ref={(node) => {
                inputRefs.current[section.key] = node;
              }}
              value={parts[section.key]}
              onChange={(event) => updatePart(section.key, event.target.value)}
              onFocus={() => setActiveSection(section.key)}
              onKeyDown={onEditorKeyDown}
              className="h-6 min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/55"
              placeholder={section.placeholder}
              spellCheck={section.key === "artDescription"}
            />
          </label>
        ))}
      </div>
      {activeSection !== "artDescription" && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border bg-background p-1">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
              >
                <span className="min-w-0 truncate">{option}</span>
                {normalized(option) === normalized(activeValue) && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            ))
          ) : (
            <div className="px-2 py-2 text-xs text-muted-foreground">No approved values found</div>
          )}
        </div>
      )}
    </div>
  );
}

function RowNumberCell(params: CustomCellRendererProps<StyleRow, number | null>) {
  const { node, value } = params;
  const [selected, setSelected] = useState(() => node.isSelected() ?? false);

  useEffect(() => {
    const listener = () => setSelected(node.isSelected() ?? false);
    node.addEventListener("rowSelected", listener);
    return () => node.removeEventListener("rowSelected", listener);
  }, [node]);

  return (
    <div className="flex h-full items-center gap-2">
      <Checkbox
        checked={selected}
        onCheckedChange={(checked) => node.setSelected(checked === true)}
        onClick={(event) => event.stopPropagation()}
        aria-label="Select row"
      />
      <span className="font-mono text-muted-foreground">{value ?? ""}</span>
    </div>
  );
}

function RowNumberHeader(params: CustomHeaderProps<StyleRow>) {
  const { api } = params;
  const [checked, setChecked] = useState<boolean | "indeterminate">(false);

  const refresh = useCallback(() => {
    let total = 0;
    let selectedCount = 0;
    api.forEachNodeAfterFilter((node) => {
      total += 1;
      if (node.isSelected()) selectedCount += 1;
    });
    setChecked(total === 0 || selectedCount === 0 ? false : selectedCount === total ? true : "indeterminate");
  }, [api]);

  useEffect(() => {
    refresh();
    api.addEventListener("selectionChanged", refresh);
    api.addEventListener("modelUpdated", refresh);
    return () => {
      api.removeEventListener("selectionChanged", refresh);
      api.removeEventListener("modelUpdated", refresh);
    };
  }, [api, refresh]);

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => (value ? api.selectAll("filtered") : api.deselectAll("filtered"))}
        aria-label="Select all rows"
      />
      <span>#</span>
    </div>
  );
}

function RfqGroupCell(params: CustomCellRendererProps<StyleRow>) {
  const groups = params.data?.rfq_groups ?? [];
  if (groups.length === 0) return null;

  const latest = groups[0];
  if (groups.length === 1) return <span className="block truncate">{latest.name}</span>;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-full w-full min-w-0 items-center gap-1.5 text-left hover:text-primary"
          onClick={(event) => event.stopPropagation()}
          aria-label={`${latest.name}; show ${groups.length - 1} previous RFQ groups`}
        >
          <span className="min-w-0 flex-1 truncate">{latest.name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{groups.length - 1}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2" onClick={(event) => event.stopPropagation()}>
        <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">RFQ group history</div>
        <div className="max-h-64 overflow-y-auto">
          {groups.map((group, index) => (
            <div key={group.id} className={cn("rounded px-2 py-1.5 text-sm", index === 0 && "bg-primary/10")}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                {index === 0 && <span className="text-[10px] font-medium uppercase text-primary">Latest</span>}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function StylesPage() {
  const queryClient = useQueryClient();
  const { theme } = useAppearance();
  const { isAdmin } = useIsAdmin();
  const { user } = useAuth();
  const gridRef = useRef<AgGridReact<StyleRow>>(null);
  const [activeSheet, setActiveSheet] = useState<(typeof configs)[number]["name"]>("License.Style");
  const [quickFilter, setQuickFilter] = useState("");
  const [showAllRows, setShowAllRows] = useState(false);
  const [selectedReviewKey, setSelectedReviewKey] = useState<string | null>(null);
  const [resolvedReviewKeys, setResolvedReviewKeys] = useState<Set<string>>(() => new Set());
  const [auditCell, setAuditCell] = useState<AuditCell | null>(null);
  const [manualCandidateSearch, setManualCandidateSearch] = useState("");
  const [showAllManualCandidates, setShowAllManualCandidates] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewDialog, setViewDialog] = useState<{ mode: "save" | "rename"; viewId?: string } | null>(null);
  const [viewNameInput, setViewNameInput] = useState("");
  const [gridReady, setGridReady] = useState(false);
  const [viewsMenuOpen, setViewsMenuOpen] = useState(false);
  const lastAppliedSheetRef = useRef<string | null>(null);

  const active = configs.find((config) => config.name === activeSheet) ?? configs[0];
  const rowsQuery = useQuery({ queryKey: ["style-rows", active.name, showAllRows], queryFn: () => fetchRows(active.name, showAllRows) });
  const countQuery = useQuery({ queryKey: ["style-row-count", active.name], queryFn: () => fetchCount(active.name) });
  const cellAuditQuery = useQuery({
    queryKey: ["style-cell-audit", auditCell?.row.id, auditCell?.column.letter],
    queryFn: () => fetchCellAuditLog(auditCell),
    enabled: Boolean(auditCell),
  });
  const customerOptionsQuery = useQuery({ queryKey: ["style-tracker-customer-options"], queryFn: fetchCustomerOptions });
  const productMaterialOptionsQuery = useQuery({ queryKey: ["style-tracker-product-material-options"], queryFn: fetchProductMaterialOptions });
  const licensorOptionsQuery = useQuery({ queryKey: ["style-tracker-licensor-options"], queryFn: fetchLicensorOptions });
  const propertyOptionsQuery = useQuery({ queryKey: ["style-tracker-property-options"], queryFn: fetchPropertyOptions });
  const sizeOptionsQuery = useQuery({ queryKey: ["style-tracker-size-options"], queryFn: fetchSizeOptions });
  const designerOptionsQuery = useQuery({ queryKey: ["style-tracker-designer-options"], queryFn: fetchDesignerOptions });
  const factoryOptionsQuery = useQuery({ queryKey: ["style-tracker-factory-options"], queryFn: fetchFactoryOptions });
  const packagingTypeOptionsQuery = useQuery({ queryKey: ["style-tracker-packaging-type-options"], queryFn: fetchPackagingTypeOptions });
  const savedViewsQuery = useQuery({
    queryKey: ["style-tracker-views", user?.id, active.name],
    queryFn: () => fetchSavedViews(user?.id, active.name),
    enabled: Boolean(user?.id),
  });
  const savedViews = savedViewsQuery.data ?? [];
  const activeView = savedViews.find((view) => view.id === activeViewId) ?? null;
  const rows = rowsQuery.data ?? [];
  const customerOptionById = useMemo(() => new Map((customerOptionsQuery.data ?? []).map((option) => [option.id, option.name])), [customerOptionsQuery.data]);
  const designerOptionKeys = useMemo(() => new Set((designerOptionsQuery.data ?? []).map((name) => normalized(name))), [designerOptionsQuery.data]);
  const packagingTypeOptionKeys = useMemo(() => new Set((packagingTypeOptionsQuery.data ?? []).map((name) => normalized(name))), [packagingTypeOptionsQuery.data]);
  const descriptionOptions = useMemo<DescriptionEditorOptions>(() => {
    const parsedSizes = rows
      .map((row) => {
        const match = String(row.description ?? "").match(SIZE_AT_END_RE);
        return match?.[1]?.replace(/\s*[x×]\s*/g, "x").replace(/\s+/g, " ").trim();
      })
      .filter((value): value is string => Boolean(value));

    return {
      productMaterial: productMaterialOptionsQuery.data?.length ? productMaterialOptionsQuery.data : compactStringOptions(COMMON_PRODUCT_MATERIAL_OPTIONS, 500),
      licensorProperty: buildLicensorPropertyOptions(propertyOptionsQuery.data ?? []),
      size: compactStringOptions([...(sizeOptionsQuery.data?.length ? sizeOptionsQuery.data : COMMON_SIZE_OPTIONS), ...parsedSizes], 500),
    };
  }, [productMaterialOptionsQuery.data, propertyOptionsQuery.data, rows, sizeOptionsQuery.data]);

  const reviewItems = useMemo(() => {
    const items = new Map<string, ReviewItem>();
    for (const row of rows) {
      for (const field of ["sku", "customer", "licensor", "designer", "factory"] as FieldKey[]) {
        if (hasManualResolution(row, field)) continue;
        const rawValue = fieldValue(row, field);
        if (!rawValue) continue;
        if (field === "designer" && designerOptionKeys.has(normalized(String(rawValue)))) continue;
        if (hasFieldMatch(row, field) && !fuzzyCandidate(row, field)) continue;
        const key = `${field}:${normalized(rawValue)}`;
        if (resolvedReviewKeys.has(key)) continue;
        const existing = items.get(key);
        if (existing) existing.count += 1;
        else items.set(key, { key, fieldKey: field, label: fieldLabel(field), rawValue, count: 1 });
      }
    }
    return [...items.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [designerOptionKeys, rows, resolvedReviewKeys]);

  const selectedReviewItem = reviewItems.find((item) => item.key === selectedReviewKey) ?? reviewItems[0] ?? null;
  const candidateQuery = useQuery({
    queryKey: ["style-candidates", selectedReviewItem?.key],
    queryFn: () => searchCandidates(selectedReviewItem),
    enabled: isAdmin && Boolean(selectedReviewItem),
  });
  const manualCandidateQuery = useQuery({
    queryKey: ["style-manual-candidates", selectedReviewItem?.key, manualCandidateSearch, showAllManualCandidates],
    queryFn: () => searchManualCandidates(selectedReviewItem, manualCandidateSearch, showAllManualCandidates),
    enabled: isAdmin && Boolean(selectedReviewItem) && (showAllManualCandidates || manualCandidateSearch.trim().length >= 2) && !candidateQuery.isFetching && (candidateQuery.data ?? []).length === 0,
  });

  useEffect(() => {
    setManualCandidateSearch("");
    setShowAllManualCandidates(false);
  }, [selectedReviewItem?.key]);

  const removeResolvedReviewItem = (item: ReviewItem) => {
    setResolvedReviewKeys((current) => new Set(current).add(item.key));
    setSelectedReviewKey(null);
  };

  const updateCell = useMutation({
    mutationFn: async ({ row, column, value }: { row: StyleRow; column: SheetColumn; value: unknown }) => {
      if (column.typedField === "designer") {
        const nextValue = String(value ?? "").trim();
        if (nextValue && !designerOptionKeys.has(normalized(nextValue))) {
          throw new Error("Choose a designer from the creative designer list.");
        }
      }
      if (column.optionKind === "packagingType") {
        const nextValue = String(value ?? "").trim();
        if (nextValue && !packagingTypeOptionKeys.has(normalized(nextValue))) {
          throw new Error("Choose a packaging type from the shared Packaging Types list.");
        }
      }
      const { error } = await (supabase as any).from("style_tracker_rows").update(buildUpdate(row, column, value)).eq("id", row.id);
      if (error) throw error;
      const refreshed = await (supabase as any).rpc("refresh_style_tracker_item_bridge");
      if (refreshed.error) throw refreshed.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["style-rows"] });
      queryClient.invalidateQueries({ queryKey: ["style-cell-audit"] });
    },
    onError: (error) => toast.error("Could not save style row", { description: error.message }),
  });

  const addRow = useMutation({
    mutationFn: async (count: number) => {
      const { error } = await (supabase as any).rpc("add_style_tracker_rows", {
        p_source_sheet: active.name,
        p_tracker_type: active.trackerType,
        p_count: count,
      });
      if (error) throw error;
    },
    onSuccess: (_data, count) => {
      toast.success(count === 1 ? "Row added" : `${count} rows added`);
      queryClient.invalidateQueries({ queryKey: ["style-rows"] });
      queryClient.invalidateQueries({ queryKey: ["style-cell-audit"] });
      queryClient.invalidateQueries({ queryKey: ["style-row-count"] });
    },
    onError: (error) => toast.error("Could not add row", { description: error.message }),
  });

  const resolveCanonical = useMutation({
    mutationFn: async ({ item, candidate }: { item: ReviewItem; candidate: LinkCandidate }) => {
      const { error } = await (supabase as any).rpc("upsert_style_tracker_value_resolution", {
        p_field_key: item.fieldKey,
        p_raw_value: item.rawValue,
        p_resolution_type: "canonical",
        p_target_schema: candidate.target_schema,
        p_target_table: candidate.target_table,
        p_target_id: candidate.target_id,
        p_target_label: candidate.target_label,
      });
      if (error) throw error;
      return item;
    },
    onSuccess: (item) => {
      removeResolvedReviewItem(item);
      toast.success("Master Data link saved");
      queryClient.invalidateQueries({ queryKey: ["style-rows"] });
      queryClient.invalidateQueries({ queryKey: ["style-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["style-cell-audit"] });
    },
    onError: (error) => toast.error("Could not save link", { description: error.message }),
  });

  const resolveLocal = useMutation({
    mutationFn: async (item: ReviewItem) => {
      const { error } = await (supabase as any).rpc("upsert_style_tracker_value_resolution", {
        p_field_key: item.fieldKey,
        p_raw_value: item.rawValue,
        p_resolution_type: "master_data",
        p_local_value: item.rawValue,
      });
      if (error) throw error;
      return item;
    },
    onSuccess: (item) => {
      removeResolvedReviewItem(item);
      toast.success("Master Data-only value saved");
      queryClient.invalidateQueries({ queryKey: ["style-rows"] });
      queryClient.invalidateQueries({ queryKey: ["style-candidates"] });
      queryClient.invalidateQueries({ queryKey: ["style-cell-audit"] });
    },
    onError: (error) => toast.error("Could not save Master Data value", { description: error.message }),
  });

  const applyView = useCallback((view: SavedView | null) => {
    const api = gridRef.current?.api;
    if (!api) return;
    if (!view) {
      api.resetColumnState();
      api.setFilterModel(null);
      return;
    }
    if (Array.isArray(view.column_state) && view.column_state.length) {
      api.applyColumnState({ state: view.column_state, applyOrder: true });
    }
    api.setFilterModel(view.filter_model ?? null);
  }, []);

  const selectView = useCallback(
    (view: SavedView | null) => {
      setActiveViewId(view?.id ?? null);
      try {
        if (view) window.localStorage.setItem(activeViewStorageKey(active.name), view.id);
        else window.localStorage.removeItem(activeViewStorageKey(active.name));
      } catch {
        // ignore storage failures (private mode, etc.)
      }
      applyView(view);
    },
    [active.name, applyView],
  );

  // Re-apply the remembered view when the grid mounts, when the sheet changes,
  // or once that sheet's saved views finish loading.
  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api || !gridReady || savedViewsQuery.isFetching) return;
    if (lastAppliedSheetRef.current === active.name) return;
    lastAppliedSheetRef.current = active.name;
    let storedId: string | null = null;
    try {
      storedId = window.localStorage.getItem(activeViewStorageKey(active.name));
    } catch {
      storedId = null;
    }
    const view = savedViews.find((item) => item.id === storedId) ?? null;
    setActiveViewId(view?.id ?? null);
    applyView(view);
  }, [gridReady, active.name, savedViews, savedViewsQuery.isFetching, applyView]);

  const captureViewState = () => {
    const api = gridRef.current?.api;
    if (!api) throw new Error("The grid is not ready yet.");
    return {
      column_state: api.getColumnState() as ColumnState[],
      filter_model: api.getFilterModel() as Record<string, unknown>,
    };
  };

  const openColumnsPanel = () => {
    const api = gridRef.current?.api;
    if (!api) {
      toast.error("The columns panel is not ready yet.");
      return;
    }
    api.setSideBarVisible(true);
    api.openToolPanel("columns");
  };

  const saveView = useMutation({
    mutationFn: async (name: string) => {
      if (!user?.id) throw new Error("You must be signed in to save a view.");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Enter a name for this view.");
      const { column_state, filter_model } = captureViewState();
      const { data, error } = await (supabase as any)
        .from("style_tracker_user_views")
        .insert({ user_id: user.id, source_sheet: active.name, view_name: trimmed, column_state, filter_model })
        .select("id, view_name, source_sheet, column_state, filter_model, updated_at")
        .single();
      if (error) throw error;
      return data as SavedView;
    },
    onSuccess: (view) => {
      toast.success(`Saved view “${view.view_name}”`);
      setActiveViewId(view.id);
      try {
        window.localStorage.setItem(activeViewStorageKey(active.name), view.id);
      } catch {
        // ignore storage failures
      }
      setViewDialog(null);
      setViewNameInput("");
      queryClient.invalidateQueries({ queryKey: ["style-tracker-views", user?.id, active.name] });
    },
    onError: (error) => toast.error("Could not save view", { description: error.message }),
  });

  const updateView = useMutation({
    mutationFn: async (view: SavedView) => {
      const { column_state, filter_model } = captureViewState();
      const { error } = await (supabase as any)
        .from("style_tracker_user_views")
        .update({ column_state, filter_model })
        .eq("id", view.id);
      if (error) throw error;
      return view;
    },
    onSuccess: (view) => {
      toast.success(`Updated “${view.view_name}”`);
      queryClient.invalidateQueries({ queryKey: ["style-tracker-views", user?.id, active.name] });
    },
    onError: (error) => toast.error("Could not update view", { description: error.message }),
  });

  const renameView = useMutation({
    mutationFn: async ({ view, name }: { view: SavedView; name: string }) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Enter a name for this view.");
      const { error } = await (supabase as any)
        .from("style_tracker_user_views")
        .update({ view_name: trimmed })
        .eq("id", view.id);
      if (error) throw error;
      return trimmed;
    },
    onSuccess: (name) => {
      toast.success(`Renamed view to “${name}”`);
      setViewDialog(null);
      setViewNameInput("");
      queryClient.invalidateQueries({ queryKey: ["style-tracker-views", user?.id, active.name] });
    },
    onError: (error) => toast.error("Could not rename view", { description: error.message }),
  });

  const deleteView = useMutation({
    mutationFn: async (view: SavedView) => {
      const { error } = await (supabase as any).from("style_tracker_user_views").delete().eq("id", view.id);
      if (error) throw error;
      return view;
    },
    onSuccess: (view) => {
      toast.success(`Deleted “${view.view_name}”`);
      if (activeViewId === view.id) {
        setActiveViewId(null);
        try {
          window.localStorage.removeItem(activeViewStorageKey(active.name));
        } catch {
          // ignore storage failures
        }
      }
      queryClient.invalidateQueries({ queryKey: ["style-tracker-views", user?.id, active.name] });
    },
    onError: (error) => toast.error("Could not delete view", { description: error.message }),
  });

  const openSaveViewDialog = () => {
    setViewsMenuOpen(false);
    setViewNameInput("");
    setViewDialog({ mode: "save" });
  };

  const openRenameViewDialog = (view: SavedView) => {
    setViewsMenuOpen(false);
    setViewNameInput(view.view_name);
    setViewDialog({ mode: "rename", viewId: view.id });
  };

  const submitViewDialog = () => {
    if (!viewDialog) return;
    if (viewDialog.mode === "save") {
      saveView.mutate(viewNameInput);
      return;
    }
    const target = savedViews.find((item) => item.id === viewDialog.viewId);
    if (target) renameView.mutate({ view: target, name: viewNameInput });
  };

  const columnDefs = useMemo<ColDef<StyleRow>[]>(
    () => [
      {
        field: "source_row_number",
        headerName: "#",
        width: 96,
        pinned: "left",
        editable: false,
        filter: "agNumberColumnFilter",
        suppressFillHandle: true,
        cellRenderer: RowNumberCell,
        headerComponent: RowNumberHeader,
      },
      {
        colId: "match",
        headerName: "Match",
        width: 112,
        pinned: "left",
        editable: false,
        filter: true,
        suppressFillHandle: true,
        valueGetter: (params) => params.data?.match_status ?? "unmatched",
        cellRenderer: (params: { data?: StyleRow }) => (
          <span
            className={cn(
              "inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
              params.data?.match_status === "matched" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
              params.data?.match_status === "partial" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
              params.data?.match_status === "needs_review" && "bg-destructive/15 text-destructive",
              (!params.data?.match_status || params.data.match_status === "unmatched") && "bg-muted text-muted-foreground",
            )}
          >
            {params.data?.match_status === "matched" ? "Linked" : params.data?.match_status === "partial" ? "Partial" : params.data?.match_status === "needs_review" ? "Review" : "Unlinked"}
          </span>
        ),
      },
      {
        colId: "rfq_group",
        headerName: "RFQ Group",
        width: 220,
        editable: false,
        filter: true,
        sortable: true,
        suppressFillHandle: true,
        valueGetter: (params) => params.data?.rfq_groups?.[0]?.name ?? null,
        filterValueGetter: (params) => params.data?.rfq_groups?.map((group) => group.name).join(" | ") ?? "",
        cellRenderer: RfqGroupCell,
      },
      ...active.columns.map((column): ColDef<StyleRow> => ({
        colId: column.letter,
        headerName: column.header,
        headerTooltip: `${column.letter}: ${column.header}`,
        width: column.width ?? 140,
        pinned: column.pinned,
        hide: column.hide,
        editable: true,
        cellEditor:
          column.typedField === "description"
            ? DescriptionBuilderEditor
            : column.optionKind || column.typedField === "customer" || column.typedField === "licensor" || column.typedField === "designer"
              ? "agRichSelectCellEditor"
              : undefined,
        cellEditorPopup: column.typedField === "description" ? true : undefined,
        cellEditorPopupPosition: column.typedField === "description" ? "under" : undefined,
        cellEditorParams:
          column.typedField === "description"
            ? { options: descriptionOptions }
            : column.optionKind || column.typedField === "customer" || column.typedField === "licensor" || column.typedField === "designer"
            ? {
                values:
                  (column.optionKind ?? column.typedField) === "customer"
                    ? (customerOptionsQuery.data ?? []).map((option) => option.id)
                    : (column.optionKind ?? column.typedField) === "licensor"
                      ? licensorOptionsQuery.data ?? []
                      : (column.optionKind ?? column.typedField) === "factory"
                        ? factoryOptionsQuery.data ?? []
                        : (column.optionKind ?? column.typedField) === "packagingType"
                          ? packagingTypeOptionsQuery.data ?? []
                        : designerOptionsQuery.data ?? [],
                allowTyping: (column.optionKind ?? column.typedField) !== "designer",
                filterList: true,
                highlightMatch: true,
                searchType: "matchAny",
                formatValue: column.optionKind === "customer" ? (customerId: string) => customerOptionById.get(customerId) ?? customerId : undefined,
              }
            : undefined,
        filter: true,
        sortable: true,
        resizable: true,
        valueGetter: (params) =>
          column.optionKind === "customer"
            ? params.data?.customer_id ?? null
            : column.optionKind === "designer"
              ? displayValueFor(params.data, column)
              : valueFor(params.data, column),
        filterValueGetter: column.optionKind === "customer" || column.optionKind === "designer" ? (params) => displayValueFor(params.data, column) : undefined,
        cellRenderer: column.linkKind
          ? (params: { data?: StyleRow }) => {
              const status = statusFor(params.data, column);
              return (
                <div className="flex h-full min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate">{String(displayValueFor(params.data, column) ?? "")}</span>
                  {status && (
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        status === "matched" && "bg-emerald-500",
                        status === "needs_review" && "bg-destructive",
                        status === "unmatched" && "bg-muted-foreground/35",
                      )}
                    />
                  )}
                </div>
              );
            }
          : undefined,
        valueSetter: (params) => {
          if (!params.data) return false;
          if (column.typedField === "description") {
            const validationError = validateDescriptionSelection(params.newValue, descriptionOptions);
            if (validationError) {
              toast.error("Description is incomplete", { description: validationError });
              return false;
            }
          }
          if (column.typedField === "designer") {
            const oldValue = String(params.oldValue ?? "").trim();
            const newValue = String(params.newValue ?? "").trim();
            if (newValue && normalized(newValue) !== normalized(oldValue) && !designerOptionKeys.has(normalized(newValue))) {
              toast.error("Choose a designer from the creative designer list");
              return false;
            }
          }
          if (column.optionKind === "packagingType") {
            const oldValue = String(params.oldValue ?? "").trim();
            const newValue = String(params.newValue ?? "").trim();
            if (newValue && normalized(newValue) !== normalized(oldValue) && !packagingTypeOptionKeys.has(normalized(newValue))) {
              toast.error("Choose a packaging type from the shared Packaging Types list");
              return false;
            }
          }
          const payload = buildUpdate(params.data, column, params.newValue);
          params.data.row_data = payload.row_data;
          if (column.optionKind === "customer") {
            params.data.customer_id = payload.customer_id ?? null;
            params.data.customer = null;
            params.data.canonical_customer_name = payload.customer_id ? customerOptionById.get(payload.customer_id) ?? null : null;
          }
          if (column.typedField) (params.data[column.typedField] as unknown) = payload[column.typedField];
          if (column.optionKind === "designer") params.data.canonical_designer_name = payload.designer ?? null;
          return true;
        },
      })),
    ],
    [active, customerOptionById, customerOptionsQuery.data, descriptionOptions, designerOptionKeys, designerOptionsQuery.data, factoryOptionsQuery.data, licensorOptionsQuery.data, packagingTypeOptionKeys, packagingTypeOptionsQuery.data],
  );

  const totalRows = countQuery.data ?? rows.length;
  const hiddenRows = Math.max(totalRows - rows.length, 0);
  const auditRows = cellAuditQuery.data ?? [];

  const contextMenuItems = (params: GetContextMenuItemsParams<StyleRow>): (DefaultMenuItem | MenuItemDef<StyleRow>)[] => {
    const defaultItems = params.defaultItems ?? [];
    const colId = params.column?.getColId();
    const column = active.columns.find((item) => item.letter === colId);
    const row = params.node?.data;
    if (!row || !column) return defaultItems;

    return [
      {
        name: "Audit history",
        subMenu: [
          {
            name: `Open ${columnLabel(row.source_sheet, column.letter)}`,
            action: () => setAuditCell({ row, column }),
          },
        ],
      },
      "separator",
      ...defaultItems,
    ];
  };

  return (
    <div className="flex h-[calc(100vh-var(--pd-header-h))] flex-col bg-background">
      <div className="border-b border-border bg-background px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted">
              <Table2 className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight text-foreground">Master Data</h1>
              <p className="text-xs text-muted-foreground">
                {rows.length.toLocaleString()} loaded rows · {totalRows.toLocaleString()} total rows
                {hiddenRows > 0 && !showAllRows ? ` · ${hiddenRows.toLocaleString()} older rows hidden` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={quickFilter} onChange={(event) => setQuickFilter(event.target.value)} className="h-9 pl-8" placeholder="Search master data" />
            </div>
            <Button variant="outline" size="sm" onClick={() => rowsQuery.refetch()} disabled={rowsQuery.isFetching}>
              <RefreshCw className={cn("h-4 w-4", rowsQuery.isFetching && "animate-spin")} />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAllRows((value) => !value)} disabled={rowsQuery.isFetching}>
              {showAllRows ? "Latest 2,500" : "Show All"}
            </Button>
            <Button variant="outline" size="sm" onClick={openColumnsPanel}>
              <Columns3 className="h-4 w-4" />
              Columns
            </Button>
            <DropdownMenu open={viewsMenuOpen} onOpenChange={setViewsMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="max-w-56">
                  <Star className={cn("h-4 w-4", activeView && "fill-current text-amber-500")} />
                  <span className="truncate">{activeView ? activeView.view_name : "Views"}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                {savedViewsQuery.isLoading ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
                ) : savedViews.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet.</div>
                ) : (
                  savedViews.map((view) => (
                    <div key={view.id} className="flex items-center gap-1 pr-1">
                      <DropdownMenuItem
                        className="min-w-0 flex-1"
                        onClick={() => selectView(view)}
                      >
                        <Check className={cn("h-3.5 w-3.5 shrink-0", view.id === activeViewId ? "opacity-100" : "opacity-0")} />
                        <span className="min-w-0 truncate">{view.view_name}</span>
                      </DropdownMenuItem>
                      <button
                        type="button"
                        title="Rename view"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openRenameViewDialog(view);
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Delete view"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          deleteView.mutate(view);
                        }}
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={openSaveViewDialog} disabled={!user}>
                  <Save className="h-3.5 w-3.5" />
                  Save current view…
                </DropdownMenuItem>
                {activeView && (
                  <DropdownMenuItem onClick={() => updateView.mutate(activeView)} disabled={updateView.isPending}>
                    <Check className="h-3.5 w-3.5" />
                    Update “{activeView.view_name}”
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => selectView(null)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset to default
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" disabled={addRow.isPending}>
                  <Plus className="h-4 w-4" />
                  Row
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-32">
                {[1, 5, 10, 25].map((count) => (
                  <DropdownMenuItem key={count} onClick={() => addRow.mutate(count)}>
                    +{count}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {configs.map((sheet) => (
            <button
              key={sheet.name}
              type="button"
              onClick={() => {
                setActiveSheet(sheet.name);
                setSelectedReviewKey(null);
              }}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                activeSheet === sheet.name ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {sheet.label}
            </button>
          ))}
        </div>
        {isAdmin && (
          <div className="mt-3 max-h-52 overflow-hidden border-t border-border pt-3">
            <div className="grid gap-3 xl:grid-cols-[minmax(220px,340px)_1fr] xl:items-start">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">Master Data matching</h2>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{reviewItems.length.toLocaleString()} values</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{selectedReviewItem ? "Approve a shared-table match or dismiss it into Master Data to remove it from this list." : "No unmatched Master Data values in this load."}</p>
              </div>
              {selectedReviewItem && (
                <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(220px,340px)_1fr_auto]">
                  <select value={selectedReviewItem.key} onChange={(event) => setSelectedReviewKey(event.target.value)} className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground">
                    {reviewItems.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}: {item.rawValue} ({item.count})
                      </option>
                    ))}
                  </select>
                  <div className="max-h-32 min-w-0 overflow-y-auto rounded-md border border-border bg-muted/20 p-1.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {(candidateQuery.data ?? []).map((candidate) => (
                        <Button
                          key={`${candidate.target_schema}.${candidate.target_table}.${candidate.target_id}`}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 max-w-72 justify-start text-xs"
                          disabled={resolveCanonical.isPending || resolveLocal.isPending}
                          onClick={() => resolveCanonical.mutate({ item: selectedReviewItem, candidate })}
                          title={`Approve ${candidate.target_label} and remove ${selectedReviewItem.rawValue} from the review list`}
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span className="truncate">Approve: {candidate.target_label}</span>
                        </Button>
                      ))}
                      {candidateQuery.isFetching && <span className="text-xs text-muted-foreground">Searching...</span>}
                      {!candidateQuery.isFetching && (candidateQuery.data ?? []).length === 0 && (
                        <div className="grid w-full min-w-0 gap-2">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <div className="relative min-w-0 flex-1">
                              <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                              <Input
                                value={manualCandidateSearch}
                                onChange={(event) => setManualCandidateSearch(event.target.value)}
                                className="h-8 pl-7 text-xs"
                                placeholder={`Search ${selectedReviewItem.label.toLowerCase()} values`}
                              />
                            </div>
                            <label className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5"
                                checked={showAllManualCandidates}
                                onChange={(event) => setShowAllManualCandidates(event.target.checked)}
                              />
                              Show all
                            </label>
                          </div>
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {manualCandidateQuery.isFetching && <span className="text-xs text-muted-foreground">Searching table...</span>}
                            {!manualCandidateQuery.isFetching && !showAllManualCandidates && manualCandidateSearch.trim().length < 2 && (
                              <span className="text-xs text-muted-foreground">No candidate values found. Search the table or enable Show all.</span>
                            )}
                            {!manualCandidateQuery.isFetching && (manualCandidateQuery.data ?? []).map((candidate) => (
                              <Button
                                key={`manual-${candidate.target_schema}.${candidate.target_table}.${candidate.target_id}`}
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 max-w-72 justify-start text-xs"
                                disabled={resolveCanonical.isPending || resolveLocal.isPending}
                                onClick={() => resolveCanonical.mutate({ item: selectedReviewItem, candidate })}
                                title={`Approve ${candidate.target_label} and remove ${selectedReviewItem.rawValue} from the review list`}
                              >
                                <Check className="h-3.5 w-3.5" />
                                <span className="truncate">Approve: {candidate.target_label}</span>
                              </Button>
                            ))}
                            {!manualCandidateQuery.isFetching && (showAllManualCandidates || manualCandidateSearch.trim().length >= 2) && (manualCandidateQuery.data ?? []).length === 0 && (
                              <span className="text-xs text-muted-foreground">No table values found</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 whitespace-nowrap text-xs"
                    disabled={resolveCanonical.isPending || resolveLocal.isPending}
                    onClick={() => resolveLocal.mutate(selectedReviewItem)}
                    title={`Keep ${selectedReviewItem.rawValue} only in Master Data and remove it from the review list`}
                  >
                    Dismiss: Keep In Master Data
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 p-3">
        <div className="h-full min-h-0 overflow-hidden rounded-md border border-border bg-card">
          <AgGridReact
            ref={gridRef}
            theme={theme === "dark" ? darkGridTheme : lightGridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={{ minWidth: 90, suppressHeaderMenuButton: false, wrapHeaderText: true, autoHeaderHeight: true }}
            loading={rowsQuery.isLoading}
            quickFilterText={quickFilter}
            getRowId={(params) => params.data.id}
            getRowStyle={(params) => {
              const approval = approvalHighlightForRow(params.data);
              if (approval === "production") return { backgroundColor: "#dcfce7", color: "#14532d" };
              if (approval === "concept") return { backgroundColor: "#fef3c7", color: "#713f12" };
              return undefined;
            }}
            getContextMenuItems={contextMenuItems}
            onGridReady={(event: GridReadyEvent<StyleRow>) => {
              void event;
              setGridReady(true);
            }}
            suppressDragLeaveHidesColumns
            maintainColumnOrder
            onCellValueChanged={(event: CellValueChangedEvent<StyleRow>) => {
              if (!event.data || event.oldValue === event.newValue) return;
              const column = active.columns.find((item) => item.letter === event.colDef.colId);
              if (column) updateCell.mutate({ row: event.data, column, value: event.newValue });
            }}
            rowSelection={{ mode: "multiRow", checkboxes: false, headerCheckbox: false }}
            cellSelection={{ handle: { mode: "fill", direction: "xy" } }}
            sideBar={{ toolPanels: [{ id: "columns", labelDefault: "Columns", labelKey: "columns", iconKey: "columns", toolPanel: "agColumnsToolPanel" }], hiddenByDefault: true }}
            pagination
            paginationPageSize={MASTER_DATA_DEFAULT_PAGE_SIZE}
            paginationPageSizeSelector={MASTER_DATA_PAGE_SIZE_OPTIONS}
            stopEditingWhenCellsLoseFocus
          />
        </div>
      </div>
      <Dialog open={Boolean(auditCell)} onOpenChange={(open) => !open && setAuditCell(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-4 w-4 text-primary" />
              Audit History
            </DialogTitle>
            <DialogDescription>
              {auditCell ? `${columnLabel(auditCell.row.source_sheet, auditCell.column.letter)} · Row ${auditCell.row.source_row_number ?? ""}` : "Cell change history"}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {cellAuditQuery.isLoading && <div className="text-sm text-muted-foreground">Loading history...</div>}
            {cellAuditQuery.isError && <div className="text-sm text-destructive">Could not load audit history.</div>}
            {!cellAuditQuery.isLoading && !cellAuditQuery.isError && auditRows.length === 0 && <div className="text-sm text-muted-foreground">No changes recorded for this cell yet.</div>}
            <div className="space-y-3">
              {auditRows.map((entry) => (
                <div key={entry.id} className="rounded-md border border-border bg-background p-3">
                  <div className="text-sm font-medium text-foreground">{auditTitle(entry)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{auditDescription(entry)}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{entry.changed_by_label ?? "Unknown user"}</span>
                    <span>{formatAuditTime(entry.changed_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(viewDialog)}
        onOpenChange={(open) => {
          if (!open) {
            setViewDialog(null);
            setViewNameInput("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {viewDialog?.mode === "rename" ? <Pencil className="h-4 w-4 text-primary" /> : <Save className="h-4 w-4 text-primary" />}
              {viewDialog?.mode === "rename" ? "Rename view" : "Save view"}
            </DialogTitle>
            <DialogDescription>
              {viewDialog?.mode === "rename"
                ? "Give this saved view a new name."
                : `Save the current column layout, order, sizing, and filters for ${active.label}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-1">
            <Input
              autoFocus
              value={viewNameInput}
              onChange={(event) => setViewNameInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitViewDialog();
                }
              }}
              placeholder="e.g. Concept pipeline"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setViewDialog(null);
                setViewNameInput("");
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={submitViewDialog} disabled={!viewNameInput.trim() || saveView.isPending || renameView.isPending}>
              {viewDialog?.mode === "rename" ? "Rename" : "Save view"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
