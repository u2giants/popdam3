#!/usr/bin/env node
// Live no-database-preview fast lane (issue #3027, programme ai-devops#401 Step 2A).
//
// Sender: an authenticated maintainer builds the sender-form classification for a live pull
// request from authenticated Git content and embeds it in the pull request body.
// Receiver: the documents-only authorization workflow (trusted base code, report-only) reads
// that block from a trusted author, and admits it through databasePreviewAdmission, which
// re-reads the live pull request and its files and fails closed on any mismatch.
//
// The receiver never grants a merge status and never blocks one: its only output is a
// decision line in the log and the step summary. Absent, untrusted or invalid evidence is
// always DATABASE_PREVIEW_REQUIRED.
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, sha256 } from './evidence-bundle.mjs'
import { databasePreviewAdmission, githubIo, withDatabasePreviewClassificationFile } from '../manage-migration-author-lanes.mjs'

export const BLOCK_LANG = 'db-preview-classification'
export const TRUSTED_ASSOCIATIONS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR'])
export const INVALIDATED_BY = Object.freeze(['file-content-change', 'file-set-change', 'impact-evidence-change', 'applicable-check-change', 'classifier-version-change'])
const NO_PREVIEW_IMPACTS = new Set(['documentation'])

export function buildSenderClassification(inspectedFiles, { base_sha, head_sha, applicable_checks = ['Documents-only merge authorization'] }) {
  if (!Array.isArray(inspectedFiles) || !inspectedFiles.length) throw new Error('live changed-file snapshot is empty')
  const files = inspectedFiles.map((file) => ({
    path: file.path,
    sha256: file.sha256,
    mode: file.mode,
    impact: file.impact,
    reason: NO_PREVIEW_IMPACTS.has(file.impact) ? 'documentation-only change' : `live impact is ${file.impact}`,
    change_type: file.status === 'removed' ? 'deleted' : 'present',
  })).sort((a, b) => a.path.localeCompare(b.path))
  const decision = files.every((file) => NO_PREVIEW_IMPACTS.has(file.impact)) ? 'NO_DATABASE_PREVIEW' : 'DATABASE_PREVIEW_REQUIRED'
  const inspected_digest = sha256(canonicalJson({ classifier_version: 1, base_sha, head_sha, files, applicable_checks }))
  return { schema_version: 1, decision, reason_code: 'proven_non_database_change', base_sha, head_sha, inspected_digest, files, applicable_checks, invalidated_by: [...INVALIDATED_BY] }
}

export function renderBlock(classification, issue) {
  return ['```' + BLOCK_LANG, JSON.stringify({ issue: Number(issue), classification }), '```'].join('\n')
}

/** Exactly one fenced block, or null. More than one is ambiguous and yields null. */
export function extractBlock(body) {
  const matches = [...String(body ?? '').matchAll(new RegExp('```' + BLOCK_LANG + '\\s*\\n([\\s\\S]*?)\\n```', 'g'))]
  if (matches.length !== 1) return null
  try {
    const parsed = JSON.parse(matches[0][1])
    if (!Number.isInteger(parsed?.issue) || parsed.issue <= 0 || !parsed.classification || typeof parsed.classification !== 'object') return null
    return parsed
  } catch { return null }
}

export function receive({ pr, io = githubIo, tempDir = () => mkdtempSync(path.join(os.tmpdir(), 'preview-route-')) }) {
  const required = (reason) => ({ decision: 'DATABASE_PREVIEW_REQUIRED', reason, pr: Number(pr) })
  let live
  try { live = io.getPr(Number(pr)) } catch (error) { return required(`live pull request is unreadable: ${error.message}`) }
  if (!TRUSTED_ASSOCIATIONS.includes(live?.author_association)) return required(`pull request author association ${live?.author_association ?? 'unknown'} is not trusted`)
  const block = extractBlock(live.body)
  if (!block) return required('no single db-preview-classification block in the pull request body')
  const file = path.join(tempDir(), 'classification.json')
  writeFileSync(file, JSON.stringify(block.classification))
  try {
    const admission = databasePreviewAdmission({ preparePreviewDispatch: block.issue, issue: block.issue, pr: Number(pr) }, withDatabasePreviewClassificationFile(io, file))
    return { ...admission, pr: Number(pr), issue: block.issue }
  } catch (error) {
    return { ...required(`evidence refused: ${error.message}`), issue: block.issue }
  }
}

export function main(argv = process.argv.slice(2), { io = githubIo, stdout = console.log, env = process.env } = {}) {
  const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const pr = Number(value('--pr'))
  if (!Number.isInteger(pr) || pr <= 0) { stdout('usage: --sender --pr <n> --issue <n> | --receiver --pr <n>'); return 2 }
  if (argv.includes('--sender')) {
    const issue = Number(value('--issue'))
    if (!Number.isInteger(issue) || issue <= 0) { stdout('--sender requires --issue'); return 2 }
    const live = io.getPr(pr)
    const files = io.databasePreviewFileSnapshot(pr, live.base.sha, live.head.sha)
    stdout(renderBlock(buildSenderClassification(files, { base_sha: live.base.sha, head_sha: live.head.sha }), issue))
    return 0
  }
  if (argv.includes('--receiver')) {
    const result = receive({ pr, io })
    const line = `preview-route receiver: PR #${pr} decision=${result.decision}${result.next_action ? ` next_action=${result.next_action}` : ''}${result.classification_digest ? ` classification_digest=${result.classification_digest}` : ''} reason=${result.reason}`
    stdout(line)
    stdout(JSON.stringify(result))
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### No-database-preview fast lane (report-only)\n\n${line}\n`)
    return 0
  }
  stdout('one of --sender or --receiver is required')
  return 2
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main()
