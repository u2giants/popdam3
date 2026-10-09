import { createHash } from "node:crypto";
import ts from "typescript";

export const PRODUCTION_ORIGIN = "https://dam.designflow.app";
export const PRODUCTION_PROJECT = "qsllyeztdwjgirsysgai";
export const LIVE_ASSERTION = "Item links and canonical descriptions remain intact; Master Data workflow edits change OrderList outputs without copying rows; tracking and statistics remain bounded and authenticated.";
export const WORK_ISSUE = 4111;
export const READONLY_RPC_ALLOWLIST = new Set([
  "find_dam_order_list_row",
  "get_dam_order_tracking",
  "get_dam_style_tracker_license_status",
  // Existing login/library facets and Master Data candidate lookup: STABLE, read-only.
  "get_filter_counts",
  "get_path_facets",
  "get_dam_material_facets",
  "get_dam_customer_facets",
  "search_style_tracker_link_candidates",
]);
export const BASELINE_EVIDENCE = {
  repository: "popcre/shared-db",
  headSha: "d7f3bd82103072254dad9de854d229eb1b4f3f6b",
  preview: { runId: 37944888633, artifactId: 11622209128, artifactName: "preview-migration-apply-d7f3bd82103072254dad9de854d229eb1b4f3f6b", digest: "sha256:bd4aacceeba9bda991e270943a7fa8c67e342d3361d33815e360ce6370e2201e", commentId: 6083282638, commentPhrase: "Existing canonical administrator/viewer/anonymous hosted-preview acceptance passed in one rollback-only transaction" },
  production: { runId: 37951612832, artifactId: 11625819580, artifactName: "production-migration-apply-d7f3bd82103072254dad9de854d229eb1b4f3f6b", digest: "sha256:cab22aca19a3e2250a77f6aaa35efcb8b847c30b8e7aa26f605719df59459cd7", commentId: 6084050552, commentPhrase: "Production installation and initial auxiliary import verified October 9, 2026" },
};

export const FRONTEND_BUILD_PATHS = [
  "src", "public", "index.html", "package.json", "package-lock.json",
  "vite.config.ts", "tailwind.config.ts", "postcss.config.js", "tsconfig*.json",
  "Dockerfile", "Dockerfile.ci", "nginx.conf", ".github/workflows/publish-frontend.yml",
];

export function validateCommitInputs({ ref, workflowSha, deployedFrontendSha }) {
  const sha = (value) => typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
  if (ref !== "refs/heads/main") throw new Error("workflow must run from main");
  if (!sha(workflowSha) || !sha(deployedFrontendSha)) throw new Error("both source commits must be full 40-character SHAs");
  return { workflowSha: workflowSha.toLowerCase(), deployedFrontendSha: deployedFrontendSha.toLowerCase() };
}

export function validateBuildBinding({ ref, workflowSha, deployedFrontendSha, isAncestor, frontendTreeEqual, observedToken }) {
  const commits = validateCommitInputs({ ref, workflowSha, deployedFrontendSha });
  if (isAncestor !== true) throw new Error("deployed frontend commit is not an ancestor of the proof workflow commit");
  if (frontendTreeEqual !== true) throw new Error("frontend build inputs changed after the deployed commit");
  const buildToken = commits.deployedFrontendSha.slice(0, 7);
  const observed = observedToken === undefined || observedToken === null ? null : String(observedToken).trim().toLowerCase();
  if (observed !== null && (!/^[0-9a-f]{7,40}$/.test(observed) || !commits.deployedFrontendSha.startsWith(observed))) throw new Error("live frontend build stamp is not a valid prefix of the deployed commit");
  return { ...commits, buildToken, observedToken: observed };
}

export function shouldBlockSupabaseRequest({ host, path, method, body }) {
  if (host !== `${PRODUCTION_PROJECT}.supabase.co` || !path.startsWith("/rest/v1/")) return false;
  const verb = String(method ?? "").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(verb)) return false;
  const rpcMatch = path.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
  if (verb === "POST" && rpcMatch && READONLY_RPC_ALLOWLIST.has(rpcMatch[1])) {
    if (rpcMatch[1] === "search_style_tracker_link_candidates") return !Number.isSafeInteger(body?.p_limit) || body.p_limit < 1 || body.p_limit > 500;
    return false;
  }
  return ["POST", "PUT", "PATCH", "DELETE"].includes(verb);
}

