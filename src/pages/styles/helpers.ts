import { workflowCellValue, normalizeWorkflowEditValue } from "@/lib/master-data-workflow";
import { supabase } from "@/integrations/supabase/client";
import { normalizeStyleTrackerValue } from "@/lib/style-tracker-candidates";
import { type FieldKey, type RowData, type StyleRow, type SheetColumn, type PickerOption, type DescriptionParts, type DescriptionEditorOptions, type AuditLogEntry } from "./types";
import { APPROVED_LICENSOR_PROPERTY_OPTIONS, COMMON_SIZE_OPTIONS, SIZE_AT_END_RE, configs } from "./columns";

export function valueFor(row: StyleRow | undefined, column: SheetColumn) {
  if (!row) return "";
  return workflowCellValue(row, column);
}

export function yesNoValue(value: unknown) {
  if (value === true || String(value).toLowerCase() === "true" || String(value).toLowerCase() === "yes") return "Yes";
  if (value === false || String(value).toLowerCase() === "false" || String(value).toLowerCase() === "no") return "No";
  return value ?? "";
}

export function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

export function dateValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  const slashDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slashDate) return text;
  const [, month, day, year] = slashDate;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function googleDateDisplay(value: unknown) {
  const text = String(value ?? "");
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return isoDate ? `${Number(isoDate[2])}/${Number(isoDate[3])}/${isoDate[1]}` : text;
}

export function displayValueFor(row: StyleRow | undefined, column: SheetColumn) {
  if (!row) return "";
  if (column.optionKind === "customer") return row.canonical_customer_name ?? row.customer ?? "";
  if (column.optionKind === "designer") return row.canonical_designer_name ?? row.designer ?? "";
  return valueFor(row, column);
}

export function normalized(value: string) {
  return normalizeStyleTrackerValue(value);
}

export function fieldValue(row: StyleRow, field: FieldKey) {
  if (field === "sku") return row.sku;
  if (field === "customer") return row.customer;
  if (field === "licensor") return row.licensor;
  if (field === "designer") return row.designer;
  return row.default_vendor;
}

export function fieldLabel(field: FieldKey) {
  if (field === "sku") return "Style # / SKU";
  if (field === "customer") return "Customer";
  if (field === "licensor") return "Licensor";
  if (field === "designer") return "Designer";
  return "Vendor";
}

export function hasFieldMatch(row: StyleRow, field: FieldKey) {
  if (field === "sku") return Boolean(row.erp_item_id || row.style_group_id || row.plm_item_id);
  if (field === "customer") return Boolean(row.customer_id || row.company_id);
  if (field === "licensor") return Boolean(row.public_licensor_id || row.core_licensor_id);
  if (field === "designer") return Boolean(row.creative_designer_id);
  return Boolean(row.factory_id);
}

export function hasManualResolution(row: StyleRow, fieldKey: FieldKey) {
  const manualByField = row.match_notes?.manual_resolutions;
  if (manualByField && typeof manualByField === "object" && !Array.isArray(manualByField)) {
    if (Object.prototype.hasOwnProperty.call(manualByField, fieldKey)) return true;
  }
  return manualResolutionField(row) === fieldKey;
}

export function manualResolutionField(row: StyleRow) {
  const manual = row.match_notes?.manual_resolution;
  if (!manual || typeof manual !== "object" || Array.isArray(manual)) return null;
  const field = (manual as Record<string, unknown>).field_key;
  return typeof field === "string" ? field : null;
}

export function fuzzyCandidate(row: StyleRow | undefined, field: FieldKey) {
  const fuzzy = row?.match_notes?.fuzzy;
  if (!fuzzy || typeof fuzzy !== "object" || Array.isArray(fuzzy)) return null;
  return (fuzzy as Record<string, unknown>)[field] ?? null;
}

export function statusFor(row: StyleRow | undefined, column: SheetColumn) {
  if (!row || !column.linkKind) return null;
  if (fuzzyCandidate(row, column.linkKind)) return "needs_review";
  if (hasFieldMatch(row, column.linkKind)) return "matched";
  return "unmatched";
}

export function buildUpdate(row: StyleRow, column: SheetColumn, value: unknown): Partial<StyleRow> & { row_data: RowData } {
  if (column.typedField === "license_status") throw new Error("License Status is calculated from the current workflow and cannot be edited.");
  const nextValue = normalizeWorkflowEditValue(value, column);
  if (column.optionKind === "customer") {
    const rowData = { ...(row.row_data ?? {}) };
    delete rowData[column.letter];
    if (column.legacyKey) delete rowData[column.legacyKey];
    return { row_data: rowData, customer_id: nextValue == null ? null : String(nextValue), customer: null };
  }
  const rowData = { ...(row.row_data ?? {}), [column.letter]: nextValue };
  if (column.legacyKey) rowData[column.legacyKey] = nextValue;
  const payload: Partial<StyleRow> & { row_data: RowData } = { row_data: rowData };
  if (column.typedField) (payload[column.typedField] as unknown) = nextValue;
  return payload;
}

