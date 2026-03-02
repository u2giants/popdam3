import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to call admin-api edge function with current user's JWT.
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
        });

        // Retry on transient 500 "Bad Request" from edge runtime
        if (error) {
          const msg = error.message || "";
          const isTransient = msg.includes("Bad Request") || msg.includes("Internal Server Error");
          if (isTransient && attempt < MAX_RETRIES) {
            lastError = new Error(msg);
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            continue;
          }
          throw new Error(msg || "Admin API call failed");
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
