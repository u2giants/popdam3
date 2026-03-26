import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useImpersonation } from "@/contexts/ImpersonationContext";

/**
 * Returns whether the current user has the 'admin' role.
 * When impersonating, returns the impersonated user's role instead.
 */
export function useIsAdmin() {
  const { user } = useAuth();
  const { impersonating } = useImpersonation();

  const { data: isAdmin = false, isLoading } = useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) return false;
      return !!data;
    },
    enabled: !!user && impersonating === null,
    staleTime: 5 * 60 * 1000,
  });

  if (impersonating !== null) {
    return { isAdmin: impersonating.isAdmin, isLoading: false };
  }

  return { isAdmin, isLoading };
}
