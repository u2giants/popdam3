import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";

export type GridFindStepperProps = {
  /** 1-based position of the current match; null hides the stepper (no search). */
  position: number | null;
  /** Total matches, when known. Null keeps the count hidden while it loads. */
  total: number | null;
  /** Still loading the data the matches are counted over. */
  loading?: boolean;
  onPrev: () => void;
  onNext: () => void;
};

/**
 * Google-Sheets-style match counter for a grid Find box: "3 of 12" with arrows
 * to step between matches. Step buttons stay inert until a second match exists.
 */
export function GridFindStepper({ position, total, loading = false, onPrev, onNext }: GridFindStepperProps) {
  if (position == null) return null;

  const count = total ?? 0;
  const current = Math.min(position, Math.max(count, 1));
  // A null total is unknown (legacy fallback), not zero: show no count, only
  // the position, and keep the arrows usable so stepping still works.
  const label = total == null
    ? `${current}`
    : count === 0
      ? "0 results"
      : `${current} of ${count}${loading ? "…" : ""}`;

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
    >
      <span className="whitespace-nowrap px-1 tabular-nums">{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Previous match"
        disabled={loading || (total != null && count < 2)}
        onClick={onPrev}
      >
        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Next match"
        disabled={loading || (total != null && count < 2)}
        onClick={onNext}
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </span>
  );
}
