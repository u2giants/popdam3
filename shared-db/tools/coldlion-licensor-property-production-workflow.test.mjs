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

// READ-ONLY GUARDS ARE EXEMPT FROM THE WRITE AUTHORIZATION, AND ONLY THESE. The
// four-part authorization exists to stop an unauthorised WRITE; a script that cannot
// write has nothing to authorise.
//
// MIRRORED DELIBERATELY from tools/coldlion-production-lane-readiness.mjs rather than
// imported. This is a CONTRACT test: if it imported the very helper it is meant to
// police, a bug in that helper would excuse itself here. The duplication is the point.
const READ_ONLY_GUARD_SCRIPTS = ["check-supabase-link-state.mjs"];

/**
 * One entry per invocation, keyed on the SCRIPT NAME.
 *
 * Do NOT simplify this to the script name followed by a greedy "rest of line"
 * (`[^\n]` star, global) plus a substring test
 * for the guard's name. That combination was a real bypass (review, 2026-08-07):
 * `[^\n]*` is greedy to end of line and matchAll does not overlap, so two invocations
 * chained with `&&` on ONE line collapsed into a single match whose text contained the
 * guard's name -- and the write runner beside it inherited the read-only exemption.
 * The lookahead stops each invocation's arguments at the next `node tools/`.
 */
function parseCalls(text) {
  const CALL = /node tools\/([a-z0-9-]+\.mjs)((?:(?!node tools\/)[^\n])*)/g;
  return [...String(text ?? "").matchAll(CALL)].map((m) => ({
    script: m[1],
    raw: `node tools/${m[1]}${m[2]}`.replace(/\s+/g, " ").trim(),
  }));
}

const isReadOnlyGuard = (c) => READ_ONLY_GUARD_SCRIPTS.includes(c.script);

test("all production runner calls carry the four authorization parts", () => {
  // Part 4 (the env variable) is set once on the production job.
  assert.match(workflow, /COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED: "true"/);

  const allCalls = parseCalls(folded);

  const runnerCalls = allCalls.filter((c) => !isReadOnlyGuard(c));
  assert.ok(runnerCalls.length >= 6, `expected the five lanes plus the alert dispatcher, got ${runnerCalls.length}`);
  for (const call of runnerCalls) {
    assert.match(call.raw, /--production\b/, `missing --production in: ${call.raw}`);
    assert.match(call.raw, /--production-authorized\b/, `missing --production-authorized in: ${call.raw}`);
    assert.match(call.raw, /--project-ref "\$PRODUCTION_PROJECT_REF"/, `missing exact --project-ref in: ${call.raw}`);
  }

  // THE EXEMPTION MUST NOT BECOME A HOLE. An exempt script may never be handed --apply,
  // or "call it a guard, then pass --apply" would route a write around the authorization.
  for (const call of allCalls.filter(isReadOnlyGuard)) {
    assert.doesNotMatch(call.raw, /--apply\b/, `a read-only guard must never be given --apply: ${call.raw}`);
  }
});

test("BYPASS REGRESSION: a write runner sharing a LINE with the guard still needs authorization", () => {
  // The bug this pins (found in review 2026-08-07, never shipped): the old matcher was
  // `/node tools\/[a-z0-9-]+\.mjs[^\n]*/g` plus a SUBSTRING test for the guard's name.
  // `[^\n]*` runs greedily to end of line and matchAll does not overlap, so two
  // invocations on one line became ONE match whose text contained the guard's name --
  // and the WRITE RUNNER inherited the read-only exemption. One `&&` defeated the gate.
  const chained =
    '          node tools/check-supabase-link-state.mjs --expect-ref="$PRODUCTION_PROJECT_REF" && node tools/sync-coldlion-licensors-properties.mjs --apply --linked\n';

  const parsed = parseCalls(chained);
  assert.equal(parsed.length, 2, "two invocations on one line must parse as TWO calls");
  assert.deepEqual(
    parsed.map((c) => c.script),
    ["check-supabase-link-state.mjs", "sync-coldlion-licensors-properties.mjs"],
  );

  // The guard is exempt; the writer beside it is NOT, and is caught for missing all
  // three flags rather than silently inheriting the exemption.
  const writers = parsed.filter((c) => !isReadOnlyGuard(c));
  assert.equal(writers.length, 1);
  assert.equal(writers[0].script, "sync-coldlion-licensors-properties.mjs");
  assert.doesNotMatch(writers[0].raw, /--production-authorized\b/);
  assert.doesNotMatch(writers[0].raw, /--project-ref "\$PRODUCTION_PROJECT_REF"/);
  // The RUNTIME checker is held to the same rule in
  // tools/coldlion-production-lane-readiness.test.mjs, so this cannot pass here while
  // the shipped checker still has the hole.
});

test("the exemption is keyed on the INVOKED SCRIPT, never on surrounding text", () => {
  // A write runner must not become exempt merely because the guard's name appears
  // nearby -- in a comment, an echo, or an adjacent argument.
  const decoy =
    '          echo "see node tools/check-supabase-link-state.mjs" && node tools/promote-coldlion-source-owned.mjs --apply\n';
  const writers = parseCalls(decoy).filter((c) => !isReadOnlyGuard(c));
  assert.equal(writers.length, 1);
  assert.equal(writers[0].script, "promote-coldlion-source-owned.mjs");
});

