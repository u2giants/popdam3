import assert from "node:assert/strict";
import test from "node:test";
import { heartbeatDue, startHeartbeatTimer } from "./worker-heartbeat.js";

test("worker heartbeat writes immediately and then no more than once per minute", () => {
  assert.equal(heartbeatDue(1_000, 0), true);
  assert.equal(heartbeatDue(60_999, 1_000), false);
  assert.equal(heartbeatDue(61_000, 1_000), true);
});

test("heartbeat timer keeps refreshing while an operation tick never returns (#836)", async () => {
  let writes = 0;
  // Simulate a bulk operation running inline inside tick(): it never completes,
  // so the loop-top heartbeat write would never fire again.
  const timer = startHeartbeatTimer(async () => {
    writes += 1;
  }, 5);
  await new Promise((resolve) => setTimeout(resolve, 25));
  timer.stop();
  assert.ok(writes >= 3, `expected repeated independent refreshes, saw ${writes}`);

  const frozen = writes;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(writes, frozen, "timer must stop refreshing after stop()");
});

test("a failed interval heartbeat write is swallowed and the next interval retries", async () => {
  let calls = 0;
  const timer = startHeartbeatTimer(async () => {
    calls += 1;
    if (calls === 1) throw new Error("transient write failure");
  }, 5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  timer.stop();
  assert.ok(calls >= 2, `expected the failed write to be retried, saw ${calls} calls`);
});
