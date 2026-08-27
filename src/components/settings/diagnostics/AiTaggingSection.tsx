import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAdminApi } from "@/hooks/useAdminApi";
import { isResumableOperationCursor, usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles, RefreshCw, Loader2, XCircle, Share2, Layers } from "lucide-react";
import type { RequestOpFn } from "./types";
import { OP_NAMES, operationReasonLabel, timeAgo } from "./types";
import { formatDuration, formatEta, calcRate } from "./progress-utils";
import type { OperationState } from "@/hooks/usePersistentOperation";

// ── Individual operation progress display ────────────────────────────

export function TaggingProgress({ opKey, op }: { opKey: string; op: ReturnType<typeof usePersistentOperation> }) {
  const s = op.state;
  const p = s.progress;
  if (!p) return null;

  const tagged = (p.tagged as number) || 0;
  const skipped = (p.skipped as number) || 0;
  const failed = (p.failed as number) || 0;
  const total = (p.total as number) || 0;
  const done = tagged + skipped + failed;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

  const isTerminal = s.status === "completed" || s.status === "failed";
  const endTime = !op.isActive && s.updated_at ? new Date(s.updated_at).getTime() : Date.now();
  const elapsedMs = s.started_at ? endTime - new Date(s.started_at).getTime() : 0;
  const rate = calcRate(done, elapsedMs);

  const label = OP_NAMES[opKey] || opKey;
  const canResume = (s.status === "failed" || s.status === "interrupted") && isResumableOperationCursor(opKey, s.cursor);
  const hasLegacyOffset = (s.status === "failed" || s.status === "interrupted") && typeof s.cursor === "number" && s.cursor > 0;

  return (
    <div className="space-y-2 rounded-md border border-border/50 p-3">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {op.isActive && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          <span className="font-medium">{label}</span>
          <StatusBadge status={s.status} reasonCode={s.interruption_reason_code} stage={s.last_stage} attempts={s.auto_resume_attempts} />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          {!op.isActive && s.updated_at && (
            <span title={new Date(s.updated_at).toLocaleString()}>
              {isTerminal ? "Finished" : "Stopped"} {timeAgo(s.updated_at)}
            </span>
          )}
          {op.isActive && elapsedMs > 0 && <span>Elapsed: {formatDuration(elapsedMs)}</span>}
          {op.isActive && (
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-destructive hover:text-destructive" onClick={() => op.stop()}>
              <XCircle className="h-3 w-3" />
            </Button>
          )}
          {canResume && (
            <Button variant="ghost" size="sm" className="h-5 px-2 text-xs text-primary hover:text-primary" onClick={() => op.start()}>
              <RefreshCw className="h-3 w-3 mr-1" /> Resume
            </Button>
          )}
          {hasLegacyOffset && opKey === "ai-tag-untagged" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-2 text-xs text-primary hover:text-primary"
              onClick={() => op.start({
                forceRestart: true,
                confirmMessage: "Restart untagged AI tagging from the beginning? Already-tagged assets will be skipped safely.",
              })}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Restart safely
            </Button>
          )}
          {!op.isActive && s.status !== "idle" && (
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-xs" onClick={() => op.reset()}>Dismiss</Button>
          )}
        </div>
      </div>

      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Assets processed</span>
        <span className="text-foreground font-medium tabular-nums">
          {done.toLocaleString()}{total > 0 ? ` / ${total.toLocaleString()}` : ""}
          {pct !== null && <span className="text-muted-foreground ml-1">({pct}%)</span>}
        </span>
      </div>

      {pct !== null && (
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${s.status === "failed" ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {pct === null && op.isActive && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        </div>
      )}

      {op.isActive && s.external_job?.provider_batch_id && (
        <p className="text-xs text-muted-foreground">
          Waiting for OpenRouter batch {s.external_job.provider_batch_id.slice(0, 12)}
          {s.external_job.last_checked_at ? `; last checked ${timeAgo(s.external_job.last_checked_at)}` : ""}
        </p>
      )}

      {rate !== null && rate > 0 && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{Math.round(rate).toLocaleString()} assets/min</span>
          {total > done && <span>ETA: {formatEta(total - done, rate)}</span>}
        </div>
      )}

      <div className="flex gap-4 text-xs text-muted-foreground">
        <Link to={`/settings/ai-tagging-detail?op=${encodeURIComponent(opKey)}&view=tagged`} className="hover:underline underline-offset-2">
          Tagged: <span className="text-foreground font-medium">{tagged.toLocaleString()}</span>
        </Link>
        {skipped > 0 && (
          <Link to={`/settings/ai-tagging-detail?op=${encodeURIComponent(opKey)}&view=skipped`} className="hover:underline underline-offset-2">
            Skipped: <span className="text-foreground font-medium">{skipped.toLocaleString()}</span>
          </Link>
        )}
        <Link to={`/settings/ai-tagging-detail?op=${encodeURIComponent(opKey)}&view=failed`} className={failed > 0 ? "text-destructive underline underline-offset-2 hover:no-underline" : "hover:underline underline-offset-2"}>
          Failed: <span className="font-medium">{failed.toLocaleString()}</span>
        </Link>
      </div>

      {(s.status === "failed" || s.status === "interrupted") && s.error && (
        <p className="text-xs text-destructive">
          Error: {s.error}
          {s.auto_resume_attempts != null && s.auto_resume_attempts > 0 && (
            <span className="text-muted-foreground ml-1">(auto-resumed {s.auto_resume_attempts} time{s.auto_resume_attempts !== 1 ? "s" : ""})</span>
          )}
        </p>
      )}
      {s.next_auto_resume_at && new Date(s.next_auto_resume_at).getTime() > Date.now() && (
        <p className="text-xs text-muted-foreground">
          Next automatic retry at {new Date(s.next_auto_resume_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          {s.retry_page_size ? ` with ${s.retry_page_size} assets per page` : ""}
        </p>
      )}
      {hasLegacyOffset && opKey === "ai-tag-all" && (
        <p className="text-xs text-[hsl(var(--warning))]">This re-tag-all run cannot resume from legacy offset progress. Restarting will reprocess assets from the beginning.</p>
      )}
    </div>
  );
}

function GroupProfileProgress({ op }: { op: ReturnType<typeof usePersistentOperation> }) {
  const s = op.state;
  const p = s.progress;
  if (!p) return null;

  const profiled = (p.profiled as number) || 0;
  const unavailable = (p.visual_analysis_unavailable as number) || 0;
  const failed = (p.failed as number) || 0;
  const total = (p.total as number) || 0;
  const done = profiled + unavailable + failed;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

  const isTerminal = s.status === "completed" || s.status === "failed";
  const endTime = !op.isActive && s.updated_at ? new Date(s.updated_at).getTime() : Date.now();
  const elapsedMs = s.started_at ? endTime - new Date(s.started_at).getTime() : 0;
  const rate = calcRate(done, elapsedMs);
  const canResume = (s.status === "failed" || s.status === "interrupted")
    && isResumableOperationCursor("ai-tag-group-profiles", s.cursor);

  return (
    <div className="space-y-2 rounded-md border border-border/50 p-3">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {op.isActive && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          <span className="font-medium">{OP_NAMES["ai-tag-group-profiles"]}</span>
          <StatusBadge status={s.status} reasonCode={s.interruption_reason_code} />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          {!op.isActive && s.updated_at && (
            <span title={new Date(s.updated_at).toLocaleString()}>
              {isTerminal ? "Finished" : "Stopped"} {timeAgo(s.updated_at)}
            </span>
          )}
          {op.isActive && elapsedMs > 0 && <span>Elapsed: {formatDuration(elapsedMs)}</span>}
          {op.isActive && (
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-destructive hover:text-destructive" onClick={() => op.stop()}>
              <XCircle className="h-3 w-3" />
            </Button>
          )}
          {canResume && (
            <Button
              variant="ghost" size="sm" className="h-5 px-2 text-xs text-primary hover:text-primary"
              onClick={() => op.start({ confirmMessage: `Resume Style Group profiling? (${done.toLocaleString()} groups already processed)` })}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Resume
            </Button>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {profiled.toLocaleString()} profiled
        {unavailable > 0 && <> · {unavailable.toLocaleString()} without usable images</>}
        {failed > 0 && <> · {failed.toLocaleString()} failed</>}
        {pct !== null && <> · {pct}%</>}
        {rate > 0 && op.isActive && <> · {rate.toFixed(1)}/s</>}
      </div>
      {s.error && <p className="text-xs text-destructive">{s.error}</p>}
      {s.result_message && !op.isActive && <p className="text-xs text-muted-foreground">{s.result_message}</p>}
    </div>
  );
}

function GroupRefreshProgress({ op }: { op: ReturnType<typeof usePersistentOperation> }) {
  const s = op.state;
  const p = s.progress;
  if (!p) return null;

  const refreshed = (p.refreshed as number) || 0;
  const unchanged = (p.unchanged as number) || 0;
  const failed = (p.failed as number) || 0;
  const total = (p.total as number) || 0;
  const done = refreshed + unchanged + failed;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

  const isTerminal = s.status === "completed" || s.status === "failed";
  const endTime = !op.isActive && s.updated_at ? new Date(s.updated_at).getTime() : Date.now();
  const elapsedMs = s.started_at ? endTime - new Date(s.started_at).getTime() : 0;
  const rate = calcRate(done, elapsedMs);

  const canResume = (s.status === "failed" || s.status === "interrupted") && typeof s.cursor === "number" && s.cursor > 0;

  return (
    <div className="space-y-2 rounded-md border border-border/50 p-3">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {op.isActive && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          <span className="font-medium">{OP_NAMES["refresh-group-metadata"]}</span>
          <StatusBadge status={s.status} reasonCode={s.interruption_reason_code} />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          {!op.isActive && s.updated_at && (
            <span title={new Date(s.updated_at).toLocaleString()}>
              {isTerminal ? "Finished" : "Stopped"} {timeAgo(s.updated_at)}
            </span>
          )}
          {op.isActive && elapsedMs > 0 && <span>Elapsed: {formatDuration(elapsedMs)}</span>}
          {op.isActive && (
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-destructive hover:text-destructive" onClick={() => op.stop()}>
              <XCircle className="h-3 w-3" />
            </Button>
          )}
          {canResume && (
            <Button
              variant="ghost" size="sm" className="h-5 px-2 text-xs text-primary hover:text-primary"
              onClick={() => op.start({
                confirmMessage: `Resume the group metadata refresh? (${((p.refreshed as number) || 0) + ((p.unchanged as number) || 0)} groups already processed)`,
              })}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Resume
            </Button>
          )}
          {!op.isActive && s.status !== "idle" && (
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-xs" onClick={() => op.reset()}>Dismiss</Button>
          )}
        </div>
      </div>

      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">Groups processed</span>
        <span className="text-foreground font-medium tabular-nums">
          {done.toLocaleString()}{total > 0 ? ` / ${total.toLocaleString()}` : ""}
          {pct !== null && <span className="text-muted-foreground ml-1">({pct}%)</span>}
        </span>
      </div>

      {pct !== null && (
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${s.status === "failed" ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {rate !== null && rate > 0 && total > 0 && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{Math.round(rate).toLocaleString()} groups/min</span>
          <span>ETA: {formatEta(total - done, rate)}</span>
        </div>
      )}

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Refreshed: <span className="text-foreground font-medium">{refreshed.toLocaleString()}</span></span>
        {unchanged > 0 && <span>Already current: <span className="text-foreground font-medium">{unchanged.toLocaleString()}</span></span>}
        {failed > 0 && <span>Failed: <span className="text-foreground font-medium">{failed.toLocaleString()}</span></span>}
      </div>

      {(s.status === "failed" || s.status === "interrupted") && s.error && (
        <p className="text-xs text-destructive">
          Error: {s.error}
          {s.auto_resume_attempts != null && s.auto_resume_attempts > 0 && (
            <span className="text-muted-foreground ml-1">(auto-resumed {s.auto_resume_attempts} time{s.auto_resume_attempts !== 1 ? "s" : ""})</span>
          )}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status, reasonCode, stage, attempts }: { status: OperationState["status"]; reasonCode?: string; stage?: string; attempts?: number }) {
  if (status === "idle") return null;
  const labels: Record<string, { text: string; cls: string }> = {
    running: { text: "Running", cls: "text-primary" },
    completed: { text: "✓ Complete", cls: "text-green-500" },
    completed_with_repair: { text: "✓ Complete (repaired)", cls: "text-green-500" },
    failed: { text: "✗ Failed", cls: "text-destructive" },
    interrupted: { text: "⏸ Interrupted", cls: "text-yellow-500" },
    queued: { text: "Queued", cls: "text-muted-foreground" },
  };
  const l = labels[status] ?? { text: status, cls: "text-muted-foreground" };
  return (
    <span className={`text-xs ${l.cls}`}>
      {l.text}
      {(status === "interrupted" || status === "failed") && reasonCode && (
        <span className="text-muted-foreground ml-1">
          - {reasonCode === "statement_timeout" && (attempts ?? 0) >= 10
            ? `${stage === "candidate_fetch" ? "Candidate lookup" : "Database query"} timed out - automatic retries exhausted`
            : operationReasonLabel(reasonCode, stage)}
        </span>
      )}
    </span>
  );
}

// ── Main section ─────────────────────────────────────────────────────

export function AiTaggingSection({ requestOp }: { requestOp: RequestOpFn }) {
  const { call } = useAdminApi();

  const tagUntaggedOp = usePersistentOperation("ai-tag-untagged");
  const tagAllOp = usePersistentOperation("ai-tag-all");
  // Canonical key. `propagate-group-tags` remains a compatibility alias in the
  // backend, but the UI only ever starts the safe refresh.
  const groupRefreshOp = usePersistentOperation("refresh-group-metadata");
  // During the transition an in-flight run may still be under the deprecated key.
  // Watch it too so its progress is visible instead of silently disappearing.
  const legacyPropagateOp = usePersistentOperation("propagate-group-tags");
  const groupProfileOp = usePersistentOperation("ai-tag-group-profiles");

  const { data: tagCounts } = useQuery({
    queryKey: ["untagged-asset-count"],
    queryFn: async () => {
      const r = await call("count-untagged-assets");
      return {
        untagged: r.count as number,
        totalWithThumbnails: r.totalWithThumbnails as number,
        waitingForSiblings: (r.waitingForSiblings as number) || 0,
      };
    },
  });

  const { data: groupCounts } = useQuery({
    queryKey: ["groups-for-refresh"],
    queryFn: async () => {
      const r = await call("count-groups-for-propagation");
      return { totalGroups: r.total_groups as number };
    },
  });

  const untaggedCount = tagCounts?.untagged ?? 0;
  const totalWithThumb = tagCounts?.totalWithThumbnails ?? 0;
  const totalGroups = groupCounts?.totalGroups ?? 0;
  const waitingForSiblings = tagCounts?.waitingForSiblings ?? 0;

  // anyTaggingActive: a tagging op is running or queued → block starting another tagging op.
  // anyActive: includes the group refresh too → only used for the refresh button.
  // Keeping these separate lets the user start tagging even when a refresh is still
  // running/queued (e.g. left over from a previous "Tag + Refresh" run). The conflict
  // dialog will handle the cross-lane conflict if the worker can't accept the new op yet.
  const anyTaggingActive =
    tagUntaggedOp.isActive || tagUntaggedOp.isQueued ||
    tagAllOp.isActive    || tagAllOp.isQueued ||
    groupProfileOp.isActive || groupProfileOp.isQueued;
  const anyActive = anyTaggingActive || groupRefreshOp.isActive || groupRefreshOp.isQueued
    || legacyPropagateOp.isActive || legacyPropagateOp.isQueued
    || groupProfileOp.isActive || groupProfileOp.isQueued;

  function runBulkTag(mode: "untagged" | "all") {
    const op = mode === "all" ? tagAllOp : tagUntaggedOp;
    const total = mode === "all" ? totalWithThumb : untaggedCount;
    const opKey = mode === "all" ? "ai-tag-all" : "ai-tag-untagged";

    requestOp(opKey, OP_NAMES[opKey],
      () => op.start({
        confirmMessage: mode === "all"
          ? `Re-tag all ${total.toLocaleString()} assets with thumbnails? This will overwrite existing AI tags. Continue?`
          : `AI tag ${total.toLocaleString()} untagged assets? Continue?`,
        initialProgress: {},
      }),
      () => op.queue({ initialProgress: {} }),
    );
  }

  function runGroupProfiles() {
    requestOp("ai-tag-group-profiles", OP_NAMES["ai-tag-group-profiles"],
      () => groupProfileOp.start({
        confirmMessage: `Build a shared artwork profile for each of the ${totalGroups.toLocaleString()} style groups? Product facts are written once on the group — no file tags are copied to siblings. Continue?`,
        initialProgress: { total: totalGroups },
      }),
      () => groupProfileOp.queue({ initialProgress: { total: totalGroups } }),
    );
  }

  function runGroupRefresh() {
    requestOp("refresh-group-metadata", OP_NAMES["refresh-group-metadata"],
      () => groupRefreshOp.start({
        confirmMessage: `Refresh shared product facts and search for all ${totalGroups.toLocaleString()} style groups? Individual file tags are not changed and nothing is copied between files. Continue?`,
        initialProgress: { total: totalGroups },
      }),
      () => groupRefreshOp.queue({ initialProgress: { total: totalGroups } }),
    );
  }

  function runTagAndRefresh() {
    const total = untaggedCount;
    // Start tagging from scratch. If a refresh is already queued/running from a prior
    // "Tag + Propagate" run, reset it first so we don't have a stale queued entry blocking
    // the new flow. The worker enforces OP_CONFLICTS and won't promote propagation until
    // tagging completes — so these two jobs run sequentially automatically.
    const startFn = async () => {
      // If a refresh is queued or running from before, reset it to avoid a stale queue entry
      if (groupRefreshOp.isActive || groupRefreshOp.isQueued) {
        await groupRefreshOp.reset();
      }
      await tagUntaggedOp.start({
        confirmMessage: `Smart Tag + Refresh: AI-tag untagged files, then refresh each style group's shared product facts and search. No tags are copied between files. Continue?`,
        initialProgress: {},
        forceRestart: true,
      });
      await groupRefreshOp.queue({ initialProgress: { total: totalGroups } });
    };
    requestOp("ai-tag-untagged", OP_NAMES["ai-tag-untagged"],
      startFn,
      () => tagUntaggedOp.queue({ initialProgress: {} }),
    );
  }

  // Determine which ops have non-idle state (show progress for each independently)
  const showTagUntagged = tagUntaggedOp.state.status !== "idle" && tagUntaggedOp.state.progress;
  const showTagAll = tagAllOp.state.status !== "idle" && tagAllOp.state.progress;
  const showGroupRefresh = groupRefreshOp.state.status !== "idle" && groupRefreshOp.state.progress;
  const showLegacyRefresh = legacyPropagateOp.state.status !== "idle" && legacyPropagateOp.state.progress;
  const showGroupProfiles = groupProfileOp.state.status !== "idle" && groupProfileOp.state.progress;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> AI Tagging
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground font-semibold">{untaggedCount.toLocaleString()}</span> assets with thumbnails have not been AI tagged
          <span className="text-muted-foreground ml-1">({totalWithThumb.toLocaleString()} total with thumbnails)</span>
        </p>
        {waitingForSiblings > 0 && (
          <p className="text-sm text-muted-foreground">
            <span className="text-[hsl(var(--warning))] font-semibold">{waitingForSiblings.toLocaleString()}</span> style groups have only packaging files — waiting for a non-packaging sibling to be added before tagging
          </p>
        )}

      <div className="flex flex-wrap gap-2 items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline" size="sm" className="gap-1.5"
                onClick={() => runBulkTag("untagged")}
                disabled={anyTaggingActive || untaggedCount === 0}
              >
                {tagUntaggedOp.isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {tagUntaggedOp.isInterrupted ? "Tag Untagged (interrupted)" : "Tag All Untagged"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[240px] text-center">
              AI-tag one representative per style group (smart-skip), then use Propagate to copy tags to siblings. ~3x parallel calls.
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default" size="sm" className="gap-1.5"
                onClick={() => runTagAndRefresh()}
                disabled={anyTaggingActive || (untaggedCount === 0 && totalGroups === 0)}
              >
                {(tagUntaggedOp.isActive || groupRefreshOp.isActive) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Sparkles className="h-3.5 w-3.5" /><Share2 className="h-3.5 w-3.5" /></>}
                Tag + Refresh
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[300px] text-center">
              One-click workflow: AI-tag untagged files, then refresh every group's shared product facts and search. Nothing is copied between files.
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline" size="sm" className="gap-1.5 text-[hsl(var(--warning))]"
                onClick={() => runBulkTag("all")}
                disabled={anyTaggingActive || totalWithThumb === 0}
              >
                {tagAllOp.isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {tagAllOp.isInterrupted ? "Re-tag (interrupted)" : "Re-tag Everything"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[240px] text-center">Overwrites ALL existing AI tags and descriptions. Use with caution.</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline" size="sm" className="gap-1.5"
                onClick={runGroupProfiles}
                disabled={anyActive || totalGroups === 0}
              >
                {groupProfileOp.isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                {groupProfileOp.isInterrupted ? "Profile Groups (interrupted)" : "Profile Style Groups"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[280px] text-center">
              Builds one shared product/artwork profile per style group from several representative files. Group facts stay on the group — nothing is copied onto sibling files.
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline" size="sm" className="gap-1.5"
                onClick={runGroupRefresh}
                disabled={anyActive || totalGroups === 0}
              >
                {groupRefreshOp.isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                {groupRefreshOp.isInterrupted ? "Refresh Metadata (interrupted)" : "Refresh Group Metadata"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[280px] text-center">
              Brings each of the {totalGroups.toLocaleString()} style groups' shared product facts and search entries up to date. Nothing is copied between files — individual file tags are left alone.
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Show each operation's progress independently, stacked */}
        {showTagUntagged && <TaggingProgress opKey="ai-tag-untagged" op={tagUntaggedOp} />}
        {showTagAll && <TaggingProgress opKey="ai-tag-all" op={tagAllOp} />}
        {showGroupProfiles && <GroupProfileProgress op={groupProfileOp} />}
        {showGroupRefresh && <GroupRefreshProgress op={groupRefreshOp} />}
        {showLegacyRefresh && <GroupRefreshProgress op={legacyPropagateOp} />}
      </CardContent>
    </Card>
  );
}
