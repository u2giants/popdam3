import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import {
  RefreshCw, Play, Database, BarChart3, AlertCircle,
  CheckCircle2, Clock, Loader2, Eye, Zap, Bot, Search,
  ChevronLeft, ChevronRight, List, Undo2, X, Check,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ── ERP Sync Section ─────────────────────────────────────────────────

function ErpSyncSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4" /> ERP Data Sync
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => refetchRuns()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleSync(true)} disabled={syncing} className="gap-1.5">
            <Database className="h-3.5 w-3.5" />
            Full Sync
          </Button>
          <Button size="sm" onClick={() => handleSync(false)} disabled={syncing} className="gap-1.5">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            {syncing ? "Syncing..." : "Incremental Sync"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Endpoint: <code className="text-xs bg-muted px-1 py-0.5 rounded">api.item.designflow.app</code></span>
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> Enrichment Quality
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="ERP Items Synced" value={s.total_erp_items ?? 0} icon={<Database className="h-4 w-4" />} />
              <StatCard label="Has mgCategory" value={s.with_mg_category ?? 0} icon={<CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />} />
              <StatCard label="Legacy (pre-cutoff)" value={s.legacy_items ?? 0} icon={<Clock className="h-4 w-4 text-[hsl(var(--warning))]" />} />
              <StatCard label="Rule-Classified" value={s.rule_classified ?? 0} icon={<Zap className="h-4 w-4 text-primary" />} />
              <StatCard label="AI-Classified" value={s.ai_classified ?? 0} icon={<Bot className="h-4 w-4 text-[hsl(var(--info))]" />} />
              <StatCard label="Needs AI" value={s.needs_ai ?? 0} icon={<AlertCircle className="h-4 w-4 text-[hsl(var(--warning))]" />} />
              <StatCard label="Pending Review" value={s.pending_review ?? 0} icon={<Clock className="h-4 w-4 text-[hsl(var(--warning))]" />} />
              <StatCard label="SKU Matched" value={s.sku_matched ?? 0} icon={<CheckCircle2 className="h-4 w-4" />} />
              <StatCard label="Unmatched SKUs" value={s.unmatched_skus ?? 0} icon={<AlertCircle className="h-4 w-4 text-destructive" />} />
            </div>
            {s.category_cutoff && (
              <p className="text-xs text-muted-foreground mt-2">
                Category cutoff date: <strong className="text-foreground">{s.category_cutoff}</strong> — items before this date have mgCategory nulled and require AI classification.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold">{value.toLocaleString()}</div>
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
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4" /> Enrichment Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* AI Classification */}
        <div className="border border-border rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">AI Classification</p>
              <p className="text-xs text-muted-foreground">Classify legacy items missing mgCategory into 7 product categories</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleClassify}
              disabled={classifyOp.isActive}
              className="gap-1.5"
            >
              {classifyOp.isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
              {classifyOp.isActive ? "Classifying..." : "Classify Now"}
            </Button>
          </div>
          {classifyOp.isActive && classifyOp.state.progress && (
            <div className="space-y-1">
              <Progress value={((classifyOp.state.progress.classified as number || 0) / Math.max(classifyOp.state.progress.total as number || 1, 1)) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {String(classifyOp.state.progress.classified || 0)} classified, {String(classifyOp.state.progress.skipped_unclassifiable || 0)} skipped (unclassifiable) — batch {String(classifyOp.state.progress.total || "?")} scanned
              </p>
            </div>
          )}
          {classifyOp.state.status === "completed" && (
            <p className="text-xs text-[hsl(var(--success))]">{classifyOp.state.result_message}</p>
          )}
        </div>

        {/* Enrichment Apply */}
        <div className="border border-border rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Apply Enrichment</p>
              <p className="text-xs text-muted-foreground">Map ERP attributes to existing assets & style groups</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleDryRun} className="gap-1.5">
                <Eye className="h-3.5 w-3.5" /> Dry Run
              </Button>
              <Button size="sm" onClick={() => handleApply(false)} disabled={enrichOp.isActive} className="gap-1.5">
                {enrichOp.isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Apply
              </Button>
              <Button size="sm" variant="destructive" onClick={() => handleApply(true)} disabled={enrichOp.isActive} className="gap-1.5 text-xs">
                Force
              </Button>
            </div>
          </div>
          {enrichOp.isActive && enrichOp.state.progress && (
            <div className="space-y-1">
              <Progress value={((enrichOp.state.progress.updated as number || 0) / Math.max(enrichOp.state.progress.total as number || 1, 1)) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {String(enrichOp.state.progress.updated || 0)} / {String(enrichOp.state.progress.total || "?")} updated
              </p>
            </div>
          )}
          {enrichOp.state.status === "completed" && (
            <p className="text-xs text-[hsl(var(--success))]">{enrichOp.state.result_message}</p>
          )}
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
  );
}

// ── Review Queue ─────────────────────────────────────────────────────

function ReviewQueue() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
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
    { key: "pending", label: "Pending" },
    { key: "auto_applied", label: "Auto-Applied" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "unclassifiable", label: "Unclassifiable" },
  ];

  const canRevert = statusFilter === "auto_applied" || statusFilter === "approved";
  const canApprove = statusFilter === "pending";
  const canReject = statusFilter === "pending" || statusFilter === "auto_applied";

  return (
    <TooltipProvider delayDuration={200}>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> Review Queue
          <Badge variant="secondary" className="text-xs">{total}</Badge>
        </CardTitle>
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
                    disabled={bulkRejectMutation.isPending}
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
                    disabled={bulkDismissMutation.isPending}
                  >
                    Dismiss {selectedIds.size}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Permanently dismiss — items will NEVER be re-classified</TooltipContent>
              </Tooltip>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Status tabs */}
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.key}
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
          ))}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items in this status.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {(canReject || canRevert) && (
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === items.length && items.length > 0}
                        onChange={toggleAll}
                        className="rounded"
                      />
                    </TableHead>
                  )}
                  <TableHead className="text-xs">Style #</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs">Predicted</TableHead>
                  <TableHead className="text-xs">Confidence</TableHead>
                  <TableHead className="text-xs">Rationale</TableHead>
                  <TableHead className="text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any) => (
                  <TableRow key={item.id}>
                    {(canReject || canRevert) && (
                      <TableCell className="w-8">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="rounded"
                        />
                      </TableCell>
                    )}
                    <TableCell className="text-xs font-mono">{item.style_number || item.external_id}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{item.description || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{item.predicted_category}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className={item.confidence < 0.5 ? "text-destructive" : item.confidence < 0.65 ? "text-[hsl(var(--warning))]" : "text-foreground"}>
                        {(item.confidence * 100).toFixed(0)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px]">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="truncate block cursor-help text-muted-foreground">{item.rationale || "—"}</span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-sm text-xs whitespace-normal">
                          {item.rationale || "No rationale provided"}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {canApprove && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-[hsl(var(--success))]"
                                onClick={() => actionMutation.mutate({ id: item.id, action: "approve" })}
                                disabled={actionMutation.isPending}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Approve this prediction as correct</TooltipContent>
                          </Tooltip>
                        )}
                        {/* Override dropdown — approve with a different category */}
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
                                disabled={actionMutation.isPending}
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
                                disabled={actionMutation.isPending}
                              >
                                <Undo2 className="h-3 w-3" /> Undo
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Move back to Pending for re-review (undoes auto-apply or approval)</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages} ({total} items)
            </span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="outline" className="h-7" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
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

