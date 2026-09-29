import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ACTIVE_REVIEWERS, REVIEWERS } from './manage-migration-author-lanes.mjs'
import { activeDeepSeekReviewer, deepSeekChildEnv, DEEPSEEK_REVIEW_MODEL, buildEvidenceBundle, requireRegularNonSymlink, reviewSpawnPlan, runReview, safeEvidenceDirectory } from './run-deepseek-evidence-review.mjs'

const head = 'a'.repeat(40)
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-evidence-'))
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.writeFileSync(path.join(dir, 'prompt.txt'), 'Review every attached byte and report coverage.')
  fs.writeFileSync(path.join(dir, 'large.sql'), `select 1;\n${'x'.repeat(80_000)}`)
  fs.writeFileSync(path.join(dir, 'test.sql'), 'select ok(true);\n')
  return dir
}

test('large evidence stays out of argv and remains byte-for-byte in declared order', () => {
  const dir = fixture()
  let launched
  const result = runReview({ issue: 1772, pr: 1853, headSha: head, worktree: dir, promptFile: 'prompt.txt', evidenceFiles: ['large.sql', 'test.sql'] }, {
    git: (args) => args.includes('status') ? '' : `${head}\n`, preflight: () => {}, env: {},
    spawn: (command, args) => { launched = { command, args }; return { status: 0 } }
  })
  assert.equal(launched.args.filter((arg) => arg === '--file').length, 1)
  assert.ok(!launched.args.some((arg) => arg.includes('x'.repeat(100))))
  assert.ok(result.argumentCharacters < 7000)
  const bundle = fs.readFileSync(result.bundlePath)
  const large = fs.readFileSync(path.join(dir, 'large.sql'))
  const small = fs.readFileSync(path.join(dir, 'test.sql'))
  const first = bundle.indexOf(large)
  const second = bundle.indexOf(small)
  assert.ok(first > 0 && second > first)
  assert.ok(bundle.subarray(first, first + large.length).equals(large))
  assert.ok(bundle.subarray(second, second + small.length).equals(small))
  assert.deepEqual(result.manifest.map((row) => row.path), ['large.sql', 'test.sql'])
})

test('bundle refuses duplicates, missing files, path escapes, and symlinks', () => {
  const dir = fixture()
  const base = { worktree: dir, headSha: head, issue: 1772, pr: 1853, promptFile: 'prompt.txt' }
  assert.throws(() => buildEvidenceBundle({ ...base, evidenceFiles: ['large.sql', 'large.sql'] }), /duplicate/)
  assert.throws(() => buildEvidenceBundle({ ...base, evidenceFiles: ['missing.sql'] }), /ENOENT/)
  assert.throws(() => buildEvidenceBundle({ ...base, evidenceFiles: ['../outside.sql'] }), /escapes/)
  assert.throws(() => requireRegularNonSymlink({ isFile: () => true, isSymbolicLink: () => true }, 'linked.sql'), /non-symlink/)
  fs.writeFileSync(path.join(dir, 'nul.sql'), Buffer.from([65, 0, 66]))
  assert.throws(() => buildEvidenceBundle({ ...base, evidenceFiles: ['nul.sql'] }), /binary\/NUL/)
})

test('Windows spawn uses separate cmd argv and never interpolates a shell string', () => {
  const args = ['send', 'fixed prompt', '--file', 'C:\\repo with space\\bundle.txt', '--review']
  assert.deepEqual(reviewSpawnPlan('C:\\bin\\ai-deepseek-agent.cmd', args, 'win32', 'C:\\Windows\\cmd.exe'), {
    file: 'C:\\Windows\\cmd.exe', args: ['/d', '/s', '/c', 'C:\\bin\\ai-deepseek-agent.cmd', ...args]
  })
  assert.deepEqual(reviewSpawnPlan('/usr/bin/ai-deepseek-agent', args, 'linux'), { file: '/usr/bin/ai-deepseek-agent', args })
})

