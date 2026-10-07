import { corsServe, json } from "../_shared/http.ts";
import { buildInviteHtml, sendBrevoEmail } from "../_shared/brevo.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";

corsServe(async (req: Request) => {
  // Only admin screens call this; without the check it is an open email relay.
  const auth = await requireAdmin(req, { parseMode: "strict" });
  if (!auth.ok) {
    return json({ ok: false, error: auth.status === 403 ? "Forbidden" : "Unauthorized" }, auth.status);
  }

  try {
    const { email } = await req.json();
    if (!email) {
      return json({ ok: false, error: "email is required" }, 400);
    }

    const signUpUrl = "https://dam.designflow.app/login?signup=true";
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
      }, 500);
    }

    return json({
      ok: true,
      sent: true,
      messageId: result.messageId ?? null,
      httpStatus: result.httpStatus,
      warning: result.warning ?? null,
    });
  } catch (e) {
    console.error("send-invite-email error:", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
