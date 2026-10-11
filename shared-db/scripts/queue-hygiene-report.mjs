#!/usr/bin/env node
// Queue hygiene report (issue #3199 Phase A3) — the scheduled, read-only twin
// of the interactive `--queue-audit`.
//
// WHY A STANDALONE MODULE (a 2026-09-17 placement decision, not the plan's
// first draft): the plan drafted this as a subcommand inside
// scripts/manage-migration-author-lanes.mjs. That file is a PROTECTED
// COORDINATION SOURCE (scripts/check-pr-source-collisions.mjs): at the time a
// later overlapping ready pull request was refused (#3721 later made it queue
// in the merge queue, proved at merge_group time), and on the day this landed another session's
// pull request (#3215) held the lane. Rather than queue behind it, the report
// moved here — importing the same exported machinery (buildDynamicQueues,
// parseAuthorLease, githubIo) so the derivation stays THE audit's derivation,
// never a parallel one. The lane script itself is untouched by this change.
//
// Also reports explicit prerequisite stages and current accepted-stage evidence,
// ownership, cycles, and verified work awaiting administrative closure.
//
// THE TWO PROPERTIES THAT MAKE IT SCHEDULABLE:
//   1. WRITE-FREE BY CONSTRUCTION. `hygieneReportIo` strips every githubIo
//      mutation hook before any read begins — the `reportOnlyFlowIo`
//      discipline from the abandonment audit: a write becomes a thrown error,
//      never a silent success. The workflow's read-only permissions make the
//      same promise structural.
//   2. A BACKED-UP QUEUE IS NOT DIRTY. Dispatchable structural work is the
//      normal state this program relieves, so this exits 0 when the report
//      could be produced. The interactive `--queue-audit` stays the loud
//      refusal. A throw (unreadable GitHub state) falls through to exit 2:
//      an instrument that could not read must never be mistaken for a clean
//      queue. Exit-non-zero-on-dirty-queue is deliberately NOT implemented
//      (plan §8 open question — decide after a week of daily runs).
import { githubIo, buildDynamicQueues, parseAuthorLease, parseQueueScope, verifyCompletionAcceptance, WORK_LABEL, OUTSIDE_ORCHESTRATOR_EXITS, LaneError } from './manage-migration-author-lanes.mjs'
import { classifyDependency, dependencyIssue, findDependencyCycles, findCompletionRecord } from './lib/work-dependencies.mjs'
import { createStageEvidenceVerifier } from './lib/work-stage-evidence.mjs'
import { resolveRepositoryIdentity } from './lib/repository-identity.mjs'
import { pathToFileURL } from 'node:url'

// The refuse list names every hook on githubIo that creates, updates, deletes
// or pushes anything. Kept explicit — a new mutation hook on githubIo is a
// decision this list must hear about, not silently inherit.
export function hygieneReportIo(io) {
  const refuse = (name) => () => { throw new LaneError(`read-only queue hygiene report must never call ${name}`) }
  return {
    ...io,
    postCommitStatus: refuse('postCommitStatus'),
    pauseReviewerFailure: refuse('pauseReviewerFailure'),
    updateIssue: refuse('updateIssue'),
    makeOwnerCommit: refuse('makeOwnerCommit'),
    makeReviewVerdictCommit: refuse('makeReviewVerdictCommit'),
    createRef: refuse('createRef'),
    deleteRef: refuse('deleteRef'),
    updateRef: refuse('updateRef'),
    atomicReviewRefs: refuse('atomicReviewRefs'),
    atomicReviewMutexRelease: refuse('atomicReviewMutexRelease'),
    releaseRefOverGit: refuse('releaseRefOverGit'),
    reserveVersion: refuse('reserveVersion'),
    createClaim: refuse('createClaim'),
    createIssueIn: refuse('createIssueIn'),
    commentIssue: refuse('commentIssue'),
    closeIssue: refuse('closeIssue'),
    closeClaim: refuse('closeClaim'),
    contentPreservingRefresh: refuse('contentPreservingRefresh'),
    // Found by the governed Grok review of head fd7d1327 (REVISE, 2026-09-17):
    // these two also write — one rewrites files in a worktree, the other runs
    // git commit + git push — so the refuse list is incomplete without them.
    rewriteVersion: refuse('rewriteVersion'),
    commitAndPushReversion: refuse('commitAndPushReversion'),
  }
}

