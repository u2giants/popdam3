import { act, render, waitFor } from "@testing-library/react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type GridApi, type IDatasource } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { navigateToOrderListMatch } from "@/lib/order-list-find-navigation";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { id: string };

describe("OrderList Find navigation with an infinite grid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("extends only the unknown extent and fetches a distant target in one bounded block", async () => {
    const requestedBlocks: Array<{ start: number; end: number }> = [];
    let api: GridApi<Row> | null = null;
    const datasource: IDatasource = {
      getRows: (params) => {
        requestedBlocks.push({ start: params.startRow, end: params.endRow });
        const rows = Array.from({ length: params.endRow - params.startRow }, (_, offset) => ({
          id: `row-${params.startRow + offset}`,
        }));
        params.successCallback(rows);
      },
    };

    render(
      <div style={{ height: 360, width: 720 }}>
        <AgGridReact<Row>
          theme={themeQuartz}
          rowModelType="infinite"
          datasource={datasource}
          cacheBlockSize={500}
          cacheOverflowSize={1}
          infiniteInitialRowCount={500}
          columnDefs={[{ field: "id" }]}
          pagination
          paginationPageSize={1500}
          paginationPageSizeSelector={[500, 1000, 1500]}
          getRowId={(params) => params.data.id}
          onGridReady={(event) => { api = event.api; }}
        />
      </div>,
    );

    await waitFor(() => expect(api).not.toBeNull());
    await waitFor(() => expect(api!.isLastRowIndexKnown()).toBe(false));
    const initialEstimate = api!.paginationGetRowCount();
    const targetIndex = 10_380;
    expect(initialEstimate).toBeLessThan(targetIndex);
    const initialRequests = requestedBlocks.length;

    act(() => navigateToOrderListMatch(api!, targetIndex));
    expect(api!.paginationGetRowCount()).toBeGreaterThan(targetIndex);

    await waitFor(() => {
      expect(requestedBlocks.some(({ start, end }) => start <= targetIndex && end > targetIndex)).toBe(true);
    });
    const navigationRequests = requestedBlocks.slice(initialRequests);
    expect(navigationRequests).toContainEqual({ start: 10_000, end: 10_500 });
    expect(navigationRequests.every(({ start, end }) => start >= 9_000 && end - start <= 500)).toBe(true);
    expect(api!.paginationGetCurrentPage()).toBe(Math.floor(targetIndex / 1500));
    expect(api!.getRowNode(`row-${targetIndex}`)?.data?.id).toBe(`row-${targetIndex}`);
    expect(api!.isLastRowIndexKnown()).toBe(false);
  });

  it("leaves the exact count untouched and does not reset a known last row", () => {
    const events: string[] = [];
    const api = {
      isLastRowIndexKnown: () => true,
      paginationGetRowCount: () => 10_900,
      paginationGetPageSize: () => 1500,
      setRowCount: vi.fn(() => events.push("setRowCount")),
      paginationGoToPage: vi.fn(() => events.push("goToPage")),
      ensureIndexVisible: vi.fn(() => events.push("ensureIndexVisible")),
    } as unknown as GridApi<Row>;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });

    navigateToOrderListMatch(api, 10_380);

    expect(api.setRowCount).not.toHaveBeenCalled();
    expect(events).toEqual(["goToPage", "ensureIndexVisible"]);
  });
});
