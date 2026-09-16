---
issue: 3050
status: OPEN
owner: claude/498-closeout-fast
---

# Wrong-owner refusals should name the owner on record (#498 item D12, non-orchestrator)

## 1. What this session was asked to do
popcre/ai-devops#498: make shared-db session close-out fast and stop "paperwork"
refusals. Item D12: the four wrong-owner refusals in
`scripts/manage-migration-author-lanes.mjs` say only that a claim belongs to a
different owner; they should print the owner on record and the exact rerun line.

## 2. What was actually done
D11 wording and D13 shipped in PR #3051 (merge `638fef44`). D12 was written and
tested, then removed from #3051 because the cross-PR collision check refused it:
PRs #3031 (#3028) and #3049 (#3027) also edit that coordination script.

## 3. Preview and production state
No schema, migration, claim, or database write. Nothing applied anywhere.

## 4. Half-finished or abandoned
D12 only. The full patch (against main `638fef44`) is below; it includes a test.

## 5. What this session owns
This file and the D12 follow-up. Not #3031, #3049, #3027, #3028.

## 6. What was about to happen next
After #3031 and #3049 merge: new repo-maintenance work issue, apply the patch
(`git apply --3way`), run `node --test scripts/manage-migration-author-lanes.test.mjs`,
then the normal guarded merge lane.

## 7. Blocked on
#3031 and #3049 merging (other sessions). Both OPEN at 2026-09-16 13:30Z.

## 8. What was tried that did NOT work — read this before re-treading it
- Shipping D12 alongside those PRs: refused by the cross-PR object collision check. Do not bypass it; wait.
- New refusal text must not contain the word "missing": the throughput truth audit counts it.

## 9. Facts that may already be stale
PR states in section 7; the patch may need a 3-way apply once those land.

```diff
diff --git a/scripts/manage-migration-author-lanes.mjs b/scripts/manage-migration-author-lanes.mjs
index 482376b9..f4b3186f 100644
--- a/scripts/manage-migration-author-lanes.mjs
+++ b/scripts/manage-migration-author-lanes.mjs
@@ -6790,7 +6790,7 @@ export function relinquishAuthorLease(options, now = new Date(), io = githubIo)
     if(before?.state!=='open'||before.body!==matches[0].body)throw new LaneError('claim changed concurrently before capacity relinquishment')
     const lease=parseAuthorLease(before.body,now)
     if(lease.legacy)throw new LaneError('legacy claim capacity cannot be relinquished')
-    if(lease.owner!==options.owner)throw new LaneError('claim belongs to a different owner')
+    if(lease.owner!==options.owner)throw new LaneError(`claim belongs to a different owner: owner on record is ${JSON.stringify(lease.owner)}, got --owner ${JSON.stringify(options.owner)}; rerun with --owner ${JSON.stringify(lease.owner)} only if you are that session`)
     const blocker=validateCapacityBlocker(options.blockedOn,io)
     const evidence=assertAbandonmentEvidence(options,lease,blocker,io)
     const recoveryArtifact=options.recoveryArtifact?requireDereferenceableRecoveryArtifact(options.recoveryArtifact,io):null
@@ -6841,7 +6841,8 @@ export function resumeAuthorLease(options, now = new Date(), io = githubIo) {
     if(matches.length!==1)throw new LaneError(`claim #${options.claim} must be uniquely open`)
     before=io.getIssue(options.claim);if(before?.state!=='open'||before.body!==matches[0].body)throw new LaneError('claim changed concurrently before capacity resume')
     const lease=parseAuthorLease(before.body,now)
-    if(lease.legacy||lease.owner!==options.owner)throw new LaneError('claim lease is legacy or belongs to a different owner')
+    if(lease.legacy)throw new LaneError('claim lease is legacy')
+    if(lease.owner!==options.owner)throw new LaneError(`claim belongs to a different owner: owner on record is ${JSON.stringify(lease.owner)}, got --owner ${JSON.stringify(options.owner)}; rerun with --owner ${JSON.stringify(lease.owner)} only if you are that session`)
     if(lease.capacityState!=='relinquished')throw new LaneError('claim capacity is not relinquished')
     if(lease.relinquishmentMetadataLegacy)throw new LaneError('legacy relinquished claim must be reconciled with --relinquish-author-lease before resume')
     assertClaimNotRetired(lease.version,'resumed',io)
