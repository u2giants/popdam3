// Issue #3187 (Refs #2773): wire-level proof that normal reviewer assignment and
// replacement stay within 10 GitHub API requests. The real CLI runs in a child
// process with every gh/git call answered by scripts/test-fixtures/github-wire-fake.mjs,
// which logs one row per call. A `gh api --paginate` invocation is logged once; a
// listing longer than 100 rows costs one more request per extra page in real life.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const cli = path.join(here, 'manage-migration-author-lanes.mjs')
const fake = pathToFileURL(path.join(here, 'test-fixtures', 'github-wire-fake.mjs')).href
const HEAD = 'a'.repeat(40), MAIN = 'b'.repeat(40), TREE = 'c'.repeat(40)
const LIMIT = 10

function seed(file) {
  const scope = 'work\n\n```db-work-scope\nstatus: ready\nwork_type: repo-maintenance\nroute: repo-maintenance\nchange_type: workflow\npriority: 550\ndepends_on:\nwrites:\n```\n'
  writeFileSync(file, JSON.stringify({
    refs: { 'refs/heads/main': MAIN, 'refs/db-coordination/reviewer-index-cutover': MAIN },
    commits: { [MAIN]: { message: 'main', tree: TREE, parents: [] }, [HEAD]: { message: 'head', tree: TREE, parents: [MAIN] } },
    prs: { 9002: { state: 'open', head: HEAD, files: [{ filename: 'scripts/example.mjs', status: 'modified' }], closing: [9001], body: 'Closes #9001' } },
    issues: { 9001: { state: 'open', title: 'tooling', body: scope, labels: [] } },
  }))
}

function run(dir, args) {
  const state = path.join(dir, 'state.json'), log = path.join(dir, 'log.txt')
  rmSync(log, { force: true })
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', timeout: 180000,
    env: { ...process.env, WIRE_STATE: state, WIRE_LOG: log, NODE_OPTIONS: `--import ${fake}`, GH_TOKEN: 'wire-fixture-no-network', GIT_TERMINAL_PROMPT: '0', SHARED_DB_AUTHOR_ENGINE: 'claude' },
  })
  const rows = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
  const api = rows.filter((row) => row.kind === 'rest' || row.kind === 'graphql')
  return { status: result.status, output: `${result.stdout}\n${result.stderr}`, api }
}

const common = ['--issue', '9001', '--pr', '9002', '--head-sha', HEAD]
const failure = [...common, '--failed-sequence', '1', '--failure-code', 'provider_unavailable', '--confirm-no-verdict', '--confirm-no-artifact']


// Issue #3206 (Refs #2773): the idempotent retry of an assignment and both silent-reclaim
// routes are proved on the same wire. Commit dates and the probe's observed-at are moved
// back in the fake's model so the real age guards pass without weakening them.
function backdate(dir, probeObservedAt) {
  const file = path.join(dir, 'state.json'), state = JSON.parse(readFileSync(file, 'utf8'))
  for (const commit of Object.values(state.commits)) {
    commit.date = '2026-09-16T00:00:00Z'
    if (probeObservedAt && /silence-probe/.test(commit.message)) commit.message = commit.message.replace(/observed-at=\S+/, `observed-at=${probeObservedAt}`)
  }
  writeFileSync(file, JSON.stringify(state))
}

function within(name, { status, output, api }) {
  assert.equal(status, 0, `${name} failed:\n${output.slice(-1500)}`)
  assert.ok(api.length <= LIMIT, `${name} used ${api.length} API requests:\n${api.map((row) => `${row.kind} ${row.label}`).join('\n')}`)
  assert.ok(!api.some((row) => /rate_limit/.test(row.label)), `${name} made an explicit quota request`)
  return api.length
}



