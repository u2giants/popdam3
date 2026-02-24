import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Database, Clock, Monitor, AlertTriangle, RefreshCw,
  Activity, Loader2, CheckCircle2, XCircle, ChevronDown,
  RotateCcw, Play, Trash2, Wrench, Stethoscope, FileSearch,
} from "lucide-react";

// ── Helpers ─────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const AGENT_TYPE_LABELS: Record<string, string> = {
  bridge: "NAS Bridge Agent",
  "windows-render": "Windows Render Agent",
};

const SENSITIVE_PATTERNS = /secret|key|password|token|_pass|nas_user/i;

const SCAN_CONFIG_KEYS = new Set([
  "SCAN_ROOTS", "NAS_CONTAINER_MOUNT_ROOT", "SCAN_REQUEST",
  "SCAN_PROGRESS", "SCAN_CHECKPOINT", "SCANNING_CONFIG",
]);
const STORAGE_KEYS = new Set(["SPACES_CONFIG"]);
const AGENT_KEYS = new Set(["AGENT_KEY", "AUTO_SCAN_CONFIG"]);
const WINDOWS_AGENT_KEYS = new Set([
  "WINDOWS_AGENT_NAS_HOST", "WINDOWS_AGENT_NAS_SHARE",
  "WINDOWS_AGENT_NAS_USER", "WINDOWS_AGENT_NAS_PASS",
  "WINDOWS_AGENT_KEY", "WINDOWS_BOOTSTRAP_TOKEN",
]);

function categorizeKey(key: string): string {
  if (SCAN_CONFIG_KEYS.has(key)) return "Scan Config";
  if (STORAGE_KEYS.has(key)) return "Storage";
  if (AGENT_KEYS.has(key)) return "Agent";
  if (WINDOWS_AGENT_KEYS.has(key)) return "Windows Agent";
  return "Other";
}

// ── Types ───────────────────────────────────────────────────────────

interface AgentInfo {
  id: string;
  name: string;
  type: string;
  status: string;
  last_heartbeat: string | null;
  last_counters: Record<string, number> | null;
  last_error: string | null;
  scan_roots: string[];
  created_at: string;
}

interface ScanProgress {
  status: string;
  counters?: Record<string, number>;
  current_path?: string;
  updated_at?: string;
  error?: string;
}

interface ProcessingError {
  id: string;
  asset_id: string;
  job_type: string;
  error_message: string | null;
  completed_at: string | null;
}

interface Counts {
  total_assets: number;
  pending_assets: number;
  error_assets: number;
  pending_jobs: number;
  pending_renders: number;
}

interface DiagnosticData {
  timestamp: string;
  config: Record<string, unknown>;
  agents: AgentInfo[];
  scan_progress: ScanProgress | null;
  recent_errors: ProcessingError[];
  counts: Counts;
}

// ── Section 1: Overview Cards ───────────────────────────────────────

