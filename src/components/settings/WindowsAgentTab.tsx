import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Monitor, Download, ListChecks, ClipboardList, Copy, Check,
  Eye, EyeOff, RefreshCw, AlertTriangle, Trash2, Play,
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

// ── Section 1: Status ───────────────────────────────────────────────

function WindowsAgentStatus() {
  const { call } = useAdminApi();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-agents"],
    queryFn: () => call("list-agents"),
  });

  const { data: renderData } = useQuery({
    queryKey: ["render-queue-pending-count"],
    queryFn: () => call("render-queue-stats"),
  });

  const agents = (data?.agents || []).filter(
    (a: Record<string, unknown>) => a.type === "windows-render"
  );

  const FIVE_MIN = 5 * 60 * 1000;
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
              return (
                <div key={agent.id as string} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${isOn ? "bg-[hsl(var(--success))]" : "bg-destructive"}`} />
                    <span className="font-medium text-sm">{agent.name as string}</span>
                    <Badge variant={isOn ? "default" : "destructive"}>
                      {isOn ? "Online" : "Offline"}
                    </Badge>
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

// ── Section 3: Setup Instructions ───────────────────────────────────

function WindowsAgentSetup() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const agentApiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-api`;

  // Load existing config values
  const { data: configData } = useQuery({
    queryKey: ["admin-config"],
    queryFn: () => call("get-config"),
  });

  const getConfigVal = (key: string): string => {
    const entry = configData?.config?.[key];
    const val = entry?.value ?? entry;
    return typeof val === "string" ? val : "";
  };

  const [showKey, setShowKey] = useState(false);
  const [nasHost, setNasHost] = useState("");
  const [nasShare, setNasShare] = useState("");
  const [nasUser, setNasUser] = useState("");
  const [nasPass, setNasPass] = useState("");
  const [initialized, setInitialized] = useState(false);

  // Populate fields from config
  useEffect(() => {
    if (configData && !initialized) {
      setNasHost(getConfigVal("WINDOWS_AGENT_NAS_HOST"));
      setNasShare(getConfigVal("WINDOWS_AGENT_NAS_SHARE"));
      setNasUser(getConfigVal("WINDOWS_AGENT_NAS_USER"));
      setNasPass(getConfigVal("WINDOWS_AGENT_NAS_PASS"));
      setInitialized(true);
    }
  }, [configData, initialized]);

  const agentKeyRaw = getConfigVal("AGENT_KEY");
  const maskedKey = agentKeyRaw
    ? "••••••••" + agentKeyRaw.slice(-4)
    : "Not configured";

  const saveMutation = useMutation({
    mutationFn: () =>
      call("set-config", {
        entries: {
          WINDOWS_AGENT_NAS_HOST: nasHost,
          WINDOWS_AGENT_NAS_SHARE: nasShare,
          WINDOWS_AGENT_NAS_USER: nasUser,
          WINDOWS_AGENT_NAS_PASS: nasPass,
        },
      }),
    onSuccess: () => {
      toast.success("Windows Agent NAS config saved");
      queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Test Job ──────────────────────────────────────────────────────

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

      // Poll for completion
      let attempts = 0;
      const maxAttempts = 12; // 60 seconds
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
        {/* Step 1 */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Badge variant="secondary" className="rounded-md px-2">1</Badge> Install
          </h3>
          <p className="text-sm text-muted-foreground">
            Run the downloaded installer on your Windows PC. It will install the PopDAM Windows Agent as a Windows Service that starts automatically.
          </p>
        </div>

        {/* Step 2 */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Badge variant="secondary" className="rounded-md px-2">2</Badge> Configure
          </h3>
          <p className="text-sm text-muted-foreground">
            During installation you will be asked for these values. Copy them from here:
          </p>

          {/* Agent API URL */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Agent API URL</label>
            <div className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
              <code className="text-xs font-mono text-foreground flex-1 break-all">{agentApiUrl}</code>
              <CopyBtn text={agentApiUrl} />
            </div>
          </div>

          {/* Agent Key */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Agent Key</label>
            <div className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
              <code className="text-xs font-mono text-foreground flex-1 break-all">
                {showKey ? agentKeyRaw || "Not configured" : maskedKey}
              </code>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
              {agentKeyRaw && <CopyBtn text={agentKeyRaw} />}
            </div>
            <p className="text-xs text-muted-foreground">Generate a key in the Agents tab if you don't have one yet.</p>
          </div>

          {/* NAS Host */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">NAS Host</label>
            <Input
              placeholder="\\192.168.1.100"
              value={nasHost}
              onChange={(e) => setNasHost(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          {/* NAS Share */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">NAS Share</label>
            <Input
              placeholder="\mac\Decor"
              value={nasShare}
              onChange={(e) => setNasShare(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          {/* NAS Username */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">NAS Username</label>
            <Input
              placeholder="admin"
              value={nasUser}
              onChange={(e) => setNasUser(e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          {/* NAS Password */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">NAS Password</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={nasPass}
              onChange={(e) => setNasPass(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">Stored in your private database. Not transmitted to third parties.</p>
          </div>

          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            Save NAS Settings
          </Button>
        </div>

        {/* Step 3 */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Badge variant="secondary" className="rounded-md px-2">3</Badge> Verify
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

        {/* Step 4 */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Badge variant="secondary" className="rounded-md px-2">4</Badge> Test
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
            <div className="text-sm text-[hsl(var(--success))] mt-1">
              ✓ {testResult}
            </div>
          )}
          {testStatus === "error" && (
            <div className="text-sm text-destructive mt-1">
              ✗ {testResult}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 4: Pending Jobs ─────────────────────────────────────────

function PendingJobsTable() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["render-queue-recent"],
    queryFn: () => call("list-render-jobs"),
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

  const jobs = data?.jobs || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardList className="h-4 w-4" /> Pending Jobs
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
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No render jobs found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Filename</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job: Record<string, unknown>) => (
                <TableRow key={job.id as string}>
                  <TableCell className="font-mono text-xs">{job.filename as string || "—"}</TableCell>
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ── Exported Tab ────────────────────────────────────────────────────

export default function WindowsAgentTab() {
  return (
    <div className="space-y-4">
      <WindowsAgentStatus />
      <WindowsAgentDownload />
      <WindowsAgentSetup />
      <PendingJobsTable />
    </div>
  );
}
