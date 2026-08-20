import assert from "node:assert/strict";
import test from "node:test";
import { hasSubmissionLeaseReceipt } from "./operation-lease.js";

const envelope = {
  ok: true,
  state_revision: 2,
  submission_owner: "worker-1",
  lease_expires_at: "2026-08-20T15:00:00Z",
  lease_token: "one-time-token",
  lease_receipt_issued: true,
  reason: "ok",
};

test("new one-time lease receipt authorizes provider submission", () => {
  assert.equal(hasSubmissionLeaseReceipt(envelope), true);
});

test("ok alone never authorizes provider submission", () => {
  assert.equal(hasSubmissionLeaseReceipt({ ...envelope, lease_receipt_issued: false, lease_token: null }), false);
});

test("receipt flag without the one-time token never authorizes submission", () => {
  assert.equal(hasSubmissionLeaseReceipt({ ...envelope, lease_token: null }), false);
});

test("ambiguous or refused result never authorizes submission", () => {
  assert.equal(hasSubmissionLeaseReceipt({ ...envelope, ok: false, reason: "ambiguous_submission" }), false);
});
