import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RefreshCw, ArrowUpCircle, Terminal, Power, Zap, StopCircle, Link } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function AgentRemoteControls() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["admin-agents"],
    queryFn: () => call("list-agents"),
    refetchInterval: 10_000,
  });

  const agents = ((data?.agents || []) as Record<string, unknown>[]).filter(
    (a) => a.type === "windows-render"
  );

  const sendCommand = useMutation({
    mutationFn: ({ agentId, command }: { agentId: string; command: string }) =>
      call("set-agent-command", { agent_id: agentId, command }),
    onSuccess: (_data, { command }) => {
      toast.success(`Command queued: ${command} — agent will receive on next heartbeat (≤30s)`);
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const repairAgent = useMutation({
    mutationFn: (agentId: string) =>
      call("generate-repair-code", { agent_id: agentId }),
    onSuccess: () => {
      toast.success("Repair code queued — agent will re-pair on next heartbeat (≤30s)");
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (agents.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4" /> Remote Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {agents.map((agent) => {
          const agentId = agent.id as string;
          const FIVE_MIN = 5 * 60 * 1000;
          const isOn = agent.last_heartbeat
            ? Date.now() - new Date(agent.last_heartbeat as string).getTime() < FIVE_MIN
            : false;
          const isPending = sendCommand.isPending || repairAgent.isPending;

          return (
            <div key={agentId} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <div className={`h-1.5 w-1.5 rounded-full ${isOn ? "bg-[hsl(var(--success))]" : "bg-destructive"}`} />
                {agent.name as string}
                {!isOn && (
                  <span className="text-warning">(offline — commands will queue until agent reconnects)</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => sendCommand.mutate({ agentId, command: "force_restart" })}
                  disabled={isPending}
                  title="Exit with restart code — launcher.bat restarts the agent immediately"
                >
                  <Power className="h-3 w-3" />
                  Force Restart
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => sendCommand.mutate({ agentId, command: "force_apply_update" })}
                  disabled={isPending}
                  title="Apply any pending update immediately, even if render jobs are active"
                >
                  <ArrowUpCircle className="h-3 w-3" />
                  Force Update Now
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => {
                    if (window.confirm("Stop claiming new jobs and restart after draining (up to 60s)?")) {
                      sendCommand.mutate({ agentId, command: "force_stop_jobs" });
                    }
                  }}
                  disabled={isPending}
                  title="Stop accepting new jobs, wait for current jobs to finish, then restart"
                >
                  <StopCircle className="h-3 w-3" />
                  Stop &amp; Drain
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={() => {
                    if (window.confirm("Generate a new pairing code and deliver it to the agent via heartbeat? This replaces the stored agent key without reinstalling.")) {
                      repairAgent.mutate(agentId);
                    }
                  }}
                  disabled={isPending}
                  title="Generate a new key and re-pair the agent without reinstalling"
                >
                  <Link className="h-3 w-3" />
                  Re-Pair Agent
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Commands are delivered on the next heartbeat (≤30s). Force Restart and Force Update also work while jobs are running.
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Log Tail Viewer ─────────────────────────────────────────────────

export function AgentLogTail() {
  const { call } = useAdminApi();
  const [open, setOpen] = useState(false);

  const { data, dataUpdatedAt, refetch, isRefetching } = useQuery({
    queryKey: ["admin-agents"],
    queryFn: () => call("list-agents"),
    refetchInterval: open ? 30_000 : false,
  });

  const agents = ((data?.agents || []) as Record<string, unknown>[]).filter(
    (a) => a.type === "windows-render"
  );

  const [secondsAgo, setSecondsAgo] = useState(0);
  useEffect(() => {
    if (!dataUpdatedAt || !open) return;
    const tick = () => setSecondsAgo(Math.floor((Date.now() - dataUpdatedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [dataUpdatedAt, open]);

  if (agents.length === 0) return null;

  // Pick the first (usually only) agent
  const agent = agents[0];
  const meta = (agent.metadata as Record<string, unknown>) || {};
  const logTail = (meta.log_tail as string[]) || [];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-muted/30 rounded-t-lg transition-colors">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Terminal className="h-4 w-4" /> Recent Agent Logs
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {open ? "▲ collapse" : "▼ expand"}
              </span>
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">
                Last 50 lines from {agent.name as string} — updates every 30s
                {dataUpdatedAt > 0 && ` (${secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`})`}
              </p>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => refetch()} disabled={isRefetching}>
                <RefreshCw className={`h-3 w-3 ${isRefetching ? "animate-spin" : ""}`} />
              </Button>
            </div>
            {logTail.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No logs yet. Logs appear here after the next heartbeat.
              </p>
            ) : (
              <div className="bg-black/90 rounded-md p-3 overflow-x-auto max-h-64 overflow-y-auto font-mono text-[10px] space-y-0.5">
                {logTail.map((line, i) => {
                  let parsed: Record<string, unknown> | null = null;
                  try { parsed = JSON.parse(line); } catch { /* raw line */ }
                  const level = parsed?.level as string | undefined;
                  const color = level === "error" ? "text-red-400" : level === "warn" ? "text-yellow-400" : "text-green-300";
                  return (
                    <div key={i} className={color}>
                      {parsed
                        ? `[${parsed.ts as string}] ${level?.toUpperCase()} ${parsed.msg as string}${Object.keys(parsed).filter(k => !["ts","level","msg"].includes(k)).map(k => ` ${k}=${JSON.stringify(parsed![k])}`).join("")}`
                        : line}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── Exported Tab ────────────────────────────────────────────────────
