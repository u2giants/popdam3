import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Database, Clock, RefreshCw, Loader2, CheckCircle2, XCircle,
  AlertTriangle, Trash2, Wrench,
} from "lucide-react";
import type { RequestOpFn } from "./types";
import { OP_NAMES, REASON_LABELS, timeAgo } from "./types";

// ── Rebuild Status Detail ───────────────────────────────────────────

function RebuildStatusDetail({ state }: { state: { status: string; cursor?: number; progress?: Record<string, unknown>; error?: string; started_at?: string; updated_at?: string; interruption_reason_code?: string; auto_resume_attempts?: number; run_id?: string; last_stage?: string; last_substage?: string; result_message?: string } }) {
  const statusMap: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    idle: { label: "Idle", color: "text-muted-foreground", icon: <Clock className="h-3.5 w-3.5" /> },
    running: { label: "Running…", color: "text-primary", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    completed: { label: "Completed", color: "text-[hsl(var(--success))]", icon: <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))]" /> },
    completed_with_repair: { label: "Completed — auto-repair queued", color: "text-[hsl(var(--warning))]", icon: <Wrench className="h-3.5 w-3.5 text-[hsl(var(--warning))]" /> },
    interrupted: { label: "Interrupted — Resumable", color: "text-[hsl(var(--warning))]", icon: <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--warning))]" /> },
    failed: { label: "Failed", color: "text-destructive", icon: <XCircle className="h-3.5 w-3.5 text-destructive" /> },
  };
  const s = statusMap[state.status] || statusMap.idle;
  const p = state.progress;

  return (
    <div className="border border-border rounded-md p-3 space-y-2 mt-2">
      <div className="flex items-center gap-2 text-sm">
        {s.icon}
        <span className={`font-medium ${s.color}`}>{s.label}</span>
        {state.started_at && (
          <span className="text-xs text-muted-foreground ml-auto">Started: {new Date(state.started_at).toLocaleString()}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {state.last_stage && <span>Stage: <span className="text-foreground font-mono">{state.last_stage}</span></span>}
        {state.last_substage && <span>Substage: <span className="text-foreground font-mono">{state.last_substage}</span></span>}
        {typeof state.cursor === "number" && <span>Cursor: <span className="text-foreground font-mono">{state.cursor}</span></span>}
        {state.run_id && <span>Run: <span className="text-foreground font-mono">{state.run_id.slice(0, 8)}…</span></span>}
      </div>

      {p && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {typeof p.groups === "number" && (p.groups as number) > 0 && <span>Groups created: <span className="text-foreground font-medium">{(p.groups as number).toLocaleString()}</span></span>}
          {typeof p.assigned === "number" && (p.assigned as number) > 0 && <span>Assets assigned: <span className="text-foreground font-medium">{(p.assigned as number).toLocaleString()}</span></span>}
          {(p.stage === "finalize_stats" || state.last_stage === "finalize_stats") ? (
            <>
              {p.substage === "primaries" || state.last_substage === "primaries" ? (
                <span className="col-span-2">
                  Finalizing primaries: <span className="text-foreground font-medium">{((p.primaries_processed as number) || 0).toLocaleString()}</span>
                  {typeof p.finalize_total_groups === "number" && (p.finalize_total_groups as number) > 0
                    ? <> / {(p.finalize_total_groups as number).toLocaleString()} groups</>
                    : <> groups</>}
                </span>
              ) : (
                <span className="col-span-2">
                  Finalizing counts: <span className="text-foreground font-medium">{((p.counts_processed as number) || 0).toLocaleString()}</span>
                  {typeof p.finalize_total_groups === "number" && (p.finalize_total_groups as number) > 0
                    ? <> / {(p.finalize_total_groups as number).toLocaleString()} groups</>
                    : <> groups</>}
                </span>
              )}
            </>
          ) : typeof p.total_processed === "number" && typeof p.total_assets === "number" ? (
            <span className="col-span-2">
              Progress: <span className="text-foreground font-medium">{(p.total_processed as number).toLocaleString()}</span> / {(p.total_assets as number).toLocaleString()} assets
              {state.status === "running" && state.started_at && (p.total_processed as number) > 0 && (() => {
                const elapsedMs = Date.now() - new Date(state.started_at!).getTime();
                const rate = (p.total_processed as number) / (elapsedMs / 60000);
                const remaining = ((p.total_assets as number) - (p.total_processed as number)) / rate;
                if (remaining < 1) return <span className="text-muted-foreground ml-2">· &lt;1 min left</span>;
                if (remaining < 60) return <span className="text-muted-foreground ml-2">· ~{Math.round(remaining)} min left</span>;
                return <span className="text-muted-foreground ml-2">· ~{(remaining / 60).toFixed(1)} hrs left</span>;
              })()}
            </span>
          ) : null}
        </div>
      )}

      {/* Progress bar for rebuild_assets stage */}
      {typeof p?.total_processed === "number" && typeof p?.total_assets === "number" && (p.total_assets as number) > 0 && p?.stage !== "finalize_stats" && (
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${state.status === "failed" ? "bg-destructive" : state.status === "interrupted" ? "bg-[hsl(var(--warning))]" : "bg-primary"}`}
            style={{ width: `${Math.min(100, Math.round(((p.total_processed as number) / (p.total_assets as number)) * 100))}%` }}
          />
        </div>
      )}

      {/* Progress bar for finalize_stats stage */}
      {(p?.stage === "finalize_stats" || state.last_stage === "finalize_stats") && typeof p?.finalize_total_groups === "number" && (p.finalize_total_groups as number) > 0 && (
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${state.status === "failed" ? "bg-destructive" : state.status === "interrupted" ? "bg-[hsl(var(--warning))]" : "bg-primary"}`}
            style={{ width: `${Math.min(100, Math.round((((p.substage === "primaries" ? (p.primaries_processed as number || 0) : (p.counts_processed as number || 0))) / (p.finalize_total_groups as number)) * 100))}%` }}
          />
        </div>
      )}

      {/* Interruption reason */}
      {state.interruption_reason_code && state.status === "interrupted" && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Reason:</span>
          <Badge variant="outline" className="text-xs">{REASON_LABELS[state.interruption_reason_code] || state.interruption_reason_code}</Badge>
          {typeof state.auto_resume_attempts === "number" && state.auto_resume_attempts > 0 && (
            <span className="text-muted-foreground">· Auto-resume attempts: {state.auto_resume_attempts}</span>
          )}
        </div>
      )}

      {state.result_message && (state.status === "completed" || state.status === "completed_with_repair") && (
        <p className="text-xs text-[hsl(var(--success))]">{state.result_message}</p>
      )}

      {state.error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-md p-2 text-xs text-destructive font-mono whitespace-pre-wrap">
          {state.error}
        </div>
      )}

      {state.status === "interrupted" && state.interruption_reason_code !== "user_stop" && (
        <p className="text-xs text-[hsl(var(--warning))]">
          ↳ Auto-resume is enabled. The system will retry automatically, or you can click "Resume" to continue manually.
        </p>
      )}

      {state.status === "interrupted" && state.interruption_reason_code === "user_stop" && (
        <p className="text-xs text-[hsl(var(--warning))]">
          ↳ You stopped this operation. Click "Resume Rebuild Style Groups" to continue from where it stopped.
        </p>
      )}

      {state.status === "completed_with_repair" && (
        <p className="text-xs text-[hsl(var(--warning))]">
          ↳ Rebuild completed but some groups had missing stats. A reconcile operation was auto-queued to fix covers and counts.
        </p>
      )}

      {state.status === "failed" && (
        <p className="text-xs text-muted-foreground">
          ↳ You can try "Rebuild Style Groups" again to restart, or run "Reconcile Stats" to fix counts/covers without a full rebuild.
        </p>
      )}

      {state.updated_at && (
        <p className="text-xs text-muted-foreground">Last updated: {timeAgo(state.updated_at)}</p>
      )}
    </div>
  );
}

