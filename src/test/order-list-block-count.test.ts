import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Loading visible rows must never start or wait for an exact whole-view count.
 * Under production concurrency that count made the bounded block time out too.
 */

type Recorded = { kind: "rows" | "count"; select: string; head: boolean };
const recorded: Recorded[] = [];
const rpcCalls: Array<{ name: string; args: any }> = [];
const orCalls: string[] = [];
let lastRows: any[] = [];

let rowBehaviour: () => Promise<{ data: any[]; error: unknown }> = async () => ({
  data: [{ order_line_id: "line-1" }],
  error: null,
});

let salesOrderDateBehaviour: (args: any) => Promise<{ data: any[] | null; error: unknown }> = async (args) => ({
  data: args.p_line_ids.map((order_line_id: string) => ({ order_line_id, sales_order_date: null })),
  error: null,
});
let assortmentQuantityBehaviour: (args: any) => Promise<{ data: unknown; error: unknown }> = async () => ({ data: [], error: null });

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
    range: async () => {
      const result = await rowBehaviour();
      lastRows = result.data ?? [];
      return result;
    },
    in: async (_column: string, ids: string[]) => ({
      data: lastRows.filter((row) => ids.includes(row.order_line_id)),
      error: null,
    }),
    then: (resolve: any, reject: any) => countBehaviour().then(resolve, reject),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      return name === "get_dam_order_sales_order_dates"
        ? salesOrderDateBehaviour(args)
        : assortmentQuantityBehaviour(args);
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
  assortmentQuantityBehaviour = async () => ({ data: [], error: null });
  countBehaviour = async () => ({ count: 24486, error: null });
});

