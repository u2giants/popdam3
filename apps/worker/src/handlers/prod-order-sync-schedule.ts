/**
 * Keeps PopDAM's production PO feed current (popdam3#1272).
 *
 * The edge sync advances a few pages per call, so the worker continues a
 * running sync each tick and starts a fresh one every SYNC_INTERVAL_MS.
 * Best-effort: failures are logged and retried on later ticks.
 */
import { config } from "../config.js";
import { logger } from "../logger.js";
import { db } from "../supabase.js";

export const SYNC_INTERVAL_MS = 6 * 60 * 60_000;
const MIN_CALL_GAP_MS = 60_000;

let lastCallAt = 0;

type LatestRun = { status: string; started_at: string } | null;

export function prodOrderSyncAction(latest: LatestRun, now: number): "continue" | "start" | null {
  if (latest?.status === "running") return "continue";
  if (!latest) return "start";
  const started = Date.parse(latest.started_at);
  return !Number.isFinite(started) || now - started >= SYNC_INTERVAL_MS ? "start" : null;
}

export async function maybeSyncProdOrders(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<void> {
  // On by default; the unit-test run switches it off (package.json).
  if ((process.env.PROD_ORDER_SYNC_SCHEDULE || "on").trim().toLowerCase() === "off") return;
  if (now - lastCallAt < MIN_CALL_GAP_MS) return;
  const { data, error } = await db().from("prod_order_sync_runs")
    .select("status, started_at").order("started_at", { ascending: false }).limit(1);
  if (error) throw new Error(`prod order sync: run read failed: ${error.message}`);
  const action = prodOrderSyncAction((data?.[0] ?? null) as LatestRun, now);
  if (!action) return;
  lastCallAt = now;
  const edgeKey = config.supabaseSecretKey || config.supabaseServiceRoleKey;
  const response = await fetchImpl(`${config.supabaseUrl}/functions/v1/admin-api`, {
    method: "POST",
    signal: AbortSignal.timeout(150_000),
    headers: { apikey: edgeKey, Authorization: `Bearer ${edgeKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "trigger-prod-order-sync",
      ...(action === "continue" ? { continue_only: true } : { created_by: "worker-schedule" }),
    }),
  });
  const text = await response.text();
  if (!response.ok && response.status !== 409) {
    logger.warn("prod order sync: chunk failed", { action, status: response.status, body: text.slice(0, 300) });
    return;
  }
  logger.info("prod order sync: chunk", { action, status: response.status, body: text.slice(0, 200) });
}

/** Test hook. */
export function resetProdOrderSyncThrottle(): void { lastCallAt = 0; }
