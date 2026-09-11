// Proving the transport conformance check can FAIL (issue #2342).
//
// A guard that has only ever seen clean input has not been tested. The
// repository is clean today, so a test that only scanned the real tree would
// pass identically whether the checker works or is a stub that returns []. Every
// assertion below therefore starts from a KNOWN-DIRTY synthetic tree containing
// each forbidden shape, and only then asserts anything about the real tree.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TRANSPORT_MODULE,
  TREE_MODULE,
  isTestFile,
  scanNodeSource,
  isWorkflowWrite,
  stripHeredocBodies,
  joinContinuations,
  scanWorkflow,
  findViolations,
  repositoryFiles,
  explain,
  main,
} from './check-github-transport-conformance.mjs'

// ---------------------------------------------------------------------------
// A known-dirty tree: one of every shape the checker must refuse.
// ---------------------------------------------------------------------------
const DIRTY = {
  'scripts/ninth-wrapper.mjs': [
    "import { execFileSync } from 'node:child_process'",
    "const out = execFileSync('gh', ['api', 'repos/o/r/pulls/1'], { encoding: 'utf8' })",
  ].join('\n'),
  'scripts/shelling-out.mjs': [
    'const raw = execSync(`gh api repos/${owner}/${repo}/contents/${file}`)',
  ].join('\n'),
  'scripts/spawn-sync-wrapper.cjs': [
    "const r = spawnSync('gh', ['pr', 'view', '1', '--json', 'headRefOid'])",
  ].join('\n'),
  'scripts/per-file-contents.mjs': [
    'const sql = readAtRef(',
    '  `repos/${repo}/contents/${encodeURI(file.filename)}?ref=${ref}`,',
    ')',
  ].join('\n'),
  '.github/workflows/bare-read.yml': [
    '      - run: |',
    '          set -euo pipefail',
    '          sha="$(gh api "repos/o/r/pulls/1" --jq .head.sha)"',
  ].join('\n'),
}

const dirtyReader = (rel) => {
  if (!(rel in DIRTY)) throw new Error(`test asked for a file it did not define: ${rel}`)
  return DIRTY[rel]
}

test('the checker refuses a known-dirty tree — every forbidden shape is caught', () => {
  const findings = findViolations({ files: Object.keys(DIRTY), readFile: dirtyReader })
  const byFile = new Map(findings.map((f) => [f.file, f]))

  assert.equal(byFile.get('scripts/ninth-wrapper.mjs')?.rule, 'node-gh-spawn')
  assert.equal(byFile.get('scripts/shelling-out.mjs')?.rule, 'node-gh-shell')
  assert.equal(byFile.get('scripts/spawn-sync-wrapper.cjs')?.rule, 'node-gh-spawn')
  assert.equal(byFile.get('.github/workflows/bare-read.yml')?.rule, 'workflow-gh-api-read')
  assert.equal(byFile.get('scripts/per-file-contents.mjs')?.rule, 'node-per-file-contents-call')
  assert.equal(findings.length, 5, 'each dirty file must be reported exactly once')
})

test('the failure message names the file, the line and the remedy', () => {
  const findings = findViolations({ files: ['scripts/ninth-wrapper.mjs'], readFile: dirtyReader })
  const text = explain(findings)
  assert.match(text, /scripts\/ninth-wrapper\.mjs:2/)
  assert.match(text, /node-gh-spawn/)
  assert.match(text, new RegExp(TRANSPORT_MODULE.replace(/[/.]/g, '\\$&')))
  assert.match(text, /wrapError/, 'the remedy must say how to keep the gate’s own refusal')
})

test('main() exits non-zero on a dirty tree and zero on a clean one', () => {
  // Dirty: a synthetic root holding one offending file.
  const errors = []
  const dirty = main({
    root: 'scripts/__nonexistent__',
    log: () => {},
    err: (t) => errors.push(t),
  })
  // A root with nothing to scan must ALSO fail: a checker that silently passes
  // on an empty glob is how a green build stops meaning anything.
  assert.equal(dirty, 1)
  assert.match(errors.join('\n'), /no files to scan/)
})

