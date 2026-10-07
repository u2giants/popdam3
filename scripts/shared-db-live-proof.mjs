// Live proof for a shared-db outcome issue (u2giants/shared-db).
//
// Makes the natural service-role call an outcome's live_assertion names against
// production, and writes proof/db-live-proof.json in the exact shape the
// shared-db --complete-outcome checker re-derives (matchesLiveProof). The
// workflow uploads it as shared-db-live-proof-<issue>-<commit sha>.
//
// Exits non-zero and writes no proof when the target is not production, when a
// guard is not satisfied, or when the call fails or reports SQLSTATE 57014.
// When the issue's migration is not on production yet (2911, 2934) it prints
// NOT YET APPLIED, sets step output applied=false, writes no proof, exits 0.
// Every 2911/2934 call is read-only: the PostgREST OpenAPI schema document,
// a one-row select, and the read-only preview guard function.
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const EXPECTED_URL = "https://qsllyeztdwjgirsysgai.supabase.co";
const ENVIRONMENT = "production qsllyeztdwjgirsysgai";
const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const proofKey = String(process.env.PROOF_ISSUE || "");
const issue = Number.parseInt(proofKey, 10);
const commitSha = String(process.env.APPLICATION_COMMIT_SHA || "").toLowerCase();
const proofDir = process.env.PROOF_DIR || "proof";

// Verbatim from each issue's scope block (2911/2934 from the owner's request).
const ASSERTIONS = {
  2792: "A natural service-role call to public.reconcile_stale_sg_files_batch at representative production volume completes under the normal statement timeout without SQLSTATE 57014.",
  2860: "A natural service-role Files-mode call to public.search_style_guide_library_v2 with no query, p_limit=1, offset 0 and modified_desc sort completes under the normal statement timeout without SQLSTATE 57014.",
  2911: "From the application's production service-role connection, read-only: public.style_guide_files has column has_talent_likeness, nullable, with no default, and the application's read of public.style_guide_files still succeeds.",
  2802: "a PopDAM read of a style-guide file returns has_talent_likeness as true, false or null exactly as stored, with null distinguishable from false",
  3418: "In production, only the current unexpired submission-lease holder presenting its exact receipt and current revision can reset an unbound provider submission after PopDAM verifies provider origin and parses a nonempty JSON validation error with HTTP 400 or 422; timeout, disconnect, unreadable or plain-text error, other 4xx, 5xx, expired or ambiguous lease, bound provider ID, wrong holder, wrong receipt, or wrong revision cannot reset or remint a receipt for another caller. PopDAM owns the later no-duplicate-POST live retry proof.",
  "3418-retry": "In production, PopDAM's own fixture operation proves the retry path of public.reset_bulk_operation_submission_lease: the current unexpired holder presenting its exact receipt and current revision resets an unbound submission once, no receipt is returned or reminted, the consumed receipt cannot reset again, and only a later fresh-revision claim mints a new receipt; a wrong holder with the right receipt, an expired lease, and an ambiguous lease are each refused with SQLSTATE 55000 and leave the operation unchanged. Every fixture is created and removed by the proof; no other operation is written.",
  3457: "On production, public.search_dam_documents has the 8-arg signature with p_min_semantic_score real default null, the 7-arg signature is dropped, execute is granted to authenticated and service_role only, a semantic floor is applied only inside the semantic leg before blend, and null floor preserves prior blended-rank behaviour exactly.",
  4037: "production app.handle_new_auth_user() inserts app.app_access(profile_id,'dam') for new users whose email ends in @popcre.com, keeping existing behaviour",
  2934: "From the application's production service-role connection, read-only: public.deactivate_stale_sg_files no longer exists, and the application's stale-file deactivation path (public.preview_stale_sg_files guard ahead of public.reconcile_stale_sg_files_batch) is still exposed and its read-only guard call succeeds.",
};

export class ProofFailure extends Error {}
export class NotYetApplied extends Error {}

function fail(message) {
  throw new ProofFailure(message);
}

