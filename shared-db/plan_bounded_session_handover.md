# Eliminate multi-hour shared-db handovers

Tracking: [#2596](https://github.com/u2giants/shared-db/issues/2596). Work type: repository maintenance, outside the schema orchestrator. Planning authority only; no implementation, database write, settings change, or repository transfer is authorized by this document.

The paired handoff was retired when PR #2607 landed step 1 (it closes #2596). Later milestones need a new tracking issue before they start.

## STATUS — 2026-09-08

| Step | State | Evidence or next gate |
|---|---|---|
| Investigation and plan | Done | Source identities and GitHub run evidence in sections 3–6; this document |
| 1. Whole-path document qualification | Landed by PR #2607 | Trusted-base classifier and truthful database-contract applicability context; cross-gate/live proof pending |
| 2. Fast applicable checks and automatic guarded dispatch | Open | Harmless live handoff PR, no reviewer/database replay, required contexts present |
| 3. Durable checkpoint and fenced ownership transfer | Open | Successor resumes while document merge is unavailable; predecessor cannot act |
| 4. Bounded reviewer and refresh lifecycle | Open | Wall-clock deadline covers preparation, model, replacement, and cleanup |
| 5. Integrate procedures and remove repeated reconstruction | Open | Codex and Claude perform the same bounded closeout contract |
| 6. Fault injection and live acceptance | Open | Five-minute target and safety tests in section 13 |

Fresh implementation starts at Step 1, after implementation is requested. Read every downstream step before each phase. Do not restart completed #1738 or #1680 from their stale “start at Step 1” sentences: their STATUS tables record completion.

## 1. Ultimate goal

Albert must be able to replace a long-running session without putting programming on hold for hours. Within five minutes of a closeout request, under healthy GitHub conditions, the next session must have a durable, complete checkpoint and an unambiguous safe path to continue. Reviews, documentation merges, cleanup, and unrelated repairs must not extend that deadline indefinitely.

This is a proposed acceptance target, not a measured current capability or a guarantee of GitHub availability. On an outage, return a bounded, explicit blocked result with recoverable state. Never manufacture permission to merge or apply a database change to meet a timing target.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Protect database claims, reviewed content, production freezes, and the ability to continue work. Separate “handover ready,” “documentation merged,” and “business work completed”; none implies the others.

## 2. What this system is

`u2giants/shared-db` is POP Creations’ public canonical shared-database schema and coordination repository. Its `main` branch feeds several applications. Node scripts and GitHub Actions enforce object claims, migration versions, reviewer assignments, exact-head approval, preview/production evidence, and exclusive merge/apply stages. Codex and Claude sessions operate it concurrently from Windows and other hosts.

Only structural database work belongs to its sole orchestrator. Repository maintenance belongs to a separate session. Application code and ordinary application rows do not require orchestrator approval. A closeout of one session must not become an instruction to suspend unrelated application work.

Baseline for this investigation: fetched `origin/main` at `bc4caafa` (PR #2594). Planning branch: `codex/handover-latency-plan`, isolated from the dirty landing checkout. Production was not accessed.

## 3. Trigger and evidence population

Albert requested review of the latest Codex `shared-db.orch` sessions and Claude `closed.Shared-db NON-orch`, citing a roughly two-hour wait that only stopped after intervention. Transcripts were read structurally in place; raw transcripts were not copied or published.

Private source locators for an authorized local investigator (do not publish the raw files):

- Codex task `01a0812c-13ca-75e2-992c-b309b882a37d`, `shared-db.orch`, September 8. Local rollout filename contains that task ID under the user's `.codex/sessions/2026/09/08/`. Relevant message ordinals: 2042–2114 (closeout/safe stop), 2371–2649 (paperwork/classification), 2990–3045 (blocked closeout and expanded repair), 3874–4156 (owner intervention, replacement handoff, closure).
- Immediate predecessor Codex task `01a07e3d-df78-7ed0-bd62-d675f000158b`, now `closed.shared-db.orch`. September 8 continuation filename also contains `01a080e6-2115-7d32-aea6-bfa275b7f10a`. Ordinals 1149–1327 document local-only handoff commits, an open marker still pointing at the old task, subsequent dispatch, and owner correction.
- Claude session `dcd9329a-2cb6-4175-8266-9a9cdc35cbb4`, title metadata exactly `closed.Shared-db NON-orch`, under `.claude/projects/C--repos-shared-db--claude-worktrees-top-5-blocking-issues-6be510/`. Ordinals 1844–2276 cover wrap-up and handoff merge; 2580 records the later exemption repair. Title and session ID distinguish it from the similarly named Codex non-orchestrator task.

Times below are UTC on 2026-09-08. Transcript statements are observations of agent behavior; GitHub records establish merge/check timing. Do not turn an agent's claimed diagnosis into independently proven causation.

### Codex closeout timeline

- 17:16:58: owner invokes fresh-session.
- 17:19:37: agent reports all workers at safe resumable boundaries (2m39s after request).
- 17:42:07: agent reports handoff audited and ready to publish (25m09s after request). Much of the delay therefore precedes any final merge gate.
- 17:43:25: work-contract gate demands two evidence files. Adding them defeats the document classification.
- 17:57:07: guarded run [34260080180](https://github.com/u2giants/shared-db/actions/runs/34260080180) refuses for no reviewer assigned to the new head.
- 18:16:38: agent reports handoff still blocked. Marker remains open.
- 18:18 onward: separately authorized credential rotation and a duplicate repair enter the session. This interval is not all merge waiting. PR #2593 is later superseded by Claude's #2592.
- 19:00:52: owner intervenes again; agent switches to a clean one-document handoff.
- 19:05:32–19:14:44: [PR #2594](https://github.com/u2giants/shared-db/pull/2594) creation to merge: **9m12s**.
- 19:15:56: agent reports marker closed and session finished: **1h58m58s** after the closeout request. This is the observed end-to-end interval, not a claim of two hours spent in a mutex or in GitHub.

### Claude closeout timeline

- 16:50:35: owner asks to put the four unfinished items in the handoff and wrap up.
- 17:08:31: agent reports all checks passing and dispatches guarded merge; the handoff then remains in reviewer replacement/rejection cycles.
- 17:49:56: owner challenges the one-hour closeout.
- 18:14:00: agent finally identifies the existing prose exemption and the conflicting evidence-pair requirement. Earlier claims that no prose exemption existed were wrong.
- 18:24:31: agent reports the handoff merged: **1h33m56s** from wrap-up request. Guarded run [34262685571](https://github.com/u2giants/shared-db/actions/runs/34262685571) corroborates the merge phase.
- 18:57:43: agent reports the separately authorized fix live. [PR #2592](https://github.com/u2giants/shared-db/pull/2592) merged as `7325005b108f5e0d70df4e77d99b6b4a971e8724`. Do not count all the repair work as the original handoff duration.

## 4. Scope

In scope: the complete document-closeout path; durable resumable session state; ownership fencing; bounded reviewer preparation and retries; integration with existing evidence reuse; failure reporting and latency tests; Codex/Claude procedure alignment.

Not in this plan: deleting guarded merges; bypassing reviews of code or operative rulebooks; removing database tests for database changes; changing production freezes; changing application data; credential rotation; repository transfer; native merge-queue activation; bulk worktree cleanup; re-reviewing completed business work; fixing every open queue issue before handing over.

The plan is delivered independently of implementation. Its tracking issue remains open for implementation. No active orchestrator is created by this planning task.

## 5. Current code and verified state

References are against `bc4caafa`; re-resolve locations by symbol after main moves.

- `scripts/lib/documents-only-change.mjs:39` onward: deterministic path classifier. All renames include the previous name. Unknown/mixed inputs fail closed. `AGENTS.md`, `CLAUDE.md`, skills and `plan_*.md` are excluded. Do not rename plans or hide policy changes in a handoff to obtain an exemption.
- `scripts/check-documents-only-pull-request.mjs:24` onward: shared GitHub transport, full paginated file list, common classifier used by contract and reviewer gates.
- `.github/workflows/agent-work-contract.yml:112–144`: #2592 lets a qualifying document PR omit its own evidence pair. This is **already merged**. It does not mean arbitrary `.agent` JSON is now classified as documentation.
- `.github/workflows/database-contract-tests.yml:78` onward: the ephemeral database job still runs for document PRs.
- `.github/workflows/guarded-migration-merge.yml:4`: manual dispatch only; line 15 global concurrency; line 41 thirty-minute job ceiling; line 59 current-main containment; line 76 required-check preflight before acquiring merge lock; lines 94–104 exact-head/main/approval checks repeated under the lock; line 150 authorization revocation on failure.
- `scripts/check-required-checks-preflight.mjs:110` (`evaluateWithoutRequiredList`): fallback requires every mirrored required context **and every reported check** to pass. This is stronger than the live required list in some cases. Preserve the missing-required-check protection; do not simply delete this fallback condition.
- `docs/verification/main-required-status-checks.json` is a trusted-main mirror, not independent live authority. Read-only GitHub inspection confirmed its eleven names match current branch protection; admin enforcement is on, strict base-up-to-date is false. The ephemeral database job is not among those eleven names. Its wait can still arise from the fallback or from an agent waiting for every check. The exact delay must be attributed to the actual gate response, not presumed to be GitHub policy.
- `scripts/orchestrator-flow/evidence-bundle.mjs` and `classify-invalidation.mjs` already implement evidence binding and invalidation classes. #1738 STATUS says landed; broad repeat work is not the answer.
- `scripts/record-blocker-stub.mjs`, `check-blocker-ledger.mjs`, and `scripts/throughput-guard/` already provide causal measurement. #1680 STATUS says landed. Extend these rather than adding a second incident system.
- `scripts/check-orchestrator-marker.mjs` resolves live markers but its header explicitly acknowledges that marked collision checks do not catch every actor. Coordinate the ownership fix with existing [#2318](https://github.com/u2giants/shared-db/issues/2318).

## 6. Root causes and limits of proof

1. **A cross-gate contradiction, already repaired.** Mandatory JSON converted a document PR into a review-required PR. Unit tests for individual gates were insufficient to catch an impossible combined path. #2592 resolves the original pair requirement; retain it and prove the full path.
2. **Handover was treated as finishing a delivery pipeline.** The old owner stayed routable until a document merged. CI/reviewer availability therefore became an ownership-transfer dependency. A safe stop was reported in under three minutes, but rebuilding/auditing the handoff then consumed about 22 more minutes before publication.
3. **Reviewer “bounds” did not bound the user wait.** Preparation, model calls, replacements and new heads each got more time. Claude reported quota exhaustion, hanging Qwen runs and a reviewer using a stale checkout. Codex recorded preparation lasting before the model timer began. These support a lifecycle-boundary defect; they do not prove every provider itself was slow or broken.
4. **Main movement caused repeated refresh/review work.** Codex reported repeated refreshes for #2356 despite unchanged migration/test bytes. One later handoff merge also refused on main movement. Existing invalidation classes must be traced into actual callers and exact-head approval before proposing reuse; unchanged SQL alone is insufficient evidence.
5. **The remaining document path is still slow and manually sequenced.** PR #2594 database job ran 19:05:39–19:10:46 (**5m07s**); guarded dispatch started 19:13:18. Final merge job ran 19:13:23–19:14:50 (**87s**, run [34267681152](https://github.com/u2giants/shared-db/actions/runs/34267681152)). These intervals are not all disjoint from other checks. Do not add overlapping durations to invent a larger total.
6. **Ownership was not finished on the earlier closeout.** The predecessor reported unpushed local handoff commits, left marker #2559 pointing to itself, then accepted new work. The successor diagnosed the dead route and took over. Closing a task in the UI was not a governance transition.
7. **Repairs expanded closeout, and two sessions built overlapping fixes.** Necessary repairs can continue separately; they must not recursively become prerequisites to leaving the old context. A live issue/PR lookup before authoring would have exposed #2592 and prevented duplicating it as #2593.

No evidence here proves that every application was mechanically locked for the whole interval. The owner experienced broad interruption; the proven mechanisms are a frozen coordinator, protected claims and blocked serial delivery, with some intervals holding genuine stage locks. Report those separately.

## 7. Rejected approaches

- “Just remove guarded merge” or blanket bypass: loses race/approval/freeze protection; final job was only 87 seconds.
- “Wait for one more reviewer” repeatedly: a per-attempt timeout is not an end-to-end bound.
- More prose exemption code without reading main: #2592 already exists; #2593 was duplicate work.
- Treating every Markdown file as harmless: plans and operating rules can change agent behavior. Keep rulebook exclusions.
- Exempting arbitrary JSON metadata or accepting a missing file list: opens the code path under a document label.
- Path-filtering entire required workflows: can leave required contexts permanently missing. Keep an always-reporting job with an explicit applicability result.
- Clearing claims, deleting reviewer refs, or closing an active marker solely because a timer expired: elapsed time is not proof that an old writer stopped.
- Holding a repository-wide freeze throughout human/AI review: creates the very global interruption this work must remove. Freeze only the stage that actually needs it.
- Waiting for repository transfer/native merge queue: #2530 is a separate owner-gated program; no prerequisite for a usable handover.
- Claiming “never again” from one passing unit suite or marking the reviewer incident fully repaired because document review is exempt: reviewer liveness remains independently testable.

## 8. Decisions and proposed defaults

Locked safety constraints: no stale-head code approval, no unsafe database apply, no two active coordinators, no removal of protected claims, no secrets/raw transcripts in this public repository, no broad cloud/settings mutation. The original document exemption remains intact.

Recommended implementation defaults (proposed, not yet operating policy): five-minute healthy-service handover target; one closeout operation ID; one monotonic wall-clock deadline; no new business scope after closeout starts; persist already-known state continuously; merge the handoff asynchronously when blocked; only the affected resources stop.

Keep the current guarded merge as the sole merge implementation. Add an automatic, idempotent dispatcher rather than a second merging service. Prefer existing refs/claim manager for checkpoint ownership over a new database or daemon. A second GitHub issue edit alone is not an atomic ownership lock.

A blocked merge does not authorize a successor to apply anything. A usable checkpoint can be read immediately; successor write authority requires verified transition/fencing. A database stage already executing must finish or reach its existing proven recovery boundary before its own lock transfers.

## 9. Ordered implementation

### Phase A — finish the document path (Steps 1–2)

**Step 1: Prove combined classification before starting expensive work.** Extend `scripts/check-documents-only-pull-request.test.mjs`, `scripts/lib/documents-only-change.test.mjs`, contract workflow tests and `check-exact-head-approval` tests with a shared end-to-end fixture. Add `scripts/check-closeout-readiness.mjs` and tests. Inputs: exact PR/base/head, complete paginated file list, trusted policy revision, required-check source, current marker/stage state. Output: classification, each applicable gate, missing evidence, next action, remaining deadline. No state mutation in this preflight.

Preserve #2592's pure-document/no-pair behavior. A current explicit evidence pair remains validated; malformed or partial pairs never get silently ignored. Fail before reviewer draw if the proposed handoff cannot qualify. Gate: the same pure handoff passes contract and approval classification without a reviewer; mixed/rulebook changes do not. Read errors report unknown and refuse.

**Step 2: Fast checks and automatic merge dispatch.** In `.github/workflows/database-contract-tests.yml`, run trusted classification before installing/starting the database. For a proven document-only change, emit a successful applicability result explaining that no database-affecting files changed. Do not claim SQL tests ran. Keep the same named context. Other heavy CI workflows should use the same trusted result only where their work is provably inapplicable; preserve privacy and handoff validation. Workflows still run on all PRs; do not use top-level path filters to hide contexts.

Use protected-base classifier code, never PR-supplied executable policy, to grant the fast lane. Bind the result to repo/PR/head/base/policy and full file list, including rename origins. A PR that edits workflow/classifier/configuration takes the full path. Fork/untrusted PR handling stays read-only until trusted authorization; do not run untrusted checkout under a write-capable event.

Add a trusted event-driven dispatcher (new `.github/workflows/dispatch-ready-guarded-merge.yml` plus a tested script). Use completed-check events or another verified supported event, with live reread of current head and all applicable contexts. It dispatches existing guarded merge only for an explicitly requested merge-ready PR, keyed by PR/head. It must exclude the merge's self-produced authorization from its prerequisites, deduplicate repeated events and leave a visible reason when not ready. Give only required permissions. Keep manual dispatch as supported recovery. Validate actual event/token behavior in a harmless PR; do not assume a token-generated event recursively starts another workflow.

Keep exclusive lock acquisition after preflight and keep under-lock revalidation/revocation. Do not weaken `evaluateWithoutRequiredList`; faster jobs should satisfy it quickly and truthfully. Missing or failing required contexts remain failures. Gate: a real one-file handoff reaches automatic guarded merge without external review, database startup, or a manual discovery of the missing authorization context. Capture creation, checks-ready, dispatch and merge timestamps. Target document PR to merge <=3 minutes with available hosted runners; five-minute handover does not depend on meeting this merge target.

### Phase B — handover is a durable state transition (Step 3)

**Step 3: Build a resumable closeout controller.** Add `scripts/manage-session-handover.mjs` and tests, integrating `manage-migration-author-lanes.mjs`, `check-orchestrator-marker.mjs`, `check-handoff-contract.mjs` and the existing blocker ledger. Proposed states: RUNNING → QUIESCING → CHECKPOINTED → RETIRED; a successor must explicitly claim a new fenced epoch. Keep document publication status separate (pending/merged/failed).

On request, stop accepting new business work, obtain acknowledgments from active workers, inventory exact live stage locks and claims, and persist a compact machine checkpoint plus human briefing in an immutable Git object/ref. GitHub issue points to exact commit and content hash, never just a mutable local path or unpushed commit. Raw transcripts, licensed rows, secrets stay private. The checkpoint includes marker/epoch, every live worker, PR/head/worktree, claim/version, current stage/run, outcome versus acceptance, blockers, pending handoff PR, existing owner decisions, and next action. Append updates rather than editing somebody else's briefing.

Use compare-and-swap ref updates through the existing transport/manager pattern to fence the old owner. Every dispatch, stage-acquisition and marker write must verify the actor's current epoch; stale actors refuse and resolve the successor. Coordinate this with #2318. A late message must never revive a retired coordinator. At most one writable epoch exists. Issue comments are explanatory records, not the lock authority.

The transition may occur while handoff documentation merge is pending **only after this new protocol is implemented and tested**. Current merge-before-marker-close rules remain in force until that change lands. Preserve object/version claims and exact review/run evidence; no expiry-based deletion. For an ongoing database stage, attach its immutable run and unchanged lock, permit unrelated successor planning, and block that stage until outcome/recovery is verified. If a writer cannot be fenced or quiescence cannot be proven, report the specific resource blocked; do not falsely retire it.

On GitHub outage, stop by deadline with the existing private/local recovery location and last verified remote checkpoint identified, without pretending remote transfer succeeded. Never infer zero markers from an unreadable response. Gate: crash at every transition, duplicate request, late worker response, missing acknowledgment, active production stage and stale actor tests all retain work and prevent dual ownership. A clean successor can load the exact remote checkpoint without reading predecessor chat.

### Phase C — bound work and stop repeated reviews (Steps 4–5)

**Step 4: Review lifecycle and evidence reuse.** Trace the observed callers through `scripts/orchestrator-flow/classify-invalidation.mjs`, `evidence-bundle.mjs`, `check-exact-head-approval.mjs` and reviewer manager. Reproduce September 8 unrelated-main movement using offline fixtures. Reuse already-qualified content evidence only through the existing invalidation classes. Generate a fresh head-bound authorization proving content identity, policy identity, complete intervening changes and successful current integration. Never copy an old APPROVE to a new head. Content/global/interaction/unknown cases keep their required new review/evidence.

In the owning `popcre/ai-devops` reviewer-wrapper workstream, make one monotonic deadline start before snapshot preparation and include doctor, git/evidence preparation, model, verdict persistence and cleanup. Health probe success is not proof that snapshot or model work started. Emit phase timestamps and bounded diagnostic output without process arguments/secrets. Use the existing incident ledger, not a new log format. Terminal quota/timeout failures release capacity through the supported manager. Do not hand-delete refs or suppress providers permanently to appear faster.

Cap the total attempt/replacement budget per work item; after exhaustion leave that item resumable and advance independent work. During closeout, transfer its pending review state immediately rather than spending that budget. Gate: preparation hang, quota exhaustion, missing symbolic base, stale checkout and model hang all end with attributable terminal state under the same wall-clock bound; no valid approval on error. Prove snapshot contains the requested base and head before starting a paid model run.

**Step 5: Maintain checkpoints during work; update both tools' procedures.** Change the canonical procedures in the owning ai-devops repository and their installed Codex/Claude counterparts through normal synchronization: `fresh-session`, `shared-db-handover`, `handoff-writer`, `codex-session-closeout` and Claude's corresponding wrap-up entrypoint. Update shared-db `AGENTS.md` and `docs/agents/` references in the same program, without competing local rules.

Each dispatch/terminal result updates the checkpoint, so closeout captures a delta rather than reconstructing 22 agent histories. The final human briefing renders from already-recorded facts with links, preserving all unfinished obligations and owner decisions. Do not require unrelated plan rewrites, complete queue hygiene or worktree reaping before transfer. Queue issues already recorded do not need duplicate issues. New repair work becomes its own owned workstream, not recursive closeout scope. Before authoring any repair, inspect live matching issues/PRs to prevent another #2592/#2593 pair.

Gate: both Codex and Claude entrypoints invoke the same protocol, report handover/publication/business completion separately, never ask Albert to babysit a routine document merge, and never treat another tool's closed task title as marker proof. A timed replay with 22 worker records completes checkpoint generation without rereading 22 transcripts.

### Phase D — acceptance (Step 6)

**Step 6: Measure and qualify.** Extend `scripts/throughput-guard/` and the blocker-ledger schema with closeout operation ID and non-overlapping phase intervals: quiescence, checkpoint preparation/publication, owner transition, CI queue/run, reviewer preparation/model, merge-lock wait/hold, owner-requested unrelated work. Preserve existing schema compatibility and causal-source requirements.

Add `scripts/session-handover.test.mjs` and `scripts/closeout-path.test.mjs` (new names) with a fake clock and GitHub transport fixtures; wire them into existing offline CI. Run focused changed suites first, then required integration checks. Record live validation under `docs/verification/bounded-session-handover/` with no transcript dumps. Natural cut points: after each phase, update STATUS and reread remaining phases in a fresh worktree.

## 10. Required tests

The fixture matrix must cover pure handoff, ordinary docs, explicit valid/partial/malformed evidence pair, plan/rulebook edits, SQL, workflows, config, rename out of code, >100 files, malformed/missing file list, classifier modified in PR, untrusted/fork PR, and head movement between classification and merge.

Cross-gate tests must execute the contract, reviewer classification, required-check fallback and dispatcher together, not merely test each function with matching mocks. Missing required check, unknown required list, failed privacy/handoff check and classifier disagreement refuse without holding the merge lock. Duplicate events dispatch at most once per head; newer head invalidates old readiness. Failed merge revokes authorization before releasing the lock. A document-only PR under a production freeze does not bypass the freeze: checkpoint/transfer still proceeds safely, merge waits.

Ownership tests cover simultaneous successor claims, process crash before/after remote checkpoint write, retry after ambiguous write result, stale old marker, late task message, active writer and GitHub outage. Confirm no object/version claims disappear. Review tests distinguish preparation from model time and process alive from useful progress. Timing tests use a fake clock so a nominal three-minute test never sleeps three minutes.

Existing suites to retain include `scripts/check-documents-only-pull-request.test.mjs`, `scripts/lib/documents-only-change.test.mjs`, `scripts/check-required-checks-preflight.test.mjs`, `scripts/check-orchestrator-marker.test.mjs`, `scripts/check-handoff-contract.test.mjs`, `scripts/orchestrator-flow/*.test.mjs` and affected manager/approval/workflow tests. Enumerate the actual current suite before running. Real database suites still run for code changes that affect their applicability.

## 11. Constraints and gotchas

Use isolated current-main worktrees, exact owned staging, Albert's Git identity, normal code review/checks and guarded merge. This plan's publication is not activation of its proposed policy. Do not change branch protection or mirror contents to pass a check. Any required settings action must be separately specified and authorized. The live required-context list is not the same as every check the fallback chooses to wait for.

Private transcripts are evidence sources only. Do not copy them to this public repo or external reviewers. Reviewers receive public code and sanitized facts. Avoid broad process command-line dumps. Credential rotation reported in the source session was separate work; this plan neither repeats it nor inherits authority to rotate anything.

Policy/code changes including this `plan_*.md` remain in their proper classification. The document fast lane is for genuine document closeouts, not disguising executable policy. Native queue work remains in [plan #2530](plan_shared_db_popcre_transfer_merge_queue.md). Reuse completed [#1738](plan_orchestrator_throughput_phase_2.md), [#1680](plan_orchestrator_throughput_guard_truth.md), and [reviewer lease capacity](plan_reviewer_lease_capacity_truth.md) capabilities; investigate integration gaps instead of rebuilding them.

## 12. Access and environment

Git and authenticated `gh` read access to `u2giants/shared-db` were verified. Node runs repository scripts. CI uses Node 22/Python 3.12 where currently pinned. No DB credentials or admin settings writes are needed for the initial implementation/tests. Reviewer-wrapper implementation belongs in an isolated `popcre/ai-devops` worktree under its own instructions and existing incident tracking. Secrets, if later needed for authorized tooling, belong in 1Password vault `vibe_coding`; never in command arguments or public artifacts.

Live acceptance needs normal existing GitHub write authority for harmless PRs/checkpoint refs and a separately authorized orchestrator transition when testing the real coordinator. Do not manufacture a production migration or seize a live marker for a test. Simulate active-stage cases offline, then observe the next genuine authorized transition.

## 13. Definition of done, risks and open questions

Planning is complete when this standalone plan and paired handoff are committed/pushed and linked to #2596. Implementation remains open. The plan self-audit below is not live acceptance.

Implementation acceptance requires:

1. Merged code/procedures, required CI passing, installed tool procedures verified, and exact-main evidence recorded.
2. A harmless live handoff PR automatically merges via the existing guarded lane with no reviewer and no database startup; all required contexts report truthful successful results. Target <=3 minutes with available runners.
3. Five closeout trials across Codex and Claude, including 22-worker state, slow reviewer, main movement and an unavailable merge lane. Every healthy-GitHub trial makes a remote checkpoint and safe successor route available within five minutes. At least one actual authorized successor loads it without prior chat context. Simulated trials are identified as simulated.
4. Outage trials stop within five minutes with an honest named blocker/recovery location; do not claim successful remote transfer. Active irreversible stages retain their locks and block only the affected operations.
5. No stale-head approval, no dual coordinator, no lost claims, no dropped handoff obligation, no leaked private data, no skipped applicable database test, no unauthorized production action. These are zero-tolerance gates.
6. Document merge delay, handover readiness and business completion have separate timestamps. Any residual wait over budget records causal evidence in the existing ledger; owner interruption is not the timeout mechanism.

Risks: trusted-event permissions and duplicate delivery; malicious or stale classification; crash during ownership transition; old clients ignoring new fencing; long active DB stages; GitHub outage. Roll out backward-compatible state readers and fencing first, then enable transfer-before-merge. Disable the new dispatcher/transition through a reviewed rollback only if its safety test fails; retain the existing guarded path and immutable checkpoints. Do not roll back #2592 as collateral. No rollback may clear protected claims or pretend the predecessor is still alive.

Open implementation questions are bounded technical choices, not owner decisions to relitigate: which supported event provides reliable dispatch on this repository; which existing ref namespace/CAS helper to extend; exact integration-revalidation caller gap. Resolve from current code and isolated fixtures before implementation of that step. If a genuine settings permission change becomes necessary, prepare the exact proposed diff and ask once then. No such change is presumed necessary by this plan.

## Plan self-audit

- Can a new session execute without this conversation? Yes: sections 2–6 establish the system, source identities, exact current repair and remaining causes; section 9 names files, dependencies and gates; sections 10–13 define tests, access, rollout and acceptance. Implementation begins only when requested.
- Is the reasoning, including rejected work, carried forward? Yes: sections 6–8 distinguish measured facts from agent hypotheses, preserve the already-merged exemption, reject broad bypasses, and separate late repair work from merge time.
- Can an implementer steer by the business goal? Yes: section 1 defines a five-minute usable handover and bounded outage result; sections 8 and 13 prohibit meeting the target by sacrificing safety or claiming unfinished publication is complete.

All thirteen required plan sections are present. Paired handoff and tracking issue make the pending implementation discoverable. No memory files were changed.
