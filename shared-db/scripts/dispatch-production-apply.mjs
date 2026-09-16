#!/usr/bin/env node
// popcre/ai-devops#507 (c): one command to dispatch a MANUAL production dry-run or apply.
//
// By hand this meant looking up each evidence run's artifact digest, normalizing it, and
// typing a long `-f name=value` list whose input names drift from the workflow; a wrong
// name returned HTTP 422 and nothing ran. This helper gathers the digests from the named
// runs, refuses any evidence run that did not succeed, checks every input name against the
// workflow on origin/main, and sends one JSON dispatch body, the same shape the automatic
// promotion job sends. It adds no permission: every gate in the workflow (exact confirmation,
// fresh dry-run, production lock, evidence rechecks, the production environment approval)
// still runs. Without --dispatch it only prints the plan.
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ghJson, runGitHubCommand } from './lib/github-transport.mjs'

export class DispatchError extends Error {}
export const WORKFLOW = '.github/workflows/shared-supabase-migrations.yml'
export const EVIDENCE_ARTIFACTS = {
  review: /^(?:production-apply-review-evidence|automatic-production-apply-review-evidence)$/,
  preview: /^preview-migration-apply-[0-9a-f]{40}$/,
  owner_decision: /^production-owner-decision-\d+$/,
}
const USAGE = 'Usage: node scripts/dispatch-production-apply.mjs --versions V1,V2 --mode dry-run|apply [--commit-sha SHA] [--review-run-id ID] [--preview-run-id ID | --ephemeral-check-run-id ID] [--owner-decision-run-id ID] [--source-pr N] [--work-issue N] [--merged-pr-issue-binding PR:ISSUE] [--derivation-override TEXT] [--repo OWNER/NAME] [--dispatch]'

export function parseArgs(argv) {
  const flags = {
    '--versions': 'versions', '--mode': 'mode', '--commit-sha': 'commitSha', '--review-run-id': 'reviewRunId',
    '--preview-run-id': 'previewRunId', '--ephemeral-check-run-id': 'ephemeralCheckRunId',
    '--owner-decision-run-id': 'ownerDecisionRunId', '--source-pr': 'sourcePr', '--work-issue': 'workIssue',
    '--merged-pr-issue-binding': 'mergedPrIssueBinding', '--derivation-override': 'derivationOverride', '--repo': 'repo',
  }
  const out = { dispatch: false, repo: 'u2giants/shared-db' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dispatch') { out.dispatch = true; continue }
    const key = flags[argv[i]]
    if (!key || argv[i + 1] === undefined) throw new DispatchError(`unknown or incomplete option ${argv[i]}. ${USAGE}`)
    out[key] = argv[++i]
  }
  if (!['dry-run', 'apply'].includes(out.mode)) throw new DispatchError(`--mode must be dry-run or apply. ${USAGE}`)
  const versions = String(out.versions ?? '').split(',').map((v) => v.trim()).filter(Boolean)
  if (!versions.length || versions.some((v) => !/^\d{14}$/.test(v))) throw new DispatchError('--versions must be a comma-separated list of 14-digit migration versions')
  out.versions = versions
  if (out.commitSha !== undefined && !/^[0-9a-f]{40}$/.test(out.commitSha)) throw new DispatchError('--commit-sha must be a full 40-character SHA')
  if (out.mode === 'apply') {
    if (!out.reviewRunId) throw new DispatchError('apply needs --review-run-id (the immutable review evidence run)')
    if (!out.sourcePr || !out.workIssue) throw new DispatchError('apply needs --source-pr and --work-issue')
    if (out.previewRunId && out.ephemeralCheckRunId) throw new DispatchError('give --preview-run-id or --ephemeral-check-run-id, not both')
  } else {
    for (const k of ['reviewRunId', 'previewRunId', 'ephemeralCheckRunId', 'ownerDecisionRunId', 'sourcePr', 'workIssue', 'mergedPrIssueBinding']) {
      if (out[k] !== undefined) throw new DispatchError(`a dry-run takes no ${k}; the workflow ignores it`)
    }
  }
  return out
}

// Reads the workflow_dispatch input names from the workflow text (block or inline style).
export function declaredInputs(workflowText) {
  const lines = String(workflowText).split(/\r?\n/)
  const start = lines.findIndex((l) => /^  workflow_dispatch:\s*$/.test(l))
  if (start < 0) throw new DispatchError(`${WORKFLOW} has no workflow_dispatch trigger`)
  const names = new Set()
  let inInputs = false
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) || /^  \S/.test(line)) break
    if (/^    inputs:\s*$/.test(line)) { inInputs = true; continue }
    const m = inInputs && line.match(/^      ([a-z_][a-z0-9_]*):/)
    if (m) names.add(m[1])
  }
  if (!names.size) throw new DispatchError(`${WORKFLOW} declares no dispatch inputs`)
  return names
}

