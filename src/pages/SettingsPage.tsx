import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Settings as SettingsIcon, RefreshCw, Activity, Key, UserPlus, Copy, Check, Trash2, MapPin, BarChart3, Play, StopCircle, RotateCcw, Download, Loader2, CheckCircle2, Eye, Users } from "lucide-react";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { parseInputPath, type NasConfig } from "@/lib/path-utils";
import { getUserSyncRoot, setUserSyncRoot } from "@/lib/path-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { NasStorageTab, ImageOutputTab, ScanningTab, LiveScanMonitor, UpdateAgentButton } from "@/components/settings/WorkerManagementTab";
import ApisTab from "@/components/settings/ApisTab";
import WindowsAgentTab from "@/components/settings/WindowsAgentTab";
import InstallBundleTab from "@/components/settings/InstallBundleTab";
import DiagnosticsTab from "@/components/settings/DiagnosticsTab";
import TiffHygieneTab from "@/components/settings/TiffHygieneTab";
import FileHygieneTab from "@/components/settings/FileHygieneTab";
import ErpEnrichmentTab from "@/components/settings/ErpEnrichmentTab";
import AiTaggingTab from "@/components/settings/AiTaggingTab";
import OperationsTab from "@/components/settings/OperationsTab";
import StyleGuideCrawlTab from "@/components/settings/StyleGuideCrawlTab";
import PopSGAgentTab from "@/components/settings/PopSGAgentTab";
import PdfTextSamplesTab from "@/components/settings/PdfTextSamplesTab";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {
        prompt("Copy this value:", text);
      });
    } else {
      prompt("Copy this value:", text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={copy}>
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

// ── Agent Update Controls ───────────────────────────────────────────

function AgentUpdateControls({ agentId, agentName }: { agentId: string; agentName: string }) {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<Record<string, unknown> | null>(null);

  const pollStatus = useCallback(async (maxAttempts: number, intervalMs: number) => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      try {
        const resp = await call("get-update-status");
        if (resp?.status && resp.status.reported_at) {
          setUpdateStatus(resp.status as Record<string, unknown>);
          return resp.status as Record<string, unknown>;
        }
      } catch { /* keep polling */ }
    }
    return null;
  }, [call]);

  const handleCheck = async () => {
    setChecking(true);
    setUpdateStatus(null);
    try {
      await call("trigger-agent-update", { update_action: "check" });
      const result = await pollStatus(10, 3000);
      if (!result) {
        toast.error("Update check timed out — agent may be busy");
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      await call("trigger-agent-update", { update_action: "apply" });
      toast.info("Update in progress — agent will reconnect in ~30s");
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const resp = await call("list-agents");
          const agents = resp?.agents || [];
          const agent = agents.find((a: Record<string, unknown>) => a.id === agentId || a.name === agentName);
          if (agent && agent.status === "online") {
            toast.success("Agent updated and back online");
            queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
            setUpdateStatus(null);
            setApplying(false);
            return;
          }
        } catch { /* keep polling */ }
      }
      toast.warning("Agent hasn't reconnected yet — check Container Manager");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const hasUpdate = updateStatus?.update_available === true;
  const isUpToDate = updateStatus && updateStatus.update_available === false && !updateStatus.error;
  const hasError = updateStatus && typeof updateStatus.error === "string";

  return (
    <div className="flex items-center gap-2 flex-wrap pt-1">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-xs h-7"
        onClick={handleCheck}
        disabled={checking || applying}
        title={applying ? "Applying update…" : checking ? "Checking for updates…" : undefined}
      >
        {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        Check for Update
      </Button>

      {isUpToDate && (
        <span className="text-xs text-[hsl(var(--success))] flex items-center gap-1 font-medium">
          <CheckCircle2 className="h-3.5 w-3.5" /> Up to date
        </span>
      )}

      {hasUpdate && (
        <>
          <Badge variant="secondary" className="text-xs bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]">
            Update available
          </Badge>
          <Button
            variant="default"
            size="sm"
            className="gap-1.5 text-xs h-7"
            onClick={handleApply}
            disabled={applying} title={applying ? "Applying update…" : undefined}
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {applying ? "Updating..." : "Apply Update"}
          </Button>
        </>
      )}

      {!hasUpdate && !isUpToDate && !checking && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs h-7 text-muted-foreground"
          onClick={handleApply}
          disabled={applying} title={applying ? "Applying update…" : "Reinstall the current version"}
        >
          {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          {applying ? "Updating..." : "Reinstall"}
        </Button>
      )}

      {hasError && (
        <span className="text-xs text-destructive">{updateStatus.error as string}</span>
      )}
    </div>
  );
}

// ── Agent Status Section ────────────────────────────────────────────

function AgentStatusSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-agents"],
    queryFn: () => call("list-agents"),
    refetchInterval: 30_000,
  });

  // Fetch latest available build info for both agent types
  const { data: bridgeBuildData } = useQuery({
    queryKey: ["bridge-latest-build"],
    queryFn: () => call("get-latest-agent-build", { agent_type: "bridge" }),
    staleTime: 60_000,
  });
  const { data: windowsBuildData } = useQuery({
    queryKey: ["windows-latest-build-agents"],
    queryFn: () => call("get-latest-agent-build", { agent_type: "windows-render" }),
    staleTime: 60_000,
  });

  const revokeMutation = useMutation({
    mutationFn: (agentId: string) => call("revoke-agent", { agent_id: agentId }),
    onSuccess: () => {
      toast.success("Agent revoked");
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const agents = data?.agents || [];

  const anyForceStopped = agents.some((a: Record<string, unknown>) => {
    return a.force_stop === true || a.scan_abort === true;
  });

  const resumeMutation = useMutation({
    mutationFn: () => call("resume-scanning"),
    onSuccess: () => {
      toast.success("Scanning resumed — agents will accept new ingestions");
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const stopMutation = useMutation({
    mutationFn: () => call("stop-scan"),
    onSuccess: () => {
      toast.success("All agents stopped — ingestion blocked");
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const resetScanMutation = useMutation({
    mutationFn: () => call("reset-scan-state"),
    onSuccess: () => {
      toast.success("Scan state reset — system returned to idle");
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const triggerScanMutation = useMutation({
    mutationFn: () => call("trigger-scan"),
    onSuccess: () => {
      toast.success("Scan triggered", { description: "Bridge Agent will start scanning on its next poll (~30s)." });
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
    },
    onError: (e) => toast.error("Failed to trigger scan", { description: e.message }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Bridge Agents
        </CardTitle>
        <div className="flex items-center gap-2">
          {anyForceStopped ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="default" size="sm" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending} title={resumeMutation.isPending ? "Resuming…" : undefined} className="gap-1.5">
                  <Play className="h-3.5 w-3.5" /> Resume Scanning
                </Button>
              </TooltipTrigger>
              <TooltipContent>Allow agents to resume ingesting new files</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="destructive" size="sm" onClick={() => { if (confirm("Stop all agents and block ingestion?")) stopMutation.mutate(); }} disabled={stopMutation.isPending} title={stopMutation.isPending ? "Stopping all agents…" : undefined} className="gap-1.5">
                  <StopCircle className="h-3.5 w-3.5" /> Stop All
                </Button>
              </TooltipTrigger>
              <TooltipContent>Immediately halt all agents and block any new file ingestion</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => triggerScanMutation.mutate()} disabled={triggerScanMutation.isPending} title={triggerScanMutation.isPending ? "Triggering scan…" : undefined} className="gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${triggerScanMutation.isPending ? "animate-spin" : ""}`} /> Scan Now
              </Button>
            </TooltipTrigger>
            <TooltipContent>Trigger an immediate NAS scan on the Bridge Agent</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => { if (confirm("Reset scan state to idle? This clears any stuck scan.")) resetScanMutation.mutate(); }} disabled={resetScanMutation.isPending} title={resetScanMutation.isPending ? "Resetting scan state…" : undefined} className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" /> Reset Scan State
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear a stuck or stale scan so agents can start fresh</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents registered. Generate a key below to register one.</p>
        ) : (
          <div className="space-y-3">
            {agents.map((agent: Record<string, unknown>) => {
              const vi = agent.version_info as Record<string, unknown> | null;
              const currentVersion = vi?.version as string | null;
              const isUpdating = vi?.updating === true;
              const updateError = vi?.update_error as string | null;
              const deployedAt = vi?.last_reported_at as string | null;
              const buildData = (agent.type as string) === "bridge" ? bridgeBuildData : windowsBuildData;
              const latestVersion = buildData?.latest_version as string | null;
              const latestPublishedAt = buildData?.published_at as string | null;
              const updateAvailable = latestVersion && currentVersion && latestVersion !== "0.0.0" && latestVersion !== currentVersion;

              return (
                <div key={agent.id as string} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${agent.status === "online" ? "bg-[hsl(var(--success))]" : "bg-destructive"}`} />
                      <span className="font-medium text-sm">{agent.name as string}</span>
                      <Badge variant="secondary" className="text-xs">{agent.type as string}</Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => {
                        if (confirm("Revoke this agent key? The agent will stop working.")) {
                          revokeMutation.mutate(agent.id as string);
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1 font-mono">
                    <div>Last heartbeat: {agent.last_heartbeat ? new Date(agent.last_heartbeat as string).toLocaleString() : "never"}</div>
                    {agent.last_error && <div className="text-destructive">Last error: {agent.last_error as string}</div>}
                    {agent.key_preview && <div>Key hash: {agent.key_preview as string}</div>}
                  </div>

                  {/* Version management section */}
                  <div className="text-xs space-y-1.5 mt-1">
                    {currentVersion && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-muted-foreground">Installed:</span>
                        <Badge variant="outline" className="text-[10px] h-5 font-mono">v{currentVersion}</Badge>
                        {vi?.image_tag && vi.image_tag !== `v${currentVersion}` && vi.image_tag !== currentVersion && (
                          <Badge variant="secondary" className="text-[10px] font-mono h-5">{vi.image_tag as string}</Badge>
                        )}
                        {vi?.build_sha && (
                          <span className="text-[10px] text-muted-foreground font-mono">sha:{(vi.build_sha as string).slice(0, 7)}</span>
                        )}
                        {deployedAt && (
                          <span className="text-muted-foreground">
                            last seen {new Date(deployedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}
                    {latestVersion && latestVersion !== "0.0.0" && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-muted-foreground">Latest:</span>
                        <Badge variant={updateAvailable ? "secondary" : "outline"} className={`text-[10px] h-5 font-mono ${updateAvailable ? "text-[hsl(var(--warning))] gap-1" : ""}`}>
                          v{latestVersion}
                        </Badge>
                        {latestPublishedAt && (
                          <span className="text-muted-foreground">
                            published {new Date(latestPublishedAt).toLocaleString()}
                          </span>
                        )}
                        {!updateAvailable && currentVersion && (
                          <span className="text-[hsl(var(--success))] flex items-center gap-1 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Up to date
                          </span>
                        )}
                      </div>
                    )}
                    {isUpdating && (
                      <Badge variant="secondary" className="text-[10px] h-5 gap-1 animate-pulse">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        Updating...
                      </Badge>
                    )}
                    {updateError && (
                      <div className="text-destructive">Update error: {updateError}</div>
                    )}
                  </div>

                  {agent.last_counters && (
                    <ScanCounters counters={agent.last_counters as Record<string, number>} />
                  )}
                  {agent.status === "online" && agent.type === "bridge" && (
                    <AgentUpdateControls agentId={agent.id as string} agentName={agent.name as string} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScanCounters({ counters }: { counters: Record<string, number> }) {
  const totalEncountered = counters.files_total_encountered ?? 0;
  const supported = counters.files_checked ?? 0;
  const rejectedWrongType = counters.rejected_wrong_type ?? 0;
  const rejectedJunk = counters.rejected_junk_file ?? 0;
  const totalRejected = rejectedWrongType + rejectedJunk;
  const ingestedNew = counters.ingested_new ?? 0;
  const updated = counters.updated_existing ?? 0;
  const moved = counters.moved_detected ?? 0;
  const unchanged = counters.noop_unchanged ?? 0;
  const errors = counters.errors ?? 0;
  const dirsSkippedPerm = counters.dirs_skipped_permission ?? 0;
  const dirsSkippedExcluded = counters.dirs_skipped_excluded ?? 0;
  const statFailed = counters.files_stat_failed ?? 0;

  const hasData = totalEncountered > 0 || supported > 0 || errors > 0;
  if (!hasData) return <p className="text-xs text-muted-foreground mt-1">No scan data yet</p>;

  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="mt-2 text-xs font-mono space-y-0.5">
      <div className="font-semibold text-foreground">Total files encountered: {fmt(totalEncountered)}</div>
      <div className="pl-3 border-l border-border ml-1 space-y-0.5">
        <div className="text-foreground">Supported (.ai / .psd): <span className="font-semibold">{fmt(supported)}</span></div>
        <div className="pl-3 border-l border-border ml-1 space-y-0.5">
          <div>New: <span className="text-[hsl(var(--success))]">{fmt(ingestedNew)}</span></div>
          <div>Updated: <span className="text-foreground">{fmt(updated)}</span></div>
          <div>Moved: <span className="text-foreground">{fmt(moved)}</span></div>
          <div>Unchanged: <span className="text-muted-foreground">{fmt(unchanged)}</span></div>
          <div>Errors: <span className={errors > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>{fmt(errors)}</span></div>
        </div>
      </div>
      <div className="pl-3 border-l border-border ml-1 space-y-0.5">
        <div className="text-foreground">Rejected: <span className="text-muted-foreground">{fmt(totalRejected)}</span></div>
        <div className="pl-3 border-l border-border ml-1 space-y-0.5">
          <div>Wrong type (jpg, png, etc): <span className="text-muted-foreground">{fmt(rejectedWrongType)}</span></div>
          <div>Junk files (._*, __MACOSX): <span className="text-muted-foreground">{fmt(rejectedJunk)}</span></div>
        </div>
      </div>
      <div className="pt-1 space-y-0.5">
        <div>Directories skipped (no permission): <span className={dirsSkippedPerm > 0 ? "text-[hsl(var(--warning))]" : "text-muted-foreground"}>{fmt(dirsSkippedPerm)}</span></div>
        <div>Directories skipped (excluded patterns): <span className="text-muted-foreground">{fmt(dirsSkippedExcluded)}</span></div>
        <div>Files failed to stat: <span className={statFailed > 0 ? "text-[hsl(var(--warning))]" : "text-muted-foreground"}>{fmt(statFailed)}</span></div>
      </div>
    </div>
  );
}

// ── Pairing Codes ───────────────────────────────────────────────────

type PairingRow = {
  id: string;
  pairing_code: string;
  agent_type: string;
  agent_name: string;
  status: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

function PairingCodesSection({ defaultAgentType = "bridge" as "bridge" | "windows-render" }) {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [agentName, setAgentName] = useState(
    defaultAgentType === "bridge" ? "bridge-agent" : "windows-render-agent",
  );
  const [agentType, setAgentType] = useState<"bridge" | "windows-render">(defaultAgentType);
  const [justCreated, setJustCreated] = useState<{ code: string; expires_at: string } | null>(null);

  const { data: listData } = useQuery({
    queryKey: ["admin-pairing-codes"],
    queryFn: () => call("list-pairing-codes"),
    refetchInterval: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      call("create-pairing-code", {
        agent_type: agentType,
        agent_name: agentName.trim() || undefined,
      }),
    onSuccess: (data) => {
      setJustCreated({ code: data.pairing_code, expires_at: data.expires_at });
      queryClient.invalidateQueries({ queryKey: ["admin-pairing-codes"] });
      if (data.reused) {
        toast.info("Reusing existing unexpired pairing code");
      } else {
        toast.success("Pairing code created — copy it now!");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const pairings: PairingRow[] = (listData?.pairings as PairingRow[] | undefined) || [];
  const activePairings = pairings.filter(
    (p) => p.status === "pending" && new Date(p.expires_at).getTime() > Date.now(),
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Key className="h-4 w-4" /> Pairing Codes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Generate a one-time code to pair a new agent. The agent self-registers on first heartbeat — no manual key copying needed. Codes expire in 15 minutes.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-[160px,1fr,auto] gap-2">
          <select
            value={agentType}
            onChange={(e) => {
              const v = e.target.value as "bridge" | "windows-render";
              setAgentType(v);
              setAgentName(v === "bridge" ? "bridge-agent" : "windows-render-agent");
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-xs font-mono"
          >
            <option value="bridge">Bridge Agent</option>
            <option value="windows-render">Windows Render</option>
          </select>
          <Input
            placeholder="Agent name (e.g. bridge-popsg)"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            className="font-mono text-xs"
          />
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            size="sm"
          >
            {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generate"}
          </Button>
        </div>

        {justCreated && (
          <div className="bg-[hsl(var(--surface-overlay))] border border-primary/40 rounded-md p-3 space-y-2">
            <p className="text-xs text-[hsl(var(--warning))] font-semibold">
              ⚠ Copy this code now — it expires{" "}
              {new Date(justCreated.expires_at).toLocaleTimeString()}
            </p>
            <div className="flex items-center gap-2">
              <code className="text-base font-mono font-bold text-foreground tracking-wider flex-1 select-all">
                {justCreated.code}
              </code>
              <CopyButton text={justCreated.code} />
            </div>
          </div>
        )}

        {activePairings.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
              Active codes ({activePairings.length})
            </p>
            <div className="space-y-1">
              {activePairings.map((p) => {
                const minsLeft = Math.max(
                  0,
                  Math.round((new Date(p.expires_at).getTime() - Date.now()) / 60000),
                );
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 text-xs font-mono bg-muted/40 rounded px-2 py-1.5"
                  >
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {p.agent_type}
                    </Badge>
                    <span className="text-muted-foreground shrink-0">{p.agent_name}</span>
                    <code className="flex-1 text-foreground select-all">{p.pairing_code}</code>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {minsLeft}m left
                    </span>
                    <CopyButton text={p.pairing_code} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Path Tester ─────────────────────────────────────────────────────

function PathTesterSection() {
  const { call } = useAdminApi();
  const [inputPath, setInputPath] = useState("");
  const [result, setResult] = useState<ReturnType<typeof parseInputPath> | null>(null);
  const [syncRoot, setSyncRoot] = useState(getUserSyncRoot() || "");
  const [pathMode, setPathMode] = useState<import("@/lib/open-folder").PathMode>(() => {
    try {
      const v = localStorage.getItem("popdam_open_folder_mode");
      if (v === "unc_host" || v === "unc_ip" || v === "synology_drive") return v;
    } catch { /* ignore */ }
    return "unc_host";
  });

  const { data: configData } = useQuery({
    queryKey: ["admin-config"],
    queryFn: () => call("get-config"),
  });

  const nasConfig: NasConfig | null = (() => {
    const nasVal = configData?.config?.NAS_CONFIG;
    const v = nasVal?.value ?? nasVal;
    if (!v || typeof v !== "object") return null;
    const c = v as Record<string, string>;
    return {
      NAS_HOST: c.host || "",
      NAS_IP: c.ip || "",
      NAS_SHARE: c.share || "",
      NAS_CONTAINER_MOUNT_ROOT: c.mount_root || "",
    };
  })();

  const handleTest = () => {
    if (!nasConfig) { toast.error("NAS config not loaded"); return; }
    setResult(parseInputPath(inputPath, nasConfig, syncRoot || null));
  };

  const handleSaveSyncRoot = () => {
    setUserSyncRoot(syncRoot);
    toast.success("Synology Drive root saved locally");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MapPin className="h-4 w-4" /> Path Tester
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Test how any path (UNC, container, Synology Drive, or relative) resolves in PopDAM. Also configures how "Open Folder" links work on your machine.</p>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Your Synology Drive root (saved locally in this browser)</label>
          <div className="flex gap-2">
            <Input
              placeholder="C:\Users\Albert\SynologyDrive"
              value={syncRoot}
              onChange={(e) => setSyncRoot(e.target.value)}
              className="font-mono text-xs"
            />
            <Button size="sm" variant="secondary" onClick={handleSaveSyncRoot}>Save</Button>
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">"Open Folder" path mode (used by the popdam:// protocol handler)</label>
          <select
            value={pathMode}
            onChange={(e) => {
              const v = e.target.value as import("@/lib/open-folder").PathMode;
              setPathMode(v);
              import("@/lib/open-folder").then(m => m.setPreferredPathMode(v));
              toast.success("Open Folder path mode saved");
            }}
            className="bg-secondary text-secondary-foreground rounded-md px-2 py-1.5 text-xs border border-border font-mono"
          >
            <option value="unc_host">UNC by hostname (\\host\share\…)</option>
            <option value="unc_ip">UNC by IP (\\192.168.x.x\share\…)</option>
            <option value="synology_drive">Synology Drive (local sync folder)</option>
          </select>
          {pathMode === "synology_drive" && !syncRoot && (
            <p className="text-[10px] text-[hsl(var(--warning))]">⚠ Set your Synology Drive root above for this mode to work.</p>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Paste any path to test"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            className="font-mono text-xs"
          />
          <Button size="sm" onClick={handleTest} disabled={!inputPath.trim()} title={!inputPath.trim() ? "Enter a path to test first" : undefined}>Test</Button>
        </div>
        {result && (
          <div className={`text-xs font-mono rounded-md p-3 space-y-1 ${result.valid ? "bg-[hsl(var(--success)/0.1)] border border-[hsl(var(--success)/0.3)]" : "bg-destructive/10 border border-destructive/30"}`}>
            <div>Valid: <strong>{result.valid ? "YES" : "NO"}</strong></div>
            {result.error && <div className="text-destructive">{result.error}</div>}
            {result.relativePath && (
              <>
                <div className="flex items-center gap-1">Canonical relative_path: <code className="text-primary">{result.relativePath}</code> <CopyButton text={result.relativePath} /></div>
                {result.displays && (
                  <>
                    <div className="flex items-center gap-1">UNC (host): <code>{result.displays.uncHost}</code> <CopyButton text={result.displays.uncHost} /></div>
                    <div className="flex items-center gap-1">UNC (IP): <code>{result.displays.uncIp}</code> <CopyButton text={result.displays.uncIp} /></div>
                    {result.displays.remote && <div className="flex items-center gap-1">Synology Drive: <code>{result.displays.remote}</code> <CopyButton text={result.displays.remote} /></div>}
                    {result.displays.container && <div className="flex items-center gap-1">Container: <code>{result.displays.container}</code> <CopyButton text={result.displays.container} /></div>}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── User List + App Access + Impersonation ──────────────────────────

interface UserRecord {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  isAdmin: boolean;
  apps: string[];
}

const APP_OPTIONS = [
  { id: "popdam", label: "PopDAM" },
  { id: "styleguides", label: "PopSG" },
] as const;

function UsersSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const { startImpersonation } = useImpersonation();
  const navigate = useNavigate();
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => call("list-users").then((r) => r.users as UserRecord[]),
    staleTime: 60_000,
  });

  const handleImpersonate = (u: UserRecord) => {
    startImpersonation({ id: u.id, email: u.email, isAdmin: u.isAdmin });
    navigate("/library");
  };

  const handleToggleApp = async (u: UserRecord, app: string, checked: boolean) => {
    const nextApps = checked
      ? Array.from(new Set([...u.apps, app]))
      : u.apps.filter((a) => a !== app);
    setSavingUserId(u.id);
    try {
      await call("set-user-apps", { user_id: u.id, apps: nextApps });
      toast.success(`Updated app access for ${u.email}`);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (e) {
      toast.error((e as Error).message || "Failed to update app access");
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> Active Users
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && (!data || data.length === 0) && (
          <p className="text-xs text-muted-foreground">No users found.</p>
        )}
        <div className="space-y-2">
          {data?.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{u.email}</p>
                <p className="text-xs text-muted-foreground">{u.isAdmin ? "Admin" : "User"}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {APP_OPTIONS.map((opt) => {
                  const checked = u.apps.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
                      title={`Toggle ${opt.label} access for ${u.email}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={savingUserId === u.id}
                        onChange={(e) => handleToggleApp(u, opt.id, e.target.checked)}
                        className="h-3.5 w-3.5 accent-primary cursor-pointer"
                      />
                      <span className={checked ? "" : "text-muted-foreground"}>{opt.label}</span>
                    </label>
                  );
                })}
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-1 shrink-0 gap-1.5"
                  onClick={() => handleImpersonate(u)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  View as
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Invitation Manager ──────────────────────────────────────────────

function InvitationSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const [apps, setApps] = useState<string[]>(["popdam"]);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-invites"],
    queryFn: () => call("list-invites"),
  });

  const inviteMutation = useMutation({
    mutationFn: () => call("invite-user", { email, role, apps }),
    onSuccess: () => {
      toast.success("Invitation sent");
      setEmail("");
      setApps(["popdam"]);
      queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => call("revoke-invite", { invitation_id: id }),
    onSuccess: () => {
      toast.success("Invitation revoked");
      queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const handleResend = async (invitationId: string, invEmail: string) => {
    setResendingId(invitationId);
    try {
      const { externalSupabase } = await import("@/lib/external-supabase");
      const { data: fnData, error } = await externalSupabase.functions.invoke("send-invite-email", {
        body: { email: invEmail, invitation_id: invitationId },
      });
      if (error) throw error;
      if (fnData?.ok === false) {
        toast.error(fnData.error || "Failed to send invite", {
          description: fnData.rawBody ? `Brevo response: ${fnData.rawBody}` : undefined,
          duration: 10000,
        });
      } else if (fnData?.warning) {
        toast.warning(`Invite sent to ${invEmail} — but with a warning`, {
          description: fnData.warning,
          duration: 15000,
        });
      } else {
        const brevoId = fnData?.messageId ? ` (Brevo ID: ${fnData.messageId})` : "";
        toast.success(`Invite sent to ${invEmail}${brevoId}`, { duration: 8000 });
      }
    } catch (e) {
      toast.error((e as Error).message || "Failed to resend invitation");
    } finally {
      setResendingId(null);
    }
  };

  const invitations = data?.invitations || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="h-4 w-4" /> Invitations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="text-sm"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="bg-secondary text-secondary-foreground rounded-md px-2 text-sm border border-border"
              title="Role"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <Button
              size="sm"
              onClick={() => inviteMutation.mutate()}
              disabled={!email.trim() || apps.length === 0}
              title={!email.trim() ? "Enter an email address first" : apps.length === 0 ? "Pick at least one app" : undefined}
            >
              Invite
            </Button>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">Grant access to:</span>
            {APP_OPTIONS.map((opt) => {
              const checked = apps.includes(opt.id);
              return (
                <label key={opt.id} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setApps((prev) =>
                        e.target.checked
                          ? Array.from(new Set([...prev, opt.id]))
                          : prev.filter((a) => a !== opt.id),
                      );
                    }}
                    className="h-3.5 w-3.5 accent-primary cursor-pointer"
                  />
                  <span className={checked ? "" : "text-muted-foreground"}>{opt.label}</span>
                </label>
              );
            })}
          </div>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-1">
            {invitations.map((inv: Record<string, unknown>) => {
              const invApps = Array.isArray(inv.apps) ? (inv.apps as string[]) : ["popdam"];
              return (
              <div key={inv.id as string} className="flex items-center justify-between text-xs py-1 border-b border-border">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono">{inv.email as string}</span>
                  <Badge variant="secondary">{inv.role as string}</Badge>
                  {invApps.map((a) => (
                    <Badge key={a} variant="outline" className="text-[10px]">
                      {APP_OPTIONS.find((o) => o.id === a)?.label ?? a}
                    </Badge>
                  ))}
                  {inv.accepted_at ? (
                    <Badge className="bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]">Accepted</Badge>
                  ) : (
                    <Badge variant="outline">Pending</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {!inv.accepted_at && (
                    <>
                      <Button
                        variant="outline" size="sm" className="h-6 text-xs gap-1"
                        onClick={() => handleResend(inv.id as string, inv.email as string)}
                        disabled={resendingId === inv.id}
                        title={resendingId === inv.id ? "Sending invitation…" : undefined}
                      >
                        {resendingId === inv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Resend
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => revokeMutation.mutate(inv.id as string)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              );
            })}
            {invitations.length === 0 && <p className="text-muted-foreground text-xs">No invitations yet.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Throughput Chart ─────────────────────────────────────────────────

interface HistoryPoint {
  ts: string;
  ingested_new?: number;
  updated_existing?: number;
  moved_detected?: number;
  errors?: number;
  files_checked?: number;
}

function AgentThroughputChart() {
  const { call } = useAdminApi();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-agents"],
    queryFn: () => call("list-agents"),
  });

  const chartData = useMemo(() => {
    const agents = data?.agents || [];
    const allPoints: { time: string; ingested: number; updated: number; moved: number; errors: number }[] = [];

    for (const agent of agents) {
      const metadata = (agent as Record<string, unknown>).metadata as Record<string, unknown> | undefined;
      const history = (metadata?.heartbeat_history || (agent as Record<string, unknown>).heartbeat_history) as HistoryPoint[] | undefined;
      if (!Array.isArray(history)) continue;

      for (const point of history) {
        allPoints.push({
          time: new Date(point.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          ingested: point.ingested_new ?? 0,
          updated: point.updated_existing ?? 0,
          moved: point.moved_detected ?? 0,
          errors: point.errors ?? 0,
        });
      }
    }

    return allPoints.slice(-60);
  }, [data]);

  if (isLoading) return null;
  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Throughput
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No heartbeat history yet. Data appears after the Bridge Agent sends several heartbeats.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> Throughput (Recent Heartbeats)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 14% 22%)" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(220 10% 55%)" }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(220 10% 55%)" }} tickLine={false} axisLine={false} allowDecimals={false} />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "hsl(220 16% 15%)",
                  border: "1px solid hsl(220 14% 22%)",
                  borderRadius: "6px",
                  fontSize: 12,
                  color: "hsl(220 13% 91%)",
                }}
              />
              <Area type="monotone" dataKey="ingested" name="Ingested" stroke="hsl(38 92% 55%)" fill="hsl(38 92% 55% / 0.2)" strokeWidth={2} />
              <Area type="monotone" dataKey="updated" name="Updated" stroke="hsl(217 91% 60%)" fill="hsl(217 91% 60% / 0.1)" strokeWidth={1.5} />
              <Area type="monotone" dataKey="moved" name="Moved" stroke="hsl(142 71% 45%)" fill="hsl(142 71% 45% / 0.1)" strokeWidth={1.5} />
              <Area type="monotone" dataKey="errors" name="Errors" stroke="hsl(0 72% 51%)" fill="hsl(0 72% 51% / 0.1)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" /> Ingested</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[hsl(var(--info))]" /> Updated</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[hsl(var(--success))]" /> Moved</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive" /> Errors</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tooltip-wrapped tab trigger ─────────────────────────────────────

function TipTab({ value, label, tip }: { value: string; label: string; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TabsTrigger value={value}>{label}</TabsTrigger>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  );
}

// ── Helper App Password ─────────────────────────────────────────────

function HelperPasswordCard() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords do not match");
      confirmRef.current?.focus();
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Helper app password set");
      setPassword("");
      setConfirm("");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Helper App Password</CardTitle>
        <p className="text-sm text-muted-foreground">
          Set a password so you can sign in to the POP DAM Helper desktop app.
          Use the same email address as your account here.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-sm">
          <Input
            type="password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <Input
            ref={confirmRef}
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <Button type="submit" disabled={busy} className="w-fit">
            {busy ? "Saving…" : "Set Password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Main Settings Page ──────────────────────────────────────────────

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "storage";
  const handleTabChange = useCallback((value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  }, [setSearchParams]);

  // Sub-tab state for merged tabs
  const [storageSubTab, setStorageSubTab] = useState("nas");
  const [agentsSubTab, setAgentsSubTab] = useState("bridge");
  const [hygieneSubTab, setHygieneSubTab] = useState("tiff");

  return (
    <div className="container max-w-7xl py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SettingsIcon className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Settings</h1>
        </div>
        <span className="text-xs text-muted-foreground font-mono select-all" title="Git commit hash and date of this build">
          {__APP_COMMIT__} · {__APP_DATE__}
        </span>
      </div>

      <HelperPasswordCard />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="storage">Storage</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TipTab value="ai-tagging" label="AI Tagging" tip="Run AI tagging jobs and configure tagging behavior" />
          <TipTab value="taxonomy" label="Taxonomy" tip="Manage licensors, properties, and characters — sync from external APIs" />
          <TipTab value="erp" label="ERP" tip="Sync and enrich product data from your ERP system" />
          <TipTab value="hygiene" label="Hygiene" tip="TIFF compression optimization and embedded-file quality checks" />
          <TipTab value="operations" label="Operations" tip="Bulk data maintenance: reprocess metadata, rebuild style groups, and more" />
          <TabsTrigger value="users">Users</TabsTrigger>
          <TipTab value="diagnostics" label="Diagnostics" tip="System health, connected agents, recent errors, and database inspector" />
        </TabsList>

        {/* ── Storage (NAS + Scanning + Image Output) ── */}
        <TabsContent value="storage" className="space-y-4">
          <div className="flex gap-1 border-b border-border pb-2">
            {[
              { id: "nas", label: "NAS & Folders" },
              { id: "scanning", label: "Scanning" },
              { id: "image-output", label: "Image Output" },
              { id: "paths", label: "Path Tester" },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setStorageSubTab(id)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${storageSubTab === id ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {storageSubTab === "nas" && <NasStorageTab />}
          {storageSubTab === "scanning" && <ScanningTab />}
          {storageSubTab === "image-output" && <ImageOutputTab />}
          {storageSubTab === "paths" && <PathTesterSection />}
        </TabsContent>

        {/* ── Agents (Bridge + Windows + Install) ── */}
        <TabsContent value="agents" className="space-y-4">
          <div className="flex gap-1 border-b border-border pb-2">
            {[
              { id: "bridge", label: "Bridge Agent (NAS)" },
              { id: "windows", label: "Windows Render Agent" },
              { id: "popsg", label: "PopSG Connection" },
              { id: "pdf-text", label: "PDF Text" },
              { id: "install", label: "Install Bundles" },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setAgentsSubTab(id)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${agentsSubTab === id ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {agentsSubTab === "bridge" && (
            <div className="space-y-4">
              <PairingCodesSection defaultAgentType="bridge" />
              <AgentStatusSection />
              <AgentThroughputChart />
              <LiveScanMonitor />
              <UpdateAgentButton />
              <StyleGuideCrawlTab />
            </div>
          )}
          {agentsSubTab === "windows" && <WindowsAgentTab />}
          {agentsSubTab === "popsg" && <PopSGAgentTab />}
          {agentsSubTab === "pdf-text" && <PdfTextSamplesTab />}
          {agentsSubTab === "install" && <InstallBundleTab />}
        </TabsContent>

        {/* ── AI Tagging ── */}
        <TabsContent value="ai-tagging" className="space-y-4">
          <AiTaggingTab />
        </TabsContent>

        {/* ── Taxonomy ── */}
        <TabsContent value="taxonomy" className="space-y-4">
          <ApisTab />
        </TabsContent>

        {/* ── ERP ── */}
        <TabsContent value="erp" className="space-y-4">
          <ErpEnrichmentTab />
        </TabsContent>

        {/* ── Hygiene (TIFF + File) ── */}
        <TabsContent value="hygiene" className="space-y-4">
          <div className="flex gap-1 border-b border-border pb-2">
            {[
              { id: "tiff", label: "TIFF Compression" },
              { id: "files", label: "File Quality" },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setHygieneSubTab(id)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${hygieneSubTab === id ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {hygieneSubTab === "tiff" && <TiffHygieneTab />}
          {hygieneSubTab === "files" && <FileHygieneTab />}
        </TabsContent>

        {/* ── Operations ── */}
        <TabsContent value="operations" className="space-y-4">
          <OperationsTab />
        </TabsContent>

        {/* ── Users ── */}
        <TabsContent value="users" className="space-y-4">
          <UsersSection />
          <InvitationSection />
        </TabsContent>

        {/* ── Diagnostics ── */}
        <TabsContent value="diagnostics" className="space-y-4">
          <DiagnosticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
