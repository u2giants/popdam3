import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Database, Clock, Monitor, AlertTriangle, Activity,
  Loader2, CheckCircle2, XCircle, ChevronDown, Wrench,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import type { AgentInfo, Counts, ProcessingError, ScanProgress } from "./types";
import { timeAgo, AGENT_TYPE_LABELS, SENSITIVE_PATTERNS, categorizeKey } from "./types";

// ── Overview Cards ──────────────────────────────────────────────────

export function OverviewCards({ counts }: { counts: Counts }) {
  const cards = [
    { label: "Total Assets", value: counts.total_assets, icon: Database, color: "text-primary" },
    { label: "Pending AI Jobs", value: counts.pending_jobs, icon: Clock, color: "text-[hsl(var(--warning))]" },
    { label: "Pending Renders", value: counts.pending_renders, icon: Monitor, color: "text-[hsl(var(--info))]" },
    { label: "Error Assets", value: counts.error_assets, icon: AlertTriangle, color: counts.error_assets > 0 ? "text-destructive" : "text-muted-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-4 flex items-center gap-3">
            <c.icon className={`h-5 w-5 shrink-0 ${c.color}`} />
            <div>
              <p className="text-2xl font-bold">{c.value.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Connected Agents ────────────────────────────────────────────────

export function ConnectedAgents({ agents }: { agents: AgentInfo[] }) {
  if (agents.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 flex items-start gap-2 text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p className="text-sm">No agents registered. The NAS Bridge Agent is not running.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Connected Agents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {agents.map((agent) => {
          const isOn = agent.status === "online";
          return (
            <div key={agent.id} className="border border-border rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${isOn ? "bg-[hsl(var(--success))]" : "bg-destructive"}`} />
                <span className="font-medium text-sm">{agent.name}</span>
                <Badge variant="secondary" className="text-xs">
                  {AGENT_TYPE_LABELS[agent.type] || agent.type}
                </Badge>
                <Badge variant={isOn ? "default" : "destructive"} className="text-xs">
                  {isOn ? "Online" : "Offline"}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                Last heartbeat: {timeAgo(agent.last_heartbeat)}
              </div>
              {isOn && agent.type === "bridge" && agent.last_counters && (
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                  <span>Files checked: <span className="text-foreground">{agent.last_counters.files_checked ?? 0}</span></span>
                  <span>Ingested: <span className="text-foreground">{agent.last_counters.ingested_new ?? 0}</span></span>
                  <span>Errors: <span className={agent.last_counters.errors > 0 ? "text-destructive font-semibold" : "text-foreground"}>{agent.last_counters.errors ?? 0}</span></span>
                </div>
              )}
              {agent.last_error && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-md p-2 text-xs text-destructive font-mono">
                  {agent.last_error}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Scan Status ─────────────────────────────────────────────────────

export function ScanStatusCard({ progress }: { progress: ScanProgress | null }) {
  if (!progress) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Loader2 className="h-4 w-4" /> Scan Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No scan has run yet.</p>
        </CardContent>
      </Card>
    );
  }

  const status = progress.status || "idle";
  const isRunning = status === "running" || status === "scanning";
  const isCompleted = status === "completed" || status === "done";
  const isFailed = status === "failed" || status === "error";
  const counters = progress.counters;

  const truncatedPath = progress.current_path
    ? "…/" + progress.current_path.split("/").slice(-3).join("/")
    : null;

  const counterText = counters
    ? `${counters.files_checked ?? 0} files checked · ${counters.ingested_new ?? 0} new · ${counters.moved_detected ?? 0} moved · ${counters.errors ?? 0} errors`
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> :
           isCompleted ? <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" /> :
           isFailed ? <XCircle className="h-4 w-4 text-destructive" /> :
           <Clock className="h-4 w-4" />}
          Scan Status
          <Badge variant={isRunning ? "default" : isCompleted ? "secondary" : isFailed ? "destructive" : "outline"} className="ml-1">
            {status}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isRunning && truncatedPath && (
          <div className="text-xs text-muted-foreground">
            Currently scanning: <code className="font-mono text-foreground">{truncatedPath}</code>
          </div>
        )}
        {counterText && (
          <p className="text-sm text-muted-foreground">{counterText}</p>
        )}
        {isCompleted && progress.updated_at && (
          <p className="text-xs text-muted-foreground">Completed {timeAgo(progress.updated_at)}</p>
        )}
        {isFailed && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-md p-2 text-xs text-destructive font-mono">
            {progress.error || "Scan failed — check agent logs for details."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Recent Errors ───────────────────────────────────────────────────

export function RecentErrors({ errors }: { errors: ProcessingError[] }) {
  if (errors.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" /> Recent Processing Errors
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job Type</TableHead>
              <TableHead>Asset ID</TableHead>
              <TableHead>Error Message</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {errors.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-xs font-mono">{e.job_type}</TableCell>
                <TableCell className="text-xs font-mono">{e.asset_id.slice(0, 8)}…</TableCell>
                <TableCell className="text-xs text-destructive max-w-[300px] truncate">{e.error_message || "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{timeAgo(e.completed_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          These are AI-tagging or render jobs that failed. They will be retried automatically on the next scan.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Render Job Stats ────────────────────────────────────────────────

export function RenderJobStats() {
  const { call } = useAdminApi();

  const { data: stats } = useQuery({
    queryKey: ["render-job-stats"],
    queryFn: async () => {
      const [pendingRes, completed24hRes, failed24hRes] = await Promise.all([
        call("run-query", { sql: "SELECT COUNT(*) as count FROM render_queue WHERE status IN ('pending', 'claimed')" }),
        call("run-query", { sql: "SELECT COUNT(*) as count FROM render_queue WHERE status = 'completed' AND completed_at >= now() - interval '24 hours'" }),
        call("run-query", { sql: "SELECT COUNT(*) as count FROM render_queue WHERE status = 'failed' AND completed_at >= now() - interval '24 hours'" }),
      ]);
      return {
        pending: Number(pendingRes.rows?.[0]?.count ?? 0),
        completed24h: Number(completed24hRes.rows?.[0]?.count ?? 0),
        failed24h: Number(failed24hRes.rows?.[0]?.count ?? 0),
      };
    },
    refetchInterval: 15_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Monitor className="h-4 w-4" /> Render Jobs
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-6 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-[hsl(var(--info))]" />
            <span className="text-muted-foreground">Pending:</span>
            <span className="font-semibold text-foreground">{(stats?.pending ?? 0).toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
            <span className="text-muted-foreground">Completed (24h):</span>
            <span className="font-semibold text-foreground">{(stats?.completed24h ?? 0).toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <XCircle className={`h-4 w-4 ${(stats?.failed24h ?? 0) > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            <span className="text-muted-foreground">Failed (24h):</span>
            <span className={`font-semibold ${(stats?.failed24h ?? 0) > 0 ? "text-destructive" : "text-foreground"}`}>{(stats?.failed24h ?? 0).toLocaleString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Configuration Section ───────────────────────────────────────────

function ConfigValue({ k, value }: { k: string; value: unknown }) {
  const isSensitive = SENSITIVE_PATTERNS.test(k);

  if (isSensitive) {
    return <span className="text-muted-foreground italic">••••••••</span>;
  }

  if (typeof value === "object" && value !== null) {
    return (
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
          <ChevronDown className="h-3 w-3" /> Expand
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="text-xs font-mono text-muted-foreground bg-muted/50 rounded-md p-2 mt-1 max-h-[200px] overflow-auto whitespace-pre-wrap">
            {JSON.stringify(value, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return <span className="text-foreground break-all">{String(value)}</span>;
}

export function ConfigurationSection({ config }: { config: Record<string, unknown> }) {
  const grouped: Record<string, [string, unknown][]> = {
    "Scan Config": [],
    "Storage": [],
    "Agent": [],
    "Windows Agent": [],
    "Other": [],
  };

  for (const [key, entry] of Object.entries(config)) {
    const val = (entry as { value?: unknown })?.value ?? entry;
    const cat = categorizeKey(key);
    grouped[cat].push([key, val]);
  }

  const nonEmpty = Object.entries(grouped).filter(([, entries]) => entries.length > 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wrench className="h-4 w-4" /> Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {nonEmpty.map(([category, entries]) => (
          <div key={category}>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{category}</h4>
            <div className="space-y-1.5">
              {entries.map(([key, val]) => (
                <div key={key} className="flex items-start gap-3 text-xs border-b border-border/50 pb-1.5">
                  <span className="text-primary font-semibold font-mono min-w-[220px] shrink-0">{key}</span>
                  <ConfigValue k={key} value={val} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {nonEmpty.length === 0 && (
          <p className="text-sm text-muted-foreground">No configuration entries found.</p>
        )}
      </CardContent>
    </Card>
  );
}
