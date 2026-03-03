import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import {
  RefreshCw, Play, Database, BarChart3, AlertCircle,
  CheckCircle2, Clock, Loader2, Eye, Zap, Bot,
} from "lucide-react";

// ── ERP Sync Section ─────────────────────────────────────────────────

function ErpSyncSection() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const { data: syncRuns, isLoading: runsLoading, refetch: refetchRuns } = useQuery({
    queryKey: ["erp-sync-runs"],
    queryFn: () => call("erp-sync-runs"),
  });

  const runs = syncRuns?.runs || [];
  const lastRun = runs[0];

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await call("trigger-erp-sync");
      toast.success(`ERP Sync complete: ${result.total_fetched} items fetched, ${result.total_upserted} upserted`);
      refetchRuns();
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
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
          <Button size="sm" onClick={handleSync} disabled={syncing} className="gap-1.5">
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {syncing ? "Syncing..." : "Run Sync Now"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          Endpoint: <code className="text-xs bg-muted px-1 py-0.5 rounded">api.item.designflow.app</code>
        </div>

        {lastRun && (
          <div className="border border-border rounded-md p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Last Sync</span>
              <Badge variant={lastRun.status === "completed" ? "default" : lastRun.status === "running" ? "secondary" : "destructive"}>
                {lastRun.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5 font-mono">
              <div>Started: {new Date(lastRun.started_at).toLocaleString()}</div>
              {lastRun.ended_at && <div>Duration: {Math.round((new Date(lastRun.ended_at).getTime() - new Date(lastRun.started_at).getTime()) / 1000)}s</div>}
              <div>Fetched: {lastRun.total_fetched} | Upserted: {lastRun.total_upserted} | Errors: {lastRun.total_errors}</div>
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
                  <span>{r.status} — {r.total_fetched} fetched</span>
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="ERP Items Synced" value={s.total_erp_items ?? 0} icon={<Database className="h-4 w-4" />} />
            <StatCard label="Has mgCategory" value={s.with_mg_category ?? 0} icon={<CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />} />
            <StatCard label="Rule-Classified" value={s.rule_classified ?? 0} icon={<Zap className="h-4 w-4 text-primary" />} />
            <StatCard label="AI-Classified" value={s.ai_classified ?? 0} icon={<Bot className="h-4 w-4 text-[hsl(var(--info))]" />} />
            <StatCard label="Needs AI" value={s.needs_ai ?? 0} icon={<AlertCircle className="h-4 w-4 text-[hsl(var(--warning))]" />} />
            <StatCard label="Pending Review" value={s.pending_review ?? 0} icon={<Clock className="h-4 w-4 text-[hsl(var(--warning))]" />} />
            <StatCard label="SKU Matched" value={s.sku_matched ?? 0} icon={<CheckCircle2 className="h-4 w-4" />} />
            <StatCard label="Unmatched SKUs" value={s.unmatched_skus ?? 0} icon={<AlertCircle className="h-4 w-4 text-destructive" />} />
          </div>
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
                {String(classifyOp.state.progress.classified || 0)} / {String(classifyOp.state.progress.total || "?")} classified
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
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["erp-review-queue"],
    queryFn: () => call("erp-review-queue"),
  });

  const items = data?.items || [];

  const approveMutation = useMutation({
    mutationFn: (params: { id: string; category?: string }) =>
      call("erp-review-action", { prediction_id: params.id, action: "approve", override_category: params.category }),
    onSuccess: () => {
      toast.success("Prediction approved");
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["erp-stats"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => call("erp-review-action", { prediction_id: id, action: "reject" }),
    onSuccess: () => {
      toast.success("Prediction rejected");
      queryClient.invalidateQueries({ queryKey: ["erp-review-queue"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const CATEGORIES = ["Wall", "Tabletop", "Clock", "Storage", "Workspace", "Floor", "Garden"];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertCircle className="h-4 w-4" /> Review Queue
          {items.length > 0 && (
            <Badge variant="secondary" className="text-xs">{items.length}</Badge>
          )}
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items pending review.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
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
                    <TableCell className="text-xs font-mono">{item.external_id}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{item.description || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{item.predicted_category}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className={item.confidence < 0.5 ? "text-destructive" : item.confidence < 0.65 ? "text-[hsl(var(--warning))]" : "text-foreground"}>
                        {(item.confidence * 100).toFixed(0)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-xs max-w-[150px] truncate text-muted-foreground">{item.rationale || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs text-[hsl(var(--success))]"
                          onClick={() => approveMutation.mutate({ id: item.id })}
                          disabled={approveMutation.isPending}
                        >
                          ✓
                        </Button>
                        <select
                          className="h-6 text-xs bg-muted border border-border rounded px-1"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              approveMutation.mutate({ id: item.id, category: e.target.value });
                              e.target.value = "";
                            }
                          }}
                        >
                          <option value="" disabled>Override…</option>
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs text-destructive"
                          onClick={() => rejectMutation.mutate(item.id)}
                          disabled={rejectMutation.isPending}
                        >
                          ✗
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
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
    </div>
  );
}
