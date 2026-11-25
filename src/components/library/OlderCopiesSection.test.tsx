import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const admin = { isAdmin: false };
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: admin.isAdmin, isRealAdmin: admin.isAdmin, isLoading: false }) }));
vi.mock("@/hooks/useAdminApi", () => ({ useAdminApi: () => ({ call: vi.fn() }) }));
vi.mock("@/hooks/useAgentStatus", () => ({ useAgentStatus: () => ({ bridgeStatus: "online" }) }));

import OlderCopiesSection from "./OlderCopiesSection";

describe("Older copies section (popdam3#963)", () => {
  it("does not render for a non-admin", () => {
    admin.isAdmin = false;
    const { container } = render(<OlderCopiesSection assetId="a" relativePath="x/y.psd" />);
    expect(container.innerHTML).toBe("");
  });
  it("renders the find button for an admin", () => {
    admin.isAdmin = true;
    render(<OlderCopiesSection assetId="a" relativePath="x/y.psd" />);
    expect(screen.getByText("Find older copies")).toBeTruthy();
  });
});

import { mergeVersions, type SnapshotVersion } from "./OlderCopiesSection";

const v = (path: string, first: string, last: string, mtime = "2025-09-22T18:14:00Z", size = 572_000): SnapshotVersion => ({
  source_path: path, size, mtime, first_snapshot: first, last_snapshot: last,
  first_taken_at: `${first}T12:00:00Z`, last_taken_at: `${last}T12:00:00Z`, snapshot_count: 1,
});

describe("mergeVersions", () => {
  it("treats a folder move of the same file as one version", () => {
    const out = mergeVersions([
      v("Old/Long Folder/a.psd", "2026-08-31", "2026-11-24"),
      v("New/a.psd", "2026-11-24", "2026-11-24"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].first_taken_at).toBe("2026-08-31T12:00:00Z");
    expect(out[0].source_path).toBe("New/a.psd");
    expect(out[0].folders).toEqual(["Old/Long Folder", "New"]);
  });
  it("keeps genuinely different saves apart", () => {
    const out = mergeVersions([
      v("a/x.psd", "2026-09-01", "2026-09-10", "2026-08-01T00:00:00Z"),
      v("a/x.psd", "2026-09-11", "2026-11-24", "2026-09-10T00:00:00Z"),
    ]);
    expect(out).toHaveLength(2);
  });
});
