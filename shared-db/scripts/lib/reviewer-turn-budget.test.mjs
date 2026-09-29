// Issue #2492 — grok-4.6 produced no verdict on large migrations.
//
// Every assertion here is about the FAILURE that was observed, not about the
// feature existing. The two sizes in the fixtures are the two real occurrences:
// PR #2490 (914 lines) finished inside the wrapper's 20-turn default and PR #2409
// (1798 lines) did not.
//
//   node --test scripts/lib/reviewer-turn-budget.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  GROK_WRAPPER,
  TURN_BUDGET_POLICY,
  changedMigrationLines,
  turnBudgetDiagnostic,
  turnBudgetFor,
  turnPolicyFor,
  withTurnBudget,
  wrapperBaseName,
} from './reviewer-turn-budget.mjs'

const POLICY = TURN_BUDGET_POLICY[GROK_WRAPPER]
const SMALL = 914   // PR #2490 — succeeded on the wrapper default
const LARGE = 1798  // PR #2409 — returned no recordable terminal verdict, three times

test('reviewer budget CI retains current-main authority tests', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/migration-author-lease.yml', import.meta.url), 'utf8')
  assert.match(workflow, /scripts\/lib\/required-check-authority\.test\.mjs/)
  assert.match(workflow, /scripts\/lib\/reviewer-turn-budget\.test\.mjs/)
})

test('the wrapper default is never LOWERED for any review', () => {
  for (const lines of [0, 1, SMALL, LARGE, 100000, null, undefined, -5, NaN]) {
    assert.ok(turnBudgetFor(lines, POLICY) >= POLICY.base, `a ${lines}-line review must not get fewer than ${POLICY.base} turns`)
  }
})

test('the size that FAILED gets a materially larger budget than the size that passed', () => {
  const small = turnBudgetFor(SMALL, POLICY)
  const large = turnBudgetFor(LARGE, POLICY)
  assert.ok(large > small, 'the 1798-line migration must not be given the same budget that already failed on it')
  assert.ok(large > POLICY.base, 'the 1798-line migration must not be given the 20-turn default that failed three times')
})

test('the budget is capped, so a pathological diff cannot ask for an unbounded run', () => {
  assert.equal(turnBudgetFor(10 ** 9, POLICY), POLICY.cap)
})

test('an UNMEASURABLE size is treated as large, never as small', () => {
  assert.equal(turnBudgetFor(null, POLICY), POLICY.unmeasured)
  assert.ok(POLICY.unmeasured > POLICY.base, 'unknown size must not fall back to the budget that failed')
})

test('a grok review is launched with an explicit turn budget', () => {
  const decision = withTurnBudget('C:/tools/ai-grok-review.cmd', ['new', 'session', '--prompt-file', 'brief.md'], LARGE)
  assert.equal(decision.applied, true)
  const index = decision.args.indexOf('--max-turns')
  assert.ok(index > 0, 'the wrapper must receive --max-turns')
  assert.equal(decision.args[index + 1], String(turnBudgetFor(LARGE, POLICY)))
  assert.deepEqual(decision.args.slice(0, 4), ['new', 'session', '--prompt-file', 'brief.md'], 'the governed argument list is only appended to')
})

test('an operator who set --max-turns is NOT overridden', () => {
  const decision = withTurnBudget(GROK_WRAPPER, ['new', 'session', '--max-turns', '7'], LARGE)
  assert.equal(decision.applied, false)
  assert.equal(decision.args.filter((arg) => arg === '--max-turns').length, 1)
  assert.match(decision.reason, /the caller supplied its own --max-turns/)
})

test('an equals-form operator bound is preserved in the wrapper-supported spelling', () => {
  const decision = withTurnBudget(GROK_WRAPPER, ['new', 'session', '--max-turns=30'], LARGE)
  assert.equal(decision.applied, false)
  assert.deepEqual(decision.args, ['new', 'session', '--max-turns', '30'])
  assert.match(decision.reason, /the caller supplied its own --max-turns/)
})

test('a wrapper with no per-call turn contract is left exactly as it is', () => {
  for (const wrapper of ['ai-glm', 'ai-codex-review', 'ai-muse']) {
    assert.equal(turnPolicyFor(wrapper), null)
    const args = ['review']
    const decision = withTurnBudget(wrapper, args, LARGE)
    assert.equal(decision.applied, false)
    assert.deepEqual(decision.args, args)
  }
})

test('the Windows shim paths the runner actually resolves still find the policy', () => {
  assert.equal(wrapperBaseName('/usr/local/bin/ai-grok-review'), 'ai-grok-review')
  for (const path of [
    'C:\\Users\\x\\.local\\bin\\ai-grok-review.cmd',
    'C:\\Users\\x\\.local\\bin\\AI-Grok-Review.CMD',
    'C:/tools/ai-grok-review.cmd',
    'ai-grok-review',
  ]) {
    assert.equal(turnPolicyFor(path), POLICY, `${path} must not lose its turn budget over a path shape`)
  }
})

test('measuring the size can NEVER throw, whatever git does', () => {
  for (const run of [
    () => { throw new Error('not a git repository') },
    () => undefined,
    () => 'not-a-sha\n',
    () => null,
  ]) {
    assert.equal(changedMigrationLines({ worktree: 'C:/review' }, run), null)
  }
})

test('added and removed migration lines both count as reading load', () => {
  const run = (_git, args) => (args.includes('merge-base') ? 'abc1234\n' : '1200\t598\tsupabase/migrations/x.sql\n-\t-\tsupabase/migrations/blob.bin\n')
  assert.equal(changedMigrationLines({ worktree: 'C:/review' }, run), LARGE)
})

test('the refusal names the budget the reviewer was actually given', () => {
  const decision = withTurnBudget(GROK_WRAPPER, ['new', 'session'], LARGE)
  const text = turnBudgetDiagnostic(decision)
  assert.match(text, new RegExp(`${decision.budget} turn`))
  assert.match(text, new RegExp(`${LARGE} changed migration line`))
  assert.equal(turnBudgetDiagnostic(null), '', 'a review with no sized budget adds nothing to the refusal')
})

test('a small governed review gets at least the unmeasured grant (PR #3734: 24 lines got 25 turns and ran out)', () => {
  for (const lines of [0, 24, 250, 1000]) {
    assert.ok(turnBudgetFor(lines, POLICY) >= POLICY.unmeasured, `${lines} lines must not get fewer turns than an unknown size`)
  }
  assert.equal(turnBudgetFor(24, POLICY), 40)
  assert.ok(turnBudgetFor(1798, POLICY) > 40, 'large reviews still scale above the floor')
  assert.equal(turnBudgetFor(10 ** 9, POLICY), POLICY.cap, 'the cap stays bounded')
})
