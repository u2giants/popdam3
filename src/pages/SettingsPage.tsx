import { useState, useMemo, useEffect, useCallback } from "react";
import { Settings as SettingsIcon, RefreshCw, Shield, Activity, Stethoscope, Key, UserPlus, Copy, Check, Trash2, MapPin, BarChart3, Wrench, Play, StopCircle, Globe, RotateCcw, Download, Loader2, CheckCircle2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { parseInputPath, type NasConfig } from "@/lib/path-utils";
import { getUserSyncRoot, setUserSyncRoot } from "@/lib/path-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { NasStorageTab, ImageOutputTab, ScanningTab, LiveScanMonitor, UpdateAgentButton } from "@/components/settings/WorkerManagementTab";
import ApisTab from "@/components/settings/ApisTab";
import WindowsAgentTab from "@/components/settings/WindowsAgentTab";
import InstallBundleTab from "@/components/settings/InstallBundleTab";
import DiagnosticsTab from "@/components/settings/DiagnosticsTab";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={copy}>
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

// ── Effective Config Section ────────────────────────────────────────

function EffectiveConfigSection() {
  const { call } = useAdminApi();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-config"],
    queryFn: () => call("get-config"),
  });

  const config = data?.config || {};

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <SettingsIcon className="h-4 w-4" /> Effective Configuration
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-2 font-mono text-xs">
            {Object.entries(config).map(([key, entry]) => {
              const val = (entry as { value: unknown })?.value ?? entry;
              return (
                <div key={key} className="flex items-start gap-2 border-b border-border pb-1">
                  <span className="text-primary font-semibold min-w-[200px] shrink-0">{key}</span>
                  <span className="text-muted-foreground break-all">
                    {typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)}
                  </span>
                </div>
              );
            })}
            {Object.keys(config).length === 0 && (
              <p className="text-muted-foreground">No config entries found.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
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
      const result = await pollStatus(10, 3000); // 10 attempts, 3s each = 30s max
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
      // Poll list-agents every 5s until agent comes back online
      for (let i = 0; i < 12; i++) { // 60s max
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
            disabled={applying}
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {applying ? "Updating..." : "Apply Update"}
          </Button>
        </>
      )}

      {!hasUpdate && !checking && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs h-7 text-muted-foreground"
          onClick={handleApply}
          disabled={applying}
        >
          {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          {applying ? "Updating..." : "Force Update"}
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

  // Check if any agent has force_stop
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Agent Status
        </CardTitle>
        <div className="flex items-center gap-2">
          {anyForceStopped ? (
            <Button variant="default" size="sm" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending} className="gap-1.5">
              <Play className="h-3.5 w-3.5" /> Resume Scanning
            </Button>
          ) : (
            <Button variant="destructive" size="sm" onClick={() => { if (confirm("Stop all agents and block ingestion?")) stopMutation.mutate(); }} disabled={stopMutation.isPending} className="gap-1.5">
              <StopCircle className="h-3.5 w-3.5" /> Stop All
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { if (confirm("Reset scan state to idle? This clears any stuck scan.")) resetScanMutation.mutate(); }} disabled={resetScanMutation.isPending} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Reset Scan State
          </Button>
          <Button variant="ghost" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents registered. Generate a key in the Setup Wizard to register one.</p>
        ) : (
          <div className="space-y-3">
            {agents.map((agent: Record<string, unknown>) => (
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
                {/* Version info for bridge agents */}
                {(() => {
                  const vi = agent.version_info as Record<string, unknown> | null;
                  if (!vi) return null;
                  return (
                    <div className="flex flex-wrap items-center gap-2 text-xs mt-1">
                      {vi.version && (
                        <Badge variant="outline" className="text-[10px] font-mono gap-1">
                          v{vi.version as string}
                        </Badge>
                      )}
                      {vi.image_tag && (
                        <Badge variant="secondary" className="text-[10px] font-mono gap-1">
                          {vi.image_tag as string}
                        </Badge>
                      )}
                      {vi.build_sha && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          sha:{(vi.build_sha as string).slice(0, 7)}
                        </span>
                      )}
                      {vi.last_reported_at && (
                        <span className="text-[10px] text-muted-foreground">
                          reported {new Date(vi.last_reported_at as string).toLocaleString()}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {agent.last_counters && (
                  <ScanCounters counters={agent.last_counters as Record<string, number>} />
                )}
                {agent.status === "online" && agent.type === "bridge" && (
                  <AgentUpdateControls agentId={agent.id as string} agentName={agent.name as string} />
                )}
              </div>
            ))}
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
  const dirsSkipped = counters.dirs_skipped_permission ?? 0;
  const statFailed = counters.files_stat_failed ?? 0;

  const hasData = totalEncountered > 0 || supported > 0 || errors > 0;

  if (!hasData) {
    return <p className="text-xs text-muted-foreground mt-1">No scan data yet</p>;
  }

  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="mt-2 text-xs font-mono space-y-0.5">
      <div className="font-semibold text-foreground">
        Total files encountered: {fmt(totalEncountered)}
      </div>

      {/* Supported branch */}
      <div className="pl-3 border-l border-border ml-1 space-y-0.5">
        <div className="text-foreground">
          Supported (.ai / .psd): <span className="font-semibold">{fmt(supported)}</span>
        </div>
        <div className="pl-3 border-l border-border ml-1 space-y-0.5">
          <div>New: <span className="text-[hsl(var(--success))]">{fmt(ingestedNew)}</span></div>
          <div>Updated: <span className="text-foreground">{fmt(updated)}</span></div>
          <div>Moved: <span className="text-foreground">{fmt(moved)}</span></div>
          <div>Unchanged: <span className="text-muted-foreground">{fmt(unchanged)}</span></div>
          <div>Errors: <span className={errors > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>{fmt(errors)}</span></div>
        </div>
      </div>

      {/* Rejected branch */}
      <div className="pl-3 border-l border-border ml-1 space-y-0.5">
        <div className="text-foreground">
          Rejected: <span className="text-muted-foreground">{fmt(totalRejected)}</span>
        </div>
        <div className="pl-3 border-l border-border ml-1 space-y-0.5">
          <div>Wrong type (jpg, png, etc): <span className="text-muted-foreground">{fmt(rejectedWrongType)}</span></div>
          <div>Junk files (._*, __MACOSX): <span className="text-muted-foreground">{fmt(rejectedJunk)}</span></div>
        </div>
      </div>

      {/* Footer stats */}
      <div className="pt-1 space-y-0.5">
        <div>Directories skipped (no permission): <span className={dirsSkipped > 0 ? "text-[hsl(var(--warning))]" : "text-muted-foreground"}>{fmt(dirsSkipped)}</span></div>
        <div>Files failed to stat: <span className={statFailed > 0 ? "text-[hsl(var(--warning))]" : "text-muted-foreground"}>{fmt(statFailed)}</span></div>
      </div>
    </div>
  );
}

// ── Agent Key Generation ────────────────────────────────────────────

function AgentKeySection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [agentName, setAgentName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => call("generate-agent-key", { agent_name: agentName, agent_type: "bridge" }),
    onSuccess: (data) => {
      setGeneratedKey(data.agent_key);
      setAgentName("");
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
      toast.success("Agent key generated — save it now!");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Key className="h-4 w-4" /> Generate Agent Key
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Agent name (e.g. synology-bridge-1)"
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            className="font-mono text-sm"
          />
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={!agentName.trim() || generateMutation.isPending}
            size="sm"
          >
            Generate
          </Button>
        </div>
        {generatedKey && (
          <div className="bg-[hsl(var(--surface-overlay))] border border-primary/30 rounded-md p-3 space-y-2">
            <p className="text-xs text-warning font-semibold">⚠ Copy this key now — it cannot be retrieved again!</p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-foreground break-all flex-1">{generatedKey}</code>
              <CopyButton text={generatedKey} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Doctor Diagnostics ──────────────────────────────────────────────

function DoctorSection() {
  const { call } = useAdminApi();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-doctor"],
    queryFn: () => call("doctor"),
    enabled: false,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Stethoscope className="h-4 w-4" /> Doctor Diagnostics
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          {isLoading ? "Running..." : "Run Diagnostics"}
        </Button>
      </CardHeader>
      <CardContent>
        {data?.diagnostic ? (
          <pre className="text-xs font-mono text-muted-foreground bg-[hsl(var(--surface-overlay))] rounded-md p-3 max-h-[400px] overflow-auto whitespace-pre-wrap">
            {JSON.stringify(data.diagnostic, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">Click "Run Diagnostics" to fetch a complete diagnostic bundle.</p>
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
    if (!nasConfig) {
      toast.error("NAS config not loaded");
      return;
    }
    const userSync = syncRoot || null;
    setResult(parseInputPath(inputPath, nasConfig, userSync));
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
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Your Synology Drive root (local, stored in browser)</label>
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
        <div className="flex gap-2">
          <Input
            placeholder="Paste any path (UNC, container, Synology Drive, or relative)"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            className="font-mono text-xs"
          />
          <Button size="sm" onClick={handleTest} disabled={!inputPath.trim()}>Test</Button>
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

// ── Invitation Manager ──────────────────────────────────────────────

function InvitationSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-invites"],
    queryFn: () => call("list-invites"),
  });

  const inviteMutation = useMutation({
    mutationFn: () => call("invite-user", { email, role }),
    onSuccess: () => {
      toast.success("Invitation sent");
      setEmail("");
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

  const invitations = data?.invitations || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="h-4 w-4" /> Invitations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <Button size="sm" onClick={() => inviteMutation.mutate()} disabled={!email.trim()}>
            Invite
          </Button>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="space-y-1">
            {invitations.map((inv: Record<string, unknown>) => (
              <div key={inv.id as string} className="flex items-center justify-between text-xs py-1 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="font-mono">{inv.email as string}</span>
                  <Badge variant="secondary">{inv.role as string}</Badge>
                  {inv.accepted_at ? (
                    <Badge className="bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]">Accepted</Badge>
                  ) : (
                    <Badge variant="outline">Pending</Badge>
                  )}
                </div>
                {!inv.accepted_at && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => revokeMutation.mutate(inv.id as string)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
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

    // Sort by time and take last 60 points
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

// ── Main Settings Page ──────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <SettingsIcon className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>

      <Tabs defaultValue="nas-storage" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="nas-storage">NAS & Storage</TabsTrigger>
          <TabsTrigger value="image-output">Image Output</TabsTrigger>
          <TabsTrigger value="scanning">Scanning</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="install-bundles">Install Bundles</TabsTrigger>
          <TabsTrigger value="windows-agent">Windows Agent</TabsTrigger>
          <TabsTrigger value="taxonomy">APIs & Tagging</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
        </TabsList>

        <TabsContent value="nas-storage" className="space-y-4">
          <NasStorageTab />
        </TabsContent>

        <TabsContent value="image-output" className="space-y-4">
          <ImageOutputTab />
        </TabsContent>

        <TabsContent value="scanning" className="space-y-4">
          <ScanningTab />
        </TabsContent>

        <TabsContent value="agents" className="space-y-4">
          <AgentKeySection />
          <AgentStatusSection />
          <AgentThroughputChart />
          <LiveScanMonitor />
          <UpdateAgentButton />
        </TabsContent>

        <TabsContent value="install-bundles" className="space-y-4">
          <InstallBundleTab />
        </TabsContent>

        <TabsContent value="windows-agent" className="space-y-4">
          <WindowsAgentTab />
        </TabsContent>

        <TabsContent value="taxonomy" className="space-y-4">
          <ApisTab />
        </TabsContent>

        <TabsContent value="users">
          <InvitationSection />
        </TabsContent>

        <TabsContent value="diagnostics" className="space-y-4">
          <DiagnosticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
