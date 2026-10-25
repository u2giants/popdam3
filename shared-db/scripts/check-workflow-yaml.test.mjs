// Guard: every .github/workflows/*.yml|*.yaml parses as real YAML and no
// conflict marker sits at column 0 (2026-10-23 incident: markers committed
// into tools-offline-tests.yml created ZERO jobs for every event and no
// check ever went red — see scripts/check-workflow-yaml.mjs).
//
// Run: node --test scripts/check-workflow-yaml.test.mjs
//
// The acceptance battery below was pinned against libyaml (PyYAML 6
// safe_load): every `ok` case parses under libyaml, every `refuse` case is
// refused by it. The vendored parser must agree, or the guard would either
// block healthy workflows or wave through the broken ones.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseWorkflowYaml,
  WorkflowYamlError,
  findConflictMarkers,
  checkWorkflowText,
  checkWorkflowDirectory,
} from './check-workflow-yaml.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REAL_DIR = path.resolve(HERE, '..', '.github', 'workflows')

const VALID = {
  'plain mapping': 'name: Test\non: push\n',
  'nested mapping and sequence': 'jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n',
  'sequence at the same indent as its key': 'key:\n- a\n- b\n',
  'block literal with chomping and comment': 'run: |\n  echo hi\n# done\n',
  'block folded header with comment': 'a: > # fold\n  x\n  y\n',
  'block scalar indent indicator': 'a: |2\n    x\n',
  'quoted values with escapes': 'a: "x\\ny"\nb: \'it\'\'s\'\n',
  'double-quoted key with spaces': '"a b": c\n',
  'flow sequence with trailing comma': 'a: [1, 2, ]\n',
  'multi-line flow collection': 'a: [1,\n  2]\n',
  'empty flow collections': 'a: {}\nb: []\n',
  'flow map with glued colon': 'a: {b:c}\n',
  'flow single-pair mapping in a sequence': 'a: [b: c]\n',
  'colon without space stays scalar content': 'image: registry.example.com:5000/x\n',
  'hash without preceding space stays content': 'a: x#y\n',
  'trailing comment': 'a: x # y\n',
  'multi-line plain scalar': 'key: foo\n  bar\n',
  'multi-line plain in a sequence item': '- foo\n  bar\n',
  'dash alone and nested dash': 'steps:\n  -\n  - x\na:\n  - - 1\n',
  'mapping inside sequence item': 'a:\n  - b: 1\n    c: 2\n',
  'block scalar inside sequence item': 'a:\n  - |\n    x\n    y\n',
  'plain key containing spaces and a quote': 'echo "foo: bar\n',
  'anchor and alias': 'a: &x 1\nb: *x\n',
  'tag': 'a: !!str 5\n',
  'duplicate keys are valid YAML': 'a: 1\na: 2\n',
  'document separators': '---\na: 1\n...\n',
  'empty and comment-only documents': ['', '# just a comment\n'],
  'multi-line quoted scalar': 'a: "one\n  two"\n',
  'complex key': '? complex\n: v\n',
  'CRLF line endings': 'a: 1\r\nb: 2\r\n',
  'expression-looking plain scalar': 'if: ${{ contains(fromJSON(\'["pull_request"]\'), github.event_name) }}\n',
  'empty quoted key': '"": v\n',
}

const INVALID = {
  'colon-space inside an unquoted value': 'run: echo "foo: bar"\n',
  'colon-space inside an expression value': "if: ${{ contains(x, 'a: b') }}\n",
  'value ending with a colon': 'run: make build:\n',
  'tab in indentation': 'a:\n\tb: 1\n',
  'continuation line carrying a mapping colon': 'key: foo\n  bar: baz\n',
  'stray sequence entry after a mapping entry': 'a: 1\n- x\n',
  'empty plain key': ': v\n',
  'bad block scalar indicator': 'a: |x\n  y\n',
  'content after a flow collection': 'a: [1] junk\n',
  'content after a closing quote': "a: 'abc' junk\n",
  'unterminated double quote': 'a: "abc\n',
  'unterminated single quote': "a: 'abc\n",
  'unclosed flow sequence': 'a: [1, 2\n',
  'bad indentation of a mapping entry': 'a: 1\n  b: 2\n',
  'stray content after the document node': 'a: 1\njunk line here\n',
}

