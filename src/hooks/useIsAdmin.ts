import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useImpersonation } from "@/hooks/useImpersonation";

/**
 * Returns whether the current user has the 'admin' role.
 * `isRealAdmin` always reflects the DB role (ignores impersonation).
 * `isAdmin` respects impersonation — returns false when impersonating a member.
 */
export function useIsAdmin() {
  const { user } = useAuth();
  const { impersonatedRole } = useImpersonation();

  const { data: dbAdmin = false, isLoading } = useQuery({
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
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const isRealAdmin = dbAdmin;
  const isAdmin = impersonatedRole === "member" ? false : dbAdmin;

  return { isAdmin, isRealAdmin, isLoading };
}
