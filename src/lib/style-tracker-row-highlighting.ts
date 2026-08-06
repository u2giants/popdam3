type StyleTrackerApprovalRow = {
  production_status?: unknown;
  row_data?: Record<string, unknown> | null;
};

export type StyleTrackerApprovalHighlight = "concept" | "production" | null;

function hasEnteredDate(value: unknown) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value !== "string") return false;

  const date = value.trim();
  if (!date) return false;

  return (
    /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(date) ||
    /^\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(date)
  );
}

export function approvalHighlightForRow(row: StyleTrackerApprovalRow | undefined): StyleTrackerApprovalHighlight {
  if (!row) return null;

  const productionApproval = row.production_status ?? row.row_data?.production_approval;
  if (hasEnteredDate(productionApproval)) return "production";

  if (hasEnteredDate(row.row_data?.concept_approval)) return "concept";

  return null;
}
