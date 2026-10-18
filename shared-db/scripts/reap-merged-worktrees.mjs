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
import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runGitHubCommand } from './lib/github-transport.mjs';
import { resolveRepositoryIdentity } from './lib/repository-identity.mjs';

// Claim-first cleanup custody (issue #4348, 2026-10-18): no marker lookup.
// Exact claim paths/branches, this running worktree, and recent or unmeasurable
// filesystem activity all protect a worktree. Activity protection applies even
// when there are no claims. An unreadable claim list refuses apply. Existing
// --force semantics remain explicit; it never overrides dirty/locked/claimed
// worktrees or any other permanent per-worktree hold.
export const DEFAULT_IDLE_HOURS = 24;
// A deletion tool must not accept a window so short that every worktree with a
// readable timestamp is "idle". `--idle-hours 0.001` passed the old
// positive-number test and would have retired a worktree an agent used four
// seconds ago. One hour is the shortest window that can still mean "nobody has
// touched this"; below that, say so and stop.
export const MIN_IDLE_HOURS = 1;

export function normalizeWorktreePath(value) {
  return String(value ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Exact `worktree:` paths and `branch:` names declared by open database claims.
 * Pure, so "this claim protects that directory" is testable without GitHub.
 */
export function claimedHolds(claimBodies) {
  const paths = new Set();
  const branches = new Set();
  for (const body of claimBodies ?? []) {
    for (const m of String(body ?? "").matchAll(/^[ \t]*worktree:[ \t]*(\S.*?)[ \t]*$/gim)) {
      paths.add(normalizeWorktreePath(m[1]));
    }
    for (const m of String(body ?? "").matchAll(/^[ \t]*branch:[ \t]*(\S+)[ \t]*$/gim)) {
      branches.add(m[1].trim());
    }
  }
  paths.delete("");
  branches.delete("");
  return { paths, branches };
}

/**
 * Has this worktree been quiet for the whole idle window? UNKNOWN COUNTS AS LIVE:
 * a worktree whose activity could not be measured is never called idle, because
 * "I could not measure it" must never be reported as "nothing is using it".
 */
export function isIdle(worktree, now, idleHours) {
  const last = worktree?.lastActivityMs;
  if (!Number.isFinite(last)) return false;
  return now - last >= idleHours * 3600 * 1000;
}

/**
 * Decide what to do with each worktree. Pure, so every refusal is testable.
 *
 * @param {Array<{path,branch,detached,locked,dirty,unpushed,isMain,lastActivityMs}>} worktrees
 * @param {Set<string>} mergedBranches branches whose PULL REQUEST is merged
 * @param {{claimedPaths?:Set<string>,claimedBranches?:Set<string>,selfPath?:string|null,orchestratorActive?:boolean,now?:number,idleHours?:number,force?:boolean}} guard
 * @returns {{remove: object[], keep: Array<{worktree: object, reason: string}>}}
 */
export function plan(worktrees, mergedBranches, guard = {}) {
  const {
    claimedPaths = new Set(),
    claimedBranches = new Set(),
    selfPath = null,
    orchestratorActive = true,
    now = Date.now(),
    idleHours = DEFAULT_IDLE_HOURS,
    force = false,
  } = guard;
  const self = selfPath === null || selfPath === undefined ? null : normalizeWorktreePath(selfPath);
  const remove = [];
  const keep = [];
  for (const w of worktrees) {
    const here = normalizeWorktreePath(w.path);
    let reason = null;
    if (w.isMain) reason = "the main checkout";
    else if (w.dirty) reason = "UNCOMMITTED CHANGES — recover or commit them first";
    else if (w.locked) reason = "locked";
    else if (w.detached) reason = "detached HEAD — no branch to check";
    else if (w.unpushed) reason = "commits not pushed anywhere";
    else if (self !== null && here === self) reason = "this reap is running inside it";
    else if (claimedPaths.has(here)) reason = "an open database claim names this exact worktree";
    else if (w.branch && claimedBranches.has(w.branch))
      reason = `an open database claim holds its branch ${w.branch}`;
    else if (orchestratorActive && !force && !isIdle(w, now, idleHours))
      reason = `this worktree was active within the last ${idleHours}h`;
    else if (!mergedBranches.has(w.branch)) reason = "no merged pull request for its branch";
    if (reason) keep.push({ worktree: w, reason });
    else remove.push(w);
  }
  return { remove, keep };
}

/**
 * Compatibility API name retained for existing callers/tests. The first bit
 * means ownership protection is active; main always enables it. Unreadable claim
 * evidence then refuses cleanup, independently of any retired role or marker.
 */
export function blockedByLiveOrchestrator(orchestratorActive, force, claimsReadable = true) {
  if (typeof orchestratorActive !== "boolean") {
    throw new TypeError(
      "blockedByLiveOrchestrator takes the ownership-protection boolean, not a list; " +
        "unreadable ownership evidence must remain protective",
    );
  }
  if (force) return false;
  return orchestratorActive && !claimsReadable;
}

// --------------------------------------------------------------------------

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

export function readGitHubArray(args, run = runGitHubCommand) {
  const rows = JSON.parse(run(args));
  if (!Array.isArray(rows)) throw new Error('GitHub returned a non-array listing');
  return rows;
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

// Newest filesystem activity inside the worktree's own git administrative
// directory. Those files are rewritten by ordinary git use -- checkout, commit,
// fetch, a status against a changed tree -- so a worktree an agent is working in
// looks recent and one nobody has touched for a day does not. Returns null when
// it cannot be measured, and null is treated as LIVE by `isIdle`.
//
// The admin DIRECTORY's own mtime is deliberately not consulted: measured on
// this machine it read 0.0 hours for all 79 worktrees at once, because any git
// command anywhere in the repository touches every worktree's admin directory.
// A signal that is fresh for everything says nothing about anything, and using
// it made the whole reap report zero candidates -- the same do-nothing outcome
// the old blanket refusal produced.
export function lastActivityMs(worktreePath) {
  let adminDir;
  try {
    adminDir = sh(`git -C "${worktreePath}" rev-parse --absolute-git-dir`);
  } catch {
    return null;
  }
  let newest = null;
  for (const name of ["index", "HEAD", "logs/HEAD", "ORIG_HEAD"]) {
    try {
      const at = statSync(join(adminDir, name)).mtimeMs;
      if (newest === null || at > newest) newest = at;
    } catch {
      // A missing optional file is not evidence of anything; keep looking.
    }
  }
  try {
    const at = statSync(worktreePath).mtimeMs;
    if (newest === null || at > newest) newest = at;
  } catch {
    return null;
  }
  return newest;
}

export function main({
  argv = process.argv,
  env = process.env,
  runGitHub = runGitHubCommand,
  worktrees = readWorktrees,
  activity = lastActivityMs,
  log = console.log,
  error = console.error,
  exit = process.exit,
} = {}) {
  const repo = resolveRepositoryIdentity({ explicit: env.HANDOFF_REPO });
  const apply = argv.includes("--apply");
  const force = argv.includes("--force");
  const idleArg = argv.indexOf("--idle-hours");
  const idleHours = idleArg > -1 ? Number(argv[idleArg + 1]) : DEFAULT_IDLE_HOURS;
  if (!Number.isFinite(idleHours) || idleHours < MIN_IDLE_HOURS) {
    error(
      `::error::--idle-hours must be a number of hours no smaller than ${MIN_IDLE_HOURS}`,
    );
    exit(2);
    return;
  }

  const merged = new Set(readGitHubArray(
    ['pr', 'list', '--repo', repo, '--state', 'merged', '--limit', '400', '--json', 'headRefName'],
    runGitHub,
  ).map((p) => p.headRefName));

  // The positive liveness signals, read BEFORE anything is planned so a dry run
  // shows exactly what an --apply would do. A failed read is recorded, never
  // swallowed: it decides the whole-run refusal below.
  let claims = [];
  let claimsReadable = true;
  try {
    claims = readGitHubArray(
      ['issue', 'list', '--repo', repo, '--state', 'open', '--label', 'db-claim', '--limit', '200', '--json', 'number,body'],
      runGitHub,
    );
  } catch (err) {
    claimsReadable = false;
    error(`::warning::could not read open database claims: ${err.message}`);
  }
  // Claim-first: recent activity is protective with or without any open claim.
  // An unreadable claim list must never relax ownership protection.
  const orchestratorActive = true; // legacy plan option; no role/marker lookup
  const { paths: claimedPaths, branches: claimedBranches } = claimedHolds(claims.map((c) => c.body));

  const inspectedWorktrees = worktrees();
  for (const w of inspectedWorktrees) w.lastActivityMs = w.isMain ? null : activity(w.path);
  const { remove, keep } = plan(inspectedWorktrees, merged, {
    claimedPaths,
    claimedBranches,
    selfPath: process.cwd(),
    orchestratorActive,
    idleHours,
    force,
  });

  log(
    `${inspectedWorktrees.length} worktree(s). ${remove.length} retireable, ${keep.length} kept.\n` +
      `claim-first ownership protection active; ` +
      `${claimsReadable ? `${claimedPaths.size} claimed worktree path(s), ${claimedBranches.size} claimed branch(es)` : "CLAIMS UNREADABLE"}; ` +
      `idle window ${idleHours}h.\n`,
  );
  for (const { worktree, reason } of keep) log(`  KEEP    ${worktree.path}\n          ${reason}`);
  log();
  for (const w of remove) log(`  RETIRE  ${w.path}  (${w.branch})`);

  if (!apply) {
    log("\nDry run. Re-run with --apply to remove the retireable ones.");
    return;
  }

  // The only whole-run refusal left. The per-worktree holds above are what keep a
  // live agent's directory safe; this catches the case where those holds could not
  // be read at all, which would silently downgrade the guard to the guess it
  // replaced. AGENTS.md 2.1-W still stands: never remove a worktree held by a live
  // agent.
  if (blockedByLiveOrchestrator(orchestratorActive, force, claimsReadable)) {
    error(
      "\n::error::The open database claims could not be read, so " +
        "there is no way to tell which of these worktrees an agent is holding right now. " +
        "Refusing to remove anything. Fix the claim read and re-run; --force only when you have " +
        "confirmed no agent is running.",
    );
    exit(1);
    return;
  }

  let removed = 0;
  for (const w of remove) {
    try {
      sh(`git worktree remove "${w.path}"`);
      removed++;
      log(`removed ${w.path}`);
    } catch (err) {
      error(`::warning::git refused to remove ${w.path}: ${err.message}`);
    }
  }
  log(`\nRemoved ${removed} of ${remove.length}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
