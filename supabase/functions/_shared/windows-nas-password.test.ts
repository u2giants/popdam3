import { describe, expect, it } from "vitest";
import { pickWindowsNasPassword } from "./windows-nas-password.ts";

describe("pickWindowsNasPassword", () => {
  it("uses the Vault value when it is non-empty", () => {
    expect(pickWindowsNasPassword("vault-pw", "row-pw")).toBe("vault-pw");
  });
  it("keeps the admin_config fallback when Vault is empty", () => {
    expect(pickWindowsNasPassword("", "row-pw")).toBe("row-pw");
  });
  it("keeps the admin_config fallback when the RPC returned null", () => {
    expect(pickWindowsNasPassword(null, "row-pw")).toBe("row-pw");
  });
  it("returns empty when neither source has a value", () => {
    expect(pickWindowsNasPassword(undefined, undefined)).toBe("");
  });
});
