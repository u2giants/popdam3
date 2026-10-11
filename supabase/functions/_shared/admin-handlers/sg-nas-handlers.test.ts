import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildSgNasUpserts,
  handleGetSgNasConfig,
  handleSetSgNasConfig,
  SG_NAS_PASSWORD_KEY,
  toSgNasConfigView,
} from "./sg-nas-handlers.ts";

const PASS = "test-fixture-pass";

function fakeDb(rows: { key: string; value: unknown }[]) {
  const upsert = vi.fn(async (newRows: { key: string; value: unknown }[]) => {
    for (const r of newRows) {
      const i = rows.findIndex((x) => x.key === r.key);
      if (i >= 0) rows[i] = { key: r.key, value: r.value };
      else rows.push({ key: r.key, value: r.value });
    }
    return { error: null };
  });
  const db = {
    from: () => ({
      select: () => ({
        in: async (_c: string, keys: string[]) => ({ data: rows.filter((r) => keys.includes(r.key)), error: null }),
      }),
      upsert,
    }),
  };
  return { db, upsert, rows };
}

describe("PopSG NAS config is write-only for the password (#194)", () => {
  it("view reports set/not set and never contains the password", () => {
    const view = toSgNasConfigView([
      { key: "WINDOWS_AGENT_SG_NAS_HOST", value: "nas" },
      { key: SG_NAS_PASSWORD_KEY, value: PASS },
    ]);
    expect(view.passwordSet).toBe(true);
    expect(view.host).toBe("nas");
    expect(JSON.stringify(view)).not.toContain(PASS);
    expect(toSgNasConfigView([]).passwordSet).toBe(false);
    expect(toSgNasConfigView([{ key: SG_NAS_PASSWORD_KEY, value: "" }]).passwordSet).toBe(false);
  });

  it("blank password keeps the stored one; a new one replaces it; clear empties it", () => {
    const keep = buildSgNasUpserts({ host: " h ", mountPath: "Y:\\\\" }, "t");
    if ("error" in keep) throw new Error(keep.error);
    expect(keep.rows.map((r) => r.key)).not.toContain(SG_NAS_PASSWORD_KEY);
    expect(keep.rows.find((r) => r.key === "WINDOWS_AGENT_SG_NAS_HOST")?.value).toBe("h");
    expect(keep.rows.find((r) => r.key === "WINDOWS_AGENT_SG_NAS_MOUNT_PATH")?.value).toBe("Y:");

    const replace = buildSgNasUpserts({ password: PASS }, "t");
    if ("error" in replace) throw new Error(replace.error);
    expect(replace.rows.find((r) => r.key === SG_NAS_PASSWORD_KEY)?.value).toBe(PASS);

    const clear = buildSgNasUpserts({ clearPassword: true }, "t");
    if ("error" in clear) throw new Error(clear.error);
    expect(clear.rows.find((r) => r.key === SG_NAS_PASSWORD_KEY)?.value).toBe("");

    expect("error" in buildSgNasUpserts({ password: 5 }, "t")).toBe(true);
  });

  it("saves every key in one upsert and returns no password", async () => {
    const { db, upsert, rows } = fakeDb([{ key: SG_NAS_PASSWORD_KEY, value: "old" }]);
    const view = await handleSetSgNasConfig(db, { host: "h", password: PASS });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(rows.find((r) => r.key === SG_NAS_PASSWORD_KEY)?.value).toBe(PASS);
    expect(JSON.stringify(view)).not.toContain(PASS);
    expect((await handleGetSgNasConfig(db)).passwordSet).toBe(true);
  });

  it("the PopSG settings page never reads the password key from admin_config", () => {
    const src = readFileSync(new URL("../../../../src/pages/popsg/PopSGSettingsPage.tsx", import.meta.url), "utf8");
    expect(src).not.toContain(SG_NAS_PASSWORD_KEY);
    expect(src).toContain("get-sg-nas-config");
  });

  it("admin-api routes the write-only endpoints", () => {
    const src = readFileSync(new URL("../../admin-api/index.ts", import.meta.url), "utf8");
    expect(src).toContain('case "get-sg-nas-config"');
    expect(src).toContain('case "set-sg-nas-config"');
  });
});
