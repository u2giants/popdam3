import { test } from "node:test";
import assert from "node:assert/strict";
import { createLivenessWatchdog, setActivity, withTimeout } from "./liveness-watchdog.js";

function harness(opts: { authFailing?: boolean } = {}) {
  let t = 1_000_000;
  const fatal: Array<{ msg: string; meta: Record<string, unknown> }> = [];
  const warns: string[] = [];
  const exits: number[] = [];
  const wd = createLivenessWatchdog({
    timeoutMs: 10 * 60_000,
    now: () => t,
    isAuthFailing: () => !!opts.authFailing,
    getDiagnostics: () => ({ is_scanning: true }),
    logFatal: (msg, meta) => fatal.push({ msg, meta }),
    logWarn: (msg) => warns.push(msg),
    exit: (c) => exits.push(c),
  });
  return { wd, fatal, warns, exits, advance: (ms: number) => { t += ms; } };
}

test("does not fire while heartbeats keep succeeding", () => {
  const h = harness();
  for (let i = 0; i < 40; i++) {
    h.advance(30_000);
    h.wd.noteSuccess();
    assert.equal(h.wd.check(), false);
  }
  assert.deepEqual(h.exits, []);
});

test("fires once with diagnostics and non-zero exit after timeout without success", () => {
  const h = harness();
  setActivity("scan:walk");
  h.wd.noteSuccess();
  h.advance(9 * 60_000);
  assert.equal(h.wd.check(), false);
  h.wd.noteFailure("agent-api heartbeat returned 503");
  h.advance(60_000);
  assert.equal(h.wd.check(), true);
  assert.equal(h.wd.check(), true);
  assert.deepEqual(h.exits, [70]);
  assert.equal(h.fatal.length, 1);
  const m = h.fatal[0].meta;
  assert.match(h.fatal[0].msg, /FATAL heartbeat watchdog/);
  assert.equal(m.activity, "scan:walk");
  assert.ok(m.last_heartbeat_success_at);
  assert.equal(m.last_heartbeat_error, "agent-api heartbeat returned 503");
  assert.ok((m.memory_mb as { rss: number }).rss > 0);
  assert.equal(m.is_scanning, true);
  assert.ok("event_loop_lag_ms" in m);
});

test("fires when no heartbeat ever succeeded since start", () => {
  const h = harness();
  h.advance(10 * 60_000);
  assert.equal(h.wd.check(), true);
  assert.equal(h.fatal[0].meta.last_heartbeat_success_at, null);
});

test("auth failures warn once but do not restart", () => {
  const h = harness({ authFailing: true });
  h.advance(20 * 60_000);
  assert.equal(h.wd.check(), false);
  assert.equal(h.wd.check(), false);
  assert.deepEqual(h.exits, []);
  assert.equal(h.warns.length, 1);
});

test("withTimeout rejects a promise that never settles", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20, "stat"), /stat timed out after 20ms/);
  assert.equal(await withTimeout(Promise.resolve(5), 1000, "x"), 5);
});