async function call(path, { method = "GET", body, accept = "application/json", profile } = {}) {
  const started = Date.now();
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: accept,
      ...(profile ? { "Accept-Profile": profile } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    const code = json?.code ?? "unknown";
    fail(`${method} ${path} returned HTTP ${response.status} (code ${code}) after ${elapsedMs} ms: ${json?.message ?? text.slice(0, 300)}`);
  }
  return { json, elapsedMs };
}

// Pure evaluators over the PostgREST OpenAPI document (schema only, no rows).
// PostgREST lists NOT NULL columns without a default in `required`, and emits
// `default` only for columns that have one.
export function evaluateColumn2911(openapi) {
  const def = openapi?.definitions?.style_guide_files;
  if (!def?.properties) fail("OpenAPI document has no style_guide_files definition");
  const column = def.properties.has_talent_likeness;
  if (!column) throw new NotYetApplied("public.style_guide_files.has_talent_likeness is not present");
  const nullable = !(def.required || []).includes("has_talent_likeness");
  const hasDefault = Object.prototype.hasOwnProperty.call(column, "default");
  if (!nullable) fail("has_talent_likeness is NOT NULL");
  if (hasDefault) fail(`has_talent_likeness has a default (${JSON.stringify(column.default)})`);
  return { column: "public.style_guide_files.has_talent_likeness", format: column.format ?? null, nullable, has_default: hasDefault };
}

export function evaluateDrop2934(openapi) {
  const paths = openapi?.paths;
  if (!paths || typeof paths !== "object") fail("OpenAPI document has no paths");
  if (paths["/rpc/deactivate_stale_sg_files"]) throw new NotYetApplied("public.deactivate_stale_sg_files still exists");
  for (const name of ["preview_stale_sg_files", "reconcile_stale_sg_files_batch"]) {
    if (!paths[`/rpc/${name}`]) fail(`current stale-file path public.${name} is missing`);
  }
  return {
    dropped: "public.deactivate_stale_sg_files",
    current_path: ["public.preview_stale_sg_files", "public.reconcile_stale_sg_files_batch"],
  };
}

// Pure check of one PopDAM style-guide file read: the key is present and its
// JSON value is exactly true, false or null, so null never collapses to false.
export function evaluateLikenessRead2802(rows, expected) {
  if (!Array.isArray(rows)) fail("style_guide_files read did not return rows");
  for (const row of rows) {
    if (!row || !Object.prototype.hasOwnProperty.call(row, "has_talent_likeness")) {
      fail("style_guide_files read omitted has_talent_likeness");
    }
    if (row.has_talent_likeness !== expected) {
      fail(`row ${row.id} filtered as ${expected} was read back as ${JSON.stringify(row.has_talent_likeness)}`);
    }
  }
  return rows.length;
}

// Pure: the one exposed search_dam_documents takes p_min_semantic_score.
export function evaluateSearch3457(openapi) {
  const post = openapi?.paths?.["/rpc/search_dam_documents"]?.post;
  if (!post) fail("public.search_dam_documents is not exposed");
  const body = (post.parameters || []).find((p) => p.in === "body");
  const props = body?.schema?.properties || {};
  if (!props.p_min_semantic_score) throw new NotYetApplied("search_dam_documents has no p_min_semantic_score");
  const names = Object.keys(props).sort();
  if (names.length !== 8) fail(`search_dam_documents exposes ${names.length} args, expected 8`);
  return { function: "public.search_dam_documents", args: names, p_min_semantic_score: props.p_min_semantic_score.format ?? null };
}

// Pure: the reset function is exposed with its seven arguments.
export function evaluateReset3418(openapi) {
  const post = openapi?.paths?.["/rpc/reset_bulk_operation_submission_lease"]?.post;
  if (!post) throw new NotYetApplied("public.reset_bulk_operation_submission_lease is not exposed");
  const body = (post.parameters || []).find((p) => p.in === "body");
  const names = Object.keys(body?.schema?.properties || {}).sort();
  const expected = ["p_expected_revision", "p_http_status", "p_lease_token", "p_op_key", "p_provider_error", "p_reason", "p_submission_owner"];
  if (JSON.stringify(names) !== JSON.stringify(expected)) fail(`reset function args are ${names.join(",")}`);
  return { function: "public.reset_bulk_operation_submission_lease", args: names };
}

