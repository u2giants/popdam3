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
      ? { config: { SEARCH_MIN_SEMANTIC_SCORE: { value: { value: 0.35 }, updated_at: "2026-09-30T00:00:00Z" } } } : { ok: true });
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

describe("SemanticFloorCard non-numeric input", () => {
  it("blocks save for non-numeric text instead of clearing the floor", async () => {
    call.mockReset();
    call.mockImplementation(async (action: string) => action === "get-config"
      ? { config: { SEARCH_MIN_SEMANTIC_SCORE: { value: { value: 0.35 }, updated_at: "2026-09-30T00:00:00Z" } } } : { ok: true });
    renderCard();
    const input = await screen.findByDisplayValue("0.35");
    fireEvent.change(input, { target: { value: "abc" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/Enter a number between 0 and 1/)).toBeInTheDocument();
  });
});

describe("SemanticFloorCard load failure", () => {
  it("disables saving when the current value cannot be loaded", async () => {
    call.mockReset();
    call.mockImplementation(async (action: string) => {
      if (action === "get-config") throw new Error("boom");
      return { ok: true };
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SemanticFloorCard /></QueryClientProvider>);
    await screen.findByText(/Could not load the current floor/);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(call).not.toHaveBeenCalledWith("set-config", expect.anything());
  });
});

describe("SemanticFloorCard round-trip", () => {
  it("reads back exactly what Save stored, through the admin-api get-config envelope", async () => {
    call.mockReset();
    let stored: unknown = null;
    call.mockImplementation(async (action: string, body: { entries?: Record<string, unknown> }) => {
      if (action === "set-config") { stored = body.entries?.SEARCH_MIN_SEMANTIC_SCORE; return { ok: true }; }
      // admin-api handleGetConfig: config[key] = { value: row.value, updated_at }
      return { config: stored === null ? {} : { SEARCH_MIN_SEMANTIC_SCORE: { value: stored, updated_at: "t" } } };
    });
    renderCard();
    const input = await screen.findByLabelText("Minimum semantic score");
    await waitFor(() => expect(input).not.toBeDisabled());
    fireEvent.change(input, { target: { value: "0.6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByDisplayValue("0.6")).toBeInTheDocument();
    await waitFor(() => expect(call.mock.calls.filter(([a]) => a === "get-config").length).toBeGreaterThan(1));
    expect(screen.getByDisplayValue("0.6")).toBeInTheDocument();
  });
});
