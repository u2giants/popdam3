// Offline contract for the alert monitor's exit-code routing. A tool unit test cannot
// catch a YAML condition that quietly sends a genuine alert down the suppress branch.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/coldlion-licensor-property-alert-monitor.yml", import.meta.url),
  "utf8",
);

function step(name, nextName) {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `missing workflow step ${name}`);
  const end = nextName ? workflow.indexOf(`- name: ${nextName}`, start + 1) : workflow.length;
  assert.notEqual(end, -1, `missing workflow step after ${name}: ${nextName}`);
  return workflow.slice(start, end);
}

test("new and unverified alerts are delivered, while already-reported alerts are not", () => {
  const deliver = step(
    "Deliver — open a GitHub issue naming the human response owner",
    "Fail loudly when an alert is outstanding",
  );
  assert.match(deliver, /steps\.collect\.outputs\.code == '1'/);
  assert.match(deliver, /steps\.collect\.outputs\.code == '4'/);
  assert.doesNotMatch(deliver, /steps\.collect\.outputs\.code == '3'/);
  assert.match(deliver, /gh issue create/);
});

test("every outstanding-alert outcome finishes red", () => {
  const finish = step("Fail loudly when an alert is outstanding", null);
  for (const code of ["1", "3", "4"]) {
    assert.match(finish, new RegExp(`steps\\.collect\\.outputs\\.code == '${code}'`));
  }
  assert.match(finish, /exit 1/);
});

test("the preview monitor has no production database credential or authorization", () => {
  assert.doesNotMatch(workflow, /SUPABASE_DB_PASSWORD_PRODUCTION|--production-authorized/);
  assert.match(workflow, /Production [^\r\n]* is hard-refused/);
});
