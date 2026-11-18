import { describe, expect, it } from "vitest";
import { fetchAllPopSGFolderRows } from "./popsgFolderRows";

// Simulates PostgREST: ignores requests above a server cap, like max_rows.
function serverWith(rows: { licensor_name: string; property_folder: string }[], cap: number) {
  const calls: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to, from + cap - 1, rows.length - 1);
    return { data: end < from ? [] : rows.slice(from, end + 1), error: null };
  };
  return { fetchPage, calls };
}

const many = Array.from({ length: 2300 }, (_, i) => ({
  licensor_name: `Licensor ${String(i).padStart(4, "0")}`,
  property_folder: `Property ${i}`,
}));

describe("fetchAllPopSGFolderRows (#1103)", () => {
  it("returns every row when the server caps each page below the page size", async () => {
    const { fetchPage } = serverWith(many, 1000);
    const rows = await fetchAllPopSGFolderRows(fetchPage, 500);
    expect(rows).toHaveLength(2300);
    expect(rows[2299]).toEqual(many[2299]);
  });

  it("keeps names that sit after the first 1000 rows", async () => {
    const { fetchPage } = serverWith(many, 1000);
    const rows = await fetchAllPopSGFolderRows(fetchPage, 1000);
    expect(rows.some((r) => r.licensor_name === "Licensor 1500")).toBe(true);
  });

  it("stops after the first empty page and does not re-request past the end", async () => {
    const { fetchPage, calls } = serverWith(many.slice(0, 10), 1000);
    const rows = await fetchAllPopSGFolderRows(fetchPage, 500);
    expect(rows).toHaveLength(10);
    expect(calls).toEqual([[0, 499], [500, 999]]);
  });

  it("throws on a server error instead of returning partial rows", async () => {
    const fetchPage = async () => ({ data: null, error: new Error("timeout") });
    await expect(fetchAllPopSGFolderRows(fetchPage, 500)).rejects.toThrow("timeout");
  });
});
