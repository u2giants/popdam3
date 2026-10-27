import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Download, ListChecks, Check, Eye, EyeOff, Play, Timer, KeyRound, Save } from "lucide-react";
import { CopyBtn } from "./shared";

export function WindowsAgentDownload() {
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
            {version ? `Download Windows Agent Installer v${version}` : "Download Windows Agent Installer"}
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

export function WindowsAgentSetup({ onTokenGenerated }: { onTokenGenerated: () => void }) {
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
    queryKey: ["admin-config", "windows-agent-nas"],
    queryFn: () => call("get-config", {
      keys: [
        "WINDOWS_AGENT_NAS_HOST",
        "WINDOWS_AGENT_NAS_SHARE",
        "WINDOWS_AGENT_NAS_MOUNT_PATH",
        "WINDOWS_AGENT_SG_NAS_MOUNT_PATH",
        "WINDOWS_AGENT_NAS_USER",
        "WINDOWS_AGENT_RENDER_CONCURRENCY",
      ],
    }),
  });

  const getConfigVal = (key: string): string => {
    const entry = configData?.config?.[key] as { value?: unknown } | string | undefined;
    const val = typeof entry === "object" && entry !== null && "value" in entry ? entry.value : entry;
    return typeof val === "string" ? val : "";
  };

  const [nasHost, setNasHost] = useState("");
  const [nasShare, setNasShare] = useState("");
  const [nasMountPath, setNasMountPath] = useState("");
  const [sgNasMountPath, setSgNasMountPath] = useState("");
  const [nasUser, setNasUser] = useState("");
  const [renderConcurrency, setRenderConcurrency] = useState("6");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (configData && !initialized) {
      setNasHost(getConfigVal("WINDOWS_AGENT_NAS_HOST").replace(/^\\+/, ''));
      setNasShare(getConfigVal("WINDOWS_AGENT_NAS_SHARE").replace(/^\\+/, '').replace(/^\/+/, ''));
      setNasMountPath(getConfigVal("WINDOWS_AGENT_NAS_MOUNT_PATH"));
      setSgNasMountPath(getConfigVal("WINDOWS_AGENT_SG_NAS_MOUNT_PATH"));
      setNasUser(getConfigVal("WINDOWS_AGENT_NAS_USER"));
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
          WINDOWS_AGENT_SG_NAS_MOUNT_PATH: sgNasMountPath.trim().replace(/\\+$/, ''),
          WINDOWS_AGENT_NAS_USER: nasUser,
          WINDOWS_AGENT_RENDER_CONCURRENCY: String(Math.min(32, Math.max(1, parseInt(renderConcurrency) || 6))),
        },
      });
    },
    onSuccess: () => {
      toast.success("Windows Agent NAS config saved");
      queryClient.invalidateQueries({ queryKey: ["admin-config", "windows-agent-nas"] });
      setInitialized(false);
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
                disabled={generateTokenMutation.isPending} title={generateTokenMutation.isPending ? "Generating token…" : undefined}
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
              disabled={generateTokenMutation.isPending} title={generateTokenMutation.isPending ? "Generating token…" : undefined}
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
            <Input placeholder="\\192.0.2.100" value={nasHost} onChange={(e) => setNasHost(e.target.value)} className="font-mono text-xs" />
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
            <label className="text-xs text-muted-foreground font-medium">Style Guide NAS Mount Path <span className="text-muted-foreground/60">(optional)</span></label>
            <Input placeholder="Y:\styleguides" value={sgNasMountPath} onChange={(e) => setSgNasMountPath(e.target.value)} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">Windows mount path for the style guide files (PopSG). Used to render PopSG thumbnails. If the style guide share is the same as the main NAS, leave blank — it falls back to NAS Mount Path.</p>
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
            <p className="text-xs text-muted-foreground">Managed in the server Vault. Not editable here.</p>
          </div>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} title={saveMutation.isPending ? "Saving…" : undefined}>
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
            title={testStatus === "sending" ? "Sending test job…" : testStatus === "polling" ? "Waiting for test result…" : undefined}
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
