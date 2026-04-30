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
} from "lucide-react";
import { toast } from "sonner";
import { CURRENT_APP } from "@/lib/app-mode";
import { useCrawlProgress } from "@/hooks/useCrawlProgress";
import { useCrawlLifecycle } from "@/hooks/useCrawlLifecycle";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import {
  WindowsAgentStatus,
  AgentRemoteControls,
  AgentLogTail,
} from "@/components/settings/WindowsAgentTab";
import { UsersSection, InvitationSection } from "@/components/settings/UsersTab";

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
    mutationFn: async () => {
      const { error } = await supabase
        .from("style_guide_render_queue")
        .delete()
        .eq("status", "failed");
      if (error) throw error;
    },
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
      const { error } = await supabase
        .from("style_guide_render_queue")
        .update({
          status: "pending",
          error_message: null,
          completed_at: null,
          claimed_at: null,
          claimed_by: null,
        })
        .eq("status", "failed");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("All failed jobs requeued");
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
        <CardTitle className="text-base">Render Jobs</CardTitle>
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
                            {job.created_at ? new Date(job.created_at).toLocaleString() : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {job.completed_at ? new Date(job.completed_at).toLocaleString() : "—"}
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
                                ? new Date(a.last_heartbeat).toLocaleString()
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

              {queueStats && (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Render queue summary
                  </p>
                  <div className="grid grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-muted-foreground">Pending</div>
                      <div className="font-mono text-sm font-semibold">{queueStats.pending.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">In flight</div>
                      <div className="font-mono text-sm font-semibold">{queueStats.claimed.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Done</div>
                      <div className="font-mono text-sm font-semibold text-success">
                        {queueStats.completed.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Failed</div>
                      <div className="font-mono text-sm font-semibold text-destructive">
                        {queueStats.failed.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    See Render Agent tab for job details and failure reasons.
                  </p>
                </div>
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
                    Last run: {new Date(crawlProgress.completedAt).toLocaleString()}
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
