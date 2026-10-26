import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSgEmbeddingStatus } from "./embed-sg-search.js";

test("normalizes popsg embedding coverage without trusting malformed counts", () => {
  const status = normalizeSgEmbeddingStatus({ total_documents: "20", embedded_documents: 9, pending_documents: -4, unidentified_documents: "2", exhausted_documents: "1" });
  assert.equal(status.total_documents, 20);
  assert.equal(status.embedded_documents, 9);
  assert.equal(status.pending_documents, 0);
  assert.equal(status.unidentified_documents, 2);
  assert.equal(status.exhausted_documents, 1);
});

test("defaults absent popsg embedding coverage to safe zeros", () => {
  assert.equal(normalizeSgEmbeddingStatus(undefined).pending_documents, 0);
  assert.equal(normalizeSgEmbeddingStatus(undefined).unidentified_documents, 0);
});
