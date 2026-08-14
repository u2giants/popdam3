#!/usr/bin/env node
/**
 * Guard: every HANDOFF.d/ file declares what would prove it finished, and the
 * session that finishes the work is the one asked to retire its own file.
 *
 * Why this exists (issue #658, owner ruling 2026-08-13).
 *
 * `HANDOFF.d/` reached 30 files, 27 of which were finished workstreams. The rule
 * that should have cleaned them up could almost never fire: only the owning
 * session may delete its own file, and by the time a workstream is provably done
 * that session ended days ago. So the one party allowed to delete is the one
 * party who is gone, and every later session correctly does nothing.
 *
 * The obvious fix -- fail a pull request when the directory exceeds N files -- is
 * WRONG and was rejected by the owner on 2026-08-13:
 *
 *   "when the 6th file gets there legitimately, if there are five files already
 *    there and some are stale, the legitimate file will get rejected. The sessions
 *    that do the work must take care of their own housekeeping. they are better
 *    informed than anyone as to whether something is finished or not."
 *
 * A count cap punishes whoever shows up next. This repo can legitimately have 20
 * concurrent workstreams across the five applications that share the database, so
 * 20 files is CORRECT and no number is the right ceiling. What is being limited is
 * STALE files, and the target for those is zero.
 *
 * So there is no count check anywhere in here. There are two rules, and each one
 * can only ever fail the session that owns the file:
 *
 *   RULE 1 (shape). A HANDOFF.d file you ADD or MODIFY must carry a frontmatter
 *   block naming the issue that would prove it done. One line, and it converts
 *   "is this finished?" from an hour of reading into one `gh issue view`. Nobody
 *   else's file is inspected, so a legitimate 6th or 30th file merges freely.
 *
 *   RULE 2 (retire on close). If the file you touched points at an issue that is
 *   already CLOSED, retire the file in this same pull request. And if THIS pull
 *   request closes an issue that some handoff file points at, retire that file
 *   here too -- while the session that did the work is still present and still
 *   knows whether it is really finished.
 *
 * What is deliberately NOT here: any judgement about whether other people's files
 * are stale. That is the weekly report (scripts/report-stale-handoffs.mjs), which
 * opens an issue and never blocks a pull request.
 *
 * Design rules, same as the other repo-wide guards (see
 * .github/workflows/intake-pointer-guard.yml):
 *   1. No `paths:` filter on the workflow -- a filtered guard reports stale green.
 *   2. Unique check-run name so it can be a required context.
 *   3. NO SILENT PASS. If issue state cannot be read, this FAILS. A guard that
 *      degrades to "pass" when its data source is missing is the exact defect
 *      class AGENTS.md 5.2 and 12.1 item 12 record happening in this repo already.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HANDOFF_DIR = "HANDOFF.d";

/** Statuses a handoff file may declare. */
export const VALID_STATUS = ["OPEN", "BLOCKED"];

/**
 * Parse the leading YAML frontmatter block of a handoff file.
 *
 * Deliberately a tiny hand-rolled parser rather than a YAML dependency: the block
 * is four scalar keys, this must run offline with no install step, and a real YAML
 * parser would happily accept nested structures this contract does not want.
 *
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
 */
export function parseFrontMatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { ok: false, error: "the file does not start with a `---` frontmatter block" };
  }
  const body = text.replace(/^---\r?\n/, "");
  const end = body.search(/^---\s*$/m);
  if (end === -1) {
    return { ok: false, error: "the frontmatter block is never closed with a `---` line" };
  }
  const data = {};
  const lines = body.slice(0, end).split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) return { ok: false, error: `frontmatter line is not \`key: value\`: ${line}` };
    data[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { ok: true, data };
}

/**
 * Validate one handoff file's frontmatter against the contract.
 *
 * @returns {string[]} human-readable problems; empty means valid.
 */
