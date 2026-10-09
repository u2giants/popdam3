import test from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE_EVIDENCE,
  createGeneratedTypesProof,
  createLiveProof,
  validateBaselineEvidence,
  validateBuildBinding,
  validateGeneratedTypes,
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
  }), { workflowSha, deployedFrontendSha: frontendSha, buildToken: frontendSha.slice(0, 7) });
  assert.throws(() => validateBuildBinding({ ref: "refs/heads/main", workflowSha, deployedFrontendSha: frontendSha, isAncestor: true, frontendTreeEqual: true, observedToken: "deadbee" }), /stamp/);
  assert.throws(() => validateBuildBinding({ ref: "refs/heads/feature", workflowSha, deployedFrontendSha: frontendSha, isAncestor: true, frontendTreeEqual: true, observedToken: frontendSha.slice(0, 7) }), /main/);
  assert.throws(() => validateBuildBinding({ ref: "refs/heads/main", workflowSha, deployedFrontendSha: frontendSha, isAncestor: true, frontendTreeEqual: false, observedToken: frontendSha.slice(0, 7) }), /inputs changed/);
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
  const proof = createLiveProof({ applicationCommitSha: workflowSha, checks, baselineEvidence: baselineEvidence() });
  assert.equal(proof.work_issue, 4111);
  assert.equal(proof.application_commit_sha, workflowSha);
  assert.equal(proof.result, "passed");
  assert.equal(proof.environment, "production");
  assert.equal(proof.database_project_id, "qsllyeztdwjgirsysgai");
  assert.equal(proof.check_count, 2);
  assert.doesNotMatch(JSON.stringify(proof), /customer|purchase|password|cookie|row_id/i);
  assert.throws(() => createLiveProof({ applicationCommitSha: workflowSha, checks: [...checks, { label: "write blocked", passed: false }], baselineEvidence: baselineEvidence() }), /every real acceptance check/);
  assert.throws(() => createLiveProof({ applicationCommitSha: workflowSha, checks, environment: "preview qsllyeztdwjgirsysgai", baselineEvidence: baselineEvidence() }), /not production/);
});