// ── Main Section ────────────────────────────────────────────────────

export function StyleGroupsSection({ requestOp }: { requestOp: RequestOpFn }) {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const rebuildOp = usePersistentOperation("rebuild-style-groups");
  const reconcileOp = usePersistentOperation("reconcile-style-group-stats");

  const { data: stats } = useQuery({
    queryKey: ["style-group-stats"],
    queryFn: async () => {
      const [groupRes, ungroupedRes, anomalyRes] = await Promise.all([
        call("run-query", { sql: "SELECT COUNT(*) as count FROM style_groups" }),
        call("run-query", { sql: "SELECT COUNT(*) as count FROM assets WHERE style_group_id IS NULL AND is_deleted = false" }),
        call("run-query", { sql: "SELECT COUNT(*) as count FROM style_groups sg WHERE (sg.asset_count IS NULL OR sg.asset_count = 0) AND EXISTS (SELECT 1 FROM assets a WHERE a.style_group_id = sg.id AND a.is_deleted = false LIMIT 1)" }),
      ]);
      return {
        groups: groupRes.rows?.[0]?.count ?? 0,
        ungrouped: ungroupedRes.rows?.[0]?.count ?? 0,
        anomalous: anomalyRes.rows?.[0]?.count ?? 0,
      };
    },
    staleTime: 15_000,
  });

  function runRebuild(forceRestart = false) {
    const isFreshStart = forceRestart || !rebuildOp.isInterrupted;
    requestOp("rebuild-style-groups", OP_NAMES["rebuild-style-groups"],
      () => rebuildOp.start({
        confirmMessage: forceRestart
          ? "This will WIPE all existing style groups and rebuild from scratch. Continue?"
          : rebuildOp.isInterrupted
            ? "Resume the interrupted style-group rebuild from the last processed cursor?"
            : "This will delete all existing style groups and rebuild them from scratch. Continue?",
        params: isFreshStart ? { force_restart: true } : undefined,
        forceRestart: isFreshStart,
      }),
      () => rebuildOp.queue({
        params: isFreshStart ? { force_restart: true } : undefined,
        forceRestart: isFreshStart,
      }),
    );
  }

  function runReconcile() {
    requestOp("reconcile-style-group-stats", OP_NAMES["reconcile-style-group-stats"],
      () => reconcileOp.start({
        confirmMessage: "Recompute asset counts, file dates, and cover images for all style groups? This is safe to re-run.",
      }),
      () => reconcileOp.queue({ params: {} }),
    );
  }

  const showRebuildDetail = rebuildOp.state.status !== "idle";
  const showReconcileDetail = reconcileOp.state.status !== "idle";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Database className="h-4 w-4" /> Style Groups
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats && (
          <div className="text-sm text-muted-foreground space-y-0.5">
            <p>
              <span className="text-foreground font-medium">{Number(stats.groups).toLocaleString()}</span> groups · <span className="text-foreground font-medium">{Number(stats.ungrouped).toLocaleString()}</span> ungrouped assets
            </p>
            {Number(stats.anomalous) > 0 && (
              <p className="text-[hsl(var(--warning))]">
                ⚠ <span className="font-medium">{Number(stats.anomalous).toLocaleString()}</span> groups have missing counts/covers — run Reconcile to fix
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2 items-center">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm" className="gap-1.5"
                  onClick={() => runRebuild(false)}
                  disabled={rebuildOp.isActive || reconcileOp.isActive}
                >
                  {rebuildOp.isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {rebuildOp.isInterrupted ? "Resume Rebuild" : "Rebuild Style Groups"}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px] text-center">
                {rebuildOp.isInterrupted
                  ? "Resume the interrupted rebuild from where it stopped"
                  : "Deletes all style groups and re-creates them from asset folder structure."}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="destructive" size="sm" className="gap-1.5 text-xs"
                  onClick={() => runRebuild(true)}
                  disabled={reconcileOp.isActive}
                >
                  <Trash2 className="h-3 w-3" /> Start Fresh
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px] text-center">Wipe all progress and restart the rebuild from scratch</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline" size="sm" className="gap-1.5"
                  onClick={runReconcile}
                  disabled={(rebuildOp.isActive && rebuildOp.state.progress?.stage !== "finalize_stats") || reconcileOp.isActive}
                >
                  {reconcileOp.isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                  {reconcileOp.isInterrupted ? "Resume Reconcile" : "Reconcile Stats"}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px] text-center">Recomputes asset counts, latest file dates, and cover images for all style groups. Safe to re-run. No groups are deleted.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {rebuildOp.isActive && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7 text-destructive" onClick={() => rebuildOp.stop()}>
              <XCircle className="h-3 w-3" /> Stop
            </Button>
          )}
          {(rebuildOp.isInterrupted || rebuildOp.state.status === "failed" || rebuildOp.isCompletedWithRepair) && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => rebuildOp.reset()}>Dismiss</Button>
          )}
          {(reconcileOp.isInterrupted || reconcileOp.state.status === "failed" || reconcileOp.state.status === "completed") && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => reconcileOp.reset()}>Dismiss Reconcile</Button>
          )}
        </div>

        {showRebuildDetail && <RebuildStatusDetail state={rebuildOp.state} />}
        {showReconcileDetail && (
          <div className="border border-border rounded-md p-3 space-y-1.5 mt-2">
            <div className="flex items-center gap-2 text-sm">
              {reconcileOp.isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> :
               reconcileOp.state.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))]" /> :
               reconcileOp.isInterrupted ? <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--warning))]" /> :
               <XCircle className="h-3.5 w-3.5 text-destructive" />}
              <span className="font-medium">
                {reconcileOp.isActive ? "Reconciling…" : reconcileOp.state.status === "completed" ? "Reconcile complete" : reconcileOp.isInterrupted ? "Reconcile interrupted" : "Reconcile failed"}
              </span>
            </div>
            {reconcileOp.state.progress && (
              <p className="text-xs text-muted-foreground">
                Counts: {((reconcileOp.state.progress.counts_processed as number) || 0).toLocaleString()} · 
                Primaries: {((reconcileOp.state.progress.primaries_processed as number) || 0).toLocaleString()}
              </p>
            )}
            {reconcileOp.state.result_message && <p className="text-xs text-[hsl(var(--success))]">{reconcileOp.state.result_message}</p>}
            {reconcileOp.state.error && <p className="text-xs text-destructive">{reconcileOp.state.error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
