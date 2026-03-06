import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles, RefreshCw, Loader2, XCircle } from "lucide-react";
import type { RequestOpFn } from "./types";
import { OP_NAMES } from "./types";

export function AiTaggingSection({ requestOp }: { requestOp: RequestOpFn }) {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const tagUntaggedOp = usePersistentOperation("ai-tag-untagged");
  const tagAllOp = usePersistentOperation("ai-tag-all");

  const { data: tagCounts } = useQuery({
    queryKey: ["untagged-asset-count"],
    queryFn: async () => {
      const r = await call("count-untagged-assets");
      return { untagged: r.count as number, totalWithThumbnails: r.totalWithThumbnails as number };
    },
  });

  const untaggedCount = tagCounts?.untagged ?? 0;
  const totalWithThumb = tagCounts?.totalWithThumbnails ?? 0;

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

  const activeOp = tagUntaggedOp.isActive ? tagUntaggedOp : tagAllOp.isActive ? tagAllOp : null;
  const anyActive = !!activeOp;
  const displayOp = activeOp ?? (tagUntaggedOp.state.status !== "idle" ? tagUntaggedOp : tagAllOp);
  const p = displayOp.state.progress;
  const showProgress = (displayOp.isActive || displayOp.isInterrupted || displayOp.state.status === "completed" || displayOp.state.status === "failed") && p;

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
          <TooltipProvider>
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
          </TooltipProvider>
          <TooltipProvider>
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
          </TooltipProvider>
          {anyActive && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="destructive" size="sm" className="gap-1.5"
                    onClick={async () => {
                      if (tagUntaggedOp.isActive) await tagUntaggedOp.stop();
                      if (tagAllOp.isActive) await tagAllOp.stop();
                    }}
                  >
                    <XCircle className="h-3.5 w-3.5" /> Stop
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px] text-center">Stop the current AI tagging run. Progress is saved and can be resumed.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {(tagUntaggedOp.isInterrupted || tagAllOp.isInterrupted) && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => { tagUntaggedOp.reset(); tagAllOp.reset(); }}>
              Dismiss
            </Button>
          )}
        </div>

        {showProgress && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              {displayOp.isActive && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
              <span>
                {displayOp.isActive ? "" : displayOp.state.status === "completed" ? "✓ " : displayOp.isInterrupted ? "⏸ " : "✗ "}
                Tagged <span className="font-semibold text-foreground">{((p!.tagged as number) || 0).toLocaleString()}</span>
                {" / "}{((p!.total as number) || 0).toLocaleString()}
                {(p!.skipped as number) > 0 && (
                  <span className="text-muted-foreground ml-1">· {(p!.skipped as number)} skipped</span>
                )}
                {(p!.failed as number) > 0 && (
                  <span className="text-destructive ml-1">· {(p!.failed as number)} failed</span>
                )}
              </span>
            </div>
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${(p!.total as number) > 0 ? Math.round((((p!.tagged as number) + (p!.skipped as number) + (p!.failed as number)) / (p!.total as number)) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
        {displayOp.state.status === "failed" && (
          <p className="text-xs text-destructive">Error: {displayOp.state.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
