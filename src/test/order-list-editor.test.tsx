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
    expect(payload.order.production_order_number).toBeUndefined();
    expect(payload.order.company_id).toBeNull();
    expect(payload.line.quantity_ordered).toBe(48);
    expect(payload.line.sku).toBe("NCV3SP1");
    expect(payload.order.eta).toBeUndefined();
  });

  it("shows the saving state instead of allowing a double submit", () => {
    render(<OrderEditorDialog mode="edit" row={row} isSaving onClose={() => undefined} onSubmit={() => undefined} />);
    const saving = screen.getByRole("button", { name: /saving/i }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
  });
});

describe("Order editor dialog: void and restore", () => {
  it("refuses to void without a reason, then sends the void with one", () => {
    const onSetVoided = vi.fn();
    render(
      <OrderEditorDialog
        mode="edit"
        row={row}
        isSaving={false}
        onClose={() => undefined}
        onSubmit={() => undefined}
        onSetVoided={onSetVoided}
      />,
    );

    // First click asks for confirmation rather than voiding straight away.
    fireEvent.click(screen.getByRole("button", { name: /^void order$/i }));
    expect(onSetVoided).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /confirm void/i }));
    expect(onSetVoided).not.toHaveBeenCalled();
    expect(screen.getByText(/say why this order is being voided/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Void reason"), { target: { value: "duplicate of PO-1" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm void/i }));
    expect(onSetVoided).toHaveBeenCalledWith({ voided: true, void_reason: "duplicate of PO-1" });
  });

  it("offers Restore, not Void, for an order that is already voided", () => {
    const onSetVoided = vi.fn();
    render(
      <OrderEditorDialog
        mode="edit"
        row={{ ...row, order_voided_at: "2026-08-26T00:00:00Z", order_void_reason: "created in error" } as OrderListRow}
        isSaving={false}
        onClose={() => undefined}
        onSubmit={() => undefined}
        onSetVoided={onSetVoided}
      />,
    );

    expect(screen.queryByRole("button", { name: /^void order$/i })).toBeNull();
    expect(screen.getByText(/created in error/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /restore order/i }));
    expect(onSetVoided).toHaveBeenCalledWith({ voided: false, void_reason: null });
  });

  it("shows no void control at all when creating an order", () => {
    render(
      <OrderEditorDialog
        mode="create"
        row={null}
        isSaving={false}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: /void/i })).toBeNull();
  });

  it("keeps submitting valid values through the strict coercion", () => {
    const onSubmit = vi.fn();
    render(
      <OrderEditorDialog mode="edit" row={row} isSaving={false} onClose={() => undefined} onSubmit={onSubmit} />,
    );

    // Native date/number inputs cannot hold unreadable text, so the dialog's own
    // guard is exercised in `order-list-strict-values.test.ts` at the grid edge,
    // where free text really does reach the parser. Here we only prove the strict
    // wrapper did not break the ordinary save.
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].line.quantity_ordered).toBe(24);
  });
});
