#!/usr/bin/env node
// Queue hygiene report (issue #3199 Phase A3) — the scheduled, read-only twin
// of the interactive `--queue-audit`.
//
// WHY A STANDALONE MODULE (a 2026-09-17 placement decision, not the plan's
// first draft): the plan drafted this as a subcommand inside
// scripts/manage-migration-author-lanes.mjs. That file is a PROTECTED
// COORDINATION SOURCE (scripts/check-pr-source-collisions.mjs): only one open
// ready pull request may edit it, and on the day this landed another session's
// pull request (#3215) held the lane. Rather than queue behind it, the report
// moved here — importing the same exported machinery (buildDynamicQueues,
// parseAuthorLease, githubIo) so the derivation stays THE audit's derivation,
// never a parallel one. The lane script itself is untouched by this change.
//
// WHAT THIS REPORTS — ONLY the hygiene sections the audit also prints:
// unlabelled issues, expired author leases, and NOT ORCHESTRATOR WORK aging.
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
import { githubIo, buildDynamicQueues, parseAuthorLease, WORK_LABEL, OUTSIDE_ORCHESTRATOR_EXITS, LaneError } from './manage-migration-author-lanes.mjs'
import { pathToFileURL } from 'node:url'

// The refuse list names every hook on githubIo that creates, updates, deletes
// or pushes anything. Kept explicit — a new mutation hook on githubIo is a
// decision this list must hear about, not silently inherit.
export function hygieneReportIo(io) {
  const refuse = (name) => () => { throw new LaneError(`read-only queue hygiene report must never call ${name}`) }
  return {
    ...io,
    postCommitStatus: refuse('postCommitStatus'),
    updateIssue: refuse('updateIssue'),
    makeOwnerCommit: refuse('makeOwnerCommit'),
    makeReviewVerdictCommit: refuse('makeReviewVerdictCommit'),
    createRef: refuse('createRef'),
    deleteRef: refuse('deleteRef'),
    updateRef: refuse('updateRef'),
    atomicReviewRefs: refuse('atomicReviewRefs'),
    atomicReviewMutexRelease: refuse('atomicReviewMutexRelease'),
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
    if (!result.unlabelled.length && !result.expiredClaims.length) console.error('Queue hygiene clean: no unlabelled issues, no expired author leases.')
    return 0
  } catch (error) {
    console.error(`REFUSED: ${error.message}`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
