import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { formatFilename } from "@/lib/format-filename";
import {
  Monitor, Download, ListChecks, ClipboardList, Copy, Check,
  Eye, EyeOff, RefreshCw, AlertTriangle, Trash2, Play, Timer, KeyRound,
  RotateCcw, X, Image as ImageIcon, Settings2, ArrowUpCircle, Save,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── Copy Button ─────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={copy}>
      {copied ? <Check className="h-3 w-3 text-[hsl(var(--success))]" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

// ── Duration formatter ──────────────────────────────────────────────

function formatDuration(createdAt: string, completedAt: string): string {
  const ms = new Date(completedAt).getTime() - new Date(createdAt).getTime();
  if (ms < 0) return "—";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

// ── Section 1: Status ───────────────────────────────────────────────

function WindowsAgentStatus({ pollFast }: { pollFast?: boolean }) {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch, isRefetching, dataUpdatedAt } = useQuery({
    queryKey: ["admin-agents"],
    queryFn: () => call("list-agents"),
    refetchInterval: 10_000,
  });

  // "Last updated X seconds ago" live counter
  const [secondsAgo, setSecondsAgo] = useState(0);
  useEffect(() => {
    if (!dataUpdatedAt) return;
    const tick = () => setSecondsAgo(Math.floor((Date.now() - dataUpdatedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [dataUpdatedAt]);

  const { data: renderData } = useQuery({
    queryKey: ["render-queue-pending-count"],
    queryFn: () => call("render-queue-stats"),
    refetchInterval: 5_000,
  });

  const removeAgentMutation = useMutation({
    mutationFn: (agentId: string) => call("remove-agent-registration", { agent_id: agentId }),
    onSuccess: () => {
      toast.success("Agent registration removed");
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const triggerUpdateMutation = useMutation({
    mutationFn: (agentId: string) => call("trigger-windows-update", { agent_id: agentId }),
    onSuccess: () => {
      toast.success("Update check triggered — agent will check and update if available");
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const agents = (data?.agents || []).filter(
    (a: Record<string, unknown>) => a.type === "windows-render"
  );

  const FIVE_MIN = 5 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;

  const onlineAgents = agents.filter((a: Record<string, unknown>) => {
    if (!a.last_heartbeat) return false;
    return Date.now() - new Date(a.last_heartbeat as string).getTime() < FIVE_MIN;
  });

  const pendingRenders = renderData?.pending_count ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Monitor className="h-4 w-4" /> Windows Agent Status
          <Badge variant="outline" className="ml-1 gap-1 text-[10px] font-medium text-[hsl(var(--success))]">
            <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))] animate-pulse" />
            Live
          </Badge>
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : agents.length === 0 ? (
          <div className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>No Windows Render Agent registered. Files that can't be thumbnailed by the Bridge Agent will be queued here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((agent: Record<string, unknown>) => {
              const isOn = onlineAgents.includes(agent);
              const lastHb = agent.last_heartbeat ? new Date(agent.last_heartbeat as string).getTime() : 0;
              const offlineMs = lastHb > 0 ? Date.now() - lastHb : Infinity;
              const canRemove = !isOn && offlineMs > ONE_HOUR;

              // Health payload from preflight
              const meta = agent.metadata as Record<string, unknown> | undefined;
              const health = meta?.health as Record<string, unknown> | undefined;
              const isHealthy = health?.healthy === true;
              const nasHealthy = health?.nas_healthy === true;
              const preflightError = health?.last_preflight_error as string | null;
              const hasHealth = health !== undefined;

              // Version info
              const versionInfo = meta?.version_info as Record<string, unknown> | undefined;
              const currentVersion = versionInfo?.version as string | null;
              const updateAvailable = versionInfo?.update_available === true;
              const latestVersion = versionInfo?.latest_version as string | null;
              const lastUpdateCheck = versionInfo?.last_update_check as string | null;
              const isUpdating = versionInfo?.updating === true;
              const updateError = versionInfo?.update_error as string | null;

              return (
                <div key={agent.id as string} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${isOn ? "bg-[hsl(var(--success))]" : "bg-destructive"}`} />
                    <span className="font-medium text-sm">{agent.name as string}</span>
                    <Badge variant={isOn ? "default" : "destructive"}>
                      {isOn ? "Online" : "Offline"}
                    </Badge>
                    {isOn && hasHealth && (
                      <Badge variant={isHealthy ? "default" : "destructive"} className={isHealthy ? "bg-[hsl(var(--success))] text-[hsl(var(--success-foreground,0_0%_100%))]" : ""}>
                        {isHealthy ? "Healthy" : "Unhealthy"}
                      </Badge>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      {isOn && updateAvailable && !isUpdating && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 h-7 text-xs"
                          onClick={() => triggerUpdateMutation.mutate(agent.id as string)}
                          disabled={triggerUpdateMutation.isPending}
                        >
                          <ArrowUpCircle className="h-3 w-3" />
                          Update Now
                        </Button>
                      )}
                      {canRemove && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-destructive hover:text-destructive h-7 text-xs"
                          onClick={() => {
                            if (window.confirm("Remove this offline agent? This cannot be undone.")) {
                              removeAgentMutation.mutate(agent.id as string);
                            }
                          }}
                          disabled={removeAgentMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono space-y-0.5">
                    <div>Last heartbeat: {agent.last_heartbeat ? new Date(agent.last_heartbeat as string).toLocaleString() : "never"}</div>
                    <div>Pending render jobs: <span className="text-foreground font-semibold">{pendingRenders}</span></div>
                    {currentVersion && (
                      <div className="flex items-center gap-2">
                        Version: <Badge variant="outline" className="text-[10px] h-5">{currentVersion}</Badge>
                        {updateAvailable && latestVersion && (
                          <Badge variant="secondary" className="text-[10px] h-5 gap-1 text-[hsl(var(--warning))]">
                            <ArrowUpCircle className="h-3 w-3" />
                            {latestVersion} available
                          </Badge>
                        )}
                        {isUpdating && (
                          <Badge variant="secondary" className="text-[10px] h-5 gap-1 animate-pulse">
                            <RefreshCw className="h-3 w-3 animate-spin" />
                            Updating...
                          </Badge>
                        )}
                      </div>
                    )}
                    {lastUpdateCheck && (
                      <div>Last update check: {new Date(lastUpdateCheck).toLocaleString()}</div>
                    )}
                    {(meta?.last_updated_at || meta?.started_at) && (
                      <div>Last updated: {new Date((meta?.last_updated_at ?? meta?.started_at) as string).toLocaleString()}</div>
                    )}
                    {updateError && (
                      <div className="text-destructive">Update error: {updateError}</div>
                    )}
                  </div>
                  {isOn && hasHealth && (
                    <div className="text-xs space-y-1 mt-1">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${nasHealthy ? "bg-[hsl(var(--success))]" : "bg-destructive"}`} />
                          NAS Access
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                          Renderer: Sharp + Ghostscript
                        </span>
                      </div>
                      {!isHealthy && preflightError && (
                        <div className="flex items-start gap-1.5 text-destructive bg-destructive/10 rounded px-2 py-1.5 mt-1">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          <span className="break-all">{preflightError}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {onlineAgents.length === 0 && agents.length > 0 && (
              <div className="flex items-start gap-2 text-sm text-warning mt-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>No Windows Render Agent connected. Files that can't be thumbnailed by the Bridge Agent will be queued here.</p>
              </div>
            )}
          </div>
        )}
        {dataUpdatedAt > 0 && (
          <p className="text-[10px] text-muted-foreground mt-3">
            Last updated: {secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 2: Download ─────────────────────────────────────────────

function WindowsAgentDownload() {
  const { call } = useAdminApi();
  const { data: buildData, isLoading } = useQuery({
    queryKey: ["windows-latest-build"],
    queryFn: () => call("get-config", { keys: ["WINDOWS_LATEST_BUILD"] }),
  });

  const val = (buildData?.config?.WINDOWS_LATEST_BUILD?.value ?? buildData?.config?.WINDOWS_LATEST_BUILD) as Record<string, string> | undefined;
  const installerUrl = val?.installer_url || "https://github.com/u2giants/popdam3/releases/latest/download/popdam-windows-agent-setup.exe";
  const version = val?.version;
  const publishedAt = val?.published_at;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="h-4 w-4" /> Download
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <a href={installerUrl} target="_blank" rel="noopener noreferrer">
          <Button size="lg" className="w-full gap-2">
            <Download className="h-4 w-4" />
            Download Windows Agent Installer
            {version && <Badge variant="secondary" className="ml-1 text-[10px]">v{version}</Badge>}
          </Button>
        </a>
        {publishedAt && (
          <p className="text-[10px] text-muted-foreground">
            Published: {new Date(publishedAt).toLocaleString()}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Requires Windows 10/11 with Ghostscript installed. The agent runs as a startup application and uses Sharp + Ghostscript + ImageMagick for rendering (no Illustrator required).
        </p>
      </CardContent>
    </Card>
  );
}

// ── Section 3: Install Token + Setup ────────────────────────────────

function WindowsAgentSetup({ onTokenGenerated }: { onTokenGenerated: () => void }) {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  // ── Bootstrap Token ──
  const [token, setToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generateTokenMutation = useMutation({
    mutationFn: () => call("generate-bootstrap-token"),
    onSuccess: (data) => {
      setToken(data.token);
      setExpiresAt(new Date(data.expires_at));
      onTokenGenerated();
      toast.success("Install token generated");
    },
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setToken(null);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [expiresAt]);

  const isExpired = expiresAt ? Date.now() > expiresAt.getTime() : false;
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  // ── NAS Config ──
  const { data: configData } = useQuery({
    queryKey: ["admin-config"],
    queryFn: () => call("get-config"),
  });

  const getConfigVal = (key: string): string => {
    const entry = configData?.config?.[key] as { value?: unknown } | string | undefined;
    const val = typeof entry === "object" && entry !== null && "value" in entry ? entry.value : entry;
    return typeof val === "string" ? val : "";
  };

  const [nasHost, setNasHost] = useState("");
  const [nasShare, setNasShare] = useState("");
  const [nasMountPath, setNasMountPath] = useState("");
  const [nasUser, setNasUser] = useState("");
  const [nasPass, setNasPass] = useState("");
  const [showNasPass, setShowNasPass] = useState(false);
  const [renderConcurrency, setRenderConcurrency] = useState("6");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (configData && !initialized) {
      setNasHost(getConfigVal("WINDOWS_AGENT_NAS_HOST").replace(/^\\+/, ''));
      setNasShare(getConfigVal("WINDOWS_AGENT_NAS_SHARE").replace(/^\\+/, '').replace(/^\/+/, ''));
      setNasMountPath(getConfigVal("WINDOWS_AGENT_NAS_MOUNT_PATH"));
      setNasUser(getConfigVal("WINDOWS_AGENT_NAS_USER"));
      setNasPass(getConfigVal("WINDOWS_AGENT_NAS_PASS"));
      setRenderConcurrency(getConfigVal("WINDOWS_AGENT_RENDER_CONCURRENCY") || "6");
      setInitialized(true);
    }
  }, [configData, initialized]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const cleanHost = nasHost.replace(/^\\+/, '');
      const cleanShare = nasShare.replace(/^\\+/, '').replace(/^\/+/, '');
      return call("set-config", {
        entries: {
          WINDOWS_AGENT_NAS_HOST: cleanHost,
          WINDOWS_AGENT_NAS_SHARE: cleanShare,
          WINDOWS_AGENT_NAS_MOUNT_PATH: nasMountPath.trim().replace(/\\+$/, ''),
          WINDOWS_AGENT_NAS_USER: nasUser,
          WINDOWS_AGENT_NAS_PASS: nasPass,
          WINDOWS_AGENT_RENDER_CONCURRENCY: String(Math.min(32, Math.max(1, parseInt(renderConcurrency) || 6))),
        },
      });
    },
    onSuccess: () => {
      toast.success("Windows Agent NAS config saved");
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Test Job ──
  const [testStatus, setTestStatus] = useState<"idle" | "sending" | "polling" | "success" | "error">("idle");
  const [testResult, setTestResult] = useState<string | null>(null);

  const sendTestJob = async () => {
    setTestStatus("sending");
    setTestResult(null);
    try {
      const result = await call("send-test-render");
      if (!result.ok) throw new Error(result.error || "Failed to send test job");
      const jobId = result.job_id as string;
      setTestStatus("polling");
      let attempts = 0;
      const maxAttempts = 12;
      const poll = async () => {
        attempts++;
        const status = await call("check-render-job", { job_id: jobId });
        if (status.status === "completed") {
          setTestStatus("success");
          setTestResult(status.thumbnail_url as string || "Completed successfully");
          return;
        }
        if (status.status === "failed") {
          setTestStatus("error");
          setTestResult(status.error_message as string || "Render failed");
          return;
        }
        if (attempts >= maxAttempts) {
          setTestStatus("error");
          setTestResult("Timed out after 60 seconds. The agent may be offline or busy.");
          return;
        }
        setTimeout(poll, 5000);
      };
      poll();
    } catch (e: unknown) {
      setTestStatus("error");
      setTestResult(e instanceof Error ? e.message : "Unknown error");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="h-4 w-4" /> Setup Instructions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Step 1: Generate Install Token */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Badge variant="secondary" className="rounded-md px-2">1</Badge> Generate Install Token
          </h3>
          <p className="text-sm text-muted-foreground">
            Generate a one-time install token. You'll paste this during the Windows agent installation.
          </p>

          {token && !isExpired ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 bg-muted/50 rounded-lg px-4 py-3 border border-border">
                <KeyRound className="h-5 w-5 text-primary shrink-0" />
                <code className="text-lg font-mono font-bold tracking-widest text-foreground flex-1">
                  {showToken ? token : "••••••••••••"}
                </code>
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <CopyBtn text={token} />
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Timer className="h-4 w-4 text-[hsl(var(--warning))]" />
                <span className="text-[hsl(var(--warning))] font-medium">
                  Expires in {minutes}:{seconds.toString().padStart(2, "0")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                During Windows agent installation, paste this token when prompted. It expires in 5 minutes and can only be used once.
              </p>
            </div>
          ) : token && isExpired ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive font-medium">Token expired — generate a new one.</p>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => generateTokenMutation.mutate()}
                disabled={generateTokenMutation.isPending}
              >
                <KeyRound className="h-3.5 w-3.5" />
                Generate New Token
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => generateTokenMutation.mutate()}
              disabled={generateTokenMutation.isPending}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {generateTokenMutation.isPending ? "Generating..." : "Generate Install Token"}
            </Button>
          )}
        </div>

        {/* Step 2: Install */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Badge variant="secondary" className="rounded-md px-2">2</Badge> Install
          </h3>
          <p className="text-sm text-muted-foreground">
            Run the downloaded installer on your Windows PC. When prompted, paste the install token from Step 1. The agent will authenticate itself automatically — no other configuration is needed during installation.
          </p>
           <p className="text-xs text-muted-foreground mt-1.5 bg-muted/50 border border-border rounded-md px-3 py-2">
             The installer places a shortcut in your Windows Startup folder (shell:startup) so the agent launches automatically when you log in. Ghostscript should be installed for best results.
           </p>
        </div>

        {/* Step 3: NAS Config */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Badge variant="secondary" className="rounded-md px-2">3</Badge> NAS Access
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure the NAS network share that the Windows agent uses to access design files. These settings are delivered to the agent automatically.
          </p>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">NAS Host</label>
            <Input placeholder="\\192.168.1.100" value={nasHost} onChange={(e) => setNasHost(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">NAS Share</label>
            <Input placeholder="\mac\Decor" value={nasShare} onChange={(e) => setNasShare(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">NAS Mount Path <span className="text-muted-foreground/60">(optional)</span></label>
            <Input placeholder="Z:\mac\Decor" value={nasMountPath} onChange={(e) => setNasMountPath(e.target.value)} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">If the NAS share is mapped to a drive letter (e.g. Z:), set it here. Sharp and Ghostscript cannot read UNC paths — a mapped drive is required for reliable rendering.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Render Concurrency</label>
            <Input
              type="number"
              min={1}
              max={32}
              placeholder="6"
              value={renderConcurrency}
              onChange={(e) => setRenderConcurrency(e.target.value)}
              className="font-mono text-xs max-w-[120px]"
            />
            <p className="text-xs text-muted-foreground">Number of parallel render jobs (1–32). Default: 6.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">NAS Username</label>
            <Input placeholder="admin" value={nasUser} onChange={(e) => setNasUser(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">NAS Password</label>
            <div className="relative">
              <Input type={showNasPass ? "text" : "password"} placeholder="••••••••" value={nasPass} onChange={(e) => setNasPass(e.target.value)} className="font-mono text-xs pr-10" />
              <button
                type="button"
                onClick={() => setShowNasPass(!showNasPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNasPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Stored in your private database. Delivered to the agent automatically — no file editing required.</p>
          </div>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            Save NAS Settings
          </Button>
        </div>

        {/* Step 4: Verify */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Badge variant="secondary" className="rounded-md px-2">4</Badge> Verify
          </h3>
          <p className="text-sm text-muted-foreground">
            After installation, the agent should appear as Online in the Status section above within 60 seconds. If it doesn't:
          </p>
           <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
             <li>Check that your firewall allows outbound HTTPS (port 443)</li>
             <li>Verify Ghostscript is installed (download from ghostscript.com)</li>
             <li>To restart: open Task Manager, end the PopDAM Windows Agent process, then run the application again from C:\Program Files\PopDAM\WindowsAgent\PopDAMWindowsAgent.exe</li>
           </ul>
        </div>

        {/* Step 5: Test */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Badge variant="secondary" className="rounded-md px-2">5</Badge> Test
          </h3>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={sendTestJob}
            disabled={testStatus === "sending" || testStatus === "polling"}
          >
            <Play className="h-3.5 w-3.5" />
            {testStatus === "sending" ? "Sending..." : testStatus === "polling" ? "Waiting for result..." : "Send Test Job"}
          </Button>
          {testStatus === "success" && (
            <div className="text-sm text-[hsl(var(--success))] mt-1">✓ {testResult}</div>
          )}
          {testStatus === "error" && (
            <div className="text-sm text-destructive mt-1">✗ {testResult}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 4: Render Jobs ──────────────────────────────────────────

type StatusFilter = "all" | "pending" | "completed" | "failed";

function getRenderStatusTooltip(job: Record<string, unknown>): string {
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

function RenderJobsTable() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

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

  const jobs = data?.jobs || [];

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
            disabled={requeueAllMutation.isPending}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {requeueAllMutation.isPending ? "Queueing..." : "Requeue All No-Preview"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => clearJunkMutation.mutate()}
            disabled={clearJunkMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {clearJunkMutation.isPending ? "Clearing..." : "Clear Junk Files"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive"
            onClick={() => clearFailedMutation.mutate()}
            disabled={clearFailedMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear Failed
          </Button>
          <Button variant="ghost" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status filter tabs */}
        <div className="flex gap-1 border-b border-border pb-2">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              variant={statusFilter === tab.key ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => setStatusFilter(tab.key)}
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
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job: Record<string, unknown>) => {
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
                                  disabled={requeueMutation.isPending}
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
      </CardContent>
    </Card>
  );
}

// ── Section 5: Render Policy ────────────────────────────────────────

interface RenderPolicy {
  mode: "fallback_only" | "shared" | "primary";
  shared_percent: number;
  shared_types: string[];
  shared_min_mb: number;
  require_windows_healthy: boolean;
  max_pending_jobs: number;
  final_fallback_on_local_failure: boolean;
}

const DEFAULT_POLICY: RenderPolicy = {
  mode: "fallback_only",
  shared_percent: 30,
  shared_types: ["psd", "ai"],
  shared_min_mb: 0,
  require_windows_healthy: true,
  max_pending_jobs: 500,
  final_fallback_on_local_failure: true,
};

function RenderPolicyEditor() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data: configData, isLoading } = useQuery({
    queryKey: ["admin-config", "WINDOWS_RENDER_POLICY"],
    queryFn: () => call("get-config", { keys: ["WINDOWS_RENDER_POLICY"] }),
  });

  const savedPolicy: RenderPolicy = (() => {
    const entry = (
      configData?.config?.WINDOWS_RENDER_POLICY?.value ?? configData?.config?.WINDOWS_RENDER_POLICY
    ) as RenderPolicy | null;
    return entry && typeof entry === "object" ? { ...DEFAULT_POLICY, ...entry } : DEFAULT_POLICY;
  })();

  const [form, setForm] = useState<RenderPolicy | null>(null);
  const policy = form ?? savedPolicy;
  const isDirty = form !== null;

  const update = (patch: Partial<RenderPolicy>) => setForm({ ...policy, ...patch });

  const saveMutation = useMutation({
    mutationFn: () => call("set-config", { entries: { WINDOWS_RENDER_POLICY: policy } }),
    onSuccess: () => {
      toast.success("Render policy saved — takes effect on next heartbeat");
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <Card><CardContent className="py-6"><p className="text-sm text-muted-foreground">Loading...</p></CardContent></Card>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings2 className="h-4 w-4" /> Windows Render Policy
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Mode</Label>
          <Select value={policy.mode} onValueChange={(v) => update({ mode: v as RenderPolicy["mode"] })}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fallback_only">Fallback Only</SelectItem>
              <SelectItem value="shared">Shared (load sharing)</SelectItem>
              <SelectItem value="primary">Windows Primary</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {policy.mode === "fallback_only" && "Bridge generates all thumbnails locally. Windows only handles local failures."}
            {policy.mode === "shared" && "Bridge offloads a percentage of thumbnails to Windows while still doing local work."}
            {policy.mode === "primary" && "Bridge skips all local thumbnails — everything goes to Windows."}
          </p>
        </div>

        {/* Shared-mode settings */}
        {policy.mode === "shared" && (
          <div className="rounded-md border border-border bg-muted/20 p-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Offload Percentage: {policy.shared_percent}%</Label>
              <Slider
                value={[policy.shared_percent]}
                onValueChange={([v]) => update({ shared_percent: v })}
                min={5} max={95} step={5}
                className="max-w-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                {policy.shared_percent}% of eligible files will be sent to Windows for rendering.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">File Types to Share</Label>
              <div className="flex gap-3">
                {(["psd", "ai"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={policy.shared_types.includes(t)}
                      onChange={(e) => {
                        const types = e.target.checked
                          ? [...policy.shared_types, t]
                          : policy.shared_types.filter((x) => x !== t);
                        update({ shared_types: types });
                      }}
                      className="rounded border-border"
                    />
                    .{t.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Minimum File Size (MB)</Label>
              <Input
                type="number"
                className="max-w-[120px] text-xs font-mono"
                value={policy.shared_min_mb}
                onChange={(e) => update({ shared_min_mb: Math.max(0, Number(e.target.value)) })}
                min={0}
              />
              <p className="text-[11px] text-muted-foreground">
                Only offload files larger than this. 0 = no minimum.
              </p>
            </div>
          </div>
        )}

        <Separator />

        {/* Common settings */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Final Fallback on Local Failure</Label>
              <p className="text-[11px] text-muted-foreground">
                If Bridge fails to thumbnail any file, queue it to Windows automatically.
              </p>
            </div>
            <Switch
              checked={policy.final_fallback_on_local_failure}
              onCheckedChange={(v) => update({ final_fallback_on_local_failure: v })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Require Windows Agent Healthy</Label>
              <p className="text-[11px] text-muted-foreground">
                Only offload if Windows agent has passed its last preflight check.
              </p>
            </div>
            <Switch
              checked={policy.require_windows_healthy}
              onCheckedChange={(v) => update({ require_windows_healthy: v })}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Max Pending Jobs</Label>
            <Input
              type="number"
              className="max-w-[120px] text-xs font-mono"
              value={policy.max_pending_jobs}
              onChange={(e) => update({ max_pending_jobs: Math.max(1, Number(e.target.value)) })}
              min={1}
            />
            <p className="text-[11px] text-muted-foreground">
              Stop queuing new render jobs when this many are already pending.
            </p>
          </div>
        </div>

        {isDirty && (
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" /> Save Policy
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Exported Tab ────────────────────────────────────────────────────

export default function WindowsAgentTab() {
  const [pollFast, setPollFast] = useState(false);

  return (
    <div className="space-y-4">
      <WindowsAgentStatus pollFast={pollFast} />
      <RenderPolicyEditor />
      <WindowsAgentDownload />
      <WindowsAgentSetup onTokenGenerated={() => setPollFast(true)} />
      <RenderJobsTable />
    </div>
  );
}
