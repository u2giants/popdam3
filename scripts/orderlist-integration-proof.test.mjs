import test from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE_EVIDENCE,
  createGeneratedTypesProof,
  createLiveProof,
  selectAuthenticatedReadHeaders,
  shouldBlockSupabaseRequest,
  validateCommitInputs,
  validateBaselineEvidence,
  validateBuildBinding,
  validateGeneratedTypes,
  validateFindCandidate,
} from "./orderlist-integration-proof-contract.mjs";

const workflowSha = "b".repeat(40);
const frontendSha = "a".repeat(40);

function baselineEvidence() {
  const make = (kind) => {
    const expected = BASELINE_EVIDENCE[kind];
    return {
      run: { id: expected.runId, head_sha: BASELINE_EVIDENCE.headSha, head_branch: "main", status: "completed", conclusion: "success", event: "workflow_dispatch" },
      artifact: { id: expected.artifactId, name: expected.artifactName, expired: false, digest: expected.digest, workflow_run: { id: expected.runId, head_sha: BASELINE_EVIDENCE.headSha } },
      comment: { id: expected.commentId, body: expected.commentPhrase },
    };
  };
  return { repository: BASELINE_EVIDENCE.repository, head_sha: BASELINE_EVIDENCE.headSha, preview: make("preview"), production: make("production") };
}

function generatedTypes(overrides = {}) {
  const properties = (names) => names.map((name) => `${JSON.stringify(name)}: {}`).join(";\n");
  const functions = {
    get_dam_order_tracking: ["p_offset", "p_limit", "p_search", "p_only_open"],
    update_dam_order_tracking: ["p_order_id", "p_patch"],
    upsert_dam_order_sample_depth: ["p_sku", "p_customer", "p_depth_inches"],
    upsert_dam_order_customer_settings: ["p_customer", "p_suffix"],
    get_dam_style_tracker_license_status: ["p_row_ids"],
  };
  const apiViews = {
    dam_order_list: ["order_line_id", "item_id", "item_description", "master_data_description", "product_workflow_source", "sample_depth_inches"],
    dam_order_sample_depth: ["sku_normalized", "customer_normalized", "depth_inches", "depth_raw", "source_row_number"],
    dam_order_customer_settings: ["customer_normalized", "suffix"],
    dam_order_vendor_statistics: ["factory_id", "vendor_name", "order_count", "closed_orders", "open_orders", "last_sent_po_date", "activity_status"],
  };
  if (overrides.missingFunction) delete functions[overrides.missingFunction];
  if (overrides.missingArgument) functions.get_dam_order_tracking = functions.get_dam_order_tracking.filter((name) => name !== overrides.missingArgument);
  if (overrides.missingViewField) apiViews.dam_order_list = apiViews.dam_order_list.filter((name) => name !== overrides.missingViewField);
  const publicFns = Object.entries(functions).map(([name, args]) => `${JSON.stringify(name)}: { Args: { ${properties(args)} } }`).join(";\n");
  const views = Object.entries(apiViews).map(([name, fields]) => `${JSON.stringify(name)}: { Row: { ${properties(fields)} } }`).join(";\n");
  const tracking = properties(["order_id", "production_order_number", "components", "mbl", "cbm", "comment", "payment_note"]);
  return `export type Database = {
    public: { Functions: { ${publicFns} } };
    api: { Views: { ${views} } };
    dam: { Views: { "dam_order_tracking": { Row: { ${tracking} } } } };
    ${"// generated schema fixture padding to model the real generated file shape; ".repeat(24)}
  };`;
}

test("proof binding requires exact deployed ancestry, unchanged frontend inputs, and build stamp", () => {
  assert.deepEqual(validateBuildBinding({
    ref: "refs/heads/main", workflowSha, deployedFrontendSha: frontendSha,
    isAncestor: true, frontendTreeEqual: true, observedToken: frontendSha.slice(0, 7),
  }), { workflowSha, deployedFrontendSha: frontendSha, buildToken: frontendSha.slice(0, 7), observedToken: frontendSha.slice(0, 7) });
  assert.deepEqual(validateBuildBinding({
    ref: "refs/heads/main", workflowSha: frontendSha, deployedFrontendSha: frontendSha,
    isAncestor: true, frontendTreeEqual: true, observedToken: frontendSha.slice(0, 8),
  }), { workflowSha: frontendSha, deployedFrontendSha: frontendSha, buildToken: frontendSha.slice(0, 7), observedToken: frontendSha.slice(0, 8) });
  assert.throws(() => validateBuildBinding({ ref: "refs/heads/main", workflowSha, deployedFrontendSha: frontendSha, isAncestor: true, frontendTreeEqual: true, observedToken: "deadbee" }), /stamp/);
  assert.throws(() => validateBuildBinding({ ref: "refs/heads/feature", workflowSha, deployedFrontendSha: frontendSha, isAncestor: true, frontendTreeEqual: true, observedToken: frontendSha.slice(0, 7) }), /main/);
  assert.throws(() => validateBuildBinding({ ref: "refs/heads/main", workflowSha, deployedFrontendSha: frontendSha, isAncestor: true, frontendTreeEqual: false, observedToken: frontendSha.slice(0, 7) }), /inputs changed/);
  assert.throws(() => validateCommitInputs({ ref: "refs/heads/main", workflowSha: "--help", deployedFrontendSha: frontendSha }), /full 40-character SHAs/);
});

