import { describe, expect, it } from "vitest";
import {
  extractBearerToken,
  isServiceRoleToken,
  rolesGrantAdmin,
} from "../../supabase/functions/_shared/auth-policy.ts";

describe("extractBearerToken — strict mode (admin-api, erp-sync, helper-api)", () => {
  it("extracts the token after a literal 'Bearer ' prefix", () => {
    expect(extractBearerToken("Bearer abc", "strict")).toEqual({ kind: "token", token: "abc" });
  });

  it("is case-sensitive: 'bearer abc' is not a valid header in strict mode", () => {
    expect(extractBearerToken("bearer abc", "strict")).toEqual({ kind: "missing_header" });
  });

  it("treats a missing or non-Bearer header as missing_header", () => {
    expect(extractBearerToken(null, "strict")).toEqual({ kind: "missing_header" });
    expect(extractBearerToken("", "strict")).toEqual({ kind: "missing_header" });
    expect(extractBearerToken("abc", "strict")).toEqual({ kind: "missing_header" });
    expect(extractBearerToken("Basic abc", "strict")).toEqual({ kind: "missing_header" });
  });
});

describe("extractBearerToken — loose mode (the three exporters)", () => {
  it("accepts any capitalisation and extra whitespace", () => {
    expect(extractBearerToken("Bearer abc", "loose")).toEqual({ kind: "token", token: "abc" });
    expect(extractBearerToken("bearer abc", "loose")).toEqual({ kind: "token", token: "abc" });
    expect(extractBearerToken("Bearer   abc", "loose")).toEqual({ kind: "token", token: "abc" });
  });

  it("still rejects a non-Bearer scheme", () => {
    expect(extractBearerToken("Basic abc", "loose")).toEqual({ kind: "missing_header" });
    expect(extractBearerToken(null, "loose")).toEqual({ kind: "missing_header" });
  });
});

describe("extractBearerToken — empty token", () => {
  it("an empty bearer token is an invalid token, not a missing header", () => {
    // Callers map empty_token → reason "invalid_token" so admin-api keeps
    // answering "Invalid or expired token" for `Authorization: Bearer `.
    expect(extractBearerToken("Bearer ", "strict")).toEqual({ kind: "empty_token" });
    expect(extractBearerToken("Bearer ", "loose")).toEqual({ kind: "empty_token" });
  });
});

describe("isServiceRoleToken", () => {
  const key = "sk-service-role-key";

  it("is true only on an exact match", () => {
    expect(isServiceRoleToken(key, key)).toBe(true);
  });

  it("rejects a token that merely contains the service key", () => {
    expect(isServiceRoleToken(`x${key}y`, key)).toBe(false);
    expect(isServiceRoleToken(key.slice(0, -1), key)).toBe(false);
  });

  it("never authorises when the key is missing or empty", () => {
    expect(isServiceRoleToken(key, undefined)).toBe(false);
    expect(isServiceRoleToken(key, "")).toBe(false);
    expect(isServiceRoleToken("", "")).toBe(false);
    expect(isServiceRoleToken(null, key)).toBe(false);
  });
});

describe("rolesGrantAdmin", () => {
  it("is false with no rows or no admin row", () => {
    expect(rolesGrantAdmin(null)).toBe(false);
    expect(rolesGrantAdmin(undefined)).toBe(false);
    expect(rolesGrantAdmin([])).toBe(false);
    expect(rolesGrantAdmin([{ role: "user" }])).toBe(false);
  });

  it("is true for a single admin row", () => {
    expect(rolesGrantAdmin([{ role: "admin" }])).toBe(true);
  });

  it("a user holding both 'user' and 'admin' is an admin", () => {
    // Regression guard for the helper-api bug: `.single()` errored on the
    // second row and the admin was denied with 403 "Admin only".
    expect(rolesGrantAdmin([{ role: "user" }, { role: "admin" }])).toBe(true);
    expect(rolesGrantAdmin([{ role: "admin" }, { role: "user" }])).toBe(true);
  });
});