// Pure: a guarded call must be refused with the expected SQLSTATE.
export function evaluateRefusal(name, status, json, expectedCode) {
  if (status < 400) fail(`guard ${name} was NOT refused (HTTP ${status})`);
  if (json?.code !== expectedCode) fail(`guard ${name} refused with ${json?.code ?? "unknown"}, expected ${expectedCode}`);
  return { guard: name, http: status, sqlstate: json.code };
}

async function rawPost(path, body) {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json };
}

async function bulkOperationsFingerprint() {
  const { json } = await call("/rest/v1/admin_config?select=value,updated_at&key=eq.BULK_OPERATIONS");
  const row = Array.isArray(json) ? json[0] : null;
  return {
    updated_at: row?.updated_at ?? null,
    sha256: createHash("sha256").update(JSON.stringify(row?.value ?? null)).digest("hex"),
    value: row?.value ?? null,
  };
}

// Non-mutating: every call below is built so a guard must refuse it (a random,
// never-issued receipt can never match the stored md5 lease proof), and the
// BULK_OPERATIONS row is fingerprinted before and after.
async function proveLeaseReset() {
  const schema = evaluateReset3418(await openapi());
  const before = await bulkOperationsFingerprint();
  const fn = "/rest/v1/rpc/reset_bulk_operation_submission_lease";
  const evidence = { p_reason: "provider_definitive_rejection", p_http_status: 400, p_provider_error: { message: "live proof" } };
  const missingKey = `live-proof-nonexistent-${randomUUID()}`;
  const base = { p_op_key: missingKey, p_expected_revision: 0, p_submission_owner: "live-proof", p_lease_token: randomUUID(), ...evidence };
  const cases = [
    ["http_status_500", { ...base, p_http_status: 500 }, "22023"],
    ["http_status_404", { ...base, p_http_status: 404 }, "22023"],
    ["http_status_408_timeout", { ...base, p_http_status: 408 }, "22023"],
    ["reason_not_definitive_rejection", { ...base, p_reason: "timeout" }, "22023"],
    ["empty_provider_error", { ...base, p_provider_error: {} }, "22023"],
    ["plain_text_provider_error", { ...base, p_provider_error: "plain text" }, "22023"],
    ["missing_receipt", { ...base, p_lease_token: "" }, "22023"],
    ["nonexistent_operation", base, "55000"],
  ];
  const opKey = Object.keys(before.value && typeof before.value === "object" ? before.value : {})[0];
  if (opKey) {
    const revision = Number(before.value[opKey]?.state_revision ?? 0) || 0;
    const real = { ...base, p_op_key: opKey, p_expected_revision: revision };
    cases.push(["existing_operation_wrong_receipt", { ...real, p_lease_token: randomUUID() }, "55000"]);
    cases.push(["existing_operation_wrong_revision", { ...real, p_expected_revision: revision + 1000000 }, "55000"]);
  }
  const refusals = [];
  for (const [name, args, code] of cases) {
    const { status, json } = await rawPost(fn, args);
    refusals.push(evaluateRefusal(name, status, json, code));
  }
  const after = await bulkOperationsFingerprint();
  if (after.sha256 !== before.sha256 || after.updated_at !== before.updated_at) fail("BULK_OPERATIONS changed during the refusal calls");
  return {
    call: "public.reset_bulk_operation_submission_lease guarded refusals",
    elapsed_ms: 0,
    schema,
    refusals,
    row_unchanged: { key: "BULK_OPERATIONS", updated_at: after.updated_at, sha256: after.sha256 },
    not_exercised: "success path, expired/ambiguous lease, bound provider id and wrong holder on a live lease were not called; PopDAM owns the later no-duplicate-POST live retry proof",
  };
}

