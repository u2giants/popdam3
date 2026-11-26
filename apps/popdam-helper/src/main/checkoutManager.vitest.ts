import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareCheckin = vi.fn();
const requeueFailed = vi.fn();
const hasJob = vi.fn();
const enqueue = vi.fn();
let serverStatus = "checkin_queued";

vi.mock("electron", () => ({ shell: { openPath: vi.fn(), showItemInFolder: vi.fn() } }));
vi.mock("chokidar", () => ({ default: { watch: vi.fn() } }));
vi.mock("./logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("./fileOps", () => ({
  resolveAssetPath: vi.fn(), copyToWorkspace: vi.fn(), writeCheckoutMeta: vi.fn(),
  waitForFileStable: vi.fn(), createSnapshot: vi.fn(), checkoutDir: vi.fn(),
}));
vi.mock("./hash", () => ({ sha256File: vi.fn() }));
vi.mock("./damClient", () => ({
  startCheckout: vi.fn(), prepareCheckin, discardCheckout: vi.fn(), redrive: vi.fn(),
  getOpenCheckouts: async () => ({
    checkouts: [{ id: "co1", status: serverStatus, checked_out_at: new Date().toISOString(),
      source_hash: "h", source_size: 1, assets: { id: "a", filename: "f.ai", relative_path: "x/f.ai" } }],
  }),
}));
vi.mock("./uploadQueue", () => ({ enqueue, getQueueHealth: () => ({ ok: true }), requeueFailed, hasJob }));
vi.mock("./config", () => ({ getConfig: () => ({ workspacePath: "C:/nowhere-ws", rootMappings: [], preferredProvider: "synology" }) }));
vi.mock("./rootValidator", () => ({ validateRoot: vi.fn() }));
vi.mock("./seafileAdapter", () => ({
  detectSeaDriveRootAsync: vi.fn(), getSeafileHealthAsync: vi.fn(), resolveSeafileTarget: vi.fn(),
  ensureHydrated: vi.fn(), getSeafileObjId: vi.fn(),
}));

async function load() {
  vi.resetModules();
  const m = await import("./checkoutManager");
  await m.loadActiveCheckouts();
  return m;
}

beforeEach(() => {
  vi.clearAllMocks();
  serverStatus = "checkin_queued";
});

describe("checkin retry of a failed upload (#1401)", () => {
  it("re-queues the failed job instead of calling prepare-checkin", async () => {
    requeueFailed.mockReturnValue(["co1"]);
    const m = await load();
    await m.checkin("co1");
    expect(requeueFailed).toHaveBeenCalledWith("co1");
    expect(prepareCheckin).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(m.getActiveCheckouts()[0].status).toBe("uploading");
  });

  it("does not call prepare-checkin when the server is checkin_queued and a job exists", async () => {
    requeueFailed.mockReturnValue([]);
    hasJob.mockReturnValue(true);
    const m = await load();
    await m.checkin("co1");
    expect(prepareCheckin).not.toHaveBeenCalled();
    expect(m.getActiveCheckouts()[0].status).toBe("uploading");
  });

  it("keeps a queued checkout with a missing job actionable across repeated clicks", async () => {
    requeueFailed.mockReturnValue([]);
    hasJob.mockReturnValue(false);
    const m = await load();
    await expect(m.checkin("co1")).rejects.toThrow(/upload list lost/);
    await expect(m.checkin("co1")).rejects.toThrow(/upload list lost/);
    expect(m.getActiveCheckouts()[0]).toMatchObject({ status: "error", errorMessage: expect.stringContaining("discard") });
    expect(prepareCheckin).not.toHaveBeenCalled();
  });

  it("retryFailedUploads moves re-queued checkouts back to uploading and clears the error", async () => {
    requeueFailed.mockReturnValue(["co1"]);
    const m = await load();
    m.markUploadFailed("co1", "boom");
    expect(m.retryFailedUploads()).toBe(1);
    const rec = m.getActiveCheckouts()[0];
    expect(rec.status).toBe("uploading");
    expect(rec.errorMessage).toBeNull();
  });
});
