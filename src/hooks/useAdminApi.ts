import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to call admin-api edge function with current user's JWT.
 * Surfaces real error details (status + body) instead of generic messages.
 */
export function useAdminApi() {
  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    // Use getUser() to force token refresh if expired, then fall back to getSession()
    let accessToken: string | undefined;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      accessToken = session?.access_token;
      // If token looks expired (JWT exp check), force refresh
      if (accessToken) {
        try {
          const parts = accessToken.split(".");
          if (parts.length === 3) {
            const payload64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
            const claims = JSON.parse(atob(payload64));
            if (claims.exp && claims.exp * 1000 < Date.now() + 30_000) {
              // Token expires within 30s — force refresh
              const { data: { session: refreshed } } = await supabase.auth.refreshSession();
              if (refreshed?.access_token) accessToken = refreshed.access_token;
            }
          }
        } catch { /* JWT parse failed, proceed with existing token */ }
      }
    } catch {
      accessToken = undefined;
    }
    if (!accessToken) throw new Error("Not authenticated");

    const MAX_RETRIES = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const { data, error } = await supabase.functions.invoke("admin-api", {
          body: { action, ...payload },
          headers: { Authorization: `Bearer ${accessToken}` },
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
    }

    throw lastError || new Error("Admin API call failed after retries");
  }, []);

  return { call };
}