export function normalizeDigest(digest) {
  const d = String(digest ?? '')
  if (/^[0-9a-f]{64}$/.test(d)) return `sha256:${d}`
  if (/^sha256:[0-9a-f]{64}$/.test(d)) return d
  throw new DispatchError(`artifact digest "${d}" is not a sha256 digest`)
}

export function pickEvidenceDigest(kind, runId, run, artifacts) {
  if (run.status !== 'completed' || run.conclusion !== 'success') throw new DispatchError(`${kind} evidence run ${runId} is ${run.status}/${run.conclusion ?? 'none'}, not a success; nothing was dispatched`)
  const matches = artifacts.filter((a) => EVIDENCE_ARTIFACTS[kind].test(a.name) && !a.expired)
  if (matches.length !== 1) throw new DispatchError(`${kind} evidence run ${runId} has ${matches.length} matching unexpired artifacts (${artifacts.map((a) => a.name).join(', ') || 'none'}); expected exactly 1`)
  return normalizeDigest(matches[0].digest)
}

export function buildInputs(options, { commitSha, digests = {} }) {
  const inputs = {
    target: 'production', mode: options.mode, production_allowlist: options.versions.join(','),
    commit_sha: commitSha, confirmation: `${options.mode === 'apply' ? 'APPLY' : 'DRY-RUN'} ${commitSha}`,
  }
  if (options.derivationOverride) inputs.derivation_override = options.derivationOverride
  if (options.mode === 'apply') {
    Object.assign(inputs, { review_run_id: String(options.reviewRunId), review_artifact_digest: digests.review, source_pr: String(options.sourcePr), work_issue: String(options.workIssue) })
    if (options.previewRunId) Object.assign(inputs, { preview_run_id: String(options.previewRunId), preview_artifact_digest: digests.preview })
    if (options.ephemeralCheckRunId) inputs.ephemeral_check_run_id = String(options.ephemeralCheckRunId)
    if (options.ownerDecisionRunId) Object.assign(inputs, { owner_decision_run_id: String(options.ownerDecisionRunId), owner_decision_artifact_digest: digests.owner_decision })
    if (options.mergedPrIssueBinding) inputs.merged_pr_issue_binding = options.mergedPrIssueBinding
  }
  return inputs
}

export function assertDeclared(inputs, declared) {
  const unknown = Object.keys(inputs).filter((k) => !declared.has(k))
  if (unknown.length) throw new DispatchError(`the workflow on origin/main does not declare input(s) ${unknown.join(', ')}; GitHub would answer HTTP 422. Nothing was dispatched.`)
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new DispatchError(`git ${args.join(' ')} failed: ${String(r.stderr).trim()}`)
  return r.stdout.trim()
}

export function plan(options, deps = {}) {
  const { readJson = (args) => ghJson(args), gitRun = git } = deps
  gitRun(['fetch', '-q', 'origin', 'main'])
  const mainSha = gitRun(['rev-parse', 'origin/main'])
  const commitSha = options.commitSha ?? mainSha
  if (commitSha !== mainSha) throw new DispatchError(`--commit-sha ${commitSha} is not the current origin/main ${mainSha}; the workflow would refuse it`)
  const declared = declaredInputs(gitRun(['show', `origin/main:${WORKFLOW}`]))
  const digests = {}
  for (const [kind, runId] of [['review', options.reviewRunId], ['preview', options.previewRunId], ['owner_decision', options.ownerDecisionRunId]]) {
    if (!runId) continue
    if (!/^\d+$/.test(String(runId))) throw new DispatchError(`${kind} run id "${runId}" is not a number`)
    const run = readJson(['api', `repos/${options.repo}/actions/runs/${runId}`])
    const artifacts = readJson(['api', `repos/${options.repo}/actions/runs/${runId}/artifacts?per_page=100`]).artifacts ?? []
    digests[kind] = pickEvidenceDigest(kind, runId, run, artifacts)
  }
  const inputs = buildInputs(options, { commitSha, digests })
  assertDeclared(inputs, declared)
  return { ref: 'main', inputs }
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const {
    log = (l) => console.log(l),
    send = (repo, body) => runGitHubCommand(['api', '--method', 'POST', `repos/${repo}/actions/workflows/shared-supabase-migrations.yml/dispatches`, '--input', '-'], { input: body }),
  } = deps
  try {
    const options = parseArgs(argv)
    const body = plan(options, deps)
    log(JSON.stringify(body, null, 2))
    if (!options.dispatch) { log('Plan only. Add --dispatch to send it.'); return 0 }
    send(options.repo, JSON.stringify(body))
    log(`Dispatched production ${options.mode} for ${options.versions.join(',')} at ${body.inputs.commit_sha}. Every workflow gate still applies${options.mode === 'apply' ? ', including the production environment approval' : ''}.`)
    return 0
  } catch (e) {
    console.error(`REFUSED: ${e.message}`)
    return e instanceof DispatchError ? 1 : 2
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main()
