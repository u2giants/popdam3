import { test } from "node:test";
import assert from "node:assert/strict";
import { assertTrustedDownloadUrl, assertTrustedFinalUrl, normalizeChecksum } from "./update-guard";

const good =
  "https://github.com/u2giants/popdam3/releases/download/windows-agent-latest/popdam-windows-agent-dist.zip";

test("accepts pinned release URL", () => assertTrustedDownloadUrl(good));

test("rejects http, other hosts, other repos, userinfo, garbage", () => {
  for (const u of [
    good.replace("https:", "http:"),
    "https://evil.com/u2giants/popdam3/releases/x.zip",
    "https://github.com/attacker/popdam3/releases/x.zip",
    "https://github.com.evil.com/u2giants/popdam3/releases/x.zip",
    "https://x@github.com/u2giants/popdam3/releases/x.zip",
    "not a url",
  ]) {
    assert.throws(() => assertTrustedDownloadUrl(u), u);
  }
});

test("final URL must be https on GitHub hosts", () => {
  assertTrustedFinalUrl("https://release-assets.githubusercontent.com/a/b");
  assert.throws(() => assertTrustedFinalUrl("https://evil.com/a"));
  assert.throws(() => assertTrustedFinalUrl("http://github.com/a"));
});

test("checksum is mandatory and well-formed", () => {
  assert.equal(normalizeChecksum("A".repeat(64)), "a".repeat(64));
  for (const c of ["", null, undefined, "abc", "z".repeat(64)]) {
    assert.throws(() => normalizeChecksum(c));
  }
});
