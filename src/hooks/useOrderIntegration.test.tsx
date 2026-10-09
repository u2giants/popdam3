import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  schema: vi.fn(),
  from: vi.fn(),
  auth: { user: { id: "user-1" } as { id: string } | null },
  admin: { isAdmin: true },
  builder: {
    select: vi.fn(),
    order: vi.fn(),
    ilike: vi.fn(),
    range: vi.fn(),
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc, schema: mocks.schema },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.auth.user }) }));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: mocks.admin.isAdmin }) }));

import {
  ORDER_INTEGRATION_SETTINGS_PAGE_SIZE,
  ORDER_TRACKING_PAGE_SIZE,
  useCustomerSuffixes,
  useOrderTracking,
  useSampleDepths,
  useVendorStatistics,
} from "@/hooks/useOrderIntegration";

function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  }));
  return createElement(QueryClientProvider, { client }, children);
}

describe("order integration hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.user = { id: "user-1" };
    mocks.admin.isAdmin = true;
    for (const method of [mocks.builder.select, mocks.builder.order, mocks.builder.ilike]) {
      method.mockImplementation(() => mocks.builder);
    }
    mocks.builder.range.mockResolvedValue({ data: [], error: null });
    mocks.from.mockReturnValue(mocks.builder);
    mocks.schema.mockReturnValue({ from: mocks.from });
  });

  it("requests only the selected 50-row tracking page and exposes full-page next availability", async () => {
    mocks.rpc.mockResolvedValue({ data: Array.from({ length: 50 }, (_, index) => ({ order_id: `${index}` })), error: null });
    const { result } = renderHook(
      () => useOrderTracking({ page: 2, search: " PO-9 ", onlyOpen: true }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.rows).toHaveLength(ORDER_TRACKING_PAGE_SIZE));
    expect(mocks.rpc).toHaveBeenCalledWith("get_dam_order_tracking", {
      p_offset: 100,
      p_limit: 50,
      p_search: "PO-9",
      p_only_open: true,
    });
    expect(result.current.hasNextPage).toBe(true);
  });

  it("keeps style and customer search as separate escaped filters with a 100-row range", async () => {
    const { result } = renderHook(
      () => useSampleDepths({ page: 1, skuSearch: "ab%_\\c", customerSearch: "acme_" }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(mocks.builder.range).toHaveBeenCalled());
    expect(mocks.builder.ilike).toHaveBeenNthCalledWith(1, "sku_normalized", "%ab\\%\\_\\\\c%");
    expect(mocks.builder.ilike).toHaveBeenNthCalledWith(2, "customer_normalized", "%acme\\_%");
    expect(mocks.builder.range).toHaveBeenCalledWith(100, 199);
    expect(result.current.hasNextPage).toBe(false);
    expect(ORDER_INTEGRATION_SETTINGS_PAGE_SIZE).toBe(100);
  });

  it("surfaces view errors and applies vendor search and deterministic bounded paging", async () => {
    mocks.builder.range.mockResolvedValue({ data: null, error: new Error("view unavailable") });
    const { result } = renderHook(
      () => useVendorStatistics({ page: 0, vendorSearch: "Acme%" }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("view unavailable");
    expect(mocks.builder.ilike).toHaveBeenCalledWith("vendor_name", "%Acme\\%%");
    expect(mocks.builder.order).toHaveBeenCalledWith("factory_id", { ascending: true, nullsFirst: true });
    expect(mocks.builder.range).toHaveBeenCalledWith(0, 99);
  });

  it("surfaces overlong search as a query error without issuing a request", async () => {
    const { result } = renderHook(
      () => useVendorStatistics({ page: 0, vendorSearch: "x".repeat(201) }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Search is limited to 200 characters");
    expect(mocks.schema).not.toHaveBeenCalled();
  });

  it("uses the customer suffix view with a deterministic bounded page and keeps unauthenticated reads disabled", async () => {
    mocks.auth.user = null;
    const { result, rerender } = renderHook(
      () => useCustomerSuffixes({ page: 3, customerSearch: "Acme" }),
      { wrapper: Wrapper },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(mocks.schema).not.toHaveBeenCalled();

    mocks.auth.user = { id: "user-1" };
    rerender();
    await waitFor(() => expect(mocks.builder.range).toHaveBeenCalledWith(300, 399));
    expect(mocks.from).toHaveBeenCalledWith("dam_order_customer_settings");
    expect(mocks.builder.order).toHaveBeenCalledWith("customer_normalized", { ascending: true });
  });

  it("writes normalized sample and customer settings only through their administrator RPCs", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const sample = renderHook(
      () => useSampleDepths({ page: 0, skuSearch: "", customerSearch: "" }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await sample.result.current.upsertSampleDepth({ sku: " ABC-1 ", customerName: " Acme ", depth: "" });
    });
    expect(mocks.rpc).toHaveBeenCalledWith("upsert_dam_order_sample_depth", {
      p_sku: "abc-1",
      p_customer: "acme",
      p_depth_inches: null,
    });

    const suffix = renderHook(
      () => useCustomerSuffixes({ page: 0, customerSearch: "" }),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await suffix.result.current.upsertCustomerSuffix({ customerName: " Acme ", suffix: "  EAST  " });
    });
    expect(mocks.rpc).toHaveBeenCalledWith("upsert_dam_order_customer_settings", {
      p_customer: "acme",
      p_suffix: "EAST",
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith("upsert_dam_order_sample_depth", expect.objectContaining({ p_depth_inches: "" }));
  });

  it("refuses writes while effective admin access is disabled and calls only the closed tracking RPC otherwise", async () => {
    const { result, rerender } = renderHook(
      () => useOrderTracking({ page: 0, search: "", onlyOpen: false }),
      { wrapper: Wrapper },
    );
    mocks.admin.isAdmin = false;
    rerender();
    await expect(result.current.saveTracking({
      orderId: "order-1",
      original: { agent: "Old" },
      changed: { agent: "New", order_status: "Closed" },
    })).rejects.toThrow("Administrator access is required");
    expect(mocks.rpc).not.toHaveBeenCalledWith("update_dam_order_tracking", expect.anything());

    mocks.admin.isAdmin = true;
    rerender();
    mocks.rpc.mockResolvedValue({ data: "order-1", error: null });
    await act(async () => {
      await result.current.saveTracking({
        orderId: "order-1",
        original: { agent: "Old" },
        changed: { agent: " New " },
      });
    });
    expect(mocks.rpc).toHaveBeenCalledWith("update_dam_order_tracking", {
      p_order_id: "order-1",
      p_patch: { agent: "New" },
    });
  });
});
