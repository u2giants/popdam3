// Static contract tests for the recurring PRODUCTION workflow (Step 7A item 1 and its
// "Required tests" list). These are deliberately static: the workflow must be provably
// safe by reading it, because the only way to test it dynamically is to run it against
// production — which is exactly what must never happen before Step 8.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PRODUCTION_REF = "qsllyeztdwjgirsysgai";
const PREVIEW_REF = "rjyboqwcdzcocqgmsyel";

const path = fileURLToPath(
  new URL("../.github/workflows/coldlion-licensor-property-production.yml", import.meta.url),
);
const workflow = readFileSync(path, "utf8");
/** The workflow with shell line-continuations folded, so a multi-line runner
 *  invocation can be asserted as one command string. */
const folded = workflow.replace(/\\\r?\n\s*/g, " ");
const previewWorkflow = readFileSync(
  fileURLToPath(new URL("../.github/workflows/coldlion-licensor-property-phase6-parallel.yml", import.meta.url)),
  "utf8",
);

test("the production workflow targets ONLY production and hard-refuses preview", () => {
  assert.match(workflow, new RegExp(`PRODUCTION_PROJECT_REF: ${PRODUCTION_REF}`));
  // It must refuse a link that resolved preview, and refuse anything that is not production.
  assert.match(workflow, /Refusing: the production workflow linked PREVIEW/);
  assert.match(workflow, /is not production/);
  assert.match(workflow, /Hard-coded production ref mismatch/);
  assert.match(workflow, /PRODUCTION and PREVIEW refs must differ/);
});

