// Runs the historical recovery step's OWN mode guard, under a real shell.
//
// WHY THIS FILE EXISTS
// --------------------
// A preview dispatch instruction that says nothing about `mode` is dispatched
// against a workflow whose `mode` input DEFAULTS TO dry-run. Issue #2796: run
// 34633793571 was dispatched exactly as stored, succeeded, and uploaded only
// `preview-migration-dry-run-120fb6125907386ce2b93bd9ae0a91de700fb738`. Nothing
// was applied, yet the run is green, and a green preview run is what downstream
// lanes read as proof. Success-shaped emptiness.
//
// The historical lane is the worst case, because at mode=dry-run it runs NEITHER
// side of the work: "Recover proof for migrations already present on preview" is
// gated on `inputs.mode == 'apply'`, and "Bounded dry-run" excludes historical
// inputs. The step therefore proves nothing at all and exits 0. AGENTS.md 4 says
// "Historical recovery is apply-only; historical dry-run proves nothing", and
// plan_orchestrator_throughput_phase_2.md anticipates this very change: "A future
// workflow-level hard refusal is a separate hardening change."
//
// THE GUARD MUST BE ABLE TO REFUSE, AND MUST STILL PERMIT. A guard that passes
// everything is indistinguishable from a guard that passes everything for the
// wrong reason, so this file asserts BOTH directions and then deliberately
// sabotages the predicate to prove the refusal is real. The repository has
// shipped checks whose own predicate was inverted; an inverted predicate here
// would report "apply" as refused and "dry-run" as fine, so the permitted case
// is tested as hard as the refused one.
//
// The block between the markers is free of `gh`, network and repository state,
// which is what makes it runnable here.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW = path.join(repoRoot, '.github/workflows/shared-supabase-migrations.yml')
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
const bashCommand = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash'

/** The exact shell the workflow runs, dedented, with nothing added or removed. */
function modeGuardBlock() {
  const text = readFileSync(WORKFLOW, 'utf8')
  const begin = text.indexOf('# >>> BEGIN historical-mode-guard')
  const end = text.indexOf('# <<< END historical-mode-guard')
  assert.ok(begin !== -1, 'the historical-mode-guard BEGIN marker is missing from the workflow')
  assert.ok(end > begin, 'the historical-mode-guard END marker is missing or out of order')
  const lines = text.slice(text.indexOf('\n', begin) + 1, end).split('\n')
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length))
  return lines.map((l) => l.slice(indent)).join('\n')
}

/** Execute the workflow's own guard for one mode value. */
function runGuard(mode, block = modeGuardBlock()) {
  const env = { ...process.env }
  delete env.MODE
  if (mode !== undefined) env.MODE = mode
  return spawnSync(bashCommand, ['-c', `set -euo pipefail\n${block}\nprintf 'REACHED_THE_WORK\\n'`], {
    encoding: 'utf8',
    env,
  })
}

const REFUSAL = /REFUSED: historical preview recovery is apply-only/

test('a historical dispatch at the mode input default is REFUSED, not silently green', () => {
  // `dry-run` is the workflow input's own default, so this is precisely what a
  // stored instruction that omits mode produces when dispatched verbatim.
  const run = runGuard('dry-run')
  assert.notEqual(run.status, 0, 'a historical dry-run was accepted; it would prove nothing and still report success')
  assert.match(run.stderr, REFUSAL)
  assert.ok(!run.stdout.includes('REACHED_THE_WORK'), 'the step continued past the guard after refusing')
})

test('the refusal names the mode it was given, so the run output alone tells the two apart', () => {
  assert.match(runGuard('dry-run').stderr, /mode='dry-run'/)
  // An entirely absent input must not read as an empty-and-therefore-fine value.
  const missing = runGuard(undefined)
  assert.notEqual(missing.status, 0, 'an unset mode was accepted')
  assert.match(missing.stderr, REFUSAL)
})

test('the legitimate case is still permitted: mode=apply passes through', () => {
  // THE OTHER HALF OF THE PROOF. If this ever fails, the guard is inverted and
  // the apply-only lane has been made undispatchable -- a guard that refuses
  // everything is as broken as one that refuses nothing.
  const run = runGuard('apply')
  assert.equal(run.status, 0, `mode=apply was refused: ${run.stderr}`)
  assert.ok(run.stdout.includes('REACHED_THE_WORK'), 'mode=apply did not reach the work below the guard')
  assert.ok(!REFUSAL.test(run.stderr), 'mode=apply printed the refusal')
})

test('an inverted predicate is caught rather than reported as a passing guard', () => {
  // Sabotage: flip the comparison. The saboteur's guard "passes" its own happy
  // path while refusing the only mode the lane is allowed to run in. Both
  // directions are asserted, so the inversion cannot hide behind either one.
  const sabotaged = modeGuardBlock().replace('!= "apply"', '= "apply"')
  assert.notEqual(sabotaged, modeGuardBlock(), 'the sabotage did not apply; the guard predicate changed shape')
  assert.notEqual(runGuard('apply', sabotaged).status, 0, 'an inverted guard still accepted apply')
  assert.equal(runGuard('dry-run', sabotaged).status, 0, 'the sabotage did not actually invert the guard')
})

test('a deleted guard fails this test rather than silently stopping to protect the lane', () => {
  // The failure shape this whole issue is about is a check that quietly stops
  // checking. Removing the guard must break something loudly.
  const removed = modeGuardBlock().replace(/if \[ "\$\{MODE:-\}" != "apply" \]; then[\s\S]*?fi/, ':')
  assert.notEqual(removed, modeGuardBlock(), 'the guard no longer has the shape this test can remove; update the test')
  assert.equal(runGuard('dry-run', removed).status, 0)
  // ...which is exactly the pre-#2796 behaviour, and exactly what must never ship.
})

test('the guard block stays runnable: no gh, no network, no repository state', () => {
  const block = modeGuardBlock()
  for (const forbidden of ['gh ', 'curl', 'git ']) {
    assert.ok(!block.includes(forbidden), `the mode-guard block must not use ${forbidden.trim()}; move it below the END marker`)
  }
})

test('the workflow still defaults mode to dry-run, which is why the guard is required', () => {
  // If this ever changes, the reasoning above needs rereading -- but the guard
  // stays either way, because an explicit dry-run is equally unprovable here.
  const text = readFileSync(WORKFLOW, 'utf8')
  assert.match(text, /default: dry-run/, 'the mode input no longer defaults to dry-run')
})

test('Windows executes the workflow shell through supported Git Bash', () => {
  if (process.platform === 'win32') {
    assert.equal(bashCommand, gitBash)
    assert.ok(existsSync(bashCommand), 'Git Bash is required to execute the workflow shell on Windows')
  } else {
    assert.equal(bashCommand, 'bash')
  }
})
