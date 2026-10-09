import { act, render, waitFor } from "@testing-library/react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type GridApi, type IDatasource } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { describe, expect, it } from "vitest";

import { refreshOrderListRows } from "@/lib/order-list-grid-refresh";
import { navigateToOrderListMatch } from "@/lib/order-list-find-navigation";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { id: string; revision: number };

function rowsFor(start: number, end: number, revision: number): Row[] {
  return Array.from({ length: end - start }, (_, offset) => ({ id: `row-${start + offset}`, revision }));
}

function renderInfiniteGrid(
  datasource: IDatasource,
  onReady: (api: GridApi<Row>) => void,
  options: { selectRows?: boolean; showRevision?: boolean } = {},
) {
  return render(
    <div style={{ height: 360, width: 720 }}>
      <AgGridReact<Row>
        theme={themeQuartz}
        rowModelType="infinite"
        datasource={datasource}
        cacheBlockSize={500}
        cacheOverflowSize={1}
        maxBlocksInCache={20}
        infiniteInitialRowCount={500}
        columnDefs={options.showRevision === false ? [{ field: "id" }] : [{ field: "id" }, { field: "revision" }]}
        pagination
        paginationPageSize={1500}
        paginationPageSizeSelector={[500, 1000, 1500]}
        rowSelection={options.selectRows === false ? undefined : { mode: "multiRow", checkboxes: true, headerCheckbox: false }}
        getRowId={(params) => params.data.id}
        onGridReady={(event) => onReady(event.api)}
      />
    </div>,
  );
}

async function navigateAndWait(api: GridApi<Row>, index: number) {
  act(() => navigateToOrderListMatch(api, index));
  await waitFor(() => expect(api.getRowNode(`row-${index}`)?.data?.id).toBe(`row-${index}`));
}

async function navigateFindSequence(api: GridApi<Row>) {
  for (const index of [0, 20_438, 1_403, 1_403, 12_121]) {
    await navigateAndWait(api, index);
  }
}

