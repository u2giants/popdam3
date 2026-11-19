import { MAX_BATCH_LOOPS } from "./render-settings";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RotateCcw, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format-date";
import { useAdminApi } from "@/hooks/useAdminApi";
import { parseFailedRenderMethods } from "@/lib/render-failure-methods";

// ── SG Render Jobs Table ────────────────────────────────────────────

type SgStatusFilter = "all" | "pending" | "completed" | "failed";

type SgRenderJob = {
  id: string;
  style_guide_file_id: string;
  status: string;
  error_message: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
  attempts: number;
  style_guide_files?: {
    relative_path: string | null;
    file_extension: string | null;
  } | null;
};

function getSgRenderStatusTooltip(job: SgRenderJob): string {
  const status = job.status;
  const rawError = (job.error_message ?? "").trim();

  if (status === "pending" || status === "claimed") {
    return "Not finished yet — this job is still queued or currently being processed.";
  }
  if (status === "completed") return "Render succeeded.";
  if (status === "failed") {
    if (!rawError) return "Render failed with no detailed error message.";
    const details = rawError.replace(/^render_failed:\s*/i, "");
    const failedMethods = parseFailedRenderMethods(details);
    if (failedMethods.length === 0) return `Render failed: ${details}`;
    const pretty = failedMethods.map((m) => {
      if (m === "sharp") return "Sharp";
      if (m === "ghostscript") return "Ghostscript";
      if (m === "imagemagick") return "ImageMagick";
      if (m === "inkscape") return "Inkscape";
      return m;
    });
    return `Render failed. Attempted: ${pretty.join(" → ")}.`;
  }
  return `Status: ${status}`;
}

