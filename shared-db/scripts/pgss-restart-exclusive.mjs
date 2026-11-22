// #5609 fixed capacity+restart profile over existing native exclusive refs; no new lock lane.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { githubIo, acquireExclusive, assertExclusive, releaseExclusive } from './manage-migration-coordination.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = 'pg-stat-statements-capacity-restart/v1'
const workflow = '.github/workflows/apply-pgss-capacity-restart.yml'
const files = [
  'config/pgss-capacity-restart.json',
  workflow,
  'scripts/apply_pgss_capacity_restart.py',
  'scripts/pgss-restart-exclusive.mjs',
  'scripts/shared_db_live_proof.py',
  '.ai-devops/task-gates.json',
]

function require(ok) {
  if (!ok) throw Error('fixed capacity-restart exclusive profile refused')
}

const git = (args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export function qualify(plan, env, target = 'preview', io = githubIo, runGit = git) {
  require(
    plan?.operation === profile &&
      plan.work_issue === 5609 &&
      Number.isSafeInteger(plan.source_pr) &&
      plan.source_pr > 0 &&
      plan.setting === 'pg_stat_statements.max' &&
      plan.desired === 40000 &&
      plan.restart_database === true &&
      JSON.stringify(plan.allowed_modes) === '["preview_only","preview_and_production"]' &&
      JSON.stringify(plan.expected_pre_effective) === '[5000,40000]' &&
      plan.maintenance_window_tz === 'America/New_York',
  )
  require(
    env.GITHUB_REPOSITORY === 'popcre/shared-db' &&
      env.GITHUB_REF === 'refs/heads/main' &&
      env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      env.GITHUB_WORKFLOW_REF === `popcre/shared-db/${workflow}@refs/heads/main` &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') &&
      env.EXPECTED_HEAD === env.GITHUB_SHA &&
      env.WORK_ISSUE === '5609' &&
      (env.MODE === 'preview_only' || env.MODE === 'preview_and_production') &&
      (target !== 'production' || env.MODE === 'preview_and_production') &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? '') &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''),
  )
  require(runGit(['rev-parse', 'HEAD']) === env.GITHUB_SHA && io.mainSha() === env.GITHUB_SHA)
  const issue = io.getIssue(5609)
  const pr = io.getPr(plan.source_pr)
  require(
    issue?.state === 'open' &&
      issue.number === 5609 &&
      pr?.merged === true &&
      /^[a-f0-9]{40}$/.test(pr.merge_commit_sha ?? '') &&
      pr.base?.ref === 'main' &&
      pr.base?.repo?.full_name === 'popcre/shared-db',
  )
  runGit(['merge-base', '--is-ancestor', pr.merge_commit_sha, env.GITHUB_SHA])
  for (const file of files) {
    require(runGit(['rev-parse', `${pr.merge_commit_sha}:${file}`]) === runGit(['rev-parse', `${env.GITHUB_SHA}:${file}`]))
  }
  return { admitted: true, kind: profile, work_issue: 5609, source_pr: plan.source_pr }
}

export function checkLease(lease, target, env, now = Date.now()) {
  const kind = target === 'preview' ? 'preview-maintenance' : 'production'
  require(
    lease?.kind === kind &&
      lease.holderId === `github-actions:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}:pgss-restart:${target}` &&
      lease.headSha === env.GITHUB_SHA &&
      String(lease.githubRunId) === env.GITHUB_RUN_ID &&
      String(lease.githubRunAttempt) === env.GITHUB_RUN_ATTEMPT &&
      Number.isSafeInteger(lease.generation) &&
      lease.generation > 0 &&
      /^[a-f0-9]{40}$/.test(lease.ownerSha ?? lease.sha ?? ''),
  )
  const age = now - Date.parse(lease.acquiredAt)
  require(Number.isFinite(age) && age >= -60000 && age <= 15 * 60 * 1000)
  return { holderId: lease.holderId, generation: lease.generation, ownerSha: lease.ownerSha ?? lease.sha }
}

export function perform(
  phase,
  target,
  { env = process.env, io = githubIo, runGit = git, read = readFileSync, write = writeFileSync, now = Date.now } = {},
) {
  require(['acquire', 'verify', 'release'].includes(phase) && ['preview', 'production'].includes(target))
  require(typeof env.RUNNER_TEMP === 'string' && env.RUNNER_TEMP.startsWith('/'))
  const plan = JSON.parse(read(resolve(root, 'config/pgss-capacity-restart.json'), 'utf8'))
  const file = resolve(env.RUNNER_TEMP, `pgss-restart-${target}-lease.json`)
  const kind = target === 'preview' ? 'preview-maintenance' : 'production'
  const owner = `github-actions:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT}:pgss-restart:${target}`
  if (phase === 'acquire') {
    qualify(plan, env, target, io, runGit)
    const claim = { kind: profile, work_issue: 5609, source_pr: plan.source_pr }
    const locked = acquireExclusive(
      kind,
      {
        owner,
        pr: plan.source_pr,
        headSha: env.GITHUB_SHA,
        githubRunId: env.GITHUB_RUN_ID,
        githubRunAttempt: Number(env.GITHUB_RUN_ATTEMPT),
        maintenanceClaim: claim,
      },
      {
        ...io,
        verifyMaintenanceClaim(request) {
          require(JSON.stringify(request) === JSON.stringify(claim))
          return qualify(plan, env, target, io, runGit)
        },
      },
    )
    try {
      const full = assertExclusive(kind, { holderId: locked.holderId, generation: locked.generation }, io)
      write(file, JSON.stringify({ ...full, ownerSha: locked.ownerSha }) + '\n', { mode: 0o600 })
    } catch (error) {
      releaseExclusive(
        kind,
        { holderId: locked.holderId, generation: locked.generation, ownerSha: locked.ownerSha },
        io,
      )
      throw error
    }
    return { phase, target, owned: true }
  }
  const lease = JSON.parse(read(file, 'utf8'))
  const expected = checkLease(lease, target, env, phase === 'release' ? Date.parse(lease.acquiredAt) : now())
  if (phase === 'verify') {
    qualify(plan, env, target, io, runGit)
    const current = assertExclusive(kind, expected, io)
    require(current.sha === expected.ownerSha)
    checkLease(current, target, env, now())
    return { phase, target, owned: true }
  }
  releaseExclusive(kind, expected, io)
  return { phase, target, released: true }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    require(process.argv.length === 4)
    perform(process.argv[2], process.argv[3])
    console.log('Fixed capacity-restart native exclusive operation verified.')
  } catch {
    console.error('Fixed capacity-restart native exclusive operation refused; no private details disclosed.')
    process.exitCode = 2
  }
}