test("an arbitrary ref cannot be injected: the ref is hard-coded, never an input", () => {
  // No workflow input or variable may supply the project ref.
  assert.doesNotMatch(workflow, /project-ref\s+"?\$\{\{\s*(inputs|vars)\./);
  assert.doesNotMatch(workflow, /PRODUCTION_PROJECT_REF:\s*\$\{\{/);
  // The dispatch path additionally makes a human spell the ref out.
  assert.match(workflow, /confirm_production must be exactly/);
});

test("it is a separate workflow, never a relaxed copy of the preview guard", () => {
  assert.notEqual(workflow, previewWorkflow);
  // The preview workflow must stay preview-only and must NOT gain a production lane.
  assert.doesNotMatch(previewWorkflow, /--production-authorized/);
  // The production workflow must not contain the preview lane's enable variable.
  assert.doesNotMatch(workflow, /PHASE6_SCHEDULE_ENABLED/);
  assert.match(workflow, /THIS IS NOT A RELAXED COPY OF THE PREVIEW WORKFLOW/);
});

test("it uses the production GitHub environment", () => {
  assert.match(workflow, /^\s+environment: production$/m);
});

test("a missing enable variable skips LOUDLY and never falls back to preview or dry-run", () => {
  assert.match(workflow, /vars\.COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED\s*\}\}"\s*=\s*"true"/);
  assert.match(workflow, /::warning title=ColdLion production feed is DISABLED::/);
  assert.match(workflow, /NO preview fallback/);
  assert.match(workflow, /NO dry-run fallback/);
  // The production job cannot start at all unless the gate says enabled.
  assert.match(workflow, /if: needs\.gate\.outputs\.enabled == 'true'/);
  // And no write step has a dry-run branch.
  assert.doesNotMatch(workflow, /Dry-run complete/);
  assert.doesNotMatch(workflow, /apply == 'false'/);
});

test("every required secret is referenced BY NAME ONLY and a missing one fails loudly", () => {
  for (const name of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD_PRODUCTION", "COLDLION_API_KEY"]) {
    assert.match(workflow, new RegExp(`secrets\\.${name}`), `missing secret reference ${name}`);
    assert.match(workflow, new RegExp(`\\b${name}\\b`));
  }
  assert.match(workflow, /Missing production secret/);
  assert.match(workflow, /Refusing the production lane; missing secret\(s\)/);
  // No secret VALUE may be echoed. Nothing may print a secret env var directly.
  assert.doesNotMatch(workflow, /echo\s+"?\$\{?SUPABASE_DB_PASSWORD/);
  assert.doesNotMatch(workflow, /echo\s+"?\$\{?SUPABASE_ACCESS_TOKEN/);
  assert.doesNotMatch(workflow, /echo\s+"?\$\{?COLDLION_API_KEY/);
});

test("one non-cancelling concurrency group prevents overlapping write cycles", () => {
  assert.match(workflow, /concurrency:\s*\n\s+group: coldlion-licensor-property-production\s*\n\s+cancel-in-progress: false/);
  // Exactly one concurrency block for the whole workflow.
  assert.equal((workflow.match(/^concurrency:/gm) ?? []).length, 1);
  assert.equal((workflow.match(/cancel-in-progress:/g) ?? []).length, 1);
});

test("all production runner calls carry the four authorization parts", () => {
  // Part 4 (the env variable) is set once on the production job.
  assert.match(workflow, /COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED: "true"/);

  const runnerCalls = [...folded.matchAll(/node tools\/[a-z0-9-]+\.mjs[^\n]*/g)].map((m) =>
    m[0].replace(/\s+/g, " ").trim(),
  );
  assert.ok(runnerCalls.length >= 6, `expected the five lanes plus the alert dispatcher, got ${runnerCalls.length}`);
  for (const call of runnerCalls) {
    assert.match(call, /--production\b/, `missing --production in: ${call}`);
    assert.match(call, /--production-authorized\b/, `missing --production-authorized in: ${call}`);
    assert.match(call, /--project-ref "\$PRODUCTION_PROJECT_REF"/, `missing exact --project-ref in: ${call}`);
  }
});

test("both write lanes run --apply --linked; there is no silent read-only variant", () => {
  for (const runner of [
    "sync-coldlion-licensors-properties.mjs",
    "promote-coldlion-source-owned.mjs",
  ]) {
    const call = folded.match(new RegExp(`node tools/${runner.replace(/\./g, "\\.")}[^\n]*`));
    assert.ok(call, `missing runner call for ${runner}`);
    assert.match(call[0].replace(/\s+/g, " "), /--apply --linked/);
  }
});

test("failure delivers a GitHub issue from the DETECTING run naming Albert Hazan", () => {
  assert.match(workflow, /if: failure\(\)/);
  assert.match(workflow, /gh issue create/);
  assert.match(workflow, /Delivered immediately by the detecting run/);
  assert.match(workflow, /COLDLION_HUMAN_RESPONSE_OWNER: Albert Hazan/);
  assert.match(workflow, /issues: write/);
});

test("alert delivery failure keeps the workflow RED", () => {
  // The alert step runs only on failure(), so the run is already failing; and the step
  // itself is not `continue-on-error`, so a delivery failure cannot turn the run green.
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.match(workflow, /::error::ColdLion PRODUCTION alert delivered/);
});

test("the scheduled sequence is snapshot -> promotion -> comparison, plus hourly health", () => {
  const crons = [...workflow.matchAll(/- cron: "([^"]+)" # (\w+)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(crons, [
    ["0 6 * * *", "coldlion"],
    ["30 6 * * *", "promote"],
    ["0 7 * * *", "compare"],
    ["45 * * * *", "health"],
  ]);
  // The promotion runs after the snapshot on the same day, and health is hourly.
  assert.ok(crons[1][0].startsWith("30 6"));
  assert.match(crons[3][0], /^45 \* \* \* \*$/);
});

test("offline contract tests must pass in the gate before any production write", () => {
  assert.match(workflow, /tools\/coldlion-production-schedule-map\.test\.mjs/);
  assert.match(workflow, /tools\/coldlion-recurring-promotion\.test\.mjs/);
  assert.match(workflow, /tools\/coldlion-production-authorization\.test\.mjs/);
  assert.match(workflow, /tools\/coldlion-licensor-property-production-workflow\.test\.mjs/);
  // The gate job holds no production environment and no production DB password.
  const gateBlock = workflow.slice(workflow.indexOf("  gate:"), workflow.indexOf("  production:"));
  assert.doesNotMatch(gateBlock, /environment: production/);
  assert.doesNotMatch(gateBlock, /SUPABASE_DB_PASSWORD_PRODUCTION/);
});

test("the preview ref appears only in refusals, never as a target", () => {
  const lines = workflow.split("\n").filter((l) => l.includes(PREVIEW_REF));
  for (const line of lines) {
    assert.ok(
      /PREVIEW_PROJECT_REF: rjyboqwcdzcocqgmsyel|Refus|must differ|#/.test(line),
      `preview ref used outside a refusal/comment: ${line}`,
    );
  }
});
