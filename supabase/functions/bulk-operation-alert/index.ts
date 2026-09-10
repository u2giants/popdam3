/**
 * bulk-operation-alert — email destination for terminal bulk-operation failures.
 *
 * The Railway worker (apps/worker) POSTs a terminal failure to the URL held in
 * BULK_OPERATION_ALERT_WEBHOOK_URL. The owner named a mailbox (hello@popcre.com)
 * rather than a webhook, so this function receives that POST and sends the
 * payload on as an email through the repo's existing Brevo helper.
 *
 * It returns 2xx ONLY when Brevo accepted the message, so the worker's
 * "alert delivery failed" logging keeps meaning what it says.
 *
 * Configuration (Supabase function secrets):
 *   BREVO_API_KEY                  — already used by send-invite-email
 *   BULK_OPERATION_ALERT_SECRET    — shared secret; required, no default
 *   BULK_OPERATION_ALERT_EMAIL_TO  — optional override of the default recipient
 */

import { corsServe, json } from "../_shared/http.ts";
import { sendBrevoEmail } from "../_shared/brevo.ts";
import {
  authorizeAlertRequest,
  buildAlertHtml,
  buildAlertSubject,
  buildAlertText,
  type BulkOperationAlertPayload,
} from "../_shared/bulk-operation-alert.ts";

const DEFAULT_RECIPIENT = "hello@popcre.com";

corsServe(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const auth = authorizeAlertRequest(req, Deno.env.get("BULK_OPERATION_ALERT_SECRET"));
  if (!auth.ok) {
    console.error(`[bulk-operation-alert] refused: ${auth.error}`);
    return json({ ok: false, error: auth.error }, auth.status);
  }

  let payload: BulkOperationAlertPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "Body must be JSON" }, 400);
  }
  if (!payload || typeof payload !== "object") {
    return json({ ok: false, error: "Body must be a JSON object" }, 400);
  }

  const to = Deno.env.get("BULK_OPERATION_ALERT_EMAIL_TO")?.trim() || DEFAULT_RECIPIENT;
  const subject = buildAlertSubject(payload);

  const result = await sendBrevoEmail({
    to,
    subject,
    htmlContent: buildAlertHtml(payload),
    textContent: buildAlertText(payload),
  });

  if (!result.ok) {
    // Non-2xx keeps the worker's undelivered-alert logging honest.
    console.error(`[bulk-operation-alert] send failed for run=${payload.run_id ?? "unknown"}: ${result.error}`);
    return json({ ok: false, error: result.error, httpStatus: result.httpStatus }, 502);
  }

  console.log(`[bulk-operation-alert] delivered run=${payload.run_id ?? "unknown"} messageId=${result.messageId ?? "none"}`);
  return json({ ok: true, sent: true, messageId: result.messageId ?? null, warning: result.warning ?? null });
});
