import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAdminApi } from "@/hooks/useAdminApi";
import { isResumableOperationCursor, usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles, RefreshCw, Loader2, XCircle, Share2 } from "lucide-react";
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

function PropagationProgress({ op }: { op: ReturnType<typeof usePersistentOperation> }) {
  const s = op.state;
  const p = s.progress;
  if (!p) return null;

  const propagated = (p.propagated as number) || 0;
  const skipped = (p.skipped as number) || 0;
  const total = (p.total as number) || 0;
  const done = propagated + skipped;
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
          <span className="font-medium">Propagate Group Tags</span>
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
                confirmMessage: `Resume propagation from group ${s.cursor?.toLocaleString()}? (${((p.propagated as number) || 0) + ((p.skipped as number) || 0)} already processed)`,
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
        <span>Propagated: <span className="text-foreground font-medium">{propagated.toLocaleString()}</span></span>
        {skipped > 0 && <span>Skipped: <span className="text-foreground font-medium">{skipped.toLocaleString()}</span></span>}
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
  const propagateOp = usePersistentOperation("propagate-group-tags");

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
    queryKey: ["groups-for-propagation"],
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
  // anyActive: includes propagation too → only used for the propagate button.
  // Keeping these separate lets the user start tagging even when propagation is still
  // running/queued (e.g. left over from a previous "Tag + Propagate" run). The conflict
  // dialog will handle the cross-lane conflict if the worker can't accept the new op yet.
  const anyTaggingActive =
    tagUntaggedOp.isActive || tagUntaggedOp.isQueued ||
    tagAllOp.isActive    || tagAllOp.isQueued;
  const anyActive = anyTaggingActive || propagateOp.isActive || propagateOp.isQueued;

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

  function runBulkPropagate() {
    requestOp("propagate-group-tags", OP_NAMES["propagate-group-tags"],
      () => propagateOp.start({
        confirmMessage: `Propagate product-level tags across all ${totalGroups.toLocaleString()} style groups? This merges tags from tagged assets to their untagged siblings. Continue?`,
        initialProgress: { total: totalGroups },
      }),
      () => propagateOp.queue({ initialProgress: { total: totalGroups } }),
    );
  }

  function runTagAndPropagate() {
    const total = untaggedCount;
    // Start tagging from scratch. If propagation is already queued/running from a prior
    // "Tag + Propagate" run, reset it first so we don't have a stale queued entry blocking
    // the new flow. The worker enforces OP_CONFLICTS and won't promote propagation until
    // tagging completes — so these two jobs run sequentially automatically.
    const startFn = async () => {
      // If propagation is queued or running from before, reset it to avoid stale queue entry
      if (propagateOp.isActive || propagateOp.isQueued) {
        await propagateOp.reset();
      }
      await tagUntaggedOp.start({
        confirmMessage: `Smart Tag + Propagate: AI-tag representative assets (one per style group, ~3x parallel), then propagate tags to all siblings. Continue?`,
        initialProgress: {},
        forceRestart: true,
      });
      await propagateOp.queue({ initialProgress: { total: totalGroups } });
    };
    requestOp("ai-tag-untagged", OP_NAMES["ai-tag-untagged"],
      startFn,
      () => tagUntaggedOp.queue({ initialProgress: {} }),
    );
  }

  // Determine which ops have non-idle state (show progress for each independently)
  const showTagUntagged = tagUntaggedOp.state.status !== "idle" && tagUntaggedOp.state.progress;
  const showTagAll = tagAllOp.state.status !== "idle" && tagAllOp.state.progress;
  const showPropagate = propagateOp.state.status !== "idle" && propagateOp.state.progress;

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
                onClick={() => runTagAndPropagate()}
                disabled={anyTaggingActive || (untaggedCount === 0 && totalGroups === 0)}
              >
                {(tagUntaggedOp.isActive || propagateOp.isActive) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Sparkles className="h-3.5 w-3.5" /><Share2 className="h-3.5 w-3.5" /></>}
                Tag + Propagate
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[280px] text-center">
              One-click workflow: AI-tag one representative per group (smart-skip), then automatically propagate tags to all siblings. Fastest way to tag everything.
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
                onClick={runBulkPropagate}
                disabled={anyActive || totalGroups === 0}
              >
                {propagateOp.isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                {propagateOp.isInterrupted ? "Propagate (interrupted)" : "Propagate Group Tags"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[260px] text-center">
              Sync product-level tags (licensor, property, characters, themes) from tagged assets to untagged siblings across all {totalGroups.toLocaleString()} style groups.
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Show each operation's progress independently, stacked */}
        {showTagUntagged && <TaggingProgress opKey="ai-tag-untagged" op={tagUntaggedOp} />}
        {showTagAll && <TaggingProgress opKey="ai-tag-all" op={tagAllOp} />}
        {showPropagate && <PropagationProgress op={propagateOp} />}
      </CardContent>
    </Card>
  );
}
