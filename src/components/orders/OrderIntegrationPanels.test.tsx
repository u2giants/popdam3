import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderTrackingComponent } from "@/types/order-integration";

type MockQuery = { rows: unknown[]; [key: string]: unknown };
const testState = vi.hoisted(() => ({ admin: false, tracking: {} as MockQuery, depths: {} as MockQuery, suffixes: {} as MockQuery, vendors: {} as MockQuery }));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: testState.admin, isRealAdmin: testState.admin, isLoading: false }) }));
vi.mock("@/hooks/useOrderIntegration", () => ({
  useOrderTracking: () => testState.tracking,
  useSampleDepths: () => testState.depths,
  useCustomerSuffixes: () => testState.suffixes,
  useVendorStatistics: () => testState.vendors,
}));

import { POTrackingPanel } from "./POTrackingPanel";
import { OrderSampleSettings } from "./OrderSampleSettings";
import { VendorStatisticsPanel } from "./VendorStatisticsPanel";

const refresh = vi.fn();
const saveTracking = vi.fn();
const upsertSampleDepth = vi.fn();
const upsertCustomerSuffix = vi.fn();

function trackingRow(overrides: Record<string, unknown> = {}) {
  return {
    order_id: "po-1", production_order_number: "PO-100", order_date: "2026-01-02", order_voided_at: null,
    customer_name: "Example Customer", vendor_name: "Example Vendor", factory_id: "f-1", company_id: "c-1",
    line_count: 0, total_cases: null, invalid_case_lines: 0, missing_test_reports: 0, missing_photos: 0,
    unresolved_product_lines: 1, order_type: null, start_ship_date: null, cancel_date: null, cargo_forecast_date: null,
    customer_po_number: null, customer_suffix: null, components: [], sent_po_date: null, vendor_delivery_date: null,
    seal_container_forecast: null, booking_state: null, etd: null, eta: null, warehouse_date: null, days_delay: null,
    worksheet_days_remaining: null, container_booking_group: null, mbl: null, close_tracking: null, agent: null, cbm: null,
    comment: null, vessel: null, sent_to_coldlion: null, worksheet_done: null, inspection_passed: null,
    inspection_note: null, document_invoice: null, document_packing_list: null, document_bill_of_lading: null,
    document_tsca: null, document_lacey_act: null, document_telex: null, request_wire: null, payment_note: null,
    tracking_updated_at: null, svn_number: null, booking_string: null, days_delay_status: null,
    seal_container_forecast_status: null, unknown_case_groups: null, ...overrides,
  };
}

function queryBase(overrides: Record<string, unknown> = {}) {
  return { rows: [], hasNextPage: false, isLoading: false, isFetching: false, isError: false, refetch: refresh, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  testState.admin = false;
  testState.tracking = { ...queryBase(), canEdit: false, saveTracking };
  testState.depths = { ...queryBase(), canEdit: false, isSaving: false, upsertSampleDepth };
  testState.suffixes = { ...queryBase(), canEdit: false, isSaving: false, upsertCustomerSuffix };
  testState.vendors = queryBase();
});

