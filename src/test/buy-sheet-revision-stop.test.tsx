import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const chain: any = {
  select: () => chain, in: () => chain, not: () => chain, limit: () => chain,
  then: (f: (r: unknown) => unknown) => Promise.resolve({ data: [{ sku_normalized: "X1", item_description: "Molded Shadowbox", master_data_licensor: "MARVEL" }] }).then(f),
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), schema: () => ({ from: () => chain }) },
}));
vi.mock("@/lib/buy-sheet-import", () => ({
  readBuySheetGrid: async () => ({ sheetName: "S", grid: [] }),
  sha256Hex: async () => "a".repeat(64),
  parseBuySheetGrid: () => ({
    itemRowCount: 1,
    lines: [{ sku: "X1", delivery_date: "2026-12-10", quantity: 5, group: "2026-12-10|1", description: "12X15 MOLD" }],
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
    expect(await screen.findByText('Marvel Molded Shadowbox 12x15"')).toBeInTheDocument();
  });
});
