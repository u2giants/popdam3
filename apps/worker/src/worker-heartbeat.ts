import { db } from "./supabase.js";

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
