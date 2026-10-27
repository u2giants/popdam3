import assert from "node:assert/strict";
import test from "node:test";
import { evaluateColumn2911, evaluateDrop2934, evaluateLikenessRead2802, NotYetApplied, ProofFailure } from "./shared-db-live-proof.mjs";
import { evaluateCasePacks4858 } from "./shared-db-live-proof.mjs";

test("4858 accepts unequal design packs with one carton counted once", () => {
  const expected = [
    { order_id: "o", order_line_id: "a", case_pack: 6, cases_reported: 2, group_key: "carton", order_cases: 2 },
    { order_id: "o", order_line_id: "b", case_pack: 12, cases_reported: 2, group_key: "carton", order_cases: 2 },
    { order_id: "o", order_line_id: "c", case_pack: 4, cases_reported: 3, group_key: null, order_cases: 3 },
  ];
  const rows = expected.map(({ order_id, order_line_id, case_pack, cases_reported, group_key }) => ({ order_id, order_line_id, case_pack, cases_reported, assortment_parent_key: group_key }));
  assert.deepEqual(evaluateCasePacks4858(expected, rows, [{ order_id: "o", total_cases: 5, unknown_case_groups: 0 }]),
    { orders_checked: 1, designs_checked: 3, assortment_designs: 2 });
});

test("4858 rejects wrong packs, missing or duplicate rows, wrong totals and absent group keys", () => {
  const expected = [
    { order_id: "o", order_line_id: "a", case_pack: 6, cases_reported: 2, group_key: "carton", order_cases: 2 },
    { order_id: "o", order_line_id: "b", case_pack: 12, cases_reported: 2, group_key: "carton", order_cases: 2 },
  ];
  const rows = expected.map(({ order_id, order_line_id, case_pack, cases_reported, group_key }) => ({ order_id, order_line_id, case_pack, cases_reported, assortment_parent_key: group_key }));
  const tracking = [{ order_id: "o", total_cases: 2, unknown_case_groups: 0 }];
  assert.throws(() => evaluateCasePacks4858(expected, [{ ...rows[0], case_pack: 99 }, rows[1]], tracking), ProofFailure);
  assert.throws(() => evaluateCasePacks4858(expected, rows.slice(0, 1), tracking), ProofFailure);
  assert.throws(() => evaluateCasePacks4858(expected, [...rows, rows[0]], tracking), ProofFailure);
  assert.throws(() => evaluateCasePacks4858(expected, rows, [{ ...tracking[0], total_cases: 4 }]), ProofFailure);
  assert.throws(() => evaluateCasePacks4858(expected, [{ ...rows[0], assortment_parent_key: null }, rows[1]], tracking), ProofFailure);
});

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

import { evaluateClaim, evaluateReset, fixtureState } from "./shared-db-live-proof.mjs";

test("3418-retry claim must mint exactly one receipt at the next revision", () => {
  assert.equal(evaluateClaim({ ok: true, lease_receipt_issued: true, lease_token: "t", state_revision: 1 }, 1), "t");
  assert.throws(() => evaluateClaim({ ok: false, reason: "lease_held" }, 1), ProofFailure);
  assert.throws(() => evaluateClaim({ ok: true, lease_receipt_issued: false, lease_token: null, state_revision: 1 }, 1), ProofFailure);
});

test("3418-retry reset must clear the lease and never return a receipt", () => {
  const good = { ok: true, reason: "provider_definitive_rejection", lease_receipt_issued: false, lease_token: null, state_revision: 2,
    operation: { external_job: { phase: "prepared", last_definitive_rejection_status: 422 } } };
  assert.equal(evaluateReset(good, 2).phase, "prepared");
  assert.throws(() => evaluateReset({ ...good, lease_token: "x" }, 2), ProofFailure);
  assert.throws(() => evaluateReset({ ...good, operation: { external_job: { ...good.operation.external_job, lease_proof: "p" } } }, 2), ProofFailure);
  assert.throws(() => evaluateReset(good, 3), ProofFailure);
});

test("3418-retry fixtures sort after every real running operation", () => {
  assert.equal(fixtureState().status, "running");
  assert.ok(Date.parse(fixtureState().updated_at) > Date.parse("2900-01-01"));
});

