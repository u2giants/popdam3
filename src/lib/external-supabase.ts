/**
 * Single Supabase client for ALL operations — auth, data queries, and edge functions.
 * URL and anon key are selected at runtime from app-mode.ts based on the hostname
 * (dam.designflow.app → PopDAM project; sg.designflow.app → PopSG project). Both
 * anon keys are publishable and baked into the bundle.
 *
 * The Lovable-managed .env file is intentionally ignored (it always contains the
 * stale internal project ID).
 */
import { createClient } from "@supabase/supabase-js";
import { CURRENT_APP, APP_MODE } from "./app-mode";

// Distinct storage key per mode so opening dam.designflow.app and
// sg.designflow.app in the same browser doesn't collide auth sessions.
const STORAGE_KEY = `sb-${APP_MODE}-auth-token`;

export const externalSupabase = createClient(
  CURRENT_APP.supabaseUrl,
  CURRENT_APP.supabaseAnonKey,
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
      storageKey: STORAGE_KEY,
    },
  },
);
