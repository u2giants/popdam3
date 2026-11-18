import { describe, expect, it } from "vitest";
import { confirmedCheckinStatus } from "./checkinConfirmation";

describe("confirmedCheckinStatus", () => {
  it("accepts confirmed complete and verifying saves", () => {
    expect(confirmedCheckinStatus({ ok: true, status: "complete" })).toBe("complete");
    expect(confirmedCheckinStatus({ ok: true, status: "verifying" })).toBe("verifying");
  });

  it("throws (keeps the retry) on failed or ambiguous responses", () => {
    for (const r of [{ ok: false, error: "x" }, { ok: true }, { ok: true, status: "queued" }, {}, null, undefined, "ok"]) {
      expect(() => confirmedCheckinStatus(r)).toThrow(/not confirmed/);
    }
  });
});