function OverviewCards({ counts }: { counts: Counts }) {
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

// ── Section 2: Connected Agents ─────────────────────────────────────

function ConnectedAgents({ agents }: { agents: AgentInfo[] }) {
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

// ── Section 3: Scan Status ──────────────────────────────────────────

function ScanStatusCard({ progress }: { progress: ScanProgress | null }) {
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

  // Truncate path to last 3 segments
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

// ── Section 4: Recent Processing Errors ─────────────────────────────

function RecentErrors({ errors }: { errors: ProcessingError[] }) {
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

// ── Section 5: Configuration ────────────────────────────────────────

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

function ConfigurationSection({ config }: { config: Record<string, unknown> }) {
  // Group config entries by category
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

// ── Section 6: Actions ──────────────────────────────────────────────

function ActionsSection({ onRefresh }: { onRefresh: () => void }) {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [reprocessProgress, setReprocessProgress] = useState<{ updated: number; total: number } | null>(null);

  const resetScanMutation = useMutation({
    mutationFn: () => call("reset-scan-state"),
    onSuccess: () => {
      toast.success("Scan state reset to idle");
      onRefresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const resumeMutation = useMutation({
    mutationFn: () => call("resume-scanning"),
    onSuccess: () => {
      toast.success("Scanning resumed");
      onRefresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const retryFailedMutation = useMutation({
    mutationFn: () => call("retry-failed-jobs"),
    onSuccess: (data) => {
      toast.success(`${data.retried_count ?? 0} failed jobs reset to pending`);
      onRefresh();
    },
    onError: (e) => toast.error(e.message),
  });

  const clearCompletedMutation = useMutation({
    mutationFn: () => call("clear-completed-jobs"),
    onSuccess: (data) => {
      toast.success(`${data.deleted_count ?? 0} old completed jobs cleared`);
      onRefresh();
    },
    onError: (e) => toast.error(e.message),
  });

  async function runReprocess() {
    if (!confirm(
      "Re-derive SKU metadata, licensor, division, and workflow_status for all assets. This may take several minutes. Continue?"
    )) return;

    setReprocessProgress({ updated: 0, total: 0 });
    let offset = 0;
    let totalUpdated = 0;
    let totalProcessed = 0;

    try {
      while (true) {
        const data = await call("reprocess-asset-metadata", { offset });
        totalUpdated += data.updated ?? 0;
        totalProcessed += data.total ?? 0;
        setReprocessProgress({ updated: totalUpdated, total: totalProcessed });
        if (data.done || !data.nextOffset) break;
        offset = data.nextOffset;
      }
      toast.success(`Reprocessed ${totalUpdated} assets`);
      onRefresh();
    } catch (e: any) {
      toast.error(e.message || "Reprocess failed");
    } finally {
      setReprocessProgress(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Stethoscope className="h-4 w-4" /> Actions
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" /> Run Diagnostics
          </Button>
          <Button
            variant="outline" size="sm" className="gap-1.5"
            onClick={() => { if (confirm("Reset scan state to idle?")) resetScanMutation.mutate(); }}
            disabled={resetScanMutation.isPending}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset Scan State
          </Button>
          <Button
            variant="outline" size="sm" className="gap-1.5"
            onClick={() => resumeMutation.mutate()}
            disabled={resumeMutation.isPending}
          >
            <Play className="h-3.5 w-3.5" /> Resume Scanning
          </Button>
          <Button
            variant="outline" size="sm" className="gap-1.5"
            onClick={() => retryFailedMutation.mutate()}
            disabled={retryFailedMutation.isPending}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry Failed Jobs
          </Button>
          <Button
            variant="outline" size="sm" className="gap-1.5 text-destructive"
            onClick={() => { if (confirm("Delete completed jobs older than 7 days?")) clearCompletedMutation.mutate(); }}
            disabled={clearCompletedMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear Old Completed Jobs
          </Button>
          <Button
            variant="outline" size="sm" className="gap-1.5"
            onClick={runReprocess}
            disabled={reprocessProgress !== null}
          >
            {reprocessProgress !== null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}
            {reprocessProgress !== null ? "Reprocessing…" : "Reprocess Metadata"}
          </Button>
          {reprocessProgress && (
            <span className="text-xs text-muted-foreground">
              Updated {reprocessProgress.updated} / {reprocessProgress.total} so far…
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 7: Database Inspector ───────────────────────────────────

const QUICK_QUERIES = [
  { label: "Asset count by is_licensed", sql: "SELECT is_licensed, COUNT(*) as count FROM assets GROUP BY is_licensed" },
  { label: "Asset count by workflow_status", sql: "SELECT workflow_status, COUNT(*) as count FROM assets GROUP BY workflow_status ORDER BY count DESC" },
  { label: "Recent assets", sql: "SELECT relative_path, is_licensed, workflow_status, created_at FROM assets ORDER BY created_at DESC LIMIT 50" },
  { label: "Assets with no thumbnail", sql: "SELECT relative_path, thumbnail_error FROM assets WHERE thumbnail_url IS NULL AND is_deleted = false LIMIT 100" },
  { label: "Admin config", sql: "SELECT key, value, updated_at FROM admin_config ORDER BY key" },
];

function DatabaseInspector() {
  const { call } = useAdminApi();
  const [sql, setSql] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [rowCount, setRowCount] = useState<number>(0);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  async function runQuery(queryText?: string) {
    const q = (queryText ?? sql).trim();
    if (!q) return;
    if (!/^select\s/i.test(q)) {
      setQueryError("Only SELECT queries are allowed.");
      setRows(null);
      return;
    }
    setIsRunning(true);
    setQueryError(null);
    setRows(null);
    try {
      const data = await call("run-query", { sql: q });
      setRows(data.rows ?? []);
      setRowCount(data.count ?? 0);
    } catch (e: any) {
      setQueryError(e.message || "Query failed");
    } finally {
      setIsRunning(false);
    }
  }

  function selectQuickQuery(q: typeof QUICK_QUERIES[number]) {
    setSql(q.sql);
    runQuery(q.sql);
  }

  const columns = rows && rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4" /> Database Inspector
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Read-only. SELECT queries only.</p>

        {/* Quick query pills */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_QUERIES.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => selectQuickQuery(q)}
              className="px-2.5 py-1 text-xs rounded-full border border-border bg-muted/50 text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              {q.label}
            </button>
          ))}
        </div>

        {/* SQL textarea */}
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="SELECT * FROM assets LIMIT 10"
          className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runQuery(); }}
        />

        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm" className="gap-1.5"
            onClick={() => runQuery()}
            disabled={isRunning || !sql.trim()}
          >
            {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run Query
          </Button>
          {rows !== null && (
            <span className="text-xs text-muted-foreground">{rowCount} row{rowCount !== 1 ? "s" : ""} returned</span>
          )}
        </div>

        {/* Error */}
        {queryError && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-md p-2 text-xs text-destructive font-mono whitespace-pre-wrap">
            {queryError}
          </div>
        )}

        {/* Results table */}
        {rows && rows.length > 0 && (
          <div className="border border-border rounded-md overflow-auto max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={col} className="text-xs font-mono whitespace-nowrap">{col}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={col} className="text-xs font-mono max-w-[300px] truncate">
                        {row[col] === null ? <span className="text-muted-foreground italic">null</span> : typeof row[col] === "object" ? JSON.stringify(row[col]) : String(row[col])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {rows && rows.length === 0 && !queryError && (
          <p className="text-xs text-muted-foreground">Query returned 0 rows.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 8: Style Groups ─────────────────────────────────────────

function StyleGroupsSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [rebuildProgress, setRebuildProgress] = useState<{ assigned: number; groups: number; done: boolean } | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["style-group-stats"],
    queryFn: async () => {
      const [groupRes, ungroupedRes] = await Promise.all([
        call("run-query", { sql: "SELECT COUNT(*) as count FROM style_groups" }),
        call("run-query", { sql: "SELECT COUNT(*) as count FROM assets WHERE style_group_id IS NULL AND is_deleted = false" }),
      ]);
      return {
        groups: groupRes.rows?.[0]?.count ?? 0,
        ungrouped: ungroupedRes.rows?.[0]?.count ?? 0,
      };
    },
    staleTime: 15_000,
  });

  async function runRebuild() {
    if (!confirm("This will delete all existing style groups and rebuild them from scratch. Continue?")) return;
    setRebuildProgress({ assigned: 0, groups: 0, done: false });
    let offset = 0;
    let totalGroups = 0;
    let totalAssigned = 0;

    try {
      while (true) {
        const data = await call("rebuild-style-groups", { offset });
        totalGroups += data.groups_created ?? 0;
        totalAssigned += data.assets_assigned ?? 0;
        setRebuildProgress({ assigned: totalAssigned, groups: totalGroups, done: false });
        if (data.done) break;
        offset = data.nextOffset;
      }
      setRebuildProgress({ assigned: totalAssigned, groups: totalGroups, done: true });
      toast.success(`Created ${totalGroups} style groups, assigned ${totalAssigned} assets`);
      queryClient.invalidateQueries({ queryKey: ["style-group-stats"] });
      queryClient.invalidateQueries({ queryKey: ["style-groups"] });
      queryClient.invalidateQueries({ queryKey: ["ungrouped-asset-count"] });
    } catch (e: any) {
      toast.error(e.message || "Rebuild failed");
    } finally {
      setTimeout(() => setRebuildProgress(null), 3000);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4" /> Style Groups
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats && (
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{Number(stats.groups).toLocaleString()}</span> groups · <span className="text-foreground font-medium">{Number(stats.ungrouped).toLocaleString()}</span> ungrouped assets
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline" size="sm" className="gap-1.5"
            onClick={runRebuild}
            disabled={rebuildProgress !== null && !rebuildProgress.done}
          >
            {rebuildProgress !== null && !rebuildProgress.done ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Rebuild Style Groups
          </Button>
        </div>
        {rebuildProgress && !rebuildProgress.done && (
          <p className="text-xs text-muted-foreground">
            {rebuildProgress.groups} groups created, {rebuildProgress.assigned} assets assigned…
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Tab ────────────────────────────────────────────────────────

export default function DiagnosticsTab() {
  const { call } = useAdminApi();
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["admin-doctor"],
    queryFn: async () => {
      const result = await call("doctor");
      setLastRefreshed(new Date());
      return result;
    },
    refetchInterval: 30_000,
  });

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const diag: DiagnosticData | null = data?.diagnostic ?? null;

  return (
    <div className="space-y-4">
      {/* Header with last refreshed */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Stethoscope className="h-5 w-5" /> System Health
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lastRefreshed && (
            <span>Last refreshed: {lastRefreshed.toLocaleTimeString()}</span>
          )}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRefresh}>
            <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {isLoading && !diag ? (
        <Card>
          <CardContent className="p-6 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading diagnostics…
          </CardContent>
        </Card>
      ) : diag ? (
        <>
          <OverviewCards counts={diag.counts} />
          <ConnectedAgents agents={diag.agents} />
          <ScanStatusCard progress={diag.scan_progress} />
          <RecentErrors errors={diag.recent_errors} />
          <ConfigurationSection config={diag.config} />
          <ActionsSection onRefresh={handleRefresh} />
          <DatabaseInspector />
          <StyleGroupsSection />
        </>
      ) : (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              Failed to load diagnostics. Click refresh to try again.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
