import { describe, expect, it } from "vitest";
import {
  authorizeAlertRequest,
  buildAlertFields,
  buildAlertHtml,
  buildAlertSubject,
  buildAlertText,
  type BulkOperationAlertPayload,
  secretMatches,
} from "./bulk-operation-alert.ts";

/**
 * The exact payload apps/worker's `alertTerminalFailure` posts: the whole
 * TerminalRun spread beside a `type` discriminator.
 */
const payload: BulkOperationAlertPayload = {
  type: "bulk_operation_failed",
  operation: "style_group_rebuild",
  run_id: "run_2026_09_10_0001",
  status: "failed",
  stage: "assign",
  error: "ERP lookup timed out after 3 retries",
  reason_code: "erp_timeout",
  progress: { processed: 412, total: 900, licensor: "Disney", property: "Mickey & Friends" },
  started_at: "2026-09-10T04:00:00.000Z",
  ended_at: "2026-09-10T04:12:31.000Z",
};

function request(init: { headers?: Record<string, string>; url?: string } = {}) {
  const headers = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url: init.url ?? "https://example.supabase.co/functions/v1/bulk-operation-alert",
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
  };
}

describe("secretMatches", () => {
  it("accepts only an exact match", () => {
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
    expect(secretMatches("s3cre", "s3cret")).toBe(false);
    expect(secretMatches("s3cretX", "s3cret")).toBe(false);
    expect(secretMatches("S3CRET", "s3cret")).toBe(false);
  });

  it("never authorises when either side is empty", () => {
    expect(secretMatches("", "")).toBe(false);
    expect(secretMatches("s3cret", "")).toBe(false);
    expect(secretMatches("", "s3cret")).toBe(false);
    expect(secretMatches(null, undefined)).toBe(false);
  });
});

describe("authorizeAlertRequest", () => {
  it("refuses everything when the shared secret is unconfigured", () => {
    const outcome = authorizeAlertRequest(request({ headers: { "x-alert-key": "anything" } }), "");
    expect(outcome).toEqual({
      ok: false,
      status: 500,
      error: "Alert endpoint is not configured (BULK_OPERATION_ALERT_SECRET missing)",
    });
  });

  it("accepts the shared secret in the x-alert-key header", () => {
    expect(authorizeAlertRequest(request({ headers: { "x-alert-key": "s3cret" } }), "s3cret")).toEqual({ ok: true });
  });

  it("accepts the shared secret in the key query parameter, the only channel a webhook URL has", () => {
    const req = request({ url: "https://example.supabase.co/functions/v1/bulk-operation-alert?key=s3cret" });
    expect(authorizeAlertRequest(req, "s3cret")).toEqual({ ok: true });
  });

  it("rejects a wrong or missing secret with 401", () => {
    expect(authorizeAlertRequest(request(), "s3cret").ok).toBe(false);
    expect(authorizeAlertRequest(request({ headers: { "x-alert-key": "nope" } }), "s3cret")).toEqual({
      ok: false,
      status: 401,
      error: "Unauthorized",
    });
    const wrongQuery = request({ url: "https://example.supabase.co/functions/v1/bulk-operation-alert?key=nope" });
    expect(authorizeAlertRequest(wrongQuery, "s3cret").ok).toBe(false);
  });
});

describe("buildAlertSubject", () => {
  it("names the operation and run id", () => {
    expect(buildAlertSubject(payload)).toBe("PopDAM bulk-operation failure: style_group_rebuild (run run_2026_09_10_0001)");
  });

  it("degrades safely when the worker sent no operation or run id", () => {
    expect(buildAlertSubject({})).toBe("PopDAM bulk-operation failure: unknown operation");
  });
});

describe("buildAlertFields", () => {
  it("renders every terminal-run field plus licensor/property scope from progress", () => {
    expect(buildAlertFields(payload)).toEqual([
      { label: "Operation", value: "style_group_rebuild" },
      { label: "Run ID", value: "run_2026_09_10_0001" },
      { label: "Status", value: "failed" },
      { label: "Stage", value: "assign" },
      { label: "Reason code", value: "erp_timeout" },
      { label: "Started", value: "2026-09-10T04:00:00.000Z" },
      { label: "Ended", value: "2026-09-10T04:12:31.000Z" },
      { label: "Licensor", value: "Disney" },
      { label: "Property", value: "Mickey & Friends" },
      { label: "Error", value: "ERP lookup timed out after 3 retries" },
    ]);
  });

  it("omits optional fields the worker did not send", () => {
    const labels = buildAlertFields({ operation: "erp_classify", run_id: "r1", status: "failed", progress: {} })
      .map((f) => f.label);
    expect(labels).toEqual(["Operation", "Run ID", "Status"]);
  });
});

describe("buildAlertText", () => {
  it("puts the run id, error and timestamps in the body", () => {
    const text = buildAlertText(payload);
    expect(text).toContain("Run ID: run_2026_09_10_0001");
    expect(text).toContain("Error: ERP lookup timed out after 3 retries");
    expect(text).toContain("Ended: 2026-09-10T04:12:31.000Z");
    expect(text).toContain('"processed": 412');
  });
});

describe("buildAlertHtml", () => {
  it("escapes payload text so a hostile error string cannot inject markup", () => {
    const html = buildAlertHtml({ ...payload, error: '<img src=x onerror="alert(1)">' });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("escapes ampersands in scope values", () => {
    expect(buildAlertHtml(payload)).toContain("Mickey &amp; Friends");
  });

  it("renders without a progress block when progress is empty", () => {
    expect(buildAlertHtml({ operation: "x", run_id: "y", progress: {} })).not.toContain("Progress</h3>");
  });
});
