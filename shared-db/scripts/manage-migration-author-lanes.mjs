#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { normalizeObject, parseClaimBlock } from './check-dispatch-collision.mjs'

export const MAX_AUTHOR_LANES = 3
export const DEFAULT_LEASE_HOURS = 12

export class LaneError extends Error {}

export function parseAuthorLease(body, now = new Date()) {
  if (!/```db-claim\s*\n/.test(body)) throw new LaneError('missing fenced db-claim block')
  const claim = parseClaimBlock(body)
  const fence = /```db-author-lease\s*\n([\s\S]*?)```/.exec(body)
  if (!fence) return { ...claim, legacy: true, active: true, owner: null, branch: null, worktree: null, expiresAt: null }

  if (!/^\d{14}$/.test(String(claim.version ?? ''))) throw new LaneError('db-claim version must be exactly 14 digits')
  if (!claim.objects.length) throw new LaneError('db-claim must list at least one exact object')

  const fields = new Map()
  for (const raw of fence[1].split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const match = /^([a-z_]+):\s*(.+)$/.exec(line)
    if (!match || fields.has(match[1])) throw new LaneError('unreadable db-author-lease block')
    fields.set(match[1], match[2].trim())
  }
  for (const required of ['owner', 'branch', 'worktree', 'expires_at']) {
    if (!fields.get(required)) throw new LaneError(`db-author-lease is missing ${required}`)
  }
  const expiresAt = new Date(fields.get('expires_at'))
  if (Number.isNaN(expiresAt.valueOf())) throw new LaneError('db-author-lease expires_at is not a valid ISO timestamp')
  return {
    ...claim,
    legacy: false,
    owner: fields.get('owner'),
    branch: fields.get('branch'),
    worktree: fields.get('worktree'),
    expiresAt,
    active: expiresAt > now,
  }
}

export function assertLaneAvailable(claims, proposedObjects, now = new Date(), { ignoreCapacity = false } = {}) {
  const parsed = claims.map((claim) => {
    try {
      return { ...claim, lease: parseAuthorLease(claim.body, now) }
    } catch (error) {
      throw new LaneError(`claim #${claim.number} is unreadable: ${error.message}`)
    }
  })
  const active = parsed.filter((claim) => !claim.lease.legacy && claim.lease.active)
  if (!ignoreCapacity && active.length >= MAX_AUTHOR_LANES) {
    throw new LaneError(`all ${MAX_AUTHOR_LANES} migration-author lanes are occupied`)
  }
  const wanted = new Set(proposedObjects.map(normalizeObject))
  const collisionHolders = parsed.filter((claim) => claim.lease.legacy || claim.lease.active)
  for (const claim of collisionHolders) {
    const overlap = claim.lease.objects.map(normalizeObject).filter((object) => wanted.has(object))
    if (overlap.length) throw new LaneError(`object collision with claim #${claim.number}: ${overlap.join(', ')}`)
  }
  return { active, stale: parsed.filter((claim) => !claim.lease.legacy && !claim.lease.active) }
}

export function claimBody({ version, objects, owner, branch, worktree, expiresAt }) {
  return [
    '```db-claim',
    `version: ${version}`,
    'objects:',
    ...objects.map((object) => `  - ${normalizeObject(object)}`),
    '```',
    '',
    '```db-author-lease',
    `owner: ${owner}`,
    `branch: ${branch}`,
    `worktree: ${worktree}`,
    `expires_at: ${expiresAt.toISOString()}`,
    '```',
    '',
    'This claim is the authoritative author-lane record. Close it when the PR merges or the work is abandoned.',
    'An expired lease must be closed by `--cleanup-stale`; its migration version remains permanently unavailable.',
  ].join('\n')
}

function ghJson(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }))
}

function openClaims() {
  return ghJson(['issue', 'list', '--repo', 'u2giants/shared-db', '--label', 'db-claim', '--state', 'open', '--limit', '100', '--json', 'number,title,body,url'])
}

function parseArgs(argv) {
  const out = { objects: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[(i += 1)]
    if (arg === '--claim') out.claim = true
    else if (arg === '--audit') out.audit = true
    else if (arg === '--cleanup-stale') out.cleanup = true
    else if (arg === '--task') out.task = next()
    else if (arg === '--objects') out.objects.push(...next().split(',').map((v) => v.trim()).filter(Boolean))
    else if (arg === '--owner') out.owner = next()
    else if (arg === '--branch') out.branch = next()
    else if (arg === '--worktree') out.worktree = next()
    else if (arg === '--lease-hours') out.leaseHours = Number(next())
    else throw new LaneError(`unknown argument: ${arg}`)
  }
  return out
}

export function main(argv, now = new Date()) {
  let options
  try {
    options = parseArgs(argv)
    const claims = openClaims()
    if (options.cleanup) {
      const { stale } = assertLaneAvailable(claims, [], now, { ignoreCapacity: true })
      for (const claim of stale) {
        execFileSync('gh', ['issue', 'close', String(claim.number), '--repo', 'u2giants/shared-db', '--comment', 'Expired migration-author lease closed automatically. Its reserved migration version remains unavailable and will not be reused.'], { stdio: 'inherit' })
      }
      console.log(`Closed ${stale.length} stale author-lane claim(s).`)
      return 0
    }
    const state = assertLaneAvailable(claims, options.objects, now, { ignoreCapacity: options.audit === true })
    if (options.audit) {
      console.log(`${state.active.length}/${MAX_AUTHOR_LANES} migration-author lanes occupied; ${state.stale.length} stale claim(s).`)
      return 0
    }
    if (!options.claim) throw new LaneError('choose --claim, --audit, or --cleanup-stale')
    for (const key of ['task', 'owner', 'branch', 'worktree']) if (!options[key]) throw new LaneError(`--${key} is required`)
    if (!options.objects.length) throw new LaneError('--objects must name every database object exactly')
    const hours = options.leaseHours ?? DEFAULT_LEASE_HOURS
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new LaneError('--lease-hours must be greater than 0 and no more than 24')

    const reservation = JSON.parse(execFileSync(process.execPath, ['scripts/check-dispatch-collision.mjs', '--reserve-version', '--json'], { encoding: 'utf8' }))
    const body = claimBody({ ...options, version: reservation.version, expiresAt: new Date(now.valueOf() + hours * 3600000) })
    const url = execFileSync('gh', ['issue', 'create', '--repo', 'u2giants/shared-db', '--label', 'db-claim', '--title', `CLAIM: ${options.task}`, '--body', body], { encoding: 'utf8' }).trim()
    console.log(JSON.stringify({ version: reservation.version, claim: url, expiresAt: new Date(now.valueOf() + hours * 3600000).toISOString() }, null, 2))
    return 0
  } catch (error) {
    console.error(`REFUSED: ${error.message}`)
    return 2
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2))
