import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS_ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-agent-key";
const CORS_EXPOSE_HEADERS = "X-Row-Count";

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.designflow\.app$/,
  /^https:\/\/[a-z0-9-]+\.lovable\.app$/,
  /^http:\/\/localhost(:\d+)?$/,
];

function resolveAllowedOrigin(origin: string | null): string {
  if (!origin) return "*";
  return ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin)) ? origin : "";
}

function buildCorsHeaders(allowedOrigin: string): Record<string, string> {
  if (!allowedOrigin) return {};
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
  };
  if (allowedOrigin !== "*") headers["Vary"] = "Origin";
  return headers;
}

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
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

export function corsServe(handler: (req: Request) => Promise<Response>): void {
  serve(async (req: Request) => {
    const origin = req.headers.get("Origin");
    const allowedOrigin = resolveAllowedOrigin(origin);
    const hdrs = buildCorsHeaders(allowedOrigin);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: hdrs });
    }

    const response = await handler(req);
    if (!allowedOrigin) return response;

    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(hdrs)) headers.set(k, v);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}
