#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gatherOpenPrObjects, normalizeObject, parseClaimBlock } from './check-dispatch-collision.mjs'

export const REPO = 'u2giants/shared-db'
export const MAX_AUTHOR_LANES = 3
export const DEFAULT_LEASE_HOURS = 12
export const MUTEX_REF = 'refs/db-coordination/author-acquisition'
export const EXCLUSIVE_REFS = Object.freeze({
  preview: 'refs/db-coordination/preview',
  merge: 'refs/db-coordination/merge',
  production: 'refs/db-coordination/production',
})

export class LaneError extends Error {}

const CLAIM_KINDS = new Set(['schema','table','column','view','materialized view','function','procedure','trigger','policy','type','domain','sequence','index','publication','storage bucket'])
export function validateClaimObjects(objects) {
  const normalized = objects.map(normalizeObject)
  if (new Set(normalized).size !== normalized.length) throw new LaneError('duplicate object claims are not allowed')
  for (const object of [...normalized]) {
    const match = /^column ([a-z_][a-z0-9_$]*\.[a-z_][a-z0-9_$]*)\.[a-z_][a-z0-9_$]*$/.exec(object)
    if (match && !normalized.includes(`table ${match[1]}`)) normalized.push(`table ${match[1]}`)
  }
  if (!normalized.length) throw new LaneError('at least one exact object is required')
  for (const object of normalized) {
    const kind = [...CLAIM_KINDS].sort((a,b)=>b.length-a.length).find((k)=>object.startsWith(`${k} `))
    if (!kind) throw new LaneError(`unknown object kind in claim: ${object}`)
    const target = object.slice(kind.length + 1)
    const ident = '[a-z_][a-z0-9_$]*'
    const qualified = new RegExp(`^${ident}\\.${ident}$`)
    const namedOn = new RegExp(`^${ident} on ${ident}\\.${ident}$`)
    if (kind === 'schema' || kind === 'publication' || kind === 'storage bucket') {
      if (!new RegExp(`^${ident}$`).test(target)) throw new LaneError(`claim must name one exact ${kind}: ${object}`)
    } else if (kind === 'trigger' || kind === 'policy') {
      if (!namedOn.test(target)) throw new LaneError(`claim must use "${kind} name on schema.table": ${object}`)
    } else if (kind === 'column') {
      if (!new RegExp(`^${ident}\\.${ident}\\.${ident}$`).test(target)) throw new LaneError(`claim must use "column schema.table.column": ${object}`)
    } else if (!qualified.test(target)) throw new LaneError(`claim must use a schema-qualified exact name: ${object}`)
  }
  return normalized
}

export function parseAuthorLease(body, now = new Date()) {
  if (!/```db-claim\s*\n/.test(body)) throw new LaneError('missing fenced db-claim block')
  const claim = parseClaimBlock(body)
  if (!claim) throw new LaneError('unreadable fenced db-claim block')
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
  return { ...claim, legacy: false, owner: fields.get('owner'), branch: fields.get('branch'), worktree: fields.get('worktree'), expiresAt, active: expiresAt > now }
}

export function assertLaneAvailable(claims, proposedObjects, now = new Date(), { ignoreCapacity = false, prSources = [] } = {}) {
  const parsed = claims.map((claim) => {
    try { return { ...claim, lease: parseAuthorLease(claim.body, now) } }
    catch (error) { throw new LaneError(`claim #${claim.number} is unreadable: ${error.message}`) }
  })
  // Legacy claims consume capacity. An expiry never releases object protection;
  // cleanup must close the issue explicitly before another author can touch it.
  const occupied = parsed
  if (!ignoreCapacity && occupied.length >= MAX_AUTHOR_LANES) throw new LaneError(`all ${MAX_AUTHOR_LANES} migration-author lanes are occupied`)
  const wanted = new Set(proposedObjects.map(normalizeObject))
  for (const holder of [...parsed.map((c) => ({ label: `claim #${c.number}`, objects: c.lease.objects })), ...prSources]) {
    const overlap = (holder.objects ?? []).map(normalizeObject).filter((object) => wanted.has(object))
    if (overlap.length) throw new LaneError(`object collision with ${holder.label}: ${[...new Set(overlap)].join(', ')}`)
  }
  return { active: occupied, stale: parsed.filter((claim) => !claim.lease.legacy && !claim.lease.active) }
}

