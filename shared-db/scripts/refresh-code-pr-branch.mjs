#!/usr/bin/env node
// popcre/ai-devops#507 (b): one step to bring a guarded code PR branch onto a moved main.
//
// By hand this took six commands and was repeated on every main move: merge main, put
// .agent/ back to main's copy so the implementation head carries no evidence, re-run the
// tests, rewrite .agent/completion.json for the new head, validate it, commit, push, and
// ask for a reviewer at the new head. This does exactly those steps and nothing more.
// It never carries an old review forward, never edits the published contract, and
// refuses (leaving the branch as it was) on any real merge conflict or failing check.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { REVIEWERS } from './manage-migration-author-lanes.mjs'

export class RefreshError extends Error {}
const EVIDENCE = ['.agent/contract.json', '.agent/completion.json']
export const TEST_CHECK = 'node --test on every changed scripts test file'
export const DIFF_CHECK = 'git diff --check origin/main...HEAD'

export function parseArgs(argv) {
  const out = { push: true, assign: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--issue') out.issue = Number(argv[++i])
    else if (a === '--pr') out.pr = Number(argv[++i])
    else if (a === '--worktree') out.worktree = argv[++i]
    else if (a === '--no-push') { out.push = false; out.assign = false }
    else if (a === '--no-assign') out.assign = false
    else throw new RefreshError(`unknown option ${a}. Usage: node scripts/refresh-code-pr-branch.mjs --issue <n> --pr <n> [--worktree <path>] [--no-push] [--no-assign]`)
  }
  if (!Number.isInteger(out.issue) || out.issue < 1 || !Number.isInteger(out.pr) || out.pr < 1) throw new RefreshError('--issue <n> and --pr <n> are both required')
  out.worktree ??= process.cwd()
  return out
}

// Only the two standard checks can be re-proved mechanically. Any other check in the
// report is refused by name, so no evidence is ever restamped without being re-run.
export function rebindCompletion(report, { head, testSummary }) {
  const checks = (report.checks ?? []).map((check) => {
    if (check.command === TEST_CHECK) return { ...check, exit_code: 0, evidence: `${testSummary} at ${head.slice(0, 8)} after refreshing onto origin/main.` }
    if (check.command === DIFF_CHECK) return { ...check, exit_code: 0, evidence: `Exit 0 with no output at ${head.slice(0, 8)}.` }
    throw new RefreshError(`completion check "${check.command}" cannot be re-run by this helper; refresh by hand and re-prove it`)
  })
  return { ...report, head_sha: head, checks }
}

export function summarizeNodeTest(output) {
  const count = (name) => Number((String(output).match(new RegExp(`^(?:ℹ|#) ${name} (\\d+)`, 'm')) ?? [])[1] ?? NaN)
  const pass = count('pass'), fail = count('fail'), skipped = count('skipped')
  if (!Number.isInteger(pass) || !Number.isInteger(fail)) throw new RefreshError('node --test output had no pass/fail summary')
  return { pass, fail, skipped: Number.isInteger(skipped) ? skipped : 0 }
}

