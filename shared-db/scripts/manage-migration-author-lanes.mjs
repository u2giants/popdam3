#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gatherOpenPrObjects, normalizeObject, parseClaimBlock } from './check-dispatch-collision.mjs'

export const REPO = 'u2giants/shared-db'
export const MAX_AUTHOR_LANES = 3
export const DEFAULT_LEASE_HOURS = 12
export const MUTEX_STALE_AFTER_MS = 2 * 60 * 1000
export const MUTEX_REF = 'refs/db-coordination/author-acquisition'
export const MUTEX_RECOVERY_ACTIVE_REF = 'refs/db-coordination/author-acquisition-recovery-active'
export const REVIEW_CURSOR_REF = 'refs/db-coordination/reviewer-round-robin'
export const REVIEW_FAILURE_REF_PREFIX = 'refs/db-review-failures'
export const REVIEW_REPLACEMENT_REF_PREFIX = 'refs/db-review-replacements'
export const REVIEWERS = Object.freeze([
  { name:'grok-4.6', wrapper:'ai-grok-review' }, { name:'glm-5.3', wrapper:'ai-glm' },
  { name:'kimi-k3', wrapper:'ai-kimi' }, { name:'qwen-3.8-max', wrapper:'ai-qwen' },
  { name:'glm-5.2', wrapper:'ai-glm' },
  { name:'muse-spark-1.2-contributor', wrapper:'ai-muse' },
])
// Keep REVIEWERS as the historical evidence registry. Paused providers remain
// readable forever, but only ACTIVE_REVIEWERS can receive new work.
//
// WHY 'glm-5.2' IS STILL LISTED BUT NOT ACTIVE
// -------------------------------------------
// The `ai-glm` wrapper has pinned MODEL=glm-5.3 (ai-devops/bin/ai-glm), so every
// review routed through it was ALREADY running on 5.3 while this registry
// recorded it as 'glm-5.2'. The model was right; the label was wrong, and the
// label is what lands in durable review evidence. Corrected here at the source.
//
// 'glm-5.2' is deliberately NOT deleted. Reviewer names are read back out of
// permanent coordination refs (`parseReviewCursor` -> `REVIEWERS.find(...)`), so
// every historical GLM review recorded before this change still has to resolve to
// a wrapper. One of those lookups is not null-guarded, so a missing name is a
// crash, not a graceful miss. Retired names stay readable forever; only
// ACTIVE_REVIEWERS receives new work -- the same pattern used to pause Qwen.
//
// 'glm-5.3' occupies the SAME rotation slot 'glm-5.2' held, so no in-flight
// sequence is reassigned out of order. It no longer keeps ACTIVE_REVIEWERS at the
// same LENGTH -- issue #1290 changed the length from two to three. See the
// ROTATION SLOTS block below, which is the accurate statement.
//
// RESTORED 2026-08-20 (owner instruction, issue #1290): 'glm-5.3'.
// ITS PAUSE ON 2026-08-18 WAS A FALSE DIAGNOSIS, and the diagnosis is the lesson.
// The three `provider_unavailable` failures -- sequences 161, 164 and 167 -- were not
// the remote provider being down. `ai-glm doctor` showed every check passing EXCEPT
// `health endpoint answers`, because the LOCAL `opencode` server was not running.
// `opencode-glm-launch` fixed it in about thirty seconds, and glm-5.3 then produced a
// full 10 KB review with a coverage statement on the first attempt. One stopped local
// process cost a two-day reviewer outage.
//
// WHY THAT COULD HAPPEN, and what is being done about it: `provider_unavailable`
// conflates "the remote provider is down" (wait) with "a local dependency of the
// wrapper is not running" (thirty-second fix), and PAUSING a reviewer requires no
// evidence about which of the two it was while RESTORING one requires a probe. The
// cheap check is demanded only on the path nobody is in a hurry to take. A pause entry
// below must therefore NAME the failing health check, or state explicitly that the
// health check passed and the failure was elsewhere. Tracked as #1287 here and
// ai-devops#45 (each wrapper self-checks the dependencies it owns) upstream.
//
// PAUSED 2026-08-20 (owner instruction, issue #1290): 'kimi-k3'. ELEVEN terminal
// failures against FIVE successes in a single session, in three distinct modes:
// findings discarded above the verdict heading (1), usage-limit exhaustion (1), and
// nine consecutive 6-second `exit 127` deaths. Health check: NOT the cause in the
// glm-5.3 sense -- the `exit 127` deaths are the wrapper's own launch failing, which
// is a local fault, but it is kimi's wrapper and it was not repairable in session.
// Reviewer issue `20260820T004602Z-edge-dev-kimi-k3-385556` carries the raw evidence.
// This is a PAUSE, not a retirement.
//
// ADDED 2026-08-20 (owner instruction, issue #1290): 'muse-spark-1.2-contributor'.
// A registry addition, not an un-pause -- it was never listed. On the head-to-head
// trial it produced a complete seven-point review ending in `VERDICT: APPROVE`.
// KNOWN DEFECT, and the caller must handle it: the wrapper's verdict DETECTION fails
// and writes "This is not a review result" over correct work. It SAVES the output, so
// every such result is fully recoverable -- READ THE SAVED ARTIFACT before recording
// any Muse failure, and never record a bare "incomplete" from this wrapper without
// having read the raw provider stream.
//
// NOT ADDED, deliberately: 'gemini-3.7-flash-high'. `ai-gemini doctor` passes, so the
// install is sound, but two attempts produced `no usable Gemini verdict` and then a
// bare `PASS` with an EMPTY report. Two attempts is thin evidence and an empty report
// is the worst possible failure mode for a review gate. Retry only after someone
// establishes why the report comes back empty. This supersedes the narrower #1203.
//
// ROTATION SLOTS. 'glm-5.3' still occupies the slot 'glm-5.2' held. Muse is APPENDED,
// so it takes the slot kimi-k3's pause vacates in ACTIVE_REVIEWERS rather than
// displacing anyone. ACTIVE_REVIEWERS is therefore ['grok-4.6','glm-5.3',
// 'muse-spark-1.2-contributor'] -- THREE names instead of two.
//
// WHAT THREE NAMES DOES AND DOES NOT FIX. An earlier draft of this block claimed an
// odd-length rotation removes the `replaceFailedReviewer` same-provider trap. THAT
// CLAIM WAS FALSE and a review caught it (#1290 review, High). The refuse below --
// `next durable reviewer is the same failed provider` -- fires whenever there have
// been N-1 assignments since the failure, for ANY N. Going from two names to three
// only moves the collision from ONE intervening assignment to TWO. Two is exactly
// the natural rest point of a three-name parallel dispatch: Grok takes a PR, GLM
// takes the next, Muse takes the third, the cursor lands on a multiple of three, and
// a Grok failure then computes back to Grok and is refused.
//
// So a third name genuinely buys CAPACITY -- three reviews can be in flight, and for
// most of 2026-08-19 the rotation was effectively Grok alone because ai-grok-review
// holds a per-REPOSITORY in-flight lock. It does NOT buy freedom from the wraparound
// refuse. The real fix is to SKIP the failed provider when selecting a replacement,
// which is a change to a governed fail-closed function and is tracked separately.
// Do not re-add an odd-length safety claim here.
//
// Capacity is worth having on its own terms: twice on 2026-08-19 a second reviewer
// overturned the first's conclusion, once by refuting an author's design rationale
// using the author's own test fixture. A rotation of one is not a rotation.
export const RETIRED_REVIEWERS = Object.freeze(['qwen-3.8-max', 'glm-5.2', 'kimi-k3'])
export const ACTIVE_REVIEWERS = Object.freeze(REVIEWERS.filter((row)=>!RETIRED_REVIEWERS.includes(row.name)))
export const EXCLUSIVE_REFS = Object.freeze({
  preview: 'refs/db-coordination/preview',
  'preview-recovery': 'refs/db-coordination/preview',
  // POST-MERGE REHEARSAL. Deliberately the SAME ref as the ordinary preview
  // lane, so a rehearsal and an ordinary preview run can never both hold
  // preview -- no new interaction and no new hatch. NOTE WHAT THIS REF DOES NOT
  // DO: it is not cross-checked against `merge` or `production` in either
  // direction (the only cross-checks are the two `EXCLUSIVE_REFS` reads below,
  // promotion-waits-for-merge and merge-waits-for-production). A rehearsal is
  // therefore NOT excluded from a guarded merge or a promotion. That is
  // pre-existing behaviour of the preview lane which this kind inherits
  // unchanged; an earlier comment here claimed the exclusion existed (#1213
  // round 7 audit).
  'preview-rehearsal': 'refs/db-coordination/preview',
  merge: 'refs/db-coordination/merge',
  production: 'refs/db-coordination/production',
})

export const QUEUE_STATUSES = new Set(['ready','blocked','owner-decision'])
export const QUEUE_WORK_TYPES = new Set(['structural','curated-master-data','application-data','source-data','repo-maintenance','documentation','security-settings'])
export const QUEUE_ROUTES = new Set(['shared-db-orchestrator','curated-master-data-governance','application-session','source-data-session','owner-only','repo-maintenance'])
const ROUTES_BY_WORK_TYPE = Object.freeze({
  structural: new Set(['shared-db-orchestrator']),
  'curated-master-data': new Set(['curated-master-data-governance']),
  'application-data': new Set(['application-session']),
  'source-data': new Set(['source-data-session']),
  'repo-maintenance': new Set(['repo-maintenance','owner-only']),
  documentation: new Set(['repo-maintenance','owner-only']),
  'security-settings': new Set(['owner-only','repo-maintenance']),
})

