import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addNasSavers, displayUser, pickSaver, pickTransfer, samePath, transferBounds, type NasEvent } from "./saved-by-nas.js";

const REL = "Decor/Character Licensed/Lidl/PJ6XDYMM01/TECHPACK/PJ6XDYMM01_PACKAGING.ai";
const MTIME = "2026-11-25T03:50:44.000Z";
const T = Math.floor(new Date(MTIME).getTime() / 1000);
const v = { source_path: REL, size: 1880115, mtime: MTIME, first_snapshot: "s", last_snapshot: "s", first_taken_at: MTIME, last_taken_at: MTIME, snapshot_count: 1 };
const smb = (dt: number, user: string, size: number, path = `/mac/${REL}`): NasEvent => ({ source: "smb", time: T + dt, username: user, action: "rename", size, path });

describe("saved-by from NAS logs (popdam3#1342)", () => {
  it("strips the domain", () => {
    assert.equal(displayUser("IML\\asilva"), "asilva");
    assert.equal(displayUser("ahazan"), "ahazan");
  });

  it("matches SMB paths (share prefix) and Drive paths, not look-alikes", () => {
    assert.equal(samePath(`/mac/${REL}`, REL), true);
    assert.equal(samePath(`/${REL}`, REL), true);
    assert.equal(samePath(`/mac/${REL}.bak6b065b19`, REL), false);
    assert.equal(samePath(`/mac/X${REL}`, REL), false);
  });

  it("picks the nearest same-size save on the same file", () => {
    const who = pickSaver(v, [smb(-200, "IML\\other", 1880115), smb(6, "IML\\asilva", 1880115), smb(1, "IML\\x", 99)]);
    assert.deepEqual(who, { name: "asilva", via: "smb", kind: "save" });
    assert.equal(pickSaver(v, [smb(900, "IML\\asilva", 1880115)]), null);
  });

  it("a Drive save matches by path and time", () => {
    const e: NasEvent = { source: "drive", time: T + 20, username: "IML\\aagudelo", action: "23", path: `/${REL}` };
    assert.deepEqual(pickSaver(v, [e]), { name: "aagudelo", via: "drive", kind: "save" });
  });

  it("does nothing without configuration and never fails the listing", async () => {
    assert.deepEqual(await addNasSavers([v], {}), [v]);
    const boom = async () => { throw new Error("down"); };
    assert.deepEqual(await addNasSavers([v], { url: "http://x", token: "t" }, boom), [v]);
  });

  it("adds the saver from the NAS API", async () => {
    let sent: Record<string, unknown> = {};
    const f = async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ events: [smb(6, "IML\\asilva", 1880115)] }), { status: 200 });
    };
    const [r] = await addNasSavers([v], { url: "http://nas:7734/", token: "t" }, f);
    assert.deepEqual(r.saved_by_nas, { name: "asilva", via: "smb", kind: "save" });
    assert.deepEqual(sent, { since: T - 300, until: T + 900, contains: "PJ6XDYMM01_PACKAGING.ai" });
  });

  it("a Drive save up to 15 minutes late still matches; SMB does not", () => {
    const d: NasEvent = { source: "drive", time: T + 396, username: "IML\\apinilla", action: "15", path: `/${REL}` };
    assert.deepEqual(pickSaver(v, [d]), { name: "apinilla", via: "drive", kind: "save" });
    assert.equal(pickSaver(v, [smb(396, "IML\\asilva", 1880115)]), null);
  });

  describe("transfers (copied in with the original saved time)", () => {
    const b = { since: T, until: T + 20000 };
    const ev = (dt: number, action: string, size: number, user = "IML\\dmoreno", source: NasEvent["source"] = "smb"): NasEvent =>
      ({ source, time: T + dt, username: user, action, size, path: `/mac/${REL}` });

    it("names one person who brought the file in with its final size", () => {
      assert.deepEqual(pickTransfer(v, [ev(1886, "create", 0), ev(1886, "write", 1880115)], b), { name: "dmoreno", via: "smb", kind: "transfer" });
      assert.deepEqual(pickTransfer(v, [ev(500, "upload", 1880115, "jdoe", "filestation")], b), { name: "jdoe", via: "filestation", kind: "transfer" });
    });

    it("accepts a create followed by a chunk-size write from the same person", () => {
      assert.deepEqual(pickTransfer(v, [ev(1192, "create", 0), ev(1193, "write", 1048576)], b)?.name, "dmoreno");
      assert.equal(pickTransfer(v, [ev(1193, "write", 1048576)], b), null); // a chunk write alone could be an edit
    });

    it("refuses anything ambiguous", () => {
      assert.equal(pickTransfer(v, [ev(10, "create", 0), ev(11, "write", 1880115), ev(50, "write", 1880115, "IML\\asilva")], b), null);
      assert.equal(pickTransfer(v, [ev(10, "create", 0), ev(11, "write", 1880115), ev(40, "delete", 1880115)], b), null);
      assert.equal(pickTransfer(v, [ev(10, "create", 0), ev(20, "create", 0), ev(21, "write", 1880115)], b), null);
      assert.equal(pickTransfer(v, [ev(30000, "create", 0), ev(30001, "write", 1880115)], b), null); // after the snapshot
    });

    it("bounds run from the saved time / previous snapshot to the first snapshot holding the version", () => {
      const first = new Date((T + 3600) * 1000).toISOString();
      assert.deepEqual(transferBounds({ mtime: MTIME, first_taken_at: first, prev_taken_at: new Date((T - 7200) * 1000).toISOString() }), { since: T - 300, until: T + 3600 });
      assert.deepEqual(transferBounds({ mtime: MTIME, first_taken_at: first, prev_taken_at: new Date((T + 600) * 1000).toISOString() }), { since: T + 600, until: T + 3600 });
      assert.equal(transferBounds({ mtime: MTIME, first_taken_at: new Date((T + 80 * 3600) * 1000).toISOString(), prev_taken_at: MTIME }), null);
    });

    it("looks for a transfer when nothing matches at the saved time, reading in 6-hour pieces", async () => {
      const first = new Date((T + 8 * 3600) * 1000).toISOString();
      const vv = { ...v, first_taken_at: first, prev_taken_at: new Date((T - 3600) * 1000).toISOString() };
      const calls: Array<{ since: number; until: number }> = [];
      const f = async (_u: string, init?: RequestInit) => {
        const q = JSON.parse(String(init?.body));
        calls.push(q);
        const events = q.since <= T + 7000 && q.until >= T + 7000 ? [ev(7000, "create", 0), ev(7001, "write", 1880115)] : [];
        return new Response(JSON.stringify({ events }), { status: 200 });
      };
      const [r] = await addNasSavers([vv], { url: "http://nas", token: "t" }, f);
      assert.deepEqual(r.saved_by_nas, { name: "dmoreno", via: "smb", kind: "transfer" });
      assert.equal(calls.length, 3); // near window + two 6-hour reads
    });

    it("gives no transfer name when a log read failed", async () => {
      const vv = { ...v, first_taken_at: new Date((T + 3600) * 1000).toISOString(), prev_taken_at: MTIME };
      let n = 0;
      const f = async () => new Response(JSON.stringify(n++ === 0 ? { events: [] } : { events: [ev(100, "create", 0), ev(101, "write", 1880115)], errors: { smb: "busy" } }), { status: 200 });
      const [r] = await addNasSavers([vv], { url: "http://nas", token: "t" }, f);
      assert.equal(r.saved_by_nas, undefined);
    });
  });
});