test("browser write guard denies every production REST mutation except listed read-only RPCs", () => {
  const host = "qsllyeztdwjgirsysgai.supabase.co";
  for (const method of ["GET", "HEAD", "OPTIONS"]) assert.equal(shouldBlockSupabaseRequest({ host, path: "/rest/v1/dam_order_list", method }), false);
  assert.equal(shouldBlockSupabaseRequest({ host, path: "/rest/v1/rpc/get_dam_order_tracking", method: "POST" }), false);
  assert.equal(shouldBlockSupabaseRequest({ host, path: "/rest/v1/rpc/get_dam_style_tracker_license_status", method: "POST" }), false);
  assert.equal(shouldBlockSupabaseRequest({ host, path: "/rest/v1/rpc/find_dam_order_list_row", method: "POST" }), false);
  for (const name of ["get_filter_counts", "get_path_facets", "get_dam_material_facets", "get_dam_customer_facets", "search_style_tracker_link_candidates"]) {
    assert.equal(shouldBlockSupabaseRequest({host, path: `/rest/v1/rpc/${name}`, method: "POST", body: name === "search_style_tracker_link_candidates" ? {p_limit:8} : undefined}), false);
    for (const method of ["PATCH", "PUT", "DELETE"]) assert.equal(shouldBlockSupabaseRequest({host, path: `/rest/v1/rpc/${name}`, method}), true);
  }
  for (const body of [undefined, {}, {p_limit:0}, {p_limit:501}, {p_limit:1.5}]) assert.equal(shouldBlockSupabaseRequest({host, path:"/rest/v1/rpc/search_style_tracker_link_candidates", method:"POST", body}), true);
  for (const request of [
    { path: "/rest/v1/rpc/update_dam_order_tracking", method: "POST" },
    { path: "/rest/v1/rpc/upsert_dam_order_sample_depth", method: "POST" },
    { path: "/rest/v1/rpc/unreviewed_function", method: "POST" },
    { path: "/rest/v1/dam_order_tracking", method: "POST" },
    { path: "/rest/v1/style_tracker_rows_with_bridge?id=eq.some-id", method: "PATCH" },
    { path: "/rest/v1/dam_order_list", method: "DELETE" },
  ]) assert.equal(shouldBlockSupabaseRequest({ host, ...request }), true);
  assert.equal(shouldBlockSupabaseRequest({ host: "auth.example.test", path: "/auth/v1/token", method: "POST" }), false);
});

test("filtered API reads forward only bearer, API key, and accepted schema headers", () => {
  assert.deepEqual(selectAuthenticatedReadHeaders({
    authorization: "Bearer protected-token",
    apikey: "anon-key",
    accept: "application/json",
    "accept-profile": "unexpected",
    ":authority": "qsllyeztdwjgirsysgai.supabase.co",
    cookie: "session=private",
    range: "0-499",
  }), {
    authorization: "Bearer protected-token",
    apikey: "anon-key",
    accept: "application/json",
    "accept-profile": "api",
  });
});

test("Find identity must come from the RPC and row data must be bounded before UI acceptance", () => {
  const candidates = [{ order_line_id: "line-A", row_index: 10380 }];
  const cached = validateFindCandidate({ candidateRows: candidates, expectedRowId: "line-A", boundedRowIds: ["line-A"] });
  assert.deepEqual(cached, { orderLineId: "line-A", rowIndex: 10380, hasBoundedRowEvidence: true });

  const uncached = validateFindCandidate({ candidateRows: candidates, expectedRowId: "line-A" });
  assert.equal(uncached.hasBoundedRowEvidence, false, "an RPC result alone is not sufficient row-data evidence");
  const afterBoundedFetch = validateFindCandidate({ candidateRows: candidates, expectedRowId: "line-A", boundedRowIds: ["line-A"] });
  assert.equal(afterBoundedFetch.hasBoundedRowEvidence, true, "a successful bounded row response completes the identity chain");

  assert.throws(() => validateFindCandidate({ candidateRows: candidates, expectedRowId: "another-line" }), /expected row identity/);
  assert.throws(() => validateFindCandidate({ candidateRows: [{ order_line_id: "line-A", row_index: -1 }], expectedRowId: "line-A" }), /row position/);
});

