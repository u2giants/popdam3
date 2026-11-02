import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

vi.mock("@/hooks/use-compact-chrome", () => ({ useCompactChrome: () => false }));
vi.mock("@/lib/image-similarity", () => ({ getImageSimEnabled: () => Promise.resolve(false) }));

import LibrarySearchError from "@/components/library/LibrarySearchError";
import LibraryTopBar from "@/components/library/LibraryTopBar";

const topBarProps: ComponentProps<typeof LibraryTopBar> = {
  search: "STYLE123", onSearchChange: vi.fn(), viewMode: "grid", onViewModeChange: vi.fn(),
  libraryMode: "groups", onLibraryModeChange: vi.fn(), sortField: "modified_at", onSortFieldChange: vi.fn(),
  sortDirection: "desc", onSortDirectionChange: vi.fn(), filtersOpen: false, onToggleFilters: vi.fn(),
  activeFilterCount: 0, totalCount: 0, totalAssets: 0, scanRunning: false, scanPending: false,
  onSync: vi.fn(), onStopScan: vi.fn(), onRefresh: vi.fn(), scanBlocked: false, scanBlockedReason: null,
  cardStyle: "gallery", onCardStyleChange: vi.fn(), groupCount: 0, fileCount: 0, canManageScan: false,
};

describe("library search failures", () => {
  it.each([true, false])("shows an accessible error and retries (search=%s)", (searching) => {
    const onRetry = vi.fn();
    render(<LibrarySearchError searching={searching} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent(searching
      ? "Search unavailable. Please try again." : "Library unavailable. Please try again.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each(["groups", "assets"] as const)("hides misleading zero counts after failure in %s mode", (libraryMode) => {
    render(<LibraryTopBar {...topBarProps} libraryMode={libraryMode} resultsUnavailable />);
    expect(screen.getByText("Results unavailable")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("hides numeric counts when only the count request fails", () => {
    render(<LibraryTopBar {...topBarProps} countsUnavailable />);
    expect(screen.getByText("Counts unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Results unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("prioritizes result failure over count failure", () => {
    render(<LibraryTopBar {...topBarProps} resultsUnavailable countsUnavailable />);
    expect(screen.getByText("Results unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Counts unavailable")).not.toBeInTheDocument();
  });

  it("preserves successful empty counts", () => {
    render(<LibraryTopBar {...topBarProps} />);
    expect(screen.queryByText("Results unavailable")).not.toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(2);
  });
});