function ErpItemsBrowser() {
  const { call } = useAdminApi();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(1000);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("synced_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [maxDigits, setMaxDigits] = useState<number | null>(null);

  // Debounce search
  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
    clearTimeout((window as any).__erpSearchTimer);
    (window as any).__erpSearchTimer = setTimeout(() => setDebouncedSearch(val), 400);
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["erp-items-browse", debouncedSearch, page, pageSize, sortBy, sortAsc, maxDigits],
    queryFn: () => call("erp-items-browse", {
      search: debouncedSearch,
      page,
      page_size: pageSize,
      sort_by: sortBy,
      sort_asc: sortAsc,
      ...(maxDigits !== null ? { max_digits: maxDigits } : {}),
    }),
  });

  const items = data?.items || [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(col);
      setSortAsc(true);
    }
    setPage(1);
  };

  const SortHeader = ({ col, label }: { col: string; label: string }) => (
    <TableHead
      className="text-xs cursor-pointer hover:text-foreground select-none"
      onClick={() => handleSort(col)}
    >
      {label}
      {sortBy === col && (
        <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>
      )}
    </TableHead>
  );

  const ATTRIBUTE_COLS = [
    { key: "style_number", label: "Style #" },
    { key: "item_description", label: "Description" },
    { key: "mg_category", label: "Category" },
    { key: "mg01_code", label: "MG01" },
    { key: "mg02_code", label: "MG02" },
    { key: "mg03_code", label: "MG03" },
    { key: "size_code", label: "Size" },
    { key: "licensor_code", label: "Licensor" },
    { key: "property_code", label: "Property" },
    { key: "division_code", label: "Division" },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <List className="h-4 w-4" /> ERP Items Browser
          <Badge variant="secondary" className="text-xs font-mono">{total.toLocaleString()}</Badge>
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by style # or description..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Max digits:</label>
            <Input
              type="number"
              min={1}
              max={20}
              placeholder="—"
              value={maxDigits ?? ""}
              onChange={(e) => {
                const v = e.target.value ? parseInt(e.target.value) : null;
                setMaxDigits(v);
                setPage(1);
              }}
              className="h-9 w-[70px] text-xs"
            />
            {maxDigits !== null && (
              <Button variant="ghost" size="sm" className="h-7 text-xs px-1.5" onClick={() => { setMaxDigits(null); setPage(1); }}>
                Clear
              </Button>
            )}
          </div>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    {ATTRIBUTE_COLS.map((col) => (
                      <SortHeader key={col.key} col={col.key} label={col.label} />
                    ))}
                    <SortHeader col="synced_at" label="Synced" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: any) => (
                    <>
                      <TableRow
                        key={item.external_id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedRow(expandedRow === item.external_id ? null : item.external_id)}
                      >
                        {ATTRIBUTE_COLS.map((col) => (
                          <TableCell key={col.key} className={`text-xs ${col.key === "item_description" ? "max-w-[200px] truncate" : ""}`}>
                            {item[col.key] ? (
                              <span className="text-foreground">{item[col.key]}</span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                        ))}
                        <TableCell className="text-xs text-muted-foreground">
                          {item.synced_at ? new Date(item.synced_at).toLocaleDateString() : "—"}
                        </TableCell>
                      </TableRow>
                      {expandedRow === item.external_id && (
                        <TableRow key={`${item.external_id}-detail`}>
                          <TableCell colSpan={ATTRIBUTE_COLS.length + 1} className="bg-muted/30 p-3">
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                              {ATTRIBUTE_COLS.map((col) => (
                                <div key={col.key}>
                                  <span className="text-muted-foreground">{col.label}: </span>
                                  <span className="font-mono text-foreground">{item[col.key] ?? "—"}</span>
                                </div>
                              ))}
                              <div>
                                <span className="text-muted-foreground">External ID: </span>
                                <span className="font-mono text-foreground">{item.external_id ?? "—"}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">MG04: </span>
                                <span className="font-mono text-foreground">{item.mg04_code ?? "—"}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">MG05: </span>
                                <span className="font-mono text-foreground">{item.mg05_code ?? "—"}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">MG06: </span>
                                <span className="font-mono text-foreground">{item.mg06_code ?? "—"}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">ERP Updated: </span>
                                <span className="font-mono text-foreground">
                                  {item.erp_updated_at ? new Date(item.erp_updated_at).toLocaleDateString() : "—"}
                                </span>
                              </div>
                            </div>
                            {item.raw_mg_fields && Object.keys(item.raw_mg_fields).some((k) => item.raw_mg_fields[k] != null) && (
                              <details className="mt-2">
                                <summary className="text-xs cursor-pointer text-muted-foreground hover:text-foreground">Raw MG Fields</summary>
                                <pre className="mt-1 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all select-all">
                                  {JSON.stringify(item.raw_mg_fields, null, 2)}
                                </pre>
                              </details>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
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
