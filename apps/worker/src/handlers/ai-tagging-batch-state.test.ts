import assert from "node:assert/strict";
import test from "node:test";
import { indexBatchResults, isNewBatchVisibilityDelay, nextBatchAction } from "./ai-tagging-batch-state.js";

test("restart with a saved batch ID claims polling ownership instead of submitting", () => {
  assert.deepEqual(nextBatchAction({ phase: "pending", provider_batch_id: "batch-1" }, Date.now()), {
    type: "claim",
  });
  assert.deepEqual(nextBatchAction({ phase: "pending", provider_batch_id: "batch-1", lease_token: "receipt" }, Date.now()), {
    type: "poll", batchId: "batch-1",
  });
});

test("restart claims resume paid pending, applying, and completed jobs without changing their phase", () => {
  for (const [phase, expected] of [
    ["pending", "poll"],
    ["applying", "apply"],
    ["completed", "clear"],
  ] as const) {
    const saved = { phase, provider_batch_id: "paid-batch" };
    assert.equal(nextBatchAction(saved).type, "claim");
    const resumed = nextBatchAction({ ...saved, lease_token: "restart-receipt" });
    assert.equal(resumed.type, expected);
    assert.equal("batchId" in resumed ? resumed.batchId : null, "paid-batch");
  }
});

test("expired wait becomes a poll while a future wait remains idle", () => {
  assert.equal(nextBatchAction({ phase: "pending", provider_batch_id: "batch-1", lease_token: "receipt", next_poll_at: "2026-01-01T00:00:00Z" }, Date.now()).type, "poll");
  assert.equal(nextBatchAction({ phase: "pending", provider_batch_id: "batch-1", lease_token: "receipt", next_poll_at: "2999-01-01T00:00:00Z" }, Date.now()).type, "wait");
});

test("ambiguous submission never resubmits", () => {
  assert.equal(nextBatchAction({ phase: "ambiguous_submission" }).type, "blocked");
});

test("submitting without an in-memory receipt reclaims only through the guarded database lease", () => {
  assert.equal(nextBatchAction({ phase: "submitting" }).type, "claim");
});

test("maximum page recovery mapping stays below the 100 KB state limit", () => {
  const state = {
    version: 1,
    phase: "prepared",
    model: "google/gemini-3.7-flash:batch",
    items: Array.from({ length: 100 }, (_, index) => ({
      asset_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      custom_id: `popdam:run:00000000-0000-4000-8000-${String(index).padStart(12, "0")}:json_schema:0`,
      status: "prepared",
      filename: "licensed-artwork-file-name.psd",
      relative_path: "/licensed/property/program/artwork/file.psd",
    })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(state)) < 100_000);
});

test("restart simulation checks the saved batch without another submission", async () => {
  let posts = 0;
  let gets = 0;
  const submit = async () => { posts++; return "batch-1"; };
  const get = async (id: string) => { gets++; return id; };

  const batchId = await submit();
  const serialized = JSON.stringify({ phase: "pending", provider_batch_id: batchId });
  const restarted = JSON.parse(serialized);
  const action = nextBatchAction(restarted);
  assert.equal(action.type, "claim");

  const claimedAction = nextBatchAction({ ...restarted, lease_token: "receipt" });
  assert.equal(claimedAction.type, "poll");
  if (claimedAction.type === "poll") assert.equal(await get(claimedAction.batchId), batchId);
  assert.equal(posts, 1);
  assert.equal(gets, 1);
});

test("batch results reject unknown, duplicate, and missing IDs", () => {
  assert.throws(() => indexBatchResults(["a"], [{ custom_id: "b" }]), /unknown result ID/);
  assert.throws(() => indexBatchResults(["a"], [{ custom_id: "a" }, { custom_id: "a" }]), /duplicate result ID/);
  assert.throws(() => indexBatchResults(["a", "b"], [{ custom_id: "a" }]), /missing/);
});

test("treats only a newly submitted batch 404 as temporary", () => {
  const now = Date.parse("2026-08-24T12:02:00.000Z");
  assert.equal(isNewBatchVisibilityDelay(404, "2026-08-24T12:00:01.000Z", now), true);
  assert.equal(isNewBatchVisibilityDelay(404, "2026-08-24T12:00:00.000Z", now), false);
  assert.equal(isNewBatchVisibilityDelay(500, "2026-08-24T12:00:01.000Z", now), false);
  assert.equal(isNewBatchVisibilityDelay(404, undefined, now), false);
});

test("provider terminal states retain the saved batch ID", () => {
  for (const phase of ["failed", "cancelled", "expired"]) {
    const job = { phase: "pending" as const, provider_batch_id: "batch-1", provider_status: phase };
    assert.equal(job.provider_batch_id, "batch-1");
  }
});

test("completed work clears only with the saved ID and receipt", () => {
  assert.deepEqual(nextBatchAction({
    phase: "completed",
    provider_batch_id: "batch-1",
    lease_token: "receipt",
  }), { type: "clear", batchId: "batch-1", leaseToken: "receipt" });
  assert.equal(nextBatchAction({ phase: "completed", provider_batch_id: "batch-1" }).type, "claim");
});

test("a paused apply waits for its retry time, then applies the same saved batch", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  const job = { phase: "applying" as const, provider_batch_id: "batches/x", lease_token: "r", next_poll_at: "2026-09-23T12:01:00Z" };
  assert.deepEqual(nextBatchAction(job, now), { type: "wait" });
  assert.deepEqual(nextBatchAction(job, now + 120_000), { type: "apply", batchId: "batches/x" });
});
