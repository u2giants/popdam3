import { describe, expect, it, vi } from "vitest";

vi.mock("../http.ts", () => ({ json: (b: unknown) => b, err: (m: string) => ({ error: m }) }));
vi.mock("../service-client.ts", () => ({ serviceClient: () => ({}) }));
vi.mock("../sku-parser.ts", () => ({ parseSku: async () => null }));
vi.mock("../metadata-derivation.ts", () => ({ deriveMetadataFromPath: async () => ({}) }));
vi.mock("../licensing-resolution.ts", () => ({ loadAuthoritativeLicensingMaps: async () => ({}), resolveAuthoritativeLicensing: async () => ({}) }));
import { fillMissingLicensing, type FillLicensingDeps } from "./metadata-handlers.ts";

type Row = Record<string, unknown>;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fakeDb(rows: Row[], opts: { failUpdateFor?: string; raceFor?: string } = {}) {
  const updates: { id: string; values: Row }[] = [];
  const selectChain = () => {
    const filters: ((r: Row) => boolean)[] = [];
    let lim = Infinity;
    const chain: Record<string, unknown> = {
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
      is: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
      gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), chain),
      order: () => chain,
      limit: (n: number) => { lim = n; return chain; },
      then: (res: (v: unknown) => void) => res({ data: rows.filter((r) => filters.every((f) => f(r))).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, lim).map((r) => ({ ...r })), error: null }),
    };
    return chain;
  };
  const updateChain = (values: Row) => {
    let target = "";
    const guards: [string, unknown][] = [];
    const chain: Record<string, unknown> = {
      eq: (_c: string, v: string) => { target = v; return chain; },
      is: (c: string, v: unknown) => { guards.push([c, v]); return chain; },
      select: async () => {
        if (target === opts.failUpdateFor) return { data: null, error: { message: "boom" } };
        const row = rows.find((r) => r.id === target)!;
        if (target === opts.raceFor) row.licensor_id = "someone-else";
        if (!guards.every(([c, v]) => row[c] === v)) return { data: [], error: null };
        Object.assign(row, values);
        updates.push({ id: target, values });
        return { data: [{ id: target }], error: null };
      },
    };
    return chain;
  };
  return { db: { from: () => ({ select: () => selectChain(), update: (v: Row) => updateChain(v) }) }, updates };
}

const asset = (n: number, extra: Row = {}): Row => ({
  id: id(n), filename: `F${n}.tif`, file_created_at: null, is_licensed: true, is_deleted: false,
  licensor_id: null, licensor_code: null, licensor_name: null, property_id: null, property_code: null, property_name: null,
  sku: "KEEP", mg01_name: "KEEP", ...extra,
});

const deps = (resolveBy: (filename: string) => Row): FillLicensingDeps => ({
  parse: (async (f: string) => ({ sku: f })) as unknown as FillLicensingDeps["parse"],
  loadMaps: (async () => ({})) as unknown as FillLicensingDeps["loadMaps"],
  resolve: (async (_db: unknown, _l: boolean, p: { sku: string }) => resolveBy(p.sku)) as unknown as FillLicensingDeps["resolve"],
});
const full = { licensor_id: "L", licensor_code: "LC", licensor_name: "Lic", property_id: "P", property_code: "PC", property_name: "Prop", unresolved_licensor: false, unresolved_property: false };

describe("fillMissingLicensing", () => {
  it("fills only NULL licensing columns and never touches other fields or existing values", async () => {
    const rows = [asset(1), asset(2, { property_id: "EXISTING", property_name: "Keep" })];
    const { db } = fakeDb(rows);
    const out = await fillMissingLicensing({ batch_size: 10 }, db, deps(() => full));
    expect(out).toMatchObject({ ok: true, done: true, updated: 2 });
    expect(rows[0]).toMatchObject({ licensor_id: "L", property_id: "P", sku: "KEEP", mg01_name: "KEEP" });
    expect(rows[1]).toMatchObject({ licensor_id: "L", property_id: "EXISTING", property_name: "Keep", property_code: "PC" });
  });

  it("skips unresolved licensors and never writes NULLs", async () => {
    const rows = [asset(1)];
    const { db, updates } = fakeDb(rows);
    const out = await fillMissingLicensing({}, db, deps(() => ({ ...full, licensor_id: null, unresolved_licensor: true })));
    expect(out).toMatchObject({ updated: 0, unresolved_licensor: 1 });
    expect(updates).toHaveLength(0);
  });

  it("keysets by id after the cursor and ignores rows that already have a licensor", async () => {
    const rows = [asset(1), asset(2), asset(3, { licensor_id: "X" }), asset(4), asset(5, { is_licensed: false })];
    const { db } = fakeDb(rows);
    const first = await fillMissingLicensing({ batch_size: 1 }, db, deps(() => full));
    expect(first).toMatchObject({ done: false, nextOffset: id(1) });
    const second = await fillMissingLicensing({ batch_size: 5, after_id: id(1) }, db, deps(() => full));
    expect(second).toMatchObject({ done: true, total: 2, updated: 2 });
    expect(rows[2].licensor_id).toBe("X");
    expect(rows[4].licensor_id).toBeNull();
  });

  it("loses to a concurrent writer instead of overwriting it", async () => {
    const rows = [asset(1)];
    const { db } = fakeDb(rows, { raceFor: id(1) });
    const out = await fillMissingLicensing({}, db, deps(() => full));
    expect(out.updated).toBe(0);
    expect(rows[0].licensor_id).toBe("someone-else");
  });

  it("fails the batch when a row update fails", async () => {
    const { db } = fakeDb([asset(1)], { failUpdateFor: id(1) });
    await expect(fillMissingLicensing({}, db, deps(() => full))).rejects.toThrow(/boom/);
  });

  it("rejects a malformed cursor", async () => {
    const { db } = fakeDb([]);
    await expect(fillMissingLicensing({ after_id: "x;drop" }, db, deps(() => full))).rejects.toThrow(/UUID/);
  });
});
