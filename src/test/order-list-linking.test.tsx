import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MasterDataLinkCell } from "@/components/orders/MasterDataLinkCell";
import { MasterDataLinkDialog } from "@/components/orders/MasterDataLinkDialog";
import type { OrderListLinkCandidate, OrderListRow } from "@/types/order-list";

const baseRow = {
  order_line_id: "line-1",
  order_id: "order-1",
  sku: "NCV3SP1",
  sku_normalized: "ncv3sp1",
  source_style_type: "licensed",
  master_data_match_status: "matched",
  item_id: "item-1",
  master_data_description: "Current description",
  item_link_type_mismatch: false,
} as unknown as OrderListRow;

function rowWith(overrides: Partial<OrderListRow>) {
  return { ...baseRow, ...overrides } as OrderListRow;
}

describe("Master Data link cell", () => {
  it("names a linked row", () => {
    render(<MasterDataLinkCell row={baseRow} onRelink={() => undefined} />);
    expect(screen.getByText("Linked")).toBeTruthy();
  });

  it("warns on an ambiguous row instead of showing a blank cell", () => {
    render(
      <MasterDataLinkCell
        row={rowWith({ item_id: null, master_data_match_status: "ambiguous" })}
        onRelink={() => undefined}
      />,
    );
    expect(screen.getByText("Ambiguous")).toBeTruthy();
  });

  it("warns when the linked item belongs to the other catalog", () => {
    render(<MasterDataLinkCell row={rowWith({ item_link_type_mismatch: true })} onRelink={() => undefined} />);
    expect(screen.getByText("Wrong catalog")).toBeTruthy();
  });

  it("offers no link action for a line with no Style #", () => {
    render(
      <MasterDataLinkCell
        row={rowWith({ item_id: null, sku: null, master_data_match_status: "not_applicable" })}
        onRelink={() => undefined}
      />,
    );
    expect(screen.getByText("No SKU")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens the relink flow for an unmatched row", () => {
    const onRelink = vi.fn();
    render(
      <MasterDataLinkCell
        row={rowWith({ item_id: null, master_data_match_status: "unmatched" })}
        onRelink={onRelink}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /link/i }));
    expect(onRelink).toHaveBeenCalledTimes(1);
  });
});

describe("Master Data link dialog", () => {
  const candidates: OrderListLinkCandidate[] = [
    {
      style_tracker_row_id: "s1",
      plm_item_id: "i1",
      sku: "NCV3SP1",
      tracker_type: "licensed",
      description: "Licensed candidate",
      license_status: "Approved",
      licensor: "Warner Bros",
      default_vendor: null,
    },
  ];

  it("requires a choice before it will link", () => {
    const onConfirm = vi.fn();
    render(
      <MasterDataLinkDialog
        row={baseRow}
        candidates={candidates}
        isLoading={false}
        isSaving={false}
        onClose={() => undefined}
        onConfirm={onConfirm}
      />,
    );
    const link = screen.getByRole("button", { name: /link this record/i }) as HTMLButtonElement;
    expect(link.disabled).toBe(true);

    fireEvent.click(screen.getByText("Licensed candidate"));
    fireEvent.click(screen.getByRole("button", { name: /link this record/i }));
    expect(onConfirm).toHaveBeenCalledWith("i1");
  });

  it("says plainly when nothing is eligible rather than offering a near match", () => {
    render(
      <MasterDataLinkDialog
        row={baseRow}
        candidates={[]}
        isLoading={false}
        isSaving={false}
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(screen.getByText(/No eligible Master Data row/i)).toBeTruthy();
  });
});
