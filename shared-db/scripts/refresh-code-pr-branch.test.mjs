import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, rebindCompletion, summarizeNodeTest, refresh, RefreshError, TEST_CHECK, DIFF_CHECK } from './refresh-code-pr-branch.mjs'

test('#507(b) arguments are required and unknown options refuse with usage', () => {
  assert.throws(() => parseArgs(['--pr', '5']), /--issue <n> and --pr <n>/)
  assert.throws(() => parseArgs(['--issue', '1', '--pr', '2', '--admin']), /unknown option --admin.*Usage/)
  assert.deepEqual(parseArgs(['--issue', '1', '--pr', '2', '--worktree', 'W', '--no-push']), { issue: 1, pr: 2, worktree: 'W', push: false, assign: false })
})
test('#507(b) only re-run checks are restamped; any other check refuses', () => {
  const head = 'c'.repeat(40)
  const out = rebindCompletion({ head_sha: 'a', checks: [{ command: TEST_CHECK, exit_code: 0, evidence: 'old' }, { command: DIFF_CHECK, exit_code: 0, evidence: 'old' }] }, { head, testSummary: 'x 3/3 pass' })
  assert.equal(out.head_sha, head)
  assert.match(out.checks[0].evidence, /x 3\/3 pass at cccccccc/)
  assert.throws(() => rebindCompletion({ checks: [{ command: 'psql smoke' }] }, { head, testSummary: '' }), /cannot be re-run/)
  assert.deepEqual(summarizeNodeTest('ℹ pass 4\nℹ fail 0\nℹ skipped 1'), { pass: 4, fail: 0, skipped: 1 })
  assert.deepEqual(summarizeNodeTest('# pass 2\n# fail 0'), { pass: 2, fail: 0, skipped: 0 })
  assert.throws(() => summarizeNodeTest('nothing'), RefreshError)
})

function repo({ keyed = false } = {}) {
  const pair = keyed
    ? ['.agent/work/7/1/contract.json', '.agent/work/7/1/completion.json']
    : ['.agent/contract.json', '.agent/completion.json']
  const root = mkdtempSync(join(tmpdir(), 'refresh-pr-'))
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
  const origin = join(root, 'origin.git'), work = join(root, 'w')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  execFileSync('git', ['clone', '-q', origin, work])
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['core.autocrlf', 'false']]) g(work, 'config', k, v)
  const put = (f, s) => { mkdirSync(join(work, f, '..'), { recursive: true }); writeFileSync(join(work, f), s) }
  // #2708: a generation-keyed pair does not exist on main at all. Only the
  // legacy fixed pair was ever there, which is exactly why every pull request
  // collided with every other one.
  if (!keyed) { put('.agent/contract.json', '{"work_issue":0}\n'); put('.agent/completion.json', '{"pr":0}\n') }
  put('scripts/agent-work-contract.mjs', 'process.exit(0)\n'); put('base.txt', '1\n')
  g(work, 'add', '-A'); g(work, 'commit', '-qm', 'base'); g(work, 'push', '-q', 'origin', 'main')
  g(work, 'checkout', '-q', '-b', 'feature')
  put('scripts/x.test.mjs', "import test from 'node:test'\ntest('ok',()=>{})\n")
  g(work, 'add', '-A'); g(work, 'commit', '-qm', 'impl')
  put(pair[0], '{"work_issue":7,"generation":1}\n')
  put(pair[1], JSON.stringify({ pr: 8, head_sha: 'old', base_sha: 'old', checks: [{ command: TEST_CHECK, exit_code: 0, evidence: 'old' }, { command: DIFF_CHECK, exit_code: 0, evidence: 'old' }] }) + '\n')
  g(work, 'add', '-A'); g(work, 'commit', '-qm', 'evidence')
  return { root, work, g, put, pair }
}
function moveMain(r, file, text) {
  const other = join(r.root, 'o'); execFileSync('git', ['clone', '-q', join(r.root, 'origin.git'), other])
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t']]) r.g(other, 'config', k, v)
  writeFileSync(join(other, file), text); r.g(other, 'add', '-A'); r.g(other, 'commit', '-qm', 'main moved'); r.g(other, 'push', '-q', 'origin', 'main')
}

