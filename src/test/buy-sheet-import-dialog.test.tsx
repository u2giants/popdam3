import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BuySheetImportDialog } from "@/components/orders/BuySheetImportDialog";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/buy-sheet-import", () => ({
  readBuySheetGrid: vi.fn().mockResolvedValue({ sheetName: "Sheet", grid: [] }),
  sha256Hex: vi.fn().mockResolvedValue("hash"),
  parseBuySheetGrid: vi.fn().mockReturnValue({
    headerFields: {}, lines: [], itemRowCount: 1, deliveries: [], totalsByDelivery: {},
  }),
}));

it("shows held inputs regardless of reason wording and requires a fresh, trimmed preview", async () => {
  const result = {
    applied: false, counts: { new: 1, held: 1 }, unmatched_styles: [],
    lines: [{ sku: "STYLE001", delivery_date: "2026-12-20", quantity: 10,
      group: "2026-12-20|1", outcome: "held", reason: "Order number required",
      order_number: null, previous_quantity: null, item_match: "matched" }],
  };
  rpc.mockResolvedValue({ data: result, error: null });
  render(<BuySheetImportDialog open onClose={() => {}} onApplied={() => {}}
    customerOptions={[{ id: "customer", label: "Burlington" }]} />);
  fireEvent.change(screen.getByLabelText("Buy sheet file"), {
    target: { files: [{ name: "buy.xlsx", arrayBuffer: async () => new ArrayBuffer(0) }] },
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  const input = await screen.findByLabelText("Order number for 2026-12-20|1");
  fireEvent.change(input, { target: { value: " D3722 " } });
  fireEvent.blur(input);
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  expect(rpc.mock.calls[1][1].p_order_numbers).toEqual({ "2026-12-20|1": "D3722" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Import", exact: true })).toBeEnabled());
});
