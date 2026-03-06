import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to call admin-api edge function with current user's JWT.
 * Surfaces real error details (status + body) instead of generic messages.
 */
export function useAdminApi() {
  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not authenticated");

    const MAX_RETRIES = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { data, error } = await supabase.functions.invoke("admin-api", {
          body: { action, ...payload },
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (error) {
          // Extract real error details from FunctionsHttpError
          let detailedMsg = error.message || "Admin API call failed";
          let status = 0;
          try {
            const ctx = (error as any).context;
            if (ctx && typeof ctx.status === "number") {
              status = ctx.status;
              const bodyText = typeof ctx.text === "function" ? await ctx.text() : "";
              const bodyPreview = bodyText.slice(0, 400);
              const looksHtml = /<!doctype|<html|<head>/i.test(bodyText);
              let parsed: any = null;
              try { parsed = JSON.parse(bodyText); } catch { /* not JSON */ }

              if (looksHtml) {
                detailedMsg = `[${ctx.status}] Upstream gateway returned HTML instead of JSON (transient infrastructure error). Please retry.`;
              } else {
                const serverError = parsed?.error || bodyPreview || detailedMsg;
                detailedMsg = `[${ctx.status}] ${serverError}`;
              }
            }
          } catch { /* fallback to original message */ }

          const isTransient =
            [500, 502, 503, 504, 520, 522, 524].includes(status) ||
            /internal server error|gateway|transient|timeout|failed to fetch|network/i.test(detailedMsg);
          if (isTransient && attempt < MAX_RETRIES) {
            lastError = new Error(detailedMsg);
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            continue;
          }
          throw new Error(detailedMsg);
        }

        if (data && !data.ok) throw new Error(data.error || "Admin API returned error");
        return data;
      } catch (e) {
        if (attempt < MAX_RETRIES && (e as Error).message?.includes("Bad Request")) {
          lastError = e as Error;
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }

    throw lastError || new Error("Admin API call failed after retries");
  }, []);

  return { call };
}
