/**
 * Refusal tests for the worktree reaper (issue #658). Every test here is a case
 * where the reaper must NOT delete. Offline; no git, no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  blockedByLiveOrchestrator,
  claimedHolds,
  isIdle,
  lastActivityMs,
  normalizeWorktreePath,
  plan,
  DEFAULT_IDLE_HOURS,
  MIN_IDLE_HOURS,
} from "./reap-merged-worktrees.mjs";

const REAPER = fileURLToPath(new URL("./reap-merged-worktrees.mjs", import.meta.url));

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

// --- the live-agent guard (issue #1868) ------------------------------------
//
// The old guard refused the WHOLE RUN whenever an orchestrator marker was open,
// so the reap never ran at all and the worktree count climbed from the 31 the
// issue reported to 81. These tests hold the replacement to a higher bar than
// the thing it replaces: a held worktree must survive, an unmeasurable one must
// survive, and the guard must be shown a known-dirty case for every signal.

const claimBody = (over = {}) =>
  [
    "```db-claim",
    `issue: ${over.issue ?? 2443}`,
    `worktree: ${over.worktree ?? "C:\\repos\\shared-db\\.claude\\worktrees\\busy-agent"}`,
    `branch: ${over.branch ?? "claude/2443-work"}`,
    "```",
  ].join("\n");

test("an open claim protects the exact worktree it names, marker or no marker", () => {
  const { paths, branches } = claimedHolds([claimBody()]);
  const held = wt({ path: "C:/repos/shared-db/.claude/worktrees/busy-agent", branch: "claude/2443-work" });
  const { remove, keep } = plan([held], new Set(["claude/2443-work"]), {
    claimedPaths: paths,
    claimedBranches: branches,
  });
  assert.equal(remove.length, 0);
  assert.match(keep[0].reason, /open database claim names this exact worktree/);
});

test("a claim protects its BRANCH even when the agent moved to another directory", () => {
  const { paths, branches } = claimedHolds([claimBody()]);
  const moved = wt({ path: "/w/elsewhere", branch: "claude/2443-work" });
  const { remove, keep } = plan([moved], new Set(["claude/2443-work"]), {
    claimedPaths: paths,
    claimedBranches: branches,
  });
  assert.equal(remove.length, 0);
  assert.match(keep[0].reason, /holds its branch claude\/2443-work/);
});

test("claim paths compare across separators and trailing slashes, not as raw strings", () => {
  // A Windows claim body and a git porcelain path for the SAME directory differ
  // in slash and case. If they failed to match, the guard would silently pass a
  // live worktree through as unclaimed.
  assert.equal(
    normalizeWorktreePath("C:\\Repos\\Shared-DB\\.claude\\worktrees\\A\\"),
    normalizeWorktreePath("c:/repos/shared-db/.claude/worktrees/a"),
  );
  const { paths } = claimedHolds([claimBody(), claimBody({ worktree: "  /w/spaced  " })]);
  assert.ok(paths.has("/w/spaced"), "surrounding whitespace must not hide a hold");
  assert.ok(!paths.has(""), "a blank worktree line must never become a hold on everything");
});

test("a claim with no worktree or branch line yields no holds and throws nothing", () => {
  const { paths, branches } = claimedHolds(["no machine block here at all", null, undefined]);
  assert.equal(paths.size, 0);
  assert.equal(branches.size, 0);
});

test("the worktree this reap is running inside is never a candidate", () => {
  const here = wt({ path: "C:/repos/shared-db/.claude/worktrees/self" });
  const { remove, keep } = plan([here], merged, {
    selfPath: "C:\\repos\\shared-db\\.claude\\worktrees\\self",
  });
  assert.equal(remove.length, 0);
  assert.match(keep[0].reason, /running inside it/);
});

test("while an orchestrator is live, a recently active worktree is kept", () => {
  const now = Date.UTC(2026, 8, 8, 12, 0, 0);
  const busy = wt({ lastActivityMs: now - 30 * 60 * 1000 });
  const { remove, keep } = plan([busy], merged, { orchestratorActive: true, now });
  assert.equal(remove.length, 0);
  assert.match(keep[0].reason, /active within the last 24h/);
});

test("while an orchestrator is live, a worktree quiet for the whole window is retireable", () => {
  const now = Date.UTC(2026, 8, 8, 12, 0, 0);
  const cold = wt({ lastActivityMs: now - 40 * 60 * 60 * 1000 });
  const { remove } = plan([cold], merged, { orchestratorActive: true, now });
  assert.equal(remove.length, 1, "this is the repair: the reap runs alongside an orchestrator");
});

test("UNMEASURABLE ACTIVITY COUNTS AS LIVE", () => {
  // The single most dangerous failure mode: "I could not read the mtime" must
  // never be reported as "nothing is using it".
  const now = Date.now();
  for (const unknown of [undefined, null, Number.NaN, "yesterday"]) {
    assert.equal(isIdle({ lastActivityMs: unknown }, now, DEFAULT_IDLE_HOURS), false);
    const { remove, keep } = plan([wt({ lastActivityMs: unknown })], merged, {
      orchestratorActive: true,
      now,
    });
    assert.equal(remove.length, 0, `activity ${String(unknown)} must not be treated as idle`);
    assert.match(keep[0].reason, /active within the last/);
  }
});

test("the idle window is not consulted when no orchestrator is running", () => {
  const now = Date.now();
  const { remove } = plan([wt({ lastActivityMs: now })], merged, { orchestratorActive: false, now });
  assert.equal(remove.length, 1);
});

test("--force skips the idle window but never overrides a claim or dirtiness", () => {
  const now = Date.now();
  const { paths, branches } = claimedHolds([claimBody({ branch: "feature/x" })]);
  const { remove } = plan([wt({ lastActivityMs: now })], merged, {
    orchestratorActive: true,
    now,
    force: true,
  });
  assert.equal(remove.length, 1, "--force is what the idle window yields to");

  const claimed = plan([wt({ lastActivityMs: now })], merged, {
    orchestratorActive: true,
    now,
    force: true,
    claimedPaths: paths,
    claimedBranches: branches,
  });
  assert.equal(claimed.remove.length, 0, "--force must not override a positive claim");
  const dirty = plan([wt({ dirty: true, lastActivityMs: now })], merged, { force: true });
  assert.equal(dirty.remove.length, 0, "--force must not override uncommitted work");
});

test("a live orchestrator alone no longer blocks the run — that was the defect", () => {
  assert.equal(blockedByLiveOrchestrator(true, false, true), false);
});

test("a live orchestrator WITH unreadable claims blocks the run", () => {
  // Without the claims there is no positive liveness signal at all, so we are
  // back to guessing and must refuse.
  assert.equal(blockedByLiveOrchestrator(true, false, false), true);
});

test("AN UNREADABLE MARKER LIST IS LIVE, AND WITH UNREADABLE CLAIMS IT BLOCKS", () => {
  // The defect the governed review of PR #2606 found. main() sets `markers` to
  // `[]` when the marker read FAILS and decides liveness separately. An earlier
  // draft asked this function for `markers.length > 0`, so the one run where we
  // know NOTHING -- no marker list, no claim list -- did not refuse, and would
  // have deleted worktrees the old code protected by throwing.
  const markersUnreadable = true; // exactly what main() computes from !markersReadable
  assert.equal(blockedByLiveOrchestrator(markersUnreadable, false, false), true);
  // and the shape that produced the bug is now loud rather than false
  assert.throws(() => blockedByLiveOrchestrator([], false, false), /LIVENESS BIT/);
  assert.throws(() => blockedByLiveOrchestrator([{ number: 2577 }], false, false), /LIVENESS BIT/);
});

test("--force overrides, because sometimes the marker is stale and a human has checked", () => {
  assert.equal(blockedByLiveOrchestrator(true, true, false), false);
});

test("no active orchestrator, no block", () => {
  assert.equal(blockedByLiveOrchestrator(false, false, true), false);
  assert.equal(blockedByLiveOrchestrator(false, false, false), false);
});

test("--force does not override a lock, a detached head, unpushed commits, or an unmerged branch", () => {
  // Order alone implies this, but a deletion tool should not be protected by an
  // argument about ordering. One known-dirty case per refusal, with --force set.
  const now = Date.now();
  const guard = { force: true, orchestratorActive: true, now };
  for (const dirty of [{ locked: true }, { detached: true }, { unpushed: true }]) {
    const { remove } = plan([wt({ ...dirty, lastActivityMs: now })], merged, guard);
    assert.equal(remove.length, 0, `--force must not override ${Object.keys(dirty)[0]}`);
  }
  const unmerged = plan([wt({ branch: "feature/never-merged", lastActivityMs: now })], merged, guard);
  assert.equal(unmerged.remove.length, 0, "--force must not retire an unmerged branch");
});

test("a REAL db-author-lease body holds its worktree and branch", () => {
  // The fixture above writes the fields into a db-claim fence. Production author
  // lanes emit a db-author-lease fence instead, so the parser is proved against
  // the shape scripts/manage-migration-author-lanes.mjs actually writes.
  const body = [
    "## Claim",
    "",
    "```db-author-lease",
    "issue: 2439",
    "owner: claude/session-a",
    "branch: claude/2439-bulk-history",
    "worktree: C:\\repos\\shared-db\\.claude\\worktrees\\lane-two",
    "objects: core.bulk_operation_run",
    "```",
  ].join("\r\n");
  const { paths, branches } = claimedHolds([body]);
  const held = wt({
    path: "C:/repos/shared-db/.claude/worktrees/lane-two",
    branch: "claude/2439-bulk-history",
  });
  const { remove, keep } = plan([held], new Set(["claude/2439-bulk-history"]), {
    claimedPaths: paths,
    claimedBranches: branches,
  });
  assert.equal(remove.length, 0);
  assert.match(keep[0].reason, /open database claim/);
});

test("lastActivityMs returns null rather than a number it could not measure", () => {
  // Unmeasurable must reach isIdle as null, because null is what keeps.
  assert.equal(lastActivityMs(join(tmpdir(), "reaper-no-such-directory-4f1c9")), null);
  assert.equal(isIdle({ lastActivityMs: lastActivityMs("") }, Date.now(), DEFAULT_IDLE_HOURS), false);
});

test("lastActivityMs reads the newest of the git files, not the admin directory", () => {
  // The admin DIRECTORY's mtime reads fresh for every worktree at once, which is
  // why it is excluded. A real, old git file must therefore come back old.
  const root = mkdtempSync(join(tmpdir(), "reaper-activity-"));
  try {
    execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
    const old = Date.now() - 90 * 60 * 60 * 1000;
    const admin = join(root, ".git");
    mkdirSync(join(admin, "logs"), { recursive: true });
    // HEAD must stay a valid ref line or `rev-parse` stops calling this a
    // repository, which would make the measurement null for the wrong reason.
    writeFileSync(join(admin, "HEAD"), "ref: refs/heads/main\n");
    for (const name of ["index", "logs/HEAD", "ORIG_HEAD"]) writeFileSync(join(admin, name), "x");
    for (const name of ["index", "HEAD", "logs/HEAD", "ORIG_HEAD"]) {
      utimesSync(join(admin, name), old / 1000, old / 1000);
    }
    utimesSync(root, old / 1000, old / 1000);
    const measured = lastActivityMs(root);
    assert.ok(Number.isFinite(measured), "a real worktree must be measurable");
    assert.ok(
      Math.abs(measured - old) < 5 * 60 * 1000,
      `expected the old file times, got ${new Date(measured).toISOString()}`,
    );
    assert.equal(isIdle({ lastActivityMs: measured }, Date.now(), DEFAULT_IDLE_HOURS), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--idle-hours refuses junk AND a window too short to mean anything", () => {
  // A positive-number test is not enough on a deletion tool: 0.001 passed it and
  // would have retired a worktree used four seconds ago.
  const refused = (...args) => {
    try {
      execFileSync(process.execPath, [REAPER, ...args], { stdio: "pipe" });
      return null;
    } catch (error) {
      return { status: error.status, message: String(error.stderr ?? "") };
    }
  };
  for (const value of ["0", "-3", "abc", "NaN", "0.001", String(MIN_IDLE_HOURS / 2)]) {
    const out = refused("--idle-hours", value);
    assert.ok(out, `--idle-hours ${value} must be refused`);
    assert.equal(out.status, 2, `--idle-hours ${value} must exit 2`);
    assert.match(out.message, /--idle-hours/);
  }
  const missing = refused("--idle-hours");
  assert.equal(missing?.status, 2, "a --idle-hours with no value must be refused");
});

test("plan without a guard argument still behaves exactly as before", () => {
  // Callers other than main() exist; the new parameter must be optional.
  const { remove } = plan([wt()], merged);
  assert.equal(remove.length, 1);
});