// Read-only: schema check plus two keyword searches with and without a floor.
async function proveSearchFloor() {
  const schema = evaluateSearch3457(await openapi());
  const common = { p_query: "mug", p_filters: {}, p_limit: 5, p_offset: 0 };
  const seven = await rawPost("/rest/v1/rpc/search_dam_documents", { ...common, p_document_types: null, p_query_embedding: null, p_min_rank: 0 });
  if (seven.status >= 400) fail(`7-named-arg call failed (${seven.json?.code}); overload ambiguity would mean the 7-arg form still exists`);
  const nullFloor = await call("/rest/v1/rpc/search_dam_documents", { method: "POST", body: { ...common, p_min_semantic_score: null } });
  const floor = await call("/rest/v1/rpc/search_dam_documents", { method: "POST", body: { ...common, p_min_semantic_score: 0.5 } });
  const ids = (rows) => (Array.isArray(rows) ? rows.map((r) => `${r.document_type}:${r.entity_id}:${r.rank}`) : null);
  if (!ids(nullFloor.json) || !ids(floor.json)) fail("search did not return rows arrays");
  const same = JSON.stringify(ids(nullFloor.json)) === JSON.stringify(ids(floor.json));
  if (!same) fail("a floor without an embedding changed keyword results");
  return {
    call: "public.search_dam_documents keyword query, null floor vs 0.5 floor, no embedding",
    elapsed_ms: nullFloor.elapsedMs + floor.elapsedMs,
    schema,
    seven_named_arg_call_unambiguous: true,
    rows_null_floor: nullFloor.json.length,
    rows_floor_0_5: floor.json.length,
    identical_results: same,
    not_proven: "grants (anon denied) not checked: no anon key available; semantic-leg floor with an embedding and exact prior-rank equivalence not exercised",
  };
}

async function openapi() {
  const { json } = await call("/rest/v1/", { accept: "application/openapi+json" });
  if (!json) fail("OpenAPI document was not JSON");
  return json;
}

async function proveColumn() {
  const schema = evaluateColumn2911(await openapi());
  const { json, elapsedMs } = await call("/rest/v1/style_guide_files?select=id,relative_path,is_active,has_talent_likeness&limit=1");
  if (!Array.isArray(json)) fail("style_guide_files read did not return rows");
  return { call: "GET public.style_guide_files limit 1", elapsed_ms: elapsedMs, rows_read: json.length, schema };
}

// Read-only: the same PopSG file read the app makes, once per stored state,
// plus exact counts of true, false and null.
async function proveLikeness() {
  evaluateColumn2911(await openapi());
  const base = "/rest/v1/style_guide_files?select=id,filename,has_talent_likeness";
  const states = { true: "is.true", false: "is.false", null: "is.null" };
  const reads = {};
  const counts = {};
  let elapsed = 0;
  for (const [name, filter] of Object.entries(states)) {
    const { json, elapsedMs } = await call(`${base}&has_talent_likeness=${filter}&limit=1`);
    elapsed += elapsedMs;
    reads[name] = evaluateLikenessRead2802(json, JSON.parse(name));
    counts[name] = await countWhere(`has_talent_likeness=${filter}`);
  }
  if (reads.null + reads.true + reads.false === 0) fail("no style_guide_files row was read");
  return { call: "GET public.style_guide_files has_talent_likeness per state", elapsed_ms: elapsed, rows_read: reads, counts };
}

async function countWhere(filter) {
  const response = await fetch(`${url}/rest/v1/style_guide_files?select=id&${filter}&limit=1`, {
    method: "HEAD",
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
  });
  if (!response.ok) fail(`count ${filter} returned HTTP ${response.status}`);
  const total = Number((response.headers.get("content-range") || "").split("/")[1]);
  if (!Number.isFinite(total)) fail(`count ${filter} returned no total`);
  return total;
}

async function proveDrop() {
  const schema = evaluateDrop2934(await openapi());
  const { json: runs } = await call("/rest/v1/style_guide_crawl_runs?select=id&status=eq.completed&order=created_at.desc&limit=1");
  const run = Array.isArray(runs) ? runs[0] : null;
  if (!run?.id) fail("no completed crawl run for the read-only guard call");
  const args = { p_root_label: "styleguides", p_run_id: run.id, p_min_ratio: 0.5 };
  const { json, elapsedMs } = await call("/rest/v1/rpc/preview_stale_sg_files", { method: "POST", body: args });
  const preview = Array.isArray(json) ? json[0] : json;
  if (!preview || !("guard_state" in preview)) fail("preview_stale_sg_files returned no guard result");
  return { call: "public.preview_stale_sg_files", args, elapsed_ms: elapsedMs, guard_state: preview.guard_state, schema };
}

