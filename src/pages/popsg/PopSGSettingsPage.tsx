import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, RefreshCw, Plus, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { CURRENT_APP } from "@/lib/app-mode";
import { useCrawlProgress } from "@/hooks/useCrawlProgress";
import { useCrawlLifecycle } from "@/hooks/useCrawlLifecycle";

interface AgentPairingRow {
  id: string;
  pairing_code: string;
  agent_name: string;
  agent_type: string;
  status: string;
  expires_at: string;
  created_at: string;
  consumed_at: string | null;
}

interface AgentRegistrationRow {
  id: string;
  agent_name: string;
  agent_type: string;
  last_heartbeat: string | null;
  created_at: string;
}

function randomPairingCode(): string {
  // Format: XXXX-XXXX-XXXX-XXXX  (~63 bits, URL-safe)
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [
    chars.slice(0, 4).join(""),
    chars.slice(4, 8).join(""),
    chars.slice(8, 12).join(""),
    chars.slice(12, 16).join(""),
  ].join("-");
}

export default function PopSGSettingsPage() {
  const qc = useQueryClient();
  const [agentName, setAgentName] = useState("");

  const crawlProgress = useCrawlProgress();
  const { crawlTriggered, handleTriggerCrawl } = useCrawlLifecycle(crawlProgress);
  const crawlActive = crawlProgress.status === "queued" || crawlProgress.status === "running" || crawlTriggered;

  const { data: agents = [], isFetching: agentsFetching } = useQuery({
    queryKey: ["popsg", "agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_registrations")
        .select("id,agent_name,agent_type,last_heartbeat,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AgentRegistrationRow[];
    },
  });

  const { data: pairings = [] } = useQuery({
    queryKey: ["popsg", "pairings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_pairings")
        .select("id,pairing_code,agent_name,agent_type,status,expires_at,created_at,consumed_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as AgentPairingRow[];
    },
  });

  const { data: scanRoots = [] } = useQuery({
    queryKey: ["popsg", "scan_roots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_config")
        .select("value")
        .eq("key", "scan_roots")
        .maybeSingle();
      if (error) throw error;
      const v = data?.value;
      if (Array.isArray(v)) return v as string[];
      return [];
    },
  });

  const createPairing = useMutation({
    mutationFn: async (name: string) => {
      const code = randomPairingCode();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("agent_pairings")
        .insert({
          pairing_code: code,
          agent_name: name,
          agent_type: "bridge",
          status: "pending",
          expires_at: expiresAt,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["popsg", "pairings"] });
      toast.success("Pairing code generated — valid for 15 minutes");
      setAgentName("");
    },
    onError: (err: Error) => toast.error(err.message ?? "Failed to generate pairing code"),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{CURRENT_APP.name} Settings</h1>
        <p className="text-xs text-muted-foreground">
          v1 admin tools — pair bridge agents, view scan roots. Deeper admin features will land as
          we grow the app.
        </p>
      </div>

      {/* Scan roots */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scan roots</CardTitle>
          <CardDescription className="text-xs">
            The NAS paths the bridge agent will crawl. Stored in <code>admin_config.scan_roots</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scanRoots.length === 0 ? (
            <p className="text-xs text-muted-foreground">(not configured — default: <code>/nas/styleguides</code>)</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {scanRoots.map((r) => (
                <li key={r} className="font-mono text-xs">
                  {r}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Pair a new agent */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pair a bridge agent</CardTitle>
          <CardDescription className="text-xs">
            Generates a one-time 15-minute code. Give it to the bridge agent — it will register
            itself and start scanning. Uses the same agent binary as PopDAM; add this as a second
            tenant via the <code>TENANTS</code> env var.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="agent-name" className="text-xs">Agent name</Label>
              <Input
                id="agent-name"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="e.g. bridge-popsg-nas"
              />
            </div>
            <Button
              onClick={() => {
                if (!agentName.trim()) {
                  toast.error("Give the agent a name");
                  return;
                }
                createPairing.mutate(agentName.trim());
              }}
              disabled={createPairing.isPending}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Generate code
            </Button>
          </div>

          {pairings.length > 0 && (
            <div className="rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Code</th>
                    <th className="px-3 py-1.5 text-left font-medium">Agent</th>
                    <th className="px-3 py-1.5 text-left font-medium">Status</th>
                    <th className="px-3 py-1.5 text-left font-medium">Expires</th>
                    <th className="px-3 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {pairings.map((p) => {
                    const expired = p.status === "pending" && new Date(p.expires_at) < new Date();
                    const display = expired ? "expired" : p.status;
                    return (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-3 py-1.5 font-mono">{p.pairing_code}</td>
                        <td className="px-3 py-1.5">{p.agent_name}</td>
                        <td className="px-3 py-1.5">
                          <Badge
                            variant={
                              display === "consumed"
                                ? "default"
                                : display === "pending"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {display}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {new Date(p.expires_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {p.status === "pending" && !expired && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-xs"
                              onClick={async () => {
                                await navigator.clipboard.writeText(p.pairing_code);
                                toast.success("Copied");
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Copy
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agents */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Registered agents</CardTitle>
            <CardDescription className="text-xs">
              Bridge agents that have successfully paired against this PopSG project.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["popsg", "agents"] })}
            disabled={agentsFetching}
            className="gap-1.5"
          >
            <RefreshCw className={agentsFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {agents.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No agents yet. Generate a pairing code above and pair one.
            </p>
          ) : (
            <div className="rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Name</th>
                    <th className="px-3 py-1.5 text-left font-medium">Type</th>
                    <th className="px-3 py-1.5 text-left font-medium">Last heartbeat</th>
                    <th className="px-3 py-1.5 text-left font-medium">Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => {
                    const isOnline =
                      a.last_heartbeat &&
                      Date.now() - new Date(a.last_heartbeat).getTime() < 2 * 60 * 1000;
                    return (
                      <tr key={a.id} className="border-t border-border">
                        <td className="px-3 py-1.5 font-medium">{a.agent_name}</td>
                        <td className="px-3 py-1.5 text-muted-foreground capitalize">
                          {a.agent_type}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={
                                isOnline
                                  ? "h-2 w-2 rounded-full bg-green-500"
                                  : "h-2 w-2 rounded-full bg-muted-foreground/40"
                              }
                            />
                            <span>
                              {a.last_heartbeat
                                ? new Date(a.last_heartbeat).toLocaleString()
                                : "never"}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {new Date(a.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Crawl trigger */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trigger crawl</CardTitle>
          <CardDescription className="text-xs">
            Sends a crawl request to the paired bridge agent. The agent picks it up on its next
            heartbeat (~30 s) and submits all discovered style guide files back to the library.
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
