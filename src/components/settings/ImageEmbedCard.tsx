import { Info, ImageIcon, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePersistentOperation } from "@/hooks/usePersistentOperation";

/**
 * Backfill control for the image-similarity vector index (plan Step 4b).
 *
 * The operation is enqueue/status ONLY: it walks the stale set (missing
 * vector, changed thumbnail watermark, or an embedding stamp outside the
 * active window) and enqueues GPU index jobs. Embedding itself happens on the
 * desktop GPU pollers — this card never claims to embed.
 *
 * The drain-time estimate follows the plan's honesty rule (M-F): Step 1
 * measured the whole-library rate on ONE GPU (15–25 img/s, batch-8 forwards
 * already inside that number). We split it across 2 GPUs and claim no further
 * speedup — hours = N / (2 x measured rate). No 1–2.5 h style guess.
 */

// Step 1 measured whole-library dual-embed throughput on one RTX 3060 Ti,
// batched forwards included (plan STATUS, #486 comment 6408936634).
const MEASURED_IMG_PER_SEC_LOW = 15;
const MEASURED_IMG_PER_SEC_HIGH = 25;
const ESTIMATE_GPUS = 2;

interface QueueSnapshot {
  pending?: number;
  leased?: number;
  failed?: number;
  done?: number;
  workers_fresh?: boolean;
}

function formatHours(count: number): string {
  const fastestH = count / (ESTIMATE_GPUS * MEASURED_IMG_PER_SEC_HIGH) / 3600;
  const slowestH = count / (ESTIMATE_GPUS * MEASURED_IMG_PER_SEC_LOW) / 3600;
  const fmt = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${h.toFixed(1)} h`);
  return fastestH === slowestH ? fmt(fastestH) : `${fmt(fastestH)}–${fmt(slowestH)}`;
}

export function ImageEmbedCard() {
  const op = usePersistentOperation("rebuild-image-vectors");
  const progress = (op.state.progress ?? {}) as Record<string, unknown>;
  const staleFound = Math.max(0, Number(progress.stale_found) || 0);
  const enqueued = Math.max(0, Number(progress.enqueued) || 0);
  const failed = Math.max(0, Number(progress.failed) || 0);
  const snapshot = (progress.image_embed_status ?? null) as QueueSnapshot | null;
  const running = op.state.status === "running" || op.state.status === "queued";
  const finished =
    op.state.status === "completed" || op.state.status === "completed_with_repair" || op.state.status === "failed";
  const estimateTitle =
    "Drain-time estimate: Step 1 measured the whole-library rate on one GPU " +
    `(${MEASURED_IMG_PER_SEC_LOW}–${MEASURED_IMG_PER_SEC_HIGH} img/s, batch-8 forwards included). ` +
    `We only split it across ${ESTIMATE_GPUS} GPUs — N / (${ESTIMATE_GPUS} × measured rate). ` +
    "Sequential-equivalent timing: no extra batch or GPU speedup is claimed beyond that split.";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="h-4 w-4" /> Image Vectors
              <span title={estimateTitle} className="inline-flex items-center text-muted-foreground cursor-help">
                <Info className="h-3.5 w-3.5" />
              </span>
            </CardTitle>
            <CardDescription>
              Re-enqueue stale artwork vectors (missing, thumbnail changed, or old model). GPU desktops do the embedding — this only queues the work.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{staleFound.toLocaleString()} stale found</span>
          <span>{enqueued.toLocaleString()} enqueued</span>
          <span>{failed.toLocaleString()} failed</span>
          {finished && enqueued > 0 && (
            <span title={estimateTitle}>
              est. GPU drain {formatHours(enqueued)} (one-GPU measured rate ÷ {ESTIMATE_GPUS} GPUs)
            </span>
          )}
        </div>
        {snapshot && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>queue {Number(snapshot.pending ?? 0).toLocaleString()} pending</span>
            <span>{Number(snapshot.leased ?? 0).toLocaleString()} leased</span>
            <span>{Number(snapshot.done ?? 0).toLocaleString()} done</span>
            <span>{Number(snapshot.failed ?? 0).toLocaleString()} failed</span>
            <span>{snapshot.workers_fresh ? "GPU worker online" : "no fresh GPU worker heartbeat"}</span>
          </div>
        )}
        {op.state.error && <p className="text-xs text-destructive">{op.state.error}</p>}
        {op.state.result_message && <p className="text-xs text-muted-foreground">{op.state.result_message}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={running ? "destructive" : "default"}
            disabled={op.isHydrating}
            onClick={() => (running ? op.stop() : op.start({ initialProgress: {} }))}
          >
            {running ? <Square className="mr-2 h-3.5 w-3.5" /> : <Play className="mr-2 h-3.5 w-3.5" />}
            {running ? "Stop backfill" : op.state.status === "interrupted" ? "Resume backfill" : "Enqueue stale vectors"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
