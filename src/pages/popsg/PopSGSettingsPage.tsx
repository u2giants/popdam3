import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, RotateCw } from "lucide-react";
import { CURRENT_APP } from "@/lib/app-mode";
import { useCrawlProgress } from "@/hooks/useCrawlProgress";
import { useCrawlLifecycle } from "@/hooks/useCrawlLifecycle";
import { useAgentStatus } from "@/hooks/useAgentStatus";

export default function PopSGSettingsPage() {
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
