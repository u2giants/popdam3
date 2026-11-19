import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, Eye, EyeOff, RotateCw, Save, RefreshCw, Settings, CheckCircle2, Clock, AlertCircle, FileX, FileText, Tags } from "lucide-react";
import { toast } from "sonner";
import { CURRENT_APP } from "@/lib/app-mode";
import { formatDateTime } from "@/lib/format-date";
import { useCrawlProgress } from "@/hooks/useCrawlProgress";
import { useCrawlLifecycle } from "@/hooks/useCrawlLifecycle";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { useAdminApi } from "@/hooks/useAdminApi";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { WindowsAgentStatus, AgentRemoteControls, AgentLogTail } from "@/components/settings/WindowsAgentTab";
import { UsersSection, InvitationSection } from "@/components/settings/UsersTab";
import { SgRenderErrorsTable } from "./SgRenderErrorsTable";
import { SgRenderJobsTable } from "./SgRenderJobsTable";


/** Browser-safe NAS config from admin-api; the password itself is never returned (#194). */
interface SgNasConfigView {
  host: string;
  share: string;
  mountPath: string;
  user: string;
  passwordSet: boolean;
}

// Lazy: the panel carries a large generated fixture; keep it out of the main bundle (#191).
const PropertyReconciliationPanel = lazy(() =>
  import("@/features/popsg-property-reconciliation/PropertyReconciliationPanel").then((m) => ({
    default: m.PropertyReconciliationPanel,
  })),
);

// ── Helpers ─────────────────────────────────────────────────────────

interface PopSGTaggingStats {
  active_files: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  with_tags: number;
  without_tags: number;
  rule_version: string | null;
  last_completed_at: string | null;
}

interface PopSGCrawlRun {
  id: string;
  status: string;
  lifecycle_state: string;
  created_at: string;
  completed_at: string | null;
  files_found: number;
  files_upserted: number;
  files_deactivated: number;
  stale_candidates_at_start: number | null;
  stale_remaining: number | null;
  guard_state: string | null;
  guard_reason: string | null;
  reconcile_completed_at: string | null;
  refresh_completed_at: string | null;
  inaccessible_roots: string[] | null;
  error_message: string | null;
}

interface PopSGCrawlHealth {
  last_run: PopSGCrawlRun | null;
  recent_runs: PopSGCrawlRun[];
  total_active_files: number;
}

interface PopSGPdfBackfillStatus {
  backfill: {
    status?: string;
    processed?: number;
    refused?: number;
    started_at?: string | null;
    completed_at?: string | null;
  } | null;
  coverage: {
    active_pdfs: number;
    statuses: Record<"pending" | "claimed" | "extracted" | "failed" | "skipped", number>;
  };
  updated_at: string | null;
}