export function parseQueueScope(body = '') {
  const fences=[...body.matchAll(/```db-work-scope\s*\n([\s\S]*?)```/g)]
  if (!fences.length) return null
  if (fences.length !== 1) throw new LaneError('exactly one db-work-scope block is required')
  const fence=fences[0]
  const lines = fence[1].split(/\r?\n/), fields = new Map(), objects = []
  let inObjects = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line === 'objects:') { inObjects = true; continue }
    if (inObjects && line.startsWith('- ')) { objects.push(line.slice(2).trim()); continue }
    inObjects = false
    const match = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (!match || fields.has(match[1])) throw new LaneError('unreadable db-work-scope block')
    fields.set(match[1], match[2].trim())
  }
  if (fields.has('state')) throw new LaneError('db-work-scope state is retired; use separate status, work_type, and route fields')
  const status = fields.get('status')
  const workType = fields.get('work_type')
  const route = fields.get('route')
  if (!QUEUE_STATUSES.has(status)) throw new LaneError(`db-work-scope status must be one of ${[...QUEUE_STATUSES].join(', ')}`)
  if (!QUEUE_WORK_TYPES.has(workType)) throw new LaneError(`db-work-scope work_type must be one of ${[...QUEUE_WORK_TYPES].join(', ')}`)
  if (!QUEUE_ROUTES.has(route)) throw new LaneError(`db-work-scope route must be one of ${[...QUEUE_ROUTES].join(', ')}`)
  if (!ROUTES_BY_WORK_TYPE[workType].has(route)) throw new LaneError(`route ${route} is not valid for work_type ${workType}`)
  const priority = Number(fields.get('priority'))
  if (!Number.isInteger(priority) || priority < 0) throw new LaneError('db-work-scope priority must be a non-negative integer')
  const dependencies = (fields.get('depends_on') ?? '').split(',').map((v)=>v.trim()).filter(Boolean).map((v)=>Number(String(v).replace(/^#/,'')))
  if (dependencies.some((v)=>!Number.isInteger(v) || v <= 0)) throw new LaneError('db-work-scope depends_on must contain issue numbers')
  if (workType === 'structural' && !objects.length) throw new LaneError('structural db-work-scope must list exact objects')
  if (workType !== 'structural' && objects.length) throw new LaneError(`${workType} db-work-scope must not claim database objects`)
  if (route === 'owner-only' && status !== 'owner-decision') throw new LaneError('owner-only route requires status owner-decision')
  return { status, workType, route, priority, dependencies, objects: objects.length ? validateClaimObjects(objects) : [] }
}

export const COORDINATION_LABELS = new Set(['db-claim','orchestrator-marker'])
export const WORK_LABEL = 'db-work'

function overlaps(a, b) { const right = new Set(b); return a.some((x)=>right.has(x)) }

export function buildDynamicQueues(issues, claims, now = new Date(), allOpenIssueNumbers = issues.map((issue)=>issue.number)) {
  const openNumbers = new Set(allOpenIssueNumbers.map(Number))
  const skipped = [], unclassified = [], malformed = [], unlabelled = [], candidates = []
  for (const issue of issues) {
    // githubIo always supplies a labels array, so real audits always run this
    // check; callers that pass no labels at all are asserting they carry no
    // label information rather than asserting the label is absent.
    if (Array.isArray(issue.labels) && !issue.labels.includes(WORK_LABEL)) unlabelled.push(issue.number)
    let scope
    try { scope = parseQueueScope(issue.body) } catch (error) { malformed.push({ issue:issue.number, reason:error.message }); continue }
    if (!scope) { unclassified.push(issue.number); continue }
    if (scope.status !== 'ready') { skipped.push({ issue:issue.number, reason:`status:${scope.status}`, workType:scope.workType, route:scope.route }); continue }
    if (scope.workType !== 'structural' || scope.route !== 'shared-db-orchestrator') {
      skipped.push({ issue:issue.number, reason:'not-migration-author-work', workType:scope.workType, route:scope.route }); continue
    }
    const waiting = scope.dependencies.filter((number)=>openNumbers.has(number))
    if (waiting.length) { skipped.push({ issue:issue.number, reason:`depends-on-open:${waiting.join(',')}` }); continue }
    candidates.push({ issue:issue.number, title:issue.title, ...scope })
  }
  const active = claims.map((claim)=>({ claim:claim.number, issue:null, priority:Number.MAX_SAFE_INTEGER, objects:parseAuthorLease(claim.body,now).objects }))
  const components = [...active, ...candidates].map((item)=>[item])
  for (let i=0;i<components.length;i++) for (let j=i+1;j<components.length;) {
    if (components[i].some((a)=>components[j].some((b)=>overlaps(a.objects,b.objects)))) components[i].push(...components.splice(j,1)[0]); else j++
  }
  const queues = Array.from({length:MAX_AUTHOR_LANES},(_,index)=>({ lane:index+1, active:null, queued:[], objects:[] }))
  const ordered = components.sort((a,b)=>Number(Boolean(b.some(x=>x.claim)))-Number(Boolean(a.some(x=>x.claim))) || Math.max(...b.map(x=>x.priority))-Math.max(...a.map(x=>x.priority)))
  for (const component of ordered) {
    const activeItem = component.find((x)=>x.claim)
    const free=queues.filter((q)=>!q.active)
    let lane = activeItem ? free[0] : [...(free.length?free:queues)].sort((a,b)=>a.queued.length-b.queued.length)[0]
    if (activeItem) lane.active = activeItem.claim
    lane.queued.push(...component.filter((x)=>x.issue).sort((a,b)=>b.priority-a.priority || a.issue-b.issue).map((x)=>x.issue))
    lane.objects.push(...new Set(component.flatMap((x)=>x.objects)))
  }
  const emptyLanes = queues.filter((q)=>!q.active).length
  const dispatchable = queues.filter((q)=>!q.active && q.queued.length).map((q)=>q.queued[0])
  return { queues, skipped, unclassified, malformed, unlabelled, dispatchable, emptyLanes, fullyAudited:!unclassified.length&&!malformed.length&&!unlabelled.length }
}

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

export function isTransientGitHubTransport(error) {
  return /HTTP 5\d\d|connection (?:reset|timed out)|TLS handshake timeout|No server is currently available/i.test(String(error?.stderr ?? error?.message ?? error ?? ''))
}
export function runGitHubCommand(args,{executor=execFileSync,wait=(ms)=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms),attempts=4}={}) {
  let last
  for(let attempt=0;attempt<attempts;attempt++){
    try{return executor('gh',args,{encoding:'utf8',maxBuffer:64*1024*1024})}
    catch(error){
      last=error
      if(!isTransientGitHubTransport(error)||attempt===attempts-1){
        const wrapped=new LaneError(`GitHub command failed: ${String(error.stderr??error.message).trim()}`)
        wrapped.transientTransport=isTransientGitHubTransport(error)
        throw wrapped
      }
      wait(2**attempt*1000)
    }
  }
  throw last
}
function gh(args) { return runGitHubCommand(args) }

export function createRefWithReadback(ref,sha,{run=gh,readRef}={}) {
  try{run(['api','-X','POST',`repos/${REPO}/git/refs`,'-f',`ref=${ref}`,'-f',`sha=${sha}`]);return true}
  catch(error){
    if(/reference already exists/i.test(error.message)){
      if(!readRef)return false
      return readRef(ref)===sha
    }
    if(!error.transientTransport||!readRef)throw error
    const actual=readRef(ref)
    if(actual===sha)return true
    if(actual!==null)return false
    throw error
  }
}
export function deleteRefWithReadback(ref,{run=gh,readRef}={}) {
  try{run(['api','-X','DELETE',`repos/${REPO}/git/refs/${ref.replace(/^refs\//,'')}`]);return}
  catch(error){
    if(isConfirmedRefAbsence(error))return
    if(/reference does not exist/i.test(error.message)&&readRef&&readRef(ref)===null)return
    if(!error.transientTransport||!readRef)throw error
    if(readRef(ref)===null)return
    throw error
  }
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
export function isConfirmedRefAbsence(error) { return /HTTP 404/i.test(String(error?.message??'')) }

export const githubIo = {
  openClaims() {
    const rows = ghPaginated(`repos/${REPO}/issues?state=open&labels=db-claim&per_page=100`)
    return rows.filter((x) => !x.pull_request).map((x) => ({ number: x.number, title: x.title, body: x.body, url: x.html_url }))
  },
  // EVERY open issue is audited, not just the ones somebody remembered to
  // label. Filtering on `labels=db-work` here is what let issues #1188, #1238,
  // #1242, #1266 and #1268 sit unlabelled and therefore invisible to the queue
  // audit while carrying a valid db-work-scope block. Coordination issues
  // (db-claim, orchestrator-marker) are the only exclusions; a missing db-work
  // label on anything else is now a reported defect, never a silent skip.
  openWorkIssues(pager = ghPaginated) {
    const rows = pager(`repos/${REPO}/issues?state=open&per_page=100`)
    return rows.filter((x)=>!x.pull_request)
      .map((x)=>({ number:x.number, title:x.title, body:x.body, labels:(x.labels??[]).map((l)=>l.name) }))
      .filter((x)=>!x.labels.some((name)=>COORDINATION_LABELS.has(name)))
  },
  openIssueNumbers() { return ghPaginated(`repos/${REPO}/issues?state=open&per_page=100`).filter((x)=>!x.pull_request).map((x)=>x.number) },
  prSources() { return gatherOpenPrObjects(REPO) },
  openPulls() { return ghPaginated(`repos/${REPO}/pulls?state=open&per_page=100`) },
  getPr(number) { return ghJson(['api', `repos/${REPO}/pulls/${number}`]) },
  getPrFiles(number) { return ghPaginated(`repos/${REPO}/pulls/${number}/files?per_page=100`) },
  getIssue(number) { return ghJson(['api', `repos/${REPO}/issues/${number}`]) },
  getIssueComments(number) { return ghPaginated(`repos/${REPO}/issues/${number}/comments?per_page=100`) },
  getPrReviews(number) { return ghPaginated(`repos/${REPO}/pulls/${number}/reviews?per_page=100`) },
  updateIssue(number, fields) {
    const args=['api','-X','PATCH',`repos/${REPO}/issues/${number}`]
    for(const [key,value] of Object.entries(fields))args.push('-f',`${key}=${value}`)
    return ghJson(args)
  },
  mainSha() { return ghJson(['api', `repos/${REPO}/git/ref/heads/main`])?.object?.sha ?? null },
  getCommit(sha) { return ghJson(['api', `repos/${REPO}/git/commits/${sha}`]) },
  // ARGUMENT ORDER IS THE WHOLE CHECK. GitHub's compare endpoint is
  // `compare/{base}...{head}` and reports how HEAD relates to BASE. Passing the
  // merge commit as BASE and the main tip as HEAD is what makes `ahead` mean
  // "main contains the merge commit". Inverted, `ahead` would mean the exact
  // opposite and would accept unmerged code. See compareCommits tests.
  compareCommits(baseSha, headSha) { return ghJson(['api', `repos/${REPO}/compare/${baseSha}...${headSha}`]) },
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
    return createRefWithReadback(ref,sha,{readRef:(target)=>this.readRef(target)})
  },
  readRef(ref) {
    const short = ref.replace(/^refs\//, '')
    try { return ghJson(['api', `repos/${REPO}/git/ref/${short}`])?.object?.sha ?? null }
    // Only GitHub CLI's explicit HTTP 404 proves that this exact ref is absent.
    // A transport message that merely says "not found" is ambiguous and must
    // remain a hard failure rather than being mistaken for successful cleanup.
    catch (error) { if (isConfirmedRefAbsence(error)) return null; throw error }
  },
  listRefs(prefix) {
    const short=prefix.replace(/^refs\//,'')
    return ghPaginated(`repos/${REPO}/git/matching-refs/${short}?per_page=100`).map((row)=>({ref:row.ref,sha:row.object?.sha})).filter((row)=>row.sha)
  },
  // A DELETE is never replayed after a transport failure. The first request may
  // have succeeded and a new owner may acquire the fixed coordination ref
  // during backoff; replaying the DELETE could then remove that new owner.
  deleteRef(ref) {
    deleteRefWithReadback(ref,{
      run:(args)=>runGitHubCommand(args,{attempts:1}),
      readRef:(target)=>this.readRef(target),
    })
  },
  updateRef(ref, sha) { gh(['api','-X','PATCH',`repos/${REPO}/git/refs/${ref.replace(/^refs\//,'')}`,'-f',`sha=${sha}`,'-F','force=true']) },
  reserveVersion() { return JSON.parse(execFileSync(process.execPath, ['scripts/check-dispatch-collision.mjs', '--reserve-version', '--json'], { encoding: 'utf8' })) },
  createClaim(title, body) { return gh(['issue', 'create', '--repo', REPO, '--label', 'db-claim', '--title', `CLAIM: ${title}`, '--body', body]).trim() },
  closeClaim(number) { gh(['issue', 'close', String(number), '--repo', REPO, '--comment', 'Expired migration-author lease closed by guarded cleanup. Its migration version remains unavailable.']) },
  reversionFiles(worktree,oldVersion) {
    let referenced=[]
    try{referenced=execFileSync('git',['-C',worktree,'grep','-l',oldVersion,'--','supabase/migrations','supabase/tests','docs'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean)}
    catch(error){if(error.status!==1)throw error}
    const migrations=execFileSync('git',['-C',worktree,'ls-files','--cached','--others','--exclude-standard','--',`supabase/migrations/${oldVersion}_*.sql`],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean)
    return [...new Set([...referenced,...migrations].map((file)=>path.normalize(file)))].map((file)=>path.resolve(worktree,file))
  },
  rewriteVersion(worktree,oldVersion,newVersion) {
    const files=this.reversionFiles(worktree,oldVersion),migration=files.filter((file)=>new RegExp(`^${oldVersion}_[^\\/]+\\.sql$`).test(path.basename(file)))
    if(migration.length!==1)throw new LaneError('local worktree must contain exactly one old-version migration file')
    const exactVersion=new RegExp(`(?<!\\d)${oldVersion}(?!\\d)`,'g')
    const renamed=path.join(path.dirname(migration[0]),path.basename(migration[0]).replace(new RegExp(`^${oldVersion}_`),`${newVersion}_`))
    if(existsSync(renamed))throw new LaneError('refusing migration version rewrite because the target filename already exists')
    const originals=new Map(files.map((file)=>[file,readFileSync(file,'utf8')]))
    let renamedApplied=false
    try{
      for(const [file,contents] of originals)writeFileSync(file,contents.replace(exactVersion,newVersion))
      ;(this.renameVersionFile??renameSync)(migration[0],renamed);renamedApplied=true
      return {files,migration:migration[0],renamed}
    }catch(error){
      const failures=[]
      if(renamedApplied||(!existsSync(migration[0])&&existsSync(renamed)))try{renameSync(renamed,migration[0])}catch(rollbackError){failures.push(rollbackError.message)}
      for(const [file,contents] of originals)try{writeFileSync(file,contents)}catch(rollbackError){failures.push(rollbackError.message)}
      if(failures.length)throw new LaneError(`${error.message}; LOCAL ROLLBACK INCOMPLETE: ${failures.join('; ')}`)
      throw error
    }
  },
  commitAndPushReversion(worktree,oldVersion,newVersion) {
    execFileSync('git',['-C',worktree,'add','--all','--','supabase/migrations','supabase/tests','docs'])
    execFileSync('git',['-C',worktree,'commit','-m',`migration: re-reserve ${oldVersion} as ${newVersion}`],{stdio:'pipe'})
    execFileSync('git',['-C',worktree,'push','origin','HEAD'],{stdio:'pipe'})
    return execFileSync('git',['-C',worktree,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
  },
  localHead(worktree){return execFileSync('git',['-C',worktree,'rev-parse','HEAD'],{encoding:'utf8'}).trim()},
  localClean(worktree){return execFileSync('git',['-C',worktree,'status','--porcelain'],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean).every((line)=>line.slice(3).replaceAll('\\','/').startsWith('.ai/')) },
  currentMaxVersion(worktree){return execFileSync('git',['-C',worktree,'ls-tree','-r','--name-only','origin/main'],{encoding:'utf8'}).split(/\r?\n/).map((f)=>/^supabase\/migrations\/(\d{14})_/.exec(f)?.[1]).filter(Boolean).sort().at(-1)},
  commandAvailable(command){try{execFileSync(process.platform==='win32'?'where.exe':'which',[command],{stdio:'ignore'});return true}catch{return false}},
}

export function acquireRef(ref, ownerSha, io = githubIo) {
  if (!io.createRef(ref, ownerSha)) throw new LaneError(`${ref} is occupied`)
  if (readRefAfterWrite(ref, ownerSha, io) !== ownerSha) throw new LaneError(`${ref} ownership could not be proved after acquisition`)
}

// GitHub's create-ref response can arrive before the new custom ref is visible
// to a following GET. Treat only a short sequence of 404/not-found reads as
// eventual consistency; a different owner is returned immediately and fails
// closed. This keeps the atomic create-if-absent lock while avoiding stranded
// mutexes caused by a successful create followed by a transient 404.
export function readRefAfterWrite(ref, expectedSha, io = githubIo, attempts = 12) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const actual = io.readRef(ref)
    if (actual !== null || attempt === attempts) return actual
    ;(io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)))(Math.min(50 * attempt, 500))
  }
  return null
}

// GitHub's pull-request head and file list are eventually consistent in the same
// way a custom ref is: a push that HAS landed can still be read back as the
// pre-push state for several seconds. Asked once, that stale answer is
// indistinguishable from a push that never happened. On 2026-08-18 three
// consecutive version supersessions rolled themselves back for exactly that
// reason, and each rollback permanently burned a migration version reservation
// that can never be reused (issue #1165).
//
// Retry ONLY an exactly-stale answer: the head we pushed from, and/or the single
// migration version we renamed from. Every other answer — a third head somebody
// else pushed, zero migrations, two migrations, an unrelated version — is a real
// conflict and fails closed on the FIRST read with no retry at all. The last
// attempt still asserts exactly, so an API that never catches up refuses rather
// than proceeding on an unproven readback.
export function readPrAfterPush(pr, expected, io = githubIo, attempts = 12) {
  const {head, version, branch, staleHead, staleVersion} = expected
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const live = io.getPr(pr), versions = migrationVersions(io.getPrFiles(pr))
    const headSha = live?.head?.sha
    if (live?.state === 'open' && headSha === head && live?.head?.ref === branch && versions.length === 1 && versions[0] === version) return live
    const staleReadback = live?.state === 'open' && live?.head?.ref === branch && (headSha === staleHead || headSha === head) && versions.length === 1 && (versions[0] === staleVersion || versions[0] === version)
    if (!staleReadback || attempt === attempts) return null
    ;(io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)))(Math.min(250 * attempt, 2000))
  }
  return null
}

