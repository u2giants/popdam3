/**
 * Shared HTTP response utilities for edge functions.
 *
 * Import:
 *   import { corsServe, err, json } from "../_shared/http.ts";
 *
 * Usage — wrap your serve() handler with corsServe() for dynamic origin-aware CORS:
 *
 *   corsServe(async (req) => {
 *     // no OPTIONS check needed — corsServe handles it
 *     return json({ ok: true });
 *   });
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-agent-key, " +
  "x-supabase-client-platform, x-supabase-client-platform-version, " +
  "x-supabase-client-runtime, x-supabase-client-runtime-version";

const CORS_EXPOSE_HEADERS = "X-Row-Count, Content-Disposition";

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.designflow\.app$/,
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
];

function resolveAllowedOrigin(origin: string | null): string {
  if (!origin) return "*"; // non-browser / server-to-server request — no restriction
  return ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin)) ? origin : "";
}

function buildCorsHeaders(allowedOrigin: string): Record<string, string> {
  if (!allowedOrigin) return {}; // rejected origin — omit CORS headers entirely
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
  };
  if (allowedOrigin !== "*") headers["Vary"] = "Origin";
  return headers;
}

/**
 * Static headers kept for backwards compatibility with edge functions that
 * haven't been migrated to corsServe yet.  Prefer corsServe() for new code.
 */
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function err(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

/**
 * Drop-in replacement for serve() that adds dynamic origin-aware CORS to every
 * response.  Handles OPTIONS preflights automatically; the inner handler never
 * needs to check req.method === "OPTIONS".
 *
 * Allowed origins: *.designflow.app, *.lovable.app, localhost (any port).
 * Requests from other origins receive no CORS headers (browser will block them).
 * Non-browser requests (no Origin header) are unrestricted.
 */
export function corsServe(handler: (req: Request) => Promise<Response>): void {
  serve(async (req: Request) => {
    const origin = req.headers.get("Origin");
    const allowedOrigin = resolveAllowedOrigin(origin);
    const hdrs = buildCorsHeaders(allowedOrigin);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: hdrs });
    }

    const response = await handler(req);

    const headers = new Headers(response.headers);

    // json()/err() keep wildcard CORS for older non-corsServe functions.  Once a
    // function opts into corsServe, this wrapper owns CORS and must remove those
    // fallback headers for rejected browser origins.
    headers.delete("Access-Control-Allow-Origin");
    headers.delete("Access-Control-Allow-Headers");
    headers.delete("Access-Control-Expose-Headers");
    headers.delete("Vary");
    for (const [k, v] of Object.entries(hdrs)) headers.set(k, v);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}
