import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #470: get-filter-options used to run one sequential count query per
 * licensor and per property (~205 per call since PR #820 opened it to every
 * signed-in user). PostgREST aggregates are disabled project-wide (PGRST123),
 * so the exact counts still come from narrow HEAD reads — now issued
 * concurrently and cached briefly per scope, with the response shape unchanged.
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
      if (table !== "assets") throw new Error(`unexpected table ${table}`);
      return {
        select: (columns: string, opts: { count?: string; head?: boolean } | undefined) => {
          dbCalls.push(`assets:select(${columns},${opts?.count ?? ""},head=${String(opts?.head)})`);
          const builder: Record<string, unknown> = {};
          builder.eq = (_col: string, _value: unknown) => builder;
          builder.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: 7 }).then(onFulfilled);
          return builder;
        },
      };
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
      { id: "lic-2", name: "Marvel", asset_count: 7 },
    ]);
    expect(response.value.properties).toEqual([
      { id: "prop-1", name: "Mickey", licensor_id: "lic-1", asset_count: 7 },
    ]);
    // Exact HEAD counts, not row bodies.
    expect(dbCalls.filter((c) => c.startsWith("assets:select(id,exact,head=true)"))).toHaveLength(3);
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
