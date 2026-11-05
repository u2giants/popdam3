import assert from "node:assert/strict";
import test from "node:test";
import { createViewerSession, ViewerAuthenticationError } from "./viewer-session.mjs";

test("caches the viewer token and renews at the 60-second boundary", async () => {
  let clock = 1_000_000;
  let calls = 0;
  const getToken = createViewerSession({
    now: () => clock,
    authenticate: async () => ({ access_token: `viewer-${++calls}`, expires_at: clock / 1000 + 3600, expires_in: 3600 }),
  });
  assert.equal(await getToken(), "viewer-1");
  clock += 3_539_999;
  assert.equal(await getToken(), "viewer-1");
  clock++;
  assert.equal(await getToken(), "viewer-2");
  assert.equal(calls, 2);
});

test("accepts either expiry field, conservatively using the earlier when both exist", async () => {
  for (const expiry of [{ expires_in: 3600 }, { expires_at: 4600 }, { expires_at: 4600, expires_in: 120 }]) {
    let clock = 1_000_000;
    let calls = 0;
    const getToken = createViewerSession({ now: () => clock, authenticate: async () => ({ access_token: `v${++calls}`, ...expiry }) });
    assert.equal(await getToken(), "v1");
    clock += 60_000;
    assert.equal(await getToken(), expiry.expires_in === 120 ? "v2" : "v1");
  }
});

test("relative expiry starts before authentication latency", async () => {
  let clock = 0;
  let calls = 0;
  const getToken = createViewerSession({ now: () => clock, authenticate: async () => {
    calls++;
    clock += 30_000;
    return { access_token: `v${calls}`, expires_in: 120 };
  } });
  await getToken();
  clock = 60_000;
  assert.equal(await getToken(), "v2");
});

test("rejects malformed, expired and too-short sessions without exposing their contents", async () => {
  const invalid = [null, {}, { access_token: " " }, { access_token: "private-token" },
    ...[null, "3600", 0, -1, Infinity, NaN, 60].map((expires_in) => ({ access_token: "private-token", expires_in })),
    { access_token: "private-token", expires_at: 1000 },
    { access_token: "private-token", expires_in: 3600, expires_at: "4600" }];
  for (const response of invalid) {
    const getToken = createViewerSession({ now: () => 1_000_000, authenticate: async () => response });
    await assert.rejects(getToken(), (error) => error instanceof ViewerAuthenticationError && !error.message.includes("private-token"));
  }
});

test("a failed renewal propagates once and never reuses the old session", async () => {
  let clock = 0;
  let calls = 0;
  const getToken = createViewerSession({ now: () => clock, authenticate: async () => {
    if (++calls > 1) throw new Error("private authentication response");
    return { access_token: "viewer", expires_in: 3600 };
  } });
  await getToken();
  clock = 3_540_000;
  await assert.rejects(getToken(), ViewerAuthenticationError);
  assert.equal(calls, 2);
  await assert.rejects(getToken(), ViewerAuthenticationError);
  assert.equal(calls, 3);
});
