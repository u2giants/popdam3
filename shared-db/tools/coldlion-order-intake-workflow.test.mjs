// Offline contract for the intake workflow's writer-step gating (plan §9 C2 + D1).
// A green tool suite cannot catch a YAML condition that quietly runs the
// canonical writer on a dry-run or claim-only dispatch — or one that never
// runs it at all — so this suite pins the workflow text itself, the same way
// tools/coldlion-alert-monitor-workflow.test.mjs pins that workflow's routing.
// It matches the coldlion-order-intake-*.test.mjs glob the workflow itself
// runs before touching anything, so every dispatch re-proves its own gating.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/coldlion-order-intake.yml", import.meta.url),
  "utf8",
);

function step(name, nextName) {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `missing workflow step ${name}`);
  const end = nextName ? workflow.indexOf(`- name: ${nextName}`, start + 1) : workflow.length;
  assert.notEqual(end, -1, `missing workflow step after ${name}: ${nextName}`);
  return workflow.slice(start, end);
}

test("the writer step is skipped on dry-run and claim-only dispatches, and writes only otherwise", () => {
  const writer = step("Write canonical placeholder orders", null);
  assert.match(
    writer,
    /if: github\.event\.inputs\.dry_run != 'true' && github\.event\.inputs\.claim_only != 'true'/,
  );
  assert.match(writer, /order-intake-write\.mjs/);
  assert.match(writer, /ARGS=\(--write\)/);
  // The writer has no --dry-run flag: without --write it rehearses (rolls
  // back), and a workflow dry run must not even reach that path.
  assert.doesNotMatch(writer, /--dry-run/);
});

test("the writer step runs after decode in the same job, with the declared-target env block, limit, and summary", () => {
  const decode = step("Stage, detect, and decode", "Write canonical placeholder orders");
  assert.match(decode, /order-intake\.mjs/);
  const writer = step("Write canonical placeholder orders", null);
  assert.match(writer, /DATABASE_URL: \$\{\{ secrets\.SUPABASE_DB_URL_PRODUCTION \}\}/);
  assert.match(writer, /COLDLION_EXPECTED_PROJECT_REF: qsllyeztdwjgirsysgai/);
  // The writer never reads the API key — it must not receive it (round-7 hardening).
  // Pinned on the WHOLE FILE, not just the writer's step slice: a job-level or
  // defaults.run.env mapping would put the key in the writer's process env while
  // staying outside the slice (2026-10-05 review, L5).
  const mappings = workflow.match(/COLDLION_API_KEY:\s*\$\{\{\s*secrets\.COLDLION_API_KEY\s*\}\}/g) ?? [];
  assert.equal(
    mappings.length,
    2,
    "exactly the two fetch-side steps may map the COLDLION_API_KEY secret; the writer must never see it",
  );
  assert.doesNotMatch(writer, /COLDLION_API_KEY/);
  assert.match(writer, /GITHUB_STEP_SUMMARY/);
  assert.match(writer, /--limit "\$LIMIT"/);
});

test("the workflow is never triggered by a branch and the schedule stays disabled", () => {
  // Comment-only lines are stripped so the deliberately disabled (commented
  // out) schedule does not count as an active trigger.
  const active = workflow
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.match(active, /workflow_dispatch:/);
  assert.doesNotMatch(active, /pull_request/);
  assert.doesNotMatch(active, /push:/);
  assert.doesNotMatch(active, /schedule:/);
});