test("4037 waits when no popcre.com sign-up happened after the apply", async () => {
  const { evaluateSignupGrant4037 } = await import("./shared-db-live-proof.mjs");
  assert.throws(() => evaluateSignupGrant4037([{ id: "a", email: "x@popcre.com", created_at: "2026-10-01T00:00:00Z" }, { id: "b", email: "y@example.com", created_at: "2026-10-08T00:00:00Z" }], []), NotYetApplied);
});

test("4037 passes when every post-apply employee sign-up has dam and crm", async () => {
  const { evaluateSignupGrant4037 } = await import("./shared-db-live-proof.mjs");
  const n = evaluateSignupGrant4037([{ id: "a", email: "New@PopCre.com", created_at: "2026-10-08T00:00:00Z" }], [{ profile_id: "a", app: "crm" }, { profile_id: "a", app: "dam" }]);
  assert.equal(n, 1);
});

test("4037 fails when a post-apply employee sign-up lacks dam", async () => {
  const { evaluateSignupGrant4037 } = await import("./shared-db-live-proof.mjs");
  assert.throws(() => evaluateSignupGrant4037([{ id: "a", email: "n@popcre.com", created_at: "2026-10-08T00:00:00Z" }], [{ profile_id: "a", app: "crm" }]), ProofFailure);
});

test("4064 passes only when every concurrent increment landed", async () => {
  const { evaluateCounters4064 } = await import("./shared-db-live-proof.mjs");
  assert.equal(evaluateCounters4064({ processed: 10, stats: { proof: 10 }, marker: "live-proof-4064" }), true);
  assert.throws(() => evaluateCounters4064({ processed: 9, stats: { proof: 10 }, marker: "live-proof-4064" }), ProofFailure);
  assert.throws(() => evaluateCounters4064({ processed: 10, stats: { proof: 7 }, marker: "live-proof-4064" }), ProofFailure);
});

import { evaluateNoReuse4257, parseRollbackResult4257, newYorkDate, expectedSoDate, evaluateSoDates4268, evaluateRawAccess4268 } from "./shared-db-live-proof.mjs";
import { createGeneratedTypesProof } from "./shared-db-generated-types-proof.mjs";

const refusedReuse = { refused: true, sqlstate: "23505", constraint: "production_po_no_reuse" };
const good4257 = () => ({
  trigger: { enabled: "O", definition: "CREATE TRIGGER production_po_no_reuse BEFORE INSERT OR UPDATE ON plm.production_order FOR EACH ROW EXECUTE FUNCTION plm.guard_production_po_number()" },
  orders_readable: 3501,
  edit_existing: { ok: true, rows: 1 },
  change_existing_po: { refused: true, sqlstate: "23514" },
  reuse_variant: refusedReuse, reuse_after_void: refusedReuse, reuse_after_delete: refusedReuse,
  unreserved_existing_numbers: 0,
  admission_guard: { app_roles_can_write_admissions: false, app_roles_can_write_reservations: false, digest_checks: 2, order_id_primary_key: true },
});

test("4257 reads the result only from the always-rollback marker", () => {
  const message = `Failed to run sql query: ERROR:  P0001: POPDAM_LIVE_PROOF_4257:${JSON.stringify(good4257())}\nCONTEXT:  PL/pgSQL`;
  assert.equal(parseRollbackResult4257(400, { message }).orders_readable, 3501);
  assert.throws(() => parseRollbackResult4257(201, [{}]), ProofFailure);
  assert.throws(() => parseRollbackResult4257(400, { message: "ERROR: P0001: POPDAM_LIVE_PROOF_4257_FAILED:no order to probe" }), ProofFailure);
});

test("4257 passes only when every writer path refuses reuse and edits still work", () => {
  assert.ok(evaluateNoReuse4257(good4257()));
  for (const mutate of [
    (r) => { r.trigger.enabled = "D"; },
    (r) => { r.edit_existing = { ok: false, sqlstate: "23514" }; },
    (r) => { r.change_existing_po = { refused: false }; },
    (r) => { r.reuse_variant = { refused: true, sqlstate: "23505", constraint: "other" }; },
    (r) => { delete r.reuse_after_delete; },
    (r) => { r.unreserved_existing_numbers = 1; },
    (r) => { r.admission_guard.app_roles_can_write_admissions = true; },
  ]) {
    const r = good4257();
    mutate(r);
    assert.throws(() => evaluateNoReuse4257(r), ProofFailure);
  }
});

