/**
 * Supabase service role client — single shared instance.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export type DB = SupabaseClient;

let _client: DB | null = null;

export function db(): DB {
  if (!_client) {
    _client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}
