export type TrackingInputKind = "date" | "number" | "boolean" | "text";

export const TRACKING_INPUTS = [
  { key: "sent_po_date", label: "PO sent date", kind: "date" },
  { key: "vendor_delivery_date", label: "Vendor delivery date", kind: "date" },
  { key: "booking_state", label: "Booking state", kind: "text" },
  { key: "etd", label: "ETD", kind: "date" },
  { key: "eta", label: "ETA", kind: "date" },
  { key: "container_booking_group", label: "Container booking group", kind: "text" },
  { key: "mbl", label: "MBL", kind: "text" },
  { key: "close_tracking", label: "Close tracking", kind: "boolean" },
  { key: "agent", label: "Agent", kind: "text" },
  { key: "cbm", label: "CBM", kind: "number" },
  { key: "comment", label: "Comment", kind: "text" },
  { key: "vessel", label: "Vessel", kind: "text" },
  { key: "sent_to_coldlion", label: "Sent to ColdLion", kind: "boolean" },
  { key: "worksheet_done", label: "Worksheet done", kind: "boolean" },
  { key: "inspection_passed", label: "Inspection passed", kind: "date" },
  { key: "inspection_note", label: "Inspection note", kind: "text" },
  { key: "document_invoice", label: "Invoice", kind: "boolean" },
  { key: "document_packing_list", label: "Packing list", kind: "boolean" },
  { key: "document_bill_of_lading", label: "Bill of lading", kind: "boolean" },
  { key: "document_tsca", label: "TSCA", kind: "boolean" },
  { key: "document_lacey_act", label: "Lacey Act", kind: "boolean" },
  { key: "document_telex", label: "Telex", kind: "boolean" },
  { key: "request_wire", label: "Request wire", kind: "boolean" },
  { key: "payment_note", label: "Payment note", kind: "text" },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  kind: TrackingInputKind;
}>;

export type TrackingInputKey = (typeof TRACKING_INPUTS)[number]["key"];
export type TrackingPatch = Partial<Record<TrackingInputKey, string | number | boolean | null>>;

const inputByKey = new Map<string, (typeof TRACKING_INPUTS)[number]>(
  TRACKING_INPUTS.map((input) => [input.key, input]),
);

function emptyToNull(value: unknown): unknown {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "")
    ? null
    : value;
}

export function normalizeStrictDate(value: unknown): string | null {
  const input = emptyToNull(value);
  if (input === null) return null;
  if (typeof input !== "string") throw new Error("Date must use YYYY-MM-DD format");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!match) throw new Error("Date must use YYYY-MM-DD format");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1) throw new Error("Date is not a real calendar date");
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Date is not a real calendar date");
  }
  return `${yearText}-${monthText}-${dayText}`;
}

function normalizeBoolean(value: unknown, key: TrackingInputKey): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  if (value === null || value === undefined || value === "") return key === "close_tracking" ? false : null;
  throw new Error(`${key} must be true, false, or blank`);
}

function normalizeFiniteNumber(value: unknown): number | null {
  const input = emptyToNull(value);
  if (input === null) return null;
  if (typeof input !== "number" && (typeof input !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input.trim()))) {
    throw new Error("CBM must be a finite number of zero or greater");
  }
  const number = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isFinite(number) || number < 0) {
    throw new Error("CBM must be a finite number of zero or greater");
  }
  return number;
}

function normalizeText(value: unknown): string | null {
  const input = emptyToNull(value);
  if (input === null) return null;
  if (typeof input !== "string") throw new Error("Text fields must be strings");
  return input.trim() || null;
}

function normalizeTrackingValue(key: TrackingInputKey, value: unknown): string | number | boolean | null {
  const kind = inputByKey.get(key)!.kind;
  if (kind === "date") return normalizeStrictDate(value);
  if (kind === "number") return normalizeFiniteNumber(value);
  if (kind === "boolean") return normalizeBoolean(value, key);
  return normalizeText(value);
}

/** Normalize explicitly supplied editable fields and omit values that are unchanged. */
export function buildTrackingPatch(
  original: Partial<Record<TrackingInputKey, unknown>>,
  changed: Record<string, unknown>,
): TrackingPatch {
  if (!changed || typeof changed !== "object" || Array.isArray(changed)) {
    throw new Error("Tracking changes must be an object");
  }
  const patch: TrackingPatch = {};
  for (const [rawKey, value] of Object.entries(changed)) {
    if (!inputByKey.has(rawKey)) throw new Error(`Tracking field is not editable: ${rawKey}`);
    const key = rawKey as TrackingInputKey;
    const normalized = normalizeTrackingValue(key, value);
    const hasOriginal = Object.prototype.hasOwnProperty.call(original, key);
    const prior = hasOriginal
      ? normalizeTrackingValue(key, original[key])
      : undefined;
    if (!hasOriginal || normalized !== prior) patch[key] = normalized;
  }
  return patch;
}

export function normalizeSampleDepth(value: unknown): number | null {
  const input = emptyToNull(value);
  if (input === null) return null;
  const number = typeof input === "number"
    ? input
    : typeof input === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input.trim())
      ? Number(input.trim())
      : NaN;
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Sample depth must be finite and greater than zero, or blank to clear");
  }
  return number;
}

export function normalizeRequiredKey(value: unknown, fieldName: string): string {
  if (typeof value !== "string") throw new Error(`${fieldName} is required`);
  const normalized = value.trim().toLowerCase();
  if (!normalized) throw new Error(`${fieldName} is required`);
  return normalized;
}

export function normalizeCustomerSuffix(value: unknown): string {
  if (typeof value !== "string") throw new Error("Customer suffix must contain 1 to 50 characters");
  const suffix = value.trim();
  const suffixLength = [...suffix].length;
  if (suffixLength < 1 || suffixLength > 50) {
    throw new Error("Customer suffix must contain 1 to 50 characters");
  }
  return suffix;
}

/** Escape user text for a literal SQL/PostgREST ilike pattern. */
export function escapeLiteralOrderSearch(value: string): string {
  if (value.length > 200) throw new Error("Search is limited to 200 characters");
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
