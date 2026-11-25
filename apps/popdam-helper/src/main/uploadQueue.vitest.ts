import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let dir = "";
vi.mock("electron", () => ({ app: { getPath: () => dir } }));
vi.mock("./logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("./credentials", () => ({ loadToken: () => null }));
vi.mock("./synologyClient", () => ({ uploadFile: vi.fn() }));
vi.mock("./damClient", () => ({ completeCheckin: vi.fn(), redriveComplete: vi.fn() }));
vi.mock("./config", () => ({ getConfig: () => ({ rootMappings: [] }) }));
vi.mock("./fileOps", () => ({ copySnapshotToManagedPath: vi.fn() }));
vi.mock("./hash", () => ({ sha256File: vi.fn(), quickHashFile: vi.fn() }));

const GARBAGE = '[{"checkoutId": "a", "sta';

async function load() {
  vi.resetModules();
  const q = await import("./uploadQueue");
  q.initQueue();
  return q;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "upload-queue-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("uploadQueue with an unreadable list and no backup", () => {
  it("processQueue resolves instead of rejecting and reports the error", async () => {
    writeFileSync(join(dir, "upload-queue.json"), GARBAGE);
    const q = await load();
    const cb = vi.fn();
    q.setQueueErrorCallback(cb);
    await expect(q.processQueue()).resolves.toBeUndefined();
    expect(q.getQueueError()).toBe(q.QUEUE_UNREADABLE_MESSAGE);
  });

  it("getPendingJobs returns [] and health reports not ok", async () => {
    writeFileSync(join(dir, "upload-queue.json"), GARBAGE);
    const q = await load();
    expect(q.getPendingJobs()).toEqual([]);
    expect(q.getQueueHealth().ok).toBe(false);
  });

  it("enqueue throws and leaves the damaged file byte-identical", async () => {
    const p = join(dir, "upload-queue.json");
    writeFileSync(p, GARBAGE);
    const q = await load();
    expect(() => q.enqueue({ checkoutId: "b" } as never)).toThrow();
    expect(readFileSync(p, "utf-8")).toBe(GARBAGE);
  });

  it("repairQueue keeps the damaged copy aside and starts an empty list", async () => {
    const p = join(dir, "upload-queue.json");
    writeFileSync(p, GARBAGE);
    const q = await load();
    const aside = q.repairQueue();
    expect(aside).toMatch(/upload-queue\.json\.corrupt-\d+$/);
    expect(readFileSync(aside!, "utf-8")).toBe(GARBAGE);
    expect(JSON.parse(readFileSync(p, "utf-8"))).toEqual([]);
    expect(q.getQueueError()).toBeNull();
    expect(q.getQueueHealth().ok).toBe(true);
  });
});

describe("uploadQueue with a torn write and a backup", () => {
  it("restores the pending job from backup and keeps a .corrupt copy", async () => {
    const p = join(dir, "upload-queue.json");
    const job = { checkoutId: "a", status: "pending", retryCount: 0, lastAttempt: null };
    writeFileSync(p, JSON.stringify([job]));
    writeFileSync(`${p}.bak`, JSON.stringify([job]));
    writeFileSync(p, GARBAGE);
    const q = await load();
    expect(q.getPendingJobs()).toEqual([{ checkoutId: "a", status: "pending", retryCount: 0 }]);
    expect(readdirSync(dir).some((f) => f.includes(".corrupt-"))).toBe(true);
    expect(q.getQueueError()).toBeNull();
  });
});
