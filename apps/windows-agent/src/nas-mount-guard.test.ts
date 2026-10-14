import { test } from "node:test";
import assert from "node:assert/strict";
import { createNasMountGuard, NAS_REMAP_BASE_MS, NAS_REMAP_MAX_MS } from "./nas-mapper";

// Creds with a host that fails fast: ensureNasMapped returns "NAS host not configured"
// without touching the network, so these tests run offline.
const badCreds = { host: "", share: "x", username: "u", password: "p" };

test("failures back off exponentially and cap", async () => {
  let t = 0;
  const guard = createNasMountGuard(() => t);
  const r1 = await guard("Z:", badCreds);
  assert.equal(r1.ok, false);
  assert.equal(r1.backingOff, false);
  // Within the first backoff window: no new attempt, reports backing off.
  t = NAS_REMAP_BASE_MS - 1;
  const r2 = await guard("Z:", badCreds);
  assert.equal(r2.backingOff, true);
  assert.equal(r2.error, r1.error);
  // After the window: a new attempt is made.
  t = NAS_REMAP_BASE_MS;
  const r3 = await guard("Z:", badCreds);
  assert.equal(r3.backingOff, false);
  // Delay doubles: next window is 2x base from t.
  t = NAS_REMAP_BASE_MS + 2 * NAS_REMAP_BASE_MS - 1;
  assert.equal((await guard("Z:", badCreds)).backingOff, true);
  assert.ok(NAS_REMAP_MAX_MS >= NAS_REMAP_BASE_MS);
});

test("a credential change bypasses the backoff window", async () => {
  let t = 0;
  const guard = createNasMountGuard(() => t);
  await guard("Z:", badCreds);
  t = 1; // still inside the window
  const changed = await guard("Z:", { ...badCreds, password: "rotated" });
  assert.equal(changed.backingOff, false, "new password must trigger an immediate attempt");
});

test("a mount-path change bypasses the backoff window", async () => {
  let t = 0;
  const guard = createNasMountGuard(() => t);
  await guard("Z:", badCreds);
  t = 1;
  const changed = await guard("Y:", badCreds);
  assert.equal(changed.backingOff, false);
});
