import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminApi } from "@/hooks/useAdminApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, ImageIcon, Play, Pause, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime, formatDurationMs, numberValue } from "./shared";

export function PdfBackfillCard() {
  const { call } = useAdminApi();
  const queryClient = useQueryClient();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const { data } = useQuery({
    queryKey: ["pdf-backfill-status"],
    queryFn: () => call("get-pdf-backfill-status"),
    refetchInterval: (query) => {
      const bf = query.state.data?.backfill as Record<string, unknown> | null;
      return bf?.status === "running" ? 3000 : 15000;
    },
  });

  const triggerMutation = useMutation({
    mutationFn: () => call("trigger-pdf-backfill"),
    onSuccess: (res) => {
      const r = res as Record<string, unknown>;
      const queued = numberValue(r.total);
      toast.success(queued > 0
        ? `Backfill started — ${queued.toLocaleString()} files queued`
        : "Backfill complete — no eligible PDF or .ai files were waiting");
      queryClient.invalidateQueries({ queryKey: ["pdf-backfill-status"] });
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  const pauseMutation = useMutation({
    mutationFn: () => call("pause-pdf-backfill"),
    onSuccess: () => {
      toast.success("Backfill paused");
      queryClient.invalidateQueries({ queryKey: ["pdf-backfill-status"] });
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  const resumeMutation = useMutation({
    mutationFn: () => call("resume-pdf-backfill"),
    onSuccess: () => {
      toast.success("Backfill resumed");
      queryClient.invalidateQueries({ queryKey: ["pdf-backfill-status"] });
    },
    onError: (e) => toast.error(`Failed: ${(e as Error).message}`),
  });

  const bf = data?.backfill as Record<string, unknown> | null;
  const status = (bf?.status as string) ?? "idle";
  const total = numberValue(bf?.live_total, numberValue(bf?.total));
  const storedProcessed = numberValue(bf?.processed);
  const liveProcessed = numberValue(bf?.live_processed, storedProcessed);
  const remaining = numberValue(data?.remaining_count, numberValue(bf?.remaining, Math.max(0, total - Math.max(storedProcessed, liveProcessed))));
  const processed = status === "completed" && total > 0 && remaining === 0
    ? Math.max(total, storedProcessed, liveProcessed)
    : Math.max(storedProcessed, liveProcessed);
  const currentFile = bf?.live_current_file as string | null;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const startedAt = bf?.started_at ? new Date(bf.started_at as string).getTime() : null;
  const completedAt = bf?.completed_at ? new Date(bf.completed_at as string).getTime() : null;
  const elapsedMs = startedAt ? Math.max(0, (completedAt ?? nowMs) - startedAt) : 0;
  const elapsedStr = formatDurationMs(elapsedMs);

  // Estimated time remaining
  const etaStr = (() => {
    if (status !== "running" || processed === 0 || !startedAt) return null;
    const rate = processed / ((nowMs - startedAt) / 1000); // files/sec
    if (rate <= 0) return null;
    const remainSec = Math.round((total - processed) / rate);
    if (remainSec < 60) return `~${remainSec}s`;
    if (remainSec < 3600) return `~${Math.floor(remainSec / 60)}m`;
    return `~${Math.floor(remainSec / 3600)}h ${Math.floor((remainSec % 3600) / 60)}m`;
  })();

  // Health of the designated processor + stall detection. The primary "stalled" signal is
  // a running job whose live progress timestamp has gone stale — this is processor-agnostic
  // and is exactly what was missing when the agent crash-looped (0 progress, looked "idle").
  const agent = data?.agent as { agent_name: string; online: boolean; seconds_ago: number | null; last_heartbeat?: string } | null;
  const stats = (bf?.stats as Record<string, number>) ?? {};
  const filesUsedAdded = (bf?.files_used_added as number) ?? 0;
  const liveUpdatedAt = bf?.live_updated_at ? new Date(bf.live_updated_at as string).getTime() : null;
  const staleMs = liveUpdatedAt ? nowMs - liveUpdatedAt : startedAt ? nowMs - startedAt : 0;
  const stalled = status === "running" && staleMs > 120_000; // no progress for >2 min
  const staleMin = Math.floor(staleMs / 60000);
  const noWorkQueued = status === "completed" && total === 0;

  const STAT_LABELS: Record<string, string> = {
    pdf_text: "Embedded text",
    ocr_text: "OCR",
    ai_vision: "AI vision",
    likely_scanned: "Scanned (no text)",
    pending_ocr: "Queued for OCR",
    skipped: "Skipped",
    failed: "Failed",
  };

  const statusBadge = (() => {
    switch (status) {
      case "running": return <Badge className="bg-blue-100 text-blue-800 gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Running</Badge>;
      case "paused": return <Badge className="bg-amber-100 text-amber-800 gap-1"><Pause className="h-3 w-3" /> Paused</Badge>;
      case "completed": return <Badge className="bg-green-100 text-green-800 gap-1"><CheckCircle2 className="h-3 w-3" /> Completed</Badge>;
      case "error": return <Badge className="bg-red-100 text-red-800 gap-1"><XCircle className="h-3 w-3" /> Error</Badge>;
      default: return <Badge variant="outline" className="text-muted-foreground">Idle</Badge>;
    }
  })();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              PDF &amp; .ai Text Extraction — Full Library Backfill
            </CardTitle>
            {statusBadge}
          </div>
          <div className="flex items-center gap-2">
            {status === "running" && (
              <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
                {pauseMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}
                Pause
              </Button>
            )}
            {status === "paused" && (
              <Button size="sm" variant="outline" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
                {resumeMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                Resume
              </Button>
            )}
            {(status === "completed" || status === "error") && (
              <Button size="sm" variant="outline" onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
                {triggerMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                Re-run
              </Button>
            )}
            {(status === "idle" || !bf) && (
              <Button size="sm" onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
                {triggerMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                Start Backfill
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Reads licensing-sheet and tech-pack PDFs, extracts embedded text, and populates the <strong className="text-foreground font-medium">Files Used</strong> list in each group's detail panel from matching sections. Run this when new licensing PDFs have been scanned but their source files are not showing yet. Runs on the Windows render agent and can be paused and resumed.
        </p>
        {bf && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md border bg-muted/25 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Queued</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{total.toLocaleString()} files</div>
            </div>
            <div className="rounded-md border bg-muted/25 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Processed</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{processed.toLocaleString()} files</div>
            </div>
            <div className="rounded-md border bg-muted/25 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Remaining</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">{remaining.toLocaleString()} files</div>
            </div>
            <div className="rounded-md border bg-muted/25 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Agent</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
                <span className={`h-2 w-2 rounded-full ${agent?.online ? "bg-green-500" : "bg-red-500"}`} />
                <span className="truncate" title={agent?.agent_name ?? "No Windows render agent"}>
                  {agent?.agent_name ?? "No Windows agent"}
                </span>
              </div>
            </div>
          </div>
        )}
        {bf && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Started: <span className="text-foreground">{formatDateTime(bf.started_at)}</span></span>
            {(status === "completed" || status === "error") && (
              <span>Finished: <span className="text-foreground">{formatDateTime(bf.completed_at ?? bf.last_batch_at)}</span></span>
            )}
            {bf.last_batch_at && <span>Last batch: <span className="text-foreground">{formatDateTime(bf.last_batch_at)}</span></span>}
            {bf.live_updated_at && <span>Last progress: <span className="text-foreground">{formatDateTime(bf.live_updated_at)}</span></span>}
            {agent?.last_heartbeat && <span>Agent heartbeat: <span className="text-foreground">{formatDateTime(agent.last_heartbeat)}</span></span>}
          </div>
        )}
        {bf && status !== "idle" && (
          <>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{processed.toLocaleString()} / {total.toLocaleString()} files</span>
                <span className="flex items-center gap-2">
                  {status === "running" && <span className="text-blue-600">{elapsedStr} elapsed{etaStr ? ` · ${etaStr} remaining` : ""}</span>}
                  <span>{percent}%</span>
                </span>
              </div>
              <Progress value={percent} className="h-2" />
            </div>
            {status === "running" && currentFile && !stalled && (
              <p className="text-xs text-muted-foreground truncate" title={currentFile}>
                Processing: <span className="font-mono">{currentFile}</span>
              </p>
            )}

            {/* Stall / processor-down warning — the signal that was missing when the agent crash-looped */}
            {stalled && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">
                    Stalled — no progress for {staleMin >= 1 ? `${staleMin} min` : "over 2 min"}.
                  </p>
                  <p className="mt-0.5 text-amber-800">
                    The render agent may be offline or crash-looping.{" "}
                    {agent
                      ? agent.online
                        ? "Agent is heartbeating but not advancing the job."
                        : `Agent appears offline${agent.seconds_ago != null ? ` (last heartbeat ${Math.round(agent.seconds_ago / 60)}m ago)` : ""}.`
                      : "No render agent is registered."}
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {/* Completion summary with per-method outcome breakdown */}
        {status === "completed" && bf && (
          <div className="rounded-md border border-green-300 bg-green-50 p-2.5 text-xs text-green-900">
            <p className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              {noWorkQueued
                ? "Completed — no eligible PDF or .ai files were waiting for text extraction."
                : `Completed — ${processed.toLocaleString()} files in ${elapsedStr}.`}
            </p>
            {!noWorkQueued && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-green-800">
                {Object.entries(stats)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <span key={k}>{STAT_LABELS[k] ?? k}: <strong>{v.toLocaleString()}</strong></span>
                  ))}
                {Object.keys(stats).length === 0 && <span>No method stats were reported by the agent.</span>}
                <span>Files-used added: <strong>{filesUsedAdded.toLocaleString()}</strong></span>
              </div>
            )}
          </div>
        )}

        {/* Error banner */}
        {status === "error" && bf && (
          <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-900">
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Backfill error</p>
              {bf.error ? <p className="mt-0.5 font-mono break-all">{String(bf.error)}</p> : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Blank Thumbnail Cleanup Card ──────────────────────────────────────────────