describe("PO tracking panels", () => {
  it("keeps unknown flags unknown and never reports completeness for a no-line order", () => {
    testState.tracking.rows = [trackingRow({ components: null })];
    render(<POTrackingPanel />);
    expect(screen.getAllByText("No order lines").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unknown", { selector: "td" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("Yes", { selector: "td" })).not.toBeInTheDocument();
  });

  it("shows complete only when line count is positive and no current reports are missing", () => {
    testState.tracking.rows = [trackingRow({ line_count: 2, missing_test_reports: 0, missing_photos: 1, total_cases: 4 })];
    render(<POTrackingPanel />);
    const row = screen.getByText("PO-100").closest("tr")!;
    expect(within(row).getByText("Yes")).toBeInTheDocument();
    expect(within(row).getByText("No (1 missing)")).toBeInTheDocument();
  });

  it("uses plain source labels in details and provides explicit sideways table controls", () => {
    const scrollSpy = vi.fn();
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollBy");
    Object.defineProperty(HTMLElement.prototype, "scrollBy", { configurable: true, value: scrollSpy });
    try {
      const component = { line_id: "line-v", workflow_source: "ambiguous" } as unknown as OrderTrackingComponent;
      testState.tracking.rows = [trackingRow({ line_count: 1, components: [component] })];
      render(<POTrackingPanel />);
      expect(screen.getByText(/scroll sideways to see them/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Show more tracking columns" }));
      expect(scrollSpy).toHaveBeenCalledWith({ left: 600, behavior: "smooth" });
      fireEvent.click(screen.getByRole("button", { name: "PO-100" }));
      expect(screen.getByText("Conflicting Master Data")).toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollBy", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollBy");
    }
  });

  it("updates an open PO detail from the refreshed row after background refetch", () => {
    const original = trackingRow({ line_count: 1, comment: "Before refresh" });
    testState.tracking.rows = [original];
    const view = render(<POTrackingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "PO-100" }));
    expect(screen.getByText("Before refresh")).toBeInTheDocument();
    testState.tracking = { ...testState.tracking, rows: [trackingRow({ line_count: 1, comment: "After refresh" })] };
    view.rerender(<POTrackingPanel />);
    expect(screen.getByText("After refresh")).toBeInTheDocument();
    expect(screen.queryByText("Before refresh")).not.toBeInTheDocument();
  });

  it("hides tracking edit for viewers and retains draft after save failure", async () => {
    testState.tracking.rows = [trackingRow()];
    const denied = vi.fn().mockRejectedValue(new Error("Save failed"));
    testState.tracking.saveTracking = denied;
    const view = render(<POTrackingPanel />);
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    view.rerender(<POTrackingPanel />);
    testState.admin = true;
    view.rerender(<POTrackingPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit PO tracking" }));
    const comment = screen.getByRole("textbox", { name: "Comment" });
    fireEvent.change(comment, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Save failed"));
    expect(comment).toHaveValue("Keep this draft");
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ changed: { comment: "Keep this draft" } }));
  });
});

describe("sample settings", () => {
  it("shows imported depth only as history and hides mutation controls while impersonating a member", () => {
    testState.depths.rows = [{ sku_normalized: "ab12", customer_normalized: "buyer", depth_inches: null, depth_raw: "2.5 in", source_workbook_id: "source", source_row_number: 44, updated_at: "2026-10-01", updated_by: null }];
    testState.suffixes.rows = [{ customer_normalized: "buyer", suffix: "-X", updated_at: "2026-10-01", updated_by: null }];
    render(<OrderSampleSettings />);
    expect(screen.getByText("2.5 in").parentElement).toHaveTextContent("import history");
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add depth setting/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add customer suffix/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("offers clearing depth while requiring a nonblank suffix", async () => {
    testState.admin = true;
    testState.depths.canEdit = true;
    testState.suffixes.canEdit = true;
    const onRowsChanged = vi.fn();
    render(<OrderSampleSettings onRowsChanged={onRowsChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Add depth setting" }));
    expect(screen.getByText(/leave it blank to clear/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Depth style number" }), { target: { value: "ab12" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Depth customer" }), { target: { value: "buyer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save depth" }));
    await waitFor(() => expect(upsertSampleDepth).toHaveBeenCalledWith({ sku: "ab12", customerName: "buyer", depth: "" }));
    expect(onRowsChanged).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Add customer suffix" }));
    expect(screen.getByRole("button", { name: "Save suffix" })).toBeDisabled();
  });

  it("offers retry when settings reads fail", () => {
    testState.depths.isError = true;
    testState.depths.canEdit = false;
    render(<OrderSampleSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("vendor statistics", () => {
  it("renders the seven read-only source facts and has no edit controls", () => {
    testState.vendors.rows = [{ factory_id: "f1", vendor_name: "Vendor One", order_count: 12, closed_orders: 5, open_orders: 7, last_sent_po_date: "2026-09-01", activity_status: "Active" }];
    render(<VendorStatisticsPanel />);
    for (const text of ["Vendor", "Total orders", "Closed", "Open", "Last sent PO", "14-month activity", "Vendor One", "Active"]) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit|delete|save/i })).not.toBeInTheDocument();
  });
});
