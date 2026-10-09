import { act, render, waitFor } from "@testing-library/react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type GridApi } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import { navigateToStyleTrackerMatch } from "@/lib/style-tracker-find-navigation";

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = { id: string; description: string };

function ProgressiveFindGrid({ exposeApi }: { exposeApi: (api: GridApi<Row>) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [gridRows, setGridRows] = useState<Row[]>([]);
  const [search] = useState("target licensed style");
  const apiRef = useRef<GridApi<Row> | null>(null);
  const navigate = useCallback((api: GridApi<Row>) => {
    navigateToStyleTrackerMatch(api, rows, search);
  }, [rows, search]);

  useEffect(() => {
    if (apiRef.current) navigate(apiRef.current);
  }, [navigate]);

  return (
    <div style={{ height: 360, width: 720 }}>
      <button type="button" onClick={() => {
        const nextRows = [
          ...Array.from({ length: 200 }, (_, index) => ({ id: `style-${index}`, description: `Style ${index}` })),
          { id: "target-style", description: "Target licensed style" },
        ];
        setRows(nextRows);
        window.setTimeout(() => setGridRows(nextRows), 50);
      }}>Load next page</button>
      <AgGridReact<Row>
        theme={themeQuartz}
        rowData={gridRows}
        columnDefs={[{ field: "id" }, { field: "description" }]}
        pagination
        paginationPageSize={50}
        getRowId={(params) => params.data.id}
        onGridReady={(event) => {
          apiRef.current = event.api;
          exposeApi(event.api);
        }}
        onRowDataUpdated={(event) => navigate(event.api)}
      />
    </div>
  );
}

describe("Styles Find navigation with progressive row loading", () => {
  it("retries after the matching row arrives and navigates within loaded rows", async () => {
    let api: GridApi<Row> | null = null;
    const { getByRole } = render(<ProgressiveFindGrid exposeApi={(value) => { api = value; }} />);

    await waitFor(() => expect(api).not.toBeNull());
    expect(api!.getRowNode("target-style")).toBeUndefined();

    act(() => getByRole("button", { name: "Load next page" }).click());
    expect(api!.paginationGetCurrentPage()).toBe(0);

    await waitFor(() => {
      expect(api!.getRowNode("target-style")?.rowIndex).toBe(200);
      expect(api!.paginationGetCurrentPage()).toBe(4);
    });
  });
});