export function claimBody({ version, objects, owner, branch, worktree, expiresAt }) {
  return ['```db-claim', `version: ${version}`, 'objects:', ...objects.map((o) => `  - ${normalizeObject(o)}`), '```', '', '```db-author-lease', `owner: ${owner}`, `branch: ${branch}`, `worktree: ${worktree}`, `expires_at: ${expiresAt.toISOString()}`, '```', '', 'This claim remains authoritative and occupies a lane until explicitly released.', 'Expiry is an audit warning, not an automatic release. The migration version is permanent and is never reused.'].join('\n')
}

function gh(args) {
  try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) }
  catch (error) { throw new LaneError(`GitHub command failed: gh ${args.join(' ')}: ${error.stderr || error.message}`) }
}
function ghJson(args) {
  const raw = gh(args)
  try { return JSON.parse(raw) } catch { throw new LaneError(`GitHub returned unreadable JSON for gh ${args.join(' ')}`) }
}
function ghPaginated(endpoint) {
  const pages = ghJson(['api', '--paginate', '--slurp', endpoint])
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new LaneError(`GitHub pagination for ${endpoint} was incomplete or malformed`)
  return pages.flat()
}

export const githubIo = {
  openClaims() {
    const rows = ghPaginated(`repos/${REPO}/issues?state=open&labels=db-claim&per_page=100`)
    return rows.filter((x) => !x.pull_request).map((x) => ({ number: x.number, title: x.title, body: x.body, url: x.html_url }))
  },
  prSources() { return gatherOpenPrObjects(REPO) },
  openPulls() { return ghPaginated(`repos/${REPO}/pulls?state=open&per_page=100`) },
  getPr(number) { return ghJson(['api', `repos/${REPO}/pulls/${number}`]) },
  mainSha() { return ghJson(['api', `repos/${REPO}/git/ref/heads/main`])?.object?.sha ?? null },
  makeOwnerCommit(message) {
    const head = ghJson(['api', `repos/${REPO}/git/ref/heads/main`])?.object?.sha
    if (!head) throw new LaneError('GitHub main ref has no commit SHA')
    const tree = ghJson(['api', `repos/${REPO}/git/commits/${head}`])?.tree?.sha
    if (!tree) throw new LaneError('GitHub main commit has no tree SHA')
    const commit = ghJson(['api', '-X', 'POST', `repos/${REPO}/git/commits`, '-f', `message=${message}`, '-f', `tree=${tree}`, '-f', `parents[]=${head}`])
    if (!commit?.sha) throw new LaneError('GitHub did not create an ownership commit')
    return commit.sha
  },
  createRef(ref, sha) {
    try { gh(['api', '-X', 'POST', `repos/${REPO}/git/refs`, '-f', `ref=${ref}`, '-f', `sha=${sha}`]); return true }
    catch (error) { if (/reference already exists/i.test(error.message)) return false; throw error }
  },
  readRef(ref) {
    const short = ref.replace(/^refs\//, '')
    try { return ghJson(['api', `repos/${REPO}/git/ref/${short}`])?.object?.sha ?? null }
    catch (error) { if (/HTTP 404|not found/i.test(error.message)) return null; throw error }
  },
  deleteRef(ref) { gh(['api', '-X', 'DELETE', `repos/${REPO}/git/refs/${ref.replace(/^refs\//, '')}`]) },
  reserveVersion() { return JSON.parse(execFileSync(process.execPath, ['scripts/check-dispatch-collision.mjs', '--reserve-version', '--json'], { encoding: 'utf8' })) },
  createClaim(title, body) { return gh(['issue', 'create', '--repo', REPO, '--label', 'db-claim', '--title', `CLAIM: ${title}`, '--body', body]).trim() },
  closeClaim(number) { gh(['issue', 'close', String(number), '--repo', REPO, '--comment', 'Expired migration-author lease closed by guarded cleanup. Its migration version remains unavailable.']) },
}

export function acquireRef(ref, ownerSha, io = githubIo) {
  if (!io.createRef(ref, ownerSha)) throw new LaneError(`${ref} is occupied`)
  if (io.readRef(ref) !== ownerSha) throw new LaneError(`${ref} ownership could not be proved after acquisition`)
}

export function acquireMutex(ownerSha, io = githubIo, attempts = 100) {
  for (let attempt=1; attempt<=attempts; attempt++) {
    try { acquireRef(MUTEX_REF,ownerSha,io);return }
    catch(error) {
      if(!/occupied/.test(error.message) || attempt===attempts)throw error
      // A mutex is held only for GitHub reads plus one issue creation. Waiting
      // here lets simultaneous unrelated authors serialize acquisition and then
      // continue authoring concurrently.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50)
    }
  }
}

export function releaseOwnedRef(ref, ownerSha, io = githubIo) {
  const actual = io.readRef(ref)
  if (actual === null) return false
  if (actual !== ownerSha) throw new LaneError(`refusing to release ${ref}: it belongs to another owner`)
  io.deleteRef(ref)
  const after = io.readRef(ref)
  if (after === ownerSha) throw new LaneError(`release of ${ref} could not be proved; do not retry blindly`)
  // A different SHA means another contender acquired the static ref after our
  // successful delete. That proves our ownership ended; never delete it again.
  return true
}

export function acquireAuthorLane(options, now = new Date(), io = githubIo) {
  options = { ...options, objects: validateClaimObjects(options.objects) }
  const requestId = options.requestId ?? randomUUID()
  const ownerSha = io.makeOwnerCommit(`db-coordination author-acquisition ${requestId}`)
  acquireMutex(ownerSha, io, options.mutexAttempts ?? 100)
  try {
    const claims = io.openClaims()
    const prSources = io.prSources()
    assertLaneAvailable(claims, options.objects, now, { prSources })
    const reservation = io.reserveVersion()
    const expiresAt = new Date(now.valueOf() + options.leaseHours * 3600000)
    const body = claimBody({ ...options, version: reservation.version, expiresAt })
    const url = io.createClaim(options.task, body)
    return { version: reservation.version, claim: url, expiresAt: expiresAt.toISOString(), requestId }
  } finally {
    releaseOwnedRef(MUTEX_REF, ownerSha, io)
  }
}

export function acquireExclusive(kind, metadata, io = githubIo) {
  const ref = EXCLUSIVE_REFS[kind]
  if (!ref) throw new LaneError(`unknown exclusive lane: ${kind}`)
  if (!metadata.owner || !metadata.headSha || (kind !== 'production' && !metadata.pr)) throw new LaneError('exclusive lane requires owner, exact head SHA, and a PR number except for production')
  const requestId = metadata.requestId ?? randomUUID()
  const ownerSha = io.makeOwnerCommit(`db-coordination ${kind} ${requestId} pr=${metadata.pr ?? 'none'} head=${metadata.headSha}`)
  acquireMutex(ownerSha, io)
  try {
    if (kind === 'production') {
      if (metadata.headSha !== io.mainSha?.()) throw new LaneError('production lane requires the exact current main SHA')
      if (io.readRef(EXCLUSIVE_REFS.merge)) throw new LaneError('a guarded merge is active; production promotion must wait')
    } else {
      const pr = io.getPr?.(metadata.pr)
      if (!pr?.head?.sha || pr.head.sha !== metadata.headSha) throw new LaneError('exclusive lane head SHA does not match the live pull request')
      const claims = io.openClaims()
      const matching = claims.map((claim)=>({ ...claim, lease:parseAuthorLease(claim.body) })).filter((claim)=>!claim.lease.legacy && claim.lease.branch===pr.head.ref && claim.lease.active)
      if (matching.length !== 1) throw new LaneError('exclusive lane requires exactly one live author claim for the pull-request branch')
      if (kind === 'merge' && pr.base?.sha !== io.mainSha?.()) throw new LaneError('pull request is not based on the current main tip')
      if (kind === 'merge' && io.readRef(EXCLUSIVE_REFS.production)) throw new LaneError('production promotion is active; merges are frozen')
    }
    acquireRef(ref, ownerSha, io)
    return { kind, ref, ownerSha, requestId }
  } finally { releaseOwnedRef(MUTEX_REF, ownerSha, io) }
}

function parseArgs(argv) {
  const out = { objects: [] }
  const next = (i) => { if (i + 1 >= argv.length) throw new LaneError(`${argv[i]} needs a value`); return argv[i + 1] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--claim') out.claim = true
    else if (a === '--audit') out.audit = true
    else if (a === '--cleanup-stale') out.cleanup = true
    else if (a === '--release-claim') out.releaseClaim = next(i), i++
    else if (a === '--confirm-finished') out.confirmFinished = true
    else if (/^--acquire-(preview|merge|production)$/.test(a)) out.acquireExclusive = a.slice(10)
    else if (/^--release-(preview|merge|production)$/.test(a)) out.releaseExclusive = a.slice(10)
    else if (['--task','--owner','--branch','--worktree','--pr','--head-sha','--owner-sha'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
    else if (a === '--objects') { out.objects.push(...next(i).split(',').map((v)=>v.trim()).filter(Boolean)); i++ }
    else if (a === '--lease-hours') { out.leaseHours = Number(next(i)); i++ }
    else throw new LaneError(`unknown argument: ${a}`)
  }
  return out
}

export function main(argv, now = new Date(), io = githubIo) {
  try {
    const o = parseArgs(argv)
    if (o.acquireExclusive) { console.log(JSON.stringify(acquireExclusive(o.acquireExclusive, { owner:o.owner, pr:o.pr, headSha:o.headSha }, io), null, 2)); return 0 }
    if (o.releaseExclusive) { if (!o.ownerSha) throw new LaneError('--owner-sha is required for safe release'); releaseOwnedRef(EXCLUSIVE_REFS[o.releaseExclusive], o.ownerSha, io); return 0 }
    const claims = io.openClaims()
    if (o.releaseClaim) {
      if (!o.confirmFinished || !o.owner) throw new LaneError('--release-claim requires exact --owner and --confirm-finished')
      const requestId=randomUUID(), ownerSha=io.makeOwnerCommit(`db-coordination claim-release ${requestId}`)
      acquireRef(MUTEX_REF,ownerSha,io)
      try {
        const fresh=io.openClaims(), claim=fresh.find((x)=>String(x.number)===String(o.releaseClaim))
        if(!claim)throw new LaneError(`claim #${o.releaseClaim} is not open`)
        const lease=parseAuthorLease(claim.body,now)
        if(lease.owner!==o.owner)throw new LaneError(`claim #${o.releaseClaim} belongs to a different owner`)
        if((io.openPulls?.() ?? io.prSources()).some((pr)=>(pr.head?.ref ?? pr.branch)===lease.branch))throw new LaneError(`claim branch ${lease.branch} still has an open pull request`)
        io.closeClaim(claim.number)
      } finally { releaseOwnedRef(MUTEX_REF,ownerSha,io) }
      return 0
    }
    if (o.cleanup) {
      const { stale } = assertLaneAvailable(claims, [], now, { ignoreCapacity: true })
      console.log(`${stale.length} expired claim(s) remain locked. Release each explicitly with --release-claim, exact --owner, and --confirm-finished.`); return stale.length ? 2 : 0
    }
    if (o.audit) {
      const malformed=[];let occupied=0,expired=0
      for(const claim of claims){try{const lease=parseAuthorLease(claim.body,now);occupied++;if(!lease.legacy&&!lease.active)expired++}catch(e){malformed.push(`#${claim.number}: ${e.message}`)}}
      console.log(`${occupied}/${MAX_AUTHOR_LANES} lanes occupied; ${expired} expired claim(s) remain locked.`)
      for(const problem of malformed)console.error(`MALFORMED ${problem}`)
      return malformed.length || occupied>MAX_AUTHOR_LANES ? 2 : 0
    }
    if (!o.claim) throw new LaneError('choose --claim, --audit, --cleanup-stale, or an exclusive-lane command')
    for (const k of ['task','owner','branch','worktree']) if (!o[k]) throw new LaneError(`--${k} is required`)
    if (!o.objects.length) throw new LaneError('--objects must name every database object exactly')
    o.leaseHours ??= DEFAULT_LEASE_HOURS
    if (!Number.isFinite(o.leaseHours) || o.leaseHours <= 0 || o.leaseHours > 24) throw new LaneError('--lease-hours must be greater than 0 and no more than 24')
    console.log(JSON.stringify(acquireAuthorLane(o, now, io), null, 2)); return 0
  } catch (error) { console.error(`REFUSED: ${error.message}`); return 2 }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2))
