import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The rows and the exact total are two separate requests. Counting this view
 * exactly is ~40x more expensive than fetching a block of rows, and asking for
 * both in one request timed out the whole grid in production on 2026-08-26.
 */

type Recorded = { kind: "rows" | "count"; select: string; head: boolean };
const recorded: Recorded[] = [];

let countBehaviour: () => Promise<{ count: number | null; error: unknown }> = async () => ({
  count: 24486,
  error: null,
});

function builder(kind: "rows" | "count", head: boolean) {
  const chain: any = {
    is: () => chain,
    not: () => chain,
    filter: () => chain,
    or: () => chain,
    order: () => chain,
    range: async () => ({ data: [{ order_line_id: "line-1" }], error: null }),
    then: (resolve: any, reject: any) => countBehaviour().then(resolve, reject),
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
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

const { clearOrderListCountCache, fetchOrderListBlock } = await import("@/hooks/useOrderList");

beforeEach(() => {
  recorded.length = 0;
  clearOrderListCountCache();
  countBehaviour = async () => ({ count: 24486, error: null });
});

describe("OrderList block loading", () => {
  it("asks for the rows and the count as two separate requests", async () => {
    const block = await fetchOrderListBlock({ startRow: 0, endRow: 100 });

    expect(block.rows).toHaveLength(1);
    expect(block.totalRowCount).toBe(24486);
    expect(recorded.map((r) => r.kind).sort()).toEqual(["count", "rows"]);
    // The row request must not carry a count, or the split buys nothing.
    expect(recorded.find((r) => r.kind === "rows")?.head).toBe(false);
    expect(recorded.find((r) => r.kind === "count")?.head).toBe(true);
  });

  it("still returns the rows when the count times out", async () => {
    countBehaviour = async () => ({
      count: null,
      error: { message: "canceling statement due to statement timeout" },
    });

    const block = await fetchOrderListBlock({ startRow: 0, endRow: 100 });

    // The screen renders. An unknown total is reported as unknown, never as 0.
    expect(block.rows).toHaveLength(1);
    expect(block.totalRowCount).toBeNull();
  });

  it("still returns the rows when the count request rejects outright", async () => {
    countBehaviour = async () => {
      throw new Error("network down");
    };

    const block = await fetchOrderListBlock({ startRow: 0, endRow: 100 });

    expect(block.rows).toHaveLength(1);
    expect(block.totalRowCount).toBeNull();
  });

  it("counts one result set once, however many blocks are scrolled", async () => {
    await fetchOrderListBlock({ startRow: 0, endRow: 100, search: "acme" });
    await fetchOrderListBlock({ startRow: 100, endRow: 200, search: "acme" });

    expect(recorded.filter((r) => r.kind === "count")).toHaveLength(1);
    expect(recorded.filter((r) => r.kind === "rows")).toHaveLength(2);
  });

  it("counts again when the result set changes", async () => {
    await fetchOrderListBlock({ startRow: 0, endRow: 100, search: "acme" });
    await fetchOrderListBlock({ startRow: 0, endRow: 100, search: "other" });

    expect(recorded.filter((r) => r.kind === "count")).toHaveLength(2);
  });
});
