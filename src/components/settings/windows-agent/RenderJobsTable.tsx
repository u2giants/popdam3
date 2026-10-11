import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useTableFilterSort, FilterableHeaderRow } from "@/components/ui/filterable-table-head";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { formatFilename } from "@/lib/format-filename";
import { ClipboardList, Check, Eye, RefreshCw, Trash2, RotateCcw, Image as ImageIcon } from "lucide-react";
import { formatDuration } from "./shared";

export type StatusFilter = "all" | "pending" | "completed" | "failed";

export function getRenderStatusTooltip(job: Record<string, unknown>): string {
  const status = String(job.status ?? "unknown");
  const rawError = String(job.error_message ?? "").trim();

  if (status === "pending" || status === "claimed") {
    return "Not finished yet — this job is still queued or currently being processed.";
  }

  if (status === "completed") {
    return "Render succeeded. Current logs do not persist which fallback app produced the final thumbnail.";
  }

  if (status === "failed") {
    if (!rawError) return "Render failed with no detailed pipeline message.";
    const details = rawError.replace(/^render_failed:\s*/i, "");
    const failedMethods = details
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.split(":")[0]?.trim().toLowerCase())
      .filter(Boolean);

    if (failedMethods.length === 0) return `Render failed: ${details}`;

    const pretty = failedMethods.map((m) => {
      if (m === "sharp") return "Sharp";
      if (m === "ghostscript") return "Ghostscript";
      if (m === "imagemagick") return "ImageMagick";
      if (m === "inkscape") return "Inkscape";
      if (m === "sibling") return "Sibling image fallback";
      return m;
    });

    return `Render failed. Attempted and failed: ${pretty.join(" → ")}.`;
  }

  return `Status: ${status}`;
}

