#!/usr/bin/env node
// DesignFlow SANDBOX migration route: GitHub-side bindings (issue #3428).
//
// Called only by .github/workflows/designflow-sandbox-migrations.yml. Every
// GitHub read goes through scripts/lib/github-transport.mjs (issue #2342).
//
//   --source-pr N --commit-sha S --allowlist A
//       The source PR is merged, its merge commit is an ancestor of S, and it
//       ADDED a migration file for every allowlisted version. Prints the PR's
//       exact head SHA on success (the caller then re-proves its guarded merge
//       and durable exact-head verdict with the existing gates).
//   --dry-run-run R --commit-sha S
//       Run R is a successful workflow_dispatch run of the sandbox workflow at
//       exact commit S. (The caller compares the downloaded allowlist.)
//
// Every refusal exits 2 with a line beginning "REFUSED:".
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ghJson } from './lib/github-transport.mjs'
import { currentRepository } from './lib/repository-identity.mjs'

export const SANDBOX_WORKFLOW_PATH = '.github/workflows/designflow-sandbox-migrations.yml'
const SHA = /^[0-9a-f]{40}$/
const VERSION = /^\d{14}$/

export class BindingRefusal extends Error {}

export function parseAllowlist(raw) {
  const values = String(raw ?? '').split(',').map((v) => v.trim())
  if (!values.length || values.some((v) => !VERSION.test(v))) throw new BindingRefusal('allowlist must be comma-separated exact 14-digit versions')
  if (new Set(values).size !== values.length || values.some((v, i) => i > 0 && values[i - 1] >= v)) throw new BindingRefusal('allowlist must be unique and ascending')
  return values
}

export function checkSourcePr({ pr, files, commitSha, allowlist, isAncestor }) {
  if (!SHA.test(commitSha)) throw new BindingRefusal('commit sha must be 40 hex characters')
  if (pr?.merged !== true) throw new BindingRefusal(`source PR #${pr?.number ?? '?'} is not merged`)
  const merge = String(pr.merge_commit_sha ?? '')
  const head = String(pr.head?.sha ?? '')
  if (!SHA.test(merge) || !SHA.test(head)) throw new BindingRefusal('source PR has no exact merge commit or head')
  if (!isAncestor(merge, commitSha)) throw new BindingRefusal(`source PR merge commit ${merge} is not on exact main ${commitSha}`)
  const added = new Set(files.filter((f) => f?.status === 'added').map((f) => f.filename))
  for (const version of parseAllowlist(allowlist)) {
    const hit = [...added].some((name) => new RegExp(`^supabase/migrations/${version}_[^/]+\\.sql$`).test(name))
    if (!hit) throw new BindingRefusal(`migration ${version} was not added by source PR #${pr.number}`)
  }
  return head
}

export function checkDryRun({ run, artifacts, commitSha }) {
  const ok = run?.path === SANDBOX_WORKFLOW_PATH && run?.conclusion === 'success' && run?.head_sha === commitSha && run?.event === 'workflow_dispatch'
  if (!ok) throw new BindingRefusal(`run ${run?.id ?? '?'} is not a successful sandbox dry-run of ${SANDBOX_WORKFLOW_PATH} at ${commitSha}`)
  // The run's MODE: a dry-run uploads exactly the dry-run evidence artifact and
  // never an apply one. An apply run is never accepted as dry-run evidence.
  const names = (artifacts ?? []).map((a) => a?.name)
  if (!names.includes(`sandbox-migration-dry-run-${commitSha}`) || names.some((n) => String(n).startsWith('sandbox-migration-apply-'))) {
    throw new BindingRefusal(`run ${run.id} was not a sandbox dry-run (its artifacts are: ${names.join(', ') || 'none'})`)
  }
}

function arg(argv, name) {
  const i = argv.indexOf(name)
  return i < 0 ? undefined : argv[i + 1]
}

export function main(argv = process.argv.slice(2)) {
  try {
    const repo = currentRepository()
    const commitSha = arg(argv, '--commit-sha')
    const sourcePr = arg(argv, '--source-pr')
    const dryRun = arg(argv, '--dry-run-run')
    if (sourcePr !== undefined) {
      if (!/^[1-9]\d*$/.test(sourcePr)) throw new BindingRefusal('source PR must be one pull request number')
      const pr = ghJson(['api', `repos/${repo}/pulls/${sourcePr}`])
      const files = ghJson(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${sourcePr}/files?per_page=100`]).flat()
      const isAncestor = (a, b) => { try { execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }); return true } catch { return false } }
      console.log(checkSourcePr({ pr, files, commitSha, allowlist: arg(argv, '--allowlist'), isAncestor }))
    } else if (dryRun !== undefined) {
      if (!/^[1-9]\d*$/.test(dryRun)) throw new BindingRefusal('dry-run run id must be a number')
      const run = ghJson(['api', `repos/${repo}/actions/runs/${dryRun}`])
      const artifacts = ghJson(['api', '--paginate', '--slurp', `repos/${repo}/actions/runs/${dryRun}/artifacts?per_page=100`]).flatMap((page) => page?.artifacts ?? [])
      checkDryRun({ run, artifacts, commitSha })
      console.log(`DRY-RUN EVIDENCE OK: run ${dryRun} at ${commitSha}`)
    } else {
      throw new BindingRefusal('pass --source-pr or --dry-run-run')
    }
    return 0
  } catch (e) {
    console.error(`REFUSED: ${e.message}`)
    return 2
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main()
