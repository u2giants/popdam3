import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAdminApi } from "@/hooks/useAdminApi";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles, RefreshCw, Loader2, XCircle, Share2 } from "lucide-react";
import type { RequestOpFn } from "./types";
import { OP_NAMES, REASON_LABELS, timeAgo } from "./types";
import { formatDuration, formatEta, calcRate } from "./progress-utils";

export function AiTaggingSection({ requestOp }: { requestOp: RequestOpFn }) {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const tagUntaggedOp = usePersistentOperation("ai-tag-untagged");
  const tagAllOp = usePersistentOperation("ai-tag-all");
  const propagateOp = usePersistentOperation("propagate-group-tags");

  const { data: tagCounts } = useQuery({
    queryKey: ["untagged-asset-count"],
    queryFn: async () => {
      const r = await call("count-untagged-assets");
      return { untagged: r.count as number, totalWithThumbnails: r.totalWithThumbnails as number };
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

  function runBulkTag(mode: "untagged" | "all") {
    const op = mode === "all" ? tagAllOp : tagUntaggedOp;
    const total = mode === "all" ? totalWithThumb : untaggedCount;
    const opKey = mode === "all" ? "ai-tag-all" : "ai-tag-untagged";

    requestOp(opKey, OP_NAMES[opKey],
      () => op.start({
        confirmMessage: mode === "all"
          ? `Re-tag all ${total.toLocaleString()} assets with thumbnails? This will overwrite existing AI tags. Continue?`
          : `AI tag ${total.toLocaleString()} untagged assets? Continue?`,
        initialProgress: { total },
      }),
      () => op.queue({ initialProgress: { total } }),
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

  const activeOp = tagUntaggedOp.isActive ? tagUntaggedOp : tagAllOp.isActive ? tagAllOp : propagateOp.isActive ? propagateOp : null;
  const anyActive = !!activeOp;
  const displayOp = activeOp ?? (tagUntaggedOp.state.status !== "idle" ? tagUntaggedOp : tagAllOp.state.status !== "idle" ? tagAllOp : propagateOp);
  const displayOpKey = displayOp === tagUntaggedOp ? "ai-tag-untagged" : displayOp === tagAllOp ? "ai-tag-all" : "propagate-group-tags";
  const p = displayOp.state.progress;
  const showProgress = (displayOp.isActive || displayOp.isInterrupted || displayOp.state.status === "completed" || displayOp.state.status === "failed") && p;

  // Determine if propagation progress should render differently
  const isPropagation = displayOpKey === "propagate-group-tags";

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

        <div className="flex flex-wrap gap-2 items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline" size="sm" className="gap-1.5"
                onClick={() => runBulkTag("untagged")}
                disabled={anyActive || untaggedCount === 0}
              >
                {tagUntaggedOp.isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {tagUntaggedOp.isInterrupted ? "Tag Untagged (interrupted)" : "Tag All Untagged"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[240px] text-center">AI-tag only assets that haven't been tagged yet. Existing tags are preserved.</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline" size="sm" className="gap-1.5 text-[hsl(var(--warning))]"
                onClick={() => runBulkTag("all")}
                disabled={anyActive || totalWithThumb === 0}
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
          {anyActive && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="destructive" size="sm" className="gap-1.5"
                  onClick={async () => {
                    if (tagUntaggedOp.isActive) await tagUntaggedOp.stop();
                    if (tagAllOp.isActive) await tagAllOp.stop();
                    if (propagateOp.isActive) await propagateOp.stop();
                  }}
                >
                  <XCircle className="h-3.5 w-3.5" /> Stop
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px] text-center">Stop the current operation. Progress is saved and can be resumed.</TooltipContent>
            </Tooltip>
          )}
          {(tagUntaggedOp.isInterrupted || tagAllOp.isInterrupted || propagateOp.isInterrupted) && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => { tagUntaggedOp.reset(); tagAllOp.reset(); propagateOp.reset(); }}>
              Dismiss
            </Button>
          )}
          {(displayOp.state.status === "completed" || displayOp.state.status === "failed") && !displayOp.isActive && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => { tagUntaggedOp.reset(); tagAllOp.reset(); propagateOp.reset(); }}>
              Dismiss
            </Button>
          )}
        </div>

        {showProgress && (() => {
          if (isPropagation) {
            const propagated = (p!.propagated as number) || 0;
            const skipped = (p!.skipped as number) || 0;
            const total = (p!.total as number) || 0;
            const done = propagated + skipped;
            const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

            const elapsedMs = displayOp.state.started_at
              ? Date.now() - new Date(displayOp.state.started_at).getTime()
              : 0;
            const rate = calcRate(done, elapsedMs);

            return (
              <div className="space-y-2 mt-1">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {displayOp.isActive && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                    <span>
                      {displayOp.state.status === "completed" ? "✓ Complete" :
                       displayOp.isInterrupted ? "⏸ Interrupted" :
                       displayOp.state.status === "failed" ? "✗ Failed" : "Propagating…"}
                    </span>
                    {(displayOp.isInterrupted || displayOp.state.status === "failed") && displayOp.state.interruption_reason_code && (
                      <span className="text-xs text-muted-foreground">
                        — {REASON_LABELS[displayOp.state.interruption_reason_code] ?? displayOp.state.interruption_reason_code}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                    {!displayOp.isActive && displayOp.state.updated_at && (
                      <span title={new Date(displayOp.state.updated_at).toLocaleString()}>
                        Stopped {timeAgo(displayOp.state.updated_at)}
                      </span>
                    )}
                    {displayOp.isActive && elapsedMs > 0 && (
                      <span>Elapsed: {formatDuration(elapsedMs)}</span>
                    )}
                  </div>
                </div>

                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Groups processed</span>
                  <span className="text-foreground font-medium tabular-nums">
                    {done.toLocaleString()}
                    {total > 0 ? ` / ${total.toLocaleString()}` : ""}
                    {pct !== null && <span className="text-muted-foreground ml-1">({pct}%)</span>}
                  </span>
                </div>

                {pct !== null && (
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        displayOp.state.status === "failed" ? "bg-destructive" : "bg-primary"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}

                {rate !== null && total > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{Math.round(rate).toLocaleString()} groups/min</span>
                    <span>ETA: {formatEta(total - done, rate)}</span>
                  </div>
                )}

                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Propagated: <span className="text-foreground font-medium">{propagated.toLocaleString()}</span></span>
                  {skipped > 0 && <span>Skipped: <span className="text-foreground font-medium">{skipped.toLocaleString()}</span></span>}
                </div>
              </div>
            );
          }

          // Original AI tagging progress
          const tagged = (p!.tagged as number) || 0;
          const skipped = (p!.skipped as number) || 0;
          const failed = (p!.failed as number) || 0;
          const total = (p!.total as number) || 0;
          const done = tagged + skipped + failed;
          const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

          const elapsedMs = displayOp.state.started_at
            ? Date.now() - new Date(displayOp.state.started_at).getTime()
            : 0;
          const rate = calcRate(done, elapsedMs);

          return (
            <div className="space-y-2 mt-1">
              {/* Header: status + elapsed + stopped reason */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {displayOp.isActive && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                  <span>
                    {displayOp.state.status === "completed" ? "✓ Complete" :
                     displayOp.isInterrupted ? "⏸ Interrupted" :
                     displayOp.state.status === "failed" ? "✗ Failed" : "Tagging…"}
                  </span>
                  {/* Show WHY it stopped */}
                  {(displayOp.isInterrupted || displayOp.state.status === "failed") && displayOp.state.interruption_reason_code && (
                    <span className="text-xs text-muted-foreground">
                      — {REASON_LABELS[displayOp.state.interruption_reason_code] ?? displayOp.state.interruption_reason_code}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  {/* Show WHEN it stopped */}
                  {!displayOp.isActive && displayOp.state.updated_at && (
                    <span title={new Date(displayOp.state.updated_at).toLocaleString()}>
                      Stopped {timeAgo(displayOp.state.updated_at)}
                    </span>
                  )}
                  {displayOp.isActive && elapsedMs > 0 && (
                    <span>Elapsed: {formatDuration(elapsedMs)}</span>
                  )}
                </div>
              </div>

              {/* Count row */}
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Assets processed</span>
                <span className="text-foreground font-medium tabular-nums">
                  {done.toLocaleString()}
                  {total > 0 ? ` / ${total.toLocaleString()}` : ""}
                  {pct !== null
                    ? <span className="text-muted-foreground ml-1">({pct}%)</span>
                    : null}
                </span>
              </div>

              {/* Progress bar */}
              {pct !== null && (
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      displayOp.state.status === "failed" ? "bg-destructive" : "bg-primary"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}

              {/* Rate + ETA row */}
              {rate !== null && total > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{Math.round(rate).toLocaleString()} assets/min</span>
                  <span>ETA: {formatEta(total - done, rate)}</span>
                </div>
              )}

              {/* Tagged / skipped / failed breakdown — as links */}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <Link
                  to={`/settings/ai-tagging-detail?op=${encodeURIComponent(displayOpKey)}&view=tagged`}
                  className="hover:underline underline-offset-2"
                >
                  Tagged: <span className="text-foreground font-medium">{tagged.toLocaleString()}</span>
                </Link>
                {skipped > 0 && (
                  <Link
                    to={`/settings/ai-tagging-detail?op=${encodeURIComponent(displayOpKey)}&view=skipped`}
                    className="hover:underline underline-offset-2"
                  >
                    Skipped: <span className="text-foreground font-medium">{skipped.toLocaleString()}</span>
                  </Link>
                )}
                {failed > 0 && (
                  <Link
                    to={`/settings/ai-tagging-detail?op=${encodeURIComponent(displayOpKey)}&view=failed`}
                    className="text-destructive underline underline-offset-2 hover:no-underline"
                  >
                    Failed: <span className="font-medium">{failed.toLocaleString()}</span>
                  </Link>
                )}
              </div>
            </div>
          );
        })()}

        {(displayOp.state.status === "failed" || displayOp.isInterrupted) && displayOp.state.error && (
          <p className="text-xs text-destructive">
            Error: {displayOp.state.error}
            {displayOp.state.auto_resume_attempts != null && displayOp.state.auto_resume_attempts > 0 && (
              <span className="text-muted-foreground ml-1">
                (auto-resumed {displayOp.state.auto_resume_attempts} time{displayOp.state.auto_resume_attempts !== 1 ? "s" : ""})
              </span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