// Read the same current-world evidence as admission. This report never publishes
// events, closes issues, registers waits, or treats a missing proof as delivery.
export function dependencyHygiene(issues, io, repository) {
  const states = new Map(), scopes = new Map(), rows = [], edges = new Map()
  const owner = issue => {
    const assigned = (issue?.assignees ?? []).map(x => x.login ?? x).filter(x => typeof x === 'string' && x.trim())
    return assigned.length ? assigned.join(', ') : /^owner:\s*(\S[^\r\n]*)/mi.exec(issue?.body ?? '')?.[1]?.trim() ?? null
  }
  const read = number => {
    if (states.has(number)) return states.get(number)
    let state
    try {
      const listed = issues.find(x => Number(x.number) === number)
      // The queue listing historically omits assignees; absence in that projection
      // must not be reported as absence of an owner on GitHub.
      const issue = listed && Array.isArray(listed.assignees) ? listed : io.getIssue(number)
      if (!issue || issue.pull_request) throw new Error('work issue is absent or is a pull request')
      const comments = io.getIssueComments(number).map(c => ({ ...c, author: c.user?.login ?? c.author }))
      state = { exists: true, open: issue.state !== 'closed', closedAt: issue.closed_at ?? issue.closedAt,
        comments, repository, owner: owner(issue), verifyStageEvidence: createStageEvidenceVerifier({ ...io, parseScope: parseQueueScope }, repository) }
      const completion = findCompletionRecord(comments, { requireTrustedAuthor: true, repository })
      if (completion) state.completionAcceptance = verifyCompletionAcceptance({ issue: number, record: completion }, {
        ...io, getIssue: n => Number(n) === number ? issue : io.getIssue(n),
        issueComments: n => Number(n) === number ? comments : io.issueComments(n),
      })
      if (completion && ['merged', 'live_verified'].includes(completion.outcome)) {
        // Unknown history is a failed verification, never the legacy optional flag.
        state.mergeInMain = io.mergeCommitInMain(completion.merge_sha) === true
      }
    } catch (error) { state = { exists: true, unreadable: error.message, owner: null } }
    states.set(number, state)
    return state
  }
  for (const issue of issues) {
    const number = Number(issue.number)
    if (scopes.has(number)) continue // report unique work issues, not duplicate API rows
    let scope, scopeError
    try { scope = parseQueueScope(issue.body) } catch (error) { scopeError = error.message }
    scopes.set(number, scope)
    const state = read(number)
    const dependencies = (scope?.dependencies ?? []).map(declaration => {
      const prerequisite = dependencyIssue(declaration), facts = read(prerequisite)
      const requiredStage = typeof declaration === 'object' ? declaration.required_stage : 'complete'
      const terminal = facts.completionAcceptance
      const result = requiredStage === 'complete' && terminal && !['complete', 'delivered-closeout-pending', 'cancelled-or-superseded'].includes(terminal.status)
        ? { satisfied: false, status: terminal.status === 'unverifiable' ? 'unknown' : 'waiting', reason: `dependency #${prerequisite} completion is ${terminal.status}` }
        : classifyDependency(declaration, facts)
      return { issue: prerequisite, required_stage: requiredStage,
        owner: facts.owner, ...result, next_step: result.satisfied ? 'Prerequisite accepted; reconcile the dependent work.' :
          facts.owner ? `Owner must resolve: ${result.reason}` : 'Assign an owner and repair or complete the prerequisite.' }
    })
    edges.set(number, dependencies.filter(x => !x.satisfied).map(x => x.issue))
    const stageAcceptance = classifyDependency({ issue: number, required_stage: 'application-accepted' }, state)
    const terminal = state.completionAcceptance
    const acceptance = terminal ? {
      satisfied: ['delivered-closeout-pending', 'complete'].includes(terminal.status),
      status: terminal.status === 'unverifiable' ? 'unknown' : terminal.status,
      reason: `Current completion verification: ${terminal.status}`,
    } : stageAcceptance
    rows.push({ issue: number, work_type: scope?.workType ?? 'unclassified', route: scope?.route ?? null,
      owner: state.owner, delivery: scopeError ? 'unverifiable' : acceptance.satisfied ? (state.open ? 'verified-awaiting-closure' : 'verified-closed') : acceptance.status === 'unknown' ? 'unverifiable' : 'not-verified',
      evidence_reason: scopeError ?? acceptance.reason, oldest_meaningful_event: null,
      current_failing_gate: scopeError ?? dependencies.find(x => !x.satisfied)?.reason ?? (acceptance.status === 'unknown' ? acceptance.reason : null),
      dependencies, next_step: state.unreadable ? 'Restore readable ownership and completion evidence.' : !state.owner ? 'Assign an owner.' : acceptance.satisfied ? 'Owner must reconcile accepted completion and administrative closure.' :
        dependencies.some(x => !x.satisfied) ? 'Resolve the named prerequisite stage; closure alone is not proof.' : 'Owner must deliver and verify the declared outcome.' })
  }
  return { outcomes: rows, verified_but_open: rows.filter(x => x.delivery === 'verified-awaiting-closure').map(x => x.issue),
    missing_owners: rows.filter(x => !x.owner && !states.get(x.issue)?.unreadable).map(x => x.issue), dependency_cycles: findDependencyCycles(Object.fromEntries(edges)),
    unverifiable: [...states].filter(([, value]) => value.unreadable).map(([issue, value]) => ({ issue, reason: value.unreadable })) }
}