export function validateHandoff(path, text) {
  const parsed = parseFrontMatter(text);
  if (!parsed.ok) {
    return [
      `${path}: ${parsed.error}. Every HANDOFF.d file must open with:\n` +
        "    ---\n" +
        "    issue: 925              # the issue that proves this done\n" +
        "    status: OPEN            # OPEN or BLOCKED\n" +
        "    owner: codex/my-branch  # the branch or session that owns it\n" +
        "    ---",
    ];
  }
  const problems = [];
  const { issue, status, owner } = parsed.data;

  if (issue === undefined) {
    problems.push(`${path}: frontmatter has no \`issue:\` key. Name the issue that would prove this file finished.`);
  } else if (!/^\d+$/.test(String(issue))) {
    problems.push(
      `${path}: \`issue: ${issue}\` must be a bare issue NUMBER, e.g. \`issue: 925\` — not a URL and not \`#925\`.`,
    );
  }

  if (status === undefined) {
    problems.push(`${path}: frontmatter has no \`status:\` key (one of ${VALID_STATUS.join(", ")}).`);
  } else if (!VALID_STATUS.includes(status)) {
    problems.push(
      `${path}: \`status: ${status}\` is not one of ${VALID_STATUS.join(", ")}. ` +
        "A finished file is DELETED, never marked done — that is the whole point of the contract.",
    );
  }

  if (!owner) {
    problems.push(`${path}: frontmatter has no \`owner:\` key. Name the branch or session that owns this file.`);
  }

  return problems;
}

/**
 * The whole decision, as a pure function so the negative paths are testable.
 *
 * @param {object} input
 * @param {Array<{path: string, change: "A"|"M"|"D", text?: string}>} input.changed
 *        HANDOFF.d files added/modified/deleted by this pull request.
 * @param {Array<{path: string, issue: number}>} input.existing
 *        Every HANDOFF.d file on the merge base, with the issue it points at.
 * @param {Map<number, "OPEN"|"CLOSED">} input.issueStates
 * @param {number[]} input.closingIssues Issues this pull request closes.
 * @returns {{ok: boolean, problems: string[], notes: string[]}}
 */
export function evaluate({ changed, existing, issueStates, closingIssues }) {
  const problems = [];
  const notes = [];
  const deleted = new Set(changed.filter((c) => c.change === "D").map((c) => c.path));

  // RULE 1 — shape, and only for files THIS pull request touches.
  for (const file of changed) {
    if (file.change === "D") continue;
    problems.push(...validateHandoff(file.path, file.text ?? ""));
  }

  // RULE 2a — a file you touched must not point at an already-closed issue.
  for (const file of changed) {
    if (file.change === "D") continue;
    const parsed = parseFrontMatter(file.text ?? "");
    if (!parsed.ok) continue; // rule 1 already reported it
    const issue = Number(parsed.data.issue);
    if (!Number.isInteger(issue)) continue;
    const state = issueStates.get(issue);
    if (state === undefined) {
      // NO SILENT PASS: an unreadable issue is a failure, not a shrug.
      problems.push(
        `${file.path}: issue #${issue} could not be read from GitHub. ` +
          "This guard will not pass on missing data — check the number is real and re-run.",
      );
      continue;
    }
    if (state === "CLOSED") {
      problems.push(
        `${file.path}: issue #${issue} is CLOSED, so this handoff's work is finished. ` +
          "Retire the file in this same pull request (`git rm`), or reopen the issue if it is not " +
          "really done. Do not leave a finished file behind for a later session to guess about.",
      );
    }
  }

  // RULE 2b — if this pull request closes an issue, its handoff file goes with it.
  for (const issue of closingIssues) {
    for (const file of existing) {
      if (file.issue !== issue) continue;
      if (deleted.has(file.path)) {
        notes.push(`${file.path} retired alongside issue #${issue}. That is the contract working.`);
        continue;
      }
      problems.push(
        `This pull request closes issue #${issue}, and ${file.path} points at it. ` +
          "Retire that file here (`git rm`) — you are the session that finished the work and the " +
          "only one who knows it is really done. A later session cannot tell.",
      );
    }
  }

  return { ok: problems.length === 0, problems, notes };
}

/** Issue numbers a pull request closes, read from its body and commit messages. */
export function parseClosingIssues(text) {
  const out = new Set();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/gi;
  let m;
  while ((m = re.exec(text ?? "")) !== null) out.add(Number(m[1]));
  return [...out];
}

