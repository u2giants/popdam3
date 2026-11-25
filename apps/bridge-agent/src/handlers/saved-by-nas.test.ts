import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addNasSavers, displayUser, pickSaver, samePath, type NasEvent } from "./saved-by-nas.js";

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
    assert.deepEqual(who, { name: "asilva", via: "smb" });
    assert.equal(pickSaver(v, [smb(900, "IML\\asilva", 1880115)]), null);
  });

  it("a Drive save matches by path and time", () => {
    const e: NasEvent = { source: "drive", time: T + 20, username: "IML\\aagudelo", action: "23", path: `/${REL}` };
    assert.deepEqual(pickSaver(v, [e]), { name: "aagudelo", via: "drive" });
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
    assert.deepEqual(r.saved_by_nas, { name: "asilva", via: "smb" });
    assert.deepEqual(sent, { since: T - 300, until: T + 300, contains: "PJ6XDYMM01_PACKAGING.ai" });
  });
});
