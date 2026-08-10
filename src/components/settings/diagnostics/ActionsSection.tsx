import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  RefreshCw, Loader2, FileSearch, Sparkles, Stethoscope, Wrench, Download, Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CURRENT_APP } from "@/lib/app-mode";
import type { RequestOpFn } from "./types";
import { OP_NAMES } from "./types";
import { formatDuration, formatEta, calcRate } from "./progress-utils";

export function ActionsSection({ onRefresh, requestOp }: { onRefresh: () => void; requestOp: RequestOpFn }) {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const reprocessOp = usePersistentOperation("reprocess-metadata");
  const backfillOp = usePersistentOperation("backfill-sku-names");

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

  const repairPropertyNamesMutation = useMutation({
    mutationFn: () => call("repair-invalid-property-names"),
    onSuccess: (data) => {
      toast.success(`Repaired ${data.assets_repaired} assets and ${data.groups_repaired} style groups`);
      onRefresh();
    },
    onError: (e) => toast.error(`Repair failed: ${e.message}`),
  });

  const [manifestDownloading, setManifestDownloading] = useState(false);
  const [isPurgingExcluded, setIsPurgingExcluded] = useState(false);

  async function downloadManifest() {
    setManifestDownloading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const url = `${CURRENT_APP.supabaseUrl}/functions/v1/export-thumbnail-manifest`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: CURRENT_APP.supabaseAnonKey,
        },
      });

      if (!res.ok) {
        const text = await res.text();
        let message = "Failed to export manifest";
        try { const j = JSON.parse(text); message = j.error || message; } catch { /* use default */ }
        throw new Error(message);
      }

      const rowCount = res.headers.get("X-Row-Count") || "?";
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "thumbnail_manifest.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);

      toast.success(`Thumbnail manifest downloaded — ${Number(rowCount).toLocaleString()} rows`);
    } catch (e: any) {
      toast.error(e.message || "Manifest download failed");
    } finally {
      setManifestDownloading(false);
    }
  }

  async function handlePurgeExcludedSubfolders() {
    if (!confirm(
      "This will remove all assets ingested from '_old' or 'SAMPLE' subfolders. " +
      "Empty style groups will be deleted. This cannot be undone. Continue?"
    )) return;
    setIsPurgingExcluded(true);
    let totalPurged = 0;
    let totalGroupsRemoved = 0;
    let totalGroupsUpdated = 0;
    try {
      while (true) {
        const result = await call("purge-excluded-subfolder-assets");
        totalPurged += result.assets_purged ?? 0;
        totalGroupsRemoved += result.groups_removed ?? 0;
        totalGroupsUpdated += result.groups_updated ?? 0;
        if (result.done) break;
      }
      toast.success(
        `Removed ${totalPurged.toLocaleString()} assets from _old/_SAMPLE folders. ` +
        `Deleted ${totalGroupsRemoved} empty groups, updated ${totalGroupsUpdated} groups.`
      );
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
    } catch (e: any) {
      toast.error(e.message || "Purge failed");
    } finally {
      setIsPurgingExcluded(false);
    }
  }

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
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
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
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm" className="gap-1.5 text-warning"
                  onClick={() => {
                    if (confirm("This will null out property_name for assets where it's incorrectly set to 'CREATURE' or 'CR'. Continue?")) {
                      repairPropertyNamesMutation.mutate();
                    }
                  }}
                  disabled={repairPropertyNamesMutation.isPending}
                >
                  {repairPropertyNamesMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                  Repair Property Names
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[280px] text-center">Nulls out invalid property_name values (like CREATURE) for assets and style groups. Safe to re-run.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm" className="gap-1.5 text-destructive"
                  onClick={handlePurgeExcludedSubfolders}
                  disabled={isPurgingExcluded}
                >
                  {isPurgingExcluded ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  {isPurgingExcluded ? "Purging…" : "Purge _old / SAMPLE Assets"}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[280px] text-center">Removes all ingested assets whose path contains a subfolder named _old or SAMPLE (any case). Empty style groups are deleted.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm" className="gap-1.5"
                  onClick={downloadManifest}
                  disabled={manifestDownloading}
                >
                  {manifestDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Download Thumbnail Manifest
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[280px] text-center">Exports a CSV of all assets with thumbnails (old_asset_id, relative_path, filename, quick_hash, thumbnail_url) for migration.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {reprocessOp.isInterrupted && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => reprocessOp.reset()}>Dismiss</Button>
          )}
          {backfillOp.isInterrupted && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => backfillOp.reset()}>Dismiss</Button>
          )}
        </div>

        {/* Reprocess Metadata progress */}
        {(reprocessActive || reprocessOp.state.status === "completed" || reprocessOp.state.status === "failed") && rp && (() => {
          const checked = (rp.assets_checked as number) || 0;
          const updated = (rp.updated as number) || 0;
          const unresolvedLicensor = (rp.unresolved_licensor as number) || 0;
          const unresolvedProperty = (rp.unresolved_property as number) || 0;
          const grandTotal = (rp.grand_total as number) || 0;
          const pct = grandTotal > 0 ? Math.min(100, Math.round((checked / grandTotal) * 100)) : null;
          const elapsedMs = reprocessOp.state.started_at
            ? Date.now() - new Date(reprocessOp.state.started_at).getTime()
            : 0;
          const rate = calcRate(checked, elapsedMs);

          return (
            <div className="space-y-2 mt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-medium">
                  {reprocessActive ? "Reprocessing metadata…"
                    : reprocessOp.state.status === "completed" ? "✓ Reprocess complete"
                    : "✗ Reprocess failed"}
                </span>
                {elapsedMs > 0 && (
                  <span className="text-muted-foreground tabular-nums">
                    Elapsed: {formatDuration(elapsedMs)}
                  </span>
                )}
              </div>

              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Assets examined</span>
                <span className="text-foreground font-medium tabular-nums">
                  {checked.toLocaleString()}
                  {grandTotal > 0 ? ` / ${grandTotal.toLocaleString()}` : ""}
                  {pct !== null
                    ? <span className="text-muted-foreground ml-1">({pct}%)</span>
                    : null}
                </span>
              </div>

              {pct !== null && (
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }} />
                </div>
              )}

              {rate !== null && grandTotal > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{Math.round(rate).toLocaleString()} assets/min</span>
                  <span>ETA: {formatEta(grandTotal - checked, rate)}</span>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Records updated: <span className="text-foreground font-medium">{updated.toLocaleString()}</span>
                {checked > 0 && updated > 0 && (
                  <span className="ml-1">({Math.round((updated / checked) * 100)}% needed changes)</span>
                )}
              </div>
              {(unresolvedLicensor > 0 || unresolvedProperty > 0) && (
                <div className="text-xs text-[hsl(var(--warning))] font-medium">
                  Missing authoritative licensing: {unresolvedLicensor.toLocaleString()} licensors · {unresolvedProperty.toLocaleString()} properties
                </div>
              )}
            </div>
          );
        })()}

        {reprocessOp.state.status === "failed" && (
          <p className="text-xs text-destructive mt-2">Reprocess failed: {reprocessOp.state.error}</p>
        )}

        {/* Backfill SKU Names progress */}
        {(backfillActive || bp.status === "completed" || bp.status === "failed") && (() => {
          const elapsedMs = backfillOp.state.started_at
            ? Date.now() - new Date(backfillOp.state.started_at).getTime()
            : 0;
          const assetsUpdated = (bp.progress?.assets_updated as number) || 0;
          const groupsUpdated = (bp.progress?.groups_updated as number) || 0;
          const assetsChecked = (bp.progress?.assets_checked as number) || 0;

          return (
            <div className="space-y-1.5 mt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-medium">
                  {backfillActive
                    ? "Backfilling SKU names… (scans up to 10,000 assets)"
                    : bp.status === "completed" ? "✓ Backfill complete"
                    : "✗ Backfill failed"}
                </span>
                {elapsedMs > 0 && (
                  <span className="text-muted-foreground tabular-nums">
                    Elapsed: {formatDuration(elapsedMs)}
                  </span>
                )}
              </div>
              {backfillActive && (
                <p className="text-xs text-muted-foreground">
                  This operation runs as a single pass — results will appear when complete.
                </p>
              )}
              {(assetsChecked > 0 || assetsUpdated > 0) && (
                <div className="flex gap-4 text-xs text-muted-foreground">
                  {assetsChecked > 0 && (
                    <span>Examined: <span className="text-foreground font-medium">{assetsChecked.toLocaleString()}</span></span>
                  )}
                  <span>Assets updated: <span className="text-foreground font-medium">{assetsUpdated.toLocaleString()}</span></span>
                  <span>Groups updated: <span className="text-foreground font-medium">{groupsUpdated.toLocaleString()}</span></span>
                </div>
              )}
            </div>
          );
        })()}

        {backfillOp.state.status === "failed" && (
          <p className="text-xs text-destructive mt-2">Backfill failed: {backfillOp.state.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
