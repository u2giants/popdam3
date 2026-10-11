import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Play, AlertCircle, CheckCircle2, Loader2, Eye, Zap, Bot, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ClassificationLiveLog } from "./LiveLogs";
import { EnrichmentApplyLiveLog } from "./LiveLogs";

export function EnrichmentControls() {
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
