import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FolderSearch, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";

export default function StyleGuideCrawlTab() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["style-guide-crawl-status"],
    queryFn: () => call("get-style-guide-crawl-status"),
    refetchInterval: 5_000,
  });

  const triggerMutation = useMutation({
    mutationFn: () => call("trigger-style-guide-crawl"),
    onSuccess: () => {
      toast.success("Style guide crawl requested — waiting for agent to pick it up");
      queryClient.invalidateQueries({ queryKey: ["style-guide-crawl-status"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const request = data?.request as Record<string, unknown> | null;
  const lastRun = data?.last_run as Record<string, unknown> | null;
  const totalActive = (data?.total_active_files as number) ?? 0;
  const status = request?.status as string | null;

  const isActive = status === "pending" || status === "claimed" || status === "running";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FolderSearch className="h-4 w-4" /> Style Guide Crawl
        </CardTitle>
        <Button
          variant="default"
          size="sm"
          className="gap-1.5"
          onClick={() => triggerMutation.mutate()}
          disabled={isActive || triggerMutation.isPending}
        >
          {isActive ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FolderSearch className="h-3.5 w-3.5" />
          )}
          {isActive ? "Crawling..." : "Crawl Style Guides"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Recursively scan the Style Guides NAS folder and record all file names for matching against licensing sheets.
        </p>

        {/* Status */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status:</span>
          {!status || status === "completed" ? (
            <Badge variant="outline" className="gap-1 text-[hsl(var(--success))]">
              <CheckCircle2 className="h-3 w-3" /> Idle
            </Badge>
          ) : status === "failed" ? (
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" /> Failed
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1 animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin" />
              {status === "pending" ? "Waiting for agent..." : status === "claimed" ? "Starting..." : "Running..."}
            </Badge>
          )}
        </div>

        {/* Error */}
        {status === "failed" && request?.error && (
          <div className="text-xs text-destructive bg-destructive/10 rounded-md p-2">
            {request.error as string}
          </div>
        )}

        {/* Results */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-muted/50 rounded-md p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{totalActive.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Files</div>
          </div>
          <div className="bg-muted/50 rounded-md p-3 text-center">
            <div className="text-2xl font-bold text-foreground">
              {lastRun?.files_found != null ? (lastRun.files_found as number).toLocaleString() : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Crawl Found</div>
          </div>
          <div className="bg-muted/50 rounded-md p-3 text-center">
            <div className="text-sm font-medium text-foreground flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" />
              {lastRun?.completed_at
                ? new Date(lastRun.completed_at as string).toLocaleDateString()
                : "Never"}
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Last Completed</div>
          </div>
        </div>

        {lastRun?.roots_scanned && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Roots scanned:</span>{" "}
            {(lastRun.roots_scanned as string[]).join(", ")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
