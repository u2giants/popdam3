/**
 * Shared utilities for admin-api handler modules.
 *
 * Extracted from admin-api/index.ts to allow handler modules in
 * _shared/admin-handlers/ to use them without circular imports.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { err, json } from "./http.ts";

// Re-export http helpers so handler modules only need one import
export { err, json };

// ── Service client factory ──────────────────────────────────────────

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export type ServiceClient = ReturnType<typeof serviceClient>;

// ── Input validation helpers ────────────────────────────────────────

export function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`Missing required string field: ${key}`);
  }
  return v.trim();
}

export function optionalString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Error(`Field ${key} must be a string`);
  return v.trim() || null;
}

// ── Transient error detection + retry ───────────────────────────────

const TRANSIENT_ERROR_PATTERNS = [
  "connection reset",
  "connection error",
  "sendrequest",
  "error reading a body",
  "error reading body",
  "error reading a body from connection",
  "network error",
  "fetch failed",
  "broken pipe",
  "eof",
];

export function isTransientError(e: unknown): boolean {
  const msg = ((e as Error)?.message || "").toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => msg.includes(p));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 200,
  label = "",
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransientError(e) || attempt === maxAttempts) throw e;
      const msg = ((e as Error)?.message || "").toLowerCase();
      console.warn(
        `withRetry [${label || "?"}] transient error (attempt ${attempt}/${maxAttempts}): ${msg.slice(0, 120)}`,
      );
      await new Promise((r) => setTimeout(r, delayMs * attempt));
    }
  }
  throw new Error("withRetry: unreachable");
}

// ── PostgREST error formatting ──────────────────────────────────────

export function formatPostgrestError(error: unknown): string {
  const normalizeMessage = (message: string) => {
    const msg = (message || "").trim();
    if (!msg) return "Unknown database error";
    const lower = msg.toLowerCase();
    const looksHtml = lower.includes("<html") || lower.includes("<!doctype") || lower.includes("<head>");
    if (looksHtml) {
      return "Upstream gateway returned an HTML 500 page (transient infrastructure error). Please retry.";
    }
    return msg;
  };

  if (!error) return "Unknown database error";
  if (typeof error === "string") return normalizeMessage(error);
  if (error instanceof Error) return normalizeMessage(error.message);

  const e = error as Record<string, unknown>;
  const message = normalizeMessage(typeof e.message === "string" ? e.message : "Database error");
  const details = typeof e.details === "string" ? e.details : "";
  const hint = typeof e.hint === "string" ? e.hint : "";
  const code = typeof e.code === "string" ? e.code : "";
  const status = typeof e.status === "number" ? String(e.status) : "";
  const raw = (() => {
    try {
      const serialized = JSON.stringify(e);
      return serialized && serialized !== "{}" ? serialized : "";
    } catch {
      return "";
    }
  })();

  return [
    status ? `[status=${status}]` : "",
    code ? `[${code}]` : "",
    message,
    details ? `details: ${details}` : "",
    hint ? `hint: ${hint}` : "",
    raw && message === "Bad Request" ? `raw: ${raw}` : "",
  ].filter(Boolean).join(" | ");
}

// ── Statement timeout detection ─────────────────────────────────────

export function isStatementTimeout(msg: string): boolean {
  const s = (msg || "").toLowerCase();
  return s.includes("57014") || s.includes("statement timeout") || s.includes("canceling statement due to statement timeout") || s.includes("timeout") || s.includes("502") || s.includes("503");
}
