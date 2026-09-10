/**
 * Pure logic for the `bulk-operation-alert` edge function.
 *
 * The Railway worker (apps/worker) POSTs a terminal bulk-operation failure to
 * whatever URL is configured in BULK_OPERATION_ALERT_WEBHOOK_URL. The owner has
 * named a mailbox rather than a webhook, so this module turns that JSON payload
 * into a readable email. Everything here is side-effect free so it can be unit
 * tested by the repo's vitest edge-function project; the Deno handler in
 * ../bulk-operation-alert/index.ts owns I/O only.
 */

/** The payload shape produced by `alertTerminalFailure` in apps/worker. */
export interface BulkOperationAlertPayload {
  type?: string;
  operation?: string;
  run_id?: string;
  status?: string;
  stage?: string;
  error?: string;
  reason_code?: string;
  progress?: Record<string, unknown>;
  started_at?: string;
  ended_at?: string;
}

export type AuthOutcome =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string };

/**
 * Exact, length-guarded comparison of a presented secret against the expected
 * one. Never a substring or prefix match, and never true when either side is
 * empty, so an unset env var can never authorise a caller.
 */
export function secretMatches(presented: string | null | undefined, expected: string | null | undefined): boolean {
  if (!presented || !expected) return false;
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * Machine-to-machine auth, following the repo's existing `x-agent-key` shape:
 * a single shared secret carried in a request header.
 *
 * The worker's alert POST sends only `content-type`, and its destination is a
 * bare URL, so the secret is also accepted as the `key` query parameter — that
 * is the only channel a URL-configured webhook has today. Neither channel is
 * optional: with BULK_OPERATION_ALERT_SECRET unset the function refuses every
 * request rather than becoming an open mail relay.
 */
export function authorizeAlertRequest(
  req: { headers: { get(name: string): string | null }; url: string },
  expectedSecret: string | null | undefined,
): AuthOutcome {
  if (!expectedSecret) {
    return { ok: false, status: 500, error: "Alert endpoint is not configured (BULK_OPERATION_ALERT_SECRET missing)" };
  }
  const header = req.headers.get("x-alert-key");
  if (secretMatches(header, expectedSecret)) return { ok: true };

  let queryKey: string | null = null;
  try {
    queryKey = new URL(req.url).searchParams.get("key");
  } catch {
    queryKey = null;
  }
  if (secretMatches(queryKey, expectedSecret)) return { ok: true };

  return { ok: false, status: 401, error: "Unauthorized" };
}

function present(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Scope fields the worker may attach to `progress` for a style-group rebuild or
 * a licensor/property-scoped run. Absent keys are simply not rendered — the
 * worker's progress object is deliberately open-ended.
 */
const SCOPE_KEYS = ["licensor", "licensor_name", "property", "property_name", "style_group", "scope", "brand", "batch"] as const;

export interface AlertField {
  label: string;
  value: string;
}

/** Ordered, human-labelled fields for the email body. Only present values appear. */
export function buildAlertFields(payload: BulkOperationAlertPayload): AlertField[] {
  const fields: AlertField[] = [];
  const push = (label: string, value: unknown) => {
    const v = present(value);
    if (v) fields.push({ label, value: v });
  };

  push("Operation", payload.operation);
  push("Run ID", payload.run_id);
  push("Status", payload.status);
  push("Stage", payload.stage);
  push("Reason code", payload.reason_code);
  push("Started", payload.started_at);
  push("Ended", payload.ended_at);

  const progress = payload.progress;
  if (progress && typeof progress === "object") {
    for (const key of SCOPE_KEYS) {
      const raw = (progress as Record<string, unknown>)[key];
      if (typeof raw === "string" || typeof raw === "number") {
        push(key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), String(raw));
      }
    }
  }

  push("Error", payload.error);
  return fields;
}

/** Subject line naming this unambiguously as a PopDAM bulk-operation failure. */
export function buildAlertSubject(payload: BulkOperationAlertPayload): string {
  const operation = present(payload.operation) ?? "unknown operation";
  const runId = present(payload.run_id);
  return runId
    ? `PopDAM bulk-operation failure: ${operation} (run ${runId})`
    : `PopDAM bulk-operation failure: ${operation}`;
}

/** Plain-text rendering, also used as the fallback body for text-only clients. */
export function buildAlertText(payload: BulkOperationAlertPayload): string {
  const lines = [buildAlertSubject(payload), ""];
  for (const { label, value } of buildAlertFields(payload)) lines.push(`${label}: ${value}`);

  const progress = payload.progress;
  if (progress && typeof progress === "object" && Object.keys(progress).length > 0) {
    lines.push("", "Progress:", JSON.stringify(progress, null, 2));
  }
  lines.push("", "Sent by the PopDAM bulk-operation alert endpoint.");
  return lines.join("\n");
}

/** HTML rendering in the same visual language as the PopDAM invite email. */
export function buildAlertHtml(payload: BulkOperationAlertPayload): string {
  const rows = buildAlertFields(payload)
    .map(({ label, value }) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#71717a;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>` +
      `<td style="padding:6px 0;color:#18181b;font-size:13px;word-break:break-word;">${escapeHtml(value)}</td></tr>`
    )
    .join("");

  const progress = payload.progress;
  const progressBlock = progress && typeof progress === "object" && Object.keys(progress).length > 0
    ? `<h3 style="margin:24px 0 8px;color:#18181b;font-size:14px;font-weight:600;">Progress</h3>` +
      `<pre style="margin:0;padding:12px;background:#f4f4f5;border-radius:6px;color:#3f3f46;font-size:12px;white-space:pre-wrap;word-break:break-word;">${
        escapeHtml(JSON.stringify(progress, null, 2))
      }</pre>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <tr><td style="background:#7f1d1d;padding:20px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:18px;font-weight:600;">PopDAM bulk-operation failure</h1>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <table cellpadding="0" cellspacing="0" width="100%">${rows}</table>
          ${progressBlock}
          <p style="margin:24px 0 0;color:#a1a1aa;font-size:12px;line-height:1.5;">
            Sent by the PopDAM bulk-operation alert endpoint.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