export function RenderJobsTable() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const COLLAPSED_LIMIT = 10;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["render-queue-recent", statusFilter],
    queryFn: () => call("list-render-jobs", {
      status_filter: statusFilter === "all" ? undefined : statusFilter,
    }),
    refetchInterval: 5_000,
  });

  // Fetch counts for tab badges
  const { data: countData } = useQuery({
    queryKey: ["render-queue-tab-counts"],
    queryFn: () => call("run-query", {
      sql: `SELECT
        COUNT(*) FILTER (WHERE status IN ('pending','claimed')) as pending,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= now() - interval '24 hours') as completed_24h,
        COUNT(*) FILTER (WHERE status = 'failed' AND completed_at >= now() - interval '24 hours') as failed_24h,
        COUNT(*) as total
      FROM render_queue`,
    }),
    refetchInterval: 10_000,
  });

  const tabCounts = countData?.rows?.[0] as Record<string, number> | undefined;

  const clearFailedMutation = useMutation({
    mutationFn: () => call("clear-failed-renders"),
    onSuccess: (data) => {
      toast.success(`Cleared ${data.deleted_count ?? 0} failed jobs`);
      queryClient.invalidateQueries({ queryKey: ["render-queue-recent"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-tab-counts"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const clearJunkMutation = useMutation({
    mutationFn: () => call("clear-junk-render-jobs"),
    onSuccess: (data) => {
      toast.success(`Cleared ${(data.cleared ?? 0).toLocaleString()} junk files from queue`);
      queryClient.invalidateQueries({ queryKey: ["render-queue-recent"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-tab-counts"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const requeueMutation = useMutation({
    mutationFn: (jobId: string) => call("requeue-render-job", { job_id: jobId }),
    onSuccess: () => {
      toast.success("Job requeued");
      queryClient.invalidateQueries({ queryKey: ["render-queue-recent"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-tab-counts"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const requeueAllMutation = useMutation({
    mutationFn: () => call("requeue-all-no-preview"),
    onSuccess: (data) => {
      toast.success(`Queued ${data.queued ?? 0} assets for re-rendering${data.skipped ? ` (${data.skipped} already queued)` : ""}`);
      queryClient.invalidateQueries({ queryKey: ["render-queue-recent"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-tab-counts"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const compatAuditMutation = useMutation({
    mutationFn: () => call("trigger-compat-audit"),
    onSuccess: () => {
      toast.success("Compat audit queued — Windows render agent will OCR all AI thumbnails on next heartbeat");
    },
    onError: (e) => toast.error(e.message),
  });

  const [previewPolling, setPreviewPolling] = useState(false);

  const compatPreviewMutation = useMutation({
    mutationFn: () => call("trigger-compat-audit-preview"),
    onSuccess: () => {
      // Clear the cached result so the stale "completed" status from the previous
      // scan can't trigger the useEffect's stop-polling logic before the fresh
      // "pending" result comes back.
      queryClient.removeQueries({ queryKey: ["compat-audit-preview-result"] });
      setPreviewPolling(true);
      toast.info("Preview requested — Windows render agent will scan all AI thumbnails on next heartbeat (≤30s)");
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: previewResultData } = useQuery({
    queryKey: ["compat-audit-preview-result"],
    queryFn: () => call("get-compat-audit-preview-result"),
    refetchInterval: previewPolling ? 3_000 : false,
  });

  const previewResult = previewResultData?.preview as Record<string, unknown> | null | undefined;
  const previewStatus = previewResult?.status as string | undefined;
  const previewFlagged = (previewResult?.flagged as Array<{ id: string; thumbnail_url: string; relative_path: string }>) ?? [];
  const previewScanned = (previewResult?.scanned as number) ?? 0;

  useEffect(() => {
    if (!previewPolling) return;
    if (previewStatus === "completed" || previewStatus === "error") {
      setPreviewPolling(false);
      if (previewStatus === "error") {
        toast.error(`Preview failed: ${(previewResult?.error as string) ?? "unknown error"}`);
      }
    }
  }, [previewStatus, previewPolling, previewResult?.error]);

  const requeueBrokenMutation = useMutation({
    mutationFn: () => call("requeue-broken-thumbnails"),
    onSuccess: (data) => {
      toast.success(`Queued ${data.queued ?? 0} broken-thumbnail assets for re-rendering${data.skipped ? ` (${data.skipped} already queued)` : ""}`);
      queryClient.invalidateQueries({ queryKey: ["render-queue-recent"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-tab-counts"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const jobs: Record<string, unknown>[] = data?.jobs || [];

  // Filterable/sortable columns for render jobs
  const renderCols: import("@/components/ui/filterable-table-head").ColumnDef[] = [
    { key: "filename", label: "Filename", sortable: true, filterable: true },
    { key: "status", label: "Status", sortable: true, filterable: true },
    { key: "created_at", label: "Created", sortable: true },
    { key: "completed_at", label: "Completed", sortable: true },
    { key: "duration", label: "Duration", sortable: true },
  ];

  const getRenderCell = useCallback((job: Record<string, unknown>, key: string): string => {
    switch (key) {
      case "filename": return (job.filename as string) || "";
      case "status": return (job.status as string) || "";
      case "created_at": return job.created_at ? new Date(job.created_at as string).toLocaleString() : "";
      case "completed_at": return job.completed_at ? new Date(job.completed_at as string).toLocaleString() : "";
      case "duration":
        if (job.completed_at && job.created_at) return formatDuration(job.created_at as string, job.completed_at as string);
        return "";
      default: return "";
    }
  }, []);

  const {
    processed: filteredJobs,
    sortKey,
    sortDir,
    filters,
    suggestions,
    toggleSort,
    setFilter,
    clearFilter,
    hasActiveFilters,
  } = useTableFilterSort(jobs, renderCols, getRenderCell, { key: "created_at", dir: "desc" });

  const visibleJobs = showAll ? filteredJobs : filteredJobs.slice(0, COLLAPSED_LIMIT);
  const hasMore = filteredJobs.length > COLLAPSED_LIMIT;

  const pendingCount = Number(tabCounts?.pending ?? 0);
  const completed24h = Number(tabCounts?.completed_24h ?? 0);
  const failed24h = Number(tabCounts?.failed_24h ?? 0);
  const totalCount = Number(tabCounts?.total ?? 0);

  const tabs: { key: StatusFilter; label: string; count?: number }[] = [
    { key: "all", label: "All", count: totalCount },
    { key: "pending", label: "Pending", count: pendingCount },
    { key: "completed", label: "Completed (24h)", count: completed24h },
    { key: "failed", label: "Failed (24h)", count: failed24h },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardList className="h-4 w-4" /> Render Jobs
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              if (window.confirm("This will re-queue every asset that has no preview for the Windows Agent to retry. Continue?")) {
                requeueAllMutation.mutate();
              }
            }}
            disabled={requeueAllMutation.isPending} title={requeueAllMutation.isPending ? "Requeueing…" : undefined}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {requeueAllMutation.isPending ? "Queueing..." : "Requeue All No-Preview"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              if (window.confirm("Re-queue assets whose thumbnails are missing from storage (403/404 errors). Their broken thumbnail URLs will be cleared and they will be re-rendered by the Windows Agent. Continue?")) {
                requeueBrokenMutation.mutate();
              }
            }}
            disabled={requeueBrokenMutation.isPending} title={requeueBrokenMutation.isPending ? "Queueing…" : undefined}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {requeueBrokenMutation.isPending ? "Queueing..." : "Requeue Broken Thumbnails"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => compatPreviewMutation.mutate()}
            disabled={compatPreviewMutation.isPending || previewPolling}
            title={previewPolling ? "Waiting for Windows render agent…" : undefined}
          >
            <Eye className="h-3.5 w-3.5" />
            {previewPolling ? "Scanning…" : "Preview AI Compat Thumbnails"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              if (window.confirm("Audit all AI files that have thumbnails. The Windows render agent will OCR each thumbnail to detect the Illustrator 'no PDF compatibility' placeholder page and clear any it finds. They will be re-queued for proper rendering. Continue?")) {
                compatAuditMutation.mutate();
              }
            }}
            disabled={compatAuditMutation.isPending} title={compatAuditMutation.isPending ? "Queuing audit…" : undefined}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {compatAuditMutation.isPending ? "Queuing..." : "Audit AI Compat Thumbnails"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => clearJunkMutation.mutate()}
            disabled={clearJunkMutation.isPending} title={clearJunkMutation.isPending ? "Clearing…" : undefined}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {clearJunkMutation.isPending ? "Clearing..." : "Clear Junk Files"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive"
            onClick={() => clearFailedMutation.mutate()}
            disabled={clearFailedMutation.isPending} title={clearFailedMutation.isPending ? "Clearing…" : undefined}
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear Failed
          </Button>
          <Button variant="ghost" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Compat audit preview results — shown inline when a scan is running or has completed */}
        {(previewPolling || previewStatus === "completed" || previewStatus === "processing" || previewStatus === "scanning" || previewStatus === "error") && (() => {
          const claimedAt = previewResult?.claimed_at as string | undefined;
          const processingMs = claimedAt ? Date.now() - new Date(claimedAt).getTime() : 0;
          // Only flag as stale during the initial "processing" state (before first batch update).
          // "scanning" means the agent is actively sending progress — not stale.
          const isStale = previewStatus === "processing" && processingMs > 3 * 60 * 1000;

          const isScanning = previewPolling || previewStatus === "processing" || previewStatus === "scanning";

          return (
          <div className="border border-border rounded-md p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">AI Compat Thumbnail Preview</p>
                {isStale ? (
                  <p className="text-xs text-warning">Scan timed out — Windows render agent may be unavailable or crashed. Check agent status above. The scan will auto-retry on next heartbeat (≤5 min).</p>
                ) : previewStatus === "scanning" ? (
                  <p className="text-xs text-muted-foreground">
                    Scanning… {previewScanned} assets checked, <strong>{previewFlagged.length}</strong> placeholder{previewFlagged.length !== 1 ? "s" : ""} found so far
                  </p>
                ) : isScanning ? (
                  <p className="text-xs text-muted-foreground">Windows agent is scanning all AI source files… (may take a minute for large libraries)</p>
                ) : previewStatus === "error" ? (
                  <p className="text-xs text-destructive">
                    Scan failed after {previewScanned} assets — {(previewResult?.error as string) ?? "unknown error"}
                    {previewFlagged.length > 0 ? `. Partial results: ${previewFlagged.length} placeholder${previewFlagged.length !== 1 ? "s" : ""} found.` : ""}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Scanned {previewScanned} AI assets — found <strong>{previewFlagged.length}</strong> placeholder thumbnail{previewFlagged.length !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
              {previewStatus === "completed" && previewFlagged.length > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  onClick={() => {
                    if (window.confirm(`Clear ${previewFlagged.length} placeholder thumbnail${previewFlagged.length !== 1 ? "s" : ""}? The Windows render agent will clear the flagged thumbnails so they get re-queued for proper rendering.`)) {
                      compatAuditMutation.mutate();
                    }
                  }}
                  disabled={compatAuditMutation.isPending}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {compatAuditMutation.isPending ? "Queueing…" : "Run Full Audit"}
                </Button>
              )}
            </div>

            {isScanning && previewFlagged.length === 0 ? (
              <div className="grid grid-cols-6 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="aspect-square bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : previewFlagged.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <ImageIcon className="h-4 w-4 opacity-40 shrink-0" />
                <span>No placeholder thumbnails detected across all {previewScanned} AI assets — the full audit should be safe to run.</span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {isScanning ? "Placeholder thumbnails found so far" : "These"} show the Illustrator "no PDF compatibility" warning page instead of real artwork:
                </p>
                <div className="grid grid-cols-6 gap-2 max-h-72 overflow-y-auto pr-1">
                  {previewFlagged.map((item) => (
                    <div key={item.id} className="space-y-1">
                      <div className="aspect-square bg-muted rounded overflow-hidden border border-border">
                        <img
                          src={item.thumbnail_url}
                          alt={item.relative_path}
                          className="w-full h-full object-contain"
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      </div>
                      <p className="text-[9px] text-muted-foreground truncate leading-tight" title={item.relative_path}>
                        {item.relative_path.split("/").pop()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          );
        })()}

        {/* Status filter tabs */}
        <div className="flex gap-1 border-b border-border pb-2">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              variant={statusFilter === tab.key ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => { setStatusFilter(tab.key); setShowAll(false); }}
            >
              {tab.label}
              {tab.count !== undefined && (
                <Badge
                  variant={statusFilter === tab.key ? "secondary" : "outline"}
                  className={`text-[10px] h-4 min-w-[1.5rem] px-1 justify-center ${
                    tab.key === "failed" && tab.count > 0 ? "text-destructive border-destructive/30" : ""
                  }`}
                >
                  {tab.count.toLocaleString()}
                </Badge>
              )}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No render jobs found.</p>
        ) : (
          <TooltipProvider>
            <Table>
              <TableHeader>
                <FilterableHeaderRow
                  columns={renderCols}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  filters={filters}
                  suggestions={suggestions}
                  onSort={toggleSort}
                  onFilter={setFilter}
                  onClearFilter={clearFilter}
                  prefixCells={[{ header: null, filter: null }]}
                  suffixCells={[{ header: null, filter: null }]}
                />
              </TableHeader>
              <TableBody>
                {visibleJobs.map((job: Record<string, unknown>) => {
                  const jobId = job.id as string;
                  const isFailed = job.status === "failed";
                  const isExpanded = expandedJobId === jobId;
                  const hasThumbnail = !!job.thumbnail_url;
                  const duration = job.completed_at && job.created_at
                    ? formatDuration(job.created_at as string, job.completed_at as string)
                    : "—";

                  return (
                    <>
                      <TableRow
                        key={jobId}
                        className={isFailed ? "cursor-pointer hover:bg-destructive/5" : ""}
                        onClick={() => isFailed && setExpandedJobId(isExpanded ? null : jobId)}
                      >
                        <TableCell className="p-1">
                          {hasThumbnail ? (
                            <img
                              src={job.thumbnail_url as string}
                              alt=""
                              className="h-8 w-8 rounded object-cover border border-border"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded border border-border bg-muted flex items-center justify-center">
                              <ImageIcon className="h-3 w-3 text-muted-foreground" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[200px]" title={job.filename as string || ""}>{formatFilename(job.filename as string || "—", 24)}</TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant={
                                  job.status === "completed" ? "default" :
                                  job.status === "failed" ? "destructive" :
                                  "secondary"
                                }
                              >
                                {job.status as string}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-[360px]">
                              {getRenderStatusTooltip(job)}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {job.created_at ? new Date(job.created_at as string).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {job.completed_at ? new Date(job.completed_at as string).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {duration}
                        </TableCell>
                        <TableCell className="p-1">
                          {isFailed && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    requeueMutation.mutate(jobId);
                                  }}
                                  disabled={requeueMutation.isPending} title={requeueMutation.isPending ? "Requeueing…" : undefined}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Requeue this job</TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                      </TableRow>
                      {isFailed && isExpanded && job.error_message && (
                        <TableRow key={`${jobId}-error`}>
                          <TableCell colSpan={7} className="bg-destructive/5 border-l-2 border-destructive">
                            <p className="text-xs text-destructive font-mono whitespace-pre-wrap">
                              {job.error_message as string}
                            </p>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </TooltipProvider>
        )}
        {!isLoading && hasMore && (
          <div className="flex justify-center pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? `Collapse to ${COLLAPSED_LIMIT} rows` : `Show all ${jobs.length} jobs`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 5: Render Policy ────────────────────────────────────────