describe("OrderList grid refresh", () => {
  it("re-reads a fresh distant block through the same helper used by the Orders page", async () => {
    const requests: Array<{ start: number; end: number }> = [];
    let revision = 1;
    let api: GridApi<Row> | null = null;
    const datasource: IDatasource = {
      getRows: async (params) => {
        requests.push({ start: params.startRow, end: params.endRow });
        const rows = rowsFor(params.startRow, params.endRow, revision);
        await Promise.resolve();
        params.successCallback(rows);
      },
    };
    renderInfiniteGrid(datasource, (value) => { api = value; }, { selectRows: false, showRevision: false });

    await waitFor(() => expect(api).not.toBeNull());
    await navigateFindSequence(api!);
    await navigateAndWait(api!, 10_380);
    const requestsBefore = requests.length;
    revision = 2;

    act(() => refreshOrderListRows(api));

    await waitFor(() => expect(api!.getRowNode("row-10380")?.data?.revision).toBe(2));
    expect(document.querySelector('[row-id="row-10380"]')).not.toBeNull();
    expect(requests.slice(requestsBefore)).toEqual([{ start: 10_000, end: 10_500 }]);
  });

  it("reloads a completed distant block with fresh data and preserves grid state", async () => {
    const requests: Array<{ start: number; end: number }> = [];
    let revision = 1;
    let api: GridApi<Row> | null = null;
    const datasource: IDatasource = {
      getRows: async (params) => {
        requests.push({ start: params.startRow, end: params.endRow });
        const rows = rowsFor(params.startRow, params.endRow, revision);
        await Promise.resolve();
        params.successCallback(rows);
      },
    };
    renderInfiniteGrid(datasource, (value) => { api = value; });

    await waitFor(() => expect(api).not.toBeNull());
    await navigateFindSequence(api!);
    await navigateAndWait(api!, 10_380);
    api!.getRowNode("row-10380")?.setSelected(true);

    const rowCountBefore = api!.paginationGetRowCount();
    const endKnownBefore = api!.isLastRowIndexKnown();
    const pageBefore = api!.paginationGetCurrentPage();
    const selectedBefore = api!.getSelectedRows().map((row) => row.id);
    expect(selectedBefore).toEqual(["row-10380"]);
    const requestsBefore = requests.length;
    revision = 2;

    act(() => refreshOrderListRows(api));

    await waitFor(() => expect(api!.getRowNode("row-10380")?.data?.revision).toBe(2));
    expect(document.querySelector('[row-id="row-10380"]')).not.toBeNull();
    expect(requests.slice(requestsBefore)).toEqual([{ start: 10_000, end: 10_500 }]);
    expect(api!.paginationGetRowCount()).toBe(rowCountBefore);
    expect(api!.isLastRowIndexKnown()).toBe(endKnownBefore);
    expect(api!.paginationGetCurrentPage()).toBe(pageBefore);
    expect(api!.getSelectedRows().map((row) => row.id)).toEqual(selectedBefore);
  });

  it("ignores a late pre-purge block callback and keeps the refreshed block visible", async () => {
    const requests: Array<{ start: number; end: number }> = [];
    const lateResponse: Array<() => void> = [];
    let revision = 1;
    let api: GridApi<Row> | null = null;
    const datasource: IDatasource = {
      getRows: async (params) => {
        const { startRow, endRow } = params;
        requests.push({ start: startRow, end: endRow });
        const rows = rowsFor(startRow, endRow, revision);
        if (startRow === 10_000 && lateResponse.length === 0) {
          lateResponse.push(() => params.successCallback(rows));
        } else {
          await Promise.resolve();
          params.successCallback(rows);
        }
      },
    };
    renderInfiniteGrid(datasource, (value) => { api = value; });

    await waitFor(() => expect(api).not.toBeNull());
    await navigateFindSequence(api!);
    act(() => navigateToOrderListMatch(api!, 10_380));
    await waitFor(() => expect(lateResponse).toHaveLength(1));
    await waitFor(() => expect(requests.some(({ start }) => start === 10_000)).toBe(true));

    api!.getRowNode("row-12121")?.setSelected(true);
    const rowCountBefore = api!.paginationGetRowCount();
    const endKnownBefore = api!.isLastRowIndexKnown();
    const pageBefore = api!.paginationGetCurrentPage();
    const selectedBefore = api!.getSelectedRows().map((row) => row.id);
    expect(selectedBefore).toEqual(["row-12121"]);
    const cachedStartsBefore = Object.keys(api!.getCacheBlockState()).map(Number).sort((a, b) => a - b).map((block) => block * 500);
    const requestsBefore = requests.length;
    revision = 2;

    act(() => refreshOrderListRows(api));
    await waitFor(() => expect(requests.filter(({ start }) => start === 10_000).length).toBe(2));
    await waitFor(() => expect(api!.getRowNode("row-10380")?.data?.revision).toBe(2));

    act(() => lateResponse.shift()?.());
    await waitFor(() => expect(api!.getRowNode("row-10380")?.data?.revision).toBe(2));

    expect(document.querySelector('[row-id="row-10380"]')).not.toBeNull();
    expect(requests.slice(requestsBefore)).toEqual([{ start: 10_000, end: 10_500 }]);
    expect(cachedStartsBefore).toContain(10_000);
    expect(api!.paginationGetRowCount()).toBe(rowCountBefore);
    expect(api!.isLastRowIndexKnown()).toBe(endKnownBefore);
    expect(api!.paginationGetCurrentPage()).toBe(pageBefore);
    expect(api!.getSelectedRows().map((row) => row.id)).toEqual(selectedBefore);
  });

  it("preserves an exact short-block end and refreshes the terminal row beyond the initial estimate", async () => {
    const totalRows = 10_381;
    const requests: Array<{ start: number; end: number }> = [];
    let revision = 1;
    let api: GridApi<Row> | null = null;
    const datasource: IDatasource = {
      getRows: async (params) => {
        const { startRow, endRow } = params;
        requests.push({ start: startRow, end: endRow });
        const end = Math.min(endRow, totalRows);
        const rows = rowsFor(startRow, end, revision);
        await Promise.resolve();
        params.successCallback(rows, rows.length < endRow - startRow ? end : undefined);
      },
    };
    renderInfiniteGrid(datasource, (value) => { api = value; });

    await waitFor(() => expect(api).not.toBeNull());
    await navigateAndWait(api!, totalRows - 1);
    await waitFor(() => expect(api!.isLastRowIndexKnown()).toBe(true));
    api!.getRowNode("row-10380")?.setSelected(true);

    const rowCountBefore = api!.paginationGetRowCount();
    const pageBefore = api!.paginationGetCurrentPage();
    const selectedBefore = api!.getSelectedRows().map((row) => row.id);
    expect(rowCountBefore).toBe(totalRows);
    expect(selectedBefore).toEqual(["row-10380"]);
    const requestsBefore = requests.length;
    revision = 2;

    act(() => refreshOrderListRows(api));

    await waitFor(() => expect(api!.getRowNode("row-10380")?.data?.revision).toBe(2));
    expect(document.querySelector('[row-id="row-10380"]')).not.toBeNull();
    expect(requests.slice(requestsBefore)).toEqual([{ start: 10_000, end: 10_500 }]);
    expect(api!.paginationGetRowCount()).toBe(totalRows);
    expect(api!.isLastRowIndexKnown()).toBe(true);
    expect(api!.paginationGetCurrentPage()).toBe(pageBefore);
    expect(api!.getSelectedRows().map((row) => row.id)).toEqual(selectedBefore);
  });
});
