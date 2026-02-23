import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  Monitor, Download, ListChecks, ClipboardList, Copy, Check,
  Eye, EyeOff, RefreshCw, AlertTriangle, Trash2, Play, Timer, KeyRound,
  RotateCcw, X, Image as ImageIcon,
} from "lucide-react";

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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-agents"],
    queryFn: () => call("list-agents"),
    refetchInterval: pollFast ? 10_000 : undefined,
  });

  const { data: renderData } = useQuery({
    queryKey: ["render-queue-pending-count"],
    queryFn: () => call("render-queue-stats"),
  });

  const removeAgentMutation = useMutation({
    mutationFn: (agentId: string) => call("remove-agent-registration", { agent_id: agentId }),
    onSuccess: () => {
      toast.success("Agent registration removed");
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
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : agents.length === 0 ? (
          <div className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>No Windows Render Agent registered. AI files saved without PDF compatibility cannot be thumbnailed until this agent is running.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((agent: Record<string, unknown>) => {
              const isOn = onlineAgents.includes(agent);
              const lastHb = agent.last_heartbeat ? new Date(agent.last_heartbeat as string).getTime() : 0;
              const offlineMs = lastHb > 0 ? Date.now() - lastHb : Infinity;
              const canRemove = !isOn && offlineMs > ONE_HOUR;

              return (
                <div key={agent.id as string} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${isOn ? "bg-[hsl(var(--success))]" : "bg-destructive"}`} />
                    <span className="font-medium text-sm">{agent.name as string}</span>
                    <Badge variant={isOn ? "default" : "destructive"}>
                      {isOn ? "Online" : "Offline"}
                    </Badge>
                    {canRemove && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto gap-1 text-destructive hover:text-destructive h-7 text-xs"
                        onClick={() => removeAgentMutation.mutate(agent.id as string)}
                        disabled={removeAgentMutation.isPending}
                      >
                        <X className="h-3 w-3" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono space-y-0.5">
                    <div>Last heartbeat: {agent.last_heartbeat ? new Date(agent.last_heartbeat as string).toLocaleString() : "never"}</div>
                    <div>Pending render jobs: <span className="text-foreground font-semibold">{pendingRenders}</span></div>
                  </div>
                </div>
              );
            })}
            {onlineAgents.length === 0 && agents.length > 0 && (
              <div className="flex items-start gap-2 text-sm text-warning mt-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>No Windows Render Agent connected. AI files saved without PDF compatibility cannot be thumbnailed until this agent is running.</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 2: Download ─────────────────────────────────────────────

function WindowsAgentDownload() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Download className="h-4 w-4" /> Download
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <a
          href="https://github.com/u2giants/popdam3/releases/latest/download/popdam-windows-agent-setup.exe"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button size="lg" className="w-full gap-2">
            <Download className="h-4 w-4" />
            Download Windows Agent Installer
          </Button>
        </a>
        <p className="text-xs text-muted-foreground">
          Requires Windows 10/11 and Adobe Illustrator (Creative Cloud). The agent runs as a background service.
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
    const entry = configData?.config?.[key];
    const val = entry?.value ?? entry;
    return typeof val === "string" ? val : "";
  };

  const [nasHost, setNasHost] = useState("");
  const [nasShare, setNasShare] = useState("");
  const [nasUser, setNasUser] = useState("");
  const [nasPass, setNasPass] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (configData && !initialized) {
      setNasHost(getConfigVal("WINDOWS_AGENT_NAS_HOST").replace(/^\\+/, ''));
      setNasShare(getConfigVal("WINDOWS_AGENT_NAS_SHARE").replace(/^\\+/, '').replace(/^\/+/, ''));
      setNasUser(getConfigVal("WINDOWS_AGENT_NAS_USER"));
      setNasPass(getConfigVal("WINDOWS_AGENT_NAS_PASS"));
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
          WINDOWS_AGENT_NAS_USER: nasUser,
          WINDOWS_AGENT_NAS_PASS: nasPass,
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
                  {token}
                </code>
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
            <label className="text-xs text-muted-foreground font-medium">NAS Username</label>
            <Input placeholder="admin" value={nasUser} onChange={(e) => setNasUser(e.target.value)} className="font-mono text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">NAS Password</label>
            <Input type="password" placeholder="••••••••" value={nasPass} onChange={(e) => setNasPass(e.target.value)} className="font-mono text-xs" />
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
            <li>Verify Adobe Illustrator is installed and licensed</li>
            <li>Check the Windows Event Log for PopDAM Agent errors</li>
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
  });

  const clearFailedMutation = useMutation({
    mutationFn: () => call("clear-failed-renders"),
    onSuccess: (data) => {
      toast.success(`Cleared ${data.deleted_count ?? 0} failed jobs`);
      queryClient.invalidateQueries({ queryKey: ["render-queue-recent"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-pending-count"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const requeueMutation = useMutation({
    mutationFn: (jobId: string) => call("requeue-render-job", { job_id: jobId }),
    onSuccess: () => {
      toast.success("Job requeued");
      queryClient.invalidateQueries({ queryKey: ["render-queue-recent"] });
      queryClient.invalidateQueries({ queryKey: ["render-queue-pending-count"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const jobs = data?.jobs || [];
  const tabs: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "completed", label: "Completed" },
    { key: "failed", label: "Failed" },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardList className="h-4 w-4" /> Render Jobs
        </CardTitle>
        <div className="flex items-center gap-2">
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
              className="h-7 text-xs"
              onClick={() => setStatusFilter(tab.key)}
            >
              {tab.label}
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
                        <TableCell className="font-mono text-xs max-w-[200px] truncate">{job.filename as string || "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              job.status === "completed" ? "default" :
                              job.status === "failed" ? "destructive" :
                              "secondary"
                            }
                          >
                            {job.status as string}
                          </Badge>
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

// ── Exported Tab ────────────────────────────────────────────────────

export default function WindowsAgentTab() {
  const [pollFast, setPollFast] = useState(false);

  return (
    <div className="space-y-4">
      <WindowsAgentStatus pollFast={pollFast} />
      <WindowsAgentDownload />
      <WindowsAgentSetup onTokenGenerated={() => setPollFast(true)} />
      <RenderJobsTable />
    </div>
  );
}
