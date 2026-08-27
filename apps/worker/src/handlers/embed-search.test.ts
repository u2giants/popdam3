import assert from "node:assert/strict";
import test from "node:test";
import { normalizeEmbeddingStatus } from "./embed-search.js";

test("normalizes embedding coverage without trusting malformed counts", () => {
  const status = normalizeEmbeddingStatus({ total_documents: "12", embedded_documents: 7, pending_documents: -4, exhausted_documents: "1" });
  assert.equal(status.total_documents, 12);
  assert.equal(status.embedded_documents, 7);
  assert.equal(status.pending_documents, 0);
  assert.equal(status.exhausted_documents, 1);
});

test("defaults absent embedding coverage to safe zeros", () => {
  assert.equal(normalizeEmbeddingStatus(undefined).pending_documents, 0);
});
