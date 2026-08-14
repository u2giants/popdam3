#!/usr/bin/env node
/**
 * Retire sub-agent worktrees whose work has already merged (issue #658).
 *
 * Worktrees rot for the same reason handoff files did: the session that made one
 * is gone by the time its pull request merges, and every later session is told
 * -- correctly -- not to touch somebody else's. Measured on al8960ofc,
 * 2026-08-13: 29 worktrees, 12 on branches whose work was already merged.
 *
 * THE TRAP THIS REPO KEEPS FALLING INTO. `main` is squash-merged, which rewrites
 * the commit, so `git branch --merged` cannot see a merged feature branch. On
 * 2026-08-13, 74 of 130 branches looked unmerged to git while their pull request
 * was merged. Any reaper keyed on git ancestry therefore reports live work and
 * refuses to clean, which is why every previous attempt did nothing. This one
 * asks GitHub whether the PULL REQUEST merged, and treats git ancestry only as a
 * second, additive signal.
 *
 * SAFETY, from the global rule that every destructive action must be recoverable:
 *   - Dry run by default. `--apply` is required to remove anything.
 *   - A worktree that is DIRTY, LOCKED, detached, or has unpushed commits is
 *     never removed, printed instead. Uncommitted work is unrecoverable and no
 *     amount of "its PR merged" makes that safe.
 *   - The main checkout is never a candidate.
 *   - `git worktree remove` is used, never `rm -rf`, so git's own refusals apply.
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Decide what to do with each worktree. Pure, so every refusal is testable.
 *
 * @param {Array<{path,branch,detached,locked,dirty,unpushed,isMain}>} worktrees
 * @param {Set<string>} mergedBranches branches whose PULL REQUEST is merged
 * @returns {{remove: object[], keep: Array<{worktree: object, reason: string}>}}
 */
export function plan(worktrees, mergedBranches) {
  const remove = [];
  const keep = [];
  for (const w of worktrees) {
    let reason = null;
    if (w.isMain) reason = "the main checkout";
    else if (w.dirty) reason = "UNCOMMITTED CHANGES — recover or commit them first";
    else if (w.locked) reason = "locked";
    else if (w.detached) reason = "detached HEAD — no branch to check";
    else if (w.unpushed) reason = "commits not pushed anywhere";
    else if (!mergedBranches.has(w.branch)) reason = "no merged pull request for its branch";
    if (reason) keep.push({ worktree: w, reason });
    else remove.push(w);
  }
  return { remove, keep };
}

/**
 * A clean worktree on a merged branch can still be HELD BY A LIVE AGENT, and
 * nothing in git can tell that apart from an abandoned one. Pure so the refusal
 * is testable.
 */
export function blockedByLiveOrchestrator(markers, force) {
  return markers.length > 0 && !force;
}

// --------------------------------------------------------------------------

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function readWorktrees() {
  const out = [];
  let current = null;
  for (const line of sh("git worktree list --porcelain").split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9), branch: null, detached: false, locked: false };
      out.push(current);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    } else if (line === "detached") {
      current.detached = true;
    } else if (line.startsWith("locked")) {
      current.locked = true;
    }
  }
  const mainPath = out[0]?.path;
  for (const w of out) {
    w.isMain = w.path === mainPath;
    if (w.isMain) continue;
    try {
      w.dirty = sh(`git -C "${w.path}" status --porcelain`).length > 0;
      w.unpushed = w.branch
        ? sh(`git -C "${w.path}" log --oneline @{u}..HEAD 2>/dev/null || true`).length > 0
        : false;
    } catch {
      // Unreadable worktree: keep it. Never remove what you could not inspect.
      w.dirty = true;
      w.unpushed = true;
    }
  }
  return out;
}

function main() {
  const repo = process.env.HANDOFF_REPO || "u2giants/shared-db";
  const apply = process.argv.includes("--apply");

  const merged = new Set(
    JSON.parse(sh(`gh pr list --repo ${repo} --state merged --limit 400 --json headRefName`)).map(
      (p) => p.headRefName,
    ),
  );

  const worktrees = readWorktrees();
  const { remove, keep } = plan(worktrees, merged);

  console.log(`${worktrees.length} worktree(s). ${remove.length} retireable, ${keep.length} kept.\n`);
  for (const { worktree, reason } of keep) console.log(`  KEEP    ${worktree.path}\n          ${reason}`);
  console.log();
  for (const w of remove) console.log(`  RETIRE  ${w.path}  (${w.branch})`);

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to remove the retireable ones.");
    return;
  }

  // A clean worktree on a merged branch can still be HELD BY A LIVE AGENT: the
  // orchestrator dispatches sub-agents into worktrees, and one that has just
  // pushed and merged looks identical to an abandoned one. Nothing in git can
  // tell them apart. An open orchestrator marker means agents may be running, so
  // refuse to act on a guess. This is the standing rule in AGENTS.md 2.1-W:
  // never remove a worktree held by a live agent.
  const markers = JSON.parse(
    sh(`gh issue list --repo ${repo} --state open --label orchestrator-marker --limit 20 --json number,title`),
  );
  if (blockedByLiveOrchestrator(markers, process.argv.includes("--force"))) {
    console.error(
      `\n::error::An orchestrator is ACTIVE (${markers
        .map((m) => `#${m.number}`)
        .join(", ")}). Its sub-agents may be holding these worktrees right now, and a clean ` +
        "worktree on a merged branch is indistinguishable from one an agent just pushed from.\n" +
        "Refusing to remove anything. Run this after the orchestrator closes its marker, or pass " +
        "--force only when you have confirmed no agent is running.",
    );
    process.exit(1);
  }

  let removed = 0;
  for (const w of remove) {
    try {
      sh(`git worktree remove "${w.path}"`);
      removed++;
      console.log(`removed ${w.path}`);
    } catch (err) {
      console.error(`::warning::git refused to remove ${w.path}: ${err.message}`);
    }
  }
  console.log(`\nRemoved ${removed} of ${remove.length}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