test("the link-state guard runs in the production job, and names the production ref", () => {
  // Added 2026-08-07. The workflow's own gate reads ONE of the three files in
  // supabase/.temp/ that can name a project. This step asserts all three agree.
  // If this step is ever dropped, the production lane silently loses that check.
  assert.match(
    folded,
    /node tools\/check-supabase-link-state\.mjs --expect-ref="\$PRODUCTION_PROJECT_REF"/,
    "the production job must prove ALL Supabase link files agree on production",
  );
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

// ---------------------------------------------------------------------------------
// #548 ARMED BUT READ-ONLY. Before this lane existed, the only way to run the
// read-only `readiness` check against production was to set the feed's enable
// variable — which simultaneously armed the 06:00 snapshot, the 06:30 promotion
// (a WRITE), the 07:00 comparison and the hourly health lane. These tests pin the
// separation: the preflight lane must prove what the feed WOULD do while remaining
// structurally incapable of doing it.
// ---------------------------------------------------------------------------------

const PREFLIGHT_VARIABLE = "COLDLION_LICENSOR_PROPERTY_PRODUCTION_ARMED_READONLY";
const preflightJob = workflow.slice(workflow.indexOf("\n  preflight:"));
const preflightFolded = preflightJob.replace(/\\\r?\n\s*/g, " ");

test("#548: the preflight lane exists, is dispatch-only, and is on its OWN variable", () => {
  assert.ok(preflightJob.length > 0, "the preflight job must exist");
  assert.match(preflightJob, new RegExp(`vars\\.${PREFLIGHT_VARIABLE}\\s*\\}\\}"\\s*=\\s*"true"`));
  // Dispatch only. If it ever appeared in the cron list it would become a background
  // job against production, which is exactly what it exists to avoid.
  assert.match(preflightJob, /if: github\.event_name == 'workflow_dispatch' && inputs\.job == 'preflight'/);
  const crons = [...workflow.matchAll(/- cron: "([^"]+)" # (\w+)/g)].map((m) => m[2]);
  assert.ok(!crons.includes("preflight"), "preflight must never be scheduled");
  // And it must be an offered dispatch choice, or an operator cannot reach it.
  assert.match(workflow, /^\s+- preflight$/m);
});

test("#548: arming the preflight does NOT arm the feed, and vice versa", () => {
  // The preflight gate must NOT read the feed's enable variable as its permission.
  const armStep = preflightJob.slice(
    preflightJob.indexOf("Arm gate"),
    preflightJob.indexOf("actions/setup-node"),
  );
  assert.match(armStep, new RegExp(PREFLIGHT_VARIABLE));
  assert.doesNotMatch(
    armStep,
    /vars\.COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED/,
    "the preflight must not be gated on the feed's enable variable — that is the whole bug",
  );
  // And it must say so out loud, so nobody mistakes arming it for switching the feed on.
  assert.match(preflightJob, /does NOT enable the production feed/);
});

test("#548: the preflight can never enter the job that holds the production credential", () => {
  assert.match(workflow, /needs\.gate\.outputs\.job != 'preflight'/);
  // The preflight job itself holds no production environment and no DB password.
  assert.doesNotMatch(preflightJob, /^\s+environment: production$/m);
  assert.doesNotMatch(preflightJob, /secrets\.SUPABASE_DB_PASSWORD_PRODUCTION/);
  // It never links a Supabase project, so no runner in it has a session to write through.
  assert.doesNotMatch(preflightJob, /supabase link/);
  // Runtime belt-and-braces on top of the static facts above.
  assert.match(preflightJob, /must hold NO production database password/);
  assert.match(preflightJob, /must not be linked to any Supabase project/);
});

test("#548: NO preflight runner may be given --apply or --linked", () => {
  const calls = parseCalls(preflightFolded).filter((c) => !isReadOnlyGuard(c));
  assert.ok(calls.length >= 6, `expected all five lanes plus the alert dispatcher, got ${calls.length}`);
  for (const call of calls) {
    assert.doesNotMatch(call.raw, /--apply\b/, `preflight must never apply: ${call.raw}`);
    assert.doesNotMatch(call.raw, /--linked\b/, `preflight must never link: ${call.raw}`);
    // It is ARMED: it still resolves the real production target, so the plan it prints
    // is the production plan and not a preview one.
    assert.match(call.raw, /--production\b/, `preflight must resolve production: ${call.raw}`);
    assert.match(call.raw, /--project-ref "\$PRODUCTION_PROJECT_REF"/, `preflight must name production: ${call.raw}`);
  }
});

test("#548: the live ERP preflight receives its API key without gaining a database write path", () => {
  const snapshotStep = preflightJob.slice(
    preflightJob.indexOf("name: coldlion"),
    preflightJob.indexOf("name: promote"),
  );
  assert.match(snapshotStep, /COLDLION_API_KEY:\s*\$\{\{ secrets\.COLDLION_API_KEY \}\}/);
  assert.doesNotMatch(snapshotStep, /SUPABASE_DB_PASSWORD/);
  assert.doesNotMatch(snapshotStep, /--apply\b|--linked\b|supabase link/);
  assert.match(preflightJob, /DOES contact\s+#?\s*the live ColdLion ERP|DOES contact[\s\S]*live ColdLion ERP/);
  assert.doesNotMatch(preflightJob, /Nothing connects\./);
});

test("#548: the preflight covers EVERY lane the enable variable would arm", () => {
  // A preflight that silently skipped a lane would be worse than none: it would give
  // false confidence about the exact lane nobody checked.
  const scripts = new Set(parseCalls(preflightFolded).map((c) => c.script));
  for (const runner of [
    "sync-coldlion-licensors-properties.mjs",
    "promote-coldlion-source-owned.mjs",
    "compare-coldlion-designflow-daily.mjs",
    "check-coldlion-designflow-sync-health.mjs",
    "evaluate-coldlion-licensor-property-cutover-readiness.mjs",
    "dispatch-coldlion-taxonomy-alerts.mjs",
  ]) {
    assert.ok(scripts.has(runner), `the preflight does not cover ${runner}`);
  }
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
