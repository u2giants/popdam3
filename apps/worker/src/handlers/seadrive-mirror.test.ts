import test from "node:test";
import assert from "node:assert/strict";
import { mirrorInstallers, parseDownloadPage } from "./seadrive-mirror.js";

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
