import { describe, expect, it } from "vitest";
import { isInstallConfirmed, isStatusForRequest } from "./agent-update-confirmation";

const REQ = "2026-11-18T12:00:00.000Z";
const BEFORE = "2026-11-18T11:59:50.000Z";
const AFTER = "2026-11-18T12:00:30.000Z";

describe("isStatusForRequest", () => {
  it("rejects a result reported before the request", () => {
    expect(isStatusForRequest({ reported_at: BEFORE, agent_type: "bridge", update_available: false }, REQ)).toBe(false);
  });
  it("accepts a bridge result reported after the request", () => {
    expect(isStatusForRequest({ reported_at: AFTER, agent_type: "bridge" }, REQ)).toBe(true);
  });
  it("rejects a Windows renderer result", () => {
    expect(isStatusForRequest({ reported_at: AFTER, agent_type: "windows-render" }, REQ)).toBe(false);
  });
  it("rejects missing status", () => {
    expect(isStatusForRequest(null, REQ)).toBe(false);
  });
});

describe("isInstallConfirmed", () => {
  const base = { requestedAt: REQ, fromVersion: "1.0.0", fromSha: "old", targetVersion: "1.1.0", targetSha: "new" };
  it("rejects an online agent whose heartbeat predates the request", () => {
    expect(isInstallConfirmed({ status: "online", last_heartbeat: BEFORE, version_info: { version: "1.1.0", build_sha: "new" } }, base)).toBe(false);
  });
  it("rejects a fresh heartbeat still on the old build", () => {
    expect(isInstallConfirmed({ status: "online", last_heartbeat: AFTER, version_info: { version: "1.0.0", build_sha: "old" } }, base)).toBe(false);
  });
  it("confirms a fresh heartbeat on the target build", () => {
    expect(isInstallConfirmed({ status: "online", last_heartbeat: AFTER, version_info: { version: "1.1.0", build_sha: "new" } }, base)).toBe(true);
  });
  it("falls back to version change when no target is known", () => {
    const b = { ...base, targetVersion: null, targetSha: null, fromSha: null };
    expect(isInstallConfirmed({ status: "online", last_heartbeat: AFTER, version_info: { version: "1.2.0" } }, b)).toBe(true);
    expect(isInstallConfirmed({ status: "online", last_heartbeat: AFTER, version_info: { version: "1.0.0" } }, b)).toBe(false);
  });
  it("rejects offline agents", () => {
    expect(isInstallConfirmed({ status: "offline", last_heartbeat: AFTER, version_info: { build_sha: "new" } }, base)).toBe(false);
  });
});