/** Read the issue a committed handoff file points at; null when it has none. */
export function issueOf(path) {
  const parsed = parseFrontMatter(readFileSync(path, "utf8"));
  if (!parsed.ok) return null;
  const n = Number(parsed.data.issue);
  return Number.isInteger(n) ? n : null;
}

// ---------------------------------------------------------------------------
// CLI. Everything above is pure and tested; everything below is data gathering.
// ---------------------------------------------------------------------------

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Issue states via the GitHub API. Throws rather than guessing — see NO SILENT PASS. */
function readIssueStates(repo, numbers) {
  const states = new Map();
  for (const n of numbers) {
    const raw = sh(`gh issue view ${n} --repo ${repo} --json state -q .state`);
    const state = raw.toUpperCase();
    if (state !== "OPEN" && state !== "CLOSED") {
      throw new Error(`unexpected state "${raw}" for issue #${n}`);
    }
    states.set(n, state);
  }
  return states;
}

function main() {
  const repo = process.env.HANDOFF_REPO || "u2giants/shared-db";
  const base = process.env.HANDOFF_BASE || "origin/main";

  // Files this pull request adds, modifies or deletes under HANDOFF.d/.
  let diff = "";
  try {
    diff = sh(`git diff --name-status ${base}...HEAD -- ${HANDOFF_DIR}`);
  } catch (err) {
    console.error(`::error::cannot diff against ${base}: ${err.message}`);
    console.error("The checkout needs full history — use actions/checkout with fetch-depth: 0.");
    process.exit(1);
  }

  const changed = [];
  for (const line of diff.split("\n").filter(Boolean)) {
    const [rawChange, ...rest] = line.split("\t");
    const change = rawChange[0]; // R100 etc. collapse to their first letter
    const path = rest[rest.length - 1];
    if (!path.endsWith(".md")) continue;
    changed.push({
      path,
      change: change === "R" ? "A" : change,
      text: change === "D" ? undefined : readFileSync(path, "utf8"),
    });
  }

  // Every handoff file on the merge base, so rule 2b can find an untouched one.
  const existing = [];
  for (const path of sh(`git ls-tree -r --name-only ${base} -- ${HANDOFF_DIR}`).split("\n").filter(Boolean)) {
    if (!path.endsWith(".md")) continue;
    const parsed = parseFrontMatter(sh(`git show ${base}:${path}`));
    if (!parsed.ok) continue; // pre-contract file; the weekly report covers it
    const issue = Number(parsed.data.issue);
    if (Number.isInteger(issue)) existing.push({ path, issue });
  }

  const closingText = [process.env.PR_BODY ?? "", process.env.PR_TITLE ?? ""].join("\n");
  const closingIssues = parseClosingIssues(closingText);

  if (changed.length === 0 && closingIssues.length === 0) {
    console.log("No HANDOFF.d file touched and no issue closed by this pull request. Nothing to check.");
    return;
  }

  const wanted = new Set(closingIssues);
  for (const file of changed) {
    if (file.change === "D") continue;
    const parsed = parseFrontMatter(file.text ?? "");
    if (parsed.ok && /^\d+$/.test(String(parsed.data.issue ?? ""))) wanted.add(Number(parsed.data.issue));
  }

  let issueStates;
  try {
    issueStates = readIssueStates(repo, [...wanted]);
  } catch (err) {
    console.error(`::error::could not read issue state from GitHub: ${err.message}`);
    console.error("This guard fails rather than passing on missing data.");
    process.exit(1);
  }

  const { ok, problems, notes } = evaluate({ changed, existing, issueStates, closingIssues });
  for (const note of notes) console.log(`  ok  ${note}`);
  if (ok) {
    console.log(`Handoff contract satisfied for ${changed.length} changed file(s).`);
    return;
  }
  for (const p of problems) console.error(`::error::${p}`);
  console.error(
    "\nThis guard only ever inspects the files YOUR pull request touches. " +
      "It has no limit on how many handoff files the directory holds — 20 concurrent " +
      "workstreams means 20 files, and that is correct.",
  );
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
