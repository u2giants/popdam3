import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OrderEditorDialog } from "@/components/orders/OrderEditorDialog";
import type { OrderListRow } from "@/types/order-list";

const row = {
  order_line_id: "line-1",
  order_id: "order-1",
  production_order_number: "PO-1",
  order_status: "Open",
  order_date: "2026-01-02",
  requested_ship_date: null,
  etd: null,
  eta: null,
  sku: "NCV3SP1",
  source_style_type: "licensed",
  customer_po_number: "CPO-9",
  quantity_ordered: 10,
  case_pack: null,
  start_ship_date: null,
  cancel_date: null,
} as unknown as OrderListRow;

describe("Order editor dialog", () => {
  it("cannot create an order without an Import PO number", () => {
    render(
      <OrderEditorDialog mode="create" row={null} isSaving={false} onClose={() => undefined} onSubmit={() => undefined} />,
    );
    const create = screen.getByRole("button", { name: /create order/i }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Import PO #"), { target: { value: "PO-77" } });
    expect((screen.getByRole("button", { name: /create order/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("rejects a Licensed/Generic value that is neither", () => {
    const onSubmit = vi.fn();
    render(<OrderEditorDialog mode="edit" row={row} isSaving={false} onClose={() => undefined} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Licensed / Generic"), { target: { value: "both" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/must be exactly/i)).toBeTruthy();
  });

  it("submits split header and line payloads with typed values", () => {
    const onSubmit = vi.fn();
    render(<OrderEditorDialog mode="edit" row={row} isSaving={false} onClose={() => undefined} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "48" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.order.production_order_number).toBe("PO-1");
    expect(payload.line.quantity_ordered).toBe(48);
    expect(payload.line.sku).toBe("NCV3SP1");
    // Blank optional dates clear rather than saving empty text.
    expect(payload.order.eta).toBeNull();
  });

  it("shows the saving state instead of allowing a double submit", () => {
    render(<OrderEditorDialog mode="edit" row={row} isSaving onClose={() => undefined} onSubmit={() => undefined} />);
    const saving = screen.getByRole("button", { name: /saving/i }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
  });
});