async function proveSearch() {
  const args = { p_result_mode: "files", p_query: null, p_limit: 1, p_offset: 0, p_sort: "modified_desc" };
  const { json, elapsedMs } = await call("/rest/v1/rpc/search_style_guide_library_v2", { method: "POST", body: args });
  if (!json || typeof json !== "object") fail("search returned no JSON result");
  return { call: "public.search_style_guide_library_v2", args, elapsed_ms: elapsedMs, total: json.total ?? null };
}

async function proveReconcile() {
  const { json: open } = await call("/rest/v1/style_guide_crawl_runs?select=id,status&status=not.in.(completed,failed)&limit=1");
  if (Array.isArray(open) && open.length) fail(`a crawl run is in flight (${open[0].id}); refusing to reconcile beside it`);
  const { json: runs } = await call("/rest/v1/style_guide_crawl_runs?select=id,files_found,lifecycle_state&status=eq.completed&order=created_at.desc&limit=1");
  const run = Array.isArray(runs) ? runs[0] : null;
  if (!run?.id) fail("no completed crawl run to reconcile against");
  const rootLabel = "styleguides";
  const guardArgs = { p_root_label: rootLabel, p_run_id: run.id, p_min_ratio: 0.5 };
  const { json: previewRows } = await call("/rest/v1/rpc/preview_stale_sg_files", { method: "POST", body: guardArgs });
  const preview = Array.isArray(previewRows) ? previewRows[0] : previewRows;
  if (!preview?.safe_to_reconcile) fail(`preview guard is ${preview?.guard_state ?? "unreadable"}; refusing to call reconcile`);
  if (Number(preview.stale_candidates) !== 0) fail(`preview reports ${preview.stale_candidates} stale rows; refusing a proof call that would deactivate rows`);
  const args = { p_root_label: rootLabel, p_run_id: run.id, p_batch_size: 500, p_min_ratio: 0.5 };
  const { json, elapsedMs } = await call("/rest/v1/rpc/reconcile_stale_sg_files_batch", { method: "POST", body: args });
  const batch = Array.isArray(json) ? json[0] : json;
  if (!batch || batch.guard_state !== "ok") fail(`reconcile guard is ${batch?.guard_state ?? "unreadable"}`);
  if (Number(batch.deactivated) !== 0) fail(`reconcile deactivated ${batch.deactivated} rows`);
  return {
    call: "public.reconcile_stale_sg_files_batch",
    args,
    elapsed_ms: elapsedMs,
    active_total: Number(preview.active_total),
    run_active_total: Number(preview.run_active_total),
    result: batch,
  };
}

async function setOutput(applied) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `applied=${applied}\n`);
}

// ── 3418 retry proof: PopDAM-owned fixture operations ─────────────────────────
// Each fixture is one key "live-proof-3418-<uuid>" inside the app's own
// admin_config BULK_OPERATIONS row, created through the app's guarded writer
// and removed afterwards by a compare-and-swap PATCH that deletes only fixture
// keys and only if the row did not change since it was read. The live worker
// may see a fixture for a moment (its updated_at is set far in the future so a
// real running operation always sorts first); if the worker touches a fixture
// the attempt is discarded and retried with a fresh key.
const FIXTURE_PREFIX = "live-proof-3418-";
const FAR_FUTURE = "2999-01-01T00:00:00.000Z";
const RESET_FN = "/rest/v1/rpc/reset_bulk_operation_submission_lease";
const WRITE_FN = "/rest/v1/rpc/update_bulk_operation";
const REJECTION = { p_reason: "provider_definitive_rejection", p_http_status: 422, p_provider_error: { error: { message: "live proof fixture rejection" } } };
const LEASE_FIELDS = ["submission_owner", "lease_expires_at", "lease_claimed_at", "lease_proof", "lease_token"];
class WorkerTouched extends Error {}

