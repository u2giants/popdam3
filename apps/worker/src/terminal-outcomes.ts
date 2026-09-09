/**
 * Durable terminal-outcome recording for bulk operations.
 *
 * The live BULK_OPERATIONS JSON is intentionally mutable.  This writer is only
 * for the append-only history table introduced by shared-db #2447, so a later
 * successful run can never erase an earlier failed run.
 */

import { config } from "./config.js";
import { logger } from "./logger.js";

export type TerminalRunStatus = "succeeded" | "failed";

export interface TerminalRun {
  operation: string;
  run_id: string;
  status: TerminalRunStatus;
  stage?: string;
  error?: string;
  reason_code?: string;
  progress: Record<string, unknown>;
  started_at: string;
  ended_at: string;
}

export interface TerminalRunStore {
  from(table: "bulk_operation_runs"): {
    insert(row: TerminalRun): PromiseLike<{ error: { code?: string; message: string } | null }>;
  };
}

export type AlertDelivery = "delivered" | "destination_unconfigured" | "delivery_failed";

export async function appendTerminalRun(store: TerminalRunStore, run: TerminalRun): Promise<boolean> {
  const { error } = await store.from("bulk_operation_runs").insert(run);
  if (!error || error.code === "23505") return true; // Safe retry of the same run.
  logger.error("bulk operation history append failed", {
    operation: run.operation,
    run_id: run.run_id,
    error: error.message,
  });
  return false;
}

export async function alertTerminalFailure(
  run: TerminalRun,
  fetchImpl: typeof fetch = fetch,
  destination = config.bulkOperationAlertWebhookUrl,
): Promise<AlertDelivery> {
  if (run.status !== "failed") return "delivered";
  if (!destination) {
    // Deliberately loud: deployment must not create a silent alert channel.
    logger.error("bulk operation failure alert was not delivered: BULK_OPERATION_ALERT_WEBHOOK_URL is unset", {
      operation: run.operation,
      run_id: run.run_id,
    });
    return "destination_unconfigured";
  }

  try {
    const response = await fetchImpl(destination, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "bulk_operation_failed", ...run }),
    });
    if (response.ok) return "delivered";
    logger.error("bulk operation failure alert delivery failed", {
      operation: run.operation,
      run_id: run.run_id,
      http_status: response.status,
    });
  } catch (error) {
    logger.error("bulk operation failure alert delivery failed", {
      operation: run.operation,
      run_id: run.run_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return "delivery_failed";
}
