import { test } from "node:test";
import assert from "node:assert/strict";
import { nasReadyForClaim } from "./claim-gate";
import { redactSecret } from "./nas-mapper";

test("a failed remap blocks claiming", async () => {
  const r = await nasReadyForClaim("192.168.3.101", async () => ({ ok: false, error: "denied" }));
  assert.deepEqual(r, { ready: false, error: "denied" });
});

test("rotated credentials are picked up on the next decision", async () => {
  let password = "old";
  const valid = "new";
  const ensure = async () => (password === valid ? { ok: true } : { ok: false, error: "bad password" });
  assert.equal((await nasReadyForClaim("h", ensure)).ready, false);
  password = "new"; // heartbeat delivered the rotated admin_config value
  assert.equal((await nasReadyForClaim("h", ensure)).ready, true);
});

test("no NAS host configured does not block claiming", async () => {
  let called = false;
  const r = await nasReadyForClaim("", async () => { called = true; return { ok: false }; });
  assert.equal(r.ready, true);
  assert.equal(called, false);
});

test("redactSecret removes every occurrence of the password", () => {
  const msg = "Command failed: net use Z: \\\\h\\mac /user:popdam-render s3cr3tX /persistent:no (s3cr3tX)";
  const out = redactSecret(msg, "s3cr3tX");
  assert.ok(!out.includes("s3cr3tX"));
  assert.ok(out.includes("[REDACTED]"));
  assert.equal(redactSecret(msg, ""), msg);
});
