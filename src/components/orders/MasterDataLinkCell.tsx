import { AlertTriangle, CheckCircle2, Link2, MinusCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { matchStatusLabel } from "@/lib/order-list";
import { cn } from "@/lib/utils";
import type { OrderListRow } from "@/types/order-list";

type Props = {
  row: OrderListRow | undefined;
  onRelink: (row: OrderListRow) => void;
};

/**
 * Shows how the line resolved to Master Data. An unmatched or ambiguous line is
 * always named as such -- it never silently shows a blank cell.
 */
export function MasterDataLinkCell({ row, onRelink }: Props) {
  if (!row) return null;

  const status = row.master_data_match_status;
  const linked = Boolean(row.item_id);
  const ambiguous = status === "ambiguous";
  const notApplicable = status === "not_applicable";
  const typeMismatch = Boolean(row.item_link_type_mismatch);

  const tone = linked && !typeMismatch
    ? "text-emerald-600 dark:text-emerald-400"
    : notApplicable
      ? "text-muted-foreground"
      : "text-amber-600 dark:text-amber-400";

  const Icon = linked && !typeMismatch ? CheckCircle2 : notApplicable ? MinusCircle : AlertTriangle;

  const label = typeMismatch ? "Wrong catalog" : matchStatusLabel(status);
  const detail = ambiguous
    ? "Master Data holds more than one row for this Style # in this catalog. Pick the right one."
    : typeMismatch
      ? "The linked item belongs to the other Master Data catalog."
      : linked
        ? row.master_data_description ?? ""
        : notApplicable
          ? "This line has no Style # to match."
          : "No Master Data row matched this Style # exactly.";

  return (
    <div className="flex h-full items-center gap-2" title={detail}>
      <Icon className={cn("h-4 w-4 shrink-0", tone)} aria-hidden="true" />
      <span className={cn("truncate text-xs font-medium", tone)}>{label}</span>
      {!notApplicable && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-2 text-xs"
          onClick={() => onRelink(row)}
        >
          <Link2 className="mr-1 h-3 w-3" aria-hidden="true" />
          {linked ? "Change" : "Link"}
        </Button>
      )}
    </div>
  );
}

export default MasterDataLinkCell;
