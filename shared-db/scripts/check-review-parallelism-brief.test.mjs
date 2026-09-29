import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run, checkBrief, briefSection, BRIEF_FILE, BRIEF_HEADING, REQUIRED_CLAUSES, FORBIDDEN_CLAUSES } from './check-review-parallelism-brief.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const live = () => fs.readFileSync(path.join(repoRoot, BRIEF_FILE), 'utf8');

test('the live AGENTS.md carries the review-parallelism brief', () => {
  assert.match(run(repoRoot), /^review-parallelism brief OK: /);
});

test('an AGENTS.md without the brief is refused', () => {
  // Fails against the unfixed repository: before issue #3002 was addressed there was no brief at
  // all, so sessions kept serialising CI and the governed review.
  assert.throws(() => checkBrief(live().replace(BRIEF_HEADING, '### 5.0-C Something else entirely')), /missing the review-parallelism brief/);
});

test('dropping any single required instruction is refused', () => {
  for (const clause of REQUIRED_CLAUSES) {
    const section = briefSection(live());
    const match = section.match(clause.pattern);
    assert.ok(match, `${clause.name} must match the live brief`);
    const damaged = live().replace(section, section.replace(match[0], 'REMOVED'));
    assert.throws(() => checkBrief(damaged), new RegExp(`no longer states "${clause.name}"`), `${clause.name} must be guarded`);
  }
});

test('editing the brief into a weaker gate is refused', () => {
  // The exact reworded bypasses an independent review named as slipping past the first draft.
  const weakenings = [
    'Required checks are now optional when the matrix is slow.',
    'To go faster, skip the governed review on a small change.',
    'A review bound to an earlier head still authorizes a later head.',
    'Equivalence now ignores `.agent/` evidence files and tests, so a reviewed head survives.',
  ];
  assert.equal(weakenings.length, FORBIDDEN_CLAUSES.length);
  // Review of PR #3788: may/can phrasings must still be refused.
  weakenings.push('Required checks may be optional for small changes.', 'CI checks can turn optional on retry.', 'CI checks may become optional when the queue is long.');
  for (const weakening of weakenings) {
    const damaged = live().replace('- **Retiring a required check', `- ${weakening}\n- **Retiring a required check`);
    assert.throws(() => checkBrief(damaged), /weakens a safeguard|parallelise, do not delete/, weakening);
  }
});

test('inverting the brief\'s own earlier-head sentence is refused', () => {
  // H1: the live sentence is "A review bound to an earlier head does not authorize a later head".
  // Rewording it to "still authorizes" must fail — both because the required clause
  // `earlier-head-not-authorized` disappears and because `stale-approval-accepted` fires.
  const damaged = live().replace(
    'bound to an earlier head does not authorize a later head',
    'bound to an earlier head still authorizes a later head',
  );
  assert.throws(() => checkBrief(damaged), /no longer states "earlier-head-not-authorized"|weakens a safeguard/);
});

test('dropping the gate/reviewer half of the check-retirement bullet is refused', () => {
  // M1: "no gate is skipped, and no reviewer requirement is dropped" is a stated safety claim
  // and must be pinned, not merely share a line with the check-retirement rule.
  const damaged = live().replace('no gate is skipped, and no reviewer', 'gates may be skipped and reviewers');
  assert.throws(() => checkBrief(damaged), /no longer states "no-gate-skipped-no-reviewer-dropped"/);
});

test('the brief refuses the one proposal in #3002 that would review less', () => {
  assert.match(briefSection(live()), /test or evidence files is\s+REFUSED/);
});

test('the 2026-09-28 owner ruling replaces the no-drop promise with an evidence-and-review route', () => {
  const section = briefSection(live());
  assert.doesNotMatch(section, /no required check becomes optional/i);
  assert.match(section, /owner ruling\s+2026-09-28/);
  const damaged = live().replace('Retiring a required check is an AI decision with evidence', 'Required checks are dropped freely');
  assert.throws(() => checkBrief(damaged), /no longer states "check-retirement-needs-evidence-and-review"/);
});
