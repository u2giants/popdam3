#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { contractHash, contractRef, validateContract } from './agent-work-contract.mjs'

export class GitEvidenceError extends Error {}

const SHA_PATTERN = /^[0-9a-f]{40}$/i
const METADATA_FILES = Object.freeze(['.agent/completion.json', '.agent/contract.json'])

export function classifyEvidencePair(changedFiles) {
  const changed = new Set(changedFiles)
  const count = METADATA_FILES.filter(file => changed.has(file)).length
  if (count === 0) return 'inherited'
  if (count === METADATA_FILES.length) return 'current'
  return 'partial'
}

export function prChangedFiles(base, head, io) {
  const mergeBase = io.mergeBase(base, head)
  if (!SHA_PATTERN.test(mergeBase)) throw new GitEvidenceError('could not resolve an exact merge base for PR evidence classification')
  return io.changedFiles(mergeBase, head)
}

export function verifyGitEvidence({ contract, report, prBaseSha, prHeadSha }, io) {
  if (!SHA_PATTERN.test(String(contract.base_sha ?? ''))) throw new GitEvidenceError('PR evidence requires contract.base_sha to be an exact 40-character SHA')
  if (!SHA_PATTERN.test(String(report.head_sha ?? ''))) throw new GitEvidenceError('PR evidence requires report.head_sha to be an exact 40-character implementation SHA')
  if (!SHA_PATTERN.test(String(prBaseSha ?? ''))) throw new GitEvidenceError('PR evidence requires the exact 40-character PR base SHA')
  if (!SHA_PATTERN.test(String(prHeadSha ?? ''))) throw new GitEvidenceError('PR evidence requires the exact 40-character PR head SHA')
  if (!io.isAncestor(contract.base_sha, report.head_sha)) throw new GitEvidenceError('contract base_sha is not an ancestor of the reported implementation head')
  if (!io.isAncestor(prBaseSha, report.head_sha)) throw new GitEvidenceError('checked PR base is not an ancestor of the reported implementation head; refresh the branch before relying on its evidence')
  if (!io.isAncestor(report.head_sha, prHeadSha)) throw new GitEvidenceError('reported implementation head is not an ancestor of the checked PR head')

  const actualFiles = [...io.changedFiles(prBaseSha, report.head_sha)].sort()
  const reportedFiles = [...report.files_changed].sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(reportedFiles)) {
    throw new GitEvidenceError(`reported files_changed does not match Git: expected [${actualFiles.join(', ')}], got [${reportedFiles.join(', ')}]`)
  }

  const afterImplementation = [...io.changedFiles(report.head_sha, prHeadSha)].sort()
  if (afterImplementation.length !== METADATA_FILES.length || afterImplementation.some((file, index) => file !== METADATA_FILES[index])) {
    throw new GitEvidenceError(`only the two .agent evidence files may follow report.head_sha; found [${afterImplementation.join(', ')}]`)
  }
  const expectedRef = contractRef(contract.work_issue, contract.generation ?? 1)
  if (report.contract_ref !== expectedRef) throw new GitEvidenceError(`completion report must name its contract's exact immutable ref ${expectedRef}`)
  const published = validateContract(io.readPublishedContract(report.contract_ref))
  if (contractHash(published) !== contractHash(contract)) throw new GitEvidenceError('checked-in contract does not match the immutable contract published before the work')
  return true
}

export const gitIo = {
  isAncestor(ancestor, descendant) {
    try { execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' }); return true }
    catch { return false }
  },
  changedFiles(from, to) {
    return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACDMRTUXB', from, to], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
  },
  mergeBase(base, head) {
    return execFileSync('git', ['merge-base', base, head], { encoding: 'utf8' }).trim()
  },
  readPublishedContract(ref) {
    execFileSync('git', ['fetch', '--quiet', '--no-tags', 'origin', ref], { stdio: 'ignore' })
    const message = execFileSync('git', ['show', '--format=%B', '--no-patch', 'FETCH_HEAD'], { encoding: 'utf8' })
    const body = message.split(/\r?\n/).slice(2).join('\n').trim()
    try { return JSON.parse(body) } catch { throw new GitEvidenceError(`${ref} does not carry readable immutable contract JSON`) }
  },
}

export function main(argv, io = gitIo) {
  try {
    if (argv[0] === '--classify-evidence-pair') {
      const baseIndex = argv.indexOf('--pr-base-sha')
      const headIndex = argv.indexOf('--pr-head-sha')
      const prBaseSha = baseIndex >= 0 ? argv[baseIndex + 1] : undefined
      const prHeadSha = headIndex >= 0 ? argv[headIndex + 1] : undefined
      if (!prBaseSha || !prHeadSha) throw new GitEvidenceError('usage: --classify-evidence-pair --pr-base-sha <sha> --pr-head-sha <sha>')
      console.log(classifyEvidencePair(prChangedFiles(prBaseSha, prHeadSha, io)))
      return 0
    }
    const values = {}
    for (let i = 0; i < argv.length; i += 2) values[argv[i]] = argv[i + 1]
    if (!values['--contract-file'] || !values['--report-file'] || !values['--pr-base-sha'] || !values['--pr-head-sha']) throw new GitEvidenceError('usage: --contract-file <path> --report-file <path> --pr-base-sha <sha> --pr-head-sha <sha>')
    const contract = JSON.parse(readFileSync(values['--contract-file'], 'utf8'))
    const report = JSON.parse(readFileSync(values['--report-file'], 'utf8'))
    verifyGitEvidence({ contract, report, prBaseSha: values['--pr-base-sha'], prHeadSha: values['--pr-head-sha'] }, io)
    console.log('Git evidence matches the contract and completion report.')
    return 0
  } catch (failure) {
    console.error(failure.message)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2))
