import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { getMgCategory, getMg01Desc, getMg02Desc, getMg03Desc } from "@/lib/mg-lookup";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import {
  RefreshCw, Play, Database, BarChart3, AlertCircle,
  CheckCircle2, Clock, Loader2, Eye, Zap, Bot, Search,
  ChevronLeft, ChevronRight, List, Undo2, X, Check, Pencil,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ── ERP Sync Section ─────────────────────────────────────────────────

function ErpSyncSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState("");

  const { data: syncRuns, isLoading: runsLoading, refetch: refetchRuns } = useQuery({
    queryKey: ["erp-sync-runs"],
    queryFn: () => call("erp-sync-runs"),
  });

  const { data: configData } = useQuery({
    queryKey: ["erp-config"],
    queryFn: () => call("get-config"),
  });

  const runs = syncRuns?.runs || [];
  const lastRun = runs[0];

  // Read watermark from config (defensive fallback pattern)
  const rawWatermark = configData?.config?.ERP_LAST_SYNC_DATE;
  const watermark = typeof rawWatermark === "string"
    ? rawWatermark
    : rawWatermark?.value ?? rawWatermark ?? null;

  // Read endpoint from config
  const DEFAULT_ENDPOINT = "https://api.designflow.app/api/item_master/lib/getApiAllItems";
  const rawEndpoint = configData?.config?.ERP_SYNC_ENDPOINT;
  const currentEndpoint = typeof rawEndpoint === "string"
    ? rawEndpoint
    : rawEndpoint?.value ?? rawEndpoint ?? DEFAULT_ENDPOINT;
  const endpointHost = (() => { try { return new URL(String(currentEndpoint)).host; } catch { return String(currentEndpoint); } })();

  const handleSaveEndpoint = async () => {
    const trimmed = endpointDraft.trim();
    if (!trimmed || !trimmed.startsWith("http")) {
      toast.error("Endpoint must be a valid URL starting with http");
      return;
    }
    try {
      await call("set-config", { key: "ERP_SYNC_ENDPOINT", value: trimmed });
      toast.success("Endpoint updated");
      setEditingEndpoint(false);
      queryClient.invalidateQueries({ queryKey: ["erp-config"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleSync = async (fullSync = false) => {
    setSyncing(true);
    try {
      const payload: Record<string, unknown> = {};
      if (fullSync) payload.full_sync = true;
      const result = await call("trigger-erp-sync", payload);
      const modeLabel = result.sync_mode === "incremental" ? "Incremental" : "Full";
      toast.success(`${modeLabel} sync complete: ${result.total_fetched} items fetched, ${result.total_upserted} upserted`);
      refetchRuns();
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
      queryClient.invalidateQueries({ queryKey: ["erp-config"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <CardTitle className="text-base flex items-center gap-2 cursor-help">
              <Database className="h-4 w-4" /> ERP Data Sync
            </CardTitle>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">Pulls product data from the ERP system into the local erp_items_current table. Click the endpoint to change the API URL. Run incrementally for new items, or Full Sync to re-download everything.</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => refetchRuns()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh sync history</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => handleSync(true)} disabled={syncing} title={syncing ? "Sync in progress…" : undefined} className="gap-1.5">
                <Database className="h-3.5 w-3.5" />
                Full Sync
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">Re-download ALL items from the ERP regardless of date — slower but ensures nothing is missed</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" onClick={() => handleSync(false)} disabled={syncing} title={syncing ? "Sync in progress…" : undefined} className="gap-1.5">
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                {syncing ? "Syncing..." : "Incremental Sync"}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">Download only items changed since the last sync watermark date — fast, runs in seconds</TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            Endpoint:{" "}
            {editingEndpoint ? (
              <span className="flex items-center gap-1">
                <Input
                  value={endpointDraft}
                  onChange={(e) => setEndpointDraft(e.target.value)}
                  className="h-6 text-xs w-[400px]"
                  placeholder="https://..."
                  onKeyDown={(e) => e.key === "Enter" && handleSaveEndpoint()}
                />
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleSaveEndpoint}><Check className="h-3 w-3" /></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingEndpoint(false)}><X className="h-3 w-3" /></Button>
              </span>
            ) : (
              <>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{endpointHost}</code>
                <Button variant="ghost" size="icon" className="h-5 w-5 ml-1" onClick={() => { setEndpointDraft(String(currentEndpoint)); setEditingEndpoint(true); }} title="Edit endpoint URL">
                  <Pencil className="h-3 w-3" />
                </Button>
              </>
            )}
          </span>
          {watermark && (
            <span className="flex items-center gap-1.5 text-xs">
              <Clock className="h-3 w-3" />
              Last synced through: <strong className="text-foreground">{watermark}</strong>
            </span>
          )}
        </div>

        {lastRun && (
          <div className="border border-border rounded-md p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Last Sync</span>
              <div className="flex items-center gap-2">
                {lastRun.run_metadata?.sync_mode && (
                  <Badge variant="outline" className="text-xs">
                    {lastRun.run_metadata.sync_mode}
                  </Badge>
                )}
                <Badge variant={lastRun.status === "completed" ? "default" : lastRun.status === "running" ? "secondary" : "destructive"}>
                  {lastRun.status}
                </Badge>
              </div>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5 font-mono">
              <div>Started: {new Date(lastRun.started_at).toLocaleString()}</div>
              {lastRun.ended_at && <div>Duration: {Math.round((new Date(lastRun.ended_at).getTime() - new Date(lastRun.started_at).getTime()) / 1000)}s</div>}
              <div>Fetched: {lastRun.total_fetched} | Upserted: {lastRun.total_upserted} | Errors: {lastRun.total_errors}</div>
              {lastRun.run_metadata?.start_date && (
                <div>Date range: {lastRun.run_metadata.start_date} → {lastRun.run_metadata.end_date}</div>
              )}
            </div>
          </div>
        )}

        {runs.length > 1 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Previous runs ({runs.length - 1})</summary>
            <div className="mt-2 space-y-1">
              {runs.slice(1, 6).map((r: any) => (
                <div key={r.id} className="flex items-center justify-between font-mono text-muted-foreground border-b border-border pb-1">
                  <span>{new Date(r.started_at).toLocaleDateString()}</span>
                  <span>
                    {r.run_metadata?.sync_mode ? `[${r.run_metadata.sync_mode}] ` : ""}
                    {r.status} — {r.total_fetched} fetched
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}

// ── Quality Dashboard ────────────────────────────────────────────────

function QualityDashboard() {
  const { call } = useAdminApi();
  const { data: stats, isLoading, refetch } = useQuery({
    queryKey: ["erp-stats"],
    queryFn: () => call("erp-enrichment-stats"),
  });

  const s = stats || {};

  return (
    <TooltipProvider delayDuration={200}>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <CardTitle className="text-base flex items-center gap-2 cursor-help">
              <BarChart3 className="h-4 w-4" /> Enrichment Quality
            </CardTitle>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">Overview of how many ERP items have been classified and how many of your assets/groups they match</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh stats</TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="ERP Items Synced" value={s.total_erp_items ?? 0} icon={<Database className="h-4 w-4" />} tooltip="Total number of product records pulled from the ERP system" />
              <StatCard label="Has mgCategory" value={s.with_mg_category ?? 0} icon={<CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />} tooltip="ERP items where the ERP system itself provides a product category (mg_category field) — no AI needed" />
              <StatCard label="No mgCategory" value={(s.total_erp_items ?? 0) - (s.with_mg_category ?? 0)} icon={<Clock className="h-4 w-4 text-[hsl(var(--warning))]" />} tooltip="ERP items where the API did not provide an mgCategory value" />
              <StatCard label="Rule-Classified" value={s.rule_classified ?? 0} icon={<Zap className="h-4 w-4 text-primary" />} tooltip="Items whose product category was determined by deterministic code rules (e.g. 'Clock' items always map to the Clock category) — no AI call needed" />
              <StatCard label="AI-Classified" value={s.ai_classified ?? 0} icon={<Bot className="h-4 w-4 text-[hsl(var(--info))]" />} tooltip="Items where Claude AI looked at the description and MG codes and predicted a product category" />
              <StatCard label="Needs AI" value={s.needs_ai ?? 0} icon={<AlertCircle className="h-4 w-4 text-[hsl(var(--warning))]" />} tooltip="Items with no category yet that have a matching SKU in your asset library — eligible for AI classification. Run 'Classify Now' to process these." />
              <StatCard label="Pending Review" value={s.pending_review ?? 0} icon={<Clock className="h-4 w-4 text-[hsl(var(--warning))]" />} tooltip="AI predictions with confidence below 65% — Claude wasn't sure enough to auto-apply. These appear in the Review Queue for you to approve or reject." />
              <StatCard label="SKU Matched" value={s.sku_matched ?? 0} icon={<CheckCircle2 className="h-4 w-4" />} tooltip="ERP items whose style_number (SKU) exists in at least one asset or style group — these can actually be enriched" />
              <StatCard label="Unmatched SKUs" value={s.unmatched_skus ?? 0} icon={<AlertCircle className="h-4 w-4 text-destructive" />} tooltip="ERP items whose SKU doesn't match any asset or style group — enrichment has no effect on these until the assets are uploaded" />
              {(s.unresolved_mg_codes ?? 0) > 0 && (
                <StatCard label="Unresolved MG Codes" value={s.unresolved_mg_codes ?? 0} icon={<AlertCircle className="h-4 w-4 text-amber-500" />} tooltip="Items whose MG01 value from the ERP API couldn't be matched to a schema code — run a Full Sync to re-process after the ERP data is corrected" />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}

function StatCard({ label, value, icon, tooltip }: { label: string; value: number; icon: React.ReactNode; tooltip?: string }) {
  const card = (
    <div className={`border border-border rounded-md p-3 space-y-1 ${tooltip ? "cursor-help" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold">{value.toLocaleString()}</div>
    </div>
  );
  if (!tooltip) return card;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

// ── Classification Live Log ───────────────────────────────────────────

function ClassificationLiveLog({ active }: { active: boolean }) {
  const [entries, setEntries] = useState<Array<{
    id: string;
    external_id: string;
    predicted_category: string;
    confidence: number;
    status: string;
    style_number: string | null;
    description: string | null;
    created_at: string;
  }>>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const poll = async () => {
      // Only fetch meaningful recent classifications (not unclassifiable junk)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("product_category_predictions")
        .select("id, external_id, predicted_category, confidence, status, created_at, input_context")
        .neq("status", "unclassifiable")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);

      if (cancelled || !data) return;
      setEntries(prev => {
        // Only update if data actually changed (prevent scroll resets)
        const newIds = data.map((r: any) => r.id).join(",");
        const oldIds = prev.map(r => r.id).join(",");
        if (newIds === oldIds) return prev;
        return data.map((r: any) => ({
          id: r.id,
          external_id: r.external_id,
          predicted_category: r.predicted_category,
          confidence: r.confidence,
          status: r.status,
          style_number: r.input_context?.style_number ?? null,
          description: r.input_context?.item_description ?? null,
          created_at: r.created_at,
        }));
      });
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [active]);


  if (entries.length === 0) return null;

  const visible = expanded ? entries : entries.slice(0, 8);

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <List className="h-3 w-3" /> Recent Classifications ({entries.length})
        </p>
        {entries.length > 8 && (
          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Collapse" : `Show all ${entries.length}`}
          </Button>
        )}
      </div>
      <div className={`overflow-auto border border-border rounded-md bg-background/80 ${expanded ? "max-h-72" : "max-h-40"}`}>
        <div className="divide-y divide-border">
          {visible.map((e) => (
            <div key={e.id} className="px-2.5 py-1.5 text-[11px] font-mono flex items-start gap-3">
              <span className="shrink-0 w-14 text-muted-foreground">{new Date(e.created_at).toLocaleTimeString()}</span>
              <span className="shrink-0 font-semibold text-foreground w-28 truncate" title={e.style_number || e.external_id}>
                {e.style_number || e.external_id}
              </span>
              <span className="flex-1 text-muted-foreground truncate" title={e.description || ""}>
                {e.description || "—"}
              </span>
              <Badge
                variant={e.status === "unclassifiable" ? "outline" : e.status === "auto_applied" ? "default" : "secondary"}
                className="shrink-0 text-[10px] h-4 px-1.5"
              >
                {e.predicted_category}
              </Badge>
              <span className="shrink-0 w-8 text-right text-muted-foreground">
                {e.confidence > 0 ? `${Math.round(e.confidence * 100)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Enrichment Apply Live Log ─────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  cover_description: "Description",
  product_category: "Category",
  mg01_code: "MG01",
  mg02_code: "MG02",
  mg03_code: "MG03",
  size_code: "Size",
  licensor_code: "Licensor",
  property_code: "Property",
  division_code: "Division",
};

interface EnrichmentLogEntry {
  id: string;
  target_type: string;
  target_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  confidence: number | null;
  run_id: string | null;
  applied_at: string;
}

function EnrichmentApplyLiveLog({ active, startedAt }: { active: boolean; startedAt?: string }) {
  const [entries, setEntries] = useState<EnrichmentLogEntry[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!startedAt) return;
    let cancelled = false;

    const poll = async () => {
      const { data } = await supabase
        .from("erp_enrichment_log")
        .select("id, target_type, target_id, field_name, old_value, new_value, source, confidence, run_id, applied_at")
        .gte("applied_at", startedAt)
        .order("applied_at", { ascending: false })
        .limit(500);

      if (cancelled || !data) return;
      setEntries(prev => {
        const newIds = data.map((r: any) => r.id).join(",");
        const oldIds = prev.map(r => r.id).join(",");
        if (newIds === oldIds) return prev;
        return data as EnrichmentLogEntry[];
      });
    };

    poll();
    // Poll while active, stop polling once completed
    if (active) {
      const interval = setInterval(poll, 3000);
      return () => { cancelled = true; clearInterval(interval); };
    }
    return () => { cancelled = true; };
  }, [active, startedAt]);

  if (entries.length === 0) return null;

  // Group by run_id + target_id to show one row per SKU/target
  const byTarget = new Map<string, EnrichmentLogEntry[]>();
  for (const e of entries) {
    const k = `${e.run_id ?? ""}:${e.target_id}`;
    if (!byTarget.has(k)) byTarget.set(k, []);
    byTarget.get(k)!.push(e);
  }
  const targetRows = [...byTarget.entries()].slice(0, expanded ? undefined : 12);
  const totalTargets = byTarget.size;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <List className="h-3 w-3" /> Enrichment Log ({entries.length} changes across {totalTargets} targets)
        </p>
        {totalTargets > 12 && (
          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Collapse" : `Show all ${totalTargets}`}
          </Button>
        )}
      </div>
      <div className={`overflow-auto border border-border rounded-md bg-background/80 ${expanded ? "max-h-80" : "max-h-48"}`}>
        <div className="divide-y divide-border">
          {targetRows.map(([key, fields]) => {
            const sample = fields[0];
            const fieldSummary = fields
              .map(f => {
                const label = FIELD_LABELS[f.field_name] || f.field_name;
                const arrow = f.old_value ? `${f.old_value}→${f.new_value}` : f.new_value;
                return `${label}: ${arrow}`;
              })
              .join(" · ");

            return (
              <div key={key} className="px-2.5 py-1.5 text-[11px] font-mono flex items-start gap-3">
                <span className="shrink-0 w-14 text-muted-foreground">
                  {new Date(sample.applied_at).toLocaleTimeString()}
                </span>
                <Badge variant="outline" className="shrink-0 text-[9px] h-4 px-1">
                  {sample.target_type === "asset" ? "AST" : sample.target_type === "style_group" ? "GRP" : "ERP"}
                </Badge>
                <span className="shrink-0 w-8 text-muted-foreground text-right">
                  {fields.length}f
                </span>
                <span className="flex-1 text-muted-foreground truncate" title={fieldSummary}>
                  {fieldSummary}
                </span>
                {sample.source && (
                  <Badge
                    variant={sample.source === "erp" ? "default" : "secondary"}
                    className="shrink-0 text-[9px] h-4 px-1"
                  >
                    {sample.source}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Enrichment Controls ──────────────────────────────────────────────

function EnrichmentControls() {
  const { call } = useAdminApi();
  const enrichOp = usePersistentOperation("erp-enrichment");
  const classifyOp = usePersistentOperation("erp-classify");
  const queryClient = useQueryClient();
  const [dryRunResult, setDryRunResult] = useState<any>(null);

  const handleDryRun = async () => {
    try {
      const result = await call("apply-erp-enrichment", { mode: "dry-run" });
      setDryRunResult(result);
      toast.success("Dry run complete");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleApply = async (force = false) => {
    const mode = force ? "apply-force" : "apply";
    const confirmMsg = force
      ? "Force-apply all ERP enrichment? This will overwrite existing values regardless of confidence."
      : "Apply ERP enrichment? Only higher-confidence values will overwrite existing ones.";
    await enrichOp.start({
      confirmMessage: confirmMsg,
      params: { mode },
    });
  };

  const handleClassify = async () => {
    await classifyOp.start({
      confirmMessage: "Run AI classification on unclassified ERP items?",
      params: {},
    });
  };

  return (
    <TooltipProvider delayDuration={200}>
    <Card>
      <CardHeader className="pb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <CardTitle className="text-base flex items-center gap-2 cursor-help">
              <Zap className="h-4 w-4" /> Enrichment Controls
            </CardTitle>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">Two-step process: (1) AI Classification assigns a product category to ERP items that lack one; (2) Apply Enrichment writes ERP attributes (category, MG codes, size, licensor…) to matching assets and style groups</TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* AI Classification */}
        <div
          className={`border rounded-md p-3 space-y-2 ${
            (classifyOp.state.status === "running" || classifyOp.state.status === "queued")
              ? "border-primary bg-primary/5"
              : classifyOp.state.status === "interrupted"
                ? "border-[hsl(var(--warning))] bg-[hsl(var(--warning)/0.08)]"
                : classifyOp.state.status === "failed"
                  ? "border-destructive/60 bg-destructive/5"
                  : "border-border"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {(classifyOp.state.status === "running" || classifyOp.state.status === "queued") && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium animate-pulse">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {classifyOp.state.status === "queued" ? "QUEUED" : "CLASSIFYING"}
                </div>
              )}
              {classifyOp.state.status === "interrupted" && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[hsl(var(--warning)/0.18)] text-[hsl(var(--warning))] text-[10px] font-medium">
                  <AlertCircle className="h-3 w-3" />
                  RETRYING
                </div>
              )}
              {classifyOp.state.status === "failed" && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-medium">
                  <AlertCircle className="h-3 w-3" />
                  FAILED
                </div>
              )}
              <div>
                <p className="text-sm font-medium">AI Classification</p>
                <p className="text-xs text-muted-foreground">Classify legacy items missing mgCategory into 7 product categories</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(classifyOp.state.status === "running" || classifyOp.state.status === "queued") ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="destructive" onClick={() => classifyOp.stop()} className="gap-1.5">
                      <X className="h-3.5 w-3.5" /> Stop
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Stop the classification run after the current batch finishes</TooltipContent>
                </Tooltip>
              ) : classifyOp.state.status === "interrupted" || classifyOp.state.status === "failed" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="secondary" onClick={handleClassify} className="gap-1.5">
                      <Play className="h-3.5 w-3.5" /> Retry
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Resume classification from where it stopped</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="secondary" onClick={handleClassify} className="gap-1.5">
                      <Bot className="h-3.5 w-3.5" /> Classify Now
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">Send unclassified ERP items to Claude AI (Haiku). Items with confidence ≥65% are auto-applied; lower confidence goes to the Review Queue for you to approve.</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
          {(classifyOp.state.status === "running" || classifyOp.state.status === "queued" || classifyOp.state.status === "interrupted") && (
            <div className="space-y-2">
              <Progress
                value={((classifyOp.state.progress?.classified as number || 0) / Math.max(classifyOp.state.progress?.total as number || 1, 1)) * 100}
                className="h-2"
              />
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{String(classifyOp.state.progress?.classified || 0)}</span> classified
                  {" · "}
                  <span className="font-medium text-foreground">{String(classifyOp.state.progress?.skipped_unclassifiable || 0)}</span> unclassifiable
                </span>
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{String(classifyOp.state.progress?.total || "?")}</span> scanned
                </span>
              </div>
              {classifyOp.state.status === "interrupted" && classifyOp.state.error && (
                <p className="text-[11px] text-[hsl(var(--warning))]">{classifyOp.state.error}</p>
              )}
            </div>
          )}
          {classifyOp.state.status === "completed" && (
            <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--success))]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {classifyOp.state.result_message}
            </div>
          )}
          {classifyOp.state.status === "failed" && classifyOp.state.error && (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {classifyOp.state.error}
            </div>
          )}
          <ClassificationLiveLog
            active={
              classifyOp.state.status === "running" ||
              classifyOp.state.status === "queued" ||
              classifyOp.state.status === "interrupted" ||
              classifyOp.state.status === "completed"
            }
          />
        </div>

        {/* Enrichment Apply */}
        <div className={`border rounded-md p-3 space-y-2 ${enrichOp.isActive ? "border-primary bg-primary/5" : "border-border"}`}>
          <div className="flex items-center justify-between">
            <div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-sm font-medium cursor-help">Apply Enrichment</p>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Walks every ERP item in batches of 100. For each item's style number (SKU), finds all matching assets and style groups and writes: product_category, mg01/02/03_code, size_code, licensor_code, property_code, division_code. One ERP item = one SKU = potentially many assets updated.
                </TooltipContent>
              </Tooltip>
              <p className="text-xs text-muted-foreground">Map ERP attributes to existing assets & style groups</p>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={handleDryRun} className="gap-1.5">
                    <Eye className="h-3.5 w-3.5" /> Dry Run
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">Preview what would be updated without writing anything — shows sample items, proposed field values, and match counts</TooltipContent>
              </Tooltip>
              {enrichOp.isActive ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="destructive" onClick={() => enrichOp.stop()} className="gap-1.5">
                      <X className="h-3.5 w-3.5" /> Stop
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Stop after the current batch of 100 ERP items finishes</TooltipContent>
                </Tooltip>
              ) : (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" onClick={() => handleApply(false)} className="gap-1.5">
                        <Play className="h-3.5 w-3.5" /> Apply
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">Write ERP fields to all matching assets and style groups. Only overwrites if the ERP value has higher confidence than the existing value.</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" variant="destructive" onClick={() => handleApply(true)} className="gap-1.5 text-xs">
                        Force
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">Force-write ALL ERP fields, overwriting existing values regardless of confidence. Use when you want ERP data to win unconditionally.</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
          {(enrichOp.isActive || enrichOp.state.status === "interrupted") && enrichOp.state.progress && (
            <div className="space-y-1.5">
              <Progress value={100} className="h-1.5 animate-pulse" />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">
                      <span className="font-medium text-foreground">{(enrichOp.state.progress.total as number || 0).toLocaleString()}</span> ERP items scanned
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">Number of ERP product records processed so far. Each "item" is one SKU/style number from the ERP system.</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">
                      <span className="font-medium text-foreground">{(enrichOp.state.progress.assets_updated as number || 0).toLocaleString()}</span> assets
                      {" · "}
                      <span className="font-medium text-foreground">{(enrichOp.state.progress.groups_updated as number || 0).toLocaleString()}</span> groups updated
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">Total individual database rows updated — one SKU can match many assets and groups, so this is typically much larger than "ERP items scanned"</TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}
          {enrichOp.state.status === "completed" && (
            <p className="text-xs text-[hsl(var(--success))]">{enrichOp.state.result_message}</p>
          )}
          <EnrichmentApplyLiveLog
            active={enrichOp.isActive}
            startedAt={enrichOp.state.started_at}
          />
        </div>

        {/* Dry Run Results */}
        {dryRunResult && (
          <div className="border border-border rounded-md p-3 bg-muted/30 space-y-2">
            <p className="text-sm font-medium">Dry Run Preview</p>
            <div className="text-xs text-muted-foreground font-mono space-y-0.5">
              <div>Assets to update: {dryRunResult.assets_to_update ?? 0}</div>
              <div>Groups to update: {dryRunResult.groups_to_update ?? 0}</div>
              <div>New categories: {dryRunResult.new_categories ?? 0}</div>
              <div>Skipped (lower confidence): {dryRunResult.skipped_lower_confidence ?? 0}</div>
            </div>
            {Array.isArray(dryRunResult.sample_updates) && dryRunResult.sample_updates.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs font-medium text-foreground">Sample proposed updates (first {dryRunResult.sample_updates.length})</p>
                <div className="max-h-56 overflow-auto space-y-1">
                  {dryRunResult.sample_updates.map((row: any, idx: number) => (
                    <div key={`${row.external_id}-${idx}`} className="rounded border border-border/60 bg-background/60 p-2 text-[11px] font-mono">
                      <div>SKU: <span className="text-foreground">{row.sku}</span> · ERP ID: <span className="text-foreground">{row.external_id}</span></div>
                      {row.description && <div className="text-muted-foreground truncate">Desc: <span className="text-foreground">{row.description}</span></div>}
                      <div>
                        AI category: <span className="text-foreground font-semibold">{row.predicted_category ?? "—"}</span>
                        {row.prediction_status && row.prediction_status !== "erp" && (
                          <span className={`ml-1.5 ${row.prediction_status === "pending" ? "text-yellow-500" : row.prediction_status === "auto_applied" ? "text-green-500" : "text-muted-foreground"}`}>
                            [{row.prediction_status}]
                          </span>
                        )}
                      </div>
                      <div>Matches → assets: <span className="text-foreground">{row.matching_asset_count ?? 0}</span>, groups: <span className="text-foreground">{row.matching_group_count ?? 0}</span></div>
                      <div>Source: <span className="text-foreground">{row.classification_source}</span> · Confidence: <span className="text-foreground">{typeof row.confidence === "number" ? `${Math.round(row.confidence * 100)}%` : "—"}</span></div>
                      <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-muted-foreground">{JSON.stringify(row.proposed_fields ?? {}, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}

// ── Review Queue ─────────────────────────────────────────────────────

import { TruncatedCell } from "@/components/ui/truncated-cell";
import { useTableFilterSort, FilterableHeaderRow, type ColumnDef } from "@/components/ui/filterable-table-head";

function ReviewQueue() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Column resize state
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<{ col: string; startX: number; startW: number } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["erp-review-queue", statusFilter, page],
    queryFn: () => call("erp-review-queue", { status: statusFilter, page, page_size: 100 }),
  });

  const items = data?.items || [];
  const totalPages = data?.total_pages ?? 1;
  const total = data?.total ?? 0;
  const statusCounts = data?.status_counts || {};

  const actionMutation = useMutation({
    mutationFn: (params: { id: string; action: string; category?: string }) =>
      call("erp-review-action", {
        prediction_id: params.id,
        review_action: params.action,
        override_category: params.category,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["erp-items-browse"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkRejectMutation = useMutation({
    mutationFn: (ids: string[]) =>
      call("erp-review-action", { review_action: "bulk-reject", prediction_ids: ids }),
    onSuccess: (_, ids) => {
      toast.success(`Rejected ${ids.length} predictions`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["erp-items-browse"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkDismissMutation = useMutation({
    mutationFn: (ids: string[]) =>
      call("erp-review-action", { review_action: "bulk-dismiss", prediction_ids: ids }),
    onSuccess: (_, ids) => {
      toast.success(`Dismissed ${ids.length} items — they will never be re-classified`);
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["erp-items-browse"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i: any) => i.id)));
    }
  };

  const CATEGORIES = ["Wall", "Tabletop", "Clock", "Storage", "Workspace", "Floor", "Garden"];
  const STATUS_TABS = [
    { key: "pending", label: "Pending", tooltip: "AI predictions with 50–64% confidence — Claude had some doubt. Review and approve or reject each one." },
    { key: "low_confidence", label: "Low Confidence (<50%)", tooltip: "AI predictions where Claude was less than 50% confident — likely ambiguous or junk product descriptions. These will not be auto-applied." },
    { key: "auto_applied", label: "Auto-Applied", tooltip: "Predictions with ≥65% confidence that were automatically accepted — 'Apply Enrichment' will use these as the product_category. You can still revert them to Pending." },
    { key: "approved", label: "Approved", tooltip: "Predictions you manually approved (or overrode with a different category). These are treated the same as Auto-Applied." },
    { key: "rejected", label: "Rejected", tooltip: "Predictions you marked as wrong. The item can still be re-classified by running AI Classification again." },
    { key: "unclassifiable", label: "Unclassifiable", tooltip: "Items where the product description was too vague or nonsensical for the AI to classify — e.g. a description that is just a style number, or 'TEST'." },
  ];

  const canRevert = statusFilter === "auto_applied" || statusFilter === "approved";
  const canApprove = statusFilter === "pending";
  const canReject = statusFilter === "pending" || statusFilter === "auto_applied";

  const REVIEW_COLS: ColumnDef[] = [
    { key: "style", label: "Style #", sortable: true, filterable: true },
    { key: "description", label: "Description", sortable: true, filterable: true },
    { key: "predicted", label: "Predicted", sortable: true, filterable: true },
    { key: "confidence", label: "Confidence", sortable: true },
    { key: "rationale", label: "Rationale", filterable: true },
    { key: "actions", label: "Actions" },
  ];

  const getReviewCell = useCallback((item: any, key: string): string => {
    switch (key) {
      case "style": return item.style_number || item.external_id || "";
      case "description": return item.description || "";
      case "predicted": return item.predicted_category || "";
      case "confidence": return String(Math.round((item.confidence ?? 0) * 100));
      case "rationale": return item.rationale || "";
      default: return "";
    }
  }, []);

  const {
    processed: filteredItems,
    sortKey: reviewSortKey,
    sortDir: reviewSortDir,
    filters: reviewFilters,
    suggestions: reviewSuggestions,
    toggleSort: reviewToggleSort,
    setFilter: reviewSetFilter,
    clearFilter: reviewClearFilter,
    hasActiveFilters: reviewHasActiveFilters,
  } = useTableFilterSort(items, REVIEW_COLS, getReviewCell);

  const handleResizeStart = (col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest("th");
    const startW = colWidths[col] || th?.offsetWidth || 120;
    setResizing({ col, startX: e.clientX, startW });

    const onMouseMove = (ev: MouseEvent) => {
      const diff = ev.clientX - e.clientX;
      setColWidths((prev) => ({ ...prev, [col]: Math.max(60, startW + diff) }));
    };
    const onMouseUp = () => {
      setResizing(null);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <TooltipProvider delayDuration={200}>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <CardTitle className="text-base flex items-center gap-2 cursor-help">
              <AlertCircle className="h-4 w-4" /> Review Queue
              <Badge variant="secondary" className="text-xs">{total}</Badge>
            </CardTitle>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">AI predictions that need human review before being applied to your assets. Only populated after running "AI Classification". Items auto-applied at ≥65% confidence bypass this queue.</TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && canReject && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1"
                    onClick={() => bulkRejectMutation.mutate([...selectedIds])}
                    disabled={bulkRejectMutation.isPending} title={bulkRejectMutation.isPending ? "Processing…" : undefined}
                  >
                    Reject {selectedIds.size}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reject these predictions — items can still be re-classified later</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="text-xs gap-1"
                    onClick={() => bulkDismissMutation.mutate([...selectedIds])}
                    disabled={bulkDismissMutation.isPending} title={bulkDismissMutation.isPending ? "Processing…" : undefined}
                  >
                    Dismiss {selectedIds.size}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Permanently dismiss — items will NEVER be re-classified</TooltipContent>
              </Tooltip>
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh the queue</TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status tabs */}
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => (
            <Tooltip key={tab.key}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={statusFilter === tab.key ? "default" : "outline"}
                  className="text-xs h-7 gap-1"
                  onClick={() => { setStatusFilter(tab.key); setPage(1); setSelectedIds(new Set()); }}
                >
                  {tab.label}
                  {typeof statusCounts[tab.key] === "number" && (
                    <span className="text-[10px] opacity-70">({statusCounts[tab.key]})</span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{tab.tooltip}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items in this status.</p>
        ) : (
          <div className="overflow-x-auto border border-border rounded-md">
              <table className="w-full caption-bottom text-sm" style={{ tableLayout: "fixed" }}>
                <thead className="[&_tr]:border-b">
                  <FilterableHeaderRow
                    columns={REVIEW_COLS}
                    sortKey={reviewSortKey}
                    sortDir={reviewSortDir}
                    filters={reviewFilters}
                    suggestions={reviewSuggestions}
                    onSort={reviewToggleSort}
                    onFilter={reviewSetFilter}
                    onClearFilter={reviewClearFilter}
                    prefixCells={(canReject || canRevert) ? [{
                      header: (
                        <input
                          type="checkbox"
                          checked={selectedIds.size === filteredItems.length && filteredItems.length > 0}
                          onChange={toggleAll}
                          className="rounded"
                        />
                      ),
                      filter: null,
                    }] : undefined}
                  />
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {filteredItems.map((item: any) => (
                    <tr key={item.id} className="border-b transition-colors hover:bg-muted/50">
                      {(canReject || canRevert) && (
                        <td className="p-2 align-middle w-10">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleSelect(item.id)}
                            className="rounded"
                          />
                        </td>
                      )}
                      <td
                        className="p-2 align-middle text-xs font-mono overflow-hidden"
                        style={colWidths["style"] ? { width: colWidths["style"], maxWidth: colWidths["style"] } : undefined}
                      >
                        <TruncatedCell>{item.style_number || item.external_id || "—"}</TruncatedCell>
                      </td>
                      <td
                        className="p-2 align-middle text-xs overflow-hidden"
                        style={colWidths["description"] ? { width: colWidths["description"], maxWidth: colWidths["description"] } : undefined}
                      >
                        <TruncatedCell>{item.description || "—"}</TruncatedCell>
                      </td>
                      <td
                        className="p-2 align-middle overflow-hidden"
                        style={colWidths["predicted"] ? { width: colWidths["predicted"], maxWidth: colWidths["predicted"] } : undefined}
                      >
                        <Badge variant="outline" className="text-xs">{item.predicted_category}</Badge>
                      </td>
                      <td
                        className="p-2 align-middle text-xs overflow-hidden"
                        style={colWidths["confidence"] ? { width: colWidths["confidence"], maxWidth: colWidths["confidence"] } : undefined}
                      >
                        <span className={item.confidence < 0.5 ? "text-destructive" : item.confidence < 0.65 ? "text-[hsl(var(--warning))]" : "text-foreground"}>
                          {(item.confidence * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td
                        className="p-2 align-middle text-xs overflow-hidden"
                        style={colWidths["rationale"] ? { width: colWidths["rationale"], maxWidth: colWidths["rationale"] } : undefined}
                      >
                        <TruncatedCell className="text-muted-foreground" tooltipText={item.rationale || "No rationale provided"}>
                          {item.rationale || "—"}
                        </TruncatedCell>
                      </td>
                      <td
                        className="p-2 align-middle overflow-hidden"
                        style={colWidths["actions"] ? { width: colWidths["actions"], maxWidth: colWidths["actions"] } : undefined}
                      >
                        <div className="flex items-center gap-1">
                          {canApprove && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0 text-[hsl(var(--success))]"
                                  onClick={() => actionMutation.mutate({ id: item.id, action: "approve" })}
                                  disabled={actionMutation.isPending} title={actionMutation.isPending ? "Processing…" : undefined}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Approve this prediction as correct</TooltipContent>
                            </Tooltip>
                          )}
                          {(canApprove || canRevert) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <select
                                  className="h-6 text-xs bg-muted border border-border rounded px-1"
                                  defaultValue=""
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      actionMutation.mutate({ id: item.id, action: "approve", category: e.target.value });
                                      e.target.value = "";
                                    }
                                  }}
                                >
                                  <option value="" disabled>Override…</option>
                                  {CATEGORIES.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                </select>
                              </TooltipTrigger>
                              <TooltipContent>Approve with a different category (overrides the AI prediction)</TooltipContent>
                            </Tooltip>
                          )}
                          {canReject && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0 text-destructive"
                                  onClick={() => actionMutation.mutate({ id: item.id, action: "reject" })}
                                  disabled={actionMutation.isPending} title={actionMutation.isPending ? "Processing…" : undefined}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Reject this prediction (can be re-classified later). Use "Dismiss" to permanently exclude.</TooltipContent>
                            </Tooltip>
                          )}
                          {canRevert && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs text-[hsl(var(--warning))] gap-1"
                                  onClick={() => actionMutation.mutate({ id: item.id, action: "revert" })}
                                  disabled={actionMutation.isPending} title={actionMutation.isPending ? "Processing…" : undefined}
                                >
                                  <Undo2 className="h-3 w-3" /> Undo
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Move back to Pending for re-review (undoes auto-apply or approval)</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages} ({total} items)
            </span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7" disabled={page <= 1} title={page <= 1 ? "Already on the first page" : undefined} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="outline" className="h-7" disabled={page >= totalPages} title={page >= totalPages ? "Already on the last page" : undefined} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}

// ── ERP Items Browser ────────────────────────────────────────────────

const ALL_CATEGORIES = ["Wall", "Tabletop", "Clock", "Storage", "Workspace", "Floor", "Garden", "Other"] as const;
type Category = typeof ALL_CATEGORIES[number];

const CATEGORY_BADGE: Record<string, string> = {
  Wall: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  Tabletop: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  Clock: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  Storage: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  Workspace: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  Floor: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  Garden: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  Other: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function ErpItemsBrowser() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [sortBy, setSortBy] = useState("prediction_confidence");
  const [sortAsc, setSortAsc] = useState(true);
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [selectedPredIds, setSelectedPredIds] = useState<Set<string>>(new Set());
  const [lastClickedIdx, setLastClickedIdx] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
    clearTimeout((window as any).__erpSearchTimer);
    (window as any).__erpSearchTimer = setTimeout(() => setDebouncedSearch(val), 400);
  };

  const effectiveSortBy = groupByCategory ? "category_then_confidence" : sortBy;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["erp-items-browse", debouncedSearch, page, pageSize, effectiveSortBy, sortAsc, pendingOnly],
    queryFn: () => call("erp-items-browse", {
      search: debouncedSearch,
      page,
      page_size: pageSize,
      sort_by: effectiveSortBy,
      sort_asc: sortAsc,
      pending_predictions_only: pendingOnly,
    }),
  });

  const items: any[] = data?.items || [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const reviewMutation = useMutation({
    mutationFn: (params: { action: "approve" | "reject"; prediction_id: string; override_category?: string }) =>
      call("erp-review-action", {
        review_action: params.action,
        prediction_id: params.prediction_id,
        ...(params.override_category ? { override_category: params.override_category } : {}),
      }),
    onSuccess: (_, params) => {
      toast.success(params.action === "approve" ? "Approved" : "Rejected");
      setOverrides((prev) => { const next = { ...prev }; delete next[params.prediction_id]; return next; });
      queryClient.invalidateQueries({ queryKey: ["erp-items-browse"] });
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const bulkMutation = useMutation({
    mutationFn: (params: { action: "bulk-approve" | "bulk-reject"; prediction_ids: string[] }) =>
      call("erp-review-action", { review_action: params.action, prediction_ids: params.prediction_ids }),
    onSuccess: (_, params) => {
      const n = params.prediction_ids.length;
      toast.success(params.action === "bulk-approve" ? `Approved ${n} items` : `Rejected ${n} items`);
      setSelectedPredIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["erp-items-browse"] });
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const handleSort = (col: string) => {
    if (sortBy === col) setSortAsc(!sortAsc);
    else { setSortBy(col); setSortAsc(col === "prediction_confidence"); }
    setPage(1);
  };

  const handleRowCheck = useCallback((predId: string, idx: number, e: React.MouseEvent<HTMLInputElement>) => {
    e.stopPropagation();
    setSelectedPredIds((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedIdx !== null) {
        const start = Math.min(lastClickedIdx, idx);
        const end = Math.max(lastClickedIdx, idx);
        for (let i = start; i <= end; i++) {
          const pid = items[i]?.prediction_id;
          if (pid) next.add(pid);
        }
      } else {
        if (next.has(predId)) next.delete(predId); else next.add(predId);
      }
      return next;
    });
    setLastClickedIdx(idx);
  }, [items, lastClickedIdx]);

  const eligibleItems = items.filter((i: any) => i.prediction_id);
  const toggleAll = () => {
    if (selectedPredIds.size === eligibleItems.length && eligibleItems.length > 0) {
      setSelectedPredIds(new Set());
    } else {
      setSelectedPredIds(new Set(eligibleItems.map((i: any) => i.prediction_id)));
    }
  };

  const renderMgCell = (code: string | null, desc: string | null, rawApiValue?: string | null) => {
    const effectiveCode = code && code.length === 1 ? code : null;
    const effectiveRaw = rawApiValue || (code && code.length > 1 ? code : null);
    if (!effectiveCode && !effectiveRaw) return <span className="text-muted-foreground/40">—</span>;
    if (!effectiveCode && effectiveRaw) return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help text-amber-600 dark:text-amber-400 text-xs">{effectiveRaw}</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">Unmatched in MG schema</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help text-xs">{desc || effectiveCode}</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">Code: {effectiveCode}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const SortTh = ({ col, label, className }: { col: string; label: string; className?: string }) => (
    <th
      className={`h-10 px-3 text-left align-middle font-medium text-muted-foreground text-xs cursor-pointer hover:text-foreground select-none whitespace-nowrap ${className ?? ""}`}
      onClick={() => handleSort(col)}
    >
      {label}{sortBy === col && <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>}
    </th>
  );

  return (
    <Card className="max-w-none">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <List className="h-4 w-4" /> ERP Items Browser
          <Badge variant="secondary" className="text-xs font-mono">{total.toLocaleString()}</Badge>
        </CardTitle>
        <div className="flex items-center gap-2">
          {selectedPredIds.size > 0 && (
            <>
              <Button size="sm" variant="outline"
                className="text-xs gap-1 border-green-500 text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
                onClick={() => bulkMutation.mutate({ action: "bulk-approve", prediction_ids: [...selectedPredIds] })}
                disabled={bulkMutation.isPending}
              >
                <Check className="h-3.5 w-3.5" /> Approve {selectedPredIds.size}
              </Button>
              <Button size="sm" variant="destructive" className="text-xs gap-1"
                onClick={() => bulkMutation.mutate({ action: "bulk-reject", prediction_ids: [...selectedPredIds] })}
                disabled={bulkMutation.isPending}
              >
                <X className="h-3.5 w-3.5" /> Reject {selectedPredIds.size}
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by style # or description..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={pendingOnly}
              onChange={(e) => { setPendingOnly(e.target.checked); setPage(1); setSelectedPredIds(new Set()); }}
              className="rounded"
            />
            Pending review only
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={groupByCategory}
              onChange={(e) => { setGroupByCategory(e.target.checked); setPage(1); }}
              className="rounded"
            />
            Group by category
          </label>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No items found.</p>
        ) : (
          <>
            <div className="overflow-x-auto border border-border rounded-md">
              <table className="w-full table-fixed caption-bottom text-sm">
                <colgroup>
                  <col className="w-10" />
                  <col className="w-[140px]" />
                  <col />{/* description — takes all remaining space */}
                  <col className="w-[140px]" />
                  <col className="w-[60px]" />
                  <col className="w-[90px]" />
                  <col className="w-[90px]" />
                  <col className="w-[90px]" />
                  <col className="w-[80px]" />
                </colgroup>
                <thead className="[&_tr]:border-b">
                  <tr className="border-b">
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                      <input type="checkbox"
                        checked={selectedPredIds.size === eligibleItems.length && eligibleItems.length > 0}
                        onChange={toggleAll} className="rounded"
                      />
                    </th>
                    <SortTh col="style_number" label="Style #" />
                    <SortTh col="item_description" label="Description" />
                    <SortTh col="predicted_category" label="AI Category" />
                    <SortTh col="prediction_confidence" label="Conf" />
                    <SortTh col="mg01_code" label="MG01" />
                    <SortTh col="mg02_code" label="MG02" />
                    <SortTh col="mg03_code" label="MG03" />
                    <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground text-xs">Actions</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {(() => {
                    const rows: React.ReactNode[] = [];
                    let lastCat: string | null = null;
                    items.forEach((item: any, idx: number) => {
                      const hasPred = !!item.prediction_id;
                      const effectiveCat = overrides[item.prediction_id] ?? item.predicted_category ?? null;
                      const confPct = hasPred ? Math.round((item.prediction_confidence ?? 0) * 100) : null;
                      const confColor = confPct === null ? "" : confPct >= 85 ? "text-green-600 dark:text-green-400" : confPct >= 65 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";
                      const isOverridden = hasPred && !!overrides[item.prediction_id];

                      if (groupByCategory && effectiveCat !== lastCat) {
                        lastCat = effectiveCat;
                        const badgeClass = effectiveCat ? (CATEGORY_BADGE[effectiveCat] ?? "bg-gray-100 text-gray-700") : "bg-muted text-muted-foreground";
                        rows.push(
                          <tr key={`group-${effectiveCat}-${idx}`} className="border-b bg-muted/40">
                            <td colSpan={9} className="px-3 py-1.5">
                              <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
                                {effectiveCat ?? "No prediction"}
                              </span>
                            </td>
                          </tr>
                        );
                      }

                      rows.push(
                        <tr key={item.id || item.external_id}
                          className={`border-b transition-colors hover:bg-muted/50 ${selectedPredIds.has(item.prediction_id) ? "bg-primary/10" : ""}`}
                        >
                          <td className="px-3 py-2 align-top w-10">
                            {hasPred && (
                              <input type="checkbox" checked={selectedPredIds.has(item.prediction_id)}
                                onClick={(e) => handleRowCheck(item.prediction_id, idx, e as unknown as React.MouseEvent<HTMLInputElement>)}
                                readOnly className="rounded cursor-pointer mt-0.5"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2 align-top text-xs font-mono whitespace-nowrap">{item.style_number ?? "—"}</td>
                          <td className="px-3 py-2 align-top text-xs whitespace-normal break-words leading-snug">
                            {item.item_description ?? <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {hasPred ? (
                              <div className="flex flex-col gap-0.5">
                                <select
                                  value={effectiveCat ?? ""}
                                  onChange={(e) => setOverrides((prev) => ({ ...prev, [item.prediction_id]: e.target.value }))}
                                  className={`rounded px-1.5 py-0.5 text-xs font-medium border-0 cursor-pointer focus:ring-1 focus:ring-primary ${CATEGORY_BADGE[effectiveCat ?? ""] ?? "bg-gray-100 text-gray-700"}`}
                                >
                                  {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                                {isOverridden && (
                                  <span className="text-[10px] text-muted-foreground line-through">{item.predicted_category}</span>
                                )}
                              </div>
                            ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                          </td>
                          <td className={`px-3 py-2 align-top text-xs font-medium tabular-nums ${confColor}`}>
                            {hasPred ? (
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help">{confPct}%</span>
                                  </TooltipTrigger>
                                  {item.prediction_rationale && (
                                    <TooltipContent side="top" className="max-w-xs text-xs whitespace-normal">
                                      {item.prediction_rationale}
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              </TooltipProvider>
                            ) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {renderMgCell(item.mg01_code, getMg01Desc(item.mg01_code), item.raw_mg_fields?.mg01)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {renderMgCell(item.mg02_code, getMg02Desc(item.mg01_code, item.mg02_code), item.raw_mg_fields?.mg02)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {renderMgCell(item.mg03_code, getMg03Desc(item.mg01_code, item.mg02_code, item.mg03_code), item.raw_mg_fields?.mg03)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {hasPred && (
                              <div className="flex items-center gap-1">
                                <Button size="icon" variant="ghost"
                                  className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                                  onClick={() => reviewMutation.mutate({ action: "approve", prediction_id: item.prediction_id, override_category: overrides[item.prediction_id] })}
                                  disabled={reviewMutation.isPending} title="Approve"
                                >
                                  <Check className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost"
                                  className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                                  onClick={() => reviewMutation.mutate({ action: "reject", prediction_id: item.prediction_id })}
                                  disabled={reviewMutation.isPending} title="Reject"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    });
                    return rows;
                  })()}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2">Page {page} of {totalPages}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Export ───────────────────────────────────────────────────────

export default function ErpEnrichmentTab() {
  return (
    <div className="space-y-4">
      <ErpSyncSection />
      <QualityDashboard />
      <EnrichmentControls />
      <ReviewQueue />
      <ErpItemsBrowser />
    </div>
  );
}
