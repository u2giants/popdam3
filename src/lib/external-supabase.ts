/**
 * Single Supabase client for ALL operations — auth, data queries, and edge functions.
 * URL and anon key are hardcoded here because the Lovable-managed .env file
 * is auto-generated and always contains the old internal project ID, which we ignore.
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
