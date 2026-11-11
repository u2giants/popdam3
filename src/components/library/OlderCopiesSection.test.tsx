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
