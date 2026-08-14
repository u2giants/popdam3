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
