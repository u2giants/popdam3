import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ExternalLink, RotateCw, Save } from "lucide-react";
import { toast } from "sonner";
import { CURRENT_APP } from "@/lib/app-mode";
import { useCrawlProgress } from "@/hooks/useCrawlProgress";
import { useCrawlLifecycle } from "@/hooks/useCrawlLifecycle";
import { useAgentStatus } from "@/hooks/useAgentStatus";

export default function PopSGSettingsPage() {
  const queryClient = useQueryClient();
  const crawlProgress = useCrawlProgress();
  const { crawlTriggered, handleTriggerCrawl } = useCrawlLifecycle(crawlProgress, "trigger-style-guide-crawl");
  const crawlActive = crawlProgress.status === "queued" || crawlProgress.status === "running" || crawlTriggered;

  const agentStatus = useAgentStatus();

  const { data: scanRoots = [] } = useQuery({
    queryKey: ["popsg", "scan_roots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_config")
        .select("value")
        .eq("key", "STYLE_GUIDE_SCAN_ROOTS")
        .maybeSingle();
      if (error) throw error;
      const v = data?.value;
      if (Array.isArray(v)) return v as string[];
      return [];
    },
  });

  // ── Thumbnail render config (Windows agent SG mount path) ──
  const { data: sgMountPathConfig } = useQuery({
    queryKey: ["popsg", "sg_nas_mount_path"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_config")
        .select("value")
        .eq("key", "WINDOWS_AGENT_SG_NAS_MOUNT_PATH")
        .maybeSingle();
      if (error) throw error;
      return typeof data?.value === "string" ? (data.value as string) : "";
    },
  });

  const [sgMountPath, setSgMountPath] = useState("");
  const [sgMountPathInitialized, setSgMountPathInitialized] = useState(false);

  useEffect(() => {
    if (sgMountPathConfig !== undefined && !sgMountPathInitialized) {
      setSgMountPath(sgMountPathConfig);
      setSgMountPathInitialized(true);
    }
  }, [sgMountPathConfig, sgMountPathInitialized]);

  const saveMountPath = useMutation({
    mutationFn: async () => {
      const cleaned = sgMountPath.trim().replace(/\\+$/, "");
      const { error } = await supabase.from("admin_config").upsert({
        key: "WINDOWS_AGENT_SG_NAS_MOUNT_PATH",
        value: cleaned,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Style guide mount path saved");
      queryClient.invalidateQueries({ queryKey: ["popsg", "sg_nas_mount_path"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const { data: queueStats } = useQuery({
    queryKey: ["popsg", "render_queue_stats"],
    queryFn: async () => {
      const [pending, claimed, completed, failed] = await Promise.all([
        supabase.from("style_guide_render_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("style_guide_render_queue").select("id", { count: "exact", head: true }).eq("status", "claimed"),
        supabase.from("style_guide_render_queue").select("id", { count: "exact", head: true }).eq("status", "completed"),
        supabase.from("style_guide_render_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
      ]);
      return {
        pending: pending.count ?? 0,
        claimed: claimed.count ?? 0,
        completed: completed.count ?? 0,
        failed: failed.count ?? 0,
      };
    },
    refetchInterval: 10_000,
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{CURRENT_APP.name} Settings</h1>
        <p className="text-xs text-muted-foreground">
          The Bridge Agent is managed centrally in PopDAM. Configure scan roots and trigger crawls here.
        </p>
      </div>

      {/* Agent status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bridge Agent</CardTitle>
          <CardDescription className="text-xs">
            The same agent that scans PopDAM also handles PopSG crawls. Managed in PopDAM Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {agentStatus.bridgeStatus === "none" ? (
            <p className="text-xs text-muted-foreground">No bridge agent registered yet.</p>
          ) : (
            <div className="rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Name</th>
                    <th className="px-3 py-1.5 text-left font-medium">Status</th>
                    <th className="px-3 py-1.5 text-left font-medium">Last heartbeat</th>
                  </tr>
                </thead>
                <tbody>
                  {agentStatus.agents
                    .filter((a) => a.agent_type === "bridge")
                    .map((a) => (
                      <tr key={a.id} className="border-t border-border">
                        <td className="px-3 py-1.5 font-medium">{a.agent_name}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant={a.isOnline ? "default" : "outline"}>
                            {a.isOnline ? "online" : "offline"}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {a.last_heartbeat
                            ? new Date(a.last_heartbeat).toLocaleString()
                            : "never"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <a href="https://dam.designflow.app/settings" target="_blank" rel="noopener noreferrer">
              Manage agents in PopDAM <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Scan roots */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Style guide scan roots</CardTitle>
          <CardDescription className="text-xs">
            NAS paths the Bridge Agent crawls for style guide files. Stored in{" "}
            <code>admin_config.STYLE_GUIDE_SCAN_ROOTS</code>. Edit via PopDAM admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scanRoots.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              (not configured — default: <code>/nas/styleguides</code>)
            </p>
          ) : (
            <ul className="space-y-1">
              {scanRoots.map((r) => (
                <li key={r} className="font-mono text-xs">
                  {r}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Thumbnail rendering */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Thumbnail rendering</CardTitle>
          <CardDescription className="text-xs">
            PopSG previews are rendered by the Windows Render Agent (the same one that powers PopDAM thumbnails).
            Set the Windows-visible path to the style guide share so the agent can read the source files.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Style Guide NAS Mount Path
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="\\192.168.3.101\styleguides   or   Y:\styleguides"
                value={sgMountPath}
                onChange={(e) => setSgMountPath(e.target.value)}
                className="font-mono text-xs"
              />
              <Button
                variant="default"
                size="sm"
                onClick={() => saveMountPath.mutate()}
                disabled={saveMountPath.isPending}
                className="gap-1.5"
              >
                <Save className="h-3.5 w-3.5" />
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              UNC path or mapped drive on the Windows host. Sharp/Ghostscript work best with a mapped drive
              (e.g. <code>Y:\styleguides</code>). Falls back to the main NAS Mount Path if blank.
            </p>
          </div>

          {queueStats && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Render queue
              </p>
              <div className="grid grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Pending</div>
                  <div className="font-mono text-sm font-semibold">{queueStats.pending.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">In flight</div>
                  <div className="font-mono text-sm font-semibold">{queueStats.claimed.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Done</div>
                  <div className="font-mono text-sm font-semibold text-success">
                    {queueStats.completed.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Failed</div>
                  <div className="font-mono text-sm font-semibold text-destructive">
                    {queueStats.failed.toLocaleString()}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Auto-refreshes every 10 s. Windows agent polls every few seconds when the mount path is configured.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Crawl trigger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trigger crawl</CardTitle>
          <CardDescription className="text-xs">
            Sends a crawl request to the Bridge Agent. It picks it up on its next heartbeat (~30 s)
            and submits all discovered style guide files.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Button
              onClick={handleTriggerCrawl}
              disabled={crawlActive}
              className="gap-1.5"
            >
              <RotateCw className={crawlActive ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              {crawlActive ? "Crawl in progress…" : "Trigger crawl now"}
            </Button>

            {(crawlProgress.status === "completed" || crawlProgress.status === "failed") && crawlProgress.completedAt && (
              <span className="text-xs text-muted-foreground">
                Last run: {new Date(crawlProgress.completedAt).toLocaleString()}
                {crawlProgress.status === "completed" && crawlProgress.filesFound != null && (
                  <> — {crawlProgress.filesFound.toLocaleString()} files</>
                )}
                {crawlProgress.status === "failed" && (
                  <span className="text-destructive"> — failed</span>
                )}
              </span>
            )}
          </div>

          {crawlProgress.status === "failed" && crawlProgress.error && (
            <p className="text-xs text-destructive">{crawlProgress.error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
