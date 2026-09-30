import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createLivenessWatchdog, setActivity, withTimeout, startEventLoopBackstop, classifyHeartbeatFailure } from "./liveness-watchdog.js";

function harness() {
  let t = 1_000_000;
  const fatal: Array<{ msg: string; meta: Record<string, unknown> }> = [];
  const warns: string[] = [];
  const exits: number[] = [];
  const wd = createLivenessWatchdog({
    timeoutMs: 10 * 60_000,
    now: () => t,
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
  h.wd.noteFailure("heartbeat timed out after 300000ms");
  h.advance(60_000);
  assert.equal(h.wd.check(), true);
  assert.equal(h.wd.check(), true);
  assert.deepEqual(h.exits, [70]);
  assert.equal(h.fatal.length, 1);
  const m = h.fatal[0].meta;
  assert.match(h.fatal[0].msg, /FATAL heartbeat watchdog/);
  assert.equal(m.activity, "scan:walk");
  assert.ok(m.last_heartbeat_success_at);
  assert.equal(m.last_heartbeat_error, "heartbeat timed out after 300000ms");
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
  const h = harness();
  h.advance(20 * 60_000);
  h.wd.noteFailure("agent-api heartbeat returned 401: invalid key");
  assert.equal(h.wd.check(), false);
  assert.equal(h.wd.check(), false);
  assert.deepEqual(h.exits, []);
  assert.equal(h.warns.length, 1);
});

test("a stale auth failure does not suppress a later hang", () => {
  const h = harness();
  h.wd.noteFailure("agent-api heartbeat returned 401: invalid key");
  h.advance(11 * 60_000);
  assert.equal(h.wd.check(), true);
});

test("API outage holds restart until the outage ceiling, then restarts", () => {
  const h = harness();
  for (let i = 0; i < 19; i++) {
    h.advance(3 * 60_000);
    h.wd.noteFailure("agent-api heartbeat returned 503: upstream");
    assert.equal(h.wd.check(), false, `minute ${(i + 1) * 3}`);
  }
  assert.equal(h.warns.length, 1);
  h.advance(4 * 60_000); // 61 min silent > 60 min ceiling
  h.wd.noteFailure("fetch failed");
  assert.equal(h.wd.check(), true);
  assert.deepEqual(h.exits, [70]);
});

test("timeouts do not count as a healthy API answer", () => {
  const h = harness();
  h.advance(10 * 60_000);
  h.wd.noteFailure("The operation was aborted due to timeout");
  assert.equal(h.wd.check(), true);
});

test("classifyHeartbeatFailure", () => {
  assert.equal(classifyHeartbeatFailure("agent-api heartbeat returned 403: x"), "auth");
  assert.equal(classifyHeartbeatFailure("stat scan root timed out after 10000ms"), "timeout");
  assert.equal(classifyHeartbeatFailure("agent-api heartbeat returned 500: x"), "api");
});

test("event-loop backstop worker boots and stays alive", async () => {
  const errors: Error[] = [];
  const { worker, stop } = startEventLoopBackstop(60_000, { tickMs: 50, onError: (e) => errors.push(e) });
  let exited = false;
  worker.on("exit", () => { exited = true; });
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(errors.map((e) => e.message), []);
  assert.equal(exited, false);
  stop();
});

test("event-loop backstop SIGKILLs a process whose main thread freezes", () => {
  const modUrl = new URL("./liveness-watchdog.ts", import.meta.url).href;
  const script = `
    const { startEventLoopBackstop } = await import(${JSON.stringify(modUrl)});
    startEventLoopBackstop(300, { tickMs: 50 });
    await new Promise((r) => setTimeout(r, 200));
    const end = Date.now() + 10000;
    while (Date.now() < end) {} // freeze the main thread
    console.log("survived");
  `;
  const res = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    encoding: "utf-8",
    timeout: 20_000,
  });
  assert.equal(res.signal, "SIGKILL", `status=${res.status} stderr=${res.stderr}`);
  assert.match(res.stderr, /FATAL event-loop watchdog/);
  assert.doesNotMatch(res.stdout, /survived/);
});

test("withTimeout rejects a promise that never settles", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20, "stat"), /stat timed out after 20ms/);
  assert.equal(await withTimeout(Promise.resolve(5), 1000, "x"), 5);
});
