#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const PRODUCTION_PROJECT_REF = 'qsllyeztdwjgirsysgai'
export const PRODUCTION_PROJECT_URL = `https://api.supabase.com/v1/projects/${PRODUCTION_PROJECT_REF}`
export const GENERATED_TYPES_SCHEMAS = Object.freeze(['public', 'dflow', 'plm', 'core', 'app'])
export const GENERATED_TYPES_WORKFLOW_PATH = '.github/workflows/generate-database-types.yml'
const SHA = /^[0-9a-f]{40}$/i

export class GeneratedTypesProofError extends Error {}

function refuse(message) { throw new GeneratedTypesProofError(message) }

export function parsePositiveIssue(value) {
  const text = String(value ?? '')
  if (!/^[1-9][0-9]*$/.test(text)) refuse('work_issue must be a positive decimal issue number')
  const number = Number(text)
  if (!Number.isSafeInteger(number)) refuse('work_issue is outside the supported integer range')
  return number
}

export function validateIssueScope(issue, expectedIssue) {
  const number = parsePositiveIssue(expectedIssue)
  if (!issue || typeof issue !== 'object' || Array.isArray(issue)) refuse('work issue response is unreadable')
  if (Number(issue.number) !== number) refuse(`GitHub returned issue #${issue.number}, expected #${number}`)
  if (issue.pull_request) refuse(`work issue #${number} is a pull request, not an issue`)
  if (issue.state !== 'open') refuse(`work issue #${number} is not open`)
  if (typeof issue.body !== 'string') refuse(`work issue #${number} has no readable body`)
  const fences = [...issue.body.matchAll(/```db-work-scope\s*\r?\n([\s\S]*?)\r?\n```/g)]
  if (fences.length !== 1) refuse(`work issue #${number} must contain exactly one db-work-scope block`)
  const fields = new Map()
  for (const line of fences[0][1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const match = /^([a-z_]+):\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    if (fields.has(match[1])) refuse(`work issue #${number} repeats scope field ${match[1]}`)
    fields.set(match[1], match[2])
  }
  for (const [key, value] of Object.entries({
    status: 'ready',
    work_type: 'structural',
    application_return_to: 'popcre/shared-db',
    generated_types: 'required',
  })) {
    if (fields.get(key) !== value) refuse(`work issue #${number} scope must declare ${key}: ${value}`)
  }
  return { work_issue: number }
}

export function validateMainBinding({ issueNumber, applicationCommitSha, checkoutSha, currentMainSha, gitHubRef }) {
  parsePositiveIssue(issueNumber)
  for (const [name, value] of Object.entries({ applicationCommitSha, checkoutSha, currentMainSha })) {
    if (!SHA.test(String(value ?? ''))) refuse(`${name} must be a full 40-character commit SHA`)
  }
  if (gitHubRef !== 'refs/heads/main') refuse('production proof must be dispatched from refs/heads/main')
  if (applicationCommitSha.toLowerCase() !== checkoutSha.toLowerCase()) refuse('checked-out HEAD does not equal GITHUB_SHA')
  if (applicationCommitSha.toLowerCase() !== currentMainSha.toLowerCase()) refuse('GITHUB_SHA is no longer the current main tip')
  return applicationCommitSha.toLowerCase()
}

export function matchesGeneratedTypesWorkflowRun(run, evidence) {
  return run?.conclusion === 'success' && run?.event === 'workflow_dispatch' && run?.path === GENERATED_TYPES_WORKFLOW_PATH && run?.head_branch === 'main' && String(run?.head_sha ?? '').toLowerCase() === String(evidence?.application_commit_sha ?? '').toLowerCase() && String(evidence?.application_repository ?? '').toLowerCase() === 'popcre/shared-db'
}

export function validateProjectMetadata({ requestUrl, metadata, productionRef = PRODUCTION_PROJECT_REF, previewRef }) {
  if (productionRef !== PRODUCTION_PROJECT_REF) refuse('production project ref differs from the canonical shared database project')
  if (!previewRef || !/^[a-z]{20}$/.test(String(previewRef))) refuse('PREVIEW_PROJECT_REF is unset or malformed')
  if (previewRef === productionRef) refuse('production and preview project refs must be different')
  if (requestUrl !== PRODUCTION_PROJECT_URL) refuse('Management API project URL is not the canonical production project URL')
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) refuse('Management API returned unreadable project metadata')
  if (metadata.id !== productionRef) refuse('Management API project identity does not match the canonical production ref')
  return {
    source_project_url: PRODUCTION_PROJECT_URL,
    source_project_ref: productionRef,
    project_name: typeof metadata.name === 'string' ? metadata.name : null,
    organization_id: typeof metadata.organization_id === 'string' ? metadata.organization_id : null,
    region: typeof metadata.region === 'string' ? metadata.region : null,
    status: typeof metadata.status === 'string' ? metadata.status : null,
  }
}

