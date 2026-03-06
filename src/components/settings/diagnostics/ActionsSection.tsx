import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  RefreshCw, RotateCcw, Play, Trash2, Stethoscope,
  FileSearch, Sparkles, Loader2,
} from "lucide-react";
import type { RequestOpFn } from "./types";
import { OP_NAMES } from "./types";

export function ActionsSection({ onRefresh, requestOp }: { onRefresh: () => void; requestOp: RequestOpFn }) {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const reprocessOp = usePersistentOperation("reprocess-metadata");
  const backfillOp = usePersistentOperation("backfill-sku-names");

  const resetScanMutation = useMutation({
    mutationFn: () => call("reset-scan-state"),
    onSuccess: () => { toast.success("Scan state reset to idle"); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });

  const resumeMutation = useMutation({
    mutationFn: () => call("resume-scanning"),
    onSuccess: () => { toast.success("Scanning resumed"); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });

  const retryFailedMutation = useMutation({
    mutationFn: () => call("retry-failed-jobs"),
    onSuccess: (data) => { toast.success(`${data.retried_count ?? 0} failed jobs reset to pending`); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });

  const clearCompletedMutation = useMutation({
    mutationFn: () => call("clear-completed-jobs"),
    onSuccess: (data) => { toast.success(`${data.deleted_count ?? 0} old completed jobs cleared`); onRefresh(); },
    onError: (e) => toast.error(e.message),
  });

  function runReprocess() {
    requestOp("reprocess-metadata", OP_NAMES["reprocess-metadata"],
      () => reprocessOp.start({ confirmMessage: "Re-derive SKU metadata for all assets. Continue?" }),
      () => reprocessOp.queue({ params: {} }),
    );
  }

  function runBackfill() {
    requestOp("backfill-sku-names", OP_NAMES["backfill-sku-names"],
      () => backfillOp.start({ confirmMessage: "Re-resolve licensor/property names from ColdLion API. Continue?" }),
      () => backfillOp.queue({ params: {} }),
    );
  }

  const reprocessActive = reprocessOp.isActive;
  const backfillActive = backfillOp.isActive;
  const rp = reprocessOp.state.progress;
  const bp = backfillOp.state;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Stethoscope className="h-4 w-4" /> Actions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 items-center">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={onRefresh}>
                  <RefreshCw className="h-3.5 w-3.5" /> Run Diagnostics
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px] text-center">Refreshes all status cards and counters on this page</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm" className="gap-1.5"
                  onClick={() => { if (confirm("Reset scan state to idle?")) resetScanMutation.mutate(); }}
                  disabled={resetScanMutation.isPending}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset Scan State
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[240px] text-center">Clears scan request and progress flags. Does not delete any discovered assets.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm" className="gap-1.5"
                  onClick={() => resumeMutation.mutate()}
                  disabled={resumeMutation.isPending}
                >
                  <Play className="h-3.5 w-3.5" /> Resume Scanning
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px] text-center">Triggers a new scan that resumes from the last checkpoint</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm" className="gap-1.5"
                  onClick={() => retryFailedMutation.mutate()}
                  disabled={retryFailedMutation.isPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Retry Failed Jobs
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px] text-center">Resets all failed AI-tag and render jobs back to pending so they'll be retried</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm" className="gap-1.5 text-destructive"
                  onClick={() => { if (confirm("Delete completed jobs older than 7 days?")) clearCompletedMutation.mutate(); }}
                  disabled={clearCompletedMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear Old Completed Jobs
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[240px] text-center">Removes completed job records older than 7 days from the queue table. Does not affect assets.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm" className="gap-1.5"
                  onClick={runReprocess}
                  disabled={reprocessActive}
                >
                  {reprocessActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}
                  {reprocessActive ? "Reprocessing…" : reprocessOp.isInterrupted ? "Reprocess (interrupted)" : "Reprocess Metadata"}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px] text-center">Re-derives SKU, licensor, and property metadata from filenames for all assets. Safe to re-run.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm" className="gap-1.5"
                  onClick={runBackfill}
                  disabled={backfillActive}
                >
                  {backfillActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {backfillActive ? "Backfilling…" : backfillOp.isInterrupted ? "Backfill (interrupted)" : "Backfill SKU Names"}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px] text-center">Resolves human-readable licensor/property names from the ColdLion API where only codes exist</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {reprocessOp.isInterrupted && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => reprocessOp.reset()}>Dismiss</Button>
          )}
          {backfillOp.isInterrupted && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => backfillOp.reset()}>Dismiss</Button>
          )}
        </div>
        {/* Progress indicators */}
        {(reprocessActive || reprocessOp.state.status === "completed") && rp && (
          <p className="text-xs text-muted-foreground mt-2">
            {reprocessActive ? "Reprocessing: " : "✓ Reprocessed: "}
            {(rp.updated as number)?.toLocaleString()} / {(rp.total as number)?.toLocaleString()}
          </p>
        )}
        {(backfillActive || bp.status === "completed") && bp.progress && (
          <p className="text-xs text-muted-foreground mt-2">
            {backfillActive ? "Backfilling… " : "✓ "}
            {(bp.progress.assets_updated as number)?.toLocaleString()} assets, {(bp.progress.groups_updated as number)?.toLocaleString()} groups updated
          </p>
        )}
        {reprocessOp.state.status === "failed" && (
          <p className="text-xs text-destructive mt-2">Reprocess failed: {reprocessOp.state.error}</p>
        )}
        {backfillOp.state.status === "failed" && (
          <p className="text-xs text-destructive mt-2">Backfill failed: {backfillOp.state.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
