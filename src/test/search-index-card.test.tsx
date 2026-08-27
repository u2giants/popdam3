import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn().mockResolvedValue({
    data: { ok: true, status: { total_documents: 100, embedded_documents: 75, pending_documents: 20, leased_documents: 5, errored_documents: 2, exhausted_documents: 1 } },
    error: null,
  }) } },
}));

vi.mock("@/hooks/usePersistentOperation", () => ({
  usePersistentOperation: () => ({ state: { status: "idle" }, start: vi.fn(), stop: vi.fn() }),
}));

import { SearchIndexCard } from "@/components/settings/SearchIndexCard";

describe("SearchIndexCard", () => {
  it("shows coverage and keeps the operator control explicit", async () => {
    render(<QueryClientProvider client={new QueryClient()}><SearchIndexCard /></QueryClientProvider>);
    expect(await screen.findByText("75 of 100 ready")).toBeInTheDocument();
    expect(screen.getByText("20 pending")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start indexing" })).toBeInTheDocument();
  });
});
