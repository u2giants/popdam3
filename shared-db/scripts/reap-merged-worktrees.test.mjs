/**
 * Refusal tests for the worktree reaper (issue #658). Every test here is a case
 * where the reaper must NOT delete. Offline; no git, no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { blockedByLiveOrchestrator, plan } from "./reap-merged-worktrees.mjs";

const wt = (over = {}) => ({
  path: "/w/feature",
  branch: "feature/x",
  detached: false,
  locked: false,
  dirty: false,
  unpushed: false,
  isMain: false,
  ...over,
});

const merged = new Set(["feature/x"]);

test("a clean worktree whose pull request merged is retireable", () => {
  const { remove, keep } = plan([wt()], merged);
  assert.equal(remove.length, 1);
  assert.equal(keep.length, 0);
});

test("SQUASH MERGE: a merged PR counts even though git ancestry would say unmerged", () => {
  // The reason every previous cleanup did nothing. The input here carries no
  // ancestry information at all — merged-ness comes only from the PR list.
  const { remove } = plan([wt({ branch: "codex/squashed" })], new Set(["codex/squashed"]));
  assert.equal(remove.length, 1);
});

test("a DIRTY worktree is never removed, however merged its branch is", () => {
  const { remove, keep } = plan([wt({ dirty: true })], merged);
  assert.equal(remove.length, 0);
  assert.match(keep[0].reason, /UNCOMMITTED CHANGES/);
});

test("a worktree with unpushed commits is never removed", () => {
  const { remove, keep } = plan([wt({ unpushed: true })], merged);
  assert.equal(remove.length, 0);
  assert.match(keep[0].reason, /not pushed/);
});

test("a locked worktree is never removed", () => {
  const { remove, keep } = plan([wt({ locked: true })], merged);
  assert.equal(remove.length, 0);
  assert.match(keep[0].reason, /locked/);
});

test("a detached worktree is never removed — there is no branch to judge", () => {
  const { remove, keep } = plan([wt({ detached: true, branch: null })], merged);
  assert.equal(remove.length, 0);
  assert.match(keep[0].reason, /detached/);
});

test("the main checkout is never a candidate", () => {
  const { remove, keep } = plan([wt({ isMain: true, branch: "main" })], new Set(["main"]));
  assert.equal(remove.length, 0);
  assert.match(keep[0].reason, /main checkout/);
});

test("a branch with no merged pull request is kept", () => {
  const { remove, keep } = plan([wt({ branch: "feature/in-flight" })], merged);
  assert.equal(remove.length, 0);
  assert.match(keep[0].reason, /no merged pull request/);
});

test("dirtiness outranks every other reason in the message", () => {
  // If a worktree is both dirty and unmerged, the human must be told about the
  // uncommitted work — that is the unrecoverable half.
  const { keep } = plan([wt({ dirty: true, branch: "feature/in-flight" })], merged);
  assert.match(keep[0].reason, /UNCOMMITTED CHANGES/);
});

// --- the live-agent refusal ------------------------------------------------

test("an ACTIVE orchestrator blocks --apply: its sub-agents may hold these worktrees", () => {
  assert.equal(blockedByLiveOrchestrator([{ number: 910 }], false), true);
});

test("--force overrides, because sometimes the marker is stale and a human has checked", () => {
  assert.equal(blockedByLiveOrchestrator([{ number: 910 }], true), false);
});

test("no active orchestrator, no block", () => {
  assert.equal(blockedByLiveOrchestrator([], false), false);
});
