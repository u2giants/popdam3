/**
 * OpenAI model routing switch.
 *
 * Every "openai/..." model goes straight to OpenAI's own API by default
 * (owner decision 2026-11-24). The admin switch in Settings → APIs
 * ("Send OpenAI models directly to OpenAI") writes admin_config.OPENAI_ROUTE:
 *   absent or "direct" → api.openai.com with admin_config.OPENAI_API_KEY
 *   "openrouter"       → the normal OpenRouter path
 * Non-OpenAI models are never affected.
 *
 * Direct mode never falls back to OpenRouter silently: a missing key is an error.
 */
import { db } from "./supabase.js";
import { withDependencyTimeout } from "./bounded-dependency.js";

export type OpenAiRoute = "direct" | "openrouter";
export interface OpenAiRouting { route: OpenAiRoute; apiKey: string }

const CACHE_TTL_MS = 60_000;
let cached: OpenAiRouting | null = null;
let cachedAt = 0;

export function isOpenAiModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith("openai/");
}

/** OpenAI's own model id: "openai/gpt-6-luna:exacto" → "gpt-6-luna". */
export function openAiDirectModelId(model: string): string {
  return model.trim().split(":")[0].slice("openai/".length);
}

function unwrap(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const inner = (value as Record<string, unknown>).value;
    if (typeof inner === "string") return inner.trim();
  }
  return "";
}

export function parseOpenAiRoute(value: unknown): OpenAiRoute {
  return unwrap(value).toLowerCase() === "openrouter" ? "openrouter" : "direct";
}

async function loadFromAdminConfig(): Promise<OpenAiRouting> {
  const { data, error } = await withDependencyTimeout(
    "OpenAI routing config read",
    db().from("admin_config").select("key, value").in("key", ["OPENAI_ROUTE", "OPENAI_API_KEY"]),
  );
  if (error) throw new Error(`Could not read OpenAI routing config: ${error.message}`);
  const rows = (data ?? []) as Array<{ key: string; value: unknown }>;
  return {
    route: parseOpenAiRoute(rows.find((r) => r.key === "OPENAI_ROUTE")?.value),
    apiKey: unwrap(rows.find((r) => r.key === "OPENAI_API_KEY")?.value),
  };
}

let loader: () => Promise<OpenAiRouting> = loadFromAdminConfig;

export async function getOpenAiRouting(): Promise<OpenAiRouting> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;
  cached = await loader();
  cachedAt = now;
  return cached;
}

/** Test hook: inject the config source and drop the cache. */
export function setOpenAiRoutingLoaderForTests(next: (() => Promise<OpenAiRouting>) | null): void {
  loader = next ?? loadFromAdminConfig;
  cached = null;
  cachedAt = 0;
}
