import { useState, useEffect } from "react";
import { Wand2, Copy, Check, ChevronRight, ChevronLeft, Wifi, WifiOff, Loader2 } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

function CopyBlock({ label, content }: { label: string; content: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-semibold">{label}</span>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={copy}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="bg-[hsl(var(--surface-overlay))] border border-border rounded-md p-3 text-xs font-mono whitespace-pre-wrap overflow-auto max-h-[400px] text-foreground">
        {content}
      </pre>
    </div>
  );
}

interface WizardState {
  agentName: string;
  supabaseUrl: string;
  doSpacesKey: string;
  doSpacesSecret: string;
  doSpacesBucket: string;
  doSpacesRegion: string;
  doSpacesEndpoint: string;
  nasHostPath: string;
  nasContainerMount: string;
  scanRoots: string;
  thumbConcurrency: string;
  cpuShares: string;
  memLimit: string;
  generatedKey: string | null;
}

const INITIAL_STATE: WizardState = {
  agentName: "synology-bridge-1",
  supabaseUrl: "",
  doSpacesKey: "",
  doSpacesSecret: "",
  doSpacesBucket: "popdam",
  doSpacesRegion: "nyc3",
  doSpacesEndpoint: "https://nyc3.digitaloceanspaces.com",
  nasHostPath: "/volume1/mac",
  nasContainerMount: "/mnt/nas/mac",
  scanRoots: "/mnt/nas/mac",
  thumbConcurrency: "2",
  cpuShares: "1024",
  memLimit: "2g",
  generatedKey: null,
};

const STEPS = [
  { title: "Agent Identity", description: "Name your Bridge Agent" },
  { title: "Cloud API", description: "Connect to PopDAM cloud" },
  { title: "DigitalOcean Spaces", description: "Thumbnail storage credentials" },
  { title: "NAS Mounts", description: "Container filesystem mapping" },
  { title: "Resource Limits", description: "CPU, memory, and concurrency" },
  { title: "Generate & Deploy", description: "Get .env and docker-compose.yml" },
];

function ConnectivityTest({ agentName }: { agentName: string }) {
  const { call } = useAdminApi();
  const [status, setStatus] = useState<"idle" | "checking" | "online" | "offline">("idle");

  const check = async () => {
    setStatus("checking");
    try {
      const result = await call("list-agents");
      const agents = result?.agents || [];
      const match = agents.find((a: Record<string, unknown>) => a.name === agentName && a.status === "online");
      setStatus(match ? "online" : "offline");
    } catch {
      setStatus("offline");
    }
  };

  return (
    <div className="border border-border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Connectivity Test</span>
        <Button size="sm" variant="outline" onClick={check} disabled={status === "checking"} className="gap-1.5 text-xs">
          {status === "checking" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
          Test Connection
        </Button>
      </div>
      {status === "online" && (
        <div className="flex items-center gap-2 text-xs text-[hsl(var(--success))]">
          <Wifi className="h-3.5 w-3.5" />
          <span className="font-semibold">Agent "{agentName}" is online and connected!</span>
        </div>
      )}
      {status === "offline" && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <WifiOff className="h-3.5 w-3.5" />
          <span>Agent "{agentName}" not detected yet. Deploy the container and wait ~30 seconds, then try again.</span>
        </div>
      )}
    </div>
  );
}

