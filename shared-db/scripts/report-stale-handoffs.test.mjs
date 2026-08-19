/**
 * Tests for the weekly stale-handoff report (issue #658). Offline: issue states
 * are injected.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { classify, renderReport } from "./report-stale-handoffs.mjs";

const file = (path, issue, owner = "codex/x") => ({
  path,
  text: `---\nissue: ${issue}\nstatus: OPEN\nowner: ${owner}\n---\n\n# h\n`,
});

test("a file pointing at a closed issue is reported stale, with its owner", () => {
  const { stale } = classify([file("HANDOFF.d/a.md", 727, "claude/orderlist")], () => "CLOSED");
  assert.deepEqual(stale, [{ path: "HANDOFF.d/a.md", issue: 727, owner: "claude/orderlist" }]);
});

test("a file pointing at an open issue is not reported", () => {
  const { stale } = classify([file("HANDOFF.d/a.md", 925)], () => "OPEN");
  assert.deepEqual(stale, []);
});

test("a file with no contract block is listed separately, not called stale", () => {
  const { stale, unlabelled } = classify([{ path: "HANDOFF.d/old.md", text: "# no frontmatter\n" }], () => "CLOSED");
  assert.deepEqual(stale, []);
  assert.deepEqual(unlabelled, ["HANDOFF.d/old.md"]);
});

test("the report states plainly that the file COUNT is not a problem", () => {
  // Guards against someone reintroducing a count cap through the back door by
  // reading this report as "30 files is bad".
  const body = renderReport({ stale: [], unlabelled: [], total: 30, generatedAt: "t" });
  assert.match(body, /There is no limit on that number/);
  assert.match(body, /Nothing stale/);
});

test("a stale row names the file, the closed issue and the owner", () => {
  const body = renderReport({
    stale: [{ path: "HANDOFF.d/a.md", issue: 727, owner: "claude/orderlist" }],
    unlabelled: [],
    total: 4,
    generatedAt: "t",
  });
  assert.match(body, /HANDOFF\.d\/a\.md/);
  assert.match(body, /#727 \(closed\)/);
  assert.match(body, /claude\/orderlist/);
});

test("an unknown owner renders without crashing", () => {
  const body = renderReport({
    stale: [{ path: "HANDOFF.d/a.md", issue: 1, owner: undefined }],
    unlabelled: [],
    total: 1,
    generatedAt: "t",
  });
  assert.match(body, /unknown/);
});

// --------------------------------------------------------------------------
// Issue #1118 / #1186-era defect: a closed issue does NOT make a file retirable.
//
// On 2026-08-19 this report nominated the orchestrator closeout file for retirement
// because its index issue #1205 was closed — while seven OPEN issues cited that exact
// file for their full context. Deleting it would have stranded all seven.
// --------------------------------------------------------------------------

test("a file whose issue is closed but which open issues still cite is NOT called stale", () => {
  const { stale, cited } = classify(
    [file("HANDOFF.d/closeout.md", 1205, "claude/orchestrator")],
    () => "CLOSED",
    () => [1199, 1204],
  );
  assert.deepEqual(stale, [], "a cited file must never be nominated for retirement");
  assert.deepEqual(cited, [
    { path: "HANDOFF.d/closeout.md", issue: 1205, owner: "claude/orchestrator", citedBy: [1199, 1204] },
  ]);
});

test("a file's OWN issue citing it does not count as a citation", () => {
  // The frontmatter issue always mentions its own file; that must not make every
  // finished file permanently unretirable.
  const { stale, cited } = classify(
    [file("HANDOFF.d/a.md", 727)],
    () => "CLOSED",
    () => [727],
  );
  assert.equal(cited.length, 0);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].issue, 727);
});

test("with no citations, a closed-issue file is still reported stale as before", () => {
  const { stale, cited } = classify([file("HANDOFF.d/a.md", 727)], () => "CLOSED", () => []);
  assert.equal(cited.length, 0);
  assert.equal(stale.length, 1);
});

test("classify defaults to 'nothing cites it', preserving the old behaviour", () => {
  // The default must be the LOUD one. Defaulting to "assume cited" would silence the
  // whole report the day someone forgot to pass the lookup.
  const { stale, cited } = classify([file("HANDOFF.d/a.md", 727)], () => "CLOSED");
  assert.equal(stale.length, 1);
  assert.equal(cited.length, 0);
});

test("the cited section tells the reader NOT to retire, and names the issues", () => {
  const body = renderReport({
    stale: [],
    cited: [{ path: "HANDOFF.d/closeout.md", issue: 1205, owner: "o", citedBy: [1199, 1204] }],
    unlabelled: [],
    total: 6,
    generatedAt: "t",
  });
  assert.match(body, /Do NOT retire these/);
  assert.match(body, /HANDOFF\.d\/closeout\.md/);
  assert.match(body, /#1205 \(closed\)/);
  assert.match(body, /#1199, #1204/);
  assert.doesNotMatch(body, /Nothing stale/, "a cited file must not read as an all-clear");
});

test("the stale heading says explicitly that nothing open cites those files", () => {
  const body = renderReport({
    stale: [{ path: "HANDOFF.d/a.md", issue: 727, owner: "o" }],
    cited: [],
    unlabelled: [],
    total: 1,
    generatedAt: "t",
  });
  assert.match(body, /nothing open still cites/);
});
