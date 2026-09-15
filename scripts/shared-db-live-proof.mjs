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
import { pathToFileURL } from "node:url";

const EXPECTED_URL = "https://qsllyeztdwjgirsysgai.supabase.co";
const ENVIRONMENT = "production qsllyeztdwjgirsysgai";
const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const issue = Number(process.env.PROOF_ISSUE);
const commitSha = String(process.env.APPLICATION_COMMIT_SHA || "").toLowerCase();
const proofDir = process.env.PROOF_DIR || "proof";

// Verbatim from each issue's scope block (2911/2934 from the owner's request).
const ASSERTIONS = {
  2792: "A natural service-role call to public.reconcile_stale_sg_files_batch at representative production volume completes under the normal statement timeout without SQLSTATE 57014.",
  2860: "A natural service-role Files-mode call to public.search_style_guide_library_v2 with no query, p_limit=1, offset 0 and modified_desc sort completes under the normal statement timeout without SQLSTATE 57014.",
  2911: "From the application's production service-role connection, read-only: public.style_guide_files has column has_talent_likeness, nullable, with no default, and the application's read of public.style_guide_files still succeeds.",
  2934: "From the application's production service-role connection, read-only: public.deactivate_stale_sg_files no longer exists, and the application's stale-file deactivation path (public.preview_stale_sg_files guard ahead of public.reconcile_stale_sg_files_batch) is still exposed and its read-only guard call succeeds.",
};

export class ProofFailure extends Error {}
export class NotYetApplied extends Error {}

function fail(message) {
  throw new ProofFailure(message);
}

async function call(path, { method = "GET", body, accept = "application/json" } = {}) {
  const started = Date.now();
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: accept,
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

const PROVERS = { 2792: proveReconcile, 2860: proveSearch, 2911: proveColumn, 2934: proveDrop };

async function main() {
  if (url !== EXPECTED_URL) fail("SUPABASE_URL is not the production project");
  if (!key) fail("SUPABASE_SERVICE_ROLE_KEY is empty");
  if (!/^[0-9a-f]{40}$/.test(commitSha)) fail("APPLICATION_COMMIT_SHA must be a 40-character commit sha");
  if (!ASSERTIONS[issue]) fail(`no live assertion is defined for issue ${process.env.PROOF_ISSUE}`);

  let detail;
  try {
    detail = await PROVERS[issue]();
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
    live_assertion: ASSERTIONS[issue],
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
