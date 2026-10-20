import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Monitor, Download, RefreshCw, AlertTriangle, Trash2, X, ArrowUpCircle } from "lucide-react";

export function WindowsAgentStatus({ pollFast }: { pollFast?: boolean }) {
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
        <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isRefetching} title={isRefetching ? "Refreshing…" : "Refresh"}>
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

              // Indra OCR engine status (agent self-check / self-provision)
              const ocr = meta?.ocr_indra as { state?: string; detail?: string | null } | undefined;
              const ocrDetail = ocr?.detail ? ` — ${ocr.detail}` : "";
              const ocrLine =
                ocr?.state === "ready"
                  ? "OCR engine: Indra (ready)"
                  : ocr?.state === "installing"
                    ? "OCR engine: Indra installing…"
                    : ocr?.state === "error"
                      ? `OCR engine: Indra install failed, using tesseract.js${ocrDetail}`
                      : ocr?.state === "missing"
                        ? `OCR engine: Indra missing, using tesseract.js${ocrDetail}`
                        : null;
              const ocrTone =
                ocr?.state === "ready"
                  ? "text-[hsl(var(--success))]"
                  : ocr?.state === "installing"
                    ? "text-[hsl(var(--warning))]"
                    : "text-destructive";

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
                          disabled={triggerUpdateMutation.isPending} title={triggerUpdateMutation.isPending ? "Requesting update…" : undefined}
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
                          disabled={removeAgentMutation.isPending} title={removeAgentMutation.isPending ? "Removing agent…" : undefined}
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
                      <div className="flex items-center gap-2 flex-wrap">
                        Version: <Badge variant="outline" className="text-[10px] h-5">{currentVersion}</Badge>
                        {(meta?.last_updated_at || meta?.started_at) && (
                          <span className="text-muted-foreground">
                            deployed {new Date((meta?.last_updated_at ?? meta?.started_at) as string).toLocaleString()}
                          </span>
                        )}
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
                    {updateError && (
                      <div className="text-destructive">Update error: {updateError}</div>
                    )}
                    {ocrLine ? (
                      <div className={ocrTone}>{ocrLine}</div>
                    ) : isOn ? (
                      <div>
                        {ocr
                          ? `OCR engine: unexpected status "${ocr.state ?? "unknown"}"`
                          : "OCR engine: not reported yet — waiting for an agent update"}
                      </div>
                    ) : null}
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
