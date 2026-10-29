#!/usr/bin/env node
// Read-only hold monitoring. The workflow retains authorization/release ownership.
import { fileURLToPath } from 'node:url'
import { ghJson } from './lib/github-transport.mjs'
import { resolveRepositoryIdentity } from './lib/repository-identity.mjs'
import { observedStates, SELF_CONTEXT, GITHUB_ACTIONS_APP_ID } from './check-required-checks-preflight.mjs'

export const HOLD_SECONDS = 900
export const POLL_SECONDS = 15
export const QUEUE_SELF_CONTEXT = 'Queue interlock'
export class QueueHoldError extends Error {}

// This monitor cannot authorize a merge. GitHub's per-reported-context required
// flags let its read-only token notice red checks; the existing administrative
// effective-settings preflight remains the separate merge authority.
export function requiredCheckProgress(input, groupSha) {
  if (input?.sha !== groupSha || !Array.isArray(input.contexts)) throw new QueueHoldError('exact-group reported required-check flags are unreadable')
  const statuses = [], checkRuns = [], required = new Map()
  for (const node of input.contexts) {
    if (typeof node?.isRequired !== 'boolean') throw new QueueHoldError('reported required-check flag is unreadable')
    if (node.__typename === 'CheckRun') {
      if (typeof node.name !== 'string' || !node.name || !Number.isSafeInteger(node.databaseId) || node.databaseId <= 0 || !Number.isSafeInteger(node.checkSuite?.app?.databaseId) || node.checkSuite.app.databaseId <= 0 || !['COMPLETED','IN_PROGRESS','PENDING','QUEUED','REQUESTED','WAITING'].includes(node.status) || (node.status === 'COMPLETED' && (typeof node.conclusion !== 'string' || !node.conclusion))) throw new QueueHoldError('reported check-run identity or state is unreadable')
      if (!node.isRequired) continue
      if ([SELF_CONTEXT, QUEUE_SELF_CONTEXT].includes(node.name)) {
        if (node.checkSuite.app.databaseId !== GITHUB_ACTIONS_APP_ID) throw new QueueHoldError('self check requires a different producer')
        continue
      }
      const appId = node.checkSuite.app.databaseId
      required.set(`check:${node.name}:${appId}`, { context: node.name, appId })
      checkRuns.push({name:node.name,id:node.databaseId,head_sha:groupSha,app:{id:appId},status:node.status.toLowerCase(),conclusion:node.conclusion?.toLowerCase(),started_at:node.startedAt,completed_at:node.completedAt})
    } else if (node.__typename === 'StatusContext') {
      if (typeof node.id !== 'string' || !node.id || typeof node.context !== 'string' || !node.context || !['ERROR','FAILURE','PENDING','SUCCESS','EXPECTED'].includes(node.state) || !Number.isFinite(Date.parse(node.createdAt))) throw new QueueHoldError('reported commit-status identity or state is unreadable')
      if (!node.isRequired || [SELF_CONTEXT,QUEUE_SELF_CONTEXT].includes(node.context)) continue
      required.set(`status:${node.context}`, { context: node.context, appId: null })
      statuses.push({context:node.context,state:node.state === 'EXPECTED' ? 'pending' : node.state.toLowerCase(),created_at:node.createdAt})
    } else throw new QueueHoldError('reported required-check context type is unreadable')
  }
  const pending = [], failing = []
  for (const {context,appId} of required.values()) {
    const state = observedStates({statuses,checkRuns,appId,sha:groupSha}).get(context)
    if (state === undefined || state === 'pending' || state === '') pending.push(context)
    else if (state !== 'success') failing.push(`${context} (${state})`)
  }
  if (failing.length) throw new QueueHoldError(`required merge-group check failed: ${failing.join(', ')}`)
  // Absent contexts are not proof of green. Even no reported required contexts
  // waits for the real merge/ejection or the full healthy hold budget.
  return {missing:required.size ? [] : ['required contexts not yet reported'],pending}
}

