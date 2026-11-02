import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pageTotal: undefined as number | undefined,
  headTotal: 10,
  countHook: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/dam-search", () => ({ searchAccessStatus: () => null }));
vi.mock("@/hooks/useStyleGroups", () => ({
  useStyleGroups: () => ({ data: state.pageTotal === undefined ? undefined : { groups: [], totalCount: state.pageTotal } }),
  useStyleGroupCount: (...args: unknown[]) => { state.countHook(...args); return { data: state.headTotal }; },
  useUngroupedCount: () => ({ data: 0 }),
  useTotalAssetCount: () => ({ data: 100 }),
  useStyleGroupAssetCount: () => ({ data: 0 }),
}));
vi.mock("@/hooks/useAssets", () => ({
  useAssets: () => ({}), useFilterOptions: () => ({ licensors: [], properties: [] }),
  useFilterCounts: () => ({}), useVisibilityDate: () => ({}), usePathFacets: () => ({}),
  useProductMaterials: () => ({}), isDamAccessDenied: () => false,
}));
vi.mock("@/hooks/useDamCustomers", () => ({ useDamCustomerFacets: () => ({}) }));
vi.mock("@/hooks/useAgentStatus", () => ({ useAgentStatus: () => ({}) }));
vi.mock("@/hooks/useScanProgress", () => ({ useScanProgress: () => ({}) }));
vi.mock("@/hooks/useScanLifecycle", () => ({ useScanLifecycle: () => ({}) }));
vi.mock("@/hooks/useSelectionManager", () => ({ useSelectionManager: () => ({ selectedIds: new Set(), clearSelection: vi.fn() }) }));
vi.mock("@/hooks/useResizablePanel", () => ({ useResizablePanel: () => ({}) }));
vi.mock("@/hooks/use-media-query", () => ({ useMediaQuery: () => false }));
vi.mock("@/hooks/use-compact-chrome", () => ({ useCompactChrome: () => false }));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/components/library/LibraryTopBar", () => ({ default: (props: { totalCount: number; groupCount: number; onSearchChange: (s: string) => void }) => (
  <><input aria-label="Search" onChange={event => props.onSearchChange(event.target.value)} />
    <span data-testid="header-total">{props.totalCount}</span><span data-testid="group-total">{props.groupCount}</span></>
) }));
vi.mock("@/components/library/PaginationBar", () => ({ default: (props: { totalCount: number }) => <span data-testid="pagination-total">{props.totalCount}</span> }));
vi.mock("@/components/library/StyleGroupGrid", () => ({ default: () => null }));
vi.mock("@/components/library/StyleGroupListView", () => ({ default: () => null }));
vi.mock("@/components/library/StyleGroupDetailPanel", () => ({ default: () => null }));
vi.mock("@/components/library/AssetGrid", () => ({ default: () => null }));
vi.mock("@/components/library/AssetListView", () => ({ default: () => null }));
vi.mock("@/components/library/AssetDetailPanel", () => ({ default: () => null }));
vi.mock("@/components/library/BulkActionBar", () => ({ default: () => null }));
vi.mock("@/components/library/FilterSidebar", () => ({ default: () => null }));
vi.mock("@/components/library/SearchAccessNotice", () => ({ default: () => null }));

import LibraryPage from "@/pages/Index";

function expectTotals(total: number) {
  for (const surface of ["header-total", "group-total", "pagination-total"]) {
    expect(screen.getByTestId(surface).textContent).toBe(String(total));
  }
}
function search(text: string) {
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: text } });
  act(() => { vi.advanceTimersByTime(300); });
}

describe("library group totals", () => {
  beforeEach(() => { vi.useFakeTimers(); state.pageTotal = undefined; state.headTotal = 10; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("uses the 15-group search page across every surface despite a cached 10-group probe", () => {
    state.pageTotal = 15;
    render(<LibraryPage />);
    search("spiderman coir");
    expectTotals(15);
    expect(state.countHook).toHaveBeenLastCalledWith(expect.objectContaining({ search: "spiderman coir" }), undefined, false);
  });

  it("uses keyword result totals and preserves zero instead of a cached probe", () => {
    state.pageTotal = 154;
    const view = render(<LibraryPage />);
    search("spiderman coir");
    expectTotals(154);
    state.pageTotal = 0;
    view.rerender(<LibraryPage />);
    expectTotals(0);
  });

  it("retains the head-count fallback and count query before nonsearch results arrive", () => {
    render(<LibraryPage />);
    expectTotals(10);
    expect(state.countHook).toHaveBeenLastCalledWith(expect.objectContaining({ search: "" }), undefined, true);
  });
});