test("generated production types must contain the expected RPC arguments and API/tracking fields", () => {
  const source = generatedTypes();
  assert.equal(validateGeneratedTypes(source), true);
  assert.throws(() => validateGeneratedTypes(generatedTypes({ missingFunction: "get_dam_order_tracking" })), /get_dam_order_tracking/);
  assert.throws(() => validateGeneratedTypes(generatedTypes({ missingArgument: "p_only_open" })), /p_only_open/);
  assert.throws(() => validateGeneratedTypes(generatedTypes({ missingViewField: "master_data_description" })), /master_data_description/);
});

test("generated-types proof hashes actual output and binds it to exact workflow SHA", () => {
  const source = generatedTypes();
  const proof = createGeneratedTypesProof({ source, applicationCommitSha: workflowSha });
  assert.equal(proof.work_issue, 4111);
  assert.equal(proof.application_commit_sha, workflowSha);
  assert.equal(proof.database_project_id, "qsllyeztdwjgirsysgai");
  assert.equal(proof.result, "passed");
  assert.match(proof.generated_types_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => createGeneratedTypesProof({ source: generatedTypes({ missingViewField: "sample_depth_inches" }), applicationCommitSha: workflowSha }), /sample_depth_inches/);
  assert.throws(() => createGeneratedTypesProof({ source, applicationCommitSha: "short" }), /identity/);
  assert.throws(() => createGeneratedTypesProof({ source, applicationCommitSha: workflowSha, projectId: "wrong" }), /identity/);
});

test("live proof requires the exact successful hosted-preview and production artifacts", () => {
  const evidence = baselineEvidence();
  const fields = validateBaselineEvidence(evidence);
  assert.equal(fields.preview_run_id, BASELINE_EVIDENCE.preview.runId);
  assert.equal(fields.production_artifact_id, BASELINE_EVIDENCE.production.artifactId);
  assert.throws(() => validateBaselineEvidence({ ...evidence, preview: { ...evidence.preview, artifact: { ...evidence.preview.artifact, digest: "sha256:bad" } } }), /artifact/);
  assert.throws(() => validateBaselineEvidence({ ...evidence, production: { ...evidence.production, comment: { id: 1, body: "" } } }), /acceptance record/);
});

test("live proof refuses failed checks and contains no fixture data", () => {
  const checks = [{ label: "Administrator tracking bounded", passed: true }, { label: "Viewer license readonly", passed: true }];
  const proof = createLiveProof({ applicationCommitSha: workflowSha, deployedFrontendSha: frontendSha, observedBuildStamp: frontendSha.slice(0, 8), checks, baselineEvidence: baselineEvidence() });
  assert.equal(proof.work_issue, 4111);
  assert.equal(proof.application_commit_sha, workflowSha);
  assert.equal(proof.result, "passed");
  assert.equal(proof.environment, "production");
  assert.equal(proof.database_project_id, "qsllyeztdwjgirsysgai");
  assert.equal(proof.deployed_frontend_sha, frontendSha);
  assert.equal(proof.observed_frontend_build_stamp, frontendSha.slice(0, 8));
  assert.equal(proof.check_count, 2);
  assert.doesNotMatch(JSON.stringify(proof), /customer|purchase|password|cookie|row_id/i);
  assert.throws(() => createLiveProof({ applicationCommitSha: workflowSha, deployedFrontendSha: frontendSha, observedBuildStamp: frontendSha.slice(0, 8), checks: [...checks, { label: "write blocked", passed: false }], baselineEvidence: baselineEvidence() }), /every real acceptance check/);
  assert.throws(() => createLiveProof({ applicationCommitSha: workflowSha, deployedFrontendSha: frontendSha, observedBuildStamp: frontendSha.slice(0, 8), checks, environment: "preview qsllyeztdwjgirsysgai", baselineEvidence: baselineEvidence() }), /not production/);
  assert.throws(() => createLiveProof({ applicationCommitSha: workflowSha, deployedFrontendSha: frontendSha, checks, baselineEvidence: baselineEvidence() }), /actually observed/);
});
