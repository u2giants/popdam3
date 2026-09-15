import assert from "node:assert/strict";
import test from "node:test";
import { evaluateColumn2911, evaluateDrop2934, NotYetApplied, ProofFailure } from "./shared-db-live-proof.mjs";

const table = (column, required = []) => ({
  definitions: {
    style_guide_files: {
      required: ["id", ...required],
      properties: { id: {}, ...(column ? { has_talent_likeness: column } : {}) },
    },
  },
});

test("2911 passes for a nullable column with no default", () => {
  assert.equal(evaluateColumn2911(table({ format: "boolean" })).nullable, true);
});

test("2911 reports not yet applied when the column is missing", () => {
  assert.throws(() => evaluateColumn2911(table(null)), NotYetApplied);
});

test("2911 fails for NOT NULL or a default", () => {
  assert.throws(() => evaluateColumn2911(table({ format: "boolean" }, ["has_talent_likeness"])), ProofFailure);
  assert.throws(() => evaluateColumn2911(table({ format: "boolean", default: false })), ProofFailure);
});

const paths = (...names) => ({ paths: Object.fromEntries(names.map((n) => [`/rpc/${n}`, {}])) });

test("2934 passes once the wrapper is gone and the current path exists", () => {
  assert.ok(evaluateDrop2934(paths("preview_stale_sg_files", "reconcile_stale_sg_files_batch")));
});

test("2934 reports not yet applied while the wrapper exists", () => {
  assert.throws(
    () => evaluateDrop2934(paths("deactivate_stale_sg_files", "preview_stale_sg_files", "reconcile_stale_sg_files_batch")),
    NotYetApplied,
  );
});

test("2934 fails when the current stale-file path is missing", () => {
  assert.throws(() => evaluateDrop2934(paths("preview_stale_sg_files")), ProofFailure);
});
