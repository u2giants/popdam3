import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { OrderListLinkCandidate, OrderListRow } from "@/types/order-list";

type Props = {
  row: OrderListRow | null;
  candidates: OrderListLinkCandidate[];
  isLoading: boolean;
  isSaving: boolean;
  onClose: () => void;
  onConfirm: (itemId: string) => void;
};

/**
 * Manual relink. Only exact, catalog-eligible candidates are offered; the dialog
 * never guesses and never falls back to a near match.
 */
export function MasterDataLinkDialog({ row, candidates, isLoading, isSaving, onClose, onConfirm }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  if (!row) return null;

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link to Master Data</DialogTitle>
          <DialogDescription>
            Style # <span className="font-mono">{row.sku ?? "(none)"}</span> in the{" "}
            {row.source_style_type ?? "unknown"} catalog. Only exact Style # matches in that catalog can be linked.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-6 text-sm text-muted-foreground">Loading eligible Master Data rows...</p>
        ) : candidates.length === 0 ? (
          <p className="py-6 text-sm text-amber-600 dark:text-amber-400">
            No eligible Master Data row has this exact Style # in the {row.source_style_type ?? "selected"} catalog.
            Fix the Style # on the order line, or add the record in Master Data first.
          </p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-auto py-2">
            {candidates.map((candidate) => {
              const itemId = candidate.plm_item_id as string;
              const isSelected = selected === itemId;
              return (
                <li key={candidate.style_tracker_row_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(itemId)}
                    className={cn(
                      "w-full rounded-md border px-3 py-2 text-left text-sm transition",
                      isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="font-medium">
                      {candidate.sku} <span className="text-muted-foreground">({candidate.tracker_type})</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{candidate.description ?? "(no description)"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[candidate.licensor, candidate.license_status, candidate.default_vendor]
                        .filter(Boolean)
                        .join(" | ")}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!selected || isSaving} onClick={() => selected && onConfirm(selected)}>
            {isSaving ? "Linking..." : "Link this record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MasterDataLinkDialog;
