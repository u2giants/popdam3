import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #470 / #804: get-filter-options used to run one exact count query per
 * licensor and per property (~205 per uncached call). It now reads every count
 * from one grouped RPC, cached briefly per scope, with the response shape
 * unchanged.
 */

const dbCalls: string[] = [];

vi.mock("../admin-utils.ts", () => ({
  json: (value: unknown) => ({ status: 200, value }),
  err: (error: string, status = 400) => ({ status, error }),
  requireString: (_b: Record<string, unknown>, key: string) => _b[key],
  optionalString: (_b: Record<string, unknown>, key: string) => _b[key],
  formatPostgrestError: (error: unknown) => String(error),
  serviceClient: () => makeDb(),
}));
vi.mock("../admin-config-secret.ts", () => ({ redactAdminConfigValues: (v: unknown) => v }));

function makeDb() {
  const chain = (label: string, rows: unknown[]) => {
    const builder: Record<string, unknown> = {};
    const step = (name: string) => {
      dbCalls.push(`${label}:${name}`);
      return builder;
    };
    builder.select = (columns: string, _opts?: unknown) => {
      dbCalls.push(`${label}:select(${columns})`);
      return builder;
    };
    builder.eq = (col: string, value: unknown) => step(`eq(${col},${String(value)})`);
    builder.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(onFulfilled);
    return builder;
  };
  return {
    schema: (_schema: string) => ({
      from: (table: string) => {
        if (table === "licensor") {
          return chain("core.licensor", [
            { id: "lic-1", name: "Disney" },
            { id: "lic-2", name: "Marvel" },
          ]);
        }
        return chain(`core.${table}`, [
          { id: "prop-1", name: "Mickey", licensor_id: "lic-1" },
        ]);
      },
    }),
    from: (table: string) => {
      throw new Error(`unexpected per-entity read of ${table}`);
    },
    rpc: (name: string) => {
      dbCalls.push(`rpc:${name}`);
      return Promise.resolve({
        data: { licensors: { "lic-1": 7 }, properties: { "prop-1": 5, "prop-other": 9 } },
        error: null,
      });
    },
  };
}

import { clearFilterOptionsCache, handleGetFilterOptions } from "./agent-handlers.ts";

beforeEach(() => {
  dbCalls.length = 0;
  clearFilterOptionsCache();
});

describe("get-filter-options", () => {
  it("keeps the response shape and filters zero-count entities", async () => {
    const response = await handleGetFilterOptions({}) as { status: number; value: { ok: boolean; licensors: unknown[]; properties: unknown[] } };
    expect(response.status).toBe(200);
    expect(response.value.ok).toBe(true);
    expect(response.value.licensors).toEqual([
      { id: "lic-1", name: "Disney", asset_count: 7 },
    ]);
    expect(response.value.properties).toEqual([
      { id: "prop-1", name: "Mickey", licensor_id: "lic-1", asset_count: 5 },
    ]);
    // One grouped count, never one query per entity.
    expect(dbCalls.filter((c) => c.startsWith("rpc:"))).toEqual(["rpc:get_dam_asset_taxonomy_counts"]);
  });

  it("serves a repeat call from the cache without re-reading the database", async () => {
    await handleGetFilterOptions({});
    const afterFirst = dbCalls.length;
    expect(afterFirst).toBeGreaterThan(0);
    const second = await handleGetFilterOptions({}) as { status: number; value: { licensors: unknown[] } };
    expect(second.status).toBe(200);
    expect(dbCalls.length).toBe(afterFirst);
  });

  it("caches licensor-scoped calls separately", async () => {
    await handleGetFilterOptions({ licensor_id: "lic-1" });
    const afterFirst = dbCalls.length;
    await handleGetFilterOptions({});
    expect(dbCalls.length).toBeGreaterThan(afterFirst);
  });
});
