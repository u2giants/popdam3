import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readQueueFile, writeQueueFile, QueueUnreadableError } from "./queueStore";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "queue-store-"));
  path = join(dir, "upload-queue.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("queueStore", () => {
  it("returns an empty list when no queue exists", () => {
    expect(readQueueFile(path)).toEqual([]);
  });

  it("round-trips jobs and leaves no temp file", () => {
    writeQueueFile(path, [{ checkoutId: "a" }]);
    expect(readQueueFile(path)).toEqual([{ checkoutId: "a" }]);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("recovers pending jobs from backup after an interrupted (truncated) write", () => {
    writeQueueFile(path, [{ checkoutId: "a" }]);
    writeQueueFile(path, [{ checkoutId: "a" }, { checkoutId: "b" }]);
    writeFileSync(path, '[{"checkoutId": "a"}, {"check'); // simulated torn write
    const warnings: string[] = [];
    const jobs = readQueueFile<{ checkoutId: string }>(path, (m) => warnings.push(m));
    expect(jobs.map((j) => j.checkoutId)).toEqual(["a", "b"]);
    expect(warnings.length).toBe(1);
    expect(readdirSync(dir).some((f) => f.includes(".corrupt-"))).toBe(true);
  });

  it("restores from backup when the primary vanished mid-swap", () => {
    writeQueueFile(path, [{ checkoutId: "a" }]);
    writeQueueFile(path, [{ checkoutId: "b" }]);
    rmSync(path);
    expect(readQueueFile(path)).toEqual([{ checkoutId: "b" }]);
  });

  it("throws rather than reporting empty when unreadable with no backup", () => {
    writeFileSync(path, "");
    expect(() => readQueueFile(path)).toThrow(QueueUnreadableError);
  });

  it("never copies a corrupt primary into the backup", () => {
    writeQueueFile(path, [{ checkoutId: "a" }]);
    writeQueueFile(path, [{ checkoutId: "b" }]);
    writeFileSync(path, "{bad");
    expect(readQueueFile(path)).toEqual([{ checkoutId: "b" }]);
  });
});

describe("queueStore backup ordering", () => {
  it("backup equals latest written list after removal", () => {
    const d = mkdtempSync(join(tmpdir(), "queue-store-bak-"));
    const p = join(d, "upload-queue.json");
    writeQueueFile(p, [{ checkoutId: "a" }, { checkoutId: "b" }]);
    writeQueueFile(p, [{ checkoutId: "a" }]);
    writeFileSync(p, "[{\"check"); // torn write
    expect(readQueueFile(p)).toEqual([{ checkoutId: "a" }]);
    rmSync(d, { recursive: true, force: true });
  });
});