export function validateGeneratedTypesOutput(bytes, schemas) {
  const actualSchemas = Array.isArray(schemas) ? schemas : String(schemas ?? '').split(',').map((value) => value.trim())
  if (JSON.stringify(actualSchemas) !== JSON.stringify(GENERATED_TYPES_SCHEMAS)) refuse(`schema set must be exactly ${GENERATED_TYPES_SCHEMAS.join(',')}`)
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? '')
  if (content.length === 0) refuse('generated TypeScript output is empty')
  const text = content.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(content)) refuse('generated TypeScript output is not valid UTF-8')
  if (!/\bexport\s+type\s+Database\b/.test(text)) refuse('generated TypeScript output lacks export type Database')
  return content
}

export function generatedTypesSha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

export function selectGeneratedTypesArtifactEntries(entries) {
  if (!(entries instanceof Map) || entries.size !== 2 || !entries.has('database.types.ts') || !entries.has('db-generated-types-proof.json')) return null
  try {
    return {
      typescriptBytes: entries.get('database.types.ts'),
      proof: JSON.parse(entries.get('db-generated-types-proof.json').toString('utf8')),
    }
  } catch { return null }
}

export function buildGeneratedTypesProof({ issue, issueNumber, applicationCommitSha, checkoutSha, currentMainSha, gitHubRef, generatedTypesBytes, schemas, projectRequestUrl, projectMetadata, productionProjectRef = PRODUCTION_PROJECT_REF, previewProjectRef, generatedAt = new Date().toISOString() }) {
  const { work_issue } = validateIssueScope(issue, issueNumber)
  const commit = validateMainBinding({ issueNumber: work_issue, applicationCommitSha, checkoutSha, currentMainSha, gitHubRef })
  const target = validateProjectMetadata({ requestUrl: projectRequestUrl, metadata: projectMetadata, productionRef: productionProjectRef, previewRef: previewProjectRef })
  const bytes = validateGeneratedTypesOutput(generatedTypesBytes, schemas)
  if (Number.isNaN(Date.parse(generatedAt)) || !/^\d{4}-\d\d-\d\dT.*Z$/.test(generatedAt)) refuse('generated_at must be a valid UTC timestamp')
  return {
    schema_version: 1,
    work_issue,
    application_commit_sha: commit,
    result: 'passed',
    generated_types_sha256: generatedTypesSha256(bytes),
    environment: 'production',
    source_project_ref: target.source_project_ref,
    source_project_url: target.source_project_url,
    schemas: [...GENERATED_TYPES_SCHEMAS],
    generated_at: generatedAt,
  }
}