export function selectAuthenticatedReadHeaders(source = {}) {
  const headers = {};
  for (const name of ["authorization", "apikey", "accept"]) {
    const value = source[name];
    if (typeof value === "string" && value.length > 0) headers[name] = value;
  }
  headers["accept-profile"] = "api";
  return headers;
}

export function validateFindCandidate({ candidateRows, expectedRowId, boundedRowIds = [] }) {
  if (typeof expectedRowId !== "string" || !expectedRowId || !Array.isArray(candidateRows)) throw new Error("Find candidate identity is invalid");
  const candidate = candidateRows.find((row) => row?.order_line_id === expectedRowId);
  if (!candidate) throw new Error("Find RPC did not return the expected row identity");
  if (!Number.isSafeInteger(candidate.row_index) || candidate.row_index < 0) throw new Error("Find RPC returned an invalid row position");
  return {
    orderLineId: candidate.order_line_id,
    rowIndex: candidate.row_index,
    hasBoundedRowEvidence: boundedRowIds.includes(expectedRowId),
  };
}

function property(type, name) {
  if (!type || !ts.isTypeLiteralNode(type)) return undefined;
  return type.members.find((member) => ts.isPropertySignature(member) && memberName(member.name) === name);
}

function memberName(name) {
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function objectProperty(type, name, label) {
  const found = property(type, name);
  if (!found) throw new Error(`generated production types are missing ${label}`);
  return found;
}

function typeOf(member) {
  return member?.type;
}

function requireProperties(type, names, label) {
  for (const name of names) objectProperty(type, name, `${label}.${name}`);
}

export function validateGeneratedTypes(source) {
  if (typeof source !== "string" || source.length < 1000) throw new Error("generated types output is empty or truncated");
  const file = ts.createSourceFile("database.types.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const alias = file.statements.find((statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === "Database");
  if (!alias) throw new Error("generated types do not declare Database");
  const root = alias.type;
  const schema = (name) => typeOf(objectProperty(root, name, `Database.${name}`));
  const functions = (name) => typeOf(objectProperty(schema(name), "Functions", `Database.${name}.Functions`));
  const views = (name) => typeOf(objectProperty(schema(name), "Views", `Database.${name}.Views`));

  const publicFunctions = functions("public");
  const expectedFunctions = {
    get_dam_order_tracking: ["p_offset", "p_limit", "p_search", "p_only_open"],
    update_dam_order_tracking: ["p_order_id", "p_patch"],
    upsert_dam_order_sample_depth: ["p_sku", "p_customer", "p_depth_inches"],
    upsert_dam_order_customer_settings: ["p_customer", "p_suffix"],
    get_dam_style_tracker_license_status: ["p_row_ids"],
  };
  for (const [name, args] of Object.entries(expectedFunctions)) {
    const fnType = typeOf(objectProperty(publicFunctions, name, `Database.public.Functions.${name}`));
    const argsType = typeOf(objectProperty(fnType, "Args", `Database.public.Functions.${name}.Args`));
    requireProperties(argsType, args, `Database.public.Functions.${name}.Args`);
  }

  const apiViews = views("api");
  const expectedApiViews = {
    dam_order_list: ["order_line_id", "item_id", "item_description", "master_data_description", "product_workflow_source", "sample_depth_inches"],
    dam_order_sample_depth: ["sku_normalized", "customer_normalized", "depth_inches", "depth_raw", "source_row_number"],
    dam_order_customer_settings: ["customer_normalized", "suffix"],
    dam_order_vendor_statistics: ["factory_id", "vendor_name", "order_count", "closed_orders", "open_orders", "last_sent_po_date", "activity_status"],
  };
  for (const [name, columns] of Object.entries(expectedApiViews)) {
    const viewType = typeOf(objectProperty(apiViews, name, `Database.api.Views.${name}`));
    const rowType = typeOf(objectProperty(viewType, "Row", `Database.api.Views.${name}.Row`));
    requireProperties(rowType, columns, `Database.api.Views.${name}.Row`);
  }
  const tracking = views("dam");
  const trackingType = typeOf(objectProperty(tracking, "dam_order_tracking", "Database.dam.Views.dam_order_tracking"));
  const trackingRow = typeOf(objectProperty(trackingType, "Row", "Database.dam.Views.dam_order_tracking.Row"));
  requireProperties(trackingRow, ["order_id", "production_order_number", "components", "mbl", "cbm", "comment", "payment_note"], "Database.dam.Views.dam_order_tracking.Row");

  return true;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createGeneratedTypesProof({ source, workIssue = WORK_ISSUE, applicationCommitSha, projectId = PRODUCTION_PROJECT }) {
  validateGeneratedTypes(source);
  if (workIssue !== WORK_ISSUE || !/^[0-9a-f]{40}$/i.test(applicationCommitSha ?? "") || projectId !== PRODUCTION_PROJECT) throw new Error("generated-types proof identity is invalid");
  return {
    schema_version: 1,
    work_issue: WORK_ISSUE,
    application_commit_sha: applicationCommitSha.toLowerCase(),
    database_project_id: PRODUCTION_PROJECT,
    result: "passed",
    generated_types_sha256: `sha256:${sha256(source)}`,
  };
}

export function createLiveProof({ workIssue = WORK_ISSUE, applicationCommitSha, deployedFrontendSha, observedBuildStamp, checks, environment = "production", baselineEvidence }) {
  if (workIssue !== WORK_ISSUE || !/^[0-9a-f]{40}$/i.test(applicationCommitSha ?? "")) throw new Error("live-proof identity is invalid");
  if (!Array.isArray(checks) || checks.length < 1 || checks.some((check) => check?.passed !== true)) throw new Error("live proof requires every real acceptance check to pass");
  if (environment !== "production") throw new Error("live proof target is not production");
  if (!observedBuildStamp) throw new Error("live proof requires the actually observed frontend build stamp");
  const stampBinding = validateBuildBinding({ ref: "refs/heads/main", workflowSha: applicationCommitSha, deployedFrontendSha, isAncestor: true, frontendTreeEqual: true, observedToken: observedBuildStamp });
  const basis = validateBaselineEvidence(baselineEvidence);
  return {
    schema_version: 1,
    work_issue: WORK_ISSUE,
    application_commit_sha: applicationCommitSha.toLowerCase(),
    deployed_frontend_sha: stampBinding.deployedFrontendSha,
    observed_frontend_build_stamp: stampBinding.observedToken,
    live_assertion: LIVE_ASSERTION,
    environment,
    database_project_id: PRODUCTION_PROJECT,
    result: "passed",
    observed_at: new Date().toISOString(),
    check_count: checks.length,
    checks_sha256: `sha256:${sha256(JSON.stringify(checks.map(({ label }) => label)))}`,
    acceptance_basis: basis,
  };
}

export function validateBaselineEvidence(value) {
  if (!value || value.repository !== BASELINE_EVIDENCE.repository || value.head_sha !== BASELINE_EVIDENCE.headSha) throw new Error("existing backend evidence identity does not match the reviewed production integration");
  for (const kind of ["preview", "production"]) {
    const expected = BASELINE_EVIDENCE[kind];
    const actual = value[kind];
    if (!actual || actual.run?.id !== expected.runId || actual.run?.head_sha !== BASELINE_EVIDENCE.headSha || actual.run?.head_branch !== "main" || actual.run?.status !== "completed" || actual.run?.conclusion !== "success" || actual.run?.event !== "workflow_dispatch") throw new Error(`${kind} backend verification run is not the exact successful immutable run`);
    if (actual.artifact?.id !== expected.artifactId || actual.artifact?.name !== expected.artifactName || actual.artifact?.expired !== false || actual.artifact?.digest !== expected.digest || actual.artifact?.workflow_run?.id !== expected.runId || actual.artifact?.workflow_run?.head_sha !== BASELINE_EVIDENCE.headSha) throw new Error(`${kind} backend artifact does not match the exact retained artifact identity and digest`);
    if (actual.comment?.id !== expected.commentId || typeof actual.comment?.body !== "string" || !actual.comment.body.includes(expected.commentPhrase)) throw new Error(`${kind} backend acceptance record is missing from the durable issue comment`);
  }
  return {
    shared_db_head_sha: BASELINE_EVIDENCE.headSha,
    preview_run_id: BASELINE_EVIDENCE.preview.runId,
    preview_artifact_id: BASELINE_EVIDENCE.preview.artifactId,
    preview_artifact_digest: BASELINE_EVIDENCE.preview.digest,
    preview_acceptance_comment_id: BASELINE_EVIDENCE.preview.commentId,
    production_run_id: BASELINE_EVIDENCE.production.runId,
    production_artifact_id: BASELINE_EVIDENCE.production.artifactId,
    production_artifact_digest: BASELINE_EVIDENCE.production.digest,
    production_acceptance_comment_id: BASELINE_EVIDENCE.production.commentId,
  };
}
