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

// There is deliberately NO on/off flag here.
//
// There used to be one: a constant, false until step 8 armed it, so the check could be
// made required before the cutover. Grok 4.5 pointed out the hole on review, and it is
// obvious once said: the flag lived in the same repository as the file it guarded, so ONE
// pull request could switch it off AND regrow the queue, and the required check would
// print "dormant" and exit 0. **A control that the thing it controls can switch off is not
// a control.** Step 8 has landed, so the flag has served its purpose and is gone. This
// guard is always on, and its tests fail if a flag is ever declared here again.

// Headings that mean the queue is back.
//
// Matched case-insensitively, because `AGENTS.md` refers to "the orchestrator intake" in
// lower case and a case-sensitive gate would walk straight past a lower-cased rebuild.
// (Kimi K3, 2026-08-07.)
//
// TWO lists, because the first version only had the first one and that was the bigger hole.
// Grok 4.5, 2026-08-07: the guard only knew SECTION titles, so `### REQUEST — do a thing`
// normalised to "request  do a thing", did not start with "request queue", and sailed
// through — and `### REQUEST — …` is EXACTLY the shape a machine on the old skills appends.
// The guard missed the precise failure it exists to catch.
const FORBIDDEN_SECTIONS = [
  'request queue',
  'intake queue',
  'in progress',
  'waiting on other people',
  'completed',
  'taken over',
  'part b2',
  'part 0',
  'part a',
  'part b',
  'standing facts',
];

// Block headings, the shape an append actually takes.
const FORBIDDEN_BLOCKS = ['request', 'intake', 'taken over', 'closing note', 'supplement', 'handover', 'question to resolve'];

const MAX_POINTER_LINES = 40;
// Line count alone is defeatable by putting the whole queue on a few very long lines.
const MAX_POINTER_BYTES = 4096;

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


  const lines = text.split(/\r?\n/);
  const problems = [];

  if (lines.length > MAX_POINTER_LINES) {
    problems.push(`${FILE} is ${lines.length} lines. A pointer is at most ${MAX_POINTER_LINES}.`);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_POINTER_BYTES) {
    problems.push(`${FILE} is ${Buffer.byteLength(text, 'utf8')} bytes. A pointer is at most ${MAX_POINTER_BYTES}. (Line count alone is defeatable by very long lines.)`);
  }

  // Any heading level, not just ## and ###: `# REQUEST QUEUE` and `#### REQUEST — …` were
  // both invisible to the first version.
  lines.forEach((line, i) => {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (!m) return;
    const raw = m[1].trim();
    const heading = raw.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const bad of FORBIDDEN_SECTIONS) {
      if (heading.startsWith(bad)) {
        problems.push(`${FILE}:${i + 1} — the section heading "${raw}" is back.`);
        return;
      }
    }
    for (const bad of FORBIDDEN_BLOCKS) {
      if (heading === bad || heading.startsWith(bad + ' ')) {
        problems.push(`${FILE}:${i + 1} — "${raw}" is a queue BLOCK heading. Work goes in an issue, not here.`);
        return;
      }
    }
  });

  // The warning the pointer must always carry. A orchestrator once concluded the project
  // was idle from an empty queue while ~20 jobs sat in the backlog.
  if (!/empty/i.test(text) || !/backlog/i.test(text)) {
    problems.push(`${FILE} must keep the "an empty issue list is not proof there is no work" warning, pointing at HANDOFF.md ## BACKLOG and HANDOFF.d/.`);
  }

  if (problems.length) {
    console.error('FAIL: the orchestrator queue is growing back.\n');
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
