/**
 * bulk-job-runner — REPLACED by the persistent Railway worker (apps/worker).
 *
 * This function is intentionally a no-op. The pg_cron schedule that previously
 * invoked it every minute has been removed via migration 20260322000000.
 *
 * All batch processing (AI tagging, style group rebuild, tag propagation, ERP
 * classification) is now handled by the Railway worker, which:
 *   - Runs continuously with no 60s timeout constraint
 *   - Polls admin_config.BULK_OPERATIONS every 5 seconds
 *   - Calls Gemini directly at 15x the previous concurrency
 *   - Reads/writes the same admin_config state schema as before
 *
 * This stub is kept deployed so any stale references to this function URL
 * return a clean 200 rather than a 404.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async () => {
  return new Response(
    JSON.stringify({ ok: true, message: "replaced by railway worker" }),
    { headers: { "Content-Type": "application/json" } },
  );
});
