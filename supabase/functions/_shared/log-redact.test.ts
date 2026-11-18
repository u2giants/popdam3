import { describe, expect, it } from "vitest";
import { describeSubject, maskEmail, maskEmailsInText, summarizeProviderBody } from "./log-redact.ts";

describe("maskEmail", () => {
  it("keeps the first local-part character and the full domain", () => {
    expect(maskEmail("alice.smith@popcreations.com")).toBe("a***@popcreations.com");
  });

  it("handles missing and malformed input without throwing", () => {
    expect(maskEmail(undefined)).toBe("<none>");
    expect(maskEmail("")).toBe("<none>");
    expect(maskEmail("no-at-sign")).toBe("<masked>");
    expect(maskEmail("trailing@")).toBe("<masked>");
    expect(maskEmail("@nolocal.com")).toBe("<masked>");
  });
});

describe("maskEmailsInText", () => {
  it("masks every address inside free text", () => {
    const text = "Invalid recipient bob@x.io and carol.d+tag@studio.example.org";
    const masked = maskEmailsInText(text);
    expect(masked).toBe("Invalid recipient b***@x.io and c***@studio.example.org");
    expect(masked).not.toContain("bob@");
    expect(masked).not.toContain("carol.d");
  });

  it("leaves text without addresses unchanged", () => {
    expect(maskEmailsInText("HTTP 400 bad request")).toBe("HTTP 400 bad request");
  });
});

describe("describeSubject", () => {
  it("logs the subject length, never its text", () => {
    const line = describeSubject("You've been invited to PopDAM");
    expect(line).toBe("subject_chars=29");
    expect(line).not.toContain("invited");
  });

  it("reports zero for an empty or missing subject", () => {
    expect(describeSubject("")).toBe("subject_chars=0");
    expect(describeSubject(undefined)).toBe("subject_chars=0");
  });
});

describe("summarizeProviderBody", () => {
  it("keeps code and message from a JSON error body and masks addresses", () => {
    const raw = JSON.stringify({
      code: "invalid_parameter",
      message: "Invalid email for dana@brand.com",
    });
    expect(summarizeProviderBody(raw)).toBe(
      "code=invalid_parameter message=Invalid email for d***@brand.com",
    );
  });

  it("keeps messageId for successful responses", () => {
    expect(summarizeProviderBody(JSON.stringify({ messageId: "<abc@smtp-relay>" }))).toBe(
      "messageId=<abc@smtp-relay>",
    );
  });

  it("lists only key names for JSON without known fields", () => {
    expect(summarizeProviderBody(JSON.stringify({ to: "x@y.com", extra: 1 }))).toBe(
      "json_keys=to,extra",
    );
  });

  it("masks addresses in non-JSON bodies and truncates them", () => {
    const raw = `<html>${"a".repeat(300)} secret@corp.com</html>`;
    const summary = summarizeProviderBody(raw, 50);
    expect(summary.endsWith("...")).toBe(true);
    expect(summary.length).toBe(53);
    expect(summary).not.toContain("secret@");
    expect(summarizeProviderBody("oops secret@corp.com")).toBe("oops s***@corp.com");
  });
});
