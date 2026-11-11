import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getResult,
  reportResult,
  requestSnapshotRestore,
  requestSnapshotVersions,
  RESTORE_REQUEST_KEY,
  RESTORE_RESULT_KEY,
  snapshotCommands,
  VERSIONS_REQUEST_KEY,
  VERSIONS_RESULT_KEY,
} from "../snapshot-requests.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const SNAP = "GMT-04-2026.05.29-18.15.01";

function fakeDb() {
  const assets: Record<string, { id: string; relative_path: string; filename: string }> = {
    [A]: { id: A, relative_path: "Decor/Cust Adopted/Ross/a.psd", filename: "a.psd" },
    [B]: { id: B, relative_path: "Decor/Other/b.psd", filename: "b.psd" },
  };
  const cands: Record<string, string[]> = {
    [A]: ["Decor/Cust Adopted/Ross/a.psd", "Decor/Customer Adopted/Ross/a.psd"],
    [B]: ["Decor/Other/b.psd"],
  };
  const config = new Map<string, Record<string, unknown>>();
  const db = {
    config,
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, v: string) => ({
          maybeSingle: async () =>
            table === "assets"
              ? { data: assets[v] ?? null }
              : { data: config.has(v) ? { value: config.get(v) } : null },
        }),
      }),
      upsert: async (row: { key: string; value: Record<string, unknown> }) => {
        config.set(row.key, row.value);
        return { error: null };
      },
    }),
    rpc: async (_fn: string, args: { p_asset_id: string }) => ({ data: cands[args.p_asset_id] ?? [], error: null }),
  };
  return db;
}

describe("snapshot restore requests (popdam3#963)", () => {
  it("restore source must be one of the asset's candidate paths", async () => {
    const db = fakeDb();
    const r = await requestSnapshotRestore(db, { asset_id: A, snapshot: SNAP, source_path: "Decor/Other/b.psd" }, "u");
    expect(r.status).toBe(400);
    expect(db.config.has(RESTORE_REQUEST_KEY)).toBe(false);
    const ok = await requestSnapshotRestore(db, { asset_id: A, snapshot: SNAP, source_path: "Decor/Customer Adopted/Ross/a.psd" }, "u");
    expect(ok.status).toBe(200);
  });

  it("rejects snapshot names that are not GMT-stamped", async () => {
    const db = fakeDb();
    for (const snapshot of ["../../etc", `${SNAP}/..`, "", "x".repeat(300)]) {
      const r = await requestSnapshotRestore(db, { asset_id: A, snapshot, source_path: "Decor/Cust Adopted/Ross/a.psd" }, "u");
      expect(r.status).toBe(400);
    }
  });

  it("destination is never taken from the request", async () => {
    const db = fakeDb();
    await requestSnapshotRestore(db, {
      asset_id: A, snapshot: SNAP, source_path: "Decor/Customer Adopted/Ross/a.psd",
      destination_dir: "../../etc", destination: "/tmp",
    }, "u");
    expect(db.config.get(RESTORE_REQUEST_KEY)?.destination_dir).toBe("Decor/Cust Adopted/Ross");
  });

  it("non-admin cannot list or restore", () => {
    const src = readFileSync(new URL("../../admin-api/index.ts", import.meta.url), "utf-8");
    const block = src.slice(src.indexOf("const USER_ACCESSIBLE_ACTIONS"), src.indexOf("]);", src.indexOf("const USER_ACCESSIBLE_ACTIONS")));
    for (const a of ["request-snapshot-versions", "get-snapshot-versions-result", "request-snapshot-restore", "get-snapshot-restore-result"]) {
      expect(src).toContain(`case "${a}"`);
      expect(block).not.toContain(a);
    }
    expect(src).toMatch(/USER_ACCESSIBLE_ACTIONS\.has\(action\) \? await authenticateUser\(req\) : await authenticateAdmin\(req\)/);
  });

  it("versions request carries server-computed candidates and is delivered to the bridge", async () => {
    const db = fakeDb();
    const r = await requestSnapshotVersions(db, { asset_id: A, candidates: ["evil"] }, "u");
    expect(r.status).toBe(200);
    const cmds = snapshotCommands(Object.fromEntries(db.config));
    expect(cmds.snapshot_versions?.candidates).toEqual(["Decor/Cust Adopted/Ross/a.psd", "Decor/Customer Adopted/Ross/a.psd"]);
    expect(cmds.snapshot_restore).toBeNull();
    // a second request while the first is pending is refused, not overwritten
    expect((await requestSnapshotVersions(db, { asset_id: B }, "u2")).status).toBe(409);
  });

  it("snapshot report with wrong request_id is ignored", async () => {
    const db = fakeDb();
    const { body } = await requestSnapshotVersions(db, { asset_id: A }, "u");
    const stale = await reportResult(db, VERSIONS_REQUEST_KEY, VERSIONS_RESULT_KEY, { request_id: "foreign", versions: [{}] });
    expect(stale.body.ignored).toBe(true);
    expect(db.config.get(VERSIONS_REQUEST_KEY)?.status).toBe("pending");
    expect(db.config.has(VERSIONS_RESULT_KEY)).toBe(false);
    await reportResult(db, VERSIONS_REQUEST_KEY, VERSIONS_RESULT_KEY, { request_id: body.request_id, ok: true, versions: [] });
    expect(db.config.get(VERSIONS_REQUEST_KEY)?.status).toBe("completed");
    expect((await getResult(db, VERSIONS_RESULT_KEY, { request_id: "other" })).body.result).toBeNull();
    expect((await getResult(db, VERSIONS_RESULT_KEY, { request_id: body.request_id })).body.result).toMatchObject({ ok: true });
    // restore result path too
    await requestSnapshotRestore(db, { asset_id: A, snapshot: SNAP, source_path: "Decor/Cust Adopted/Ross/a.psd" }, "u");
    expect((await reportResult(db, RESTORE_REQUEST_KEY, RESTORE_RESULT_KEY, { request_id: "x" })).body.ignored).toBe(true);
  });

  it("a restored copy with a suffixed name is ingested as a new asset, not as a move", () => {
    // Move detection requires same quick_hash AND same filename; the restore suffix changes the name.
    const src = readFileSync(new URL("../../agent-api/index.ts", import.meta.url), "utf-8");
    const i = src.indexOf("Move detection: same file relocated");
    const block = src.slice(i, i + 4000);
    expect(block).toMatch(/\.eq\("quick_hash", quickHash\)\s*\.eq\("filename", filename\)/);
    const bridge = readFileSync(new URL("../../../../apps/bridge-agent/src/handlers/snapshot-tools.ts", import.meta.url), "utf-8");
    expect(bridge).toMatch(/\(restored \$\{day\}/);
  });

  it("agent-api wires snapshot keys, delivery and report routes", () => {
    const src = readFileSync(new URL("../../agent-api/index.ts", import.meta.url), "utf-8");
    expect(src).toContain('"SNAPSHOT_VERSIONS_REQUEST"');
    expect(src).toContain('"SNAPSHOT_RESTORE_REQUEST"');
    expect(src).toContain('case "report-snapshot-versions"');
    expect(src).toContain('case "report-snapshot-restore"');
    expect(src).toContain("snapshotCommands(configMap)");
  });
});