export function acquireMutex(ownerSha, io = githubIo, attempts = 100) {
  for (let attempt=1; attempt<=attempts; attempt++) {
    if(io.readRef(MUTEX_RECOVERY_ACTIVE_REF))throw new LaneError('author mutex recovery is active; retry after it finishes')
    try { acquireRef(MUTEX_REF,ownerSha,io);return }
    catch(error) {
      if(!/occupied/.test(error.message))throw error
      if(attempt===attempts){
        const held=io.readRef(MUTEX_REF)
        throw new LaneError(`${MUTEX_REF} remained occupied${held ? ` at ${held}` : ''}; inspect it and use --recover-author-mutex with that exact SHA only if it is stale`)
      }
      // A mutex is held only for GitHub reads plus one issue creation. Waiting
      // here lets simultaneous unrelated authors serialize acquisition and then
      // continue authoring concurrently.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50)
    }
  }
}

export function requireOwnedRef(ref, ownerSha, io = githubIo) {
  if (io.readRef(ref) !== ownerSha) throw new LaneError(`lost ownership of ${ref}; refusing the next GitHub mutation`)
}

export function recoverStaleAuthorMutex({ expectedSha, confirmStale, serializedRecovery, now = new Date(), minAgeMs = MUTEX_STALE_AFTER_MS, quietMs = 6000 }, io = githubIo) {
  if (!confirmStale || !serializedRecovery || !/^[0-9a-f]{7,40}$/i.test(String(expectedSha ?? ''))) throw new LaneError('recovery requires the serialized recovery workflow, --expected-sha, and --confirm-stale')
    if(!io.createRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha) && readRefAfterWrite(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)!==expectedSha)throw new LaneError('another author mutex recovery target is active')
    if(readRefAfterWrite(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)!==expectedSha)throw new LaneError('recovery marker ownership could not be proved after acquisition')
    requireOwnedRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)
    try {
    // An acquisition that read the marker just before it was created can wait
    // at most five seconds. Let it finish before inspecting/deleting the ref.
    if (quietMs > 0) (io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)))(quietMs)
    requireOwnedRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io)
    const actual=io.readRef(MUTEX_REF)
    if(actual===null)return {released:null,ageSeconds:null}
    if(actual!==expectedSha)throw new LaneError(`refusing recovery: mutex is ${actual}, not expected ${expectedSha}`)
    const commit=io.getCommit?.(actual)
    const message=commit?.message ?? commit?.commit?.message ?? ''
    const dateText=commit?.committer?.date ?? commit?.commit?.committer?.date
    const acquiredAt=new Date(dateText)
    if(!/^db-coordination (?:author-acquisition|preview|merge|production|claim-release|claim-split-recovery|claim-object-expansion|claim-reversion|claim-version-supersession|claim-lease-renewal|reviewer-assignment-lock|reviewer-replacement-lock)\b/.test(message))throw new LaneError('refusing recovery: mutex owner commit is not a recognized coordination lock')
    if(Number.isNaN(acquiredAt.valueOf()))throw new LaneError('refusing recovery: mutex owner time is unreadable')
    const age=now-acquiredAt
    if(age<minAgeMs)throw new LaneError(`refusing recovery: mutex is only ${Math.max(0,Math.floor(age/1000))} seconds old`)
    releaseOwnedRef(MUTEX_REF,expectedSha,io)
    return { released:expectedSha, ageSeconds:Math.floor(age/1000) }
    } finally { if(io.readRef(MUTEX_RECOVERY_ACTIVE_REF)===expectedSha)releaseOwnedRef(MUTEX_RECOVERY_ACTIVE_REF,expectedSha,io) }
}

export function releaseOwnedRef(ref, ownerSha, io = githubIo) {
  const actual = io.readRef(ref)
  if (actual === null) return false
  if (actual !== ownerSha) throw new LaneError(`refusing to release ${ref}: it belongs to another owner`)
  io.deleteRef(ref)
  const delays=[0,250,500,1000,1500,2000]
  for(const delay of delays){
    if(delay)(io.wait ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)))(delay)
    const after=io.readRef(ref)
    if(after===null)return true
    // A different SHA means another contender acquired the static ref after
    // our successful owner-verified delete. Never delete the successor.
    if(after!==ownerSha)return true
  }
  throw new LaneError(`release of ${ref} could not be proved after bounded readback; do not retry blindly`)
}

export function parseReviewCursor(commit) {
  if (!commit) return null
  const message=commit.message ?? commit.commit?.message ?? ''
  const match=/^db-coordination reviewer-cursor sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40})$/i.exec(message)
  if (!match) throw new LaneError('reviewer cursor does not point to a recognized assignment')
  return {sequence:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5]}
}