export function fixtureState(phase = "submitting") {
  return { status: "running", updated_at: FAR_FUTURE, live_proof: "popcre/shared-db#3418", external_job: { phase } };
}

// Pure: a claim envelope that minted exactly one receipt.
export function evaluateClaim(envelope, expectedRevision) {
  if (!envelope?.ok) fail(`fixture claim refused (${envelope?.reason ?? "no envelope"})`);
  if (envelope.lease_receipt_issued !== true || typeof envelope.lease_token !== "string" || !envelope.lease_token) fail("fixture claim minted no receipt");
  if (envelope.state_revision !== expectedRevision) fail(`claim revision ${envelope.state_revision}, expected ${expectedRevision}`);
  return envelope.lease_token;
}

// Pure: the successful reset consumed the lease and returned no receipt.
export function evaluateReset(result, expectedRevision) {
  if (result?.ok !== true || result.reason !== "provider_definitive_rejection") fail("reset did not report ok");
  if (result.lease_receipt_issued !== false || result.lease_token !== null) fail("reset returned or reminted a receipt");
  if (result.state_revision !== expectedRevision) fail(`reset revision ${result.state_revision}, expected ${expectedRevision}`);
  const job = result.operation?.external_job;
  if (job?.phase !== "prepared") fail(`reset left phase ${job?.phase}`);
  for (const field of LEASE_FIELDS) if (job && Object.prototype.hasOwnProperty.call(job, field)) fail(`reset kept lease field ${field}`);
  if (job?.last_definitive_rejection_status !== REJECTION.p_http_status) fail("reset did not record the rejection status");
  if (Object.prototype.hasOwnProperty.call(result.operation?.external_job ?? {}, "provider_error")) fail("reset stored the provider error body");
  return { state_revision: result.state_revision, phase: job.phase, lease_receipt_issued: false, lease_fields_cleared: true };
}

async function readOps() {
  const { json } = await call("/rest/v1/admin_config?select=value,updated_at&key=eq.BULK_OPERATIONS");
  const row = Array.isArray(json) ? json[0] : null;
  return { value: row?.value && typeof row.value === "object" ? row.value : {}, updated_at: row?.updated_at ?? null };
}

async function fixtureOp(key) {
  const op = (await readOps()).value[key];
  if (!op || op.status !== "running" || op.live_proof !== "popcre/shared-db#3418") throw new WorkerTouched(`fixture ${key} was changed by another writer`);
  return op;
}

async function claim(key, revision, owner, leaseSeconds, phase = "submitting") {
  const { status, json } = await rawPost(WRITE_FN, {
    p_op_key: key, p_op_state: fixtureState(phase), p_expected_revision: revision,
    p_submission_owner: owner, p_lease_seconds: leaseSeconds,
  });
  if (status >= 400) fail(`fixture claim HTTP ${status} ${json?.code ?? ""}: ${json?.message ?? ""}`);
  if (!json?.ok && json?.reason === "revision_conflict") throw new WorkerTouched("fixture revision moved before claim");
  return evaluateClaim(json, revision + 1);
}

async function refusedUnchanged(name, key, args) {
  const before = await fixtureOp(key);
  const { status, json } = await rawPost(RESET_FN, args);
  const refusal = evaluateRefusal(name, status, json, "55000");
  const after = await fixtureOp(key);
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new WorkerTouched(`fixture changed around ${name}`);
  return { ...refusal, operation_unchanged: true, state_revision: Number(after.state_revision) };
}

