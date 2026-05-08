import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ExternalLink, Eye, EyeOff, RotateCw, RotateCcw, Save, RefreshCw, Trash2, Settings,
  CheckCircle2, Clock, AlertCircle, FileX,
} from "lucide-react";
import { toast } from "sonner";
import { CURRENT_APP } from "@/lib/app-mode";
import { formatDateTime } from "@/lib/format-date";
import { useCrawlProgress } from "@/hooks/useCrawlProgress";
import { useCrawlLifecycle } from "@/hooks/useCrawlLifecycle";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { useAdminApi } from "@/hooks/useAdminApi";
import {
  WindowsAgentStatus,
  AgentRemoteControls,
  AgentLogTail,
} from "@/components/settings/WindowsAgentTab";
import { UsersSection, InvitationSection } from "@/components/settings/UsersTab";

// ── Helpers ─────────────────────────────────────────────────────────

function formatSgThumbnailError(raw: string): string {
  if (!raw) return "Unknown error";
  if (raw === "no_pdf_compat") return "AI file saved without PDF compatibility";
  if (raw === "no_preview_or_render_failed") return "All render methods failed";
  if (raw.startsWith("Skipped:")) return raw;
  const match = raw.match(/^render_failed:\s*(.+)$/i);
  if (match) {
    const methods = match[1].split("|").map((p) => p.split(":")[0]?.trim()).filter(Boolean);
    return `Render failed (tried: ${methods.join(" → ")})`;
  }
  return raw.length > 120 ? raw.slice(0, 120) + "…" : raw;
}

// ── SG Render Errors Table ──────────────────────────────────────────

type SgErroredFile = {
  id: string;
  relative_path: string | null;
  file_extension: string | null;
  thumbnail_error: string | null;
};

