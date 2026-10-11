import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const BRIDGE_UPDATE_SESSION_KEY = "bridge_update_pending";

export function UpdateAgentButton() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [updateStatusMsg, setUpdateStatusMsg] = useState<{ type: "info" | "success" | "error"; text: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { data: agentsData } = useQuery({
    queryKey: ["admin-agents"],
    queryFn: () => call("list-agents"),
    refetchInterval: 30_000,
  });

  const { data: latestBuildData } = useQuery({
    queryKey: ["bridge-latest-build"],
    queryFn: () => call("get-latest-agent-build", { agent_type: "bridge" }),
    staleTime: 60_000,
  });

  const bridgeAgents = (agentsData?.agents || []).filter(
    (a: Record<string, unknown>) => a.type === "bridge"
  );
  const bridgeAgent = bridgeAgents[0] as Record<string, unknown> | undefined;
  const vi = bridgeAgent?.version_info as Record<string, unknown> | null;
  const currentVersion = vi?.version as string | null;
  const deployedAt = (vi?.deployed_at ?? vi?.last_reported_at) as string | null;
  const latestVersion = latestBuildData?.latest_version as string | null;
  const latestPublishedAt = latestBuildData?.published_at as string | null;
  const updateAvailable = latestVersion && currentVersion && latestVersion !== "0.0.0" && latestVersion !== currentVersion;

  // Extracted polling loop — survives navigation via sessionStorage resume.
  const runUpdatePoll = useCallback(async (triggerTime: number, fromVersion: string | null) => {
    const MAX_WAIT_MS = 5 * 60 * 1000;
    try {
      while (Date.now() - triggerTime < MAX_WAIT_MS) {
        await new Promise((r) => setTimeout(r, 5_000));
        if (!mountedRef.current) return; // unmounted mid-poll; sessionStorage entry stays for resume

        const statusResp = await call("get-update-status").catch(() => null);
        const updateStatus = statusResp?.status as Record<string, unknown> | null;
        const statusReportedAt = updateStatus?.reported_at
          ? new Date(updateStatus.reported_at as string).getTime() : 0;
        if (statusReportedAt >= triggerTime - 5_000 && updateStatus?.status === "failed") {
          const errMsg = (updateStatus.error as string) || "unknown error";
          setUpdateStatusMsg({ type: "error", text: `Update failed: ${errMsg}` });
          toast.error(`Bridge update failed: ${errMsg}`);
          sessionStorage.removeItem(BRIDGE_UPDATE_SESSION_KEY);
          return;
        }

        const agentsResp = await call("list-agents").catch(() => null);
        const agents = (agentsResp?.agents || []) as Record<string, unknown>[];
        const bridge = agents.find((a) => a.type === "bridge");
        const newVi = bridge?.version_info as Record<string, unknown> | null;
        const newVersion = newVi?.version as string | null;
        if (newVersion && fromVersion && newVersion !== fromVersion) {
          setUpdateStatusMsg({ type: "success", text: `Updated to v${newVersion}` });
          toast.success(`Bridge agent updated to v${newVersion}`);
          queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
          sessionStorage.removeItem(BRIDGE_UPDATE_SESSION_KEY);
          return;
        }

        const elapsed = Math.round((Date.now() - triggerTime) / 1000);
        setUpdateStatusMsg({ type: "info", text: `Waiting for agent to restart… (${elapsed}s)` });
      }

      setUpdateStatusMsg({ type: "error", text: "Timed out — agent did not report back within 5 minutes. If it comes back online shortly, the update succeeded. Otherwise check Container Manager logs." });
      toast.warning("Bridge agent hasn't restarted yet — check Container Manager or agent logs");
      sessionStorage.removeItem(BRIDGE_UPDATE_SESSION_KEY);
    } finally {
      if (mountedRef.current) setIsPending(false);
    }
  }, [call, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: resume polling if an update was in flight when the user navigated away.
  useEffect(() => {
    const raw = sessionStorage.getItem(BRIDGE_UPDATE_SESSION_KEY);
    if (!raw) return;
    try {
      const { triggeredAt, fromVersion } = JSON.parse(raw) as { triggeredAt: number; fromVersion: string | null };
      if (Date.now() - triggeredAt >= 5 * 60 * 1000) {
        sessionStorage.removeItem(BRIDGE_UPDATE_SESSION_KEY);
        return;
      }
      const elapsed = Math.round((Date.now() - triggeredAt) / 1000);
      setIsPending(true);
      setUpdateStatusMsg({ type: "info", text: `Waiting for agent to restart… (${elapsed}s)` });
      runUpdatePoll(triggeredAt, fromVersion);
    } catch {
      sessionStorage.removeItem(BRIDGE_UPDATE_SESSION_KEY);
    }
  }, [runUpdatePoll]);

  const handleUpdate = async () => {
    setIsPending(true);
    setUpdateStatusMsg({ type: "info", text: "Sending update request to bridge agent…" });
    try {
      const triggerTime = Date.now();
      await call("trigger-agent-update", { update_action: "apply" });
      setUpdateStatusMsg({ type: "info", text: "Update queued — bridge will pull the new image and restart (up to ~5 minutes on a slow NAS)…" });
      sessionStorage.setItem(BRIDGE_UPDATE_SESSION_KEY, JSON.stringify({ triggeredAt: triggerTime, fromVersion: currentVersion }));
      await runUpdatePoll(triggerTime, currentVersion);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to trigger update";
      setUpdateStatusMsg({ type: "error", text: msg });
      toast.error(msg);
      sessionStorage.removeItem(BRIDGE_UPDATE_SESSION_KEY);
      setIsPending(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <RefreshCw className="h-4 w-4" /> Bridge Agent Update
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {currentVersion && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-foreground">Installed:</span>
            <Badge variant="outline" className="text-[10px] h-5 font-mono">v{currentVersion}</Badge>
            {deployedAt && (
              <span className="text-muted-foreground">deployed {new Date(deployedAt).toLocaleString()}</span>
            )}
          </div>
        )}
        {latestVersion && latestVersion !== "0.0.0" && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-foreground">Latest:</span>
            <Badge variant={updateAvailable ? "secondary" : "outline"} className={`text-[10px] h-5 font-mono ${updateAvailable ? "text-[hsl(var(--warning))]" : ""}`}>
              v{latestVersion}
            </Badge>
            {latestPublishedAt && (
              <span className="text-muted-foreground">published {new Date(latestPublishedAt).toLocaleString()}</span>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Pull the latest Docker image from GHCR and restart the bridge agent container.
          The agent will be unavailable for ~60 seconds during the restart.
        </p>
        {updateStatusMsg && (
          <p className={`text-xs ${updateStatusMsg.type === "error" ? "text-destructive" : updateStatusMsg.type === "success" ? "text-[hsl(var(--success))]" : "text-muted-foreground"}`}>
            {updateStatusMsg.text}
          </p>
        )}
        <Button
          variant={updateAvailable ? "default" : "outline"}
          size="sm"
          onClick={handleUpdate}
          disabled={isPending}
          title={isPending ? "Update in progress…" : undefined}
          className="gap-1.5"
        >
          {isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Requesting...</>
          ) : (
            <><RefreshCw className="h-3.5 w-3.5" /> {updateAvailable ? `Update to v${latestVersion}` : "Update to Latest"}</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Live Scan Monitor ────────────────────────────────────────────────
