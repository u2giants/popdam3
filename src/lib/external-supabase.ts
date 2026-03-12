/**
 * External Supabase client — used for ALL authentication.
 *
 * This deliberately bypasses the Lovable Cloud auto-generated client
 * so that auth (Google OAuth, email/password, sessions) goes through
 * the production Supabase project the team owns.
 *
 * The Lovable Cloud client (src/integrations/supabase/client.ts) is
 * still used for non-auth data queries (assets, style_groups, etc.).
 */
import { createClient } from "@supabase/supabase-js";

const EXTERNAL_SUPABASE_URL = "https://ryltkzzernhwnojzouyb.supabase.co";
const EXTERNAL_SUPABASE_ANON_KEY = "sb_publishable_7pDNMn_LIJOkdYmhcI0n7g_IuKABuWK";

export const externalSupabase = createClient(
  EXTERNAL_SUPABASE_URL,
  EXTERNAL_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);
