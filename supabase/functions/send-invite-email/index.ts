import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/http.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();
    if (!email) {
      return json({ ok: false, error: "email is required" }, 400);
    }

    // Re-send invite using Supabase Auth — no external email service required.
    // inviteUserByEmail re-sends the magic link for a pending (not-yet-confirmed) user.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await adminClient.auth.admin.inviteUserByEmail(email);
    if (error) {
      console.error("Re-invite failed:", error.message);
      return json({ ok: false, error: error.message }, 500);
    }

    return json({ ok: true, sent: true });
  } catch (e) {
    console.error("send-invite-email error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