export function main(argv = [], now = new Date(), io = githubIo) {
  try {
    const reportIo = hygieneReportIo(io)
    const claims = reportIo.openClaims()
    const issues = reportIo.openWorkIssues()
    const createdAt = new Map(issues.map((issue) => [Number(issue.number), Date.parse(issue.createdAt ?? issue.created_at ?? '')]))
    const openPulls = reportIo.openPulls?.() ?? []
    // Pull states are resolved only for the bounded expired-lease set, exactly
    // as the interactive audit derives them: same reads, same meaning.
    const claimPullStates = new Map()
    for (const claim of claims) {
      const lease = parseAuthorLease(claim.body, now)
      if (lease.legacy || lease.active || !lease.capacityActive) continue
      if (openPulls.some((pull) => pull.head?.ref === lease.branch)) { claimPullStates.set(claim.number, 'open'); continue }
      const historical = reportIo.branchPulls?.(lease.branch) ?? []
      claimPullStates.set(claim.number, historical.some((pull) => pull.merged_at) ? 'merged' : historical.length ? 'closed-unmerged' : 'none')
    }
    const result = buildDynamicQueues(issues, claims, now, reportIo.openIssueNumbers(), null, claimPullStates)
    const ageDays = (number) => {
      const created = createdAt.get(Number(number))
      return Number.isFinite(created) ? Math.floor((now.getTime() - created) / 86400000) : null
    }
    const report = {
      report: 'queue-hygiene',
      generated_at: now.toISOString(),
      mutating: false,
      unlabelled_issues: result.unlabelled,
      expired_author_leases: result.expiredClaims,
      not_orchestrator_work: result.notOrchestratorWork.map((item) => ({ ...item, age_days: ageDays(item.issue) })),
      dependency_hygiene: dependencyHygiene(issues, reportIo, resolveRepositoryIdentity()),
    }
    console.log(JSON.stringify(report, null, 2))
    if (result.unlabelled.length) console.error(`UNLABELLED ISSUES: add the \`${WORK_LABEL}\` label to ${result.unlabelled.map((n)=>`#${n}`).join(', ')} — an unlabelled issue is invisible to every label-filtered query`)
    if (result.expiredClaims.length) {
      console.error('EXPIRED AUTHOR LEASES: occupancy is locked but no live author lease exists. Inspect and explicitly renew, resume, or close out each claim; expiry never releases object protection.')
      for (const row of result.expiredClaims) console.error(`  claim #${row.claim}, lane ${row.lane}, expired ${row.expires_at}, PR ${row.pr_state}, queued ${row.queued.length ? row.queued.map((number)=>`#${number}`).join(', ') : 'none'}`)
    }
    if (result.notOrchestratorWork.length) {
      // Aging is the point (plan §9 A3): the orchestrator never acts on these
      // rows, but the daily report is what stops them accumulating unseen.
      // Rows keep the actionable/outside split the interactive audit prints so
      // the two reports never disagree about what a row means.
      const actionable = result.notOrchestratorWork.filter((item)=>!OUTSIDE_ORCHESTRATOR_EXITS.includes(item.exit))
      const outside = result.notOrchestratorWork.filter((item)=>OUTSIDE_ORCHESTRATOR_EXITS.includes(item.exit))
      const describe = (item) => `  #${item.issue} ${item.exit.toUpperCase()} — work_type ${item.workType}, route ${item.route}, age ${ageDays(item.issue) ?? '?'}d${item.blockedOnOwner ? ' [blocked on owner decision]' : ''}`
      if (actionable.length) {
        console.error('NOT ORCHESTRATOR WORK (aging): these open issues fail the shape test (AGENTS.md 0.0-C) and are waiting on a reject-or-fork decision.')
        for (const item of actionable) console.error(describe(item))
      }
      if (outside.length) {
        console.error('OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION (aging): listed for visibility only (owner ruling 2026-08-21, issue #1366); a separately started session owns each one.')
        for (const item of outside) console.error(describe(item))
      }
      const unaddressed = result.notOrchestratorWork.filter((item)=>item.needsReturnAddress)
      if (unaddressed.length) console.error(`NO RETURN ADDRESS on ${unaddressed.map((item)=>`#${item.issue}`).join(', ')} — a reject with no forwarding address closes into silence.`)
    }
    const unknown = report.dependency_hygiene.unverifiable.length || report.dependency_hygiene.outcomes.some(row => row.delivery === 'unverifiable' || row.dependencies.some(dependency => dependency.status === 'unknown'))
    if (unknown) console.error('INCOMPLETE: dependency or completion evidence is unverifiable; inspect dependency_hygiene findings.')
    else if (!result.unlabelled.length && !result.expiredClaims.length) console.error('Queue hygiene clean: no unlabelled issues, no expired author leases. Dependency and ownership findings are listed separately.')
    return unknown ? 2 : 0
  } catch (error) {
    console.error(`REFUSED: ${error.message}`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
