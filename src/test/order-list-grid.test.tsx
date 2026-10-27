import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import type { AgGridReact } from "ag-grid-react";
import { describe, expect, it, vi } from "vitest";

import { OrderListGrid } from "@/components/orders/OrderListGrid";
import type { OrderListRow } from "@/types/order-list";

function row(overrides: Partial<OrderListRow>): OrderListRow {
  return {
    order_line_id: "line-1",
    order_id: "order-1",
    production_order_number: "PO-1",
    order_status: "Open",
    vendor_name: "Vendor",
    customer_name: "Acme",
    sku: "NCV3SP1",
    sku_normalized: "ncv3sp1",
    source_style_type: "licensed",
    master_data_match_status: "matched",
    item_id: "item-1",
    item_description: "Current description",
    master_data_description: "Current description",
    master_data_license_status: "Approved",
    snapshot_description: "Description at import",
    snapshot_license_status: "Pending",
    item_link_type_mismatch: false,
    quantity_ordered: 10,
    ...overrides,
  } as unknown as OrderListRow;
}

function renderGrid(rows: OrderListRow[], onEditOrder = vi.fn()) {
  // Stands in for the database: the grid asks for a bounded block of rows.
  // Call the success callback asynchronously, the way the Orders page does --
  // a synchronous callback can race AG Grid's infinite-row setup and leave
  // cells unmounted depending on layout timing in jsdom.
  const datasource = {
    getRows: (params: any) => {
      void Promise.resolve().then(() => params.successCallback(rows, rows.length));
    },
  };
  // AG Grid measures its host to decide which columns to virtualize. A 0×0
  // host in jsdom makes that measurement timing-dependent, so give the grid
  // the same explicit size the stable OrderList grid tests use.
  const utils = render(
    <div style={{ height: 360, width: 720 }}>
      <OrderListGrid
        datasource={datasource}
        onCellEdited={vi.fn()}
        onRelink={vi.fn()}
        onEditOrder={onEditOrder}
      />
    </div>,
  );
  return { ...utils, onEditOrder };
}

describe("OrderList grid", () => {
  it("shows the live Master Data description for a linked line", async () => {
    renderGrid([row({})]);
    await waitFor(() => expect(screen.getByText("Current description")).toBeTruthy(), { timeout: 10_000 });
    expect(screen.getByText("PO-1")).toBeTruthy();
    expect(screen.getByText("Linked")).toBeTruthy();
  });

  it("falls back to the import snapshot and marks it when the line is not linked", async () => {
    renderGrid([
      row({
        order_line_id: "line-2",
        item_id: null,
        master_data_match_status: "unmatched",
        master_data_description: null,
        master_data_license_status: null,
      }),
    ]);
    await waitFor(() => expect(screen.getByText("Description at import")).toBeTruthy(), { timeout: 10_000 });
    expect(screen.getAllByText("at import").length).toBeGreaterThan(0);
    expect(screen.getByText("Not linked")).toBeTruthy();
  });

  it("renders the legacy column headers staff recognize", async () => {
    renderGrid([row({})]);
    await waitFor(() => expect(screen.getAllByText("PO Status").length).toBeGreaterThan(0), { timeout: 10_000 });
    for (const header of ["Import PO #", "Vendor", "Customer", "Style #", "Master Data Link", "Quantity"]) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    }
  });
});

describe("OrderList grid: opening an existing order", () => {
  it("gives every row a way into the order editor", async () => {
    const onEditOrder = vi.fn();
    renderGrid([row({})], onEditOrder);

    const edit = await screen.findByRole("button", { name: /edit order PO-1/i }, { timeout: 10_000 });
    fireEvent.click(edit);

    expect(onEditOrder).toHaveBeenCalledTimes(1);
    expect(onEditOrder.mock.calls[0][0].order_id).toBe("order-1");
  });

  it("marks a voided order instead of showing it as a live one", async () => {
    // `api.dam_order_list` does not filter voided rows out, so the grid must.
    const { container } = renderGrid([
      row({ order_voided_at: "2026-08-26T00:00:00Z", order_void_reason: "created in error" } as Partial<OrderListRow>),
    ]);

    await waitFor(() => expect(screen.getByText("PO-1")).toBeTruthy(), { timeout: 10_000 });
    const struck = container.querySelector('.ag-row[style*="line-through"]');
    expect(struck).toBeTruthy();
  });
});

describe("OrderList grid column visibility", () => {
  it("keeps a column the user added after the page re-renders (e.g. rows loading on scroll)", async () => {
    const rows = [row({})];
    const datasource = {
      getRows: (params: any) => {
        void Promise.resolve().then(() => params.successCallback(rows, rows.length));
      },
    };
    const ref = createRef<AgGridReact<OrderListRow>>();
    const onCellEdited = vi.fn();
    const onRelink = vi.fn();
    const onEditOrder = vi.fn();
    const view = (search: string) => (
      <div style={{ height: 360, width: 720 }}>
        <OrderListGrid
          ref={ref}
          datasource={datasource}
          search={search}
          onCellEdited={onCellEdited}
          onRelink={onRelink}
          onEditOrder={onEditOrder}
        />
      </div>
    );
    const { rerender } = render(view(""));
    await waitFor(() => expect(screen.getByText("PO-1")).toBeTruthy(), { timeout: 10_000 });

    const api = ref.current!.api;
    expect(api.getColumn("line_number")?.isVisible()).toBe(false);
    act(() => api.setColumnsVisible(["line_number"], true));
    expect(api.getColumn("line_number")?.isVisible()).toBe(true);

    // The Orders page re-renders as new row blocks load; that must not reset columns.
    rerender(view(""));
    rerender(view("x"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ref.current!.api.getColumn("line_number")?.isVisible()).toBe(true);
  });
});


describe("OrderList PO bands in dark appearance", () => {
  it("uses dark cell and header colors with the application's saved theme", async () => {
    localStorage.setItem("pd-theme", "dark");
    try {
      const { container } = renderGrid([row({})]);
      await screen.findByText("Current description", {}, { timeout: 10_000 });
      const header = container.querySelector('.ag-header-cell[col-id="sku"]');
      const cell = container.querySelector('.ag-center-cols-container .ag-cell[col-id="sku"]');
      expect(header?.classList.contains("bg-blue-900/70")).toBe(true);
      expect(cell?.classList.contains("bg-blue-950/30")).toBe(true);
      expect(cell?.classList.contains("bg-blue-50/60")).toBe(false);
    } finally {
      localStorage.removeItem("pd-theme");
    }
  });
});
