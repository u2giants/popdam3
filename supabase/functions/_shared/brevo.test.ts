import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendBrevoEmail } from "./brevo.ts";

const RECIPIENT = "dana.recipient@popcreations.com";
const SUBJECT = "Confidential licensing deadline for Mickey Mouse 2027";
const PROVIDER_ECHO = JSON.stringify({
  code: "invalid_parameter",
  message: `Recipient ${RECIPIENT} rejected`,
});

function callsAsText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
}

describe("sendBrevoEmail logging", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("Deno", {
      env: { get: (name: string) => (name === "BREVO_API_KEY" ? "test-key" : undefined) },
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetch(status: number, body: string) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status })));
  }

  function allLogs(): string {
    return [callsAsText(logSpy), callsAsText(errorSpy), callsAsText(warnSpy)].join("\n");
  }

  it("does not log the recipient or subject on a successful send", async () => {
    stubFetch(201, JSON.stringify({ messageId: "<msg-1@smtp-relay>" }));

    const result = await sendBrevoEmail({ to: RECIPIENT, subject: SUBJECT, htmlContent: "<p>hi</p>" });

    expect(result).toMatchObject({ ok: true, messageId: "<msg-1@smtp-relay>", httpStatus: 201 });
    const logs = allLogs();
    expect(logs).not.toContain(RECIPIENT);
    expect(logs).not.toContain("dana.recipient");
    expect(logs).not.toContain("Mickey Mouse");
    expect(logs).toContain("to=d***@popcreations.com");
    expect(logs).toContain(`subject_chars=${SUBJECT.length}`);
    expect(logs).toContain("messageId=<msg-1@smtp-relay>");
  });

  it("masks the recipient echoed in a provider error and keeps the status", async () => {
    stubFetch(400, PROVIDER_ECHO);

    const result = await sendBrevoEmail({ to: RECIPIENT, subject: SUBJECT, htmlContent: "<p>hi</p>" });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toContain("[400]");
    expect(result.error).toContain("code=invalid_parameter");
    expect(result.error).not.toContain(RECIPIENT);
    expect(result.rawBody).not.toContain(RECIPIENT);
    expect(allLogs()).not.toContain(RECIPIENT);
    expect(allLogs()).not.toContain("Mickey Mouse");
    expect(allLogs()).toContain("[brevo] API error [400]");
  });

  it("does not log a full raw body when Brevo returns no messageId", async () => {
    stubFetch(202, JSON.stringify({ note: `queued for ${RECIPIENT}`, body: SUBJECT }));

    const result = await sendBrevoEmail({ to: RECIPIENT, subject: SUBJECT, htmlContent: "<p>hi</p>" });

    expect(result.ok).toBe(true);
    expect(result.warning).toContain("no messageId");
    expect(allLogs()).not.toContain(RECIPIENT);
    expect(allLogs()).not.toContain("Mickey Mouse");
    expect(result.rawBody).not.toContain(RECIPIENT);
  });

  it("masks addresses in a network failure message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`socket reset while sending to ${RECIPIENT}`);
      }),
    );

    const result = await sendBrevoEmail({ to: RECIPIENT, subject: SUBJECT, htmlContent: "<p>hi</p>" });

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(RECIPIENT);
    expect(allLogs()).not.toContain(RECIPIENT);
    expect(allLogs()).toContain("Network error");
  });

  it("reports missing configuration without touching the network", async () => {
    vi.stubGlobal("Deno", { env: { get: () => undefined } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendBrevoEmail({ to: RECIPIENT, subject: SUBJECT, htmlContent: "<p>hi</p>" });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