for (const [name, text] of Object.entries(VALID)) {
  test(`parser accepts: ${name}`, () => {
    assert.doesNotThrow(() => parseWorkflowYaml(text), `expected VALID YAML to parse: ${JSON.stringify(text)}`)
  })
}

for (const [name, text] of Object.entries(INVALID)) {
  test(`parser refuses: ${name}`, () => {
    assert.throws(() => parseWorkflowYaml(text), WorkflowYamlError, `expected INVALID YAML to be refused: ${JSON.stringify(text)}`)
  })
}

test('parser produces the structure it claims to', () => {
  const value = parseWorkflowYaml('name: Test\njobs:\n  build:\n    steps:\n      - name: One\n        run: |\n          echo "hi"\n      - two\n')
  assert.equal(value.name, 'Test')
  assert.deepEqual(Object.keys(value.jobs.build.steps), ['0', '1'])
  assert.equal(value.jobs.build.steps[0].name, 'One')
  assert.equal(value.jobs.build.steps[0].run, 'echo "hi"')
  assert.equal(value.jobs.build.steps[1], 'two')
})

test('conflict markers are detected on raw lines, column 0 only', () => {
  const text = ['name: Test', '<<<<<<< HEAD', 'a: 1', '=======', 'b: 2', '>>>>>>> branch', 'c: 3'].join('\n')
  const markers = findConflictMarkers(text)
  assert.equal(markers.length, 3)
  assert.deepEqual(markers.map((m) => [m.line, m.kind]), [
    [2, 'conflict-ours'],
    [4, 'conflict-separator'],
    [6, 'conflict-theirs'],
  ])
  // Indented marker-like content (block scalar bodies) is not a marker.
  assert.deepEqual(findConflictMarkers('run: |\n  >>>> not a marker\n'), [])
})

test('checkWorkflowText refuses a marker-corrupted workflow and names the marker lines', () => {
  const clean = 'name: Tools Offline Tests\non:\n  push:\n    branches: [main]\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n'
  const corrupted = clean.replace(
    'jobs:',
    ['<<<<<<< HEAD', 'jobs:', '=======', 'jobs-old:', '>>>>>>> other'].join('\n'),
  )
  assert.deepEqual(checkWorkflowText('tools-offline-tests.yml', clean), [])
  const problems = checkWorkflowText('tools-offline-tests.yml', corrupted)
  const markerProblems = problems.filter((p) => p.message.includes('conflict marker'))
  assert.equal(markerProblems.length, 3, 'all three marker lines are reported')
  assert.ok(markerProblems.some((p) => p.line === 5 && p.message.includes('ours')))
  assert.ok(markerProblems.some((p) => p.line === 7 && p.message.includes('separator')))
  assert.ok(markerProblems.some((p) => p.line === 9 && p.message.includes('theirs')))
})

test('the real .github/workflows directory passes the guard', () => {
  const result = checkWorkflowDirectory(REAL_DIR)
  assert.deepEqual(result.problems, [])
  assert.ok(result.ok)
  assert.ok(result.files.length >= 40, `expected the real workflow directory to be non-trivial (found ${result.files.length})`)
})

test('a marker-corrupted COPY of the real directory is refused (never touch the real files)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-yaml-guard-'))
  const victim = path.join(tmp, 'tools-offline-tests.yml')
  fs.copyFileSync(path.join(REAL_DIR, 'tools-offline-tests.yml'), victim)
  fs.writeFileSync(victim, fs.readFileSync(victim, 'utf8').replace('jobs:', '<<<<<<< HEAD\njobs:\n=======\njobs-x:\n>>>>>>> side\n'))
  const result = checkWorkflowDirectory(tmp)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((p) => p.file === 'tools-offline-tests.yml' && p.message.includes('conflict marker')))
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('an empty workflow directory is refused, not a vacuous pass', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-yaml-guard-'))
  const result = checkWorkflowDirectory(tmp)
  assert.equal(result.ok, false)
  assert.ok(result.problems[0].message.includes('vacuous'))
  fs.rmSync(tmp, { recursive: true, force: true })
})
