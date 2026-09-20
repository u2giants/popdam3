#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { contractHash, contractRef, validateContract } from './agent-work-contract.mjs'
import { acceptableEvidencePairs, LEGACY_PAIR, resolveEvidencePair } from './lib/agent-evidence-paths.mjs'

export class GitEvidenceError extends Error {}

const SHA_PATTERN = /^[0-9a-f]{40}$/i
// Every path decision goes through scripts/lib/agent-evidence-paths.mjs (#2708).
export function classifyEvidencePair(changedFiles) {
  return resolveEvidencePair(changedFiles).state
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
  if (!io.isAncestor(report.head_sha, prHeadSha)) throw new GitEvidenceError('reported implementation head is not an ancestor of the checked PR head')

  // THE EVIDENCE MUST NAME THE BASE IT WAS MEASURED AT (#2845).
  //
  // When a branch is refreshed from main after its pair was written, the pair
  // kept the old base and the old head while its recorded check results stayed
  // presented as current. Nothing refused it. An evidence pair naming a base
  // nobody is reviewing is worse than an absent one, because it reads as
  // coverage and survives a skim -- PRs #2825 and #2842 both carried it, in two
  // different lanes.
  //
  // The published contract is immutable, so the CURRENT base is recorded by the
  // completion report, which is regenerated at every refresh anyway. A report
  // that does not carry one is judged on its contract's base: a branch that
  // never refreshed still passes unchanged, and a refreshed one must rebind.
  const mergeBase = io.mergeBase(prBaseSha, prHeadSha)
  if (!SHA_PATTERN.test(String(mergeBase ?? ''))) throw new GitEvidenceError('could not resolve an exact merge base for this pull request')
  const evidenceBase = String(report.base_sha ?? contract.base_sha)
  if (!SHA_PATTERN.test(evidenceBase)) throw new GitEvidenceError('PR evidence requires an exact 40-character base SHA')
  if (evidenceBase !== mergeBase) {
    throw new GitEvidenceError(`agent evidence is anchored to a superseded base: it records ${evidenceBase} but this pull request's merge base with main is ${mergeBase}. Regenerate the evidence pair at the current head after refreshing (node scripts/refresh-code-pr-branch.mjs), so its recorded checks name the commit under review (#2845).`)
  }
  if (!io.isAncestor(mergeBase, report.head_sha)) throw new GitEvidenceError('the current merge base is not an ancestor of the reported implementation head; refresh the branch before relying on its evidence')

  const actualFiles = [...io.changedFiles(mergeBase, report.head_sha)].sort()
  const reportedFiles = [...report.files_changed].sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(reportedFiles)) {
    const toAdd = actualFiles.filter((file) => !reportedFiles.includes(file))
    const extra = reportedFiles.filter((file) => !actualFiles.includes(file))
    // Name which side is which: Git is the truth, the report is what to fix (#498 item 11).
    throw new GitEvidenceError(`reported files_changed does not match Git: Git changed [${actualFiles.join(', ')}] but .agent/completion.json files_changed lists [${reportedFiles.join(', ')}]; add to the report [${toAdd.join(', ')}], remove from the report [${extra.join(', ')}]`)
  }

  // THE TAIL IS THIS PULL REQUEST'S OWN PAIR, AND NOBODY ELSE'S (#2708). The
  // keyed path for this contract's issue and generation is preferred; the
  // legacy fixed pair is still accepted so open pull requests do not all have
  // to rewrite their evidence at once.
  const afterImplementation = [...io.changedFiles(report.head_sha, prHeadSha)].sort()
  const allowed = acceptableEvidencePairs(contract)
  const matches = allowed.some((pair) => afterImplementation.length === pair.length && afterImplementation.every((file, index) => file === pair[index]))
  if (!matches) {
    throw new GitEvidenceError(`only this pull request's own two evidence files may follow report.head_sha; expected [${allowed[0].join(', ')}] (or the legacy [${LEGACY_PAIR.join(', ')}]) but found [${afterImplementation.join(', ')}]`)
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
  revParse(ref) {
    return execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim()
  },
  readPublishedContract(ref) {
    execFileSync('git', ['fetch', '--quiet', '--no-tags', 'origin', ref], { stdio: 'ignore' })
    const message = execFileSync('git', ['show', '--format=%B', '--no-patch', 'FETCH_HEAD'], { encoding: 'utf8' })
    const body = message.split(/\r?\n/).slice(2).join('\n').trim()
    try { return JSON.parse(body) } catch { throw new GitEvidenceError(`${ref} does not carry readable immutable contract JSON`) }
  },
}