describe("OrderList block loading", () => {
  it("loads only the bounded rows and does not request an exact count", async () => {
    const block = await fetchOrderListBlock({ startRow: 0, endRow: 100 });

    expect(block.rows).toHaveLength(1);
    expect(block.totalRowCount).toBeNull();
    expect(recorded.map((r) => r.kind)).toEqual(["rows", "rows"]);
    expect(recorded[0].select).toBe("order_line_id");
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
    expect(block.rows).toEqual([{ order_line_id: "line-1", sales_order_date: null, assortment_sku_quantity: null, assortment_quantity_source: null }]);
    expect([block.salesOrderDatesError, block.assortmentQuantitiesError].filter(Boolean)).toContain("SO Date could not be loaded. Refresh OrderList to try again.");

    const rowSelect = recorded.filter((r) => r.kind === "rows").at(-1)?.select ?? "";
    expect(rowSelect).not.toContain("sales_order_date");
    expect(rowSelect).toContain("order_date");

    salesOrderDateBehaviour = async (args) => ({
      data: args.p_line_ids.map((order_line_id: string) => ({ order_line_id, sales_order_date: "2026-10-09" })),
      error: null,
    });
    const retried = await fetchOrderListBlock({ startRow: 0, endRow: 1 });
    expect(retried.rows[0].sales_order_date).toBe("2026-10-09");
    expect([retried.salesOrderDatesError, retried.assortmentQuantitiesError].filter(Boolean)).toEqual([]);
  });

  it("turns invalid sidecar payloads into visible date warnings while keeping rows", async () => {
    salesOrderDateBehaviour = async () => ({
      data: [{ order_line_id: "line-1", sales_order_date: "2026-02-30" }],
      error: null,
    });
    const block = await fetchOrderListBlock({ startRow: 0, endRow: 1 });
    expect(block.rows).toEqual([{ order_line_id: "line-1", sales_order_date: null, assortment_sku_quantity: null, assortment_quantity_source: null }]);
    expect([block.salesOrderDatesError, block.assortmentQuantitiesError].filter(Boolean)).toContain("SO Date could not be loaded. Refresh OrderList to try again.");
  });

  it("clears a block warning after a successful retry without clearing other failures", () => {
    const failed = updateOrderListSalesDateErrors({}, "view-a", 0, "SO Date unavailable\nQuantity unavailable");
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
    expect([block.salesOrderDatesError, block.assortmentQuantitiesError].filter(Boolean)).toContain("SO Date could not be loaded. Refresh OrderList to try again.");
    expect(rpcCalls).toEqual([]);
  });

  it("keeps primary OrderList failures fatal", async () => {
    const rowError = new Error("OrderList rows unavailable");
    rowBehaviour = async () => ({ data: [], error: rowError });

    await expect(fetchOrderListBlock({ startRow: 0, endRow: 100 })).rejects.toBe(rowError);
    expect(rpcCalls).toEqual([]);
  });

  it("matches quantities by exact IDs and skips the reader for non-assortment rows", async () => {
    rowBehaviour = async () => ({ data: [
      { order_line_id: "line-a", assortment_id: "AS-1" },
      { order_line_id: "line-b", assortment_id: "AS-2" },
      { order_line_id: "line-c", assortment_id: "  " },
    ], error: null });
    salesOrderDateBehaviour = async (args) => ({
      data: args.p_line_ids.map((order_line_id: string) => ({ order_line_id, sales_order_date: "2026-10-09" })), error: null,
    });
    assortmentQuantityBehaviour = async (args) => ({ data: [
      { order_line_id: "line-a", assortment_sku_quantity: 12, quantity_source: "current_recipe" },
    ], error: null });

    const block = await fetchOrderListBlock({ startRow: 0, endRow: 2 });
    expect(block.rows.map((row) => [row.order_line_id, row.sales_order_date, row.assortment_sku_quantity, row.assortment_quantity_source])).toEqual([
      ["line-a", "2026-10-09", 12, "current_recipe"], ["line-b", "2026-10-09", null, null], ["line-c", "2026-10-09", null, null],
    ]);
    expect(rpcCalls).toContainEqual({ name: "get_dam_order_assortment_quantities", args: { p_line_ids: ["line-a", "line-b"] } });

    assortmentQuantityBehaviour = async () => ({ data: [], error: null });
    const empty = await fetchOrderListBlock({ startRow: 0, endRow: 2 });
    expect(empty.rows.every((row) => row.assortment_sku_quantity === null && row.assortment_quantity_source === null)).toBe(true);
    expect(empty.assortmentQuantitiesError).toBeNull();
  });

  it("keeps dates and rows intact when quantity data is null, then recovers on refresh", async () => {
    rowBehaviour = async () => ({ data: [{ order_line_id: "line-a", assortment_id: "AS-1" }], error: null });
    salesOrderDateBehaviour = async () => ({ data: [{ order_line_id: "line-a", sales_order_date: "2026-10-09" }], error: null });
    for (const data of [null, undefined]) {
      assortmentQuantityBehaviour = async () => ({ data, error: null });
      const failed = await fetchOrderListBlock({ startRow: 0, endRow: 1 });
      expect(failed.rows[0]).toMatchObject({ order_line_id: "line-a", sales_order_date: "2026-10-09", assortment_sku_quantity: null });
      expect([failed.salesOrderDatesError, failed.assortmentQuantitiesError].filter(Boolean)).toEqual(["SKU quantity in assortment could not be loaded. Refresh OrderList to try again."]);
    }

    assortmentQuantityBehaviour = async () => ({ data: [{ order_line_id: "line-a", assortment_sku_quantity: 6, quantity_source: "order_recipe" }], error: null });
    const recovered = await fetchOrderListBlock({ startRow: 0, endRow: 1 });
    expect(recovered.rows[0]).toMatchObject({ sales_order_date: "2026-10-09", assortment_sku_quantity: 6, assortment_quantity_source: "order_recipe" });
    expect([recovered.salesOrderDatesError, recovered.assortmentQuantitiesError].filter(Boolean)).toEqual([]);
  });

  it("starts date and quantity lookups concurrently and preserves quantity when dates fail", async () => {
    rowBehaviour = async () => ({ data: [{ order_line_id: "line-a", assortment_id: "AS-1" }], error: null });
    let releaseDates!: (value: { data: null; error: Error }) => void;
    const waitingForDates = new Promise<{ data: null; error: Error }>((resolve) => { releaseDates = resolve; });
    let datesStarted = false;
    let quantitiesStarted = false;
    salesOrderDateBehaviour = async () => {
      datesStarted = true;
      return waitingForDates;
    };
    assortmentQuantityBehaviour = async () => {
      quantitiesStarted = true;
      return { data: [{ order_line_id: "line-a", assortment_sku_quantity: 8, quantity_source: "order_recipe" }], error: null };
    };

    const pending = fetchOrderListBlock({ startRow: 0, endRow: 1 });
    await vi.waitFor(() => expect(quantitiesStarted).toBe(true));
    expect(datesStarted).toBe(true);
    releaseDates({ data: null, error: new Error("date RPC unavailable") });
    const block = await pending;

    expect(block.rows[0]).toMatchObject({ sales_order_date: null, assortment_sku_quantity: 8, assortment_quantity_source: "order_recipe" });
    expect(block.salesOrderDatesError).toContain("SO Date could not be loaded");
    expect(block.assortmentQuantitiesError).toBeNull();
  });

  it("warns on duplicate or invalid quantity payloads without losing successful dates", async () => {
    rowBehaviour = async () => ({ data: [{ order_line_id: "line-a", assortment_id: "AS-1" }], error: null });
    salesOrderDateBehaviour = async () => ({ data: [{ order_line_id: "line-a", sales_order_date: "2026-10-09" }], error: null });
    for (const data of [
      [{ order_line_id: "line-a", assortment_sku_quantity: 2, quantity_source: "order_recipe" }, { order_line_id: "line-a", assortment_sku_quantity: 2, quantity_source: "order_recipe" }],
      [{ order_line_id: "other", assortment_sku_quantity: 2, quantity_source: "order_recipe" }],
      [{ order_line_id: "line-a", assortment_sku_quantity: "2", quantity_source: "order_recipe" }],
      [{ order_line_id: "line-a", assortment_sku_quantity: true, quantity_source: "order_recipe" }],
      [{ order_line_id: "line-a", assortment_sku_quantity: 0, quantity_source: "order_recipe" }],
      [{ order_line_id: "line-a", assortment_sku_quantity: -1, quantity_source: "order_recipe" }],
      [{ order_line_id: "line-a", assortment_sku_quantity: Infinity, quantity_source: "order_recipe" }],
      [{ order_line_id: "line-a", assortment_sku_quantity: 2, quantity_source: "other_recipe" }],
      [{ order_line_id: "line-a", assortment_sku_quantity: 2, quantity_source: null }],
    ]) {
      assortmentQuantityBehaviour = async () => ({ data, error: null });
      const block = await fetchOrderListBlock({ startRow: 0, endRow: 1 });
      expect(block.rows[0]).toMatchObject({ sales_order_date: "2026-10-09", assortment_sku_quantity: null });
      expect([block.salesOrderDatesError, block.assortmentQuantitiesError].filter(Boolean)).toContain("SKU quantity in assortment could not be loaded. Refresh OrderList to try again.");
    }
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