@@ -8133,7 +8134,7 @@ export function main(argv, now = new Date(), io = githubIo) {
         const fresh=io.openClaims(), claim=fresh.find((x)=>String(x.number)===String(o.releaseClaim))
         if(!claim)throw new LaneError(`claim #${o.releaseClaim} is not open`)
         const lease=parseAuthorLease(claim.body,now)
-        if(lease.owner!==o.owner)throw new LaneError(`claim #${o.releaseClaim} belongs to a different owner`)
+        if(lease.owner!==o.owner)throw new LaneError(`claim #${o.releaseClaim} belongs to a different owner: owner on record is ${JSON.stringify(lease.owner)}, got --owner ${JSON.stringify(o.owner)}; if you are that session rerun: --release-claim ${o.releaseClaim} --owner ${JSON.stringify(lease.owner)} --confirm-finished`)
         if((io.openPulls?.() ?? io.prSources()).some((pr)=>(pr.head?.ref ?? pr.branch)===lease.branch))throw new LaneError(`claim branch ${lease.branch} still has an open pull request`)
         // #2301 Step 3 -- TERMINAL RETIREMENT.
         //
@@ -8196,7 +8197,7 @@ export function main(argv, now = new Date(), io = githubIo) {
         if(!claim)throw new LaneError(`claim #${o.releaseDuplicateClaim} is not open`)
         const lease=parseAuthorLease(claim.body,now)
         if(lease.legacy)throw new LaneError(`claim #${claim.number} is a legacy claim and cannot be proved to be a duplicate`)
-        if(lease.owner!==o.owner)throw new LaneError(`claim #${claim.number} belongs to a different owner`)
+        if(lease.owner!==o.owner)throw new LaneError(`claim #${claim.number} belongs to a different owner: owner on record is ${JSON.stringify(lease.owner)}, got --owner ${JSON.stringify(o.owner)}; rerun with --owner ${JSON.stringify(lease.owner)} only if you are that session`)
         // (1) at least one OTHER open non-legacy claim declares the same branch
         const siblings=fresh.filter((x)=>String(x.number)!==String(claim.number))
           .map((x)=>({claim:x,lease:parseAuthorLease(x.body,now)}))
diff --git a/scripts/manage-migration-author-lanes.test.mjs b/scripts/manage-migration-author-lanes.test.mjs
index f9c5c3d5..2bb58177 100644
--- a/scripts/manage-migration-author-lanes.test.mjs
+++ b/scripts/manage-migration-author-lanes.test.mjs
@@ -8207,3 +8207,15 @@ test('--abandonment-audit reports a refusal as unverifiable (3), not as an expir
   assert.equal(errors.filter((line)=>line.startsWith('REFUSED: ')).length,3,'the refusal message is still printed in full; only its exit code moves')
   assert.ok(errors.some((line)=>line.includes('must identify exactly one work issue')),'the operator must still be told what could not be read')
 })
+
+test('claim release refused for the wrong owner names the owner on record and the corrected command (#498)',()=>{
+  const io=memoryIo();let closed=null
+  io.openClaims=()=>[{number:7,body:body(['table core.x'],'7')}]
+  io.closeClaim=(n)=>{closed=n}
+  const lines=[],original=console.error
+  console.error=(...args)=>lines.push(args.join(' '))
+  let code
+  try{code=main(['--release-claim','7','--owner','someone-else','--confirm-finished'],NOW,io)}finally{console.error=original}
+  assert.equal(code,2);assert.equal(closed,null)
+  assert.match(lines.join('\n'),/owner on record is "agent-7", got --owner "someone-else"; if you are that session rerun: --release-claim 7 --owner "agent-7" --confirm-finished/)
+})
```
