import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PropertyReconciliationPanel } from "./PropertyReconciliationPanel";
import { APPROVED_BATCH } from "./contract";

describe("Property reconciliation role experience", () => {
  it("shows the exact owner hash and no activation action", () => {
    render(<PropertyReconciliationPanel role="administrator" />);
    expect(screen.getByTestId("owner-hash")).toHaveTextContent(APPROVED_BATCH.sha256);
    expect(screen.getByText("There is no activate action in this contract.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /activate/i })).not.toBeInTheDocument();
  });

  it("locks preparation for a viewer", () => {
    render(<PropertyReconciliationPanel role="viewer" />);
    expect(screen.queryByRole("button", { name: /prepare \(/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Locked" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /export frozen/i })).toBeDisabled();
  });

  it("locks preparation and export for a designer", () => {
    render(<PropertyReconciliationPanel role="designer" />);
    expect(screen.queryByRole("button", { name: /prepare \(/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export frozen/i })).toBeDisabled();
  });

  it("clears administrator pending memory on role downgrade", async () => {
    const view = render(<PropertyReconciliationPanel role="administrator" />);
    fireEvent.click(screen.getAllByRole("button", { name: /prepare \(/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Prepare pending proposal" }));
    expect(screen.getByText("1 prepared")).toBeInTheDocument();
    view.rerender(<PropertyReconciliationPanel role="viewer" />);
    await waitFor(() => expect(screen.getByText("0 prepared")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /export frozen/i })).toBeDisabled();
  });

  it("returns all 43 effective ambiguity rows including Lion King", async () => {
    render(<PropertyReconciliationPanel role="administrator" />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Needs review/ }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() =>
      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 100 of 282 filtered values.",
      ),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Ambiguous only" }));
    await waitFor(() =>
      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 43 of 43 filtered values.",
      ),
    );
    expect(screen.getByText("the lion king")).toBeInTheDocument();
  });

  it("loads every needs-review row without a silent 100-row cap", async () => {
    render(<PropertyReconciliationPanel role="administrator" />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Needs review/ }), {
      button: 0,
      ctrlKey: false,
    });
    await waitFor(() =>
      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 100 of 282 filtered values.",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Load more/ }));
    await waitFor(() =>
      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 200 of 282 filtered values.",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Load more/ }));
    await waitFor(() =>
      expect(screen.getByTestId("pagination-summary")).toHaveTextContent(
        "Showing 282 of 282 filtered values.",
      ),
    );
  });

  it("locks other Licensors once an administrator starts a pending set", () => {
    render(<PropertyReconciliationPanel role="administrator" />);
    const disneyRow = screen.getByText("winnie the pooh").closest("tr")!;
    fireEvent.click(within(disneyRow).getByRole("button", { name: /Prepare/ }));
    fireEvent.click(screen.getByRole("button", { name: "Prepare pending proposal" }));
    const warnerRow = screen.getByText("looney tunes").closest("tr")!;
    const locked = within(warnerRow).getByRole("button", { name: "Locked" });
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute(
      "title",
      "Clear the pending set before preparing a different Licensor",
    );
    expect(screen.getByText("1 prepared")).toBeInTheDocument();
  });
});
