import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, ImageIcon, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";

export function BlankThumbCleanupCard() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["blank-thumb-cleanup-status"],
    queryFn: () => call<{ ok: boolean; cleanup: Record<string, unknown> | null }>("get-blank-thumb-cleanup-status"),
    refetchInterval: (query) => {
      const c = query.state.data?.cleanup as Record<string, unknown> | null;
      return (c?.status === "scanning" || c?.status === "claimed") ? 3000 : 15000;
    },
  });

  const triggerMutation = useMutation({
    mutationFn: () => call("trigger-blank-thumb-cleanup"),
    onSuccess: (res) => {
      const r = res as Record<string, unknown>;
      toast.success(`Blank thumbnail scan started — ${(r.total as number).toLocaleString()} assets queued`);
      queryClient.invalidateQueries({ queryKey: ["blank-thumb-cleanup-status"] });
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  const cleanup = data?.cleanup as Record<string, unknown> | null;
  const status = (cleanup?.status as string) ?? "idle";
  const total = (cleanup?.total as number) ?? 0;
  const processed = (cleanup?.processed as number) ?? 0;
  const cleaned = (cleanup?.cleaned as number) ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const isRunning = status === "scanning" || status === "claimed";

  const statusBadge = (() => {
    switch (status) {
      case "scanning":
      case "claimed":
        return <Badge className="bg-blue-100 text-blue-800 gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Scanning</Badge>;
      case "completed":
        return <Badge className="bg-green-100 text-green-800 gap-1"><CheckCircle2 className="h-3 w-3" /> Completed</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground">Idle</Badge>;
    }
  })();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              Blank Thumbnail Cleanup
            </CardTitle>
            {statusBadge}
          </div>
          <div className="flex items-center gap-2">
            {(status === "completed") && (
              <Button size="sm" variant="outline" onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
                {triggerMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                Re-run
              </Button>
            )}
            {(status === "idle" || !cleanup) && (
              <Button size="sm" onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
                {triggerMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                Start Scan
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Scans every thumbnail in the library and removes blank/white images (die-line templates, empty files). Clears <code className="font-mono">thumbnail_url</code> and marks the asset with <code className="font-mono">thumbnail_error = blank_render</code> so it will be re-rendered. Run this once to clean up existing blanks — future scans detect them automatically.
        </p>
        {cleanup && status !== "idle" && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{processed.toLocaleString()} / {total.toLocaleString()} checked{cleaned > 0 ? ` · ${cleaned.toLocaleString()} blank removed` : ""}</span>
              <span>{isRunning ? `${percent}%` : status === "completed" ? "Done" : ""}</span>
            </div>
            {isRunning && <Progress value={percent} className="h-2" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────
