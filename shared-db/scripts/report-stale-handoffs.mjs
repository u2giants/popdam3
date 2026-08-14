#!/usr/bin/env node
/**
 * Weekly report: which HANDOFF.d/ files point at a CLOSED issue.
 *
 * The third and last check of the handoff contract (issue #658). It exists for
 * the one gap the two pull-request rules cannot close: a session that dies
 * mid-run never comes back to retire its file, so nothing ever fires.
 *
 * It REPORTS. It never blocks anybody's pull request, and it never deletes a
 * file. Both of those would put the cost back on whoever shows up next, which is
 * exactly the failure the owner ruled against on 2026-08-13. Instead it names
 * the owner recorded in each stale file, so the ask lands on the session that
 * created it rather than on a stranger.
 *
 * It maintains ONE issue and edits it in place. A weekly job that opens a fresh
 * issue every Monday is a job everybody mutes by March.
 *
 *   node scripts/report-stale-handoffs.mjs            # print, exit 0
 *   node scripts/report-stale-handoffs.mjs --publish  # also sync the tracking issue
 */

import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HANDOFF_DIR, parseFrontMatter } from "./check-handoff-contract.mjs";

export const TRACKING_TITLE = "HANDOFF.d hygiene — files whose issue is already closed";
const TRACKING_LABEL = "db-work";

/** Build the report body. Pure, so the wording is testable. */
export function renderReport({ stale, unlabelled, total, generatedAt }) {
  const lines = [
    "_Maintained automatically by `scripts/report-stale-handoffs.mjs`. This issue is edited in place, never duplicated._",
    "",
    `**${total} handoff file(s) in \`HANDOFF.d/\`. There is no limit on that number** — concurrent`,
    "workstreams across the five applications sharing this database legitimately produce many files.",
    "The only thing tracked here is files whose work is already **finished**.",
    "",
  ];

  if (stale.length === 0 && unlabelled.length === 0) {
    lines.push("✅ **Nothing stale.** Every handoff file points at an open issue.", "");
  }

  if (stale.length > 0) {
    lines.push(
      `### ${stale.length} file(s) whose issue is CLOSED`,
      "",
      "The owner named below is the session that created the file. If that session is gone, any",
      "orchestrator may retire the file — but say so in the pull request rather than deleting it silently.",
      "",
      "| File | Issue | Owner |",
      "|---|---|---|",
      ...stale.map((s) => `| \`${s.path}\` | #${s.issue} (closed) | \`${s.owner ?? "unknown"}\` |`),
      "",
    );
  }

  if (unlabelled.length > 0) {
    lines.push(
      `### ${unlabelled.length} file(s) with no machine-readable contract`,
      "",
      "These predate the frontmatter contract, or their block is malformed. Nothing can tell whether",
      "they are finished without reading them. Add the block, or retire the file.",
      "",
      ...unlabelled.map((p) => `- \`${p}\``),
      "",
    );
  }

  lines.push(`_Last checked: ${generatedAt}._`);
  return lines.join("\n");
}

/** Classify every handoff file. `issueState` is injected so tests stay offline. */
export function classify(files, issueState) {
  const stale = [];
  const unlabelled = [];
  for (const { path, text } of files) {
    const parsed = parseFrontMatter(text);
    const issue = parsed.ok ? Number(parsed.data.issue) : NaN;
    if (!Number.isInteger(issue)) {
      unlabelled.push(path);
      continue;
    }
    if (issueState(issue) === "CLOSED") {
      stale.push({ path, issue, owner: parsed.ok ? parsed.data.owner : undefined });
    }
  }
  return { stale, unlabelled, total: files.length };
}

// --------------------------------------------------------------------------

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function main() {
  const repo = process.env.HANDOFF_REPO || "u2giants/shared-db";
  const publish = process.argv.includes("--publish");

  const files = readdirSync(HANDOFF_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ path: `${HANDOFF_DIR}/${f}`, text: readFileSync(`${HANDOFF_DIR}/${f}`, "utf8") }));

  const cache = new Map();
  const issueState = (n) => {
    if (!cache.has(n)) {
      // A number that does not resolve is treated as OPEN on purpose: this job
      // must never nominate a file for retirement on the strength of a failed
      // API call. The pull-request guard is where a bad number fails loudly.
      let state = "OPEN";
      try {
        state = sh(`gh issue view ${n} --repo ${repo} --json state -q .state`).toUpperCase();
      } catch {
        console.error(`::warning::issue #${n} could not be read; treating it as OPEN for this report.`);
      }
      cache.set(n, state);
    }
    return cache.get(n);
  };

  const result = classify(files, issueState);
  const body = renderReport({ ...result, generatedAt: new Date().toISOString() });
  console.log(body);

  if (!publish) return;

  const existing = JSON.parse(
    sh(`gh issue list --repo ${repo} --state open --label ${TRACKING_LABEL} --limit 200 --json number,title`),
  ).find((i) => i.title === TRACKING_TITLE);

  if (result.stale.length === 0 && result.unlabelled.length === 0) {
    if (existing) {
      sh(`gh issue close ${existing.number} --repo ${repo} --comment "Nothing stale — every handoff file points at an open issue."`);
      console.log(`Closed tracking issue #${existing.number}: nothing stale.`);
    }
    return;
  }

  if (existing) {
    execSync(`gh issue edit ${existing.number} --repo ${repo} --body-file -`, { input: body, stdio: ["pipe", "inherit", "inherit"] });
    console.log(`Updated tracking issue #${existing.number}.`);
  } else {
    execSync(`gh issue create --repo ${repo} --label ${TRACKING_LABEL} --title "${TRACKING_TITLE}" --body-file -`, {
      input: body,
      stdio: ["pipe", "inherit", "inherit"],
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
