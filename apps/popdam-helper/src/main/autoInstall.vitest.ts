import { describe, it, expect, vi } from "vitest";
import { createAutoInstaller, hasOutstandingCheckouts } from "./autoInstall";

describe("hasOutstandingCheckouts", () => {
  it("ignores complete and discarded", () => {
    expect(hasOutstandingCheckouts([{ status: "complete" }, { status: "discarded" }])).toBe(false);
    expect(hasOutstandingCheckouts([{ status: "active" }])).toBe(true);
    expect(hasOutstandingCheckouts([{ status: "uploading" }])).toBe(true);
  });
});

describe("createAutoInstaller", () => {
  function setup(checkouts: { status: string }[]) {
    const install = vi.fn();
    const ai = createAutoInstaller({ getCheckouts: () => checkouts, install, log: () => {} });
    return { ai, install, checkouts };
  }

  it("installs immediately when nothing is checked out", () => {
    const { ai, install } = setup([]);
    expect(ai.onUpdateDownloaded("1.4.24")).toBe(true);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("waits for checkouts, then installs once they finish", () => {
    const { ai, install, checkouts } = setup([{ status: "active" }]);
    expect(ai.onUpdateDownloaded("1.4.24")).toBe(false);
    expect(install).not.toHaveBeenCalled();
    checkouts[0].status = "complete";
    expect(ai.onCheckoutsChanged()).toBe(true);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("does nothing on checkout changes before a download", () => {
    const { ai, install } = setup([]);
    expect(ai.onCheckoutsChanged()).toBe(false);
    expect(install).not.toHaveBeenCalled();
  });

  it("installs only once", () => {
    const { ai, install } = setup([]);
    ai.onUpdateDownloaded("1.4.24");
    ai.onCheckoutsChanged();
    ai.onUpdateDownloaded("1.4.24");
    expect(install).toHaveBeenCalledTimes(1);
  });
});
