import { act, fireEvent, render, waitFor } from "@testing-library/react";
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
  options: { selectRows?: boolean; showRevision?: boolean; editable?: boolean; onCellValueChanged?: (event: { data: Row; newValue: string }) => void } = {},
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
        columnDefs={options.showRevision === false ? [{ field: "id" }] : [{ field: "id" }, { field: "revision", editable: options.editable }]}
        pagination
        paginationPageSize={1500}
        paginationPageSizeSelector={[500, 1000, 1500]}
        rowSelection={options.selectRows === false ? undefined : { mode: "multiRow", checkboxes: true, headerCheckbox: false }}
        getRowId={(params) => params.data.id}
        onCellValueChanged={options.onCellValueChanged}
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
    await waitFor(() => expect(document.querySelector('[row-id="row-10380"]')).not.toBeNull());
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
    await waitFor(() => expect(document.querySelector('[row-id="row-10380"]')).not.toBeNull());
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

    await waitFor(() => expect(document.querySelector('[row-id="row-10380"]')).not.toBeNull());
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
    await waitFor(() => expect(document.querySelector('[row-id="row-10380"]')).not.toBeNull());
    expect(requests.slice(requestsBefore)).toEqual([{ start: 10_000, end: 10_500 }]);
    expect(api!.paginationGetRowCount()).toBe(totalRows);
    expect(api!.isLastRowIndexKnown()).toBe(true);
    expect(api!.paginationGetCurrentPage()).toBe(pageBefore);
    expect(api!.getSelectedRows().map((row) => row.id)).toEqual(selectedBefore);
  });

  it("defers repeated refresh requests during an edit and refreshes once after cancellation", async () => {
    const requests: Array<{ start: number; end: number }> = [];
    const changes: unknown[] = [];
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
    renderInfiniteGrid(datasource, (value) => { api = value; }, {
      editable: true,
      onCellValueChanged: (event) => changes.push(event),
    });

    await waitFor(() => expect(api).not.toBeNull());
    await navigateAndWait(api!, 10_380);
    api!.getRowNode("row-10380")?.setSelected(true);
    const countBefore = api!.paginationGetRowCount();
    const pageBefore = api!.paginationGetCurrentPage();
    const selectedBefore = api!.getSelectedRows().map((row) => row.id);
    const requestsBefore = requests.length;
    revision = 2;
    act(() => api!.startEditingCell({ rowIndex: 10_380, colKey: "revision" }));
    const editor = document.querySelector<HTMLInputElement>(".ag-cell-inline-editing input");
    expect(editor).not.toBeNull();
    fireEvent.change(editor!, { target: { value: "99" } });
    fireEvent.input(editor!, { target: { value: "99" } });

    act(() => {
      refreshOrderListRows(api);
      refreshOrderListRows(api);
      refreshOrderListRows(api);
    });
    expect(editor!.value).toBe("99");
    expect(api!.getEditingCells()).toHaveLength(1);
    expect(requests).toHaveLength(requestsBefore);
    expect(changes).toHaveLength(0);

    act(() => api!.stopEditing(true));
    await waitFor(() => expect(api!.getRowNode("row-10380")?.data?.revision).toBe(2));
    expect(requests.slice(requestsBefore)).toEqual([{ start: 10_000, end: 10_500 }]);
    expect(changes).toHaveLength(0);
    expect(api!.paginationGetRowCount()).toBe(countBefore);
    expect(api!.paginationGetCurrentPage()).toBe(pageBefore);
    expect(api!.getSelectedRows().map((row) => row.id)).toEqual(selectedBefore);
  });

  it("commits one user edit and refreshes only after the editor closes", async () => {
    const requests: Array<{ start: number; end: number }> = [];
    const changes: Array<{ data: Row; newValue: string }> = [];
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
    renderInfiniteGrid(datasource, (value) => { api = value; }, {
      editable: true,
      onCellValueChanged: (event) => changes.push(event),
    });

    await waitFor(() => expect(api).not.toBeNull());
    await navigateAndWait(api!, 10_380);
    const requestsBefore = requests.length;
    revision = 2;
    act(() => {
      api!.startEditingCell({ rowIndex: 10_380, colKey: "revision" });
      refreshOrderListRows(api);
    });
    const editor = document.querySelector<HTMLInputElement>(".ag-cell-inline-editing input");
    expect(editor).not.toBeNull();
    fireEvent.change(editor!, { target: { value: "99" } });
    fireEvent.input(editor!, { target: { value: "99" } });
    expect(editor!.value).toBe("99");
    expect(api!.getEditingCells()).toHaveLength(1);
    fireEvent.keyDown(editor!, { key: "Enter", code: "Enter", keyCode: 13, charCode: 13 });
    act(() => api!.stopEditing(false));

    await waitFor(() => expect(requests.slice(requestsBefore)).toEqual([{ start: 10_000, end: 10_500 }]));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ data: { id: "row-10380" }, newValue: "99" });
    expect(api!.getEditingCells()).toHaveLength(0);
    expect(api!.getRowNode("row-10380")?.data?.revision).toBe(2);
  });

  it("does not refresh or touch event listeners after the grid is destroyed", async () => {
    const requests: Array<{ start: number; end: number }> = [];
    let api: GridApi<Row> | null = null;
    const datasource: IDatasource = {
      getRows: async (params) => {
        requests.push({ start: params.startRow, end: params.endRow });
        await Promise.resolve();
        params.successCallback(rowsFor(params.startRow, params.endRow, 1));
      },
    };
    const view = renderInfiniteGrid(datasource, (value) => { api = value; }, { editable: true });

    await waitFor(() => expect(api).not.toBeNull());
    await navigateAndWait(api!, 10_380);
    act(() => {
      api!.startEditingCell({ rowIndex: 10_380, colKey: "revision" });
      refreshOrderListRows(api);
      api!.stopEditing(true);
      api!.destroy();
    });
    const requestsAtDestroy = requests.length;
    await act(async () => { await Promise.resolve(); });
    expect(api!.isDestroyed()).toBe(true);
    expect(requests).toHaveLength(requestsAtDestroy);
    view.unmount();
  });
});
