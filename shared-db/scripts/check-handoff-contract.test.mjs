/**
 * Negative-path tests for the handoff contract guard (issue #658).
 *
 * Backlog B7 is standing policy in this repo: an existence check is worthless
 * against this defect class, and a guard whose own tests never run is a guard
 * nobody has proven fires. Every test below drives a FAILURE the guard must
 * catch, plus the passes that must not become false alarms.
 *
 * NO DATABASE, NO NETWORK. Issue states are injected.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluate,
  parseClosingIssues,
  parseFrontMatter,
  validateHandoff,
  VALID_STATUS,
} from "./check-handoff-contract.mjs";

const good = (issue = 925, status = "OPEN") =>
  `---\nissue: ${issue}\nstatus: ${status}\nowner: codex/wb-scrape-925\n---\n\n# A handoff\n`;

const states = (pairs) => new Map(Object.entries(pairs).map(([k, v]) => [Number(k), v]));

const base = { changed: [], existing: [], issueStates: new Map(), closingIssues: [] };

// --- frontmatter shape -----------------------------------------------------

test("a well-formed block parses", () => {
  const parsed = parseFrontMatter(good());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.issue, "925");
  assert.equal(parsed.data.owner, "codex/wb-scrape-925");
});

test("a file with no frontmatter is rejected, and the message shows the block to add", () => {
  const problems = validateHandoff("HANDOFF.d/x.md", "# Just a heading\n");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /issue: 925/);
  assert.match(problems[0], /status: OPEN/);
});

test("an unterminated frontmatter block is rejected", () => {
  const problems = validateHandoff("HANDOFF.d/x.md", "---\nissue: 5\n\n# oops\n");
  assert.match(problems[0], /never closed/);
});

test("a missing issue key is rejected", () => {
  const problems = validateHandoff("HANDOFF.d/x.md", "---\nstatus: OPEN\nowner: me\n---\n");
  assert.match(problems.join("\n"), /no `issue:` key/);
});

test("`#925` and a URL are both rejected — the contract wants a bare number", () => {
  for (const bad of ["#925", "https://github.com/u2giants/shared-db/issues/925", "u2giants/shared-db#925"]) {
    const problems = validateHandoff("HANDOFF.d/x.md", `---\nissue: ${bad}\nstatus: OPEN\nowner: me\n---\n`);
    assert.match(problems.join("\n"), /bare issue NUMBER/, `should reject ${bad}`);
  }
});

test("status DONE is rejected — a finished file is DELETED, not marked done", () => {
  const problems = validateHandoff("HANDOFF.d/x.md", good(925, "DONE"));
  assert.match(problems.join("\n"), /DELETED, never marked done/);
  assert.ok(!VALID_STATUS.includes("DONE"));
});

test("a missing owner is rejected", () => {
  const problems = validateHandoff("HANDOFF.d/x.md", "---\nissue: 1\nstatus: OPEN\n---\n");
  assert.match(problems.join("\n"), /no `owner:` key/);
});

// --- rule 1 is scoped to YOUR files ---------------------------------------

test("THE CENTRAL RULE: someone else's malformed file never fails your pull request", () => {
  // This is the whole reason the count cap was rejected. A legitimate new file
  // must merge even when the directory is full of other people's stale ones.
  const result = evaluate({
    ...base,
    changed: [{ path: "HANDOFF.d/mine.md", change: "A", text: good(925) }],
    existing: [
      { path: "HANDOFF.d/theirs-1.md", issue: 111 },
      { path: "HANDOFF.d/theirs-2.md", issue: 222 },
      { path: "HANDOFF.d/theirs-3.md", issue: 333 },
    ],
    issueStates: states({ 925: "OPEN", 111: "CLOSED", 222: "CLOSED", 333: "CLOSED" }),
  });
  assert.equal(result.ok, true, result.problems.join("\n"));
});

test("NO COUNT LIMIT: the thirtieth well-formed file passes", () => {
  const existing = Array.from({ length: 29 }, (_, i) => ({ path: `HANDOFF.d/f${i}.md`, issue: 1000 + i }));
  const result = evaluate({
    ...base,
    changed: [{ path: "HANDOFF.d/thirtieth.md", change: "A", text: good(925) }],
    existing,
    issueStates: states({ 925: "OPEN" }),
  });
  assert.equal(result.ok, true, result.problems.join("\n"));
});

// --- rule 2a — retire the file you touched when its issue is closed --------

test("touching your own file while its issue is CLOSED fails, and says to retire it", () => {
  const result = evaluate({
    ...base,
    changed: [{ path: "HANDOFF.d/mine.md", change: "M", text: good(925) }],
    issueStates: states({ 925: "CLOSED" }),
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /is CLOSED.*Retire the file in this same pull request/s);
});

test("deleting your file is always allowed — that is the behaviour being asked for", () => {
  const result = evaluate({
    ...base,
    changed: [{ path: "HANDOFF.d/mine.md", change: "D" }],
    issueStates: states({ 925: "CLOSED" }),
  });
  assert.equal(result.ok, true, result.problems.join("\n"));
});

test("NO SILENT PASS: an issue whose state could not be read is a failure, not a shrug", () => {
  const result = evaluate({
    ...base,
    changed: [{ path: "HANDOFF.d/mine.md", change: "A", text: good(4242) }],
    issueStates: new Map(),
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /could not be read from GitHub/);
});

// --- rule 2b — closing an issue retires its handoff file ------------------

test("closing an issue while its handoff file survives fails the pull request", () => {
  const result = evaluate({
    ...base,
    existing: [{ path: "HANDOFF.d/theirs.md", issue: 727 }],
    closingIssues: [727],
    issueStates: states({ 727: "OPEN" }),
  });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /closes issue #727.*Retire that file here/s);
});

test("closing an issue AND retiring its file in the same pull request passes", () => {
  const result = evaluate({
    ...base,
    changed: [{ path: "HANDOFF.d/theirs.md", change: "D" }],
    existing: [{ path: "HANDOFF.d/theirs.md", issue: 727 }],
    closingIssues: [727],
    issueStates: states({ 727: "OPEN" }),
  });
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.match(result.notes.join("\n"), /retired alongside issue #727/);
});

test("closing an issue no handoff file points at is fine", () => {
  const result = evaluate({
    ...base,
    existing: [{ path: "HANDOFF.d/other.md", issue: 111 }],
    closingIssues: [727],
    issueStates: states({ 727: "OPEN" }),
  });
  assert.equal(result.ok, true, result.problems.join("\n"));
});

// --- closing-keyword parsing ----------------------------------------------

test("every GitHub closing keyword is recognised, and bare mentions are not", () => {
  assert.deepEqual(parseClosingIssues("Closes #1, fixes #2, Resolved: #3").sort((a, b) => a - b), [1, 2, 3]);
  assert.deepEqual(parseClosingIssues("see #9 for context"), []);
  assert.deepEqual(parseClosingIssues("related to #9 and closes #9"), [9]);
});
