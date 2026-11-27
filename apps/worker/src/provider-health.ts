/**
 * Provider health: hourly counts of structured-output attempts per
 * model × endpoint (straitly / openrouter) × upstream provider × outcome.
 * Kept in ONE bounded admin_config row (AI_PROVIDER_HEALTH): buckets older than
 * RETAIN_HOURS are dropped on every write, so it never grows long-term.
 */
import { db } from "./supabase.js";
import { logger } from "./logger.js";

export const PROVIDER_HEALTH_KEY = "AI_PROVIDER_HEALTH";
export const RETAIN_HOURS = 14 * 24;
const FLUSH_MS = 5 * 60_000;

export type HealthOutcome = "ok" | "invalid" | "parse" | "timeout" | "transport";
export type HealthCounts = Partial<Record<HealthOutcome, number>>;
/** hour (UTC "YYYY-MM-DDTHH") → "model|endpoint|provider" → counts */
export type HealthBuckets = Record<string, Record<string, HealthCounts>>;

let pending: HealthBuckets = {};
let timer: ReturnType<typeof setInterval> | null = null;

export function classifyAttempt(a: { status: string; parse?: string; validation?: string; error?: string }): HealthOutcome {
  if (a.status === "success") return "ok";
  if (a.validation === "failed") return "invalid";
  if (a.parse === "failed") return "parse";
  return /timeout|aborted/i.test(a.error ?? "") ? "timeout" : "transport";
}

export function healthKey(model: string, endpoint: string | null | undefined, provider: string | null | undefined): string {
  const clean = (s: string | null | undefined) => (s ?? "unknown").replace(/\|/g, "/").slice(0, 60) || "unknown";
  return `${clean(model)}|${clean(endpoint)}|${clean(provider)}`;
}

export function hourOf(date: Date): string { return date.toISOString().slice(0, 13); }

export function addCount(target: HealthBuckets, hour: string, key: string, outcome: HealthOutcome, n = 1): void {
  const bucket = (target[hour] ??= {});
  const counts = (bucket[key] ??= {});
  counts[outcome] = (counts[outcome] ?? 0) + n;
}

/** Merge `add` into `base` and drop hours older than the retention window. */
export function mergeBuckets(base: HealthBuckets, add: HealthBuckets, now: Date): HealthBuckets {
  const out: HealthBuckets = JSON.parse(JSON.stringify(base ?? {}));
  for (const [hour, keys] of Object.entries(add)) {
    for (const [key, counts] of Object.entries(keys)) {
      for (const [outcome, n] of Object.entries(counts)) addCount(out, hour, key, outcome as HealthOutcome, n ?? 0);
    }
  }
  const cutoff = hourOf(new Date(now.getTime() - RETAIN_HOURS * 3_600_000));
  for (const hour of Object.keys(out)) if (hour < cutoff) delete out[hour];
  return out;
}

/** Record one attempt (never throws; flushed in the background). */
export function recordProviderAttempt(model: string, attempt: {
  status: string; parse?: string; validation?: string; error?: string; endpoint?: string;
  providerInfo?: { provider?: string | null; endpoint?: string | null } | undefined;
}, now = new Date()): void {
  try {
    const upstream = attempt.providerInfo?.provider ?? null;
    const endpoint = attempt.endpoint ?? (upstream === "straitly" ? "straitly" : upstream === "openai-direct" ? "openai" : upstream ? "openrouter" : null);
    const provider = upstream === "straitly" ? "straitly" : upstream;
    addCount(pending, hourOf(now), healthKey(model, endpoint, provider), classifyAttempt(attempt));
    if (!timer && process.env.NODE_ENV !== "test" && !process.env.VITEST) {
      timer = setInterval(() => { void flushProviderHealth(); }, FLUSH_MS);
      timer.unref?.();
    }
  } catch { /* stats must never break a model call */ }
}

export async function flushProviderHealth(now = new Date()): Promise<void> {
  if (Object.keys(pending).length === 0) return;
  const batch = pending;
  pending = {};
  try {
    const { data, error } = await db().from("admin_config").select("value").eq("key", PROVIDER_HEALTH_KEY).maybeSingle();
    if (error) throw new Error(error.message);
    const existing = ((data?.value as { buckets?: HealthBuckets } | null)?.buckets) ?? {};
    const buckets = mergeBuckets(existing, batch, now);
    const { error: upErr } = await db().from("admin_config").upsert(
      { key: PROVIDER_HEALTH_KEY, value: { buckets, retain_hours: RETAIN_HOURS, updated_at: now.toISOString() }, updated_at: now.toISOString() },
      { onConflict: "key" },
    );
    if (upErr) throw new Error(upErr.message);
  } catch (e) {
    pending = mergeBuckets(pending, batch, now);
    logger.warn("provider-health: flush failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

export function pendingProviderHealthForTests(): HealthBuckets { return pending; }
export function resetProviderHealthForTests(): void { pending = {}; }
