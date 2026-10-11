import { useState, useCallback } from "react";
import { RefreshCw, Activity, Key, Copy, Check, Trash2, Play, StopCircle, RotateCcw, Download, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";

export function CopyButton({ text }: { text: string }) {
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

export function AgentUpdateControls({ agentId, agentName }: { agentId: string; agentName: string }) {
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

export function AgentStatusSection() {
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

              // ── Build-identity drift detection ───────────────────────────────
              // The version string is human-edited and can match the latest while
              // the agent is actually running a different (older) image — exactly
              // what happened when a botched self-update left a stale container.
              // build_sha is baked per image build and can't lie, so compare that.
              const currentSha = (vi?.build_sha as string | null) || null;
              const latestSha = (buildData?.sha as string | null) || null;
              const haveShas = !!(currentSha && latestSha);
              const buildMatches = haveShas && currentSha === latestSha;
              // Drift = claims to be current (no newer version published) but the
              // running build is NOT the published build. The dangerous case.
              const buildDrift = haveShas && !buildMatches && !updateAvailable;
              // Truly up to date = running the published build (sha-based when we
              // have shas; otherwise fall back to the version-string comparison).
              const upToDate = haveShas ? buildMatches : (!!currentVersion && !updateAvailable);

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
                        {upToDate && !buildDrift && (
                          <span className="text-[hsl(var(--success))] flex items-center gap-1 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Up to date
                          </span>
                        )}
                      </div>
                    )}
                    {buildDrift && (
                      <div className="text-destructive flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2 font-medium">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>
                          Build mismatch — reports v{currentVersion} but is running{" "}
                          <span className="font-mono">sha:{currentSha!.slice(0, 7)}</span>, not the published{" "}
                          <span className="font-mono">sha:{latestSha!.slice(0, 7)}</span>. The update did not take.
                          Re-run the update, or on the NAS:{" "}
                          <span className="font-mono">docker rm -f popdam-bridge &amp;&amp; docker compose up -d</span>.
                        </span>
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

export function ScanCounters({ counters }: { counters: Record<string, number> }) {
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