export function refresh(options, { run = defaultRun, log = (l) => console.log(l) } = {}) {
  const cwd = options.worktree
  const git = (...args) => run('git', args, { cwd })
  const ok = (r, what) => { if (r.status !== 0) throw new RefreshError(`${what} failed: ${String(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ')}`); return String(r.stdout ?? '').trim() }
  if (ok(git('status', '--porcelain'), 'git status')) throw new RefreshError('the worktree has uncommitted changes; commit or remove them first')
  const before = ok(git('rev-parse', 'HEAD'), 'git rev-parse')
  const contract = JSON.parse(ok(git('show', `${before}:.agent/contract.json`), 'reading the branch contract'))
  const report = JSON.parse(ok(git('show', `${before}:.agent/completion.json`), 'reading the branch completion report'))
  if (Number(contract.work_issue) !== options.issue || Number(report.pr) !== options.pr) throw new RefreshError(`the branch evidence is for issue #${contract.work_issue} / PR #${report.pr}, not #${options.issue} / #${options.pr}`)
  ok(git('fetch', '-q', 'origin', 'main'), 'git fetch origin main')
  // Until the implementation head is committed, any refusal puts the branch back exactly as it was
  // (the tree was proved clean above), so a retry never meets a half-finished merge.
  try {
    const merge = git('merge', '--no-edit', '--no-commit', 'origin/main')
    if (merge.status !== 0) {
      const conflicts = ok(git('diff', '--name-only', '--diff-filter=U'), 'git diff').split('\n').filter(Boolean)
      const real = conflicts.filter((f) => !EVIDENCE.includes(f))
      if (real.length) throw new RefreshError(`merging origin/main conflicts outside .agent/: ${real.join(', ')}. The branch is unchanged at ${before}; resolve those by hand.`)
      if (!conflicts.length) throw new RefreshError(`merging origin/main failed without a conflict: ${String(merge.stderr || merge.stdout).trim().split('\n').at(-1)}. The branch is unchanged at ${before}.`)
    }
    ok(git('checkout', 'origin/main', '--', ...EVIDENCE), 'restoring .agent from origin/main')
    ok(git('commit', '-q', '--allow-empty', '-m', `Merge origin/main; implementation head for #${options.issue} without evidence files`), 'committing the implementation head')
  } catch (e) {
    git('merge', '--abort')
    git('reset', '-q', '--hard', before)
    throw e
  }
  const head = ok(git('rev-parse', 'HEAD'), 'git rev-parse')
  const changed = ok(git('diff', '--name-only', 'origin/main', 'HEAD'), 'git diff').split('\n').filter(Boolean)
  const tests = changed.filter((f) => /^scripts\/.*\.test\.mjs$/.test(f))
  let testSummary = 'no changed scripts test file'
  if (tests.length) {
    const t = run('node', ['--test', '--test-reporter=spec', ...tests], { cwd })
    const s = summarizeNodeTest(`${t.stdout}\n${t.stderr}`)
    if (t.status !== 0 || s.fail) throw new RefreshError(`tests fail after refreshing (${s.fail} failing); the implementation head ${head} is committed locally but nothing was pushed`)
    testSummary = `${tests.map((f) => f.replace(/^scripts\/|\.test\.mjs$/g, '')).join(', ')} ${s.pass}/${s.pass + s.fail} pass, ${s.fail} fail, ${s.skipped} skipped`
  }
  ok(git('diff', '--check', 'origin/main...HEAD'), 'git diff --check')
  writeFileSync(join(cwd, '.agent/contract.json'), JSON.stringify(contract, null, 2) + '\n')
  writeFileSync(join(cwd, '.agent/completion.json'), JSON.stringify(rebindCompletion(report, { head, testSummary }), null, 2) + '\n')
  ok(run('node', ['scripts/agent-work-contract.mjs', '--validate-completion', '--report-file', '.agent/completion.json', '--contract-file', '.agent/contract.json', '--expected-pr', String(options.pr), '--expected-head-sha', head], { cwd }), 'validating the rebound completion report')
  ok(git('add', ...EVIDENCE), 'git add')
  ok(git('commit', '-q', '-m', `chore(evidence): bind #${options.issue} contract pair to implementation head`), 'committing evidence')
  const tip = ok(git('rev-parse', 'HEAD'), 'git rev-parse')
  log(`Refreshed: implementation head ${head}, evidence head ${tip}. ${testSummary}.`)
  if (!options.push) return { head, tip, pushed: false }
  ok(git('push', '-q'), 'git push')
  if (!options.assign) return { head, tip, pushed: true }
  const assign = run('node', ['scripts/manage-migration-author-lanes.mjs', '--assign-reviewer', '--issue', String(options.issue), '--pr', String(options.pr), '--head-sha', tip], { cwd })
  let assigned = String(assign.stdout ?? '')
  if (assign.status !== 0) {
    // u2giants/shared-db#2844: a stale readback can report RECOVERY REQUIRED after the assignment
    // was recorded. Accept only the recorded assignment ref for this exact head; otherwise refuse.
    const ref = `refs/db-review-assignments/${options.issue}-${options.pr}-${tip}`
    const fetched = git('fetch', '-q', 'origin', ref)
    const message = fetched.status === 0 ? String(git('log', '-1', '--format=%B', 'FETCH_HEAD').stdout ?? '') : ''
    const recorded = message.match(/reviewer=(\S+) issue=(\d+) pr=(\d+) head=([0-9a-f]{40})/)
    if (!recorded || Number(recorded[2]) !== options.issue || Number(recorded[3]) !== options.pr || recorded[4] !== tip) ok(assign, 'assigning a reviewer at the new head')
    log(`The reviewer assignment reported an error (${String(assign.stderr || assign.stdout).trim().split('\n').at(-1)}), but ${ref} records it, so it stands (#2844).`)
    assigned = `"reviewer": "${recorded[1]}"`
  }
  const reviewer = (assigned.match(/"reviewer":\s*"([^"]+)"/) ?? [])[1], wrapper = (assigned.match(/"wrapper":\s*"([^"]+)"/) ?? [])[1] ?? REVIEWERS.find((row) => row.name === reviewer)?.wrapper
  log(`Reviewer assigned at ${tip}: ${reviewer ?? 'see output'} (${wrapper ?? '?'}). Next: node scripts/run-governed-review.mjs --issue ${options.issue} --pr ${options.pr} --reviewer ${reviewer} --wrapper ${wrapper ?? '<wrapper>'} --worktree ${cwd} -- new <session> --prompt-file <brief>`)
  return { head, tip, pushed: true, reviewer, wrapper }
}

function defaultRun(file, args, { cwd }) {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return spawnSync(file, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: false })
}

export function main(argv = process.argv.slice(2)) {
  try { refresh(parseArgs(argv)); return 0 }
  catch (e) { console.error(`REFUSED: ${e.message}`); return e instanceof RefreshError ? 1 : 2 }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main()
