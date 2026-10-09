import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  authLoading: false,
  gridRefresh: vi.fn(),
  setGridOption: vi.fn(),
  channels: [] as Array<{ handler?: () => void; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }>,
  removedChannels: [] as unknown[],
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user, loading: mocks.authLoading }) }));
vi.mock("@/hooks/useDamCustomers", () => ({ useDamCustomers: () => ({ data: [] }) }));
vi.mock("@/hooks/useOrderList", () => ({
  fetchOrderListBlock: vi.fn(), findOrderListRow: vi.fn(),
  useCreateOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useRelinkOrderLine: () => ({ mutate: vi.fn(), isPending: false }),
  useOrderListLinkCandidates: () => ({ data: [], isLoading: false }),
  useOrderListSavedViews: () => ({ data: [], refetch: vi.fn() }),
  useOrderListStatusCounts: () => ({ data: { total: 0, linked: 0, ambiguous: 0, unmatched: 0 } }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn(() => {
      const channel = {
        handler: undefined as (() => void) | undefined,
        on: vi.fn((_type: string, _filter: unknown, handler: () => void) => { channel.handler = handler; return channel; }),
        subscribe: vi.fn(() => channel),
      };
      mocks.channels.push(channel);
      return channel;
    }),
    removeChannel: vi.fn((channel: unknown) => { mocks.removedChannels.push(channel); return Promise.resolve("ok"); }),
    rpc: vi.fn(),
  },
}));

vi.mock("@/components/orders/OrderListGrid", async () => {
  const React = await import("react");
  return { OrderListGrid: React.forwardRef(function MockOrderListGrid(_props: unknown, ref: React.ForwardedRef<unknown>) {
    React.useImperativeHandle(ref, () => ({ api: {
      purgeInfiniteCache: mocks.gridRefresh,
      getEditingCells: () => [],
      isDestroyed: () => false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setGridOption: mocks.setGridOption,
    } }));
    return <div data-testid="orderlist-grid">Existing OrderList grid</div>;
  }) };
});
vi.mock("@/components/orders/POTrackingPanel", () => ({ POTrackingPanel: ({ onRowsChanged }: { onRowsChanged: () => void }) => <div data-testid="po-tracking-panel"><button onClick={onRowsChanged}>Refresh OrderList from tracking save</button></div> }));
vi.mock("@/components/orders/OrderSampleSettings", () => ({ OrderSampleSettings: ({ onRowsChanged }: { onRowsChanged: () => void }) => <div data-testid="sample-settings-panel"><button onClick={onRowsChanged}>Refresh OrderList from settings save</button></div> }));
vi.mock("@/components/orders/OrderEditorDialog", () => ({ OrderEditorDialog: () => null }));
vi.mock("@/components/orders/MasterDataLinkDialog", () => ({ MasterDataLinkDialog: () => null }));
vi.mock("@/components/grid/GridAiHelperDialog", () => ({ GridAiHelperDialog: () => null }));
vi.mock("@/components/orders/OrderListSummary", () => ({ OrderListSummary: () => <span>Summary</span> }));
vi.mock("@/components/orders/OrderListViewsMenu", () => ({ OrderListViewsMenu: () => <button>Saved views</button> }));

import OrdersPage from "./OrdersPage";

describe("OrdersPage integration wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.user = { id: "user-1" };
    mocks.authLoading = false;
    mocks.channels.length = 0;
    mocks.removedChannels.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("keeps the existing OrderList grid and controls mounted while switching to the new tabs", () => {
    render(<OrdersPage />);
    expect(screen.getByTestId("orderlist-grid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saved views" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Order views" });

    fireEvent.click(within(nav).getByRole("button", { name: "PO Tracking" }));
    expect(screen.getByTestId("po-tracking-panel")).toBeInTheDocument();
    expect(screen.getByTestId("orderlist-grid").parentElement?.parentElement?.parentElement).toHaveClass("hidden");
    expect(screen.getByRole("button", { name: "Saved views" })).toBeInTheDocument();

    fireEvent.click(within(nav).getByRole("button", { name: "Sample Settings" }));
    expect(screen.getByTestId("sample-settings-panel")).toBeInTheDocument();
    expect(screen.getByTestId("orderlist-grid")).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole("button", { name: "OrderList" }));
    expect(screen.getByTestId("orderlist-grid").parentElement?.parentElement?.parentElement).not.toHaveClass("hidden");
  });

  it("refreshes the visible OrderList block after successful tracking or settings changes", () => {
    render(<OrdersPage />);
    const nav = screen.getByRole("navigation", { name: "Order views" });
    fireEvent.click(within(nav).getByRole("button", { name: "PO Tracking" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh OrderList from tracking save" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Sample Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh OrderList from settings save" }));
    expect(mocks.gridRefresh).toHaveBeenCalledTimes(2);
  });

  it("refreshes on visible focus and each 30-second interval only while OrderList is selected", () => {
    render(<OrdersPage />);
    fireEvent.focus(window);
    expect(mocks.gridRefresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mocks.gridRefresh).toHaveBeenCalledTimes(2);

    const nav = screen.getByRole("navigation", { name: "Order views" });
    fireEvent.click(within(nav).getByRole("button", { name: "PO Tracking" }));
    fireEvent.focus(window);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mocks.gridRefresh).toHaveBeenCalledTimes(2);
  });

  it("debounces Master Data realtime changes by 500 ms and refreshes the current block once", () => {
    render(<OrdersPage />);
    const handler = mocks.channels[0]?.handler;
    expect(handler).toBeTypeOf("function");
    act(() => { handler?.(); handler?.(); });
    act(() => { vi.advanceTimersByTime(499); });
    expect(mocks.gridRefresh).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(mocks.gridRefresh).toHaveBeenCalledOnce();
  });

  it("ignores realtime refresh while hidden and removes channel, timers, and focus listener on unmount", () => {
    const { unmount } = render(<OrdersPage />);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => { mocks.channels[0]?.handler?.(); vi.advanceTimersByTime(500); });
    expect(mocks.gridRefresh).not.toHaveBeenCalled();

    unmount();
    expect(mocks.removedChannels).toHaveLength(1);
    fireEvent.focus(window);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mocks.gridRefresh).not.toHaveBeenCalled();
  });

  it("does not subscribe to realtime or start refresh timers before authentication is ready", () => {
    mocks.authLoading = true;
    const view = render(<OrdersPage />);
    expect(mocks.channels).toHaveLength(0);
    fireEvent.focus(window);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(mocks.gridRefresh).not.toHaveBeenCalled();

    mocks.authLoading = false;
    view.rerender(<OrdersPage />);
    expect(mocks.channels).toHaveLength(1);
    mocks.user = null;
    view.rerender(<OrdersPage />);
    expect(mocks.removedChannels).toHaveLength(1);
    expect(mocks.channels).toHaveLength(1);
  });
});