// ISSUE #2998 item 2 -- derive the two git-derivable completion fields instead of
// typing them.
//
// Observed: roughly FIVE separate PR failures in one session, every one a mismatch
// between a hand-written `files_changed` / `head_sha` and what git actually contained.
// None was a real defect in the work; each cost a full red-check cycle to discover and
// a push to fix. A value that can be derived should never be typed.
//
// Only those two fields are touched. Everything else in the report -- outcome, checks,
// db_reads, db_writes, assumptions -- is a claim about the work that git cannot know,
// so it is carried through untouched and still has to be authored and still has to
// satisfy `--validate-completion`. This makes NO check optional; it removes a
// transcription step that was only ever a source of wrong answers.
export function deriveGitFacts(report, { base, head }, io = gitIo) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new GitEvidenceError('--derive-git-facts needs a readable completion report object')
  const mergeBase = io.mergeBase(base, head)
  if (!SHA_PATTERN.test(mergeBase)) throw new GitEvidenceError(`could not resolve an exact merge base between ${base} and ${head}`)
  const resolved = io.revParse ? io.revParse(head) : head
  if (!SHA_PATTERN.test(String(resolved))) throw new GitEvidenceError(`could not resolve ${head} to an exact 40-character implementation commit`)
  const files = io.changedFiles(mergeBase, head)
  if (!Array.isArray(files)) throw new GitEvidenceError('git did not return a readable changed-file list')
  return { ...report, head_sha: String(resolved).toLowerCase(), files_changed: [...files].sort() }
}

export function main(argv, io = gitIo) {
  try {
    if (argv[0] === '--derive-git-facts') {
      const values = {}
      for (let i = 1; i < argv.length; i += 1) {
        if (argv[i] === '--write') { values['--write'] = true; continue }
        values[argv[i]] = argv[i + 1]; i += 1
      }
      const reportFile = values['--report-file'] ?? '.agent/completion.json'
      const base = values['--base'] ?? 'origin/main'
      const head = values['--head'] ?? 'HEAD'
      let report
      try { report = JSON.parse(readFileSync(reportFile, 'utf8')) }
      catch (readError) { throw new GitEvidenceError(`${reportFile} is not readable JSON: ${readError.message}`) }
      const derived = deriveGitFacts(report, { base, head }, io)
      const text = `${JSON.stringify(derived, null, 2)}
`
      if (values['--write']) { writeFileSync(reportFile, text); console.log(`Derived head_sha and files_changed from git into ${reportFile}.`) }
      else console.log(text.trimEnd())
      return 0
    }
    if (argv[0] === '--classify-evidence-pair') {
      const baseIndex = argv.indexOf('--pr-base-sha')
      const headIndex = argv.indexOf('--pr-head-sha')
      const prBaseSha = baseIndex >= 0 ? argv[baseIndex + 1] : undefined
      const prHeadSha = headIndex >= 0 ? argv[headIndex + 1] : undefined
      if (!prBaseSha || !prHeadSha) throw new GitEvidenceError('usage: --classify-evidence-pair --pr-base-sha <sha> --pr-head-sha <sha>')
      console.log(classifyEvidencePair(prChangedFiles(prBaseSha, prHeadSha, io)))
      return 0
    }
    if (argv[0] === '--resolve-evidence-pair') {
      const baseIndex = argv.indexOf('--pr-base-sha')
      const headIndex = argv.indexOf('--pr-head-sha')
      const prBaseSha = baseIndex >= 0 ? argv[baseIndex + 1] : undefined
      const prHeadSha = headIndex >= 0 ? argv[headIndex + 1] : undefined
      if (!prBaseSha || !prHeadSha) throw new GitEvidenceError('usage: --resolve-evidence-pair --pr-base-sha <sha> --pr-head-sha <sha>')
      const resolved = resolveEvidencePair(prChangedFiles(prBaseSha, prHeadSha, io))
      // One line the shell can read without a JSON parser: state, contract, report.
      console.log([resolved.state, resolved.contract ?? '', resolved.completion ?? ''].join(' '))
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