const resetArgs = (key, revision, owner, token) => ({ p_op_key: key, p_expected_revision: revision, p_submission_owner: owner, p_lease_token: token, ...REJECTION });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryCase(key) {
  const owner = `live-proof-holder-${randomUUID()}`;
  const token = await claim(key, 0, owner, 120);
  const wrongHolder = await refusedUnchanged("wrong_holder_with_real_receipt", key, resetArgs(key, 1, `live-proof-other-${randomUUID()}`, token));
  const { status, json } = await rawPost(RESET_FN, resetArgs(key, 1, owner, token));
  if (status >= 400) {
    await fixtureOp(key);
    fail(`holder reset refused HTTP ${status} ${json?.code}: ${json?.message}`);
  }
  const reset = evaluateReset(json, 2);
  const replay = await refusedUnchanged("consumed_receipt_replay", key, resetArgs(key, 2, owner, token));
  const stale = await refusedUnchanged("consumed_receipt_old_revision", key, resetArgs(key, 1, owner, token));
  const retryOwner = `live-proof-retry-${randomUUID()}`;
  const retryToken = await claim(key, 2, retryOwner, 120);
  if (retryToken === token) fail("fresh claim reissued the consumed receipt");
  return { wrong_holder: wrongHolder, holder_reset: reset, replay, stale_revision: stale, fresh_claim: { state_revision: 3, new_receipt_minted: true, differs_from_consumed: true } };
}

async function expiredAndAmbiguousCase(key) {
  const owner = `live-proof-holder-${randomUUID()}`;
  const token = await claim(key, 0, owner, 1);
  await sleep(2500);
  const op = await fixtureOp(key);
  if (Date.parse(op.external_job.lease_expires_at) > Date.now()) fail("fixture lease did not expire");
  const expired = await refusedUnchanged("expired_lease_holder_receipt", key, resetArgs(key, 1, owner, token));
  // The app's guarded writer records the ambiguity verdict for the expired, unbound lease.
  const { status, json } = await rawPost(WRITE_FN, { p_op_key: key, p_op_state: fixtureState("submitting"), p_expected_revision: 1 });
  if (status >= 400) fail(`ambiguity write HTTP ${status}: ${json?.message}`);
  if (json?.reason !== "ambiguous_submission" || json?.external_job_phase !== "ambiguous_submission") throw new WorkerTouched(`ambiguity verdict not recorded (${json?.reason})`);
  const ambiguous = await refusedUnchanged("ambiguous_lease_holder_receipt", key, resetArgs(key, 2, owner, token));
  return { expired, ambiguous };
}