export function assignNextReviewer({issue,pr,headSha},io=githubIo){
  if(!Number.isInteger(Number(issue))||!Number.isInteger(Number(pr))||!/^[0-9a-f]{7,40}$/i.test(String(headSha??'')))throw new LaneError('review assignment requires issue, PR, and exact head SHA')
  const request={issue:Number(issue),pr:Number(pr),headSha:String(headSha)}, ownerSha=io.makeOwnerCommit(`db-coordination reviewer-assignment-lock issue=${request.issue} pr=${request.pr} head=${request.headSha}`)
  acquireMutex(ownerSha,io)
  try{
    const assignmentRef=`refs/db-review-assignments/${request.issue}-${request.pr}-${request.headSha}`
    const replacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`
    const replacementRows=io.listRefs?.(replacementBase)??[]
    const legacySha=io.readRef(replacementBase)
    if(legacySha&&!replacementRows.some((row)=>row.ref===replacementBase))replacementRows.push({ref:replacementBase,sha:legacySha})
    if(replacementRows.length){
      const replacements=replacementRows.map((row)=>({...parseReviewReplacement(io.getCommit(row.sha)),replacementSha:row.sha}))
      for(const replacement of replacements){
        if(replacement.issue!==request.issue||replacement.pr!==request.pr||replacement.headSha!==request.headSha||!REVIEWERS.some((r)=>r.name===replacement.reviewer))throw new LaneError('durable reviewer replacement does not match the assignment request')
        requireReplacementEvidence(replacement,io)
      }
      const replacement=replacements.sort((a,b)=>b.sequence-a.sequence)[0], reviewer=REVIEWERS.find((r)=>r.name===replacement.reviewer)
      return {...replacement,wrapper:reviewer.wrapper}
    }
    const priorSha=io.readRef(assignmentRef)
    if(priorSha){const prior=parseReviewCursor(io.getCommit(priorSha));return {...prior,wrapper:REVIEWERS.find((r)=>r.name===prior.reviewer)?.wrapper}}
    const cursorSha=io.readRef(REVIEW_CURSOR_REF), current=parseReviewCursor(cursorSha?io.getCommit(cursorSha):null)
    if(current&&current.issue===request.issue&&current.pr===request.pr&&current.headSha===request.headSha){
      if(!io.createRef(assignmentRef,cursorSha)&&readRefAfterWrite(assignmentRef,cursorSha,io)!==cursorSha)throw new LaneError('review assignment record could not be proved; retry the same assignment')
      return {...current,wrapper:REVIEWERS.find((r)=>r.name===current.reviewer)?.wrapper}
    }
    const sequence=(current?.sequence??0)+1, reviewer=ACTIVE_REVIEWERS[(sequence-1)%ACTIVE_REVIEWERS.length]
    const assignmentSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha}`)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    if(cursorSha)io.updateRef(REVIEW_CURSOR_REF,assignmentSha);else if(!io.createRef(REVIEW_CURSOR_REF,assignmentSha))throw new LaneError('reviewer cursor was created concurrently; retry the same assignment')
    if(readRefAfterWrite(REVIEW_CURSOR_REF,assignmentSha,io)!==assignmentSha)throw new LaneError('reviewer cursor advancement could not be proved; retry the same assignment')
    if(!io.createRef(assignmentRef,assignmentSha)&&readRefAfterWrite(assignmentRef,assignmentSha,io)!==assignmentSha)throw new LaneError('review assignment record could not be proved; retry the same assignment')
    return {sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request}
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

function replaceClaimVersion(body,oldVersion,newVersion){
  const fence=/```db-claim\s*\n([\s\S]*?)```/.exec(String(body??''))
  if(!fence||!new RegExp(`^version: ${oldVersion}$`,'m').test(fence[1])||(fence[1].match(/^version:/gm)??[]).length!==1)throw new LaneError('claim fenced version is missing or ambiguous')
  return body.slice(0,fence.index)+fence[0].replace(`version: ${oldVersion}`,`version: ${newVersion}`)+body.slice(fence.index+fence[0].length)
}

function parseVersionSupersession(commit){
  const message=commit?.message??commit?.commit?.message??''
  const match=/^db-coordination claim-version-superseded issue=(\d+) claim=(\d+) pr=(\d+) old=(\d{14}) new=(\d{14}) old-ref=([0-9a-f]{7,40}) head=([0-9a-f]{40})$/i.exec(message)
  if(!match)throw new LaneError('version supersession ref is unreadable')
  return {issue:Number(match[1]),claim:Number(match[2]),pr:Number(match[3]),oldVersion:match[4],newVersion:match[5],oldReservation:match[6],newHead:match[7]}
}

export function supersedeActiveClaimVersion(options,now=new Date(),io=githubIo){
  const request={issue:Number(options.issue),claim:Number(options.claim),pr:Number(options.pr),owner:String(options.owner??''),branch:String(options.branch??''),worktree:String(options.worktree??''),headSha:String(options.headSha??''),oldVersion:String(options.oldVersion??'')}
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.claim)||!Number.isInteger(request.pr)||!request.owner||!request.branch||!request.worktree||!/^[0-9a-f]{40}$/i.test(request.headSha)||!/^\d{14}$/.test(request.oldVersion))throw new LaneError('version supersession requires exact issue, claim, owner, branch, worktree, PR, head, and current version')
  const supersessionRef=`refs/db-claim-supersessions/${request.claim}-${request.oldVersion}`
  const priorSha=io.readRef(supersessionRef)
  if(priorSha){
    const prior=parseVersionSupersession(io.getCommit(priorSha)),claim=io.getIssue(request.claim),lease=parseAuthorLease(claim?.body??'',now),pr=io.getPr(request.pr)
    if(prior.issue!==request.issue||prior.claim!==request.claim||prior.pr!==request.pr||prior.oldVersion!==request.oldVersion||lease.version!==prior.newVersion||lease.owner!==request.owner||lease.branch!==request.branch||lease.worktree!==request.worktree||pr?.head?.sha!==prior.newHead||pr?.head?.ref!==request.branch||io.readRef(`refs/db-claims/${request.oldVersion}`)!==prior.oldReservation||!io.readRef(`refs/db-claims/${prior.newVersion}`))throw new LaneError('durable version supersession does not match current state')
    return {...prior,supersessionSha:priorSha,idempotent:true}
  }
  const ownerSha=io.makeOwnerCommit(`db-coordination claim-version-supersession issue=${request.issue} claim=${request.claim} pr=${request.pr} head=${request.headSha}`)
  acquireMutex(ownerSha,io)
  let before,rewritten=false,bodyChanged=false,newVersion,newHead,supersessionSha
  try{
    before=io.getIssue(request.claim);if(before?.state!=='open'||Number(before.number)!==request.claim)throw new LaneError(`claim #${request.claim} is not open`)
    const lease=parseAuthorLease(before.body,now)
    if(lease.owner!==request.owner||lease.version!==request.oldVersion||lease.branch!==request.branch||lease.worktree!==request.worktree||!new RegExp(`#${request.issue}(?:\\D|$)`).test(before.title??''))throw new LaneError('claim issue, owner, lease, version, branch, or worktree changed')
    const oldReservation=io.readRef(`refs/db-claims/${request.oldVersion}`);if(!oldReservation)throw new LaneError('old permanent reservation is missing')
    const pr=io.getPr(request.pr);if(pr?.state!=='open'||pr.head?.sha!==request.headSha||pr.head?.ref!==request.branch)throw new LaneError('open PR exact head or branch changed')
    const versions=migrationVersions(io.getPrFiles(request.pr));if(versions.length!==1||versions[0]!==request.oldVersion)throw new LaneError('PR must change exactly one migration at the current reserved version')
    if(!io.localClean(request.worktree)||io.localHead(request.worktree)!==request.headSha)throw new LaneError('target worktree is dirty or not at the exact PR head')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const reservation=io.reserveVersion();newVersion=String(reservation.version)
    if(!/^\d{14}$/.test(newVersion)||newVersion<=String(io.currentMaxVersion(request.worktree)??'')||newVersion===request.oldVersion)throw new LaneError('manager reservation is not later than current main')
    if(!io.readRef(`refs/db-claims/${newVersion}`))throw new LaneError('new permanent reservation readback failed')
    io.rewriteVersion(request.worktree,request.oldVersion,newVersion);rewritten=true
    newHead=io.commitAndPushReversion(request.worktree,request.oldVersion,newVersion)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const newBody=replaceClaimVersion(before.body,request.oldVersion,newVersion);bodyChanged=true;io.updateIssue(request.claim,{body:newBody})
    const after=io.getIssue(request.claim),afterLease=parseAuthorLease(after.body,now)
    if(after.body!==newBody||afterLease.version!==newVersion||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||afterLease.objects.join('|')!==lease.objects.join('|'))throw new LaneError('claim readback changed fields outside its fenced version')
    const livePr=readPrAfterPush(request.pr,{head:newHead,version:newVersion,branch:request.branch,staleHead:request.headSha,staleVersion:request.oldVersion},io)
    if(!livePr)throw new LaneError('PR did not expose exactly the new reserved migration')
    if(io.readRef(`refs/db-claims/${request.oldVersion}`)!==oldReservation||!io.readRef(`refs/db-claims/${newVersion}`))throw new LaneError('permanent reservation readback changed')
    supersessionSha=io.makeOwnerCommit(`db-coordination claim-version-superseded issue=${request.issue} claim=${request.claim} pr=${request.pr} old=${request.oldVersion} new=${newVersion} old-ref=${oldReservation} head=${newHead}`)
    if(!io.createRef(supersessionRef,supersessionSha)||readRefAfterWrite(supersessionRef,supersessionSha,io)!==supersessionSha)throw new LaneError('durable version supersession evidence could not be created and read back')
    return {issue:request.issue,claim:request.claim,pr:request.pr,oldVersion:request.oldVersion,newVersion,oldReservation,newHead,supersessionSha,idempotent:false}
  }catch(error){
    if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
    const failures=[]
    if(supersessionSha)try{if(io.readRef(supersessionRef)===supersessionSha)releaseOwnedRef(supersessionRef,supersessionSha,io)}catch(e){failures.push(e.message)}
    if(bodyChanged)try{io.updateIssue(request.claim,{body:before.body})}catch(e){failures.push(e.message)}
    if(rewritten)try{io.rewriteVersion(request.worktree,newVersion,request.oldVersion);io.commitAndPushReversion(request.worktree,newVersion,request.oldVersion)}catch(e){failures.push(e.message)}
    if(failures.length)throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${failures.join('; ')}`)
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export const reversionActiveClaim=supersedeActiveClaimVersion

function parseReviewReplacement(commit) {
  const message=commit?.message ?? commit?.commit?.message ?? ''
  const match=/^db-coordination reviewer-replacement sequence=(\d+) reviewer=([a-z0-9.-]+) issue=(\d+) pr=(\d+) head=([0-9a-f]{7,40}) failed-sequence=(\d+) prior-sequence=(\d+) failure-ref=([0-9a-f]{7,40})$/i.exec(message)
  if(!match)throw new LaneError('reviewer replacement ref does not point to a recognized replacement')
  return {sequence:Number(match[1]),reviewer:match[2],issue:Number(match[3]),pr:Number(match[4]),headSha:match[5],failedSequence:Number(match[6]),priorSequence:Number(match[7]),failureSha:match[8]}
}

function requireReplacementEvidence(replacement,io){
  const ref=`${REVIEW_FAILURE_REF_PREFIX}/${replacement.issue}-${replacement.pr}-${replacement.headSha}-${replacement.failedSequence}`
  if(io.readRef(ref)!==replacement.failureSha)throw new LaneError('immutable reviewer failure evidence is missing or changed')
}

export function reviewerExecutionPreflight({reviewer,wrapper,worktree,headSha},io=githubIo){
  const approved=ACTIVE_REVIEWERS.find((row)=>row.name===reviewer)
  if(!approved||approved.wrapper!==wrapper)throw new LaneError('reviewer preflight requires an approved reviewer and its exact wrapper')
  if(!/^[0-9a-f]{40}$/i.test(String(headSha??''))||!worktree)throw new LaneError('reviewer preflight requires an exact 40-character head SHA and worktree')
  if(!io.commandAvailable?.(wrapper))throw new LaneError(`reviewer preflight cannot execute ${wrapper}`)
  if(io.localHead(worktree)!==headSha)throw new LaneError('reviewer preflight worktree is not at the exact assigned head')
  if(!io.localClean(worktree))throw new LaneError('reviewer preflight worktree is dirty')
  return {reviewer,wrapper,worktree,headSha,ready:true}
}

export function replaceFailedReviewer({issue,pr,headSha,failedSequence,failureCode,confirmNoVerdict,confirmNoArtifact},io=githubIo){
  const request={issue:Number(issue),pr:Number(pr),headSha:String(headSha??''),failedSequence:Number(failedSequence)}
  if(!Number.isInteger(request.issue)||!Number.isInteger(request.pr)||!/^[0-9a-f]{40}$/i.test(request.headSha)||!Number.isInteger(request.failedSequence))throw new LaneError('reviewer replacement requires exact issue, PR, 40-character head SHA, and failed sequence')
  if(!['insufficient_quota','provider_unavailable','wrapper_terminal_failure','turn_limit_cancelled'].includes(String(failureCode??'')))throw new LaneError('reviewer replacement requires a recognized terminal provider/tool failure code')
  if(!confirmNoVerdict||!confirmNoArtifact)throw new LaneError('reviewer replacement requires explicit confirmation that the failed session produced no verdict and no artifact')
  const assignmentRef=`refs/db-review-assignments/${request.issue}-${request.pr}-${request.headSha}`
  const failureRef=`${REVIEW_FAILURE_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}-${request.failedSequence}`
  const replacementBase=`${REVIEW_REPLACEMENT_REF_PREFIX}/${request.issue}-${request.pr}-${request.headSha}`
  const replacementRef=`${replacementBase}-${request.failedSequence}`
  const ownerSha=io.makeOwnerCommit(`db-coordination reviewer-replacement-lock issue=${request.issue} pr=${request.pr} head=${request.headSha}`)
  acquireMutex(ownerSha,io)
  try{
    let priorReplacement=io.readRef(replacementRef)
    // The first implementation used one unsuffixed immutable ref. Preserve it
    // as the first link while allowing later links to be appended safely.
    if(!priorReplacement){
      const legacy=io.readRef(replacementBase)
      if(legacy){const parsed=parseReviewReplacement(io.getCommit(legacy));if(parsed.failedSequence===request.failedSequence)priorReplacement=legacy}
    }
    if(priorReplacement){
      const parsed=parseReviewReplacement(io.getCommit(priorReplacement)), reviewer=REVIEWERS.find((r)=>r.name===parsed.reviewer)
      if(parsed.issue!==request.issue||parsed.pr!==request.pr||parsed.headSha!==request.headSha||parsed.failedSequence!==request.failedSequence||!reviewer)throw new LaneError('durable reviewer replacement does not match this retry')
      requireReplacementEvidence(parsed,io)
      return {...parsed,wrapper:reviewer.wrapper,failureCode:String(failureCode),replacementSha:priorReplacement}
    }
    const assignmentSha=io.readRef(assignmentRef)
    if(!assignmentSha)throw new LaneError('original durable reviewer assignment is missing')
    const initial=parseReviewCursor(io.getCommit(assignmentSha))
    const replacementRows=io.listRefs?.(replacementBase)??[]
    const legacySha=io.readRef(replacementBase)
    if(legacySha&&!replacementRows.some((row)=>row.ref===replacementBase))replacementRows.push({ref:replacementBase,sha:legacySha})
    const parsedReplacements=replacementRows.map((row)=>parseReviewReplacement(io.getCommit(row.sha)))
    for(const replacement of parsedReplacements)requireReplacementEvidence(replacement,io)
    const predecessors=parsedReplacements.filter((row)=>row.sequence===request.failedSequence)
    const original=request.failedSequence===initial.sequence?initial:predecessors.length===1?predecessors[0]:null
    if(!original||original.issue!==request.issue||original.pr!==request.pr||original.headSha!==request.headSha)throw new LaneError('durable reviewer assignment or replacement does not match the replacement request')
    const cursorSha=io.readRef(REVIEW_CURSOR_REF), cursor=parseReviewCursor(cursorSha?io.getCommit(cursorSha):null)
    if(!cursor||cursor.sequence<request.failedSequence)throw new LaneError('reviewer cursor is behind the failed durable assignment')
    const issueRow=io.getIssue(request.issue), prRow=io.getPr(request.pr)
    if(issueRow?.state!=='open')throw new LaneError('review replacement requires the exact issue to remain open')
    if(prRow?.state!=='open'||prRow?.head?.sha!==request.headSha)throw new LaneError('review replacement requires the exact open PR head')
    const evidence=[...(io.getIssueComments?.(request.issue)??[]),...(io.getIssueComments?.(request.pr)??[]),...(io.getPrReviews?.(request.pr)??[])]
    if(evidence.some((row)=>{
      const body=String(row.body??''), tied=row.commit_id===request.headSha||body.includes(request.headSha)
      return tied&&(/\b(?:APPROVE|REVISE|REQUEST_CHANGES)\b/i.test(body)||['APPROVED','CHANGES_REQUESTED'].includes(String(row.state??'').toUpperCase()))
    }))throw new LaneError('an existing verdict for the exact head forbids reviewer replacement')
    const failureSha=io.makeOwnerCommit(`db-coordination reviewer-failure issue=${request.issue} pr=${request.pr} head=${request.headSha} sequence=${request.failedSequence} reviewer=${original.reviewer} code=${failureCode} verdict=none artifact=none`)
    const sequence=cursor.sequence+1, reviewer=ACTIVE_REVIEWERS[(sequence-1)%ACTIVE_REVIEWERS.length]
    if(reviewer.name===original.reviewer)throw new LaneError('next durable reviewer is the same failed provider; replacement refuses to retry it')
    const cursorReplacementSha=io.makeOwnerCommit(`db-coordination reviewer-cursor sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha}`)
    const replacementSha=io.makeOwnerCommit(`db-coordination reviewer-replacement sequence=${sequence} reviewer=${reviewer.name} issue=${request.issue} pr=${request.pr} head=${request.headSha} failed-sequence=${request.failedSequence} prior-sequence=${cursor.sequence} failure-ref=${failureSha}`)
    let failureCreated=false, cursorUpdated=false
    try{
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      if(!io.createRef(failureRef,failureSha))throw new LaneError('review failure evidence already exists without a replacement; manual audit required')
      failureCreated=true
      if(readRefAfterWrite(failureRef,failureSha,io)!==failureSha)throw new LaneError('immutable review failure evidence could not be proved')
      requireOwnedRef(MUTEX_REF,ownerSha,io)
      io.updateRef(REVIEW_CURSOR_REF,cursorReplacementSha);cursorUpdated=true
      if(readRefAfterWrite(REVIEW_CURSOR_REF,cursorReplacementSha,io)!==cursorReplacementSha)throw new LaneError('reviewer cursor replacement could not be proved')
      if(!io.createRef(replacementRef,replacementSha))throw new LaneError('review replacement record was created concurrently')
      if(readRefAfterWrite(replacementRef,replacementSha,io)!==replacementSha)throw new LaneError('review replacement record could not be proved')
      return {sequence,reviewer:reviewer.name,wrapper:reviewer.wrapper,...request,priorSequence:cursor.sequence,failureCode:String(failureCode),failureSha,replacementSha}
    }catch(error){
      const rollback=[]
      try{if(io.readRef(replacementRef)===replacementSha)releaseOwnedRef(replacementRef,replacementSha,io)}catch(e){rollback.push(e.message)}
      try{if(cursorUpdated&&io.readRef(REVIEW_CURSOR_REF)===cursorReplacementSha){io.updateRef(REVIEW_CURSOR_REF,cursorSha);if(readRefAfterWrite(REVIEW_CURSOR_REF,cursorSha,io)!==cursorSha)throw new LaneError('cursor rollback could not be proved')}}catch(e){rollback.push(e.message)}
      try{if(failureCreated&&io.readRef(failureRef)===failureSha)releaseOwnedRef(failureRef,failureSha,io)}catch(e){rollback.push(e.message)}
      if(rollback.length)throw new LaneError(`review replacement failed (${error.message}) and rollback was incomplete: ${rollback.join('; ')}`)
      throw error
    }
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
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
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const reservation = io.reserveVersion()
    const expiresAt = new Date(now.valueOf() + options.leaseHours * 3600000)
    const body = claimBody({ ...options, version: reservation.version, expiresAt })
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const url = io.createClaim(options.task, body)
    try { requireOwnedRef(MUTEX_REF,ownerSha,io) }
    catch(error) {
      const number=/\/(\d+)\/?$/.exec(String(url))?.[1]
      if(!number)throw new LaneError(`lost mutex ownership after claim creation and could not identify the claim to close: ${error.message}`)
      io.closeClaim(number)
      throw error
    }
    return { version: reservation.version, claim: url, expiresAt: expiresAt.toISOString(), requestId }
  } finally {
    // If recovery already replaced us, never delete the successor's lock and
    // never mask the original lost-ownership refusal.
    if (io.readRef(MUTEX_REF) === ownerSha) releaseOwnedRef(MUTEX_REF, ownerSha, io)
  }
}

const SPLIT_REMAINDER = 'index plm.item_upper_trim_item_number_idx'
function workstreamKey(title) {
  const match = /^CLAIM:\s+(#[0-9]+(?:\/#?[0-9]+)*)\b/.exec(String(title ?? ''))
  if (!match) throw new LaneError('claim title does not identify one exact issue workstream')
  return match[1]
}
function migrationVersions(files) {
  if(files.some((file)=>file.status==='removed'))throw new LaneError('pull request removes a file; split recovery refuses it')
  return files.map((file)=>file.filename ?? file.path ?? '').map((name)=>/^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(name)?.[1]).filter(Boolean)
}
function replaceLeaseLocation(body, branch, worktree) {
  const fence=/```db-author-lease\s*\n([\s\S]*?)```/.exec(body)
  if(!fence)throw new LaneError('active claim has no manager-owned author lease block')
  let block=fence[1]
  if((block.match(/^branch:/gm)??[]).length!==1||(block.match(/^worktree:/gm)??[]).length!==1)throw new LaneError('active claim lease location is ambiguous')
  block=block.replace(/^branch:.*$/m,`branch: ${branch}`).replace(/^worktree:.*$/m,`worktree: ${worktree}`)
  return body.slice(0,fence.index)+fence[0].replace(fence[1],()=>block)+body.slice(fence.index+fence[0].length)
}
function replaceClaimObjects(body, version, objects) {
  const fences=[...body.matchAll(/```db-claim\s*\n[\s\S]*?```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-claim block')
  const replacement=['```db-claim',`version: ${version}`,'objects:',...objects.map((object)=>`  - ${normalizeObject(object)}`),'```'].join('\n')
  return body.slice(0,fences[0].index)+replacement+body.slice(fences[0].index+fences[0][0].length)
}

function replaceLeaseExpiry(body, expiresAt) {
  const fences=[...body.matchAll(/```db-author-lease\s*\n([\s\S]*?)```/g)]
  if(fences.length!==1)throw new LaneError('claim body must contain exactly one manager-owned db-author-lease block')
  const block=fences[0][1], matches=block.match(/^expires_at:\s*.+$/gm)??[]
  if(matches.length!==1)throw new LaneError('claim lease expiry is ambiguous')
  const replacement=block.replace(/^expires_at:\s*.+$/m,`expires_at: ${expiresAt.toISOString()}`)
  return body.slice(0,fences[0].index)+fences[0][0].replace(block,()=>replacement)+body.slice(fences[0].index+fences[0][0].length)
}

function renewalIssueScope(issue, lease) {
  const scope=issue?.state==='open'?parseQueueScope(issue.body):null
  if(!scope||scope.status!=='ready'||scope.workType!=='structural'||scope.route!=='shared-db-orchestrator')throw new LaneError('renewal issue must be one open ready structural shared-db work item')
  const issueObjects=scope.objects.map(normalizeObject),claimObjects=lease.objects.map(normalizeObject)
  if(issueObjects.length!==claimObjects.length||issueObjects.some((object)=>!claimObjects.includes(object)))throw new LaneError('renewal issue objects do not exactly match the permanent claim objects')
  return claimObjects
}

export function renewExpiredClaim(options, now = new Date(), io = githubIo) {
  for(const key of ['claim','issue','owner','branch','worktree','pr','headSha','leaseHours'])if(options[key]===undefined||options[key]===null||options[key]==='')throw new LaneError(`claim renewal requires ${key}`)
  if(!Number.isFinite(options.leaseHours)||options.leaseHours<=0||options.leaseHours>24)throw new LaneError('renewal lease hours must be greater than 0 and no more than 24')
  const desiredExpiry=new Date(now.valueOf()+options.leaseHours*3600000)
  const requestId=options.requestId??randomUUID(),ownerSha=io.makeOwnerCommit(`db-coordination claim-lease-renewal ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,possiblyChanged=false
  try {
    const claims=io.openClaims(),matches=claims.filter((claim)=>String(claim.number)===String(options.claim))
    if(matches.length!==1)throw new LaneError(`claim #${options.claim} must be uniquely open`)
    before=io.getIssue(options.claim)
    if(before?.state!=='open'||before.body!==matches[0].body)throw new LaneError('claim changed concurrently before renewal')
    const claimIssues=[...String(before.title??'').matchAll(/#(\d+)\b/g)].map((match)=>Number(match[1]))
    if(!claimIssues.includes(Number(options.issue)))throw new LaneError('renewal issue number is not identified by the claim title')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy)throw new LaneError('legacy claim leases cannot be renewed')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('claim owner, branch, or worktree mismatch')
    const expectedBody=replaceLeaseExpiry(before.body,desiredExpiry)
    if(lease.active){
      if(before.body===expectedBody)return {claim:Number(options.claim),version:lease.version,expiresAt:lease.expiresAt.toISOString(),idempotent:true}
      throw new LaneError('claim has an active lease; refusing unrelated renewal')
    }
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const workIssue=io.getIssue(options.issue),claimObjects=renewalIssueScope(workIssue,lease)
    const pr=io.getPr(options.pr)
    if(pr?.state!=='open'||pr.head?.ref!==options.branch||pr.head?.sha!==options.headSha)throw new LaneError('open pull request branch or exact head mismatch')
    const fileVersions=migrationVersions(io.getPrFiles(options.pr))
    if(fileVersions.length!==1||fileVersions[0]!==lease.version)throw new LaneError('pull request migration version does not match the permanent claim version')
    const sources=io.prSources(), target=sources.filter((source)=>new RegExp(`^PR #${options.pr}(?:\\s|$)`).test(source.label))
    if(target.length!==1)throw new LaneError('pull request parser source is missing or ambiguous')
    if(target[0].versions?.length!==1||String(target[0].versions[0])!==lease.version)throw new LaneError('parsed pull request version does not match the permanent claim version')
    const claimed=new Set(claimObjects),parsed=(target[0].objects??[]).length?validateClaimObjects(target[0].objects):[]
    const uncovered=parsed.filter((object)=>!claimed.has(object))
    if(uncovered.length)throw new LaneError(`claim does not cover parsed pull request objects: ${uncovered.join(', ')}`)
    const others=claims.filter((claim)=>String(claim.number)!==String(options.claim)),otherPrs=sources.filter((source)=>source!==target[0])
    assertLaneAvailable(others,lease.objects,now,{ignoreCapacity:true,prSources:otherPrs})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const freshWorkIssue=io.getIssue(options.issue)
    if(freshWorkIssue?.state!==workIssue.state||freshWorkIssue?.body!==workIssue.body)throw new LaneError('renewal issue changed concurrently')
    renewalIssueScope(freshWorkIssue,lease)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    possiblyChanged=true;io.updateIssue(options.claim,{body:expectedBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.body!==expectedBody||afterLease.version!==lease.version||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||JSON.stringify(afterLease.objects)!==JSON.stringify(lease.objects))throw new LaneError('renewed claim exact readback failed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during renewal')
    return {claim:Number(options.claim),version:lease.version,expiresAt:afterLease.expiresAt.toISOString(),idempotent:false}
  } catch(error) {
    if(possiblyChanged){
      if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
      try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.claim,{body:before.body});requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.getIssue(options.claim)?.body!==before.body)throw new LaneError('rollback readback mismatch')}
      catch(rollbackError){throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollbackError.message}`)}
    }
    throw error
  } finally {if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export function expandActiveClaimFromPr(options, now = new Date(), io = githubIo) {
  for(const key of ['issue','claim','pr','owner','headSha','branch','worktree'])if(!options[key])throw new LaneError(`claim expansion requires ${key}`)
  if(!/^\d+$/.test(String(options.issue))||!/^\d+$/.test(String(options.claim))||!/^\d+$/.test(String(options.pr))||!/^[0-9a-f]{7,40}$/i.test(String(options.headSha)))throw new LaneError('claim expansion requires numeric issue, claim, PR, and an exact head SHA')
  const requestId=options.requestId??randomUUID(),ownerSha=io.makeOwnerCommit(`db-coordination claim-object-expansion ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,possiblyChanged=false
  try {
    before=io.getIssue(options.claim)
    if(before?.state!=='open')throw new LaneError('target claim is not open')
    if(workstreamKey(before.title)!==`#${Number(options.issue)}`)throw new LaneError('target claim does not belong to the exact issue')
    const workIssue=io.getIssue(options.issue),scope=parseQueueScope(workIssue?.body??'')
    if(workIssue?.state!=='open'||scope?.status!=='ready'||scope.workType!=='structural'||scope.route!=='shared-db-orchestrator')throw new LaneError('exact work issue is not open ready structural orchestrator work')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy||!lease.active)throw new LaneError('target claim lease is legacy or expired')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('target claim owner, branch, or worktree changed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const pr=io.getPr(options.pr)
    if(pr?.state!=='open'||pr.head?.sha!==options.headSha||pr.head?.ref!==options.branch)throw new LaneError('open pull request head or branch changed')
    const fileVersions=migrationVersions(io.getPrFiles(options.pr))
    if(fileVersions.length!==1||fileVersions[0]!==lease.version)throw new LaneError('pull request files do not contain exactly the immutable migration version')
    const sources=io.prSources(),targetSources=sources.filter((source)=>new RegExp(`^PR #${options.pr}(?:\\s|$)`).test(source.label))
    if(targetSources.length!==1)throw new LaneError('pull request parser source is missing or ambiguous')
    const target=targetSources[0]
    if(target.versions?.length!==1||String(target.versions[0])!==lease.version)throw new LaneError('pull request migration version does not match the immutable claim version')
    const claimed=new Set(lease.objects.map(normalizeObject)),parsed=validateClaimObjects(target.objects??[])
    const uncovered=parsed.filter((object)=>!claimed.has(object))
    if(!uncovered.length)throw new LaneError('pull request has no uncovered objects to add')
    const claims=io.openClaims()
    if(claims.filter((claim)=>String(claim.number)===String(options.claim)).length!==1||claims.length>MAX_AUTHOR_LANES)throw new LaneError('active claim set or lane capacity is ambiguous')
    const others=claims.filter((claim)=>String(claim.number)!==String(options.claim)),otherPrs=sources.filter((source)=>source!==target)
    assertLaneAvailable(others,uncovered,now,{ignoreCapacity:true,prSources:otherPrs})
    const expanded=[...lease.objects.map(normalizeObject),...uncovered]
    const updatedBody=replaceClaimObjects(before.body,lease.version,expanded)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    possiblyChanged=true;io.updateIssue(options.claim,{body:updatedBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.body!==updatedBody||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||afterLease.version!==lease.version||JSON.stringify([...afterLease.objects].sort())!==JSON.stringify([...expanded].sort()))throw new LaneError('expanded claim exact readback failed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during claim expansion')
    return {claim:Number(options.claim),version:lease.version,added:uncovered,objects:afterLease.objects}
  } catch(error) {
    if(possiblyChanged){
      if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
      try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.claim,{body:before.body});requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.getIssue(options.claim)?.body!==before.body)throw new LaneError('rollback readback mismatch')}
      catch(rollbackError){throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollbackError.message}`)}
    }
    throw error
  } finally {if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export function expandActiveClaimFromIssue(options,now=new Date(),io=githubIo){
  for(const key of ['issue','claim','owner','branch','worktree'])if(!options[key])throw new LaneError(`issue-scope claim expansion requires ${key}`)
  if(!/^\d+$/.test(String(options.issue))||!/^\d+$/.test(String(options.claim)))throw new LaneError('issue-scope claim expansion requires numeric issue and claim')
  const requestId=options.requestId??randomUUID(),ownerSha=io.makeOwnerCommit(`db-coordination claim-object-expansion ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let before,possiblyChanged=false
  try{
    before=io.getIssue(options.claim)
    if(before?.state!=='open'||workstreamKey(before.title)!==`#${Number(options.issue)}`)throw new LaneError('target claim is not open or does not belong to the exact issue')
    const lease=parseAuthorLease(before.body,now)
    if(lease.legacy||!lease.active)throw new LaneError('target claim lease is legacy or expired')
    if(lease.owner!==options.owner||lease.branch!==options.branch||lease.worktree!==options.worktree)throw new LaneError('target claim owner, branch, or worktree changed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent version reservation is unreadable')
    const workIssue=io.getIssue(options.issue),scope=parseQueueScope(workIssue?.body??'')
    if(workIssue?.state!=='open'||scope?.status!=='ready'||scope.workType!=='structural'||scope.route!=='shared-db-orchestrator')throw new LaneError('exact work issue is not open ready structural orchestrator work')
    const claimed=new Set(lease.objects.map(normalizeObject)),uncovered=scope.objects.filter((object)=>!claimed.has(object))
    if(!uncovered.length)throw new LaneError('exact work issue has no uncovered objects to add')
    const claims=io.openClaims()
    if(claims.filter((claim)=>String(claim.number)===String(options.claim)).length!==1||claims.length>MAX_AUTHOR_LANES)throw new LaneError('active claim set or lane capacity is ambiguous')
    const others=claims.filter((claim)=>String(claim.number)!==String(options.claim)),sources=io.prSources()
    assertLaneAvailable(others,uncovered,now,{ignoreCapacity:true,prSources:sources})
    const expanded=[...lease.objects.map(normalizeObject),...uncovered],updatedBody=replaceClaimObjects(before.body,lease.version,expanded)
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    possiblyChanged=true;io.updateIssue(options.claim,{body:updatedBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const after=io.getIssue(options.claim),afterLease=parseAuthorLease(after?.body??'',now)
    if(after?.state!=='open'||after.body!==updatedBody||afterLease.owner!==lease.owner||afterLease.branch!==lease.branch||afterLease.worktree!==lease.worktree||afterLease.version!==lease.version||JSON.stringify([...afterLease.objects].sort())!==JSON.stringify([...expanded].sort()))throw new LaneError('expanded claim exact readback failed')
    if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during claim expansion')
    return {claim:Number(options.claim),version:lease.version,added:uncovered,objects:afterLease.objects}
  }catch(error){
    if(possiblyChanged){
      if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost`)
      try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.claim,{body:before.body});requireOwnedRef(MUTEX_REF,ownerSha,io);if(io.getIssue(options.claim)?.body!==before.body)throw new LaneError('rollback readback mismatch')}
      catch(rollbackError){throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollbackError.message}`)}
    }
    throw error
  }finally{if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io)}
}