export default function SetupPage() {
  const { call } = useAdminApi();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  // Pre-fill supabase URL from env
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";

  const { data: configData } = useQuery({
    queryKey: ["admin-config"],
    queryFn: () => call("get-config"),
  });

  const generateKeyMutation = useMutation({
    mutationFn: () => call("generate-agent-key", { agent_name: state.agentName, agent_type: "bridge" }),
    onSuccess: (data) => {
      setState((s) => ({ ...s, generatedKey: data.agent_key }));
      toast.success("Agent key generated — it's embedded in the .env below.");
    },
    onError: (e) => toast.error(e.message),
  });

  const update = (field: keyof WizardState, value: string) =>
    setState((s) => ({ ...s, [field]: value }));

  const canAdvance = () => {
    switch (step) {
      case 0: return state.agentName.trim().length > 0;
      case 1: return true; // supabaseUrl auto-filled
      case 2: return state.doSpacesKey.trim().length > 0 && state.doSpacesSecret.trim().length > 0;
      case 3: return (state.nasHostPath || "").trim().length > 0 && (state.nasContainerMount || "").trim().length > 0;
      case 4: return true;
      default: return true;
    }
  };

  const effectiveUrl = state.supabaseUrl || supabaseUrl;

  const envContent = `# PopDAM Bridge Agent Configuration
# Generated by PopDAM Setup Wizard

# Cloud API connection (outbound HTTPS only — no inbound NAS networking)
SUPABASE_URL=${effectiveUrl}
AGENT_KEY=${state.generatedKey || "<generate key above>"}

# DigitalOcean Spaces (thumbnail upload)
DO_SPACES_KEY=${state.doSpacesKey}
DO_SPACES_SECRET=${state.doSpacesSecret}
DO_SPACES_BUCKET=${state.doSpacesBucket}
DO_SPACES_REGION=${state.doSpacesRegion}
DO_SPACES_ENDPOINT=${state.doSpacesEndpoint}

# NAS filesystem (container mount paths)
NAS_CONTAINER_MOUNT_ROOT=${state.nasContainerMount}
SCAN_ROOTS=${state.scanRoots}

# Performance (resource bounding per WORKER_LOGIC.md)
THUMB_CONCURRENCY=${state.thumbConcurrency}
INGEST_BATCH_SIZE=100
`;

  const composeContent = `# PopDAM Bridge Agent — docker-compose.yml
# Deploy via Synology Container Manager > Project > Import
# No source code on NAS — pre-built image only.
# NOTE: Uses cpu_shares (not cpus/NanoCPUs) for Synology kernel compatibility.
#   256 shares ≈ 20% priority, 1024 ≈ default, 8192 ≈ 80% priority.

version: "3.8"
services:
  bridge-agent:
    image: ghcr.io/u2giants/popdam-bridge:latest
    container_name: popdam-bridge
    restart: unless-stopped
    env_file: .env
    cpu_shares: ${state.cpuShares}
    mem_limit: ${state.memLimit}
    volumes:
      - ${state.nasHostPath}:${state.nasContainerMount}:ro
`;

  return (
    <div className="container max-w-3xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Wand2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Setup Wizard</h1>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 flex-wrap">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-1">
            <button
              onClick={() => setStep(i)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${
                i === step
                  ? "bg-primary text-primary-foreground font-semibold"
                  : i < step
                  ? "bg-[hsl(var(--success)/0.2)] text-[hsl(var(--success))]"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {i + 1}. {s.title}
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{STEPS[step].description}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Agent Name</label>
              <Input
                value={state.agentName}
                onChange={(e) => update("agentName", e.target.value)}
                placeholder="synology-bridge-1"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">A unique name to identify this Bridge Agent in the admin dashboard.</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Cloud API URL</label>
                <Input
                  value={state.supabaseUrl || supabaseUrl}
                  onChange={(e) => update("supabaseUrl", e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">Auto-detected from this project. The Bridge Agent calls this URL outbound over HTTPS — no inbound NAS networking required.</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                These credentials are for the Bridge Agent to upload thumbnails to DigitalOcean Spaces.
                They are stored ONLY in the agent's .env file on the NAS — never in the cloud DB.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Spaces Key</label>
                  <Input value={state.doSpacesKey} onChange={(e) => update("doSpacesKey", e.target.value)} className="font-mono text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Spaces Secret</label>
                  <Input value={state.doSpacesSecret} onChange={(e) => update("doSpacesSecret", e.target.value)} type="password" className="font-mono text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Bucket</label>
                  <Input value={state.doSpacesBucket} onChange={(e) => update("doSpacesBucket", e.target.value)} className="font-mono text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Region</label>
                  <Input value={state.doSpacesRegion} onChange={(e) => update("doSpacesRegion", e.target.value)} className="font-mono text-xs" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Endpoint URL</label>
                <Input value={state.doSpacesEndpoint} onChange={(e) => update("doSpacesEndpoint", e.target.value)} className="font-mono text-xs" />
              </div>
            </div>
          )}

          {step === 3 && (() => {
            const containerMount = state.nasContainerMount || "/mnt/nas/mac";
            const scanRootsList = (state.scanRoots || "").split(",").map(s => s.trim()).filter(Boolean);
            const toggleScanRoot = (folder: string) => {
              const root = `${containerMount}/${folder}`;
              const updated = scanRootsList.includes(root)
                ? scanRootsList.filter(r => r !== root)
                : [...scanRootsList, root];
              update("scanRoots", updated.length > 0 ? updated.join(",") : containerMount);
            };
            const isScanRootSelected = (folder: string) => scanRootsList.includes(`${containerMount}/${folder}`);
            const isAllSelected = scanRootsList.length === 1 && scanRootsList[0] === containerMount;

            return (
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground font-semibold">Host Path (Synology volume)</label>
                <Input value={state.nasHostPath || ""} onChange={(e) => update("nasHostPath", e.target.value)} className="font-mono text-xs" />
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "/volume1/mac",
                    "/volume1/styleguides",
                    "/volume1/oldStyleguides",
                    "/volume1/freelancers",
                    "/volume1/Coldlion",
                    "/volume1/files",
                  ].map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        update("nasHostPath", p);
                        update("scanRoots", state.nasContainerMount || "/mnt/nas/mac");
                      }}
                      className={`text-xs px-2 py-1 rounded border transition-colors ${
                        (state.nasHostPath || "") === p
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground font-semibold">Container Mount Path</label>
                <Input value={state.nasContainerMount || ""} onChange={(e) => update("nasContainerMount", e.target.value)} className="font-mono text-xs" />
                <p className="text-xs text-muted-foreground">Path inside the Docker container (read-only). Usually fine to leave as default.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground font-semibold">Scan Roots <span className="font-normal">(click to toggle — multi-select)</span></label>
                <Input value={state.scanRoots || ""} onChange={(e) => update("scanRoots", e.target.value)} className="font-mono text-xs" />

                <button
                  onClick={() => update("scanRoots", containerMount)}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    isAllSelected
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  ✦ Scan everything (recursive)
                </button>

                {(state.nasHostPath || "") === "/volume1/mac" && (
                  <>
                    <p className="text-xs text-muted-foreground font-semibold mt-1">mac/ subfolders</p>
                    <div className="flex flex-wrap gap-1.5">
                      {["Art Library", "Decor", "Books", "Gift Bags", "SCOTT", "Fonts", "Old", "icons"].map((f) => (
                        <button
                          key={f}
                          onClick={() => toggleScanRoot(f)}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${
                            isScanRootSelected(f)
                              ? "border-primary bg-primary/10 text-primary font-semibold"
                              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>

                    <p className="text-xs text-muted-foreground font-semibold mt-1">Decor/ subfolders</p>
                    <div className="flex flex-wrap gap-1.5">
                      {["Character Licensed", "Generic Decor", "Generic_Images", "Images", "Other Licensed", "Styleguides", "Gina's Design Team", "Books"].map((f) => (
                        <button
                          key={f}
                          onClick={() => toggleScanRoot(`Decor/${f}`)}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${
                            isScanRootSelected(`Decor/${f}`)
                              ? "border-primary bg-primary/10 text-primary font-semibold"
                              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <p className="text-xs text-muted-foreground">Selected roots appear in the text field above. Click folders to toggle.</p>
              </div>
            </div>
            );
          })()}

          {step === 4 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Per WORKER_LOGIC.md: resource limits are <strong>required</strong>, not optional.
                These prevent the Bridge Agent from starving other NAS workloads.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">CPU Shares</label>
                  <Input value={state.cpuShares} onChange={(e) => update("cpuShares", e.target.value)} className="font-mono text-xs" />
                  <p className="text-xs text-muted-foreground">256 = ~20% · 1024 = default · 8192 = ~80%</p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Memory Limit</label>
                  <Input value={state.memLimit} onChange={(e) => update("memLimit", e.target.value)} className="font-mono text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Thumb Concurrency</label>
                  <Input value={state.thumbConcurrency} onChange={(e) => update("thumbConcurrency", e.target.value)} className="font-mono text-xs" />
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              {!state.generatedKey && (
                <div className="bg-[hsl(var(--warning)/0.1)] border border-[hsl(var(--warning)/0.3)] rounded-md p-3 space-y-2">
                  <p className="text-xs font-semibold text-[hsl(var(--warning))]">Step 1: Generate an agent key</p>
                  <Button
                    size="sm"
                    onClick={() => generateKeyMutation.mutate()}
                    disabled={generateKeyMutation.isPending}
                  >
                    Generate Agent Key for "{state.agentName}"
                  </Button>
                </div>
              )}

              {state.generatedKey && (
                <Badge className="bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]">
                  ✓ Key generated and embedded in .env below
                </Badge>
              )}

              <CopyBlock label=".env (save as .env on NAS)" content={envContent} />
              <CopyBlock label="docker-compose.yml (save next to .env)" content={composeContent} />

              <div className="bg-[hsl(var(--info)/0.1)] border border-[hsl(var(--info)/0.3)] rounded-md p-3 space-y-1 text-xs">
                <p className="font-semibold text-[hsl(var(--info))]">Deployment steps:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                  <li>SSH into your Synology NAS (or use File Station)</li>
                  <li>Create a folder: <code className="text-foreground">mkdir -p /volume1/docker/popdam</code></li>
                  <li>Save the <code>.env</code> and <code>docker-compose.yml</code> files into that folder</li>
                  <li>In Synology Container Manager → Project → Create → Import → select the folder</li>
                  <li>Click Deploy — the agent will poll outward to the cloud API automatically</li>
                  <li>Come back here and click <strong>Test Connection</strong> below</li>
                </ol>
                <p className="mt-2 text-muted-foreground">
                  <strong>No inbound networking required.</strong> The agent polls outward over HTTPS only.
                </p>
              </div>

              <ConnectivityTest agentName={state.agentName} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        {step < STEPS.length - 1 && (
          <Button
            onClick={() => setStep(step + 1)}
            disabled={!canAdvance()}
            className="gap-1"
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
