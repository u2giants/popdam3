import assert from "node:assert/strict";
import test from "node:test";
import { evaluateColumn2911, evaluateDrop2934, evaluateLikenessRead2802, NotYetApplied, ProofFailure } from "./shared-db-live-proof.mjs";

test("2802 accepts true, false and null exactly as stored", () => {
  assert.equal(evaluateLikenessRead2802([{ id: "a", has_talent_likeness: null }], null), 1);
  assert.equal(evaluateLikenessRead2802([{ id: "b", has_talent_likeness: false }], false), 1);
  assert.equal(evaluateLikenessRead2802([], true), 0);
});

test("2802 fails when null collapses to false or the key is missing", () => {
  assert.throws(() => evaluateLikenessRead2802([{ id: "a", has_talent_likeness: false }], null), ProofFailure);
  assert.throws(() => evaluateLikenessRead2802([{ id: "a" }], null), ProofFailure);
});

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

import { evaluateRefusal, evaluateReset3418, evaluateSearch3457 } from "./shared-db-live-proof.mjs";

const rpc = (name, args) => ({
  paths: { [`/rpc/${name}`]: { post: { parameters: [{ in: "body", schema: { properties: Object.fromEntries(args.map((a) => [a, {}])) } }] } } },
});

test("3457 needs the 8-arg form with p_min_semantic_score", () => {
  const eight = ["p_query", "p_filters", "p_limit", "p_offset", "p_document_types", "p_query_embedding", "p_min_rank", "p_min_semantic_score"];
  assert.equal(evaluateSearch3457(rpc("search_dam_documents", eight)).args.length, 8);
  assert.throws(() => evaluateSearch3457(rpc("search_dam_documents", eight.slice(0, 7))), NotYetApplied);
});

test("3418 needs the reset function with its seven args", () => {
  const args = ["p_op_key", "p_expected_revision", "p_submission_owner", "p_lease_token", "p_reason", "p_http_status", "p_provider_error"];
  assert.ok(evaluateReset3418(rpc("reset_bulk_operation_submission_lease", args)));
  assert.throws(() => evaluateReset3418({ paths: {} }), NotYetApplied);
  assert.throws(() => evaluateReset3418(rpc("reset_bulk_operation_submission_lease", args.slice(1))), ProofFailure);
});

test("refusal must be an error with the expected SQLSTATE", () => {
  assert.equal(evaluateRefusal("x", 400, { code: "22023" }, "22023").sqlstate, "22023");
  assert.throws(() => evaluateRefusal("x", 200, {}, "22023"), ProofFailure);
  assert.throws(() => evaluateRefusal("x", 400, { code: "55000" }, "22023"), ProofFailure);
});
