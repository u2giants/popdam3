import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const success = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => success(...args) } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/lib/buy-sheet-import", () => ({
  readBuySheetGrid: async () => ({ sheetName: "S", grid: [] }),
  sha256Hex: async () => "a".repeat(64),
  parseBuySheetGrid: () => ({
    itemRowCount: 1,
    lines: [{ sku: "X1", delivery_date: "2026-12-10", quantity: 5, group: "2026-12-10|1" }],
    deliveries: [{ date: "2026-12-10" }],
    totalsByDelivery: { "2026-12-10": 5 },
    headerFields: {},
  }),
}));

import { BuySheetImportDialog } from "@/components/orders/BuySheetImportDialog";

const fresh = {
  applied: false, import_id: null, customer: "Burlington", counts: { new: 1, revision: 0 },
  unmatched_styles: [], lines: [],
};

async function previewSheet(onApplied = vi.fn()) {
  render(<BuySheetImportDialog open onClose={() => {}} onApplied={onApplied} customerOptions={[{ id: "c1", label: "Burlington" }]} />);
  fireEvent.change(screen.getByLabelText("Buy sheet file"), { target: { files: [{ name: "s.xlsx", arrayBuffer: async () => new ArrayBuffer(1) }] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByText(/Preview: 1 new/);
  return onApplied;
}

describe("buy sheet revision stop (owner rule 2026-11-10)", () => {
  beforeEach(() => { rpc.mockReset(); success.mockReset(); });

  it.each([
    { ...fresh, counts: { revision: 1 } },
    { ...fresh, counts: null, lines: [{ sku: "X1", delivery_date: "2026-12-10", quantity: 5, outcome: "revision", item_match: "matched" }] },
    fresh,
  ])("does not report success for an apply refusal: %j", async (refusal) => {
    rpc.mockResolvedValueOnce({ data: fresh, error: null }).mockResolvedValueOnce({ data: refusal, error: null });
    const onApplied = await previewSheet();
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled());
    expect(screen.getAllByText(/Stop: this sheet|Buy sheet was not imported/).length).toBeGreaterThan(0);
    expect(success).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("imports a sheet without revisions", async () => {
    rpc.mockResolvedValueOnce({ data: fresh, error: null }).mockResolvedValueOnce({ data: { ...fresh, applied: true }, error: null });
    const onApplied = await previewSheet();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(success).toHaveBeenCalledOnce();
  });

  it("stops revision lines even when the count is absent", async () => {
    rpc.mockResolvedValue({ data: { ...fresh, counts: { new: 1 }, lines: [{ sku: "X1", delivery_date: "2026-12-10", quantity: 5, outcome: "revision", item_match: "matched" }] }, error: null });
    await previewSheet();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("1 revision lines");
    expect(screen.getByText(/Preview: 1 new/)).toHaveTextContent("1 revision");
  });
  it("shows the stop message and keeps Import disabled when the sheet revises an imported one", async () => {
    rpc.mockResolvedValue({
      data: {
        applied: false, import_id: null, customer: "Burlington", counts: { revision: 1, new: 1 }, unmatched_styles: [],
        lines: [{ sku: "X1", delivery_date: "2026-12-10", quantity: 5, group: "2026-12-10|1", outcome: "revision",
          reason: "revised", order_number: "D1", previous_quantity: 4, item_match: "matched" }],
      },
      error: null,
    });
    render(<BuySheetImportDialog open onClose={() => {}} onApplied={() => {}} customerOptions={[{ id: "c1", label: "Burlington" }]} />);
    fireEvent.change(screen.getByLabelText("Buy sheet file"), { target: { files: [{ name: "s.xlsx", arrayBuffer: async () => new ArrayBuffer(1) }] } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("revises a buy sheet that was already imported");
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });
});
