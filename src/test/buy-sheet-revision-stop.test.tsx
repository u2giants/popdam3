import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
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

describe("buy sheet revision stop (owner rule 2026-11-10)", () => {
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