function ghReadJson(args) {
  const bytes = execFileSync(process.execPath, ['scripts/gh-read.mjs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  try { return JSON.parse(bytes) } catch { refuse('read-only GitHub response was not valid JSON') }
}

function readIssue(issueNumber) {
  const number = parsePositiveIssue(issueNumber)
  return ghReadJson(['api', `repos/popcre/shared-db/issues/${number}`])
}

function currentMainSha() {
  const ref = ghReadJson(['api', 'repos/popcre/shared-db/git/ref/heads/main'])
  const sha = ref?.object?.sha
  if (!SHA.test(String(sha ?? ''))) refuse('current main ref is unreadable')
  return sha.toLowerCase()
}

export async function fetchCanonicalProjectMetadata({ accessToken = process.env.SUPABASE_ACCESS_TOKEN, productionRef = PRODUCTION_PROJECT_REF, previewRef = process.env.PREVIEW_PROJECT_REF, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  if (!accessToken) refuse('SUPABASE_ACCESS_TOKEN is unavailable')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) refuse('Management API timeout must be bounded to 1–30000 ms')
  const url = PRODUCTION_PROJECT_URL
  validateProjectMetadata({ requestUrl: url, metadata: { id: PRODUCTION_PROJECT_REF }, productionRef, previewRef })
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    refuse('bounded Management API project identity request failed')
  }
  if (!response?.ok) refuse('bounded Management API project identity request returned a non-success status')
  let metadata
  try { metadata = await response.json() } catch { refuse('Management API project metadata was not valid JSON') }
  return validateProjectMetadata({ requestUrl: url, metadata, previewRef })
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag)
  if (index < 0 || !argv[index + 1]) refuse(`${flag} is required`)
  return argv[index + 1]
}

async function main(argv) {
  const [command, ...args] = argv
  if (command === 'validate-issue') {
    const issue = readIssue(argValue(args, '--issue'))
    validateIssueScope(issue, argValue(args, '--issue'))
    process.stdout.write(`Issue scope verified: #${issue.number}\n`)
    return
  }
  if (command === 'validate-main') {
    const sha = process.env.GITHUB_SHA ?? ''
    const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const ref = process.env.GITHUB_REF ?? ''
    validateMainBinding({ issueNumber: argValue(args, '--issue'), applicationCommitSha: sha, checkoutSha, currentMainSha: currentMainSha(), gitHubRef: ref })
    process.stdout.write(`Current main and checkout verified for ${sha}\n`)
    return
  }
  if (command === 'validate-project') {
    const productionRef = process.env.PRODUCTION_PROJECT_REF
    if (!productionRef) refuse('PRODUCTION_PROJECT_REF is unavailable')
    const target = await fetchCanonicalProjectMetadata({ productionRef })
    const output = args.includes('--output') ? argValue(args, '--output') : null
    if (output) writeFileSync(output, `${JSON.stringify(target, null, 2)}\n`, { mode: 0o600 })
    process.stdout.write(`Management API identity verified: production ${target.source_project_ref}\n`)
    return
  }
  if (command === 'write-proof') {
    const issueNumber = argValue(args, '--issue')
    const sha = process.env.GITHUB_SHA ?? ''
    const checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const gitHubRef = process.env.GITHUB_REF ?? ''
    const currentMain = currentMainSha()
    const issue = readIssue(issueNumber)
    const targetMetadata = JSON.parse(readFileSync(argValue(args, '--project-metadata'), 'utf8'))
    const generatedTypesBytes = readFileSync(argValue(args, '--typescript'))
    const productionProjectRef = process.env.PRODUCTION_PROJECT_REF
    const schemas = process.env.SCHEMAS
    if (!productionProjectRef || !schemas) refuse('production project ref and fixed schema set must be configured')
    const proof = buildGeneratedTypesProof({
      issue, issueNumber, applicationCommitSha: sha, checkoutSha, currentMainSha: currentMain, gitHubRef,
      generatedTypesBytes, schemas, projectRequestUrl: targetMetadata.source_project_url, productionProjectRef,
      projectMetadata: { id: targetMetadata.source_project_ref, name: targetMetadata.project_name, organization_id: targetMetadata.organization_id, region: targetMetadata.region, status: targetMetadata.status },
      previewProjectRef: process.env.PREVIEW_PROJECT_REF,
    })
    writeFileSync(argValue(args, '--output'), `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 })
    process.stdout.write(`Production generated-types proof prepared for issue #${proof.work_issue} at ${proof.application_commit_sha}\n`)
    return
  }
  refuse('choose validate-issue, validate-main, validate-project, or write-proof')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`REFUSED: ${error instanceof GeneratedTypesProofError ? error.message : 'generated-types proof step failed'}\n`)
    process.exitCode = 1
  })
}
