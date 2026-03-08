/**
 * Shared Supabase service-role client factory.
 *
 * Every edge function that needs a service-role client should import this
 * instead of duplicating the createClient call.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export type ServiceClient = ReturnType<typeof serviceClient>;