function SgRenderErrorsTable({ totalErrored }: { totalErrored?: number }) {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const COLLAPSED_LIMIT = 20;

  const { data: erroredFiles = [], isLoading, refetch } = useQuery({
    queryKey: ["popsg", "sg_errored_files"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("style_guide_files")
        .select("id, relative_path, file_extension, thumbnail_error")
        .eq("is_active", true)
        .is("thumbnail_url", null)
        .not("thumbnail_error", "is", null)
        .order("thumbnail_error")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as SgErroredFile[];
    },
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["popsg", "sg_errored_files"] });
    queryClient.invalidateQueries({ queryKey: ["popsg", "preview_stats"] });
    queryClient.invalidateQueries({ queryKey: ["popsg", "render_queue_stats"] });
  };

  const retryOneMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const { error } = await supabase.rpc("retry_sg_render_errors", { p_file_ids: [fileId] });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("File requeued for rendering"); invalidate(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const retryAllMutation = useMutation({
    mutationFn: async () => {
      let total = 0;
      // Loop in batches of 500 — each call is bounded so it completes within
      // the DB proxy's statement timeout. Stops when the function returns 0.
      while (true) {
        const { data, error } = await supabase.rpc("retry_sg_render_errors", { p_limit: 500 });
        if (error) throw error;
        const queued = data as number;
        total += queued;
        if (queued === 0) break;
      }
      return total;
    },
    onSuccess: (count) => { toast.success(`${count} files requeued`); invalidate(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const visibleFiles = showAll ? erroredFiles : erroredFiles.slice(0, COLLAPSED_LIMIT);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Files with Render Errors</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Queried from the files table — persists even after failed jobs are cleared from the queue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {erroredFiles.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => retryAllMutation.mutate()}
              disabled={retryAllMutation.isPending}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {retryAllMutation.isPending ? "Requeueing…" : `Retry All (${(totalErrored ?? erroredFiles.length).toLocaleString()})`}
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : erroredFiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No render errors.</p>
        ) : (
          <>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">File</th>
                    <th className="px-3 py-1.5 text-left font-medium">Type</th>
                    <th className="px-3 py-1.5 text-left font-medium">Error</th>
                    <th className="px-3 py-1.5 text-left font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {visibleFiles.map((f) => (
                    <tr key={f.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-1.5 font-mono max-w-[260px] truncate" title={f.relative_path ?? ""}>
                        {f.relative_path?.split("/").pop() ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground uppercase">
                        {f.file_extension ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-destructive max-w-[300px] truncate" title={f.thumbnail_error ?? ""}>
                        {formatSgThumbnailError(f.thumbnail_error ?? "")}
                      </td>
                      <td className="px-3 py-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Retry this file"
                          onClick={() => retryOneMutation.mutate(f.id)}
                          disabled={retryOneMutation.isPending}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {erroredFiles.length > COLLAPSED_LIMIT && (
              <div className="flex justify-center pt-2">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground"
                  onClick={() => setShowAll(!showAll)}>
                  {showAll ? `Collapse to ${COLLAPSED_LIMIT} rows` : `Show all ${erroredFiles.length.toLocaleString()} files`}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

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
    const failedMethods = details
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split(":")[0]?.trim().toLowerCase())
      .filter(Boolean);
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

function SgRenderJobsTable({
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
      while (true) {
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

// ── Main Page ───────────────────────────────────────────────────────

export default function PopSGSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "setup";
  const handleTabChange = useCallback((value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  }, [setSearchParams]);

  const queryClient = useQueryClient();
  const crawlProgress = useCrawlProgress();
  const { crawlTriggered, handleTriggerCrawl } = useCrawlLifecycle(crawlProgress, "trigger-style-guide-crawl");
  const crawlActive = crawlProgress.status === "queued" || crawlProgress.status === "running" || crawlTriggered;

  const agentStatus = useAgentStatus();

  const { data: scanRoots = [] } = useQuery({
    queryKey: ["popsg", "scan_roots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_config")
        .select("value")
        .eq("key", "STYLE_GUIDE_SCAN_ROOTS")
        .maybeSingle();
      if (error) throw error;
      const v = data?.value;
      if (Array.isArray(v)) return v as string[];
      return [];
    },
  });

  const { data: sgNasConfig } = useQuery({
    queryKey: ["popsg", "sg_nas_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_config")
        .select("key,value")
        .in("key", [
          "WINDOWS_AGENT_SG_NAS_HOST",
          "WINDOWS_AGENT_SG_NAS_SHARE",
          "WINDOWS_AGENT_SG_NAS_MOUNT_PATH",
          "WINDOWS_AGENT_SG_NAS_USER",
          "WINDOWS_AGENT_SG_NAS_PASS",
        ]);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        if (typeof row.value === "string") map[row.key] = row.value;
      }
      return map;
    },
  });

  const [sgNasHost, setSgNasHost] = useState("");
  const [sgNasShare, setSgNasShare] = useState("");
  const [sgMountPath, setSgMountPath] = useState("");
  const [sgNasUser, setSgNasUser] = useState("");
  const [sgNasPass, setSgNasPass] = useState("");
  const [showSgPass, setShowSgPass] = useState(false);
  const [sgNasConfigInitialized, setSgNasConfigInitialized] = useState(false);

  useEffect(() => {
    if (sgNasConfig !== undefined && !sgNasConfigInitialized) {
      setSgNasHost(sgNasConfig["WINDOWS_AGENT_SG_NAS_HOST"] ?? "");
      setSgNasShare(sgNasConfig["WINDOWS_AGENT_SG_NAS_SHARE"] ?? "");
      setSgMountPath(sgNasConfig["WINDOWS_AGENT_SG_NAS_MOUNT_PATH"] ?? "");
      setSgNasUser(sgNasConfig["WINDOWS_AGENT_SG_NAS_USER"] ?? "");
      setSgNasPass(sgNasConfig["WINDOWS_AGENT_SG_NAS_PASS"] ?? "");
      setSgNasConfigInitialized(true);
    }
  }, [sgNasConfig, sgNasConfigInitialized]);

  const saveMountPath = useMutation({
    mutationFn: async () => {
      const entries = [
        { key: "WINDOWS_AGENT_SG_NAS_HOST", value: sgNasHost.trim() },
        { key: "WINDOWS_AGENT_SG_NAS_SHARE", value: sgNasShare.trim() },
        { key: "WINDOWS_AGENT_SG_NAS_MOUNT_PATH", value: sgMountPath.trim().replace(/\\+$/, "") },
        { key: "WINDOWS_AGENT_SG_NAS_USER", value: sgNasUser.trim() },
        { key: "WINDOWS_AGENT_SG_NAS_PASS", value: sgNasPass },
      ];
      for (const entry of entries) {
        const { error } = await supabase.from("admin_config").upsert({
          key: entry.key,
          value: entry.value,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Style guide NAS config saved");
      queryClient.invalidateQueries({ queryKey: ["popsg", "sg_nas_config"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const { data: queueStats } = useQuery({
    queryKey: ["popsg", "render_queue_stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_sg_render_queue_stats");
      if (error) throw error;
      return data as { pending: number; claimed: number; completed: number; failed: number };
    },
    refetchInterval: 10_000,
  });

  const { data: previewStats, refetch: refetchPreviewStats, isFetching: previewStatsFetching } = useQuery({
    queryKey: ["popsg", "preview_stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_sg_preview_stats");
      if (error) throw error;
      return data as {
        total_active: number;
        has_preview: number;
        renderable_no_preview: number;
        render_errored: number;
        unsupported: number;
        queued_now: number;
      };
    },
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">{CURRENT_APP.name} Settings</h1>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="render-agent">Render Agent</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>

        {/* ── Setup tab ── */}
        <TabsContent value="setup" className="space-y-6">

          {/* Bridge agent status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bridge Agent</CardTitle>
              <CardDescription className="text-xs">
                The same agent that scans PopDAM also handles PopSG crawls. Managed in PopDAM Settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {agentStatus.bridgeStatus === "none" ? (
                <p className="text-xs text-muted-foreground">No bridge agent registered yet.</p>
              ) : (
                <div className="rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">Name</th>
                        <th className="px-3 py-1.5 text-left font-medium">Status</th>
                        <th className="px-3 py-1.5 text-left font-medium">Last heartbeat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agentStatus.agents
                        .filter((a) => a.agent_type === "bridge")
                        .map((a) => (
                          <tr key={a.id} className="border-t border-border">
                            <td className="px-3 py-1.5 font-medium">{a.agent_name}</td>
                            <td className="px-3 py-1.5">
                              <Badge variant={a.isOnline ? "default" : "outline"}>
                                {a.isOnline ? "online" : "offline"}
                              </Badge>
                            </td>
                            <td className="px-3 py-1.5 text-muted-foreground">
                              {a.last_heartbeat
                                ? formatDateTime(a.last_heartbeat)
                                : "never"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <a href="https://dam.designflow.app/settings" target="_blank" rel="noopener noreferrer">
                  Manage agents in PopDAM <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </CardContent>
          </Card>

          {/* Scan roots */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Style guide scan roots</CardTitle>
              <CardDescription className="text-xs">
                NAS paths the Bridge Agent crawls for style guide files. Stored in{" "}
                <code>admin_config.STYLE_GUIDE_SCAN_ROOTS</code>. Edit via PopDAM admin.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {scanRoots.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  (not configured — default: <code>/nas/styleguides</code>)
                </p>
              ) : (
                <ul className="space-y-1">
                  {scanRoots.map((r) => (
                    <li key={r} className="font-mono text-xs">
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Thumbnail rendering NAS config */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Thumbnail rendering</CardTitle>
              <CardDescription className="text-xs">
                PopSG previews are rendered by the Windows Render Agent (the same one that powers PopDAM thumbnails).
                Set the Windows-visible path to the style guide share so the agent can read the source files.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">NAS Host</label>
                  <Input
                    placeholder="edgesynology2"
                    value={sgNasHost}
                    onChange={(e) => setSgNasHost(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Hostname or IP of the NAS holding style guide files (e.g. <code>edgesynology2</code>).
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">NAS Share name</label>
                  <Input
                    placeholder="styleguides"
                    value={sgNasShare}
                    onChange={(e) => setSgNasShare(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Share name on that host (e.g. <code>styleguides</code>).
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Windows Drive Letter</label>
                  <Input
                    placeholder="Y:"
                    value={sgMountPath}
                    onChange={(e) => setSgMountPath(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Drive letter to map the share to (e.g. <code>Y:</code>). The agent maps it automatically at startup.
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">NAS Username</label>
                  <Input
                    placeholder="popdam"
                    value={sgNasUser}
                    onChange={(e) => setSgNasUser(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">NAS Password</label>
                  <div className="flex gap-2">
                    <Input
                      type={showSgPass ? "text" : "password"}
                      placeholder="password"
                      value={sgNasPass}
                      onChange={(e) => setSgNasPass(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => setShowSgPass((v) => !v)}
                      className="h-9 w-9 shrink-0"
                    >
                      {showSgPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={() => saveMountPath.mutate()}
                disabled={saveMountPath.isPending}
                className="gap-1.5 self-start"
              >
                <Save className="h-3.5 w-3.5" />
                Save
              </Button>

            </CardContent>
          </Card>

          {/* Preview Coverage */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">Preview Coverage</CardTitle>
                <CardDescription className="text-xs">
                  Per-file stats — each file counted once regardless of how many render attempts it took.
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => refetchPreviewStats()}
                disabled={previewStatsFetching}
                title="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${previewStatsFetching ? "animate-spin" : ""}`} />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {!previewStats ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  {/* Progress bar */}
                  {(() => {
                    const pct = previewStats.total_active > 0
                      ? Math.round((previewStats.has_preview / previewStats.total_active) * 1000) / 10
                      : 0;
                    return (
                      <div className="space-y-1.5">
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="font-semibold">
                            {previewStats.has_preview.toLocaleString()}
                            <span className="text-muted-foreground font-normal">
                              {" "}of {previewStats.total_active.toLocaleString()} active files have a preview
                            </span>
                          </span>
                          <span className="font-mono text-base font-bold">{pct}%</span>
                        </div>
                        <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Breakdown rows */}
                  <div className="rounded-md border border-border divide-y divide-border text-sm">
                    {/* Has preview */}
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      <span className="flex-1 text-foreground">Has preview</span>
                      <span className="font-mono font-semibold tabular-nums">
                        {previewStats.has_preview.toLocaleString()}
                      </span>
                    </div>

                    {/* Renderable, no preview */}
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                      <div className="flex-1">
                        <div className="text-foreground">Renderable, no preview yet</div>
                        <div className="text-[11px] text-muted-foreground">
                          pdf / ai / psd files not yet rendered
                          {previewStats.queued_now > 0 && (
                            <> — <span className="text-amber-600 font-medium">{previewStats.queued_now.toLocaleString()} currently in queue</span></>
                          )}
                          {previewStats.queued_now === 0 && previewStats.renderable_no_preview > 0 && (
                            <> — none queued, trigger a crawl to schedule them</>
                          )}
                        </div>
                      </div>
                      <span className="font-mono font-semibold tabular-nums">
                        {previewStats.renderable_no_preview.toLocaleString()}
                      </span>
                    </div>

                    {/* Render errors */}
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                      <div className="flex-1">
                        <div className="text-foreground">Render errors</div>
                        <div className="text-[11px] text-muted-foreground">
                          pdf / ai / psd files where rendering failed — see Render Job History for details
                        </div>
                      </div>
                      <span className={`font-mono font-semibold tabular-nums ${previewStats.render_errored > 0 ? "text-destructive" : ""}`}>
                        {previewStats.render_errored.toLocaleString()}
                      </span>
                    </div>

                    {/* Unsupported */}
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <FileX className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1">
                        <div className="text-foreground">Unsupported format</div>
                        <div className="text-[11px] text-muted-foreground">
                          jpg, png, mp4, etc. — no preview will ever be generated
                        </div>
                      </div>
                      <span className="font-mono font-semibold tabular-nums text-muted-foreground">
                        {previewStats.unsupported.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Crawl trigger */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trigger crawl</CardTitle>
              <CardDescription className="text-xs">
                Sends a crawl request to the Bridge Agent. It picks it up on its next heartbeat (~30 s)
                and submits all discovered style guide files.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleTriggerCrawl}
                  disabled={crawlActive}
                  className="gap-1.5"
                >
                  <RotateCw className={crawlActive ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                  {crawlActive ? "Crawl in progress…" : "Trigger crawl now"}
                </Button>

                {(crawlProgress.status === "completed" || crawlProgress.status === "failed") && crawlProgress.completedAt && (
                  <span className="text-xs text-muted-foreground">
                    Last run: {formatDateTime(crawlProgress.completedAt)}
                    {crawlProgress.status === "completed" && crawlProgress.filesFound != null && (
                      <> — {crawlProgress.filesFound.toLocaleString()} files</>
                    )}
                    {crawlProgress.status === "failed" && (
                      <span className="text-destructive"> — failed</span>
                    )}
                  </span>
                )}
              </div>

              {crawlProgress.status === "failed" && crawlProgress.error && (
                <p className="text-xs text-destructive">{crawlProgress.error}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Render Agent tab ── */}
        <TabsContent value="render-agent" className="space-y-4">
          <WindowsAgentStatus />
          <AgentRemoteControls />
          <AgentLogTail />
          <SgRenderErrorsTable totalErrored={previewStats?.render_errored} />
          <SgRenderJobsTable queueStats={queueStats} />
        </TabsContent>

        {/* ── Users tab ── */}
        <TabsContent value="users" className="space-y-4">
          <UsersSection />
          <InvitationSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