test('#507(b) refresh merges main, keeps .agent off the implementation head, and rebinds evidence to it', () => {
  const r = repo()
  try {
    moveMain(r, 'base.txt', '2\n')
    const logs = []
    const result = refresh({ issue: 7, pr: 8, worktree: r.work, push: false, assign: false }, { log: (l) => logs.push(l) })
    assert.equal(r.g(r.work, 'diff', '--name-only', 'origin/main', result.head), 'scripts/x.test.mjs')
    const report = JSON.parse(readFileSync(join(r.work, '.agent/completion.json'), 'utf8'))
    assert.equal(report.head_sha, result.head)
    assert.match(report.checks[0].evidence, /x 1\/1 pass, 0 fail, 0 skipped/)
    assert.equal(r.g(r.work, 'status', '--porcelain'), '')
    assert.equal(r.g(r.work, 'show', 'HEAD:base.txt'), '2')
  } finally { rmSync(r.root, { recursive: true, force: true }) }
})
test('#507(b) a real conflict refuses and leaves the branch unchanged', () => {
  const r = repo()
  try {
    moveMain(r, 'scripts/x.test.mjs', 'conflict\n')
    const before = r.g(r.work, 'rev-parse', 'HEAD')
    assert.throws(() => refresh({ issue: 7, pr: 8, worktree: r.work, push: false, assign: false }, { log: () => {} }), /conflicts outside \.agent\/: scripts\/x\.test\.mjs/)
    assert.equal(r.g(r.work, 'rev-parse', 'HEAD'), before)
    assert.equal(r.g(r.work, 'status', '--porcelain'), '')
    assert.throws(() => refresh({ issue: 9, pr: 8, worktree: r.work, push: false, assign: false }, { log: () => {} }), /not #9/)
    assert.equal(r.g(r.work, 'status', '--porcelain'), '')
  } finally { rmSync(r.root, { recursive: true, force: true }) }
})
test('#507(b) a merge that fails without a conflict is rolled back so a retry starts clean', () => {
  const r = repo()
  try {
    moveMain(r, 'base.txt', '2\n')
    const before = r.g(r.work, 'rev-parse', 'HEAD')
    r.g(r.work, 'config', 'merge.ff', 'only')
    assert.throws(() => refresh({ issue: 7, pr: 8, worktree: r.work, push: false, assign: false }, { log: () => {} }), /failed without a conflict.*unchanged/)
    assert.equal(r.g(r.work, 'rev-parse', 'HEAD'), before)
    assert.equal(r.g(r.work, 'status', '--porcelain'), '')
    r.g(r.work, 'config', '--unset', 'merge.ff')
    assert.equal(refresh({ issue: 7, pr: 8, worktree: r.work, push: false, assign: false }, { log: () => {} }).pushed, false)
  } finally { rmSync(r.root, { recursive: true, force: true }) }
})

test('#507(b) a recorded assignment survives a stale-readback error (#2844); an unrecorded one refuses', () => {
  for (const record of [true, false]) {
    const r = repo()
    try {
      r.g(r.work, 'push', '-q', '-u', 'origin', 'feature')
      moveMain(r, 'base.txt', '2\n')
      const logs = []
      const run = (file, args, opts) => {
        if (file === 'node' && args[0] === 'scripts/manage-migration-author-lanes.mjs') {
          const tip = args[args.indexOf('--head-sha') + 1]
          if (record) {
            const tree = r.g(r.work, 'rev-parse', 'HEAD^{tree}')
            const c = execFileSync('git', ['commit-tree', tree, '-m', `db-coordination reviewer-cursor sequence=1 reviewer=glm-5.3 issue=7 pr=8 head=${tip}`], { cwd: r.work, encoding: 'utf8' }).trim()
            r.g(r.work, 'push', '-q', 'origin', `${c}:refs/db-review-assignments/7-8-${tip}`)
          }
          return { status: 1, stdout: '', stderr: 'REFUSED: release could not be proved; RECOVERY REQUIRED' }
        }
        const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
        return spawnSync(file, args, { ...opts, env, encoding: 'utf8' })
      }
      const options = { issue: 7, pr: 8, worktree: r.work, push: true, assign: true }
      if (record) {
        const done = refresh(options, { run, log: (l) => logs.push(l) })
        assert.equal(done.reviewer, 'glm-5.3')
        assert.equal(done.wrapper, 'ai-glm')
        assert.match(logs.at(-1), /--reviewer glm-5.3 --wrapper ai-glm /)
        assert.match(logs.join('\n'), /records it, so it stands \(#2844\)/)
      } else {
        assert.throws(() => refresh(options, { run, log: () => {} }), /assigning a reviewer at the new head failed: REFUSED/)
      }
    } finally { rmSync(r.root, { recursive: true, force: true }) }
  }
})

test('#2708/#2845 a generation-keyed pair refreshes although main has no copy of it, and rebinds base and head', () => {
  const r = repo({ keyed: true })
  try {
    moveMain(r, 'base.txt', '2\n')
    const result = refresh({ issue: 7, pr: 8, worktree: r.work, push: false, assign: false }, { log: () => {} })
    // The implementation head carries the code and none of its own evidence.
    assert.equal(r.g(r.work, 'diff', '--name-only', 'origin/main', result.head), 'scripts/x.test.mjs')
    // Only this pull request's own two evidence files follow it, at paths no
    // other pull request can write (#2708).
    assert.deepEqual(r.g(r.work, 'diff', '--name-only', result.head, result.tip).split('\n').sort(), [...r.pair].sort())
    const report = JSON.parse(readFileSync(join(r.work, r.pair[1]), 'utf8'))
    assert.equal(report.head_sha, result.head)
    assert.equal(report.base_sha, r.g(r.work, 'rev-parse', 'origin/main'))
    assert.equal(r.g(r.work, 'status', '--porcelain'), '')
  } finally { rmSync(r.root, { recursive: true, force: true }) }
})

test('#2845 a legacy pair is rebound to the refreshed base as well', () => {
  const r = repo()
  try {
    moveMain(r, 'base.txt', '2\n')
    refresh({ issue: 7, pr: 8, worktree: r.work, push: false, assign: false }, { log: () => {} })
    const report = JSON.parse(readFileSync(join(r.work, '.agent/completion.json'), 'utf8'))
    assert.equal(report.base_sha, r.g(r.work, 'rev-parse', 'origin/main'))
  } finally { rmSync(r.root, { recursive: true, force: true }) }
})
