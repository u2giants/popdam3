#!/usr/bin/env node
// Guard: COORDINATOR_INTAKE.md must stay a POINTER once step 8 has reduced it.
//
// WHY THIS EXISTS, and why it is a required check rather than a warning.
//
// Step 5 of plan_coordinator-queue-to-github-issues.md requires the updated skills to
// propagate to EVERY machine before step 8 turns the queue file into a pointer. The
// failure it guards is real and silent: a machine still running the old skill appends its
// handover to the pointer file, the file grows a body again, and the queue is rebuilt live
// during the migration with nothing raising a hand.
//
// The problem, raised in review (Kimi K3, 2026-08-07) and correct: "propagation confirmed
// on every machine" is not verifiable by any single session. This machine can hash its own
// installed skills against the hub; it cannot see t16, hetz, 916 or 4837. A precondition
// nobody can check is a precondition nobody checks.
//
// So the gate is inverted. Instead of trying to prove every machine is current BEFORE the
// cutover, this DETECTS the one behaviour a stale machine produces, on the next pull
// request, and fails. An unverifiable precondition becomes a verifiable detector.
//
// It must be a REQUIRED status check with no `paths:` filter. As an ordinary check it
// would be skipped by exactly the docs-only PR that carries the rebuild, and `AGENTS.md`
// §5.2 already records `paths:` filters producing false verdicts in this repo.
//
//   node scripts/check-intake-pointer.mjs
//
// Exit 0 = fine. Exit 1 = the pointer has grown a body, or the file is missing.
//
// Node >= 20. No dependencies, no network, offline-deterministic.

import { readFile } from 'node:fs/promises';

const FILE = 'COORDINATOR_INTAKE.md';

// Set to true by step 8, in the same PR that reduces the file. Until then the check
// passes trivially, so it can be made required BEFORE the cutover — which is the point:
// the required context must already exist and be green when step 8 lands, or step 8's PR
// is blocked by its own new gate.
const POINTER_MODE = true;

// Headings that mean the queue is back. Matched case-insensitively: `AGENTS.md:1011` and
// `:1013` refer to "the coordinator intake" in lower case, and a case-sensitive gate would
// miss a lower-cased rebuild. (Raised by Kimi K3, 2026-08-07.)
const FORBIDDEN_HEADINGS = [
  'request queue',
  'intake queue',
  'in progress',
  'waiting on other people',
  'completed',
  'taken over',
  'part b2',
];

const MAX_POINTER_LINES = 40;

async function main() {
  let text;
  try {
    text = await readFile(FILE, 'utf8');
  } catch {
    // Fail on a missing file rather than passing vacuously. A deleted file is not a
    // satisfied pointer, and "the check passed because there was nothing to check" is the
    // false-green this repo keeps rediscovering.
    console.error(`FAIL: ${FILE} does not exist. Step 8 reduces it to a pointer; it does not delete it.`);
    process.exit(1);
  }

  if (!POINTER_MODE) {
    console.log(`OK: pointer mode is off. ${FILE} is still the live queue, so this guard is dormant.`);
    console.log('    Step 8 flips POINTER_MODE to true in the same PR that reduces the file.');
    return;
  }

  const lines = text.split(/\r?\n/);
  const problems = [];

  if (lines.length > MAX_POINTER_LINES) {
    problems.push(`${FILE} is ${lines.length} lines. A pointer is at most ${MAX_POINTER_LINES}.`);
  }

  // Length alone is not enough — a stale machine's first append is small. Match the
  // headings that mean the sections are back.
  lines.forEach((line, i) => {
    const m = line.match(/^#{2,3}\s+(.*)$/);
    if (!m) return;
    const heading = m[1].toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    for (const bad of FORBIDDEN_HEADINGS) {
      if (heading.startsWith(bad)) problems.push(`${FILE}:${i + 1} — the section heading "${m[1].trim()}" is back.`);
    }
  });

  // The warning the pointer must always carry. A coordinator once concluded the project
  // was idle from an empty queue while ~20 jobs sat in the backlog.
  if (!/empty/i.test(text) || !/backlog/i.test(text)) {
    problems.push(`${FILE} must keep the "an empty issue list is not proof there is no work" warning, pointing at HANDOFF.md ## BACKLOG and HANDOFF.d/.`);
  }

  if (problems.length) {
    console.error('FAIL: the coordinator queue is growing back.\n');
    for (const p of problems) console.error('  - ' + p);
    console.error('\nWhat this almost certainly means: a machine is still running the OLD skills and');
    console.error('appended a handover here instead of opening an issue. Do not just revert the file —');
    console.error('find the machine and sync it, or it will do this again on its next session.');
    console.error('Run "sync my dotfiles" on every machine. See work item WI-63.');
    process.exit(1);
  }

  console.log(`OK: ${FILE} is a pointer (${lines.length} lines), carries the "empty is not idle" warning, and no queue section has returned.`);
}

await main();
