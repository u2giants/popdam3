/**
 * Single Supabase client for ALL operations — auth, data queries, and edge functions.
 * Both PopDAM and PopSG use the same Supabase project (PopDAM). PopSG is a workspace
 * within that project, not a separate Supabase instance.
 *
 * The Lovable-managed .env file is intentionally ignored (it always contains the
 * stale internal project ID).
 */
import { createClient } from "@supabase/supabase-js";
import { CURRENT_APP } from "./app-mode";

export const externalSupabase = createClient(
  CURRENT_APP.supabaseUrl,
  CURRENT_APP.supabaseAnonKey,
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "sb-popdam-auth-token",
    },
  },
);