// ---------------------------------------------------------------------------
// The exemptions, each of which must stay narrow.
// ---------------------------------------------------------------------------
test('requirement 4: a per-file Contents URL is refused wherever it is built', () => {
  // Not a count-based rule. "No more than one Contents call per ref" cannot be
  // enforced statically and would drift the moment a loop moved; the shape is
  // forbidden outright, and scripts/lib/github-tree.mjs is the one exemption.
  const dirty = "  `repos/${repo}/contents/${path}?ref=${ref}`,"
  assert.equal(scanNodeSource('scripts/some-gate.mjs', dirty)[0]?.rule, 'node-per-file-contents-call')
  assert.deepEqual(scanNodeSource(TREE_MODULE, dirty), [], 'the tree reader is the one permitted door')
  assert.deepEqual(scanNodeSource('scripts/some-gate.mjs', '`repos/${repo}/git/trees/${ref}?recursive=1`'), [],
    'the batched tree read is exactly what the rule asks for and must not be flagged')
})

test('the transport module itself and test files may spawn gh', () => {
  const spawnLine = "const r = spawnSync('gh', ['api', 'x'])"
  assert.deepEqual(scanNodeSource(TRANSPORT_MODULE, spawnLine), [])
  assert.deepEqual(scanNodeSource('scripts/foo.test.mjs', spawnLine), [])
  assert.ok(isTestFile('scripts/foo.test.mjs'))
  assert.ok(isTestFile('scripts/tests/helper.mjs'))
  assert.ok(!isTestFile('scripts/check-dispatch-collision.mjs'))
  // …and a normal script is still caught, so the exemption is not a hole.
  assert.equal(scanNodeSource('scripts/foo.mjs', spawnLine).length, 1)
})

test('a workflow WRITE is not demanded to go through a reader that refuses writes', () => {
  assert.ok(isWorkflowWrite('gh api "repos/o/r/statuses/$sha" -f state=failure'))
  assert.ok(isWorkflowWrite('gh api --method PATCH "repos/o/r/issues/1"'))
  assert.ok(isWorkflowWrite('gh api -X POST "repos/o/r/issues/1/comments" --input body.json'))
  assert.ok(!isWorkflowWrite('gh api "repos/o/r/pulls/1" --jq .merged'))
  // The important half: a read is still caught.
  assert.equal(scanWorkflow('w.yml', '  gh api "repos/o/r/pulls/1" --jq .merged').length, 1)
  assert.equal(scanWorkflow('w.yml', '  gh api "repos/o/r/statuses/$s" -f state=failure').length, 0)
})

test('a write split across a line continuation is still read as a write', () => {
  // This exact shape lives in shared-supabase-migrations.yml. Line-at-a-time,
  // the first line looks like a read and the demand becomes unsatisfiable.
  const text = [
    '            gh api "repos/u2giants/shared-db/statuses/$head_sha" \\',
    "              -f state=failure \\",
    "              -f context='Migration guarded merge authorization'",
  ].join('\n')
  assert.deepEqual(scanWorkflow('w.yml', text), [])
  const joined = joinContinuations(text)
  assert.equal(joined.length, 1)
  assert.equal(joined[0].line, 1, 'the finding must point at the first line of the command')
})

test('a gh api inside a heredoc BODY is prose, not a command', () => {
  const text = [
    '          cat <<BODY > issue.md',
    '          To check this by hand, run:',
    '            gh api "repos/o/r/pulls/1" --jq .merged',
    '          BODY',
    '          gh api "repos/o/r/issues/2" --jq .state',
  ].join('\n')
  const findings = scanWorkflow('w.yml', text)
  assert.equal(findings.length, 1, 'only the executed call is a violation')
  assert.equal(findings[0].line, 5)
  assert.match(stripHeredocBodies(text).split('\n')[2], /^$/, 'the body line is blanked')
})

test('a quoted heredoc token and an indented <<- closer are both honoured', () => {
  const text = [
    "          cat <<-'EOF'",
    '            gh api "repos/o/r/x"',
    '          EOF',
  ].join('\n')
  assert.deepEqual(scanWorkflow('w.yml', text), [])
})

// ---------------------------------------------------------------------------
// Only after the checker is proven able to fail is the real tree asserted on.
// ---------------------------------------------------------------------------
test('the real repository is conformant', () => {
  const files = repositoryFiles()
  assert.ok(files.length > 50, `expected a populated tree, scanned ${files.length}`)
  assert.ok(files.includes(TRANSPORT_MODULE), 'the transport module must be in the scanned set')
  assert.equal(main({ log: () => {}, err: (t) => assert.fail(t) }), 0)
})