async function removeFixtures() {
  for (let pass = 0; pass < 20; pass += 1) {
    const { value, updated_at } = await readOps();
    const keys = Object.keys(value).filter((k) => k.startsWith(FIXTURE_PREFIX));
    if (keys.length === 0) {
      if (pass > 0) {
        // Let one worker tick pass, then confirm nothing resurrected a fixture.
        await sleep(3000);
        const again = Object.keys((await readOps()).value).filter((k) => k.startsWith(FIXTURE_PREFIX));
        if (again.length === 0) return;
        continue;
      }
      return;
    }
    const next = { ...value };
    for (const k of keys) delete next[k];
    const response = await fetch(`${url}/rest/v1/admin_config?key=eq.BULK_OPERATIONS&updated_at=eq.${encodeURIComponent(updated_at)}`, {
      method: "PATCH",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ value: next, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) fail(`fixture cleanup PATCH HTTP ${response.status}`);
    await response.json();
    await sleep(500);
  }
  fail("fixture cleanup did not converge");
}

async function attempt(name, fn) {
  for (let tries = 1; tries <= 6; tries += 1) {
    const opKey = `${FIXTURE_PREFIX}${name}-${randomUUID()}`;
    try {
      const result = await fn(opKey);
      return { ...result, attempts: tries };
    } catch (error) {
      if (!(error instanceof WorkerTouched)) throw error;
      console.log(`attempt ${tries} of ${name} discarded: ${error.message}`);
    } finally {
      await removeFixtures();
    }
  }
  fail(`${name}: the live worker touched every fixture attempt`);
}

async function proveLeaseRetry() {
  const schema = evaluateReset3418(await openapi());
  const started = Date.now();
  await removeFixtures();
  try {
    const retry = await attempt("retry", retryCase);
    const expiry = await attempt("expiry", expiredAndAmbiguousCase);
    return { call: "public.reset_bulk_operation_submission_lease retry path on PopDAM fixture operations", elapsed_ms: Date.now() - started, schema, ...retry, ...expiry, fixtures_removed: true };
  } finally {
    await removeFixtures();
  }
}

// 4037: the signup hook change was applied to production at this instant
// (popcre/shared-db run 37669223667). Read-only and observational: no account is
// created. Every app.profile at the popcre.com domain created after it must
// carry app.app_access 'dam'; with none yet, the proof waits (NOT YET APPLIED).
export const SIGNUP_GRANT_APPLIED_AT = "2026-10-07T18:50:40Z";
const POPCRE_ADDRESS = /^[^@]+@popcre\.com$/;

// Pure: profiles created after the apply, each with its access rows.
export function evaluateSignupGrant4037(profiles, accessRows) {
  if (!Array.isArray(profiles) || !Array.isArray(accessRows)) fail("signup grant read did not return rows");
  const employees = profiles.filter((p) => POPCRE_ADDRESS.test(String(p?.email ?? "").toLowerCase())
    && Date.parse(p.created_at) > Date.parse(SIGNUP_GRANT_APPLIED_AT));
  if (!employees.length) throw new NotYetApplied(`no popcre.com sign-up since ${SIGNUP_GRANT_APPLIED_AT} to observe`);
  const has = (id, app) => accessRows.some((r) => r.profile_id === id && r.app === app);
  for (const p of employees) {
    if (!has(p.id, "dam")) fail(`profile ${p.id} signed up at ${p.created_at} without app_access dam`);
    if (!has(p.id, "crm")) fail(`profile ${p.id} lost the existing crm grant`);
  }
  return employees.length;
}

async function proveSignupGrant() {
  const since = encodeURIComponent(SIGNUP_GRANT_APPLIED_AT);
  const profiles = await call(`/rest/v1/profile?select=id,email,created_at&email=ilike.*%40popcre.com&created_at=gt.${since}`, { profile: "app" });
  const ids = (profiles.json || []).map((p) => p.id);
  const access = ids.length
    ? await call(`/rest/v1/app_access?select=profile_id,app&profile_id=in.(${ids.join(",")})`, { profile: "app" })
    : { json: [], elapsedMs: 0 };
  const observed = evaluateSignupGrant4037(profiles.json, access.json);
  return { call: "GET app.profile + app.app_access for popcre.com sign-ups after the apply (read-only)", elapsed_ms: profiles.elapsedMs + access.elapsedMs, applied_at: SIGNUP_GRANT_APPLIED_AT, employee_signups_observed: observed, all_have_dam: true };
}

const PROVERS = { 2792: proveReconcile, 2802: proveLikeness, 2860: proveSearch, 2911: proveColumn, 2934: proveDrop, 3418: proveLeaseReset, "3418-retry": proveLeaseRetry, 3457: proveSearchFloor, 4037: proveSignupGrant };

async function main() {
  if (url !== EXPECTED_URL) fail("SUPABASE_URL is not the production project");
  if (!key) fail("SUPABASE_SERVICE_ROLE_KEY is empty");
  if (!/^[0-9a-f]{40}$/.test(commitSha)) fail("APPLICATION_COMMIT_SHA must be a 40-character commit sha");
  if (!ASSERTIONS[proofKey] || !Number.isInteger(issue)) fail(`no live assertion is defined for issue ${process.env.PROOF_ISSUE}`);

  let detail;
  try {
    detail = await PROVERS[proofKey]();
  } catch (error) {
    if (error instanceof NotYetApplied) {
      console.log(`NOT YET APPLIED: issue ${issue}: ${error.message}; no proof written`);
      await setOutput(false);
      return;
    }
    throw error;
  }
  const proof = {
    schema_version: 1,
    work_issue: issue,
    application_commit_sha: commitSha,
    live_assertion: ASSERTIONS[proofKey],
    environment: ENVIRONMENT,
    result: "passed",
    observed_at: new Date().toISOString(),
    detail,
  };
  await mkdir(proofDir, { recursive: true });
  await writeFile(`${proofDir}/db-live-proof.json`, `${JSON.stringify(proof, null, 2)}\n`);
  await setOutput(true);
  console.log(JSON.stringify({ work_issue: issue, observed_at: proof.observed_at, elapsed_ms: detail.elapsed_ms }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`LIVE PROOF FAILED: ${error instanceof ProofFailure ? error.message : error?.stack || error}`);
    process.exit(1);
  });
}
