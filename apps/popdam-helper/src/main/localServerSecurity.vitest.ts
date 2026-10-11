import { describe, expect, it } from "vitest";
import { join, resolve } from "path";
import {
  isAllowedHost,
  isAllowedOrigin,
  resolveWithinRoot,
  tokensMatch,
} from "./localServerSecurity";

describe("isAllowedHost (DNS rebinding guard)", () => {
  it("accepts loopback names on the helper port", () => {
    expect(isAllowedHost("127.0.0.1:47380", 47380)).toBe(true);
    expect(isAllowedHost("localhost:47380", 47380)).toBe(true);
    expect(isAllowedHost("LOCALHOST:47380", 47380)).toBe(true);
  });
  it("rejects rebound or foreign hosts", () => {
    expect(isAllowedHost("evil.example:47380", 47380)).toBe(false);
    expect(isAllowedHost("localhost", 47380)).toBe(false);
    expect(isAllowedHost("localhost:8080", 47380)).toBe(false);
    expect(isAllowedHost("127.0.0.1.evil.example:47380", 47380)).toBe(false);
    expect(isAllowedHost(undefined, 47380)).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("accepts only the real app origins", () => {
    expect(isAllowedOrigin("https://dam.designflow.app")).toBe(true);
    expect(isAllowedOrigin("https://sg.designflow.app")).toBe(true);
    expect(isAllowedOrigin("http://localhost:8080")).toBe(true);
  });
  it("rejects other localhost ports, other subdomains, and missing origin", () => {
    expect(isAllowedOrigin("http://localhost:3000")).toBe(false);
    expect(isAllowedOrigin("http://localhost")).toBe(false);
    expect(isAllowedOrigin("https://evil.designflow.app")).toBe(false);
    expect(isAllowedOrigin("http://dam.designflow.app")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
  });
});

describe("tokensMatch", () => {
  it("requires an exact non-empty match", () => {
    expect(tokensMatch("abc123", "abc123")).toBe(true);
    expect(tokensMatch("abc123", "abc124")).toBe(false);
    expect(tokensMatch("abc123", "abc")).toBe(false);
    expect(tokensMatch("abc123", undefined)).toBe(false);
    expect(tokensMatch("", "")).toBe(false);
  });
});

describe("resolveWithinRoot", () => {
  const root = resolve("/srv/roots/art");
  it("resolves paths inside the root", () => {
    expect(resolveWithinRoot(root, "")).toBe(root);
    expect(resolveWithinRoot(root, "a/b")).toBe(join(root, "a", "b"));
    expect(resolveWithinRoot(root, "a/../b")).toBe(join(root, "b"));
  });
  it("rejects traversal and absolute escapes", () => {
    expect(resolveWithinRoot(root, "..")).toBeNull();
    expect(resolveWithinRoot(root, "../other")).toBeNull();
    expect(resolveWithinRoot(root, "a/../../..")).toBeNull();
    expect(resolveWithinRoot(root, "/etc")).toBeNull();
  });
});
