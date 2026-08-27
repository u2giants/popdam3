import { render, screen, waitFor } from "@testing-library/react";
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
    master_data_description: "Current description",
    master_data_license_status: "Approved",
    snapshot_description: "Description at import",
    snapshot_license_status: "Pending",
    item_link_type_mismatch: false,
    quantity_ordered: 10,
    ...overrides,
  } as unknown as OrderListRow;
}

function renderGrid(rows: OrderListRow[]) {
  // Stands in for the database: the grid asks for a bounded block of rows.
  const datasource = {
    getRows: (params: any) => params.successCallback(rows, rows.length),
  };
  return render(<OrderListGrid datasource={datasource} onCellEdited={vi.fn()} onRelink={vi.fn()} />);
}

describe("OrderList grid", () => {
  it("shows the live Master Data description for a linked line", async () => {
    renderGrid([row({})]);
    await waitFor(() => expect(screen.getByText("Current description")).toBeTruthy());
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
    await waitFor(() => expect(screen.getByText("Description at import")).toBeTruthy());
    expect(screen.getAllByText("at import").length).toBeGreaterThan(0);
    expect(screen.getByText("Not linked")).toBeTruthy();
  });

  it("renders the legacy column headers staff recognize", async () => {
    renderGrid([row({})]);
    await waitFor(() => expect(screen.getAllByText("PO Status").length).toBeGreaterThan(0));
    for (const header of ["Import PO #", "Vendor", "Customer", "Style #", "Master Data Link", "Quantity"]) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    }
  });
});
