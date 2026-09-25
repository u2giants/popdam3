#!/usr/bin/env node
// Guard: the throughput brief of AGENTS.md 5.0-C (issue #3002) must stay present AND must never
// be edited into a licence to review less.
//
// The brief exists because sessions serialised CI and the governed review and re-pushed per
// finding, roughly doubling wall-clock per pull request. The fix is to run the two in parallel and
// batch fixes into one head. The danger is the obvious "next" optimisation: widening exact-head
// approval so a review survives later changes. That is reviewing less, not reviewing faster, and
// this guard refuses it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BRIEF_FILE = 'AGENTS.md';
export const BRIEF_HEADING = '### 5.0-C Run CI and the governed review in PARALLEL, and batch fixes into ONE head';

/** Every instruction the brief must still give. Losing one re-serialises the pipeline. */
export const REQUIRED_CLAUSES = Object.freeze([
  { name: 'parallel-review-start', pattern: /start the governed review as soon as a head is pushed, in parallel with\s+ci/i },
  { name: 'batched-fixes', pattern: /batch fixes into a single new head/i },
  { name: 'one-push-per-finding-forbidden', pattern: /one push per\s+finding is forbidden/i },
  { name: 'wait-inside-the-turn', pattern: /hold the wait inside the turn/i },
  { name: 'exact-head-preserved', pattern: /the exact-head approve requirement stands exactly as enforced by\s+`scripts\/check-exact-head-approval\.mjs`/i },
  { name: 'earlier-head-not-authorized', pattern: /a review\s+bound to an earlier head does not authorize a later head/i },
  { name: 'equivalence-stays-narrow', pattern: /pr-content-equivalence\.mjs/i },
  { name: 'equivalence-bound-to-agent-only', pattern: /byte-identical, ignoring only `\.agent\/` evidence files/i },
  { name: 'no-check-becomes-optional', pattern: /no required check becomes optional/i },
  { name: 'no-gate-skipped-no-reviewer-dropped', pattern: /no gate is skipped, and no reviewer\s+requirement is dropped/i },
  { name: 'test-evidence-widening-refused', pattern: /test or evidence files is refused/i },
  { name: 'parallelise-do-not-delete', pattern: /parallelise; do not delete/i },
]);

/** Language that would turn a throughput edit into a weaker gate. Any hit fails the check. */
export const FORBIDDEN_CLAUSES = Object.freeze([
  // `(?<!no )` keeps the brief's own negated promise ("No required check becomes optional")
  // from tripping the guard, while any affirmative rewording still does.
  { name: 'optional-required-check', pattern: /(?<!no )(required|ci) checks? (may|can|is|are|were|becomes?|become|turn)[^.\n]{0,40}optional/i },
  { name: 'skippable-review', pattern: /(skip|waive|bypass|drop) the (governed )?review/i },
  // Matches both "An approval of an earlier head still authorizes …" and the brief's own
  // subject shape inverted ("A review bound to an earlier head still authorizes …").
  // `(?<!not )` keeps the live negated sentence ("does not authorize") from tripping.
  { name: 'stale-approval-accepted', pattern: /(approve|approval|review) (of|for|at|bound to) an? (earlier|older|previous|prior) head[^.\n]{0,40}(?<!not )authoriz/i },
  { name: 'widened-equivalence', pattern: /ignor(ing|es) (only )?(`)?\.agent(`)?[^.\n]*\band tests?\b/i },
]);

export function briefSection(text) {
  const start = text.indexOf(BRIEF_HEADING);
  if (start < 0) throw new Error(`${BRIEF_FILE} is missing the review-parallelism brief: ${BRIEF_HEADING}`);
  const rest = text.slice(start + BRIEF_HEADING.length);
  const end = rest.search(/\n### /);
  return rest.slice(0, end < 0 ? rest.length : end);
}

export function checkBrief(text) {
  const section = briefSection(text);
  for (const clause of REQUIRED_CLAUSES) if (!clause.pattern.test(section)) throw new Error(`review-parallelism brief no longer states "${clause.name}"; throughput may not be bought by reviewing less`);
  for (const clause of FORBIDDEN_CLAUSES) if (clause.pattern.test(section)) throw new Error(`review-parallelism brief now weakens a safeguard ("${clause.name}"); parallelise, do not delete`);
  return `review-parallelism brief OK: ${REQUIRED_CLAUSES.length} required clauses present, ${FORBIDDEN_CLAUSES.length} weakening patterns absent`;
}

export function run(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  return checkBrief(fs.readFileSync(path.join(root, BRIEF_FILE), 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(run()); } catch (error) { console.error(error.message); process.exit(1); }
}
