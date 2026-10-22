# Brief, safe reviewer-assignment holds

## STATUS — read first

Planning baseline: **October 18, 2026 EDT**, main
`b31e17c02194c6006a1bd256d6154a324a5114d7` in `popcre/shared-db`.
Originally a proposal; now implemented and merged (see table).
Tracker: [#4414](https://github.com/popcre/shared-db/issues/4414).
Planning/publication owner: Codex chat `01a144d8-b318-7ed0-af97-e852be49d231` on `hetz`.
All seven steps are done and merged (table below); #4414 was closed on GitHub at 2026-10-19 21:19 UTC. Do not restart
this plan. New work on reviewer-assignment holds opens its own tracker.

| Step | Outcome | Status | Updated | Required acceptance artifact |
|---|---|---|---|---|
| 1 | Current-owner reconciliation and causal hold baseline | ✅ done (#4473) | 2026-10-19 EDT | Source/run-bound phase timeline, call graph and unknowns |
| 2 | Local, secret-safe timing and phase accounting | ✅ done (#4473) | 2026-10-19 EDT | Deterministic trace fixtures and exact request counts |
| 3 | Preparation outside ownership; fresh checks at commit | ✅ done (#4473) | 2026-10-19 EDT | Ordering and changed-state race tests |
| 4 | Bounded critical I/O with reserved safe cleanup | ✅ done (#4501) | 2026-10-19 EDT | Deadline, ambiguous-write and successor-owner fault tests |
| 5 | Independent progress and unchanged review guarantees | ✅ done (#4504) | 2026-10-19 EDT | Interleaving matrix and existing regression commands |
| 6 | Reviewed integration and ordinary guarded landing | ✅ done (#4505) | 2026-10-19 EDT | Exact-head review, merged commit and passing required checks |
| 7 | Normal-run proof, documentation and acceptance | ✅ done (live table in verification doc) | 2026-10-19 EDT | Run-bound acquisition/release evidence and same-issue live checklist |

Companion session handoffs were retired when #4414 closed (2026-10-19 21:19 UTC); none remain.
Topic [shared hold proposals](docs/shared-release-holds.md).
Read the downstream phases before each phase; use the `fresh-session` skill at
cut points if context is insufficient. Implemented and live-proved as of October 19, 2026 EDT: evidence and live samples in [docs/verification/reviewer-assignment-holds.md](docs/verification/reviewer-assignment-holds.md); merged PRs #4473, #4501, #4504, #4505.

## 1. Ultimate goal

Other sessions should be able to prepare work and run independent reviews without
waiting while a reviewer is being installed, checked, contacted, paid, retried or
reported on. Briefly protect the shared assignment records while recording a
review, then release that protection before the review runs. A reviewer already
working on something else must not be treated as unavailable.

**If a step conflicts with this goal, the goal wins — stop and flag it.**

This plan reduces avoidable time in the existing coordination lock. It does not
promise simultaneous conflicting edits to assignment records or zero time for
necessary bookkeeping. Database apply/merge protection remains unchanged. An
unmeasured suspicion that the lock caused current delays is not an established cause.

## 2. What this application is

[popcre/shared-db](https://github.com/popcre/shared-db) owns POP Creations' shared
Supabase structure and cross-session coordination tools. DAM, CRM, PIM and
DesignFlow use the shared database, but this change concerns the repository's
Node.js command-line tooling and GitHub coordination refs, not their application rows.

The lane manager `scripts/manage-migration-author-lanes.mjs` and its
`scripts/lib/lanes/` modules record reviewer assignments, rotation, active review
leases, failures and verdicts through authenticated GitHub calls and Git transport.
The normal protected target is `main`; authors work in isolated upstream worktrees
and use PRs. Local sessions and GitHub Actions invoke this tooling. There is no
web UI to serve or customer browser journey in this workstream.

A **mutex** is a short-lived exclusive right to change shared coordination records.
A **review lease** is the durable assignment for one issue/PR/exact source head/slot;
it may last throughout a review without occupying the mutex. A **stage lease**
protects actual preview, guarded merge or production activity and is a different
resource. The current mutex ref is `refs/db-coordination/author-acquisition`.

## 3. What triggered this work

Albert was told the reviewer lock prevents two sessions from obtaining the same
reviewer. Current code contradicts that explanation: one provider can run many
independent reviews at once. Only recording conflicting assignment/rotation state
requires brief serialization. Albert asked for a plan and an independent review.

The preceding recommendation was: retain brief assignment protection, keep
preparation/provider work outside it, and avoid holding unrelated coordination
behind slow reviewer work. No current measured hold-duration distribution or
attribution of today's delays has been produced. Step1 must establish that evidence.

A historical incident is real but already repaired: [#3791](https://github.com/popcre/shared-db/issues/3791)
reported an unbounded GitHub child holding the author mutex for hours. Current
transport has finite child timeouts. Do not reproduce that outage live or present
its old unbounded-child defect as an unfixed discovery. Offline fault fixtures
must reproduce delayed reads/writes safely.

## 4. Scope — in and out

In scope: measure assignment/replacement/release phases; keep slow preparation,
quota/backoff/provider work and reporting outside the mutex; bound remaining I/O;
preserve fresh admission/independence/rotation checks, transactional records,
request budgets and owner-safe cleanup; prove independent progress.

**NOT in this plan:**
- No database structure/data/migration/preview/production apply, host change,
  credential rotation, reviewer-roster change or removal of required checks.
- No provider concurrency ceiling, provider-busy queue, extra mandatory reviewer,
  blanket success restoration, budget reset or fabricated approval/recovery receipt.
- No replacement lock service, automatic age-based release, heartbeat or scheduler.
- No new reviewer-only mutex or namespace cutover. That requires a complete
  cross-domain writer/recovery proof and separate reviewed design; merely changing
  the assignment lock name is unsafe. This plan keeps the existing shared mutex
  for the short necessary record transaction and eliminates avoidable occupancy.
- No implementation of the broader [release-hold plan](plan_shared_release_hold_reduction.md),
  production-freeze exception, SQL fencing experiment or Muse-session recovery.

Related work: completed [#1767](https://github.com/popcre/shared-db/issues/1767)
API-budget work, [#3130](https://github.com/popcre/shared-db/issues/3130)
unlimited review concurrency, and #3791 child bounds are preserved, not rebuilt.
Open [#4297](https://github.com/popcre/shared-db/issues/4297) owns review failure and
slot independence; [#3617](https://github.com/popcre/shared-db/issues/3617) owns
preview-preparer API attribution; [#3779](https://github.com/popcre/shared-db/issues/3779)
owns guarded merge preparation. Reconcile actual PR/source ownership; no handoff
or this plan transfers their obligations. #4414 is this distinct assignment-hold outcome.

## 5. Current code and delivery state

All line numbers below refer to baseline `b31e17c0`; re-resolve symbols on fresh main.
[Immutable baseline tree](https://github.com/popcre/shared-db/tree/b31e17c02194c6006a1bd256d6154a324a5114d7).

| Existing component | Baseline evidence and actual behavior |
|---|---|
| Shared coordination identity | `scripts/lib/lanes/constants.mjs:62–65`: author-acquisition mutex and recovery guard; not a provider reservation |
| Concurrent review semantics | `scripts/lib/lanes/review-leases.mjs:15–23,414`: busy listing is reporting, not a production capacity gate; `pickReviewer` does not exclude a provider merely because it has reviews |
| Assignment preparation/transaction | `scripts/manage-migration-author-lanes.mjs:2144–2181`: peer policy and active-lease preflight before acquisition; then fresh peer/eligibility checks and ref publication inside mutex |
| Atomic assignment write | same file `:2372–2390`: compare-and-swap batch binds mutex, lease, rotation cursor and immutable assignment, followed by exact readback |
| Completion/cleanup | same file `:1733–1791,2437`: completed result survives cleanup failure; owner-qualified release/readback, bounded lag checks, existing Git fallback |
| Request and admission accounting | same file `:181–184,218–220,230–245`: operation count/context, separate admission budget, one transport attempt while locked |
| Acquisition guard | same file `:1794–1827`: quota preflight, create-only ownership and recovery/owner proof; failed acquisition is not ownership |
| Live queue default | same file `:466,2440–2443`: `enableReviewerQueue:false`; compatibility queue path exists but is not evidence of a current provider-busy queue |
| Transport timeouts/backoff | `scripts/lib/github-transport.mjs:115–141,345–364,429`: finite child timeout; rate wait opt-in, normally disabled; timed-out mutation is not safely replayable |
| Git ref transport | `scripts/lib/lanes/github-wire.mjs:48,220`: native ref/readback and bounded Git listing helpers; inventory all actual child calls, not only gh |
| Provider execution | `scripts/run-governed-review.mjs:634,794,946`: execution preflight and provider invocation are distinct from assignment transaction; preserve that separation |
| Current policy | `docs/agents/current-workflow.md`: unlimited reviewers, one independent review for governed changes, standalone proposals use documentation route |

Current source is already merged on main. The plan publication changes only prose
and literal discovery links; it changes no runtime code or authority. No experiment
has yet established how long successful current transactions hold the mutex.

## 6. Findings and causal boundaries

1. Assignment operations share the author-acquisition mutex. Therefore slow
   critical-section I/O can block unrelated coordination even though provider
   execution itself occurs outside it. This is a possible mechanism, not measured
   attribution of current production delays.
2. The records are related: rotation, assignment, active lease, peer independence,
   terminal failures/verdicts and recovery can race. Removing the lock or isolating
   just the draw path leaves other mutators unsynchronized. Existing atomic Git
   ref updates and exact expected-SHA readbacks must stay authoritative.
3. Fresh issue/PR/head/revocation/peer checks belong at the write boundary. A
   pre-lock snapshot is diagnostic/preparatory, never transferable admission.
4. Individual finite timeouts do not establish a short aggregate operation: many
   sequential calls may each consume their full timeout. Git calls and cleanup
   also count. Measure and bound phases, not only the provider or one gh child.
5. While locked, `runGitHubCommand` already requests one attempt. Do not claim
   that adding the same retry suppression is a new improvement. Admission has
   a separate budget context: the nominal reviewer ceiling is NOT the total
   command cost. Record both plus Git children without widening either ceiling.
6. Correct cleanup is not blindly deleting a ref. A timed-out write might have
   committed; a successor might already own the mutex after our release. Retain
   exact result/identity and independently read back the known transaction. Never
   start a second draw solely because the first command returned an error.

## 7. Rejected approaches and dead ends

- Removing serialization: permits duplicate draws, cursor loss and conflicting
  assignments; rejected even though providers can accept parallel reviews.
- One lock/queue per provider: mistakes logical assignment identity for provider
  capacity and reinstates a concurrency restriction Albert removed.
- Rename only assignment's mutex: verdict/replacement/recovery/claim interactions
  still assume the shared lock. No complete mixed-version/cross-domain proof exists.
- Move every check outside: stale head/peer policy/revocation can gain authority.
- Increase ceilings, disable timeout, ignore 403, hide cleanup failure or retry a
  timed-out mutation: each weakens an existing safeguard or can duplicate work.
- Short TTL then steal: age is not proof the holder stopped or a write failed.
- Rebuild #1767 or re-fix unbounded children from #3791: already implemented;
  use current source and tests instead of historical plan claims.
- Start paid throwaway reviews or force a live failure just to get measurements:
  unneeded spending/disruption; use fixtures and naturally authorized work.
- Treat a publication approval as implementation or live-speed proof: distinct
  stages. The old broader Muse conversation remains fenced; this new assignment
  plan/review is a separate workstream, not a replay or replacement of that review.

## 8. Dated design decisions

Locked **October 18, 2026 EDT**:
- Keep the existing mutex and record schemas. Keep unlimited same-provider
  independent reviews and every exact-head/independence/negative-verdict gate.
- Use a prepare→fresh-validate→record/readback→release→run/report boundary. No
  provider call, installation, quota-reset sleep or reviewer wait inside ownership.
- Reuse native transport and review-operation context. New instrumentation is
  local public-safe metadata, not a new Git ref/audit service or admission input.
- Assign/replacement/release/record-verdict/reap/reinstate/exclude/return/cutover
  paths and their callers must be inventoried; scope changes only where evidence
  shows avoidable holding, never force a broad refactor of every command.
- A latency deadline stops BEFORE starting a new mutation when its safe commit
  and cleanup reserve cannot fit. It never licenses deleting unknown ownership,
  rerunning an ambiguous mutation, or expiring a holder.

Engineering judgment with explicit criteria: step2 derives the aggregate phase
budgets from the full fixed call inventory, existing child bounds and legitimate
baseline p95/sample count. Record a proposed read/commit/cleanup budget table and
obtain the assigned technical review before activation. Preserve current finite
limits until this evidence exists; no guessed short timeout is policy. Insufficient
samples label distributions inconclusive, while deterministic delayed-I/O tests
still prove preparation/provider time is outside ownership. If required fresh work
cannot meet a brief bounded transaction without weakening checks, keep the safe
legacy path and mark optimization HOLD with a causal report; do not claim success
or silently split the mutex. No business decision is outstanding.

## 9. Ordered executable implementation

### Phase A — causal baseline and observability (steps1–2)

**1. Reconcile and inventory.** Fresh upstream worktree; task class `reviewer-safety`.
Accept #4414's outcome and check open PRs/owners for #4297/#3617/#3779. In the
lane manager resolve every `acquireReviewMutex`/`finalizeReviewMutex` call and
shared record writer; include `scripts/lib/lanes/{review-assignment,review-replacement,
review-leases,review-approval,holds-and-refs,github-wire}.mjs`,
`scripts/db-flow/reviewer-start-watch.mjs`, `scripts/run-governed-review.mjs` and
workflow callers. Include the non-reviewer shared-mutex writers
`scripts/rebind-expired-claim-blocker.mjs`,
`scripts/manage-preview-maintenance-lock.mjs`, and
`scripts/lib/lanes/expired-merged-claim-adoption.mjs`; these are inventory/causal
comparison targets, not permission to refactor those owners' code.
Create `docs/verification/reviewer-assignment-holds.md`: baseline commit,
operation, call site, phase, request/Git-child count, existing time bounds,
resource held and evidence gaps. Read available normal Actions logs and exact
owner/ref traces without creating draws or deleting refs. A commit timestamp
alone is not actual acquisition duration. Separate mutex wait, owned duration,
review lease age, provider time and stage lease; unknown remains unknown.
**Gate:** every shared mutator and caller has an inventory row; timestamps bind
run/attempt/source and allow acquisition→release to be re-derived, or name why
that cannot yet be done. No resource acquired by measurement. Dependency: none.

**2. Instrument without extra remote reads.** Extend existing operation context
around `withReviewRequestBudget`, acquisition/finalization and transport execution
in `manage-migration-author-lanes.mjs`, `github-transport.mjs` and
`lib/lanes/github-wire.mjs`; keep helper ownership there, not a telemetry service.
Record monotonic elapsed values for prepare, acquisition wait, fresh validation,
ref commit/readback, release and post-release execution. Wall time in public
reports uses EDT/EST. Trace schema: version, operation, source/tuple IDs,
invocation correlation, phase/duration, request class/count, result kind,
observed foreign mutex owner SHA/ref, and owner operation/run/attempt when provable
from already-read trusted metadata, plus
release state (`not_acquired`, `proved_released`, `unknown`, `successor_seen`).
Use the existing lock-read/refusal result for foreign ownership; no extra remote
read solely for telemetry. Unknown owner kind/run is explicitly unknown. Correlate
owner changes to step1 cross-domain traces; reviewer-only elapsed time cannot prove
who caused another session's wait. No authenticated arguments, tokens, raw child
output, issue bodies or customer rows.
Buffer the fixed-schema phase records in bounded memory during ownership; do not
write to stderr, files, pipes or an external collector from inside the critical
section. Flush to stderr or the existing private operation log only after release
or its final recovery-required decision, with bounded output and backpressure
handling. Preserve stdout JSON/exit contracts. Inject clock/executor for tests. Lost telemetry never invents
release or retries a mutation. Derive reviewed phase budgets as §8 specifies.
**Gate:** `phase_trace_has_no_extra_github_reads`, `trace_output_never_blocks_owned_section`,
`trace_preserves_stdout_contract`,
`unknown_release_is_not_zero_duration`, and existing wire ceilings pass.
Dependency:1. Cut point: commit the baseline/trace contract; re-read phasesB–C.

### Phase B — reduce avoidable holding (steps3–5)

**3. Separate preparatory work and fresh authority.** In
`assignNextReviewerOperation` and actual measured long-held sibling operations,
move only static parsing, immutable content/packet/tool resolution, wrapper
health/eligibility discovery and quota readiness out of ownership. Preserve
already-outside preparation; do not rerun provider health probes under the lock.
Before acquiring, ensure the full remaining fresh-check/commit/cleanup request
reserve fits. Under ownership re-prove current mutex/recovery guard, issue/PR/head,
route, verdict/failure/revocation state, peer allowlist/independence, active tuple,
current rotation cursor and exact expected ref SHAs. Immutable/preflight caches
must not answer mutable boundary checks. Use existing batched reads and atomic
ref updates; do not create a transferable preparation receipt or new write authority.
Run provider preflight/execution only AFTER assignment and proved mutex release,
through existing `run-governed-review.mjs`. Reporting follows release too.
**Gate:** `slow_preparation_does_not_hold_author_mutex`,
`provider_execution_starts_after_mutex_release`, `fresh_head_change_refuses_draw`,
`peer_policy_change_under_lock_refuses`, and `same_provider_parallel_reviews_allowed`.
Dependency:1–2. Independent implementation of fixture/report formatting is safe;
all lane-manager edits have one integrator and overlapping owners serialize.

**4. Apply bounded phase I/O without unsafe retries.** Extend native transport
options, not global OS binaries or an alternate GitHub client. Pass the reviewed
remaining-deadline cap through gh AND Git child calls, using monotonic time and
one attempt under ownership; zero/invalid remaining time refuses before launching
a call. Reserve the reviewed cleanup allowance before commit. Do not interrupt a
multi-ref batch midway deliberately: preflight its bounded child/cleanup budget;
a native timeout still means its result may be unknown. Deadline is an operation
budget, never a lease TTL. Keep lock-free quota backoff outside ownership even if
a caller inherited `GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS`; test this inheritance.

On mutation timeout/readback failure, retain the tuple, prior/desired ref SHAs and
known result; reconcile the exact atomic transaction through native bounded reads.
Readback proves all intended refs, not merely the cursor. If committed, preserve
that assignment and never redraw; if provably uncommitted, report a retryable
no-write refusal; partial/unknown remains explicit recovery-required. Release only
our exact owned mutex through existing CAS/Git fallback. Unknown lock release
blocks provider launch and requires supported native recovery. A successor owner
is evidence our mutex was released, not permission to delete its lock. Cleanup
errors retain `completedResult` and must not overwrite the primary result.
**Gate:** timeout/rate/ambiguous-commit/successor cases in§10; actual child caps and
aggregate reserves match the reviewed budget table without increasing wire ceilings.
Dependency:2–3. No timer callback deletes a ref or cancels someone else's writer.

**5. Prove interleavings and unchanged protections.** Extend
`manage-migration-author-lanes.test.mjs`, `reviewer-wire-budget.test.mjs`,
`mutex-release-on-refusal.test.mjs`, `lib/github-transport.test.mjs`,
`run-governed-review.test.mjs`, and relevant `lib/lanes/` suites. Use fake clock,
controlled executor delays and deterministic interleaving barriers, not flaky
wall-clock performance assertions. Show unrelated claim preparation/admission can
proceed while reviewer preparation/provider execution is paused; competing record
writes serialize correctly. Add two distinct exact review tuples using the same
provider; preserve same-head peer independence and author-engine exclusion.
Run every hostile case below, including legacy caller compatibility and release
failure with a completed result. Do not add a new independent lock to pass a test.
**Gate:** rerunnable regression artifacts show one coherent assignment/cursor/lease
per tuple, no lost negatives, no extra paid draw and no expired-owner deletion.
Dependencies:3–4. Cut point: independent exact-head technical review before rollout.

### Phase C — landing and acceptance (steps6–7)

**6. Integrate and land normally.** Update the affected reviewer procedure in
`docs/agents/section-4-anti-collision-rules.md`, budget verification and trace
interpretation. Current schemas/ref names/caller output remain compatible. Land
instrumentation first, then scoped preparation/deadline changes after qualified
budget evidence; no mixed-version ref migration or new activation switch is
needed. Obtain the current required allocator-assigned review for runtime code,
run task/route gates, normal PR/CI/guarded merge and bounded event-aware waiter.
No admin override, force push, status fabrication or structural object claim.
**Gate:** required checks and exact-head durable review pass; merged source includes
only scoped owned changes and is selected by actual caller workflow. Dependency:5.

**7. Prove normal use and close only the accepted outcome.** Observe naturally
authorized assignments on merged tooling; never create a paid review just to fill
metrics. Extend the step1 evidence file with exact run/attempt/source, acquisition,
commit/readback/release timeline and independent-operation trace. Demonstrate no
preparation/provider/reporting occupancy and measured aggregate held time. Report
sample size/median/p95 honestly; small samples cannot establish statistical speedup.
Require at least one real successful assignment and overlapping independent work;
fixtures cover destructive/timeout races without inducing them in production.
If no authorized overlap is available, leave this step partial and its live-proof
checkbox on #4414, not a new proof issue. Update STATUS with exact openable evidence.
**Gate:** original review capability works, owned mutex is proved released, trace
has no secrets, normal independent work proceeds, and no safety checks were removed.
Dependency:6. No Supabase application/deployment is required; acceptance concerns
merged Node/tooling plus its real calling session/Actions run.

## 10. Required tests and adversarial cases

Extend existing suites named in step5; verify names on fresh main. Do not replace
real ref-transaction tests with mocks that merely mirror the implementation.

| External input/race | Hostile case | Named required proof |
|---|---|---|
| PR/source | Head changes between prepare and owned commit | `fresh_head_change_refuses_draw` |
| Peer policy | Allowlist/peer or author engine changes | `peer_policy_change_under_lock_refuses`; `author_engine_remains_excluded` |
| Verdict/failure | Negative verdict or terminal release appears after snapshot | `fresh_terminal_evidence_prevents_assignment_resurrection` |
| Parallel tuple | Same provider already reviewing another PR | `same_provider_parallel_reviews_allowed` |
| Conflicting tuple | Two callers draw same exact review concurrently | `concurrent_draws_preserve_one_tuple_and_cursor` |
| Slow preparation | Health/tool/quota probe pauses | `slow_preparation_does_not_hold_author_mutex` |
| Provider run | Paid call/report blocks after assignment | `provider_execution_starts_after_mutex_release`; `slow_report_holds_no_mutex` |
| gh environment | Inherited 900-second quota wait / transient error | `owned_section_never_sleeps_for_quota_or_retries` |
| Git/gh child | Any call never returns or reaches remaining deadline | `owned_git_and_gh_children_have_remaining_deadlines` |
| Atomic write | Timeout after commit but before response | `ambiguous_commit_recovers_same_assignment_without_redraw` |
| Atomic write | Provably absent or partially observed desired refs | `partial_or_unreadable_transaction_is_recovery_required` |
| Cleanup | Prior owner resumes after successor acquired | `cleanup_never_deletes_successor_mutex` |
| Cleanup error | Draw succeeded but release proof fails | `completed_assignment_survives_cleanup_failure` |
| API budget | Admission context plus review requests exhaust reserve | `all_contexts_accounted_and_cleanup_reserve_preserved` |
| Trace | Missing timestamp, backwards wall time, hostile child output | `unknown_release_is_not_zero_duration`; `trace_is_monotonic_and_secret_safe` |
| Cross-domain wait | Unrelated mutex owner or owner changes between reads | `wait_trace_preserves_observed_owner_and_unknown_attribution` |
| Trace backpressure | stderr pipe blocks while owned | `trace_output_never_blocks_owned_section` |
| Trace I/O | Output failure while real assignment completed | `trace_failure_does_not_repeat_or_hide_completed_assignment` |
| Legacy callers | Old SHA/ref/output contracts | `legacy_review_callers_remain_compatible` |
| Regression | Instrumentation sends extra remote reads | `phase_trace_has_no_extra_github_reads`; `trace_preserves_stdout_contract` |

Rerun from repository root (no DB credentials needed):

```bash
git diff --check
node --test scripts/manage-migration-author-lanes.test.mjs scripts/reviewer-wire-budget.test.mjs scripts/mutex-release-on-refusal.test.mjs scripts/run-governed-review.test.mjs scripts/lib/github-transport.test.mjs
node --test scripts/lib/lanes/*.test.mjs
node --test scripts/check-handoff-contract.test.mjs scripts/check-documents-only-merge-authorization.test.mjs
```

If a named existing suite moves, update references from current source and record
why; do not claim a missing command passed. Planning publication needs link/contract
checks and the requested independent substantive review, not runtime fault injection.

## 11. Constraints and gotchas

- This is repository maintenance. No structural lane, database object reservation,
  migration, preview apply, production write or shared release stage is needed.
- Canonical checkout is landing-only; preserve other sessions' worktrees and files.
  Before commit verify Albert Hazan's configured identity; stage only owned files.
- Runtime changes use full native engineering route and exact-head independent
  approval. A proposal's publication never activates the instructions it describes.
- Preserve current request ceilings, cleanup fallback, one-review policy, peer
  independence, author-engine exclusion, immutable audit refs and negative verdicts.
- Do not bypass host quota latch, provider preflight, incomplete evidence fences,
  assigned reviewer, native release/recovery or existing workflow permissions.
- A review lease is not the short mutex; do not count provider review duration as
  lock duration. A queued workflow is not proof a child or review started.
- No unrelated handoff rewrite, root HANDOFF change, skill/global rule rewrite or
  memory edit. Discovery links carry no operational policy change.
- Sign GitHub posts with actual thread and machine. Human clock times use New York
  EDT/EST; machine filenames may use UTC. No secrets/private raw logs in public Git.

## 12. Access and environment

Planning session: authenticated Git/gh read and issue-write access verified on hetz;
Node.js and installed `ai-task-gates`/`ai-review` tooling are present. Recheck live
credentials/permissions via ordinary native preflight at implementation time, never
print tokens. Required provider must be currently in rotation and independent of
Codex; shared-db's allocator remains authoritative where a governed code review
requires a draw. The user-requested proposal review needs no artificial migration.

No Supabase secret, test user, browser login, production SSH or 1Password item is
needed. If a later genuine credential fault occurs, use the existing credential
runbook and `secrets-to-1password` skill (`vibe_coding` vault); this plan authorizes
no new credential/role. Local unit tests use injected I/O and clocks. Do not serve
an app. Work in a new `origin/main` worktree, select the normal PR route and retain
private native review reports under `.ai/reviews/`, never copy raw provider packets
into the public plan. Reviewer failure is reported honestly, not treated as approval.

## 13. Definition of done, risks and open questions

Planning delivery: all 13 sections and self-audit pass, own handoff/topic/router
links exist, independent reviewer examines DESIGN feasibility/failure paths (not
only safe publication), findings are resolved or explicitly gated, and owned prose
is committed/pushed/normally merged with a GitHub link and review outcome on #4414.
(Historical, at planning publication: all seven implementation rows were open. They are now done; see STATUS.)

Implementation acceptance:
- Step1 causal baseline and exact mutator/caller inventory exist; no guessed delay.
- Prepared/static/provider/report time occupies no shared mutex; fresh mutable
  authority is checked inside; supported independent provider reviews stay parallel.
- Aggregate critical I/O and cleanup have measured/reviewed finite budgets, native
  request ceilings remain, ambiguous commits cannot redraw and stale cleanup cannot
  release a successor. Required regression/hostile cases pass.
- Owned runtime commits pushed, native exact-head approval/required CI/normal merge
  verified, actual merged-source caller observed, live evidence linked on #4414,
  STATUS updated and zero abandoned owned mutex/stage/claims.

Risks: stale preflight could authorize the wrong head; fresh boundary checks prevent
it. A too-short deadline can cause unnecessary refusals; derive it from actual
legitimate calls and validate before activation, not by weakening checks. A timeout
can hide a committed draw; exact ref-state reconciliation prevents duplicate work.
Telemetry may expose secrets or distort cost; use allowlisted metadata/no extra reads.

Rollback: stop new optional deadline behavior through a reviewed revert after any
in-progress native transaction finishes/reconciles. Restore previous finite bounded
transport/ordering, retain successful assignments and immutable evidence, preserve
owner-qualified cleanup and all existing timeout fixes. No ref deletion, lease
stealing, provider substitution or database action is a rollback method. There is
no new schema/ref format requiring a mixed-version cutover.

Open engineering evidence: current causal hold durations, necessary fresh-call
cost and reviewed aggregate budget. §8/steps1–2 give the criteria and exact artifacts;
these are measurable judgments, not questions delegated to Albert. If fresh-check
cost dominates, report HOLD and a separate reviewed cross-domain design requirement
instead of claiming this plan proved that a new reviewer mutex is safe.

### Mandatory self-audit — before independent review

All checklist items pass:13 sections; plain goal/conflict instruction (§1);
zero-chat background/state/root-cause boundaries (§§2–6); rejected options (§7);
locked and measured judgment decisions (§8); concrete ordered files/dependencies/
gates/cut points (§9); every hostile row names a proof (§10); standing constraints
and secret-free access (§§11–12); landing/live acceptance/rollback (§13); STATUS,
registered bidirectional handoff and topic/router discovery links.

1. **Can a brand-new session execute without a question? Yes.** §§2–6 define terms,
   baseline, related owners and known/unproved behavior; §§8–12 specify choices,
   targets, sequencing, commands and measurable decision criteria. No business
   choice or undocumented secret item is left to infer.
2. **Does it carry the relevant background and rejected paths? Yes.** §§3,6–8
   distinguish already-fixed incident, concurrency policy, shared-record races,
   aggregate budgets and the rejected provider-lock/TTL/new-mutex shortcuts.
3. **Can the goal guide a correct unexpected judgment? Yes.** §1 requires brief
   protection without capability loss; §§8,13 require HOLD if latency cannot be
   reduced safely and prohibit presenting unmeasured or unproved work as accepted.

The audit establishes completeness of the plan, not experimental/runtime success.
Independent review and exact publication evidence are recorded on #4414; no approval
is claimed until a genuine completed report exists for its actual reviewed source.

### Independent plan review — October 18, 2026, 9:39 AM EDT

GLM-5.3 completed a native plan review of source
`12dcc287c865cdbff005f83e8447a5740e45d525`: **APPROVE**, no medium/high findings.
It checked baseline citations, cross-domain mutex writers, transaction/cleanup
semantics, test paths and the adversarial matrix. Four low findings are addressed:
explicit start-watch path; cross-domain writer inventory and observed foreign-owner
trace fields; active-plan discovery pointer; spacing/portable continuation links.
Root audit also requires buffered, post-release trace output to avoid backpressure
inside ownership, and a literal-only router link that carries no policy instruction.

The private native report remains under `.ai/reviews/`; publication evidence on
[#4414](https://github.com/popcre/shared-db/issues/4414) binds its actual source
and later final-check/merge. The approval above is not claimed for a later changed
head. (Historical: at planning time all seven runtime rows were open and latency was unmeasured. Now done and measured; see STATUS and the verification doc's step 7 table.)