export function SgRenderJobsTable({
  queueStats,
}: {
  queueStats: { pending: number; claimed: number; completed: number; failed: number } | undefined;
}) {
  const queryClient = useQueryClient();
  const { call } = useAdminApi();
  const [statusFilter, setStatusFilter] = useState<SgStatusFilter>("failed");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const COLLAPSED_LIMIT = 20;

  const { data: jobs = [], isLoading, refetch } = useQuery({
    queryKey: ["popsg", "sg_render_jobs", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("style_guide_render_queue")
        .select("*, style_guide_files(relative_path, file_extension)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (statusFilter !== "all") {
        q = q.eq("status", statusFilter);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SgRenderJob[];
    },
    refetchInterval: 10_000,
  });

  const clearFailedMutation = useMutation({
    mutationFn: () => call("clear-failed-sg-renders"),
    onSuccess: () => {
      toast.success("Failed render jobs cleared");
      queryClient.invalidateQueries({ queryKey: ["popsg", "sg_render_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["popsg", "render_queue_stats"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const requeueMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from("style_guide_render_queue")
        .update({
          status: "pending",
          error_message: null,
          completed_at: null,
          claimed_at: null,
          claimed_by: null,
        })
        .eq("id", jobId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Job requeued");
      queryClient.invalidateQueries({ queryKey: ["popsg", "sg_render_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["popsg", "render_queue_stats"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const requeueAllFailedMutation = useMutation({
    mutationFn: async () => {
      // Loop in 500-row batches — proxy statement timeout applies per call (KNOWN_QUIRKS #33).
      let total = 0;
      for (let batch = 0; ; batch++) {
        if (batch >= MAX_BATCH_LOOPS) throw new Error("Stopped after too many batches; run it again to continue.");
        const { data, error } = await supabase.rpc("requeue_all_failed_sg_jobs", { p_limit: 500 });
        if (error) throw error;
        const count = data as number;
        total += count;
        if (count === 0) break;
      }
      return total;
    },
    onSuccess: (count) => {
      toast.success(`${count.toLocaleString()} jobs requeued`);
      queryClient.invalidateQueries({ queryKey: ["popsg", "sg_render_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["popsg", "render_queue_stats"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const pendingCount = (queueStats?.pending ?? 0) + (queueStats?.claimed ?? 0);
  const failedCount = queueStats?.failed ?? 0;
  const completedCount = queueStats?.completed ?? 0;
  const totalCount = pendingCount + failedCount + completedCount;

  const tabs: { key: SgStatusFilter; label: string; count?: number }[] = [
    { key: "all", label: "All", count: totalCount },
    { key: "pending", label: "Pending", count: pendingCount },
    { key: "completed", label: "Completed", count: completedCount },
    { key: "failed", label: "Failed", count: failedCount },
  ];

  const visibleJobs = showAll ? jobs : jobs.slice(0, COLLAPSED_LIMIT);
  const hasMore = jobs.length > COLLAPSED_LIMIT;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Render Job History</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Counts job attempts — one file can appear multiple times. See Preview Coverage above for per-file stats.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {statusFilter === "failed" && failedCount > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => requeueAllFailedMutation.mutate()}
                disabled={requeueAllFailedMutation.isPending}
                title={requeueAllFailedMutation.isPending ? "Requeueing…" : undefined}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {requeueAllFailedMutation.isPending ? "Requeueing…" : "Requeue All Failed"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive"
                onClick={() => clearFailedMutation.mutate()}
                disabled={clearFailedMutation.isPending}
                title={clearFailedMutation.isPending ? "Clearing…" : undefined}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {clearFailedMutation.isPending ? "Clearing…" : "Clear Failed"}
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-1 border-b border-border pb-2">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              variant={statusFilter === tab.key ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => { setStatusFilter(tab.key); setShowAll(false); setExpandedJobId(null); }}
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
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {statusFilter === "failed" ? "No failed jobs." : "No jobs found."}
          </p>
        ) : (
          <TooltipProvider>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">File</th>
                    <th className="px-3 py-1.5 text-left font-medium">Status</th>
                    <th className="px-3 py-1.5 text-left font-medium">Created</th>
                    <th className="px-3 py-1.5 text-left font-medium">Completed</th>
                    <th className="px-3 py-1.5 text-left font-medium">Attempts</th>
                    <th className="px-3 py-1.5 text-left font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => {
                    const isFailed = job.status === "failed";
                    const isExpanded = expandedJobId === job.id;
                    const filename =
                      job.style_guide_files?.relative_path?.split("/").pop() ?? "—";
                    const fullPath = job.style_guide_files?.relative_path ?? "";

                    return (
                      <>
                        <tr
                          key={job.id}
                          className={`border-t border-border ${isFailed ? "cursor-pointer hover:bg-destructive/5" : "hover:bg-muted/30"}`}
                          onClick={() => isFailed && setExpandedJobId(isExpanded ? null : job.id)}
                        >
                          <td className="px-3 py-1.5 font-mono max-w-[280px] truncate" title={fullPath}>
                            {filename}
                          </td>
                          <td className="px-3 py-1.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant={
                                    job.status === "completed" ? "default" :
                                    job.status === "failed" ? "destructive" :
                                    "secondary"
                                  }
                                >
                                  {job.status}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[360px]">
                                {getSgRenderStatusTooltip(job)}
                              </TooltipContent>
                            </Tooltip>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {job.created_at ? formatDateTime(job.created_at) : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {job.completed_at ? formatDateTime(job.completed_at) : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                            {job.attempts}
                          </td>
                          <td className="px-3 py-1.5">
                            {isFailed && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      requeueMutation.mutate(job.id);
                                    }}
                                    disabled={requeueMutation.isPending}
                                    title="Requeue this job"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Requeue this job</TooltipContent>
                              </Tooltip>
                            )}
                          </td>
                        </tr>
                        {isFailed && isExpanded && (
                          <tr key={`${job.id}-error`}>
                            <td colSpan={6} className="bg-destructive/5 border-l-2 border-destructive/60 px-3 py-2">
                              {job.error_message ? (
                                <p className="text-xs text-destructive font-mono whitespace-pre-wrap">
                                  {job.error_message}
                                </p>
                              ) : (
                                <p className="text-xs text-muted-foreground italic">No error message recorded.</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
              {showAll
                ? `Collapse to ${COLLAPSED_LIMIT} rows`
                : `Show all ${jobs.length.toLocaleString()} jobs`}
            </Button>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          Click a failed row to see the full error message. Auto-refreshes every 10 s.
        </p>
      </CardContent>
    </Card>
  );
}
