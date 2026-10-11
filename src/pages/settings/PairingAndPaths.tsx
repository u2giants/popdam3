import { useState } from "react";
import { Key, Copy, MapPin, Loader2, Users } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { parseInputPath, type NasConfig } from "@/lib/path-utils";
import { getUserSyncRoot, setUserSyncRoot } from "@/lib/path-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CopyButton } from "./AgentStatusSection";

export type PairingRow = {
  id: string;
  pairing_code: string;
  agent_type: string;
  agent_name: string;
  status: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

export function PairingCodesSection({ defaultAgentType = "bridge" as "bridge" | "windows-render" }) {
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

export function PathTesterSection() {
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