export function columnLabel(sourceSheet: string | null | undefined, letter: string | null | undefined) {
  if (!letter) return "field";
  const config = configs.find((item) => item.name === sourceSheet) ?? configs[0];
  const column = config.columns.find((item) => item.letter === letter);
  return column ? `${column.header} (${letter})` : letter;
}

export function displayAuditValue(value: unknown) {
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

export function auditTitle(entry: AuditLogEntry) {
  if (entry.event_type === "row_added") return `Added row ${entry.source_row_number ?? ""}`.trim();
  if (entry.event_type === "value_resolution") {
    const metadata = entry.metadata ?? {};
    const rawValue = typeof metadata.raw_value === "string" ? metadata.raw_value : "";
    return `${fieldLabel((entry.field_key as FieldKey) ?? "sku")} match${rawValue ? `: ${rawValue}` : ""}`;
  }
  return `${columnLabel(entry.source_sheet, entry.column_letter)} changed`;
}

export function auditDescription(entry: AuditLogEntry) {
  if (entry.event_type === "row_added") return "New Master Data row created.";
  if (entry.event_type === "value_resolution") {
    const metadata = entry.metadata ?? {};
    const kind = metadata.resolution_type === "canonical" ? "Linked to" : "Kept in Master Data as";
    return `${kind} ${displayAuditValue(entry.new_value)}.`;
  }
  return `${displayAuditValue(entry.old_value)} -> ${displayAuditValue(entry.new_value)}`;
}

// Constructing an Intl.DateTimeFormat is far more expensive than formatting
// with one, and this is called once per audit-log entry on every render.
export const auditTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatAuditTime(value: string) {
  return auditTimeFormatter.format(new Date(value));
}

export function designerCandidateScore(rawValue: string, candidateName: string) {
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

export function levenshtein(a: string, b: string) {
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

export function compactPickerOptions(rows: unknown) {
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

export function compactStringOptions(values: Iterable<string | null | undefined>, limit = 500) {
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

export async function fetchPropertyOptions() {
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

export async function fetchSizeOptions() {
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

export function buildLicensorPropertyOptions(properties: string[]) {
  return compactStringOptions([...APPROVED_LICENSOR_PROPERTY_OPTIONS, ...properties], 1200);
}

export function parseDescriptionParts(value: unknown, options: DescriptionEditorOptions): DescriptionParts {
  let remaining = String(value ?? "").replace(/\s+/g, " ").trim();
  const parts: DescriptionParts = {
    mg01: "",
    mg02: "",
    mg03: "",
    licensorProperty: "",
    artDescription: "",
    size: "",
  };

  const sizeMatch = remaining.match(SIZE_AT_END_RE);
  if (sizeMatch?.[1]) {
    parts.size = sizeMatch[1].replace(/\s*[x×]\s*/g, "x").replace(/\s+/g, " ").trim();
    remaining = remaining.slice(0, sizeMatch.index).trim();
  }

  const mg01Option = longestPrefixMatch(remaining, options.mg01);
  if (mg01Option) {
    parts.mg01 = mg01Option;
    remaining = remaining.slice(mg01Option.length).trim();
    const mg02Option = longestPrefixMatch(remaining, options.mg02(mg01Option));
    if (mg02Option) {
      parts.mg02 = mg02Option;
      remaining = remaining.slice(mg02Option.length).trim();
      const mg03Option = longestPrefixMatch(remaining, options.mg03(mg01Option, mg02Option));
      if (mg03Option) {
        parts.mg03 = mg03Option;
        remaining = remaining.slice(mg03Option.length).trim();
      }
    }
  }

  const licensorPropertyOption = longestPrefixMatch(remaining, options.licensorProperty);
  if (licensorPropertyOption) {
    parts.licensorProperty = licensorPropertyOption;
    remaining = remaining.slice(licensorPropertyOption.length).trim();
  }

  parts.artDescription = remaining;
  return parts;
}

export function longestPrefixMatch(value: string, options: string[]) {
  const normalizedValue = normalized(value);
  if (!normalizedValue) return "";
  return [...options]
    .sort((a, b) => b.length - a.length)
    .find((option) => {
      const key = normalized(option);
      return normalizedValue === key || normalizedValue.startsWith(`${key} `);
    }) ?? "";
}

export function assembleDescription(parts: DescriptionParts) {
  return [parts.mg01, parts.mg02, parts.mg03, parts.licensorProperty, parts.artDescription, parts.size]
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

export function optionSet(options: string[]) {
  return new Set(options.map((option) => normalized(option)));
}

export function validateDescriptionSelection(value: unknown, options: DescriptionEditorOptions) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const parts = parseDescriptionParts(text, options);
  const missing: string[] = [];
  if (!optionSet(options.mg01).has(normalized(parts.mg01))) missing.push("MG01");
  if (!optionSet(options.mg02(parts.mg01)).has(normalized(parts.mg02))) missing.push("MG02");
  if (!optionSet(options.mg03(parts.mg01, parts.mg02)).has(normalized(parts.mg03))) missing.push("MG03");
  if (!optionSet(options.licensorProperty).has(normalized(parts.licensorProperty))) missing.push("Licensor + Property");
  if (!optionSet(options.size).has(normalized(parts.size))) missing.push("Size");
  return missing.length ? `Choose approved values for ${missing.join(", ")}.` : null;
}