export function readReportedRequiredChecks(repo, number, sha, read = ghJson, {now = Date.now, deadline = now()+HOLD_SECONDS*1000} = {}) {
  const [owner,name] = repo.split('/'), contexts = [], cursors = new Set(), identities = new Set()
  let after
  for (;;) {
    if (now() >= deadline) throw new QueueHoldError('queue mutation did not land within the 900-second hold budget')
    const args = ['api','graphql','-f','query=query($owner:String!,$name:String!,$number:Int!,$sha:GitObjectID!,$after:String){repository(owner:$owner,name:$name){object(oid:$sha){... on Commit{oid statusCheckRollup{contexts(first:100,after:$after){nodes{__typename ... on CheckRun{name databaseId status conclusion isRequired(pullRequestNumber:$number) startedAt completedAt checkSuite{app{databaseId}}} ... on StatusContext{id context state createdAt isRequired(pullRequestNumber:$number)}} pageInfo{hasNextPage endCursor}}}}}}}', '-f',`owner=${owner}`,'-f',`name=${name}`,'-F',`number=${number}`,'-f',`sha=${sha}`]
    if (after !== undefined) args.push('-f',`after=${after}`)
    // These fixed documents are queries only. The shared transport conservatively
    // classifies GraphQL POST as mutating; its supported idempotency proof keeps
    // transient read retries without replaying a mutation or waiting on quota.
    const response = read(args, { attempts: 4, idempotentWrite: true, maxRateLimitWaitMs: 0 }), object = response?.data?.repository?.object
    if (response?.errors?.length || object?.oid !== sha) throw new QueueHoldError('exact-group required-context read failed')
    if (object.statusCheckRollup === null) {
      if (after !== undefined) throw new QueueHoldError('required contexts changed during pagination')
      return {sha,contexts}
    }
    const connection = object.statusCheckRollup?.contexts, info = connection?.pageInfo
    if (!Array.isArray(connection?.nodes) || connection.nodes.length > 100 || typeof info?.hasNextPage !== 'boolean' || (info.endCursor !== null && typeof info.endCursor !== 'string')) throw new QueueHoldError('required-context pagination is unreadable')
    for (const node of connection.nodes) {
      const identity = node?.__typename === 'CheckRun' ? `check:${node.databaseId}` : node?.__typename === 'StatusContext' ? `status:${node.id}` : null
      if (!identity || identities.has(identity)) throw new QueueHoldError('required-context pagination repeated an identity')
      identities.add(identity);contexts.push(node)
    }
    if (!info.hasNextPage) return {sha,contexts}
    if (!connection.nodes.length || !info.endCursor || cursors.has(info.endCursor)) throw new QueueHoldError('required-context pagination did not advance')
    cursors.add(info.endCursor);after=info.endCursor
  }
}

export function readQueuePullRequest(repo, number, read = ghJson) {
  const [owner, name] = repo.split('/')
  const response = read(['api', 'graphql', '-f', 'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){number state baseRefName headRefOid mergeQueueEntry{id}}}}', '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`], { attempts: 4, idempotentWrite: true, maxRateLimitWaitMs: 0 })
  if (response?.errors?.length) throw new QueueHoldError('queue membership read returned GraphQL errors')
  return response?.data?.repository?.pullRequest
}

export async function holdMergeQueue(env = process.env, deps = {}) {
  const repo = deps.repo ?? resolveRepositoryIdentity()
  const number = Number(env.PR_NUMBER), head = env.PR_HEAD_SHA, group = env.MERGE_GROUP_SHA, ref = env.MERGE_GROUP_REF
  if (!Number.isSafeInteger(number) || number <= 0 || !/^[a-f0-9]{40}$/.test(head ?? '') || !/^[a-f0-9]{40}$/.test(group ?? '') || !/^refs\/heads\/gh-readonly-queue\/main\/[A-Za-z0-9._/-]+$/.test(ref ?? '') || ref.split('/').some(part => part === '..' || part === '.')) throw new QueueHoldError('exact PR head and merge-group identity are required')
  const read = deps.read ?? ghJson
  const pullRequest = deps.pullRequest ?? (() => readQueuePullRequest(repo, number, read))
  const groupHead = deps.groupHead ?? (() => read(['api', `repos/${repo}/git/ref/${ref.slice(5)}`])?.object?.sha)
  const now = deps.now ?? Date.now, wait = deps.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), log = deps.log ?? console.log
  const deadline = now() + HOLD_SECONDS * 1000
  const gather = deps.gather ?? (() => readReportedRequiredChecks(repo, number, group, read, {now,deadline}))
  for (;;) {
    if (now() >= deadline) throw new QueueHoldError('queue mutation did not land within the 900-second hold budget')
    const pr = pullRequest()
    if (pr?.number !== number || pr.baseRefName !== 'main' || pr.headRefOid !== head) throw new QueueHoldError('queued PR identity or current head changed')
    if (pr.state === 'MERGED') return { merged: true, pr: number, head }
    if (pr.state !== 'OPEN' || !pr.mergeQueueEntry || typeof pr.mergeQueueEntry.id !== 'string' || !pr.mergeQueueEntry.id) throw new QueueHoldError('PR left the merge queue without merging')
    if (groupHead() !== group) throw new QueueHoldError('merge group was replaced or removed')
    const progress = requiredCheckProgress(gather(), group)
    // Re-read after all authority/check calls; an ejection or head change during
    // those reads must not spend another poll holding the production exclusion.
    const fresh = pullRequest()
    if (fresh?.number !== number || fresh.baseRefName !== 'main' || fresh.headRefOid !== head) throw new QueueHoldError('queued PR identity or current head changed')
    if (fresh.state === 'MERGED') return { merged: true, pr: number, head }
    if (fresh.state !== 'OPEN' || !fresh.mergeQueueEntry?.id) throw new QueueHoldError('PR left the merge queue without merging')
    const remaining = deadline - now()
    if (remaining <= 0) throw new QueueHoldError('queue mutation did not land within the 900-second hold budget')
    log(`Waiting for queued PR #${number}: ${progress.pending.length} pending, ${progress.missing.length} unreported required checks`)
    await wait(Math.min(POLL_SECONDS * 1000, remaining))
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  holdMergeQueue().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(`REFUSED: ${error.message}`); process.exitCode = 1 })
}
