import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewQueue } from "@/components/settings/erp-enrichment/ReviewQueue";

const { call, success, failure } = vi.hoisted(() => ({ call: vi.fn(), success: vi.fn(), failure: vi.fn() }));
vi.mock("@/hooks/useAdminApi", () => ({ useAdminApi: () => ({ call }) }));
vi.mock("sonner", () => ({ toast: { success, error: failure } }));
const empty = { ok: true, items: [], total: 0, total_pages: 0, status_counts: { pending: 0 } };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ReviewQueue /></QueryClientProvider>);
  return client;
}
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("ERP review queue refresh", () => {
  it("shows progress and confirms a successful refresh even when the empty queue is unchanged", async () => {
    call.mockResolvedValueOnce(empty);
    const client = mount();
    await screen.findByText("No items in this status.");
    let finish!: (value: typeof empty) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh the queue" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh the queue" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Refresh the queue" })).toHaveAttribute("aria-busy", "true");
    await act(async () => finish(empty));
    await waitFor(() => expect(success).toHaveBeenCalledWith("Review queue refreshed"));
    expect(call).toHaveBeenLastCalledWith("erp-review-queue", { status: "pending", page: 1, page_size: 100 });
    expect(screen.getByRole("button", { name: "Refresh the queue" })).toBeEnabled();
    client.clear();
  });
  it("shows an initial failure instead of claiming the queue is empty and lets refresh recover", async () => {
    call.mockRejectedValueOnce(new Error("Service unavailable"));
    const client = mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Service unavailable");
    expect(screen.queryByText("No items in this status.")).not.toBeInTheDocument();
    call.mockResolvedValueOnce(empty);
    fireEvent.click(screen.getByRole("button", { name: "Refresh the queue" }));
    await screen.findByText("No items in this status.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    client.clear();
  });
  it("reports a failed refresh without claiming success", async () => {
    call.mockResolvedValueOnce(empty);
    const client = mount();
    await screen.findByText("No items in this status.");
    call.mockRejectedValueOnce(new Error("Network unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh the queue" }));
    await waitFor(() => expect(failure).toHaveBeenCalledWith("Could not refresh the queue: Network unavailable"));
    expect(success).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    client.clear();
  });
});
