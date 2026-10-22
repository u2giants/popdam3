import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Loading visible rows must never start or wait for an exact whole-view count.
 * Under production concurrency that count made the bounded block time out too.
 */

type Recorded = { kind: "rows" | "count"; select: string; head: boolean };
const recorded: Recorded[] = [];
const rpcCalls: Array<{ name: string; args: any }> = [];
const orCalls: string[] = [];

let rowBehaviour: () => Promise<{ data: any[]; error: unknown }> = async () => ({
  data: [{ order_line_id: "line-1" }],
  error: null,
});

let salesOrderDateBehaviour: (args: any) => Promise<{ data: any[] | null; error: unknown }> = async (args) => ({
  data: args.p_line_ids.map((order_line_id: string) => ({ order_line_id, sales_order_date: null })),
  error: null,
});

let countBehaviour: () => Promise<{ count: number | null; error: unknown }> = async () => ({
  count: 24486,
  error: null,
});

function builder(kind: "rows" | "count", head: boolean) {
  const chain: any = {
    is: () => chain,
    not: () => chain,
    filter: () => chain,
    or: (clause: string) => {
      orCalls.push(clause);
      return chain;
    },
    order: () => chain,
    range: async () => rowBehaviour(),
    then: (resolve: any, reject: any) => countBehaviour().then(resolve, reject),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      return salesOrderDateBehaviour(args);
    },
    schema: () => ({
      from: () => ({
        select: (select: string, options?: { count?: string; head?: boolean }) => {
          const head = options?.head === true;
          recorded.push({ kind: head ? "count" : "rows", select, head });
          return builder(head ? "count" : "rows", head);
        },
      }),
    }),
  },
}));

const { fetchOrderListBlock, updateOrderListSalesDateErrors } = await import("@/hooks/useOrderList");

beforeEach(() => {
  recorded.length = 0;
  rpcCalls.length = 0;
  orCalls.length = 0;
  rowBehaviour = async () => ({ data: [{ order_line_id: "line-1" }], error: null });
  salesOrderDateBehaviour = async (args) => ({
    data: args.p_line_ids.map((order_line_id: string) => ({ order_line_id, sales_order_date: null })),
    error: null,
  });
  countBehaviour = async () => ({ count: 24486, error: null });
});

describe("OrderList block loading", () => {
  it("loads only the bounded rows and does not request an exact count", async () => {
    const block = await fetchOrderListBlock({ startRow: 0, endRow: 100 });

    expect(block.rows).toHaveLength(1);
    expect(block.totalRowCount).toBeNull();
    expect(recorded.map((r) => r.kind)).toEqual(["rows"]);
    expect(recorded.find((r) => r.kind === "rows")?.head).toBe(false);
    expect(block.rows[0].sales_order_date).toBeNull();
    expect(rpcCalls).toEqual([{
      name: "get_dam_order_sales_order_dates",
      args: { p_line_ids: ["line-1"] },
    }]);
  });

  it("matches reversed RPC results to exact line IDs and leaves missing dates blank", async () => {
    rowBehaviour = async () => ({
      data: [{ order_line_id: "line-1" }, { order_line_id: "line-2" }],
      error: null,
    });
    salesOrderDateBehaviour = async () => ({
      data: [
        { order_line_id: "line-2", sales_order_date: null },
        { order_line_id: "line-1", sales_order_date: "2026-10-09" },
      ],
      error: null,
    });

    const block = await fetchOrderListBlock({ startRow: 500, endRow: 502 });

    expect(block.rows.map((row) => [row.order_line_id, row.sales_order_date])).toEqual([
      ["line-1", "2026-10-09"],
      ["line-2", null],
    ]);
    expect(rpcCalls[0].args).toEqual({ p_line_ids: ["line-1", "line-2"] });
  });

  it("keeps OrderList rows visible when the optional SO date RPC fails", async () => {
    const rpcError = new Error("date RPC unavailable");
    salesOrderDateBehaviour = async () => ({ data: null, error: rpcError });

    const block = await fetchOrderListBlock({ startRow: 0, endRow: 1 });
    expect(block.rows).toEqual([{ order_line_id: "line-1", sales_order_date: null }]);
    expect(block.salesOrderDatesError).toMatch(/SO Date could not be loaded/);

    const rowSelect = recorded.find((r) => r.kind === "rows")?.select ?? "";
    expect(rowSelect).not.toContain("sales_order_date");
    expect(rowSelect).toContain("order_date");

    salesOrderDateBehaviour = async (args) => ({
      data: args.p_line_ids.map((order_line_id: string) => ({ order_line_id, sales_order_date: "2026-10-09" })),
      error: null,
    });
    const retried = await fetchOrderListBlock({ startRow: 0, endRow: 1 });
    expect(retried.rows[0].sales_order_date).toBe("2026-10-09");
    expect(retried.salesOrderDatesError).toBeNull();
  });

  it("turns invalid sidecar payloads into visible date warnings while keeping rows", async () => {
    salesOrderDateBehaviour = async () => ({
      data: [{ order_line_id: "line-1", sales_order_date: "2026-02-30" }],
      error: null,
    });
    const block = await fetchOrderListBlock({ startRow: 0, endRow: 1 });
    expect(block.rows).toEqual([{ order_line_id: "line-1", sales_order_date: null }]);
    expect(block.salesOrderDatesError).toMatch(/SO Date could not be loaded/);
  });

  it("clears a block warning after a successful retry without clearing other failures", () => {
    const failed = updateOrderListSalesDateErrors({}, "view-a", 0, "SO Date unavailable");
    const anotherFailed = updateOrderListSalesDateErrors(failed, "view-a", 500, "SO Date unavailable");
    expect(updateOrderListSalesDateErrors(anotherFailed, "view-a", 0, null)).toEqual({ "view-a:500": "SO Date unavailable" });
    expect(updateOrderListSalesDateErrors({ "view-a:500": "SO Date unavailable" }, "view-a", 500, null)).toEqual({});
    expect(updateOrderListSalesDateErrors(anotherFailed, "view-b", 0, null)).toEqual(anotherFailed);
  });

  it("keeps the sidecar request inside the RPC's 1,500-line limit and still returns rows", async () => {
    rowBehaviour = async () => ({
      data: Array.from({ length: 1501 }, (_, index) => ({ order_line_id: `line-${index}` })),
      error: null,
    });

    const block = await fetchOrderListBlock({ startRow: 0, endRow: 1501 });
    expect(block.rows).toHaveLength(1501);
    expect(block.rows.every((row) => row.sales_order_date === null)).toBe(true);
    expect(block.salesOrderDatesError).toMatch(/SO Date could not be loaded/);
    expect(rpcCalls).toEqual([]);
  });

  it("keeps primary OrderList failures fatal", async () => {
    const rowError = new Error("OrderList rows unavailable");
    rowBehaviour = async () => ({ data: [], error: rowError });

    await expect(fetchOrderListBlock({ startRow: 0, endRow: 100 })).rejects.toBe(rowError);
    expect(rpcCalls).toEqual([]);
  });
});

describe("OrderList 12-month window", () => {
  it("hides orders older than the window start but keeps orders with no window date", async () => {
    await fetchOrderListBlock({ startRow: 0, endRow: 100, orderWindowStart: "2025-10-15" });

    expect(orCalls).toEqual(["order_window_date.is.null,order_window_date.gte.2025-10-15"]);
  });

  it("adds no window clause when old orders are shown", async () => {
    await fetchOrderListBlock({ startRow: 0, endRow: 100, orderWindowStart: null });

    expect(orCalls).toEqual([]);
  });
});
