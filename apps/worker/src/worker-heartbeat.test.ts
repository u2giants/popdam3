import assert from "node:assert/strict";
import test from "node:test";
import { heartbeatDue } from "./worker-heartbeat.js";

test("worker heartbeat writes immediately and then no more than once per minute", () => {
  assert.equal(heartbeatDue(1_000, 0), true);
  assert.equal(heartbeatDue(60_999, 1_000), false);
  assert.equal(heartbeatDue(61_000, 1_000), true);
});
