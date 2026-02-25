import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Download, Server, Plus, Trash2, Package,
  Loader2, AlertTriangle, FolderPlus,
} from "lucide-react";

// ── Shared download helper ──────────────────────────────────────────

async function downloadBundle(payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  // We need raw binary, so use fetch directly instead of supabase.functions.invoke
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const url = `https://${projectId}.supabase.co/functions/v1/admin-api`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ action: "generate-install-bundle", ...payload }),
  });

  if (!res.ok) {
    const text = await res.text();
    let message = "Failed to generate bundle";
    try {
      const j = JSON.parse(text);
      message = j.error || message;
    } catch { /* use default */ }
    throw new Error(message);
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] || "popdam-install-bundle.zip";

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 100);
}

// ── Bridge Agent Bundle ─────────────────────────────────────────────

function BridgeAgentBundle() {
  const [agentName, setAgentName] = useState("bridge-agent");
  const [nasHostPath, setNasHostPath] = useState("/volume1/nas-share");
  const [containerMountRoot, setContainerMountRoot] = useState("/mnt/nas/mac");
  const [scanRoots, setScanRoots] = useState<string[]>([]);
  const [newRoot, setNewRoot] = useState("");
  const [enableWatchtower, setEnableWatchtower] = useState(false);
  const [updateChannel, setUpdateChannel] = useState("stable");

  const downloadMutation = useMutation({
    mutationFn: () =>
      downloadBundle({
        agent_type: "bridge",
        agent_name: agentName,
        nas_host_path: nasHostPath,
        container_mount_root: containerMountRoot,
        scan_roots: scanRoots,
        enable_watchtower: enableWatchtower,
        update_channel: updateChannel,
      }),
    onSuccess: () => toast.success("Bridge Agent bundle downloaded!"),
    onError: (e) => toast.error(e.message),
  });

  const addRoot = () => {
    const trimmed = newRoot.trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (!trimmed) return;
    if (scanRoots.includes(trimmed)) {
      toast.error("Already in list");
      return;
    }
    setScanRoots([...scanRoots, trimmed]);
    setNewRoot("");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Server className="h-4 w-4" />
          Add Bridge Agent
          <Badge variant="secondary" className="text-[10px]">Synology / Docker</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Generate a ready-to-deploy bundle for your Synology NAS. Includes docker-compose.yml, .env, and setup instructions.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Agent Name</Label>
            <Input
              className="font-mono text-xs"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="bridge-agent"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">NAS Host Path (on Synology)</Label>
            <Input
              className="font-mono text-xs"
              value={nasHostPath}
              onChange={(e) => setNasHostPath(e.target.value)}
              placeholder="/volume1/nas-share"
            />
            <p className="text-[10px] text-muted-foreground">
              The shared folder path on the NAS filesystem
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Container Mount Root</Label>
            <Input
              className="font-mono text-xs"
              value={containerMountRoot}
              onChange={(e) => setContainerMountRoot(e.target.value)}
              placeholder="/mnt/nas/mac"
            />
            <p className="text-[10px] text-muted-foreground">
              Where the NAS volume is mounted inside Docker
            </p>
          </div>
        </div>

        {/* Scan Roots */}
        <div className="space-y-2">
          <Label className="text-xs">Scan Folders (relative to mount root)</Label>
          {scanRoots.length > 0 && (
            <div className="space-y-1">
              {scanRoots.map((root, i) => (
                <div key={i} className="flex items-center gap-2 text-xs font-mono bg-muted/50 rounded px-2 py-1">
                  <span className="flex-1">{root}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => setScanRoots(scanRoots.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              className="font-mono text-xs"
              value={newRoot}
              onChange={(e) => setNewRoot(e.target.value)}
              placeholder="Decor"
              onKeyDown={(e) => e.key === "Enter" && addRoot()}
            />
            <Button variant="outline" size="sm" onClick={addRoot} className="gap-1 shrink-0">
              <FolderPlus className="h-3 w-3" /> Add
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Leave empty to scan the entire mount root
          </p>
        </div>

        <Separator />

        {/* Auto-updates */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs">Enable Auto Updates (Watchtower)</Label>
            <p className="text-[10px] text-muted-foreground">
              Automatically pull and restart the agent when a new image is published
            </p>
          </div>
          <Switch checked={enableWatchtower} onCheckedChange={setEnableWatchtower} />
        </div>

        {/* Update Channel */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs">Update Channel</Label>
            <p className="text-[10px] text-muted-foreground">
              {updateChannel === "stable" ? "Recommended — tested releases only" :
               updateChannel === "beta" ? "Early access — may contain experimental features" :
               "Always pulls the most recent build"}
            </p>
          </div>
          <Select value={updateChannel} onValueChange={setUpdateChannel}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stable">Stable</SelectItem>
              <SelectItem value="beta">Beta</SelectItem>
              <SelectItem value="latest">Latest</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <div className="flex items-center gap-3">
          <Button
            size="lg"
            className="gap-2"
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending || !agentName.trim()}
          >
            {downloadMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download Install Bundle
          </Button>
          <div className="flex items-start gap-1.5 text-xs text-[hsl(var(--warning))]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Pairing code in the bundle expires in 15 minutes. Deploy promptly.</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Tab ────────────────────────────────────────────────────────

export default function InstallBundleTab() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Package className="h-5 w-5" />
          Install Bundles
        </h2>
        <p className="text-sm text-muted-foreground">
          Generate ready-to-run install packages for new agents. Each bundle contains a one-time pairing code — no manual .env editing required.
        </p>
      </div>
      <BridgeAgentBundle />
    </div>
  );
}
