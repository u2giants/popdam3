/**
 * Brevo (Sendinblue) transactional email helper.
 *
 * Uses the Brevo v3 REST API to send transactional emails.
 * Requires BREVO_API_KEY in environment.
 */

interface SendEmailParams {
  to: string;
  subject: string;
  htmlContent: string;
  senderName?: string;
  senderEmail?: string;
}

export async function sendBrevoEmail(params: SendEmailParams): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "Email delivery is not configured (BREVO_API_KEY missing)" };
  }

  const sender = {
    name: params.senderName ?? "PopDAM",
    email: params.senderEmail ?? "noreply@popheadquarters.com",
  };

  const body = {
    sender,
    to: [{ email: params.to }],
    subject: params.subject,
    htmlContent: params.htmlContent,
  };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Brevo API error [${res.status}]:`, text);
    return { ok: false, error: `Brevo API error [${res.status}]: ${text.slice(0, 200)}` };
  }

  const data = await res.json();
  return { ok: true, messageId: data.messageId };
}

/**
 * Build a simple, clean HTML invitation email.
 */
export function buildInviteHtml(signUpUrl: string, role: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#18181b;padding:24px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">PopDAM</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;color:#18181b;font-size:18px;font-weight:600;">You've been invited!</h2>
          <p style="margin:0 0 16px;color:#52525b;font-size:14px;line-height:1.6;">
            You've been invited to join PopDAM as <strong>${role === "admin" ? "an Admin" : "a User"}</strong>.
            Click the button below to create your account and get started.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr><td style="background:#18181b;border-radius:6px;padding:12px 24px;">
              <a href="${signUpUrl}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;display:inline-block;">Create your account</a>
            </td></tr>
          </table>
          <p style="margin:16px 0 0;color:#a1a1aa;font-size:12px;line-height:1.5;">
            If you didn't expect this invitation, you can safely ignore this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
