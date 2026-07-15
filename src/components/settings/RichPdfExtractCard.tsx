import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";

/**
 * Trigger + status for the rich tech-pack / licensing-sheet PDF extraction
 * backfill (worker op "rich-pdf-extract"). Extracts structured product data
 * (materials, dimensions, compliance, source files, …) from tech-pack /
 * licensing-sheet PDFs into style_groups.rich_metadata and asset facets.
 */
export default function RichPdfExtractCard() {
  const op = usePersistentOperation("rich-pdf-extract");
  const status = op.state.status;
  const running = status === "running" || status === "queued";
  const progress = (op.state.progress ?? {}) as Record<string, unknown>;
  const processed = Number(progress.processed ?? 0);
  const groups = Number(progress.groups_rolled_up ?? 0);

  const run = () =>
    op.start({
      confirmMessage:
        "Run rich-PDF extraction over tech-pack / licensing-sheet PDFs? Requires DEEPSEEK_API_KEY set in the worker env.",
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Rich PDF Extraction
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Extracts structured product data (materials, dimensions, compliance, source files,
          Pantone, approval dates) from tech-pack and licensing-sheet PDFs into the style group,
          searchable across all member assets. Idempotent — re-runs skip unchanged PDFs.
        </p>
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {running ? (
              <span className="inline-flex items-center gap-1.5 text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                {status === "queued" ? "Queued…" : "Extracting…"}
                {processed > 0 && ` ${processed} PDFs, ${groups} groups this run`}
              </span>
            ) : status === "failed" ? (
              <span className="text-destructive">Failed: {op.state.error ?? "unknown error"}</span>
            ) : status === "completed" || status === "completed_with_repair" ? (
              <span>Done.</span>
            ) : (
              <span>Idle.</span>
            )}
          </div>
          <Button size="sm" onClick={run} disabled={running} className="gap-1.5">
            {running ? "Running…" : "Run extraction"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
