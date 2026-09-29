import test from 'node:test'
import assert from 'node:assert/strict'
import { emittedJobNames, jobBlocks, jobBlockByName, jobEvents, stepBlock } from './workflow-jobs.mjs'

const WORKFLOW = [
  'name: X',
  'on:',
  '  pull_request:',
  'jobs:',
  '  a:',
  '    name: Alpha',
  `    if: contains(fromJSON('["pull_request", "merge_group"]'), github.event_name)`,
  '    steps:',
  '      - name: First',
  '        run: echo a',
  '      - name: Second',
  '        run: exit 1',
  '  b:',
  '    name: Beta',
  "    if: github.event_name != 'issues'",
  '    steps:',
  '      - name: First',
  '        run: echo b',
  '  c:',
  '    name: Not Alpha',
  '    steps: []',
  '',
].join('\n')

test('job blocks are sliced per job and never bleed into the next', () => {
  const blocks = jobBlocks(WORKFLOW)
  assert.deepEqual([...blocks.keys()], ['a', 'b', 'c'])
  assert.ok(!blocks.get('a').includes('Beta'))
})

test('a job is found by its exact display name only', () => {
  assert.match(jobBlockByName(WORKFLOW, 'Alpha'), /^ {2}a:/)
  assert.equal(jobBlockByName(WORKFLOW, 'Alph'), null)
  assert.throws(() => jobBlockByName(`${WORKFLOW}  d:\n    name: Alpha\n`, 'Alpha'), /more than one job/)
})

test('job events read the job-level gate, and refuse to guess at other forms', () => {
  assert.deepEqual(jobEvents(jobBlockByName(WORKFLOW, 'Alpha')), ['pull_request', 'merge_group'])
  assert.equal(jobEvents(jobBlockByName(WORKFLOW, 'Beta')), "github.event_name != 'issues'")
  assert.equal(jobEvents(jobBlockByName(WORKFLOW, 'Not Alpha')), null)
  assert.equal(jobEvents('  z:\n    if: ${{ always() }}\n'), null)
  assert.equal(jobEvents('  z:\n    if: always() && x\n'), 'always() && x')
})

test('a step slice ends at the next step of the same job', () => {
  const step = stepBlock(jobBlockByName(WORKFLOW, 'Alpha'), 'First')
  assert.ok(step.includes('echo a') && !step.includes('exit 1'))
  assert.equal(stepBlock(jobBlockByName(WORKFLOW, 'Beta'), 'Second'), null)
})

test('emitted names are exact, and a lane expression emits its default', () => {
  const names = emittedJobNames("jobs:\n  a:\n    name: Not Alpha\n    # name: Alpha\n  b:\n    name: ${{ inputs.lane && format('T [lane {0}]', inputs.lane) || 'T' }}\n")
  assert.equal(names.has('Alpha'), false)
  assert.equal(names.has('T'), true)
})
