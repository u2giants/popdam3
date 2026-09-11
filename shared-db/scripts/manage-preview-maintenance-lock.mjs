#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquireMutex, acquireRef, EXCLUSIVE_REFS, githubIo, MUTEX_REF, parseQueueScope, releaseOwnedRef } from './manage-migration-author-lanes.mjs'
import { formatLeaseMessage } from './lib/exclusive-lease.mjs'

export class PreviewMaintenanceLockError extends Error {}

export function acquirePreviewMaintenanceLock({ issue, owner, headSha, now = new Date() }, io = githubIo) {
  const number = Number(issue)
  if (!Number.isInteger(number) || number <= 0 || !owner || !/^[0-9a-f]{40}$/i.test(String(headSha ?? ''))) {
    throw new PreviewMaintenanceLockError('acquire requires an issue, owner, and exact 40-character head SHA')
  }
  const mainSha = io.mainSha?.()
  if (!mainSha || headSha !== mainSha) throw new PreviewMaintenanceLockError('preview maintenance requires the exact current main SHA')
  const work = io.getIssue?.(number)
  if (!work || work.state !== 'open') throw new PreviewMaintenanceLockError(`issue #${number} is not open`)
  const scope = parseQueueScope(work.body ?? '')
  if (scope?.status !== 'ready' || scope?.workType !== 'repo-maintenance' || scope?.route !== 'repo-maintenance') {
    throw new PreviewMaintenanceLockError(`issue #${number} is not ready repo-maintenance work`)
  }
  const githubRunId = process.env.GITHUB_RUN_ID
  const githubRunAttempt = process.env.GITHUB_RUN_ATTEMPT
  if (!githubRunId || !githubRunAttempt) throw new PreviewMaintenanceLockError('acquisition must run in GitHub Actions so a crashed holder remains recoverable')

  const holderId = `repo-maintenance:${number}`
  const ownerSha = io.makeOwnerCommit(formatLeaseMessage('preview', {
    requestId: randomUUID(), holderId, owner, headSha, generation: 1,
    acquiredAt: now.toISOString(), pr: null, migrationVersions: [], githubRunId, githubRunAttempt,
  }))
  acquireMutex(ownerSha, io)
  try {
    acquireRef(EXCLUSIVE_REFS.preview, ownerSha, io)
    return { kind: 'preview-maintenance', ref: EXCLUSIVE_REFS.preview, ownerSha, holderId, issue: number, headSha }
  } finally {
    if (io.readRef(MUTEX_REF) === ownerSha) releaseOwnedRef(MUTEX_REF, ownerSha, io)
  }
}

export function releasePreviewMaintenanceLock(ownerSha, io = githubIo) {
  if (!/^[0-9a-f]{40}$/i.test(String(ownerSha ?? ''))) throw new PreviewMaintenanceLockError('release requires the exact acquisition SHA')
  const releaseOwnerSha = io.makeOwnerCommit(`db-coordination preview release-${randomUUID()}`)
  acquireMutex(releaseOwnerSha, io)
  try {
    releaseOwnedRef(EXCLUSIVE_REFS.preview, ownerSha, io)
  } finally {
    if (io.readRef(MUTEX_REF) === releaseOwnerSha) releaseOwnedRef(MUTEX_REF, releaseOwnerSha, io)
  }
}

export function probePreviewMaintenanceLock(ownerSha, io = githubIo) {
  if (!/^[0-9a-f]{40}$/i.test(String(ownerSha ?? ''))) throw new PreviewMaintenanceLockError('probe requires the exact acquisition SHA')
  let current
  try { current = io.readRef(EXCLUSIVE_REFS.preview) }
  catch { return { state: 'unreadable' } }
  if (current === null) return { state: 'released' }
  if (current !== ownerSha) return { state: 'foreign-owner' }
  return { state: 'owned', ownerSha }
}

function args(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (key === '--acquire') out.mode = 'acquire'
    else if (key === '--release') out.mode = 'release'
    else if (key === '--probe') out.mode = 'probe'
    else if (['--issue','--owner','--head-sha','--owner-sha'].includes(key)) out[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i]
    else throw new PreviewMaintenanceLockError(`unknown argument: ${key}`)
  }
  return out
}

export function main(argv, io = githubIo) {
  try {
    const options = args(argv)
    if (options.mode === 'acquire') console.log(JSON.stringify(acquirePreviewMaintenanceLock(options, io), null, 2))
    else if (options.mode === 'release') releasePreviewMaintenanceLock(options.ownerSha, io)
    else if (options.mode === 'probe') console.log(JSON.stringify(probePreviewMaintenanceLock(options.ownerSha, io)))
    else throw new PreviewMaintenanceLockError('choose --acquire, --release, or --probe')
    return 0
  } catch (error) {
    console.error(`REFUSED: ${error.message}`)
    return 2
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2))
