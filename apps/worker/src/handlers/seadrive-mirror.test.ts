import test from "node:test";
import assert from "node:assert/strict";
import { mirrorInstallers, parseDownloadPage, recordLatest } from "./seadrive-mirror.js";

const both = { version: "3.0.12", mac: "https://x/seadrive-3.0.12.pkg", win: "https://x/seadrive-3.0.12-en.msi" };
const ok = async (_src: string, ext: string, v: string) => `https://mirror/seadrive-${v}.${ext}`;

test("parseDownloadPage picks the highest version and both installers", () => {
  const html = `<a href="https://s/seadrive-3.0.9.pkg"></a><a href="https://s/seadrive-3.0.12.pkg"></a><a href="https://s/seadrive-3.0.12-en.msi"></a>`;
  assert.deepEqual(parseDownloadPage(html), {
    version: "3.0.12",
    mac: "https://s/seadrive-3.0.12.pkg",
    win: "https://s/seadrive-3.0.12-en.msi",
  });
});

test("mirrored only when both installers uploaded", async () => {
  assert.deepEqual(await mirrorInstallers(both, ok), {
    macUrl: "https://mirror/seadrive-3.0.12.pkg",
    winUrl: "https://mirror/seadrive-3.0.12.msi",
    mirrored: true,
  });
});

test("not mirrored when a platform installer is missing from the page", async () => {
  const r = await mirrorInstallers({ ...both, win: null }, ok);
  assert.equal(r.mirrored, false);
  assert.equal(r.winUrl, null);
  assert.equal(r.macUrl, "https://mirror/seadrive-3.0.12.pkg");
});

test("not mirrored when one upload fails; that platform falls back to the official URL", async () => {
  const r = await mirrorInstallers(both, async (src, ext, v) => {
    if (ext === "msi") throw new Error("boom");
    return ok(src, ext, v);
  });
  assert.equal(r.mirrored, false);
  assert.equal(r.winUrl, both.win);
  assert.equal(r.macUrl, "https://mirror/seadrive-3.0.12.pkg");
});

const latest = {
  version: "3.0.12",
  mac_url: "m",
  win_url: "w",
  source: { mac: null, win: null },
  mirrored: true,
  checked_at: "t",
};

test("recordLatest returns false when the database rejects the write (#1100)", async () => {
  const r = await recordLatest(async () => ({ error: { message: "denied" } }), latest, { ...latest, version: "3.0.9" }, "t");
  assert.equal(r, false);
});

test("recordLatest returns true when the write succeeds", async () => {
  let row: unknown;
  const r = await recordLatest(async (x) => {
    row = x;
    return { error: null };
  }, latest, null, "t");
  assert.equal(r, true);
  assert.deepEqual((row as { value: unknown }).value, latest);
});
