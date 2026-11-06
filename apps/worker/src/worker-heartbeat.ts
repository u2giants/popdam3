import { db } from "./supabase.js";
import { logger } from "./logger.js";
import { withDependencyTimeout } from "./bounded-dependency.js";

const HEARTBEAT_INTERVAL_MS = 60_000;
let lastHeartbeatAt = 0;

export function heartbeatDue(nowMs: number, previousMs = lastHeartbeatAt): boolean {
  return previousMs === 0 || nowMs - previousMs >= HEARTBEAT_INTERVAL_MS;
}

export async function maybeWriteWorkerHeartbeat(now = new Date()): Promise<void> {
  if (!heartbeatDue(now.getTime())) return;
  const updatedAt = now.toISOString();
  const { error } = await db().from("admin_config").upsert({
    key: "WORKER_HEARTBEAT",
    value: {
      status: "running",
      sha: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null,
      updated_at: updatedAt,
    },
    updated_at: updatedAt,
  });
  if (error) throw new Error(`Worker heartbeat failed: ${error.message}`);
  lastHeartbeatAt = now.getTime();
}

export interface WorkerHeartbeatTimer {
  stop(): void;
}

/**
 * Keep the worker heartbeat fresh independently of the operation loop. A bulk
 * operation runs inline inside tick(), so the loop-top heartbeat write can stay
 * unwritten for the whole operation and trip the 5-minute production canary
 * (#836). This timer refreshes it even while a tick never returns.
 */
export function startHeartbeatTimer(
  writeHeartbeat: () => Promise<void> = maybeWriteWorkerHeartbeat,
  intervalMs = HEARTBEAT_INTERVAL_MS,
): WorkerHeartbeatTimer {
  const timer = setInterval(() => {
    void withDependencyTimeout("worker heartbeat", writeHeartbeat())
      .catch((error) => logger.warn("worker: interval heartbeat failed", { error: String(error) }));
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