test('output directory refuses a symlink or junction instead of writing outside', () => {
  const dir = fixture()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-outside-'))
  fs.mkdirSync(path.join(dir, '.ai'))
  fs.symlinkSync(outside, path.join(dir, '.ai', 'governed-review-evidence'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => safeEvidenceDirectory(dir), /real directory/)
})

test('oversized launch, corrupted durable bundle, and wrapper failure all fail closed', () => {
  const dir = fixture()
  const common = { issue: 1772, pr: 1853, headSha: head, worktree: dir, promptFile: 'prompt.txt', evidenceFiles: ['large.sql'] }
  const git = (args) => args.includes('status') ? '' : `${head}\n`
  assert.throws(() => runReview({ ...common, wrapper: `x${'y'.repeat(7001)}` }, { git, env: {}, preflight: () => assert.fail('preflight must not run'), spawn: () => assert.fail('spawn must not run') }), /command-line budget/)
  const first = runReview(common, { git, env: {}, preflight: () => {}, spawn: () => ({ status: 0 }) })
  fs.writeFileSync(first.bundlePath, 'corrupt')
  assert.throws(() => runReview(common, { git, env: {}, preflight: () => {}, spawn: () => ({ status: 0 }) }), /different bytes/)
  fs.rmSync(first.bundlePath)
  assert.throws(() => runReview(common, { git, env: {}, preflight: () => {}, spawn: () => ({ status: 9 }) }), /exited 9/)
})

test('review refuses stale heads and dirty worktrees before preflight or launch', () => {
  const dir = fixture()
  let touched = false
  const common = { issue: 1772, pr: 1853, headSha: head, worktree: dir, promptFile: 'prompt.txt', evidenceFiles: ['large.sql'] }
  assert.throws(() => runReview(common, { env: {}, git: () => `${'b'.repeat(40)}\n`, preflight: () => { touched = true }, spawn: () => { touched = true } }), /does not match/)
  assert.equal(touched, false)
  let calls = 0
  assert.throws(() => runReview(common, { env: {}, git: () => ++calls === 1 ? `${head}\n` : ' M source.mjs\n', preflight: () => { touched = true }, spawn: () => { touched = true } }), /non-review changes/)
  assert.equal(touched, false)
})

test('launcher keeps allocation, replacement, verdict, and lease ownership outside its authority', () => {
  const source = fs.readFileSync(new URL('./run-deepseek-evidence-review.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['--assign-reviewer', '--replace-failed-reviewer', 'releaseOwnedRef(', 'git/refs/', '--release-']) {
    assert.equal(source.includes(forbidden), false, `unexpected governed mutation path: ${forbidden}`)
  }
  assert.match(source, /--reviewer-preflight/)
  assert.match(source, /--review/)
})

test('runReview preflights and launches the ACTIVE DeepSeek reviewer with the governed flags and caller (#3764)', () => {
  const dir = fixture()
  let preflightArgs, launched
  runReview({ issue: 1772, pr: 1853, headSha: head, worktree: dir, promptFile: 'prompt.txt', evidenceFiles: ['test.sql'] }, {
    git: (args) => args.includes('status') ? '' : `${head}\n`,
    activeReviewers: [{ name: 'deepseek-probe', provider: 'deepseek', wrapper: 'ai-deepseek-agent' }],
    env: { AI_DEEPSEEK_CALLER: 'claude' },
    preflight: (args) => { preflightArgs = args },
    spawn: (command, args, env) => { launched = { command, args, env }; return { status: 0 } }
  })
  assert.equal(preflightArgs[preflightArgs.indexOf('--reviewer') + 1], 'deepseek-probe')
  const at = launched.args.indexOf('--governed-verdict')
  assert.equal(launched.args[at + 1], head)
  assert.equal(launched.args[launched.args.indexOf('--model') + 1], DEEPSEEK_REVIEW_MODEL)
  assert.ok(launched.args.includes('--review'))
  assert.equal(launched.env.AI_DEEPSEEK_CALLER, 'claude')
})

test('the real active DeepSeek reviewer is an ACTIVE_REVIEWERS member on ai-deepseek-agent, qualified on the pinned model', () => {
  const name = activeDeepSeekReviewer()
  const row = ACTIVE_REVIEWERS.find((r) => r.name === name)
  assert.equal(row.wrapper, 'ai-deepseek-agent')
  assert.equal(row.readsRepository, true)
  assert.ok(REVIEWERS.find((r) => r.name === name).readsRepositoryVerified.evidence.includes(`model ${DEEPSEEK_REVIEW_MODEL}`), 'model literal must match the qualified row')
  assert.throws(() => activeDeepSeekReviewer('ai-deepseek-agent', []), /exactly one active DeepSeek reviewer/)
  assert.throws(() => activeDeepSeekReviewer('ai-deepseek-agent', [{ name: 'a', provider: 'deepseek', wrapper: 'ai-deepseek-agent' }, { name: 'b', provider: 'deepseek', wrapper: 'ai-deepseek-agent' }]), /found 2/)
})

test('a wrapper without the verdict contract flag is refused before preflight', () => {
  const dir = fixture()
  assert.throws(() => runReview({ issue: 1, pr: 2, headSha: head, worktree: dir, promptFile: 'prompt.txt', evidenceFiles: ['test.sql'], wrapper: 'ai-muse' }, { git: (args) => args.includes('status') ? '' : `${head}\n`, preflight: () => assert.fail('no preflight'), spawn: () => assert.fail('no spawn') }), /--governed-verdict contract/)
})

test('caller comes from the shared caller authority, codex by default (#3764)', () => {
  assert.equal(deepSeekChildEnv('ai-deepseek-agent', { AI_DEEPSEEK_CALLER: 'claude' }).AI_DEEPSEEK_CALLER, 'claude')
  assert.equal(deepSeekChildEnv('ai-deepseek-agent', { CLAUDECODE: '1' }).AI_DEEPSEEK_CALLER, 'claude')
  assert.equal(deepSeekChildEnv('ai-deepseek-agent', {}).AI_DEEPSEEK_CALLER, 'codex')
})
