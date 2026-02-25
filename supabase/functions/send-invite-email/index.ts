import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
    if (!BREVO_API_KEY) {
      console.warn("BREVO_API_KEY not configured — skipping email send");
      return json({ ok: true, skipped: true, reason: "BREVO_API_KEY not configured" });
    }

    const { email, invitation_id } = await req.json();
    if (!email) {
      return json({ ok: false, error: "email is required" }, 400);
    }

    // Build a simple HTML invitation email
    const appUrl = Deno.env.get("POPDAM_APP_URL") || "https://dam.designflow.app";
    const subject = "You've been invited to PopDAM";
    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #1a1d23; color: #e4e4e7; border-radius: 12px;">
        <h1 style="color: #f59e0b; font-size: 24px; margin-bottom: 16px;">Welcome to PopDAM</h1>
        <p style="line-height: 1.6; margin-bottom: 24px;">
          You've been invited to join PopDAM — the Digital Asset Manager for licensed character design files.
        </p>
        <p style="line-height: 1.6; margin-bottom: 24px;">
          Click the button below to create your account and get started.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${appUrl}" style="display: inline-block; background: #f59e0b; color: #1a1d23; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
            Accept Invitation
          </a>
        </div>
        <p style="font-size: 12px; color: #71717a; margin-top: 32px;">
          If you didn't expect this invitation, you can safely ignore this email.
        </p>
      </div>
    `;

    const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "PopDAM", email: "noreply@popdam.com" },
        to: [{ email }],
        subject,
        htmlContent,
      }),
    });

    if (!brevoResponse.ok) {
      const errorText = await brevoResponse.text();
      console.error("Brevo send failed:", brevoResponse.status, errorText);
      return json({ ok: false, error: "Email send failed" }, 500);
    }

    await brevoResponse.text(); // consume body
    return json({ ok: true, sent: true });
  } catch (e) {
    console.error("send-invite-email error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
