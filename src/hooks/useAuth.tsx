import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AUTH_STORAGE_KEY, externalSupabase } from "@/lib/external-supabase";
import type { User, Session } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = externalSupabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    // Then check for existing session
    externalSupabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    // Server sign-out can fail (network, expired token, outage). On a shared
    // workstation the local session must still be destroyed, and the user must
    // be told the server-side revocation did not complete (#1088).
    let serverFailed = false;
    try {
      const { error } = await externalSupabase.auth.signOut();
      if (error) serverFailed = true;
    } catch {
      serverFailed = true;
    }
    if (serverFailed) {
      // supabase-js "local" sign-out still calls the server when a session is
      // stored, so it fails the same way offline. Remove the stored session
      // first; local sign-out then runs without the network and finishes
      // in-memory cleanup (stops refresh, emits SIGNED_OUT).
      for (const suffix of ["", "-code-verifier", "-user"]) {
        try {
          localStorage.removeItem(`${AUTH_STORAGE_KEY}${suffix}`);
        } catch {
          // storage unavailable: nothing persisted to remove
        }
      }
      try {
        await externalSupabase.auth.signOut({ scope: "local" });
      } catch {
        // fall through: React state below is cleared regardless
      }
      toast.warning(
        "Signed out on this device, but the server could not confirm sign-out. Other sessions may stay active until they expire.",
      );
    }
    setSession(null);
    setUser(null);
    // Drop every cached query so the next sign-in on this tab never sees the
    // previous user's data (roles, filters, checkouts, current-user).
    queryClient.clear();
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
