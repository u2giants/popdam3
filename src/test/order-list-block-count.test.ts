import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Loading visible rows must never start or wait for an exact whole-view count.
 * Under production concurrency that count made the bounded block time out too.
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

const { fetchOrderListBlock } = await import("@/hooks/useOrderList");

beforeEach(() => {
  recorded.length = 0;
  countBehaviour = async () => ({ count: 24486, error: null });
});

describe("OrderList block loading", () => {
  it("loads only the bounded rows and does not request an exact count", async () => {
    const block = await fetchOrderListBlock({ startRow: 0, endRow: 100 });

    expect(block.rows).toHaveLength(1);
    expect(block.totalRowCount).toBeNull();
    expect(recorded.map((r) => r.kind)).toEqual(["rows"]);
    expect(recorded.find((r) => r.kind === "rows")?.head).toBe(false);
  });
});
