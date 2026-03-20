import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, json } from "../_shared/http.ts";
import { buildInviteHtml, sendBrevoEmail } from "../_shared/brevo.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email } = await req.json();
    if (!email) {
      return json({ ok: false, error: "email is required" }, 400);
    }

    const signUpUrl = "https://popdam.lovable.app/login?signup=true";
    const htmlContent = buildInviteHtml(signUpUrl, "user");

    const result = await sendBrevoEmail({
      to: email,
      subject: "You've been invited to PopDAM",
      htmlContent,
    });

    if (!result.ok) {
      console.error("Invite email failed:", result.error);
      return json({
        ok: false,
        error: result.error,
        httpStatus: result.httpStatus,
        rawBody: result.rawBody,
      }, 500);
    }

    // Return full diagnostics so the frontend can show delivery proof
    return json({
      ok: true,
      sent: true,
      messageId: result.messageId ?? null,
      httpStatus: result.httpStatus,
      warning: result.warning ?? null,
      rawBody: result.rawBody ?? null,
    });
  } catch (e) {
    console.error("send-invite-email error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