export function recoverSameOwnerSplit(options, now = new Date(), io = githubIo) {
  for(const key of ['releasedClaim','activeClaim','sourcePr','targetPr','targetBranch','targetWorktree'])if(!options[key])throw new LaneError(`split recovery requires ${key}`)
  const requestId=options.requestId??randomUUID(), ownerSha=io.makeOwnerCommit(`db-coordination claim-split-recovery ${requestId}`)
  acquireMutex(ownerSha,io,options.mutexAttempts??100)
  let releasedBefore,activeBefore,releasedChanged=false,activeChanged=false
  try {
    if(String(options.releasedClaim)!=='1058'||String(options.activeClaim)!=='1063'||String(options.sourcePr)!=='1060')throw new LaneError('split recovery is pinned to claims #1058/#1063 and source PR #1060')
    if(!/^\d+$/.test(String(options.targetPr)))throw new LaneError('target pull request must be numeric')
    if(String(options.sourcePr)===String(options.targetPr))throw new LaneError('source and target pull requests must differ')
    releasedBefore=io.getIssue(options.releasedClaim);activeBefore=io.getIssue(options.activeClaim)
    if(releasedBefore?.state!=='closed'||activeBefore?.state!=='open')throw new LaneError('split recovery requires one closed original claim and one open active claim')
    if(workstreamKey(releasedBefore.title)!=='#853/#868'||workstreamKey(activeBefore.title)!=='#853/#868')throw new LaneError('claims do not belong to the pinned #853/#868 workstream')
    const closeComments=io.getIssueComments(options.releasedClaim)
    if(closeComments.at(-1)?.body!=='Expired migration-author lease closed by guarded cleanup. Its migration version remains unavailable.')throw new LaneError('closed claim does not have the exact guarded-release reason')
    const released=parseAuthorLease(releasedBefore.body,now),active=parseAuthorLease(activeBefore.body,now)
    if(released.legacy||active.legacy||released.owner!==active.owner)throw new LaneError('claims do not have the same exact manager owner')
    if(!released.active||!active.active)throw new LaneError('split recovery requires both exact leases to remain unexpired')
    if(released.version===active.version)throw new LaneError('split claims must retain two different permanent versions')
    const original=new Set(released.objects.map(normalizeObject)),combined=new Set(active.objects.map(normalizeObject))
    if(original.size>=combined.size||[...original].some((object)=>!combined.has(object)))throw new LaneError('original claim objects are not an exact strict subset')
    const remainder=[...combined].filter((object)=>!original.has(object))
    if(remainder.length!==1||remainder[0]!==SPLIT_REMAINDER)throw new LaneError(`split remainder must be exactly ${SPLIT_REMAINDER}`)
    for(const lease of [released,active])if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError(`permanent reservation for ${lease.version} is unreadable`)
    const source=io.getPr(options.sourcePr),target=io.getPr(options.targetPr)
    if(source?.state!=='open'||source.head?.ref!==released.branch)throw new LaneError('source pull request does not match the original claim branch')
    if(target?.state!=='open'||target.head?.ref!==options.targetBranch)throw new LaneError('target pull request does not match the requested split branch')
    if(options.targetBranch===released.branch)throw new LaneError('split recovery requires two different pull-request branches')
    const sourceVersions=migrationVersions(io.getPrFiles(options.sourcePr)),targetVersions=migrationVersions(io.getPrFiles(options.targetPr))
    if(sourceVersions.length!==1||sourceVersions[0]!==released.version)throw new LaneError('source pull request must contain only the original migration version')
    if(targetVersions.length!==1||targetVersions[0]!==active.version)throw new LaneError('target pull request must contain only the remainder migration version')
    const thirdParty=io.openClaims().filter((claim)=>![String(options.activeClaim),String(options.releasedClaim)].includes(String(claim.number)))
    const incidentPr=new RegExp(`^PR #(?:${options.sourcePr}|${options.targetPr})(?:\\s|$)`)
    const thirdPartyPrs=io.prSources().filter((pr)=>!incidentPr.test(pr.label))
    const reservedVersions=new Set([released.version,active.version])
    const versionCollision=thirdPartyPrs.find((pr)=>(pr.versions??[]).some((version)=>reservedVersions.has(String(version))))
    if(versionCollision)throw new LaneError(`migration version collision with ${versionCollision.label}`)
    assertLaneAvailable(thirdParty,[...combined],now,{prSources:thirdPartyPrs})
    if(thirdParty.length+2>MAX_AUTHOR_LANES)throw new LaneError('split recovery would exceed migration-author capacity')
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const activeBody=replaceLeaseLocation(activeBefore.body,options.targetBranch,options.targetWorktree)
    activeChanged=true;io.updateIssue(options.activeClaim,{body:activeBody})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    releasedChanged=true;io.updateIssue(options.releasedClaim,{state:'open'})
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    const activeAfter=io.getIssue(options.activeClaim),releasedAfter=io.getIssue(options.releasedClaim)
    if(activeAfter?.body!==activeBody||activeAfter?.state!=='open'||releasedAfter?.body!==releasedBefore.body||releasedAfter?.state!=='open')throw new LaneError('split recovery readback did not match both exact claims')
    for(const lease of [released,active])if(!io.readRef(`refs/db-claims/${lease.version}`))throw new LaneError('permanent reservation disappeared during split recovery')
    return {restored:Number(options.releasedClaim),rebound:Number(options.activeClaim),owner:active.owner,versions:[released.version,active.version]}
  } catch(error) {
    const rollback=[]
    if(io.readRef(MUTEX_REF)!==ownerSha)throw new LaneError(`${error.message}; ROLLBACK NOT ATTEMPTED because mutex ownership was lost; manual manager recovery required`)
    if(releasedChanged){try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.releasedClaim,{state:'closed'});rollback.push('released claim')}catch(e){rollback.push(`FAILED released claim: ${e.message}`)}}
    if(activeChanged){try{requireOwnedRef(MUTEX_REF,ownerSha,io);io.updateIssue(options.activeClaim,{body:activeBefore.body});rollback.push('active claim')}catch(e){rollback.push(`FAILED active claim: ${e.message}`)}}
    if(rollback.some((x)=>x.startsWith('FAILED')))throw new LaneError(`${error.message}; ROLLBACK INCOMPLETE: ${rollback.join(', ')}`)
    throw error
  } finally { if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io) }
}

