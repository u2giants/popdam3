// Runs the post-merge rehearsal step's OWN map-parsing shell, under a real shell.
//
// WHY THIS FILE EXISTS
// --------------------
// On 2026-08-21 the "Prove the post-merge rehearsal source" step parsed
// `merged_preview_source_pr_map` with
//
//     ... | tr ',' '\n' | sed 's/.*://' | tr -d '[:space:]' | sort -u
//
// `[:space:]` includes the NEWLINE, so the final `tr` glued the six PR numbers
// back into the single token 40811081142114512561347. `sort -u` saw one line,
// the loop ran ONCE, and `gh api .../pulls/40811081142114512561347` 404'd. Under
// `set -euo pipefail` the step died there, so not one of the step's REFUSED
// messages was ever printed (runs 32481867839 and 32482067440).
//
// Every JavaScript test passed throughout, because the defect was never in
// JavaScript. A loop that silently processes one thing instead of six is exactly
// the failure shape this repository refuses to ship twice, so the shell itself is
// now under test: the block between the `>>> BEGIN map-parse` and `<<< END
// map-parse` markers is lifted out of the workflow and executed.
//
// The block is deliberately free of `gh`, network and repository state, which is
// what makes it runnable here. If someone moves a `gh` call inside the markers,
// these tests fail loudly rather than quietly stopping to cover the parse.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW = path.join(repoRoot, '.github/workflows/shared-supabase-migrations.yml')

/** The exact shell the workflow runs, dedented, with nothing added or removed. */
function mapParseBlock() {
  const text = readFileSync(WORKFLOW, 'utf8')
  const begin = text.indexOf('# >>> BEGIN map-parse')
  const end = text.indexOf('# <<< END map-parse')
  assert.ok(begin !== -1, 'the map-parse BEGIN marker is missing from the workflow')
  assert.ok(end > begin, 'the map-parse END marker is missing or out of order')
  const lines = text.slice(text.indexOf('\n', begin) + 1, end).split('\n')
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length))
  return lines.map((l) => l.slice(indent)).join('\n')
}

/**
 * Execute the workflow's own parse for one map string and report what it did.
 * `set -euo pipefail` matches the step, so a failure here is a failure there.
 */
function runParse(sourceMap) {
  const script = [
    'set -euo pipefail',
    mapParseBlock(),
    'printf "PARSED:%s\\n" "$(printf \'%s\' "$MAP_PRS" | tr \'\\n\' \' \')"',
    'printf "COUNT:%s\\n" "$MAP_PR_COUNT"',
    'printf "LAST:%s\\n" "$MAP_LAST_PR"',
  ].join('\n')
  const result = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, SOURCE_MAP: sourceMap },
  })
  const read = (key) => (result.stdout.match(new RegExp(`^${key}:(.*)$`, 'm')) ?? [])[1]
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    prs: (read('PARSED') ?? '').trim().split(/\s+/).filter(Boolean),
    count: read('COUNT'),
    last: read('LAST'),
  }
}

// THE REGRESSION. This exact string is the FRIENDS TV / FR ship set that
// AGENTS.md 6.5 requires to move as one bounded event.
const FR_MAP = '20260802170000:408,20260817124545:1108,20260817225127:1142,20260818174350:1145,20260819151527:1256,20260820183334:1347'
const FR_PRS = ['1108', '1142', '1145', '1256', '1347', '408']

test('the FR ship set parses to SIX pull requests, not one glued token', () => {
  const run = runParse(FR_MAP)
  assert.equal(run.status, 0, `parse failed: ${run.stderr}`)
  assert.deepEqual(run.prs, FR_PRS)
  assert.equal(run.count, '6')
  // The precise shape of the shipped defect, named so a reintroduction is
  // unmistakable in the failure output rather than merely a count mismatch.
  assert.ok(!run.prs.includes('40811081142114512561347'), 'the PR numbers were glued into one token again')
})

test('the lane lock PR is the LAST entry in the map', () => {
  assert.equal(runParse(FR_MAP).last, '1347')
  // Trailing whitespace and a trailing comma must not smuggle a bad value in;
  // this is why the value is taken from the parsed entries rather than from
  // ${SOURCE_MAP##*:} directly.
  assert.equal(runParse(`${FR_MAP},`).last, '1347')
  assert.equal(runParse(`${FR_MAP}\n`).last, '1347')
  assert.equal(runParse(`${FR_MAP} `).last, '1347')
})

test('whitespace around entries is trimmed without destroying line structure', () => {
  const spaced = '20260802170000: 408, 20260817124545:1108 ,20260820183334: 1347'
  const run = runParse(spaced)
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.prs, ['1108', '1347', '408'])
  assert.equal(run.count, '3')
})

test('a single-entry map still parses to exactly one pull request', () => {
  const run = runParse('20260820183334:1347')
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.prs, ['1347'])
  assert.equal(run.count, '1')
  assert.equal(run.last, '1347')
})

test('two versions authored by the SAME pull request collapse to one, consistently', () => {
  // Deduplication is intended -- the loop proves each PR merged once. What must
  // never happen is the two parses disagreeing about how many there are.
  const run = runParse('20260802170000:408,20260817124545:408,20260820183334:1347')
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.prs, ['1347', '408'])
  assert.equal(run.count, '2')
})

test('the count guard refuses rather than proving fewer PRs than the map names', () => {
  // Re-introduce the exact shipped defect in the lifted block and prove the
  // guard catches it. This is what makes a silent one-iteration loop impossible
  // even if the parse is broken again in some new way.
  const broken = mapParseBlock().replace(
    "sed -e 's/.*://' -e 's/[[:space:]]//g' | grep -v '^$' | sort -u",
    "sed 's/.*://' | tr -d '[:space:]' | sort -u")
  assert.notEqual(broken, mapParseBlock(), 'the sabotage did not apply; the parse pipeline changed shape')
  const result = spawnSync('bash', ['-c', `set -euo pipefail\n${broken}`], {
    encoding: 'utf8',
    env: { ...process.env, SOURCE_MAP: FR_MAP },
  })
  assert.notEqual(result.status, 0, 'a glued parse was accepted')
  assert.match(result.stderr, /REFUSED: merged_preview_source_pr_map parsed to 1 pull request\(s\) but names 6/)
})

test('the parse block stays runnable: no gh, no network, no repository state', () => {
  const block = mapParseBlock()
  for (const forbidden of ['gh ', 'curl', 'git ']) {
    assert.ok(!block.includes(forbidden), `the map-parse block must not use ${forbidden.trim()}; move it below the END marker`)
  }
})
