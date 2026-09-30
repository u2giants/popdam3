import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
vi.mock("@/hooks/useAdminApi", () => ({ useAdminApi: () => ({ call }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { readSemanticFloor, SemanticFloorCard } from "@/components/settings/SemanticFloorCard";

const renderCard = () => render(<QueryClientProvider client={new QueryClient()}><SemanticFloorCard /></QueryClientProvider>);

describe("readSemanticFloor", () => {
  it("unwraps and validates", () => {
    expect(readSemanticFloor({ value: 0.4 })).toBe(0.4);
    expect(readSemanticFloor(null)).toBeNull();
    expect(readSemanticFloor({ value: null })).toBeNull();
    expect(readSemanticFloor(2)).toBeNull();
  });
});

describe("SemanticFloorCard", () => {
  beforeEach(() => call.mockReset());

  it("shows the stored floor and saves a new one", async () => {
    call.mockImplementation(async (action: string) => action === "get-config"
      ? { config: { SEARCH_MIN_SEMANTIC_SCORE: { value: 0.35 } } } : { ok: true });
    renderCard();
    const input = await screen.findByDisplayValue("0.35");
    fireEvent.change(input, { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("set-config", { entries: { SEARCH_MIN_SEMANTIC_SCORE: { value: 0.5 } } }));
  });

  it("clears the floor with a blank value and blocks out-of-range input", async () => {
    call.mockImplementation(async (action: string) => action === "get-config" ? { config: {} } : { ok: true });
    renderCard();
    const input = await screen.findByLabelText("Minimum semantic score");
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "1.5" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("set-config", { entries: { SEARCH_MIN_SEMANTIC_SCORE: { value: null } } }));
  });
});
