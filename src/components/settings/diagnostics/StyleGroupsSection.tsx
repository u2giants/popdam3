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
import { formatDuration, formatEta, calcRate, ProgressRow } from "./progress-utils";

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
  const p = state.progress ?? {};
  const now = Date.now();
  const overallElapsed = state.started_at ? now - new Date(state.started_at).getTime() : 0;
  const stageElapsed = (p.stage_started_at as string)
    ? now - new Date(p.stage_started_at as string).getTime()
    : overallElapsed;

  const stage = (p.stage as string) || state.last_stage || "clear_assets";
  const totalAssets = (p.total_assets as number) || 0;

  const STAGES = [
    { key: "clear_assets", label: "Clear assignments" },
    { key: "delete_groups", label: "Delete old groups" },
    { key: "rebuild_assets", label: "Assign to groups" },
    {
      key: "finalize_stats",
      label: stage === "finalize_stats" && ((p.substage as string) || state.last_substage) === "primaries"
        ? "Select covers" : "Compute counts",
    },
  ];
  const stageIndex = STAGES.findIndex(st => st.key === stage);

  return (
    <div className="border border-border rounded-md p-3 space-y-3 mt-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {s.icon}
          <span className={`font-medium ${s.color}`}>{s.label}</span>
        </div>
        {state.started_at && (
          <span className="text-xs text-muted-foreground tabular-nums">
            Started: {new Date(state.started_at).toLocaleString()}
          </span>
        )}
      </div>

      {/* Stage pipeline */}
      <div className="flex items-center gap-1 text-xs flex-wrap">
        {STAGES.map((st, i) => (
          <React.Fragment key={st.key}>
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
              i < stageIndex ? "bg-muted text-muted-foreground line-through" :
              i === stageIndex ? "bg-primary/15 text-primary border border-primary/30" :
              "bg-muted/50 text-muted-foreground/50"
            }`}>
              {i + 1}. {st.label}
            </span>
            {i < 3 && <span className="text-muted-foreground/40">→</span>}
          </React.Fragment>
        ))}
      </div>

      {/* Timing row */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        {overallElapsed > 0 && (
          <span>Total elapsed: <span className="text-foreground tabular-nums">{formatDuration(overallElapsed)}</span></span>
        )}
        {stageElapsed > 0 && stageElapsed !== overallElapsed && (
          <span>Stage elapsed: <span className="text-foreground tabular-nums">{formatDuration(stageElapsed)}</span></span>
        )}
        {state.run_id && (
          <span className="ml-auto text-muted-foreground/60 font-mono">Run: {state.run_id.slice(0, 8)}…</span>
        )}
      </div>

      {/* Stage-specific progress */}
      {stage === "clear_assets" && (() => {
        const cleared = (p.cleared as number) || 0;
        const rate = calcRate(cleared, stageElapsed);
        return <ProgressRow label="Assets cleared" done={cleared} total={totalAssets || null} ratePerMin={rate} />;
      })()}

      {stage === "delete_groups" && (() => {
        const deleted = (p.groups_deleted as number) || 0;
        const total = (p.total_groups_before_delete as number) || null;
        const rate = calcRate(deleted, stageElapsed);
        return <ProgressRow label="Groups deleted" done={deleted} total={total} ratePerMin={rate} suffix="groups" />;
      })()}

      {stage === "rebuild_assets" && (() => {
        const processed = (p.total_processed as number) || 0;
        const rate = calcRate(processed, stageElapsed);
        return (
          <div className="space-y-2">
            <ProgressRow label="Assets assigned" done={processed} total={totalAssets || null} ratePerMin={rate} />
            <div className="flex gap-4 text-xs text-muted-foreground">
              {(p.groups as number) > 0 && <span>Groups created: <span className="text-foreground font-medium">{(p.groups as number).toLocaleString()}</span></span>}
              {(p.assigned as number) > 0 && <span>Assigned: <span className="text-foreground font-medium">{(p.assigned as number).toLocaleString()}</span></span>}
            </div>
          </div>
        );
      })()}

      {stage === "finalize_stats" && (() => {
        const sub = (p.substage as string) || state.last_substage || "counts";
        const totalGroups = (p.finalize_total_groups as number) || null;
        const done = sub === "primaries"
          ? (p.primaries_processed as number) || 0
          : (p.counts_processed as number) || 0;
        const rate = calcRate(done, stageElapsed);
        const label = sub === "primaries" ? "Cover images selected" : "Group counts computed";
        return <ProgressRow label={label} done={done} total={totalGroups} ratePerMin={rate} suffix="groups" />;
      })()}

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
          <div className="border border-border rounded-md p-3 space-y-2 mt-2">
            {/* Reconcile status header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                {reconcileOp.isActive
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  : reconcileOp.state.status === "completed"
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
                    : reconcileOp.isInterrupted
                      ? <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--warning))]" />
                      : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                <span className="font-medium text-sm">
                  {reconcileOp.isActive ? "Reconciling…"
                    : reconcileOp.state.status === "completed" ? "Reconcile complete"
                    : reconcileOp.isInterrupted ? "Reconcile interrupted"
                    : "Reconcile failed"}
                </span>
              </div>
              {reconcileOp.state.started_at && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Elapsed: {formatDuration(Date.now() - new Date(reconcileOp.state.started_at).getTime())}
                </span>
              )}
            </div>

            {/* Sub-stage indicator */}
            {reconcileOp.state.progress && (() => {
              const p = reconcileOp.state.progress;
              const sub = (p.stage as string) || "counts";
              const totalGroups = (p.total_groups as number) || 0;
              const elapsedMs = reconcileOp.state.started_at
                ? Date.now() - new Date(reconcileOp.state.started_at).getTime()
                : 0;

              return (
                <div className="space-y-2">
                  {/* Sub-stage pipeline strip */}
                  <div className="flex items-center gap-1 text-xs">
                    {["counts", "primaries"].map((stg, i) => (
                      <span key={stg} className="flex items-center gap-1">
                        <span className={`px-1.5 py-0.5 rounded font-medium ${
                          (sub === "counts" && stg === "counts") || (sub === "primaries" && stg === "primaries") || (sub === "counts_done" && stg === "counts")
                            ? "bg-primary/15 text-primary border border-primary/30"
                            : sub === "primaries" && stg === "counts"
                              ? "bg-muted text-muted-foreground line-through"
                              : sub === "complete"
                                ? "bg-muted text-muted-foreground line-through"
                                : "bg-muted/50 text-muted-foreground/50"
                        }`}>
                          {i + 1}. {stg === "counts" ? "Compute counts" : "Select covers"}
                        </span>
                        {i === 0 && <span className="text-muted-foreground/40">→</span>}
                      </span>
                    ))}
                  </div>

                  {/* Counts progress */}
                  {(sub === "counts" || sub === "counts_done") && (() => {
                    const done = (p.counts_processed as number) || 0;
                    const rate = calcRate(done, elapsedMs);
                    return <ProgressRow label="Groups with counts updated" done={done} total={totalGroups > 0 ? totalGroups : null} ratePerMin={rate} suffix="groups" />;
                  })()}

                  {/* Primaries progress */}
                  {(sub === "primaries" || sub === "complete") && (() => {
                    const done = (p.primaries_processed as number) || 0;
                    const rate = calcRate(done, elapsedMs);
                    return <ProgressRow label="Groups with covers selected" done={done} total={totalGroups > 0 ? totalGroups : null} ratePerMin={rate} suffix="groups" />;
                  })()}
                </div>
              );
            })()}

            {reconcileOp.state.result_message && (
              <p className="text-xs text-[hsl(var(--success))]">{reconcileOp.state.result_message}</p>
            )}
            {reconcileOp.state.error && (
              <p className="text-xs text-destructive">{reconcileOp.state.error}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
