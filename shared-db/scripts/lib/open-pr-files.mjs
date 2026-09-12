#!/usr/bin/env node
// ONE read of every open pull request's changed files, shared by the two
// cross-PR collision checks.
//
// WHY THIS EXISTS
// ---------------
// `pr-object-collision.yml` ran two checks that each listed every open pull
// request and then read each one's detail and file list again, and the source
// check also read every pull request's timeline -- about 110-130 API calls per
// push. With about ten active pull requests the Actions installation token ran
// out of quota and production applies failed with "API rate limit exceeded".
//
// The job now gathers this snapshot once, writes it to a file, and both checks
// read it (OPEN_PR_FILES_SNAPSHOT). A check run without the variable -- the
// guarded merge, a local run -- gathers the same snapshot itself, through the
// same code, so there is exactly one definition of "the open pull requests and
// their complete file lists".
//
// NOTHING IS RELAXED. Every pull request a check inspects still has its file
// list proved complete against the detail `changed_files` count, still refuses
// GitHub's 3000-file cap, and any unreadable read still fails closed. Drafts
// other than the current pull request carry no file list because neither check
// inspects them (neither ever did).

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { ghJson } from './github-transport.mjs'

export class OpenPullFilesError extends Error {}

export const SNAPSHOT_ENV = 'OPEN_PR_FILES_SNAPSHOT'
export const SNAPSHOT_SCHEMA = 'open-pr-files/v1'

function defaultRead(args) {
  return ghJson(args, {
    maxBuffer: 32 * 1024 * 1024,
    wrapError: (detail) => new OpenPullFilesError(`gh ${args.join(' ')} failed: ${detail}`),
  })
}

function paginated(read, endpoint) {
  const pages = read(['api', '--paginate', '--slurp', endpoint])
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new OpenPullFilesError(`gh api --paginate ${endpoint} did not return complete paginated JSON`)
  }
  return pages.flat()
}

/** Detail plus the complete, count-proved file list of one pull request. */
export function pullWithFiles(repo, number, read = defaultRead) {
  const pr = read(['api', `repos/${repo}/pulls/${number}`])
  if (!pr || Number(pr.number) !== Number(number)) {
    throw new OpenPullFilesError(`PR #${number} returned unreadable detail metadata`)
  }
  const files = paginated(read, `repos/${repo}/pulls/${number}/files?per_page=100`)
  if (!Number.isInteger(pr.changed_files)) throw new OpenPullFilesError(`PR #${number} has no trustworthy changed_files count`)
  if (pr.changed_files >= 3000) throw new OpenPullFilesError(`PR #${number} reaches GitHub's 3000-file limit`)
  if (files.length !== pr.changed_files) {
    throw new OpenPullFilesError(`PR #${number} returned ${files.length} of ${pr.changed_files} changed files`)
  }
  return {
    number: pr.number,
    title: pr.title,
    draft: Boolean(pr.draft),
    created_at: pr.created_at,
    head: { sha: pr.head?.sha ?? null, ref: pr.head?.ref ?? null },
    base: { sha: pr.base?.sha ?? null, ref: pr.base?.ref ?? null },
    changed_files: pr.changed_files,
    files: files.map((file) => ({
      filename: file.filename,
      previous_filename: file.previous_filename ?? null,
      status: file.status,
    })),
  }
}

/**
 * `listed` holds the open-list row's own values (draft, title, head, created_at)
 * because that is what both checks used for the OTHER pull requests before the
 * snapshot existed; `detail` is the current pull request's own detail read.
 */
export function gatherOpenPullFiles(repo, { current, read = defaultRead } = {}) {
  const currentNumber = Number(current)
  if (!Number.isInteger(currentNumber) || currentNumber <= 0) throw new OpenPullFilesError('pull request number is unavailable')
  const open = paginated(read, `repos/${repo}/pulls?state=open&per_page=100`)
  const pulls = []
  let currentEntry = null
  for (const row of open) {
    const number = Number(row.number)
    const listed = {
      title: row.title,
      draft: Boolean(row.draft),
      created_at: row.created_at,
      headSha: row.head?.sha ?? row.head?.ref ?? null,
    }
    if (number === currentNumber) {
      currentEntry = { ...pullWithFiles(repo, number, read), listed }
      continue
    }
    if (listed.draft) {
      pulls.push({ number, listed, files: null })
      continue
    }
    pulls.push({ ...pullWithFiles(repo, number, read), listed })
  }
  currentEntry ??= { ...pullWithFiles(repo, currentNumber, read), listed: null }
  return { schema: SNAPSHOT_SCHEMA, repo, current: currentEntry, others: pulls }
}

export function validateSnapshot(snapshot, repo, current) {
  const fail = (why) => { throw new OpenPullFilesError(`open pull request snapshot is unusable: ${why}`) }
  if (snapshot?.schema !== SNAPSHOT_SCHEMA) fail('unknown schema')
  if (snapshot.repo !== repo) fail(`it describes ${snapshot.repo}, not ${repo}`)
  if (Number(snapshot.current?.number) !== Number(current)) fail(`it was gathered for PR #${snapshot.current?.number}, not #${current}`)
  if (!Array.isArray(snapshot.current.files)) fail('the current pull request has no file list')
  if (!Array.isArray(snapshot.others)) fail('it has no open pull request list')
  for (const pr of snapshot.others) {
    if (!pr?.listed || !Number.isInteger(Number(pr.number))) fail('an open pull request row is malformed')
    if (!pr.listed.draft && !Array.isArray(pr.files)) fail(`ready PR #${pr.number} has no file list`)
  }
  return snapshot
}

/** The snapshot named by OPEN_PR_FILES_SNAPSHOT, or a fresh gather when unset. */
export function loadOpenPullFiles(repo, current, { env = process.env, read = defaultRead } = {}) {
  const file = env[SNAPSHOT_ENV]
  if (!file) return gatherOpenPullFiles(repo, { current, read })
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new OpenPullFilesError(`open pull request snapshot ${file} is unreadable: ${error.message}`)
  }
  return validateSnapshot(parsed, repo, current)
}

export function currentPullNumber(env = process.env) {
  let number = Number(env.PR_NUMBER)
  if (!number && env.GITHUB_EVENT_PATH) {
    try { number = Number(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).pull_request?.number) } catch { /* refused below */ }
  }
  return number || null
}

function main(argv = process.argv.slice(2), env = process.env) {
  const outAt = argv.indexOf('--out')
  const out = outAt >= 0 ? argv[outAt + 1] : null
  if (!out) { console.error('usage: open-pr-files.mjs --out <file>'); return 2 }
  try {
    const repo = env.GITHUB_REPOSITORY
    if (!repo) throw new OpenPullFilesError('GITHUB_REPOSITORY is not set')
    const snapshot = gatherOpenPullFiles(repo, { current: currentPullNumber(env) })
    writeFileSync(out, JSON.stringify(snapshot))
    console.log(`Gathered PR #${snapshot.current.number} and ${snapshot.others.length} other open pull request(s).`)
    return 0
  } catch (error) {
    console.error(`ERROR: open pull request snapshot could not be gathered: ${error.message}`)
    return 2
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main())