// Every migration version a pull request ADDED. `added` only, deliberately: a
// rehearsal is allowed to apply versions this PR authored, never one it merely
// touched, renamed or inherited from another claim.
export function addedMigrationVersions(files) {
  if (!Array.isArray(files)) throw new LaneError('pull request files are unreadable; a post-merge preview rehearsal never assumes them')
  return files
    .filter((file) => file?.status === 'added')
    .map((file) => /^supabase\/migrations\/(\d{14})_[^/]+\.sql$/.exec(file.filename ?? file.path ?? '')?.[1])
    .filter(Boolean)
}

// THE AUTHORISATION for a post-merge rehearsal, in place of a live branch claim.
// Stated as what it enforces rather than as a strength ranking: a branch claim
// proves someone intends to merge; this proves the work IS merged and IS carried
// by the main tip being rehearsed. It does not prove anything a branch claim
// proves about WHO is rehearsing -- the preview lock, not this function, is what
// keeps two rehearsals apart.
export function assertMergeCommitInMainHistory(mergeSha, mainSha, io = githubIo) {
  let comparison
  try {
    // base = the merge commit, head = the main tip. NEVER the other way round.
    comparison = io.compareCommits?.(mergeSha, mainSha)
  } catch (error) {
    throw new LaneError(`merge-commit ancestry is unreadable (${error.message}); a post-merge preview rehearsal never assumes it`)
  }
  if (!comparison || typeof comparison.status !== 'string' || !Number.isInteger(comparison.behind_by)) {
    throw new LaneError('merge-commit ancestry is unreadable; a post-merge preview rehearsal never assumes it')
  }
  // `identical` is the ordinary case: the merge just happened and its commit IS
  // the tip. `ahead` means later commits landed on top. `behind_by` must be zero
  // in both, which is what refuses a diverged or rewritten history.
  if (comparison.behind_by !== 0 || !['identical', 'ahead'].includes(comparison.status)) {
    throw new LaneError(`merge commit ${mergeSha} is not contained in the history of main tip ${mainSha} (compare status ${comparison.status}, behind_by ${comparison.behind_by})`)
  }
  return comparison
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
    } else if (kind === 'preview-rehearsal') {
      // POST-MERGE PREVIEW REHEARSAL -- the path that makes "merge first, then
      // rehearse on preview from merged main, then promote" executable. There is
      // no live author claim to point at: the guarded merge released the claim
      // and deleted the branch. Authorisation comes from merge-commit ancestry
      // of the current main tip instead. Every failure below is fail-closed and
      // names exactly what was missing.
      const mainSha = io.mainSha?.()
      if (!mainSha) throw new LaneError('post-merge preview rehearsal cannot read the current main tip; GitHub state is unreadable')
      if (metadata.headSha !== mainSha) throw new LaneError(`post-merge preview rehearsal requires the exact current main SHA (asked for ${metadata.headSha}, main is ${mainSha})`)
      let pr
      try { pr = io.getPr?.(metadata.pr) } catch (error) { throw new LaneError(`post-merge preview rehearsal cannot read pull request #${metadata.pr} (${error.message})`) }
      if (!pr) throw new LaneError(`post-merge preview rehearsal cannot read pull request #${metadata.pr}`)
      if (pr.merged !== true || !pr.merge_commit_sha) throw new LaneError(`post-merge preview rehearsal requires an already-merged source PR; #${metadata.pr} is not merged`)
      assertMergeCommitInMainHistory(pr.merge_commit_sha, mainSha, io)
      const versions = (metadata.versions ?? []).map((v) => String(v).trim()).filter(Boolean)
      if (!versions.length) throw new LaneError('post-merge preview rehearsal requires the exact migration versions it will apply')
      if (versions.some((v) => !/^\d{14}$/.test(v))) throw new LaneError('post-merge preview rehearsal versions must each be an exact 14-digit migration version')
      let files
      try { files = io.getPrFiles?.(metadata.pr) } catch (error) { throw new LaneError(`post-merge preview rehearsal cannot read the files of pull request #${metadata.pr} (${error.message})`) }
      const added = addedMigrationVersions(files)
      const missing = versions.filter((v) => !added.includes(v))
      if (missing.length) throw new LaneError(`post-merge preview rehearsal versions were not added by pull request #${metadata.pr}: ${missing.join(', ')}`)
    } else if (kind === 'preview-recovery') {
      if (metadata.headSha !== io.mainSha?.()) throw new LaneError('historical preview recovery requires the exact current main SHA')
      const pr = io.getPr?.(metadata.pr)
      if (pr?.merged !== true || !pr?.merge_commit_sha) throw new LaneError('historical preview recovery requires an already-merged source PR')
    } else {
      const pr = io.getPr?.(metadata.pr)
      if (!pr?.head?.sha || pr.head.sha !== metadata.headSha) throw new LaneError('exclusive lane head SHA does not match the live pull request')
      const claims = io.openClaims()
      const matching = claims.map((claim)=>({ ...claim, lease:parseAuthorLease(claim.body) })).filter((claim)=>!claim.lease.legacy && claim.lease.branch===pr.head.ref && claim.lease.active)
      if (matching.length !== 1) throw new LaneError('exclusive lane requires exactly one live author claim for the pull-request branch')
      if (kind === 'merge' && pr.base?.sha !== io.mainSha?.()) throw new LaneError('pull request is not based on the current main tip')
      if (kind === 'merge' && io.readRef(EXCLUSIVE_REFS.production)) throw new LaneError('production promotion is active; merges are frozen')
    }
    requireOwnedRef(MUTEX_REF,ownerSha,io)
    acquireRef(ref, ownerSha, io)
    return { kind, ref, ownerSha, requestId }
  } finally { if (io.readRef(MUTEX_REF) === ownerSha) releaseOwnedRef(MUTEX_REF, ownerSha, io) }
}

