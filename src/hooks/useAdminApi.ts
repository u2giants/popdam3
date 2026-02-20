import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to call admin-api edge function with current user's JWT.
 */
export function useAdminApi() {
  const call = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not authenticated");

    const { data, error } = await supabase.functions.invoke("admin-api", {
      body: { action, ...payload },
    });

    if (error) throw new Error(error.message || "Admin API call failed");
    if (data && !data.ok) throw new Error(data.error || "Admin API returned error");
    return data;
  }, []);

  return { call };
}