function PopSGTaggingCard() {
  const operation = usePersistentOperation("tag-popsg-files");
  const { data: stats, refetch, isFetching, error } = useQuery<PopSGTaggingStats>({
    queryKey: ["popsg", "tagging-stats"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_style_guide_tagging_stats");
      if (error) throw error;
      return data as PopSGTaggingStats;
    },
    refetchInterval: operation.isActive ? 3_000 : 30_000,
  });

  const progress = operation.state.progress ?? {};
  const activeFiles = stats?.active_files ?? 0;
  const coverage = activeFiles > 0
    ? Math.round(((stats?.with_tags ?? 0) / activeFiles) * 1_000) / 10
    : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Tags className="h-4 w-4 text-primary" />
            File Tags
          </CardTitle>
          <CardDescription className="mt-1 text-xs">
            Uses every folder level, filenames, and the licensed-property taxonomy before vision AI.
            New and changed files process automatically.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh tag statistics"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-xs text-destructive">Tagging statistics could not be loaded.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Tagged files", value: stats?.with_tags ?? 0, detail: `${coverage}% coverage` },
              { label: "Completed", value: stats?.completed ?? 0, detail: `${stats?.without_tags ?? 0} with no inferred tags` },
              { label: "Pending", value: stats?.pending ?? 0, detail: `${stats?.running ?? 0} currently processing` },
              { label: "Failed", value: stats?.failed ?? 0, detail: stats?.rule_version ?? "No completed rule yet" },
            ].map((item) => (
              <div key={item.label} className="rounded-md border border-border bg-muted/20 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
                <p className="mt-0.5 text-lg font-semibold">{item.value.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </div>
        )}

        {(operation.isActive || operation.isQueued) && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
            <p className="font-medium">
              {operation.isQueued ? "Full rebuild queued" : "Rebuilding tags…"}
            </p>
            <p className="mt-1 text-muted-foreground">
              {Number(progress.processed ?? 0).toLocaleString()} files processed ·{" "}
              {Number(progress.tags_written ?? 0).toLocaleString()} tag relationships ·{" "}
              {Number(progress.consensus_relationships ?? 0).toLocaleString()} inherited ·{" "}
              {Number(progress.failed ?? 0).toLocaleString()} failed
            </p>
            <p className="mt-1 text-muted-foreground">
              Unresolved fields (need manual review):{" "}
              {Number(progress.licensor_unmatched ?? 0).toLocaleString()} of{" "}
              {Number(progress.licensor_present ?? 0).toLocaleString()} licensor ·{" "}
              {Number(progress.property_unmatched ?? 0).toLocaleString()} of{" "}
              {Number(progress.property_present ?? 0).toLocaleString()} property
            </p>
          </div>
        )}

        {operation.state.status === "completed" && operation.state.result_message && (
          <p className="text-xs text-success">{operation.state.result_message}</p>
        )}
        {(operation.state.status === "failed" || operation.state.status === "interrupted") && (
          <p className="text-xs text-destructive">
            {operation.state.error ?? "The tag rebuild stopped before completion."}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {operation.isActive ? (
            <Button variant="outline" size="sm" onClick={operation.stop}>
              Stop rebuild
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => operation.start({
                confirmMessage:
                  "Rebuild deterministic tags for every active PopSG file? Manual tags and rejected automatic tags will be preserved.",
                params: { rebuild: true },
                initialProgress: { processed: 0, tags_written: 0, failed: 0 },
                forceRestart: true,
              })}
              disabled={operation.isQueued}
            >
              Rebuild all deterministic tags
            </Button>
          )}
          <p className="self-center text-[10px] text-muted-foreground">
            Manual tags are never overwritten.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ───────────────────────────────────────────────────────

export default function PopSGSettingsPage() {
  const { isAdmin } = useIsAdmin();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "setup";
  const handleTabChange = useCallback((value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  }, [setSearchParams]);

  const queryClient = useQueryClient();
  const { call: callAdminApi } = useAdminApi();
  const crawlProgress = useCrawlProgress();
  const { crawlTriggered, handleTriggerCrawl } = useCrawlLifecycle(crawlProgress, "trigger-style-guide-crawl");
  const crawlActive = crawlProgress.status === "queued" || crawlProgress.status === "running" || crawlTriggered;
  const { data: crawlHealth, refetch: refetchCrawlHealth, isFetching: crawlHealthFetching } = useQuery<PopSGCrawlHealth>({
    queryKey: ["popsg", "crawl-health"],
    queryFn: () => callAdminApi("get-style-guide-crawl-status") as Promise<PopSGCrawlHealth>,
    refetchInterval: crawlActive ? 5_000 : 30_000,
  });
  const lastCrawlRun = crawlHealth?.last_run;
  const priorCrawlRun = crawlHealth?.recent_runs?.[1];
  const fullyReconciled = lastCrawlRun?.status === "completed" &&
    Boolean(lastCrawlRun.reconcile_completed_at) && Boolean(lastCrawlRun.refresh_completed_at);

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

  // NAS password is write-only (#194): the server returns only whether one is set.
  const { data: sgNasConfig } = useQuery({
    queryKey: ["popsg", "sg_nas_config"],
    queryFn: () => callAdminApi("get-sg-nas-config") as Promise<SgNasConfigView>,
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
      setSgNasHost(sgNasConfig.host ?? "");
      setSgNasShare(sgNasConfig.share ?? "");
      setSgMountPath(sgNasConfig.mountPath ?? "");
      setSgNasUser(sgNasConfig.user ?? "");
      setSgNasConfigInitialized(true);
    }
  }, [sgNasConfig, sgNasConfigInitialized]);

  const saveMountPath = useMutation({
    mutationFn: async () => {
      await callAdminApi("set-sg-nas-config", {
        host: sgNasHost,
        share: sgNasShare,
        mountPath: sgMountPath,
        user: sgNasUser,
        // Empty means "keep the stored password".
        ...(sgNasPass ? { password: sgNasPass } : {}),
      });
    },
    onSuccess: () => {
      setSgNasPass("");
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

  const {
    data: pdfStatus,
    error: pdfStatusError,
    refetch: refetchPdfStatus,
    isFetching: pdfStatusFetching,
  } = useQuery<PopSGPdfBackfillStatus>({
    queryKey: ["popsg", "pdf-backfill-status"],
    queryFn: () => callAdminApi("get-popsg-pdf-backfill-status") as Promise<PopSGPdfBackfillStatus>,
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">{CURRENT_APP.name} Settings</h1>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="file-tags">File Tags</TabsTrigger>
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
                  <label className="text-xs font-medium text-muted-foreground">
                    NAS Password{" "}
                    <span data-testid="sg-nas-pass-status">
                      ({sgNasConfig?.passwordSet ? "set" : "not set"})
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type={showSgPass ? "text" : "password"}
                      placeholder={sgNasConfig?.passwordSet ? "Leave blank to keep current password" : "password"}
                      autoComplete="new-password"
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

          {/* PDF text extraction */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4 text-primary" />
                  PDF Search Coverage
                </CardTitle>
                <CardDescription className="mt-1 text-xs">
                  PopSG PDF text is tracked separately from PopDAM licensing and tech-pack extraction.
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => refetchPdfStatus()}
                disabled={pdfStatusFetching}
                aria-label="Refresh PDF search coverage"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${pdfStatusFetching ? "animate-spin" : ""}`} />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {pdfStatusError ? (
                <p className="text-xs text-destructive">PDF extraction coverage could not be loaded.</p>
              ) : !pdfStatus ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {[
                      ["Active PDFs", pdfStatus.coverage.active_pdfs],
                      ["Extracted", pdfStatus.coverage.statuses.extracted],
                      ["Waiting", pdfStatus.coverage.statuses.pending + pdfStatus.coverage.statuses.claimed],
                      ["Failed", pdfStatus.coverage.statuses.failed],
                      ["Terminal skips", pdfStatus.coverage.statuses.skipped],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-md border border-border bg-muted/20 p-2.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                        <p className="mt-0.5 text-lg font-semibold tabular-nums">{Number(value).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {pdfStatus.backfill?.status === "running"
                      ? `Extraction is running · ${Number(pdfStatus.backfill.processed ?? 0).toLocaleString()} processed`
                      : pdfStatus.backfill?.status === "completed"
                        ? `Extraction completed${pdfStatus.backfill.completed_at ? ` ${formatDateTime(pdfStatus.backfill.completed_at)}` : ""}`
                        : "Not started. It remains gated until the PopDAM PDF queue and governed terminal-outcome contract are complete."}
                  </p>
                </>
              )}
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
                          eligible creative files not yet rendered
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
                          eligible creative files where rendering failed — see Render Job History for details
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
                          legacy or unclassified formats outside the current preview contract
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
              {lastCrawlRun && (
                <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {fullyReconciled
                        ? <CheckCircle2 className="h-4 w-4 text-success" />
                        : <AlertCircle className="h-4 w-4 text-destructive" />}
                      <span className="font-medium">
                        {fullyReconciled ? "Fully reconciled" : "Needs attention"}
                      </span>
                      <Badge variant={fullyReconciled ? "secondary" : "destructive"}>
                        {lastCrawlRun.lifecycle_state || lastCrawlRun.status}
                      </Badge>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => refetchCrawlHealth()} disabled={crawlHealthFetching}>
                      <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${crawlHealthFetching ? "animate-spin" : ""}`} />
                      Refresh health
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {[
                      ["Discovered", lastCrawlRun.files_found],
                      ["Accepted", lastCrawlRun.files_upserted],
                      ["Stale candidates", lastCrawlRun.stale_candidates_at_start ?? 0],
                      ["Deactivated", lastCrawlRun.files_deactivated],
                      ["Remaining", lastCrawlRun.stale_remaining ?? 0],
                    ].map(([label, value]) => (
                      <div key={String(label)}>
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                        <p className="font-mono font-semibold tabular-nums">{Number(value).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-muted-foreground">
                    Active library: {(crawlHealth?.total_active_files ?? 0).toLocaleString()}
                    {priorCrawlRun ? ` · Prior ordinary run: ${priorCrawlRun.files_found.toLocaleString()}` : ""}
                    {lastCrawlRun.refresh_completed_at
                      ? ` · Aggregates refreshed ${formatDateTime(lastCrawlRun.refresh_completed_at)}`
                      : " · Aggregates not refreshed"}
                  </p>
                  {(lastCrawlRun.guard_reason || lastCrawlRun.error_message) && (
                    <p className="text-destructive">{lastCrawlRun.guard_reason || lastCrawlRun.error_message}</p>
                  )}
                  {!fullyReconciled && (
                    <p className="font-medium text-destructive">
                      Existing files were preserved. Let the next ordinary crawl retry; do not force completion.
                    </p>
                  )}
                </div>
              )}
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

        {/* ── File Tags tab ── */}
        <TabsContent value="file-tags" className="space-y-5">
          <PopSGTaggingCard />
          <Suspense fallback={<div className="text-sm text-muted-foreground">Loading property reconciliation…</div>}>
            <PropertyReconciliationPanel role={isAdmin ? "administrator" : "viewer"} />
          </Suspense>
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
          <InvitationSection defaultApp="styleguides" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