function parseArgs(argv) {
  const out = { objects: [] }
  const next = (i) => { if (i + 1 >= argv.length) throw new LaneError(`${argv[i]} needs a value`); return argv[i + 1] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--claim') out.claim = true
    else if (a === '--audit') out.audit = true
    else if (a === '--queue-audit') out.queueAudit = true
    else if (a === '--assign-reviewer') out.assignReviewer = true
    else if (a === '--replace-failed-reviewer') out.replaceFailedReviewer = true
    else if (a === '--reviewer-preflight') out.reviewerPreflight = true
    else if (a === '--cleanup-stale') out.cleanup = true
    else if (a === '--release-claim') out.releaseClaim = next(i), i++
    else if (a === '--confirm-finished') out.confirmFinished = true
    else if (a === '--recover-author-mutex') out.recoverMutex = true
    else if (a === '--recover-same-owner-split') out.recoverSplit = true
    else if (a === '--expand-active-claim-from-pr') out.expandClaim = true
    else if (a === '--expand-active-claim-from-issue') out.expandClaimFromIssue = true
    else if (a === '--renew-claim') out.renewClaim = true
    else if (a === '--reversion-active-claim' || a === '--supersede-active-claim-version') out.reversionClaim = true
    else if (a === '--confirm-stale') out.confirmStale = true
    else if (/^--acquire-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.acquireExclusive = a.slice(10)
    else if (/^--release-(preview|preview-recovery|preview-rehearsal|merge|production)$/.test(a)) out.releaseExclusive = a.slice(10)
    else if (['--task','--owner','--branch','--worktree','--issue','--pr','--head-sha','--owner-sha','--expected-sha','--released-claim','--active-claim','--source-pr','--target-pr','--target-branch','--target-worktree','--claim-number','--failed-sequence','--failure-code','--old-version','--reviewer','--wrapper'].includes(a)) { out[a.slice(2).replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = next(i); i++ }
    else if(a==='--confirm-no-verdict')out.confirmNoVerdict=true
    else if(a==='--confirm-no-artifact')out.confirmNoArtifact=true
    else if (a === '--versions') { out.versions = next(i).split(',').map((v)=>v.trim()).filter(Boolean); i++ }
    else if (a === '--objects') { out.objects.push(...next(i).split(',').map((v)=>v.trim()).filter(Boolean)); i++ }
    else if (a === '--lease-hours') { out.leaseHours = Number(next(i)); i++ }
    else throw new LaneError(`unknown argument: ${a}`)
  }
  return out
}

export function main(argv, now = new Date(), io = githubIo) {
  try {
    const o = parseArgs(argv)
    if(o.recoverMutex){console.log(JSON.stringify(recoverStaleAuthorMutex({expectedSha:o.expectedSha,confirmStale:o.confirmStale,serializedRecovery:process.env.GITHUB_ACTIONS==='true'&&process.env.AUTHOR_MUTEX_RECOVERY_SERIALIZED==='true',now},io),null,2));return 0}
    if(o.recoverSplit){console.log(JSON.stringify(recoverSameOwnerSplit(o,now,io),null,2));return 0}
    if(o.expandClaim){console.log(JSON.stringify(expandActiveClaimFromPr({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.expandClaimFromIssue){console.log(JSON.stringify(expandActiveClaimFromIssue({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.renewClaim){console.log(JSON.stringify(renewExpiredClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.reversionClaim){console.log(JSON.stringify(reversionActiveClaim({...o,claim:o.claimNumber},now,io),null,2));return 0}
    if(o.replaceFailedReviewer){console.log(JSON.stringify(replaceFailedReviewer(o,io),null,2));return 0}
    if(o.reviewerPreflight){console.log(JSON.stringify(reviewerExecutionPreflight(o,io),null,2));return 0}
    if (o.acquireExclusive) { console.log(JSON.stringify(acquireExclusive(o.acquireExclusive, { owner:o.owner, pr:o.pr, headSha:o.headSha, versions:o.versions }, io), null, 2)); return 0 }
    if (o.releaseExclusive) { if (!o.ownerSha) throw new LaneError('--owner-sha is required for safe release'); releaseOwnedRef(EXCLUSIVE_REFS[o.releaseExclusive], o.ownerSha, io); return 0 }
    const claims = io.openClaims()
    if(o.assignReviewer){console.log(JSON.stringify(assignNextReviewer({issue:o.issue,pr:o.pr,headSha:o.headSha},io),null,2));return 0}
    if (o.queueAudit) {
      const result = buildDynamicQueues(io.openWorkIssues(), claims, now, io.openIssueNumbers())
      console.log(JSON.stringify(result,null,2))
      if (result.dispatchable.length) { console.error(`REFILL REQUIRED NOW: dispatch issue(s) ${result.dispatchable.map((n)=>`#${n}`).join(', ')}`); return 2 }
      if (result.unlabelled.length) console.error(`UNLABELLED ISSUES: add the \`${WORK_LABEL}\` label to ${result.unlabelled.map((n)=>`#${n}`).join(', ')} — an unlabelled issue is invisible to every label-filtered query`)
      if (result.emptyLanes && !result.fullyAudited) { console.error('EMPTY LANE NOT PROVEN: classify and label every open issue before claiming no eligible work exists'); return 2 }
      return result.malformed.length || result.unlabelled.length ? 2 : 0
    }
    if (o.releaseClaim) {
      if (!o.confirmFinished || !o.owner) throw new LaneError('--release-claim requires exact --owner and --confirm-finished')
      const requestId=randomUUID(), ownerSha=io.makeOwnerCommit(`db-coordination claim-release ${requestId}`)
      acquireMutex(ownerSha,io)
      try {
        const fresh=io.openClaims(), claim=fresh.find((x)=>String(x.number)===String(o.releaseClaim))
        if(!claim)throw new LaneError(`claim #${o.releaseClaim} is not open`)
        const lease=parseAuthorLease(claim.body,now)
        if(lease.owner!==o.owner)throw new LaneError(`claim #${o.releaseClaim} belongs to a different owner`)
        if((io.openPulls?.() ?? io.prSources()).some((pr)=>(pr.head?.ref ?? pr.branch)===lease.branch))throw new LaneError(`claim branch ${lease.branch} still has an open pull request`)
        requireOwnedRef(MUTEX_REF,ownerSha,io)
        io.closeClaim(claim.number)
      } finally { if(io.readRef(MUTEX_REF)===ownerSha)releaseOwnedRef(MUTEX_REF,ownerSha,io) }
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
    if (!o.claim) throw new LaneError('choose --claim, --audit, --queue-audit, --cleanup-stale, or an exclusive-lane command')
    for (const k of ['task','owner','branch','worktree']) if (!o[k]) throw new LaneError(`--${k} is required`)
    if (!o.objects.length) throw new LaneError('--objects must name every database object exactly')
    o.leaseHours ??= DEFAULT_LEASE_HOURS
    if (!Number.isFinite(o.leaseHours) || o.leaseHours <= 0 || o.leaseHours > 24) throw new LaneError('--lease-hours must be greater than 0 and no more than 24')
    console.log(JSON.stringify(acquireAuthorLane(o, now, io), null, 2)); return 0
  } catch (error) { console.error(`REFUSED: ${error.message}`); return 2 }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) process.exitCode = main(process.argv.slice(2))
