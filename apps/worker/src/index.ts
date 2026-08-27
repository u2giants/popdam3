/**
 * PopDAM Cloud Worker — entry point.
 *
 * Runs a continuous polling loop:
 *   1. Check admin_config.BULK_OPERATIONS for running/queued ops
 *   2. Dispatch to the appropriate handler
 *   3. Process batches until done or user stops
 *   4. Sleep WORKER_POLL_INTERVAL_MS, repeat
 *
 * Handles graceful shutdown on SIGTERM/SIGINT.
 */

import { config } from "./config.js";
import { logger } from "./logger.js";
import { tick } from "./operation-loop.js";
import { maybeEmbedPendingSearchDocuments } from "./handlers/embed-search.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let running = true;

function shutdown(signal: string) {
  logger.info("worker: shutdown signal received", { signal });
  running = false;
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function main() {
  logger.info("worker: starting", {
    supabase_url: config.supabaseUrl,
    poll_interval_ms: config.pollIntervalMs,
    ai_batch_size: config.aiBatchSize,
    ai_batch_concurrency: config.aiBatchConcurrency,
  });

  // Verify Supabase connection
  const { db } = await import("./supabase.js");
  const { error: pingErr } = await db().from("admin_config").select("key").limit(1);
  if (pingErr) {
    logger.error("worker: Supabase connection failed", { error: pingErr.message });
    process.exit(1);
  }
  logger.info("worker: connected to Supabase — polling loop started");

  while (running) {
    try {
      await tick();
      await maybeEmbedPendingSearchDocuments();
    } catch (e) {
      logger.error("worker: unhandled error in tick", {
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
    }
    await sleep(config.pollIntervalMs);
  }

  logger.info("worker: shutdown complete");
}

main().catch((e) => {
  logger.error("worker: fatal error", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
