import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildTriageItems, describeColdLionSource, rankLinkCandidates, type TriageRow } from "@/lib/coldlion-triage";

const rpc = vi.fn();
let listRows: TriageRow[] = [];
let candidateRows: TriageRow[] = [];

function builder(result: () => TriageRow[]) {
  const chain: any = {
    select: () => chain, or: () => chain, eq: () => chain, not: () => chain, is: () => chain,
    limit: () => Promise.resolve({ data: result(), error: null }),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    schema: () => ({ from: () => ({ select: (cols: string) => builder(() => listRows).select(cols) }) }),
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useOrderList", () => ({ ORDER_LIST_SUMMARY_QUERY_KEY: ["order-list-summary"] }));

const row = (over: Partial<TriageRow>): TriageRow => ({
  order_line_id: "l1", order_id: "o1", production_order_number: "D3708", customer_name: "Ross",
  customer_po_number: "7310597", sku: "HSD88DYWP02", quantity_ordered: 1603,
  coldlion_quantity_ordered: null, coldlion_import_po: null, coldlion_unmatched: false,
  coldlion_source_id: "coldlion:so:7128092:line:3:component:1", google_source_id: "g1", line_voided_at: null, ...over,
});

describe("triage items", () => {
  it("splits a line needing two decisions and orders quantity, Import PO, then unmatched", () => {
    const items = buildTriageItems([
      row({ order_line_id: "u", coldlion_unmatched: true, google_source_id: null }),
      row({ order_line_id: "b", coldlion_quantity_ordered: 1610, coldlion_import_po: "D3526" }),
    ]);
    expect(items.map((i) => i.key)).toEqual(["b:quantity", "b:import_po", "u:unmatched"]);
  });

  it("describes the ColdLion source and ranks the same customer PO first, ignoring leading zeros", () => {
    expect(describeColdLionSource("coldlion:so:7128092:line:3:component:1")).toBe("ColdLion order 7128092, line 3");
    const ranked = rankLinkCandidates(row({ order_line_id: "u", customer_po_number: "0001220303" }), [
      row({ order_line_id: "a", production_order_number: "D1", customer_po_number: "999", coldlion_source_id: null }),
      row({ order_line_id: "b", production_order_number: "D2", customer_po_number: "1220303", coldlion_source_id: null }),
      row({ order_line_id: "c", coldlion_source_id: "coldlion:so:1:line:1:component:1" }),
      row({ order_line_id: "d", coldlion_source_id: null, line_voided_at: "2026-10-01" }),
      row({ order_line_id: "e", coldlion_source_id: null, customer_name: "Walmart" }),
    ]);
    expect(ranked.map((r) => [r.order_line_id, r.samePo])).toEqual([["b", true], ["a", false]]);
  });
});

describe("To reconcile page", () => {
  beforeEach(() => {
    rpc.mockReset();
    candidateRows = [];
  });

  const renderPage = async () => {
    const { default: ReconcilePage } = await import("@/pages/ReconcilePage");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><ReconcilePage /></QueryClientProvider>);
  };

  it("guides a quantity decision and sends the chosen action", async () => {
    listRows = [row({ coldlion_quantity_ordered: 1610 })];
    rpc.mockResolvedValue({ data: "Quantity changed to 1610.", error: null });
    await renderPage();
    expect(await screen.findByText(/Item 1 of 1/)).toBeTruthy();
    expect(screen.getByTestId("use-coldlion").textContent).toContain("change to 1,610");
    listRows = [];
    fireEvent.click(screen.getByTestId("use-coldlion"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("resolve_coldlion_triage", { p_line: "l1", p_action: "use_coldlion_quantity", p_target: null }));
    expect(await screen.findByTestId("triage-empty")).toBeTruthy();
  });

  it("offers the keep-separate choice for an unmatched ColdLion line", async () => {
    listRows = [row({ coldlion_unmatched: true, google_source_id: null })];
    rpc.mockResolvedValue({ data: "Kept as its own ColdLion row.", error: null });
    await renderPage();
    fireEvent.click(await screen.findByTestId("keep-separate"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("resolve_coldlion_triage", { p_line: "l1", p_action: "keep_separate", p_target: null }));
  });
});