test("4268 computes the New York calendar date from a ColdLion stamp", () => {
  assert.equal(newYorkDate("2026-08-11 11:56:56.357-04"), "2026-08-11");
  assert.equal(newYorkDate("2026-08-12 02:30:00+00"), "2026-08-11");
  assert.equal(newYorkDate("1999-12-31 00:00:00+00"), null);
  assert.equal(expectedSoDate({ kind: "single", stamp_rows: 2, stamped_rows: 2, distinct_stamps: ["2026-08-12 02:30:00+00"] }), "2026-08-11");
  assert.equal(expectedSoDate({ kind: "missing_or_conflicting", stamp_rows: 2, stamped_rows: 2, distinct_stamps: ["a", "b"] }), null);
});

test("4268 needs exact dates for linked lines and blanks for the rest", () => {
  const sample = [
    { order_line_id: "a", kind: "single", stamp_rows: 1, stamped_rows: 1, distinct_stamps: ["2026-08-11 11:56:56-04"] },
    { order_line_id: "b", kind: "missing" },
    { order_line_id: "c", kind: "not_linked" },
  ];
  const rows = [{ order_line_id: "a", sales_order_date: "2026-08-11" }, { order_line_id: "b", sales_order_date: null }, { order_line_id: "c", sales_order_date: null }];
  assert.deepEqual(evaluateSoDates4268(sample, rows), { dated: 1, blank_missing: 1, blank_not_linked: 1 });
  assert.throws(() => evaluateSoDates4268(sample, rows.slice(0, 2)), ProofFailure);
  assert.throws(() => evaluateSoDates4268(sample, [{ ...rows[0], sales_order_date: "2026-08-12" }, rows[1], rows[2]]), ProofFailure);
  assert.throws(() => evaluateSoDates4268(sample, [rows[0], { order_line_id: "b", sales_order_date: "2026-08-11" }, rows[2]]), ProofFailure);
});

test("4268 rejects any raw ColdLion or anon reader access", () => {
  const raw = { anon_select_order_history_line: false, authenticated_select_order_history_line: false, anon_usage_coldlion_schema: false, authenticated_usage_coldlion_schema: false, anon_execute_reader: false, authenticated_execute_reader: true };
  assert.ok(evaluateRawAccess4268(raw));
  assert.throws(() => evaluateRawAccess4268({ ...raw, anon_execute_reader: true }), ProofFailure);
  assert.throws(() => evaluateRawAccess4268({ ...raw, authenticated_select_order_history_line: true }), ProofFailure);
});

test("generated-types proof requires each issue's objects", () => {
  const sha = "a".repeat(40);
  const t4268 = "export type Database = {\n get_dam_order_sales_order_dates: {\n Args: { p_line_ids: string[] }\n Returns: { order_line_id: string\n sales_order_date: string }[] } }";
  const proof = createGeneratedTypesProof({ source: t4268, workIssue: 4268, applicationCommitSha: sha });
  assert.equal(proof.work_issue, 4268);
  assert.match(proof.generated_types_sha256, /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => createGeneratedTypesProof({ source: t4268, workIssue: 4257, applicationCommitSha: sha }));
  assert.throws(() => createGeneratedTypesProof({ source: "export type Database = {}", workIssue: 4268, applicationCommitSha: sha }));
});

test("4190 passes only with both new schedules active and run since the change", async () => {
  const { evaluateCadence4190 } = await import("./shared-db-live-proof.mjs");
  const ok = [
    { jobname: "refresh-style-guide-library-default-snapshot", schedule: "*/15 * * * *", active: true, succeeded_runs: 4 },
    { jobname: "refresh-style-guide-matviews", schedule: "7 * * * *", active: true, succeeded_runs: 1 },
  ];
  assert.equal(evaluateCadence4190(ok), ok);
  assert.throws(() => evaluateCadence4190([{ ...ok[0], schedule: "*/5 * * * *" }, ok[1]]), NotYetApplied);
  assert.throws(() => evaluateCadence4190([ok[0], { ...ok[1], active: false }]), ProofFailure);
  assert.throws(() => evaluateCadence4190([ok[0], { ...ok[1], succeeded_runs: 0 }]), ProofFailure);
  assert.throws(() => evaluateCadence4190([ok[0]]), ProofFailure);
});
