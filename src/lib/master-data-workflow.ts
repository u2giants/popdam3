/** Presence, including explicit clears, wins over historical sheet letters. */
export const WORKFLOW_KEYS = new Set([
  "concept_sent", "concept_resubmit", "concept_resubmitted", "concept_approval",
  "concept_approved_with_comments", "request_pre_production_sample", "sample_vendor",
  "sample_eta", "sample_received", "sample_photos_received", "pre_production_sent", "pre_production_resubmit",
  "pre_production_resubmitted", "pre_production_approved_comment", "pre_production_approval",
  "production_approval", "professional_photos", "test_report", "contractual_samples_reorder",
  "default_vendor_sales", "discontinued",
]);
export function workflowCellValue(
  row: { row_data?: Record<string, unknown> | null; [key: string]: unknown },
  column: { letter: string; typedField?: string; legacyKey?: string },
): unknown {
  if (column.typedField === "license_status") return row.license_status ?? "Unknown";
  const data = row.row_data ?? {};
  if (column.legacyKey && WORKFLOW_KEYS.has(column.legacyKey) && Object.prototype.hasOwnProperty.call(data, column.legacyKey)) return data[column.legacyKey];
  const typed = column.typedField ? row[column.typedField] : null;
  return typed ?? data[column.letter] ?? (column.legacyKey ? data[column.legacyKey] : "") ?? "";
}
export function mergeComputedLicenseStatus<T extends { id: string; license_status: string | null }>(
  rows: T[], statuses: Array<{ id: string; license_status: string | null }>,
): T[] {
  const byId = new Map(statuses.map((status) => [status.id, status.license_status]));
  return rows.map((row) => {
    if (!byId.has(row.id)) throw new Error("Current license status is unavailable for a loaded Master Data row. Retry loading.");
    return { ...row, license_status: byId.get(row.id) ?? null };
  });
}
