# Implementation plan — provider-neutral multi-agent database coordination hardening

**Repository:** `u2giants/shared-db`

**Tracking issue:** [#1366](https://github.com/u2giants/shared-db/issues/1366)

**Created:** 2026-08-21

**Revised:** 2026-08-23 after two independent reviews — Grok 4.6, then GLM-5.3 checking Grok's corrections and the resulting revision (`.ai/reviews/glm-coordination-hardening-plan-review-20260823T150517Z.md`; verdict APPROVE conditional on fixes now applied). Grok 4.6 review (`.ai/reviews/grok-coordination-hardening-plan-review-20260823T133248Z-145771.md`, cost $0.18); no implementation step has started

**Prior revision:** 2026-08-21 after a three-round Codex/Claude adversarial review

**Work class:** repository maintenance; this plan does not authorize a database structure or data change

**Session handoff:** [`HANDOFF.d/2026-08-21T2223Z-edge-dev-codex-agent-coordination-plan.md`](HANDOFF.d/2026-08-21T2223Z-edge-dev-codex-agent-coordination-plan.md)

## STATUS — read this before doing anything

| Step | Outcome | State | Evidence |
|---|---|---|---|
| 1 | Lock the orchestrator boundary and finish the two existing required-check gaps | ✅ **done** | `039531f` (PR #1383) + the required-checks apply. Live protection: 11 contexts, `strict: false`, all prior contexts and fields intact. Evidence: [`docs/verification/orchestrator-boundary-and-required-checks-2026-08-23.md`](docs/verification/orchestrator-boundary-and-required-checks-2026-08-23.md). |
| 2 | Replace flat database-object claims with compatible read/write claims | ✅ **done** | Conflict matrix live in `conflicts()`; `writes:`/`reads:` parsed by `parseQueueScope` and `parseClaimBlock`; legacy `objects:` reads as writes. 551 tests pass. |
| 3 | Make issue dependencies prove successful completion | ✅ **done** | `scripts/lib/work-dependencies.mjs` + `--complete-work`; typed outcomes, cycle detection, existence checks, re-derived merge evidence, dated grandfather cutoff. 596 tests pass. |
| 4 | Add a provider-neutral agent work contract and completion report | ✅ **done** | `scripts/agent-work-contract.mjs`; contract pinned to `refs/db-contracts/<issue>/<gen>` create-if-absent; one merged completion schema; report-only workflow. Shared-identity limitation stated, not overclaimed. |
| 5 | Add durable coordination events and repeatable failure scenarios | ✅ **done** | `scripts/db-coordination-events.mjs` + 30-row `scripts/coordination-scenarios.test.mjs`. No stage heartbeat events; `claim_renewed` retained. 677 tests pass. |
| 6 | Add run-liveness recovery, generation fencing and an apply-time advisory lock to exclusive stages | ⬜ open | Not started |
| 7 | Pilot isolated Supabase branches for early pull-request checks | ⬜ open | **deferred** — split to a follow-up issue; not required for this plan's completion |
| 8 | Activate core guards and retire compatibility paths (8A); pilot expansion (8B) deferred with Step 7 | ⬜ open | Not started |
| 9 | Reconcile documentation, evidence, handoff and issue state | ⬜ open | Not started |

**CODE-ANCHOR RULE — read before editing any script.** This plan cites code by
**function name**, not line number. Line numbers in `scripts/manage-migration-author-lanes.mjs`
move on nearly every merge; the 2026-08-21 revision of this plan carried six stale
citations, three of which pointed into unrelated functions. Before touching a named
function, re-anchor it on current `origin/main` with:

```bash
grep -n "^export function <name>" scripts/manage-migration-author-lanes.mjs
```

Never trust a line number written in this document, including the ones recorded in
§5 and §6 as of 2026-08-23.

**Fresh-session starting point:** Step 2. Step 1 is complete, including live branch protection. This plan-writing session changed documentation only. Before every later phase, start a fresh repository-maintenance session, re-read the remaining plan from that phase onward, and use an isolated worktree created from current `origin/main`.

**2026-08-23 revision — what the independent Grok 4.6 review changed.** The review
agreed with the plan's goal and most of its design but found that two guarantees were
not actually delivered, and that the plan had gone stale against the code. Corrections
applied below, each traceable to a verified finding:

1. **Stale code citations replaced by function-name anchors** (§5, §6, Steps 1-6). Six of
   eleven cited line numbers were wrong; `acquireExclusive` and
   `assertMergeCommitInMainHistory` citations pointed into unrelated split-recovery code.
2. **Heartbeat leases removed from Step 6.** Renewal moved the exclusive ref's SHA, but
   `releaseOwnedRef` and every calling workflow release with the SHA captured at
   acquisition — so the first heartbeat would have made the lane permanently unreleasable.
   Liveness is now a live GitHub run query. `--renew-exclusive` is gone.
3. **Mutex-recovery compatibility made explicit in Step 6.** The new owner-commit format
   would not have matched `recoverStaleAuthorMutex`'s recognized-lock pattern, making a
   crash mid-acquire unrecoverable. `MUTEX_RECOVERY_ACTIVE_REF` was never mentioned.
4. **Every exclusive-ref mutation now takes the global mutex** and releases on
   `holder_id` + `generation`, not the acquisition SHA. `updateRef` PATCHes with
   `force=true` and no expected-SHA, so there is no Git-level compare-and-swap to rely on.
5. **Work contracts pinned to a git ref** (Step 4). Issue comments are editable and every
   session shares one GitHub identity, so a comment cannot establish dispatcher authority.
   Every other lock in this repository is already a ref.
6. **The two completion-record formats merged into one** (Steps 3 and 4). They previously
   contradicted each other on whether `pr` is required.
7. **An apply-time Postgres advisory lock added** (Step 6). GitHub fencing cannot stop SQL
   already running inside Supabase; this is the one remaining split-write window.
8. **Step 1 no longer moves curated Master Data off the orchestrator.** That extended an
   owner ruling Albert did not make.
9. **Lease scenario fixtures moved from Step 5 to Step 6**, which is where the lease code
   is written.
10. **Step 7 deferred to a follow-up issue.** It prevents no failure mode in §1.
11. **JSON Schema draft 2020-12 replaced by hand-rolled validators** (Steps 4, 5), matching
    `scripts/check-handoff-contract.mjs`. This repository has no root `package.json`.
**GLM-5.3 follow-up corrections, same day.** GLM confirmed all twelve Grok corrections against the code, then found the fast revision had left contradictions of its own: Step 9 still told the closing session to hold #1366 open for the deferred pilot; the Definition of Done still required leases to "renew"; `claim_renewed` had been dropped even though author-claim renewal is retained functionality; the handoff still carried the very line numbers the revision condemned; §1/§4 still promised the deferred pilot; two commands appeared to publish completion records; and the advisory lock was credited with closing the dying-backend window when it only prevents concurrent live applies. All are corrected below, and the advisory lock's real scope is now stated wherever it appears.

12. **Two misleading code comments added to Step 1's scope** — they still assert that
    sibling-collision safety depends on `strict: true`, which is what produced the original
    unsafe Step 1.

**Revision warning:** the original version incorrectly instructed Step 1 to restore GitHub's “require branches to be up to date” setting. That would reverse Albert's explicit 2026-08-19 ruling in [issue #1286](https://github.com/u2giants/shared-db/issues/1286). The corrected plan preserves `required_status_checks.strict: false`; structural migration PRs already receive an exact current-`main` proof inside the required guarded-merge workflow.

---

## 1. Ultimate goal — what we are actually trying to achieve

POP Creations must be able to use Codex, Claude, and future coding agents in parallel without one session silently overwriting another session's database work, applying migrations out of order, holding an abandoned deployment lock forever, or claiming that blocked work is complete.

When this plan is finished:

- the database-structure orchestrator will do only database structure and schema work;
- unrelated agents may research, review, test, and author unrelated changes concurrently;
- any work that reads or writes the same database dependency will be serialized before code is written;
- downstream work will start only after its prerequisites have verifiably succeeded;
- every dispatched agent will receive the same explicit work contract regardless of whether it is Codex or Claude;
- preview, merge, and production leases will recover safely from crashed jobs without letting an old holder continue after takeover;
- the shared preview remains the final integration rehearsal (isolated per-PR database testing was deferred on 2026-08-23 and is not delivered by this plan);
- GitHub will retain a reconstructable record of dispatch, claim, review, rehearsal, merge, promotion, release, cancellation, and recovery.
- the safety controls will preserve the intentional throughput decision in issue #1286: ordinary PRs will not all be forced to restart every required check after every unrelated merge, while structural migrations remain current with `main` at the guarded merge point.

**If a step conflicts with this goal, the goal wins — stop and flag it.** In particular, do not increase parallelism by weakening serialization around a shared mutable database.

## 2. What this repository is

`u2giants/shared-db` is the source of truth for the structure of the Supabase database shared by POP Creations applications. It contains:

- timestamped SQL migrations under `supabase/migrations/`;
- database contract tests and verification scripts;
- GitHub Actions workflows for pull-request checks, preview rehearsal, guarded merge, and production promotion;
- GitHub-backed coordination code in `scripts/manage-migration-author-lanes.mjs`;
- the durable operating contract in `AGENTS.md` and `docs/agents/section-4-anti-collision-rules.md`.

The shared checkout on the planning machine is `C:\repos\shared-db`. Agents must not implement from that shared checkout. Each implementing session uses its own Git worktree and branch cut from current `origin/main`; the Codex documentation describes worktrees as independent checkouts that share Git metadata while isolating files ([official Codex worktree documentation](https://learn.chatgpt.com/docs/environments/git-worktrees)).

The live database environments are:

- a persistent shared preview project whose current ref is stored in GitHub repository variable `PREVIEW_PROJECT_REF`;
- production Supabase project `qsllyeztdwjgirsysgai`.

This plan changes repository coordination, scripts, workflows, tests, and documentation. It does not itself change a schema, table, row, preview database, or production database.

## 3. What triggered this work

Albert asked for internet research into the best way to coordinate multiple Codex and Claude agents working around one database, then asked for an implementation plan applying the findings to this repository.

The research found that this repository already has the strongest foundation: isolated worktrees, permanent migration versions, up to three unrelated authors, exact object claims, and exclusive preview/merge/production stages. The remaining risk is not a lack of parallel agents; it is incomplete dependency modelling, incomplete lease recovery, provider-specific completion behavior, and two required CI checks that exist but are not enforced by branch protection.

During plan intake on 2026-08-21, the task was incorrectly handed to the shared-db orchestrator. Albert corrected the boundary immediately:

> the orchestrator's only job is database structure and schema. this is not a job for the orchestrator

That ruling is locked. The current code still describes `repo-maintenance`, `documentation`, and `security-settings` as work the orchestrator should `FORK` (`NON_STRUCTURAL_EXITS`) and reports all non-structural issues to the orchestrator (`buildDynamicQueues`). Step 1 corrects that mismatch before adding more coordination machinery.

After the first plan merged in pull request #1367, Albert asked Codex to debate it with Claude. The three-round, code-level review found one unsafe instruction and two sequencing/authority gaps:

- the plan treated `strict: false` as drift, but issue #1286 proves Albert deliberately authorized it on 2026-08-19 after repeated check resets cost roughly 50 minutes per day;
- the plan implied, but did not require, that the dispatcher publish the work contract before the worker begins and that the worker cannot broaden it;
- core guard activation could wait indefinitely for a suitable real migration to appear for the optional Supabase branch pilot.

The same review confirmed that several feared gaps were already solved: the GitHub-ref mutex is atomic and tested, the guarded migration merge already requires the PR head to contain current `main` twice, and squash-merge ancestry is already handled through GitHub's actual `merge_commit_sha`. This revision carries those facts so an implementer does not build duplicate controls.

## 4. Scope — in and out

### In this plan

- Clarify and enforce that the orchestrator admits only structural/schema work.
- Make the existing `Orchestrator marker guard` and `Cancelled work guard` required on `main`.
- Extend issue and active-claim declarations from one flat `objects:` list to `writes:` plus `reads:` with a compatibility window.
- Detect write/write and write/read conflicts; allow read/read concurrency.
- Validate dependency existence, cycles, and proof of successful completion.
- Define provider-neutral JSON work contracts and completion reports.
- Record immutable coordination lifecycle events in GitHub comments.
- Add deterministic failure scenarios and audit output.
- Add fenced exclusive leases with safe stale recovery driven by live GitHub run state. No heartbeats, no lease clock.
- Keep the shared preview as the final integration and production rehearsal gate.
- Preserve `required_status_checks.strict: false` unless issue #1286's separately governed revert criteria are met in a different, owner-authorized change.
- Make the dispatcher—not the executing worker—the authority that publishes the immutable work contract before branch work begins.
- Activate core coordination guards independently of whether a suitable migration is available for the optional Supabase branch pilot.
- Update only the repository docs, scripts, tests, workflows, and branch protection needed for these outcomes.

### NOT in this plan

- No application feature work in PopPIM, PopCRM, PopDAM, or DesignFlow.
- No routine application data writes and no curated Master Data load.
- No schema change created merely to test this coordination system.
- No concurrent `supabase db push` to the same database.
- No replacement or retirement of the persistent shared preview.
- No automatic production promotion and no weakening of the business-risk gate.
- No enabling of Claude Agent Teams as the migration-author control plane.
- No reliance on Codex- or Claude-only hooks for a safety property.
- No attempt to make static SQL parsing evasion-proof.
- No automatic lock deletion based only on elapsed time.
- No broad rewrite of `scripts/manage-migration-author-lanes.mjs`; extract modules only where a phase needs a stable test boundary.
- No restoration of `required_status_checks.strict: true` in this workstream.
- No duplicate current-`main` guard added to the lease subsystem; the existing guarded migration merge remains authoritative.
- No worker-authored widening or replacement of its own dispatch contract.
- No mandatory or automatically blocking claim that one later migration semantically invalidates another; any such pointer is advisory because that judgment is business/domain specific.

## 5. Current state of the code and operations

### What already works and must be preserved

1. **Three author lanes, one shared mutable stage at a time.** `docs/agents/section-4-anti-collision-rules.md:9-12` allows up to three unrelated migration authors and keeps preview, merge, and production serial. Lines 14-30 require an isolated worktree, exact object claim, and permanent 14-digit version before a migration file is opened.
2. **GitHub is the coordination store.** `EXCLUSIVE_REFS` in `scripts/manage-migration-author-lanes.mjs` maps preview, merge, and production to Git refs. Acquisition is `acquireExclusive`; release is routed through `releaseOwnedRef`, which today compares the ref's current SHA against the SHA captured at acquisition.
3. **Queue scopes are machine readable.** `parseQueueScope` in `scripts/manage-migration-author-lanes.mjs` parses `status`, `work_type`, `route`, `priority`, `depends_on`, and `objects`.
4. **The queue serializes exact object overlap.** `buildDynamicQueues` in `scripts/manage-migration-author-lanes.mjs` groups overlapping `objects` and fills no more than three lanes.
5. **Pull requests receive a second collision check.** `.github/workflows/pr-object-collision.yml` runs `scripts/check-pr-object-collisions.test.mjs`, `scripts/check-dispatch-collision.test.mjs`, `scripts/manage-migration-author-lanes.test.mjs`, and then the live read-only checker.
6. **Migration pull requests require a live branch-bound claim.** `.github/workflows/migration-author-lease.yml` runs the claim tests and `scripts/check-migration-pr-lease.mjs`.
7. **Handoffs have a checked contract.** `.github/workflows/handoff-contract-guard.yml` validates only handoff files touched by the pull request and fails closed when issue state is unreadable.
8. **The two missing checks are already built.** `.github/workflows/orchestrator-marker-guard.yml` and `.github/workflows/cancelled-work-guard.yml` each contain their own negative-path tests. The unresolved work is branch-protection enforcement, not checker implementation.
9. **Structural migration PRs already prove they contain current `main` at the safe moment.** `.github/workflows/guarded-migration-merge.yml:38-48` fetches `origin/main`, proves `merge-base(HEAD, origin/main) == origin/main`, and reruns the SQL, collision, and lease guards before acquiring the exclusive merge lane. Lines 59-71 repeat the head, current-`main`, collision, and lease proofs while the lane is held. `Migration guarded merge authorization` is already required on `main`.
10. **The global acquisition mutex is concrete and tested.** `MUTEX_REF` is `refs/db-coordination/author-acquisition`; `acquireMutex` uses atomic GitHub create-if-absent through `createRefWithReadback`, and `requireOwnedRef` fences every following GitHub mutation. A second ref, `MUTEX_RECOVERY_ACTIVE_REF`, marks an in-progress recovery and makes `acquireMutex` refuse while it is held; `recoverStaleAuthorMutex` frees a stale mutex only when the owner commit message matches its recognized-coordination-lock pattern. The cross-host atomic acquisition test lives in `scripts/manage-migration-author-lanes.test.mjs` (search for the create-if-absent contention case).
11. **Squash merges already have a correct ancestry primitive.** `assertMergeCommitInMainHistory` validates GitHub's actual pull-request `merge_commit_sha` against the current `main` history, regardless of whether GitHub created a merge or squash commit.

### Exact gaps

1. **Orchestrator scope is too broad in prose and output.** `NON_STRUCTURAL_EXITS` labels repo maintenance and documentation as `fork`; `buildDynamicQueues` sends all non-structural issues to `notOrchestratorWork`. This invited the routing mistake that triggered the owner correction.
2. **Object claims have no access mode.** `parseQueueScope` collects and returns only `objects`. The `overlaps` comparison inside `buildDynamicQueues` treats all contact as identical.
3. **Dependencies mean only “not currently open.”** `buildDynamicQueues` builds an open-issue-number set and blocks only dependencies found in that set. A missing issue, a manually closed failure, a cancelled issue, or a dependency cycle is not rejected.
4. **Static collision detection admits semantic blind spots.** `scripts/check-pr-object-collisions.mjs:75-77` explicitly says that different named objects can still be coupled, such as a view and the function it calls.
5. **Exclusive stage locks have ownership but no recovery metadata.** `acquireExclusive` writes a commit message containing the stage, request, PR, and head SHA. It does not record holder identity, GitHub run ID, run attempt, or a monotonic generation, so a crashed job's lock cannot be safely taken over and a stale holder cannot be fenced out.
6. **There is no Git-level compare-and-swap.** The `updateRef` helper PATCHes a ref with `force=true` and no expected-SHA. Ref safety therefore comes entirely from holding `MUTEX_REF` and calling `requireOwnedRef` — not from Git. Any new exclusive-ref mutation must take the same mutex.
7. **GitHub fencing cannot reach the database.** A token cannot interrupt SQL already executing on Supabase, so a taken-over lane can still overlap a dying backend's session. `docs/advisory-lock-registry.md` already establishes Postgres advisory locks as this repository's in-database exclusion primitive.
8. **Author lease expiry deliberately does not unlock.** `docs/agents/section-4-anti-collision-rules.md:188-193` makes expiry an audit warning only. That rule is correct for permanent migration versions and object ownership; it must not be casually copied into recoverable stage leases.
9. **Branch protection is incomplete, but `strict: false` is intentional—not drift.** A live read on 2026-08-21 returned nine required contexts and omitted `Orchestrator marker guard` and `Cancelled work guard`. Open issue #1286 records Albert's 2026-08-19 authorization to change `strict: true` to `strict: false` because concurrent PRs repeatedly restarted all required checks, costing roughly 50 minutes per day. Its revert criterion is more than two semantic-conflict breaks in two weeks. This plan adds only the missing contexts and preserves every other protection field, including `strict: false`.
10. **No provider-neutral completion contract exists.** Codex and Claude can each return summaries, but no repository guard checks that the assigned paths, required tests, database objects, stop conditions, and evidence were satisfied before completion.
11. **No single lifecycle trace exists.** State is reconstructable from issues, refs, PRs, workflows, and comments, but there is no validated event vocabulary or audit command covering an end-to-end work item.
12. **Contract authority was underspecified.** A hash proves that a report refers to a contract, but it is not a safety boundary if the worker may publish or broaden that contract after starting. The dispatcher must publish the contract first, and validation must bind it to the pre-work base and first worker commit.
13. **The optional pilot was coupled to mandatory activation.** The first plan made Step 8 depend on Step 7 even though Step 7 correctly refuses to invent a migration. Core enforcement could therefore wait indefinitely for unrelated real work.
14. **Active durable documentation still contradicts the later owner ruling.** `docs/owner-rulings.md:799-836` preserves the accurate 2026-08-06/14 history but still says `strict: true` is current and must never be turned off. `plan_orchestrator-workflow-gaps.md:503-506` likewise tells implementers to expect strict mode. Issue #1286 is the later 2026-08-19 owner-authorized change and therefore supersedes those current-state instructions without erasing their incident history.
15. **Contract authority cannot rest on issue comments.** GitHub issue comments are editable and deletable, and every session in this repository commits and calls `gh` under one shared identity. A comment therefore cannot prove who issued a work contract. Mutex ownership, permanent version reservations, and review-failure evidence are already Git refs.
16. **The active author claim's authority lives in an editable issue body.** The permanent version reservation is a ref, but owner, branch, and declared objects are read from a `db-claim` issue body that any session can edit under the shared identity. This plan does not close that hole; Step 4's contract-ref work fixes the contract layer only. Record it as a known limitation rather than implying claims are already ref-backed.
17. **Two misleading comments still tie collision safety to `strict: true`.** `.github/workflows/pr-object-collision.yml` and `scripts/check-pr-object-collisions.mjs` both state that sibling-collision detection is reliable because branch protection requires an up-to-date branch. That text is what produced the original unsafe Step 1.

### Current branch and deployment state after the review revision

- The first documentation plan merged through PR #1367 as commit `563240c7832595d44e08952cfe31f44f1c252535` on `origin/main`.
- The Claude/Codex review correction merged through PR #1368 as commit `4d2ad3c62d1b242d59740b9a0a2e1f53b73a06a6` on `origin/main`.
- Issue #1366 remains open and owns the future implementation. No STATUS row is complete.
- No preview, production, schema, row-data, orchestrator, or branch-protection write was performed by either planning or debate session.
- The debate used Claude in safe read-only mode and a detached review worktree, which was removed after the review.

## 6. Key findings and root cause

### Root cause

The repository has good locks around exact known writes, but it models coordination mostly as ownership of one named object and one stage ref. Real database work has richer relationships:

- a change may write one object while reading another;
- a dependency may be closed without succeeding;
- a workflow may die after acquiring a stage lock;
- an old holder may resume after a time-based takeover;
- an agent may say “done” without satisfying the actual dispatch contract.

The answer is not a larger autonomous agent team. It is a stronger repository-owned protocol that any agent must obey.

### Research findings that shape the design

1. Official OpenAI guidance recommends multiple agents for concrete, independent, bounded work and recommends one agent when workers would contend over the same mutable resource. It also calls out focused context as the benefit of delegation ([OpenAI Multi-agent guide](https://developers.openai.com/api/docs/guides/responses-multi-agent)).
2. Official Codex guidance says to begin with read-heavy parallel work such as exploration, tests, triage, and summarization, and to be more careful with parallel write-heavy work because conflicts and coordination overhead rise ([Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)).
3. OpenAI distinguishes a manager retaining final ownership from a handoff where a specialist takes over. This repository needs a durable manager/control-plane pattern for shared stages, while independent repo-maintenance sessions own their own non-schema work ([OpenAI orchestration and handoffs](https://developers.openai.com/api/docs/guides/agents/orchestration)).
4. OpenAI recommends end-to-end traces first, then repeatable datasets/evaluations when good behavior is known. The repository equivalent is immutable lifecycle events plus deterministic coordination scenarios in CI ([OpenAI agent workflow evaluations](https://developers.openai.com/api/docs/guides/agent-evals)).
5. Claude Agent Teams are experimental, add coordination overhead, work best on independent tasks, and advise starting with research/review and avoiding same-file conflicts. They also have known task-status, resumption, and shutdown limitations ([Claude Agent Teams](https://code.claude.com/docs/en/agent-teams)).
6. Supabase's team guidance says all remote schema changes go through migrations and only one person/process should run `db push` at a time because migrations apply in timestamp order ([Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations)).
7. Supabase branches are isolated, run migrations sequentially, retain an applied-migration record, and are seeded once when created. Recreating a branch reruns migrations and loses extra branch-local data. That makes branches suitable for early disposable validation, not a substitute for the persistent final rehearsal ([Supabase working with branches](https://supabase.com/docs/guides/deployment/branching/working-with-branches)).
8. Kubernetes lease records use holder identity, acquire time, renew time, duration, transitions, optimistic concurrency, and periodic renewal. These are the minimum useful concepts for recoverable exclusive lanes ([Kubernetes Lease API behavior](https://kubernetes.io/docs/concepts/cluster-administration/coordinated-leader-election/)).
9. etcd documents why TTL alone is not mutual exclusion: clocks and delayed clients can leave an old holder believing it still owns the resource. Version validation or a fencing token is required ([etcd lock and lease notes](https://etcd.io/docs/v3.6/learning/why/)).
10. PostgreSQL documents the same access-mode principle the queue needs: compatible readers may coexist, conflicting modes may not, and multi-object locks should be acquired in a consistent order to avoid deadlocks ([PostgreSQL explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html)).

### Codex/Claude review findings that refine the design

1. The original plan's `strict: true` instruction was unsafe because it contradicted the owner-authorized, measured throughput decision in issue #1286. Structural safety does not require reversing it: `.github/workflows/guarded-migration-merge.yml:38-48` and `:59-71` already reject a migration PR whose head does not contain current `main`, before and while holding the exclusive merge lane.
2. “Existing global mutex” must name the actual primitive so a fresh implementer does not invent another one: `MUTEX_REF`, `acquireMutex`, `createRefWithReadback`, and `requireOwnedRef` are the one implementation to extend and test.
3. A work contract is authoritative only when a dispatcher publishes it before execution. A worker may submit completion evidence against the exact hash, but may not publish a broader replacement contract.
4. Core coordination activation and the optional Supabase pilot solve different problems. The first must proceed after Steps 1-6; pilot expansion waits independently for Step 7 evidence and never blocks the core rollout.
5. A later forward migration does not make an earlier successful completion false. An optional `invalidates` or `supersedes` pointer can warn reviewers, but must remain advisory and must never automatically unsatisfy dependencies.
6. Three lanes renewing every ten minutes create at most 18 ref writes per hour. That is not a material GitHub-rate-limit risk at the current cap; existing bounded retry and fail-closed behavior remains sufficient. Reassess only if the lane cap changes.

## 7. Approaches considered and rejected

1. **Rejected: make the shared-db orchestrator dispatch every kind of work in this repository.** This contradicts Albert's 2026-08-21 ruling. The orchestrator owns database structure and schema only. Repo maintenance, documentation, security settings, source work, application data, and curated Master Data use their own governed sessions.
2. **Rejected: enable Claude Agent Teams as the migration-author control plane.** The feature is experimental and session-local; task status and resumption can lag. Repository safety must work identically for Claude, Codex, or a human operator.
3. **Rejected: let multiple agents run `supabase db push` against the same target.** Supabase explicitly recommends one remote deployer at a time. Parallelism stops before shared preview or production.
4. **Rejected: replace the shared preview with one Supabase branch per pull request.** Per-PR branches are useful for early isolation but cannot prove integration against the exact shared preview environment and history used for production rehearsal.
5. **Rejected: infer every read dependency from SQL.** Static parsing cannot safely resolve dynamic SQL, search paths, indirect function calls, or data-coupled migrations. The plan adds explicit read declarations and limited validation; it does not claim perfect inference.
6. **Rejected: remove `objects:` immediately.** Open issues, active claims, scripts, and documentation use it today. A compatibility window treats legacy `objects:` as `writes:` and makes new writes explicit without invalidating active work.
7. **Rejected: treat a closed dependency issue as success.** Closure can mean cancellation, return, duplicate, failure, or manual cleanup. Success requires typed evidence.
8b. **Rejected on 2026-08-23: heartbeat-renewed leases.** Renewal moves the exclusive ref's SHA, which `releaseOwnedRef` and every calling workflow use as the release key, so the first heartbeat would strand the lane. A heartbeat write outside `MUTEX_REF` could also overwrite an incremented generation, creating the split ownership the fence exists to stop. Live GitHub run state already provides the liveness signal. See Step 6.
8. **Rejected: recover a stale lease solely because its clock expired.** TTL-only takeover can overlap an old holder. Recovery requires live terminal GitHub-run proof, grace time, unchanged generation, and a global-mutex-serialized update.
9. **Rejected: store the coordination trace in one mutable Markdown or JSON file.** Parallel sessions would conflict on it. Append-only GitHub issue/PR comments are the durable event log; reports are derived.
10. **Rejected: require provider-specific hooks as the enforcement point.** Claude hooks and Codex instructions may improve behavior, but repository scripts and required CI checks are the authority.
11. **Rejected: create a dummy production schema object to test the Supabase branch pilot.** The pilot waits for the next genuine, additive, low-risk migration and adds no fake business object.
12. **Rejected: restore `required_status_checks.strict: true` as part of this plan.** Issue #1286 records why Albert deliberately disabled it and defines the separate evidence threshold for reconsideration. The required guarded migration merge already closes the structural stale-base window without restarting every PR's complete check suite.
13. **Rejected: add a second current-`main` proof to the lease library.** The guarded merge workflow already performs the proof twice, including while the merge lane is held. Duplicate implementations would drift and disagree.
14. **Rejected: let an executing agent publish or broaden its own work contract.** Self-issued scope is not a control. The dispatcher publishes first; the worker can only execute within and report against that immutable contract.
15. **Rejected: make core activation wait for the optional Supabase pilot.** A suitable real migration may not arrive for months. The core contract/claim rollout proceeds independently; pilot expansion remains opt-in and evidence-gated.
16. **Rejected: make `invalidates` mandatory or automatically blocking.** Forward corrections preserve the historical truth that earlier work succeeded, and semantic invalidation is domain specific. An optional advisory link is useful; an automatic “un-success” rule is not.
17. **Rejected: exempt documentation PRs by adding workflow `paths:` filters.** Issue #1286 and the repository's incident history show that required checks can remain pending or reuse stale repository-wide verdicts when a workflow does not run. The contract workflow runs for every PR; zero-database work uses a minimal contract instead.

## 8. Design decisions already made

### Locked decisions — do not relitigate

1. **2026-08-21 owner ruling:** the shared-db orchestrator handles database structure and schema only. It must not implement or dispatch repository-maintenance work.
2. GitHub issues, PRs, refs, and checks remain the durable coordination control plane. **Authority lives in refs; comments are a log.** Issue comments are editable and every session shares one GitHub identity, so a comment can record a decision but can never establish one.
3. A maximum of three unrelated migration authors remains in force.
4. The shared preview, guarded merge, and production promotion remain serialized.
5. Legacy `objects:` means `writes:` during a documented compatibility window; it never means read-only.
6. Conflict matrix: write/write blocks; write/read blocks in either direction; read/read does not block.
7. All database dependency keys remain normalized, schema-qualified object identities and are sorted before multi-object comparison or acquisition.
8. A dependency is satisfied only by a validated typed completion record, not by issue state alone.
9. Agent work contracts and completion reports use **one** versioned JSON schema validated by hand-rolled repository code with no new dependency. Prose remains explanatory, not authoritative.
10. Coordination events are append-only GitHub comments covering state transitions only. No shared mutable trace file, and no periodic renewal events.
11. **Superseded on 2026-08-23.** Exclusive stages carry **no lease duration and no heartbeat**. Liveness is a live GitHub Actions run query at decision time; recovery still requires a 10-minute grace after that run is conclusively terminal. The prior 30-minute/10-minute values were removed because renewal moved the ref SHA that `releaseOwnedRef` and every calling workflow key on, which would have made a lane permanently unreleasable, and because a heartbeat write without the mutex could overwrite an incremented generation. See Step 6.
12. A lease generation is monotonic. Every side-effect preflight must present holder ID plus generation, and every exclusive-ref mutation must hold `MUTEX_REF`. A recovered lease increments generation, fencing the prior holder. Release keys on holder plus generation, never on the acquisition SHA.
13. Recovery never proceeds while the recorded GitHub Actions run is queued, in progress, unreadable, or not conclusively terminal.
14. **Deferred on 2026-08-23.** The per-PR Supabase branch pilot prevents no failure mode in §1 and is split to a follow-up issue. It remains opt-in and additive-only if resumed, and would supplement, never replace, the shared preview rehearsal. It is not part of this plan's definition of done.
15. No purchase, plan upgrade, or new paid Supabase feature is authorized by this plan. If Branching would cost money or is unavailable, produce the readiness report and stop the pilot as blocked.
16. The two already-built guard contexts must become required. Preserve `required_status_checks.strict: false` and all other current protection fields. Issue #1286 alone governs whether the strict setting is reconsidered; this plan neither changes its criteria nor claims they have been met.
17. The dispatcher publishes the work contract to a create-if-absent Git ref before the worker's first branch commit. The worker may not replace or broaden it; changed scope requires the dispatcher to publish a new contract at a new generation. **This is ordering and non-overwrite protection, not proof of identity** — all sessions share one GitHub identity, so this layer is a cooperative protocol unless `--publish-contract` is restricted to a distinct workflow token.
18. Core guard activation and compatibility retirement depend on Steps 1-6, not on the Supabase pilot. With the pilot deferred, Steps 1-6, 8A, and 9 are the whole plan.
19. Optional completion-record `invalidates` or `supersedes` pointers are advisory audit signals. They never erase a successful historical record and never automatically block a dependency.
20. **Added 2026-08-23, scope corrected after GLM-5.3 review.** GitHub fencing cannot reach a running database session. Preview and production applies take a registered Postgres advisory lock and fail closed if it is held. This prevents two concurrent live applies. It does **not** on its own close the dying-backend window, because a lock on the applier's own connection dies with that connection; that window is bounded by the 10-minute recovery grace. Fully closing it requires a session-pinned applier — an open judgment in Step 6. Do not claim the stronger guarantee anywhere.
21. **Added 2026-08-23.** This plan cites code by function name. Line numbers are never authoritative; re-anchor on current `origin/main` before editing.

### Open implementation judgments — decide using these criteria

1. **Module extraction boundary.** Keep `manage-migration-author-lanes.mjs` as the CLI entrypoint. Extract parsing, contract, dependency, lease, or event helpers only when a phase would otherwise make the main file difficult to test. New modules go under `scripts/lib/` and remain dependency-free Node ESM.
2. **GitHub comment location.** Prefer the original work issue for dispatch/completion events and the PR for review/merge/rehearsal events. Every event must carry `work_issue`, and events written to a PR must also carry `pr` and `head_sha`, so one audit can join them.
3. **Supabase pilot integration.** Prefer the official GitHub Branching integration if it is already available and produces the `Supabase Preview` check. Use the CLI/API only if the integration cannot meet the exact verification gates without new paid access.

## 9. Numbered implementation plan

### Phase 0 — correct authority and enforce existing guards

#### Step 1 — lock the orchestrator boundary and finish the two existing required checks

**Change:**

- Update `AGENTS.md` §0.0-C and §12.1 so the orchestrator accepts, dispatches, reviews, merges, and promotes only structural/schema work. State that non-structural work is performed by separately started repository/application/source/governance sessions and is never an orchestrator assignment.
- Update `docs/agents/section-4-anti-collision-rules.md` so `repo-maintenance`, `documentation`, and `security-settings` are visible to audits but carry no orchestrator action.
- In `scripts/manage-migration-author-lanes.mjs`, replace the ambiguous `fork` exit **for `repo-maintenance`, `documentation`, and `security-settings` only** with explicit destinations. Keep `structural -> orchestrator`; use `repo-session` and `return-to-owner` as internal audit outcomes. Do not change the public `work_type` or `route` values unless a test proves a compatibility need.
- **Leave `curated-master-data` exactly as it is: `fork`.** Albert's 2026-08-21 ruling was that *this repository-maintenance plan* is not orchestrator work. It did not change how curated Master Data loads are routed, and §6.4 still governs them inside this repository. Do not introduce a `curated-governance` outcome and do not move Master Data off the orchestrator's dispatch path. If that change is wanted, ask Albert for a separate explicit ruling first.
- Update `buildDynamicQueues` output headings so repo maintenance is reported as `OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION`, not a worklist for the orchestrator.
- Update `scripts/manage-migration-author-lanes.test.mjs` and queue-audit fixtures for every work type/status/route combination.
- Re-read branch protection with:

  ```powershell
  gh api repos/u2giants/shared-db/branches/main/protection
  ```

- Add `scripts/update-required-checks.mjs` and `scripts/update-required-checks.test.mjs`. The CLI reads the live `required_status_checks` document, forms an exact set union, prints a dry-run diff by default, and applies only with `--apply`. It must use GitHub's narrow required-status-checks endpoint rather than rewriting the full branch-protection object, preserve the live `strict` value byte-for-value, reject removal/rename, and fail closed on empty or incomplete input.
- Use that tested CLI to add `Orchestrator marker guard` and `Cancelled work guard` without removing or renaming any current context. Preserve `required_status_checks.strict: false`, force-push, deletion, admin-enforcement, and every unrelated protection field. Read the full protection document back and save a redacted verification artifact under `docs/verification/`.
- In that evidence artifact, cite issue #1286 and `.github/workflows/guarded-migration-merge.yml:38-48,59-71`. State plainly that `strict: false` is owner-authorized for throughput and that the required guarded migration merge already proves structural PRs contain current `main` immediately before merge. Do not add a second implementation of that proof.
- Update `docs/owner-rulings.md:799-836` so it preserves the dated 2026-08-06/14 account, then records the later 2026-08-19 issue #1286 ruling, current `strict: false` state, measured reason, and exact reconsideration criterion. Remove only the stale instruction that strict mode is currently immutable; retain the fact that it was previously enabled.
- Rewrite the two misleading comments that still tie sibling-collision safety to `strict: true`: the header comment in `.github/workflows/pr-object-collision.yml` and the corresponding comment block in `scripts/check-pr-object-collisions.mjs`. Both currently claim the collision check is only reliable because branch protection requires an up-to-date branch. Replace that with the accurate statement: the collision check is a **detector**; the required **re-check** for migration PRs is `guarded-migration-merge.yml`, which re-runs collision and lease validation on a head that already contains current `main`; non-migration PRs are auto-authorized by `migration-author-lease.yml`; and `strict: false` is the owner-authorized issue #1286 state, not drift. Leaving this text in place is what produced the original unsafe version of this step, and it will produce it again.
- Update `plan_orchestrator-workflow-gaps.md` STATUS/evidence for B1 and C2 only after the live readback proves both contexts are required, and replace its stale `strict: true` execution assumption at lines 503-506 with the issue #1286 rule plus the guarded-merge proof.

**Behavior when done:** a repo-maintenance issue cannot be interpreted as orchestrator work, and a PR cannot merge while either existing guard is red. Structural migrations retain the existing guarded-merge current-`main` proof without forcing every unrelated PR to restart all checks after each merge.

**Dependencies:** none. Do this first because every later phase relies on the corrected authority boundary and branch protection.

**Verification gate — you'll know it worked when:** `node --test scripts/update-required-checks.test.mjs scripts/manage-migration-author-lanes.test.mjs` exits 0; the dry run shows exactly two added contexts and no other field change; `node scripts/manage-migration-author-lanes.mjs --queue-audit` labels documentation/repo maintenance as outside the orchestrator with no dispatch instruction; the live protection JSON contains both exact context names in addition to the nine contexts observed on 2026-08-21; `required_status_checks.strict` remains `false`; `Migration guarded merge authorization` remains required; and `rg -n "strict: true|strict.*stays.*true" docs/owner-rulings.md plan_orchestrator-workflow-gaps.md` returns only clearly dated historical text, never a current instruction.

**Fresh-session cut:** stop after this PR is merged. Confirm issue #1366 remains open, update this STATUS table with the merge SHA and verification artifact, then start Phase 1 in a fresh worktree.

### Phase 1 — model conflicts and prerequisites correctly

#### Step 2 — add read/write claims with backward compatibility

**Change:**

- Extend `parseQueueScope` in `scripts/manage-migration-author-lanes.mjs` to parse `writes:` and `reads:` lists in addition to legacy `objects:`.
- Reject a scope that mixes `objects:` and `writes:`. Interpret legacy `objects:` as `writes:` and return `{ writes, reads, legacyObjects }` internally.
- Structural work must have at least one write. Non-structural work must not declare database reads or writes in `db-work-scope`; a read-only schema inspection does not need a claim.
- Replace `overlaps(a, b)` with a pure conflict function implementing: `A.writes ∩ (B.writes ∪ B.reads)` or `B.writes ∩ A.reads`. Sort and de-duplicate normalized keys before comparison.
- Update `claimBody`, `parseAuthorLease`, `acquireAuthorLane`, renewal, expansion, reversion, supersession, and release code to carry reads and writes. Keep `--objects` as a deprecated alias for `--writes` until Step 8's exact retirement gate is satisfied: zero open legacy issues/claims plus at least 14 days of documentation/examples using `writes:`. Refuse using both fields.
- Update `scripts/check-dispatch-collision.mjs` and `scripts/check-migration-pr-lease.mjs` to compare the new claim shape. A migration's statically extracted changed objects are writes. Declared reads are authoritative dependencies that CI carries and compares; CI must not pretend it can prove the list complete.
- Add a pull-request template/checklist reminder that authors must declare indirect and semantic reads that static SQL extraction cannot see. A warning may compare parser-observed references with declarations, but it must never claim completeness or silently add inferred reads.
- Update `scripts/check-pr-object-collisions.mjs` to use the conflict matrix when PR metadata includes a linked claim. Preserve the existing SQL extraction fallback for legacy/open PRs.
- Update `docs/agents/section-4-anti-collision-rules.md` with the exact new scope and CLI examples.

**Behavior when done:** two agents may concurrently read the same dependency, but no agent may write an object another active task reads or writes. Legacy claims continue working as write claims.

**Dependencies:** Step 1 merged. This step touches the central parser and must not run in parallel with Steps 3-6.

**Verification gate — you'll know it worked when:** new tests prove read/read is parallel, write/read and write/write serialize in both directions, mixed legacy/new claims behave correctly, duplicate/unsorted keys normalize deterministically, `--objects` remains compatible, and `node --test scripts/check-pr-object-collisions.test.mjs scripts/check-dispatch-collision.test.mjs scripts/check-migration-pr-lease.test.mjs scripts/manage-migration-author-lanes.test.mjs` exits 0.

#### Step 3 — require dependency existence, acyclicity, and typed success

**Change:**

- Add pure dependency helpers under `scripts/lib/work-dependencies.mjs` if keeping them in `manage-migration-author-lanes.mjs` would couple GitHub reads to queue ordering.
- Fetch every referenced dependency issue, not just the set of open issue numbers.
- Fail queue audit for a missing issue, self-dependency, duplicate dependency, unreadable issue, or directed cycle. Print the exact cycle path.
- Define **one** versioned `db-work-completion` record with outcomes: `merged`, `owner-ruling-recorded`, `returned`, `cancelled`, `superseded`, and `failed`. This is the single completion schema for the whole plan. Step 4 does not define a second one; it adds `contract_ref` and `contract_sha256` to this same object.
- Conditional-required fields, so that one schema can serve every outcome: `pr`, `merge_sha`, and `migration_versions` are required **only** when `outcome` is `merged`; `ruling_url` plus a resolving commit or issue-comment URL are required **only** when `outcome` is `owner-ruling-recorded`; a `reason` is required for every unsuccessful outcome. A schema that unconditionally requires `pr` cannot express an owner ruling, and an owner ruling is a legitimate dependency.
- A structural dependency is successful only when the completion record names the merged PR, merge SHA contained in `main`, and exact migration versions added by that PR.
- Reuse the squash-safe ancestry approach in `assertMergeCommitInMainHistory`: validate GitHub's actual PR `merge_commit_sha`, not the source branch head SHA.
- An owner-decision dependency is successful only when the record links the durable ruling and records the resolving commit or issue comment.
- `returned`, `cancelled`, `superseded`, and `failed` never satisfy a dependency. They produce a blocked reason that names the outcome.
- Permit optional `invalidates` and `supersedes` pointers in a successful completion record. They are explicit advisory metadata for a later corrective forward change. `--coordination-audit` surfaces them for reviewer judgment, but they never erase the earlier success, never auto-populate, and never automatically block downstream work.
- Add `--complete-work --issue <n> --report-file <path>` to the CLI. It validates the JSON, re-derives GitHub evidence, posts the immutable comment, reads it back, and only then permits the caller to close the issue.
- Update queue output to distinguish `waiting`, `invalid dependency`, and `dependency completed unsuccessfully`.

**Behavior when done:** no task starts merely because a dependency disappeared from the open-issue list.

**Dependencies:** Step 2 merged because dependency records reuse the normalized read/write identities. Step 4 later builds the broader provider-neutral contract/report layer on top of this typed completion primitive; Step 3 does not depend on Step 4.

**Verification gate — you'll know it worked when:** tests cover missing, self, duplicate, two-node and longer cycles; open prerequisites; manually closed prerequisites with no completion record; merge-commit and squash-commit structural success; owner-ruling success; each unsuccessful terminal outcome; an advisory invalidation/supersession pointer that preserves the earlier completion fact and does not auto-block. The live `--queue-audit` must remain read-only and fail closed on unreadable evidence.

**Fresh-session cut:** stop after Steps 2-3 are merged, update plan evidence, and re-read Phases 2-5 from current `main` before continuing.

### Phase 2 — make every agent assignment explicit and auditable

#### Step 4 — add the provider-neutral work contract and completion report

**Change:**

- Add `config/agent-work-contract.schema.json` and `config/agent-completion-report.schema.json` as **documentation of the field contract**, each with `schema_version: 1`.
- **Do not implement a JSON Schema draft 2020-12 meta-validator.** This repository has no root `package.json` and extracted modules must stay dependency-free Node ESM. `scripts/check-handoff-contract.mjs` already explains why it hand-rolls a small field parser rather than adding a library dependency; follow that precedent. Write explicit required-field, type, enum, and unknown-key checks in plain Node with exhaustive unit tests. A partial hand-rolled 2020-12 implementation that claims to be the standard is worse than an honest bespoke validator. If a real validator is later wanted, that is one pinned dependency and its own owner decision.
- Work contract required fields: `work_issue`, `work_type`, `route`, `goal`, `base_sha`, `dispatcher`, `worker`, `branch`, `worktree`, `allowed_paths`, `file_writes`, `db_reads`, `db_writes`, `prohibited_actions`, `required_checks`, `assumptions`, and `stop_conditions`.
- The completion report is **the Step 3 `db-work-completion` record extended**, not a second format. Step 4 adds these fields to it: `contract_ref`, `contract_sha256`, `head_sha`, `files_changed`, `db_reads`, `db_writes`, `checks` (command, exit code, evidence), `assumptions_resolved`, and `stop_conditions_hit`. Step 3's conditional-required rules for `pr`, `merge_sha`, `migration_versions`, and `ruling_url` carry over unchanged. Bump `schema_version` rather than forking the schema, and keep `--complete-work` as the single publishing command.
- Add `scripts/agent-work-contract.mjs` and `scripts/agent-work-contract.test.mjs`. Commands: `--validate-contract`, `--publish-contract`, and `--validate-completion`. **There is exactly one command that publishes a completion record: Step 3's `--complete-work`.** If `scripts/agent-work-contract.mjs` exposes `--publish-completion` at all, it must delegate to `--complete-work` or refuse; two publishing paths for one record is how divergent completion history gets created.
- **The contract's authority record is a Git ref, not an issue comment.** `--publish-contract` creates `refs/db-contracts/<work-issue>/<generation>` with the existing atomic create-if-absent primitive `createRefWithReadback`, pointing at a commit whose message carries the canonicalized contract and its `contract_sha256`. Create-if-absent means a second publication for the same generation fails rather than silently overwriting. Completion validation hashes and compares the **ref**, never the comment.
- **Why the comment cannot be the authority — do not revert this.** GitHub issue comments are editable and deletable, and every session in this repository authenticates and commits under the same `Albert Hazan <u2giants@users.noreply.github.com>` / shared `gh` identity. A worker can post a comment whose JSON names itself as dispatcher, and can edit a contract after the fact. Calling such a comment "immutable" is false. Mutex ownership, permanent version reservations, and review-failure evidence are already refs; this one must be too. **Be accurate about claims:** the permanent version reservation is a ref, but the active author *claim* is a GitHub issue whose editable body carries owner, branch, and objects. That body has the same mutability weakness under the shared identity, and this plan does not fix it — see §5 gap 17. Retain `comment.updated_at !== comment.created_at` as a weak secondary tamper signal only.
- **Generations are not dispatcher-only.** Create-if-absent protects each generation individually, but nothing under a shared identity stops a worker creating `refs/db-contracts/<issue>/2` itself. The "dispatcher publishes a new contract at a new generation" rule is a convention, not an enforced control. Say so in the code comments; an implementer must not believe generations are privileged.
- **Restricting `--publish-contract` to `github-actions[bot]` is not free.** It moves every dispatch out of a laptop CLI call and into a `workflow_dispatch` run. Weigh that cost before choosing it.
- **Residual limitation, to be stated plainly in §8 and in the final verification document.** A shared identity means a ref pin proves *ordering and non-overwrite*, not *who published*. It stops a worker from widening or backdating a contract; it does not cryptographically prove the publisher was the dispatcher. Full forgery resistance needs a distinct publisher identity — restricting `--publish-contract` to a workflow token such as `github-actions[bot]`. Prefer that if it needs no new secret; otherwise record that this layer is a cooperative protocol against honest-but-mistaken agents and claim nothing more.
- The dispatching authority publishes the contract before the worker starts: the structural orchestrator for structural work, or the separately started repo/application/source/governance session that owns non-structural work. `--publish-contract` must verify the issue route, exact current `base_sha`, and that the named worker branch is absent or still points exactly at `base_sha`; then it creates the contract ref and reads it back before the worker is released to edit. The issue comment is posted as a human-readable copy of the same canonicalized JSON.
- **Record the remaining time-of-check gap rather than papering over it.** "Branch absent or still at `base_sha`" proves only that the branch did not exist *on GitHub* at publication. A worker can commit locally, publish, then push; Git commit timestamps are author-controlled and prove nothing. The ref pin bounds the damage, because the contract cannot afterwards be widened to match what was built. Completion validation must not claim it proves work began after publication.
- The executing worker may never publish a replacement or broader contract for itself. If scope changes, it stops. The dispatcher publishes a new immutable contract against a new authorized base/branch, and execution restarts from that contract. Do not mutate or delete the earlier comment.
- Publish completion reports as immutable fenced JSON comments on the work issue. Hash the canonicalized contract and require the report to carry that exact hash. Completion validation must prove the contract **ref** predates the worker's first pushed commit after `base_sha`, the publisher matches the declared dispatcher, the branch history descends from the contract's base, and no later contract is silently substituted.
- For structural work, reconcile contract `db_reads/db_writes` with the active claim. For repo maintenance, require empty database sets unless the contract is explicitly read-only inspection.
- Require `files_changed` to be a subset of `allowed_paths` and `file_writes`. Refuse glob patterns that resolve outside the repository or are broad enough to include the repository root.
- Add `.github/workflows/agent-work-contract.yml` with no `paths:` filter. Initially run in report-only mode controlled by `config/agent-work-contract-activation.json`; it must still fail on malformed present contracts/reports.
- Provide a minimal zero-database contract example for documentation and repo-maintenance work. It still names dispatcher, worker, paths, checks, prohibitions, and stop conditions; it is not a workflow exemption.
- Update dispatch instructions in `docs/agents/section-4-anti-collision-rules.md` so Codex and Claude receive the same contract file/comment, not provider-specific prose. If a canonical skill outside this repository still contradicts the merged contract, open a separately owned `ai-devops` repository-maintenance task; do not make cross-repository skill edits in this plan's shared-db PR.

**Behavior when done:** a fresh agent receives its authority before work begins, can tell exactly what it owns, what it may touch, what it must prove, and when it must stop; it cannot grant itself more authority later; “done” is machine-checkable.

**Dependencies:** Step 3 merged. Do not add a required context until the compatibility audit in Step 8.

**Verification gate — you'll know it worked when:** schema tests reject missing fields, unknown fields, path escapes, SHA mismatches, undeclared changed files, database-set mismatches, missing evidence, false success after a stop condition, worker-self-publication, a contract posted after branch work began, publisher/dispatcher mismatch, and worker scope broadening; valid dispatcher-issued Codex, Claude, human-worker, and zero-database fixtures normalize to the same canonical JSON.

#### Step 5 — record lifecycle events and add coordination evaluation scenarios

**Change:**

- Add `config/db-coordination-event.schema.json`, `scripts/db-coordination-events.mjs`, and `scripts/db-coordination-events.test.mjs`.
- Event fields: `schema_version`, `event_id`, `event_type`, `timestamp`, `work_issue`, optional `claim_issue`, optional `pr`, `head_sha`, `actor`, `provider`, `holder_id`, `generation`, `db_reads`, `db_writes`, `result`, and `evidence_urls`.
- Supported event types: `contract_published`, `contract_superseded`, `dispatched`, `claim_acquired`, `claim_renewed`, `claim_expanded`, `review_started`, `review_completed`, `preview_acquired`, `preview_released`, `merge_acquired`, `merge_released`, `production_acquired`, `production_released`, `recovery_started`, `recovery_completed`, `work_completed`, `work_cancelled`, and `work_returned`. A `contract_superseded` event is valid only before new execution begins and points to both contract refs and hashes.
- **No stage-heartbeat events.** `preview_renewed` was dropped along with Step 6's heartbeat. **Keep `claim_renewed`:** author-claim renewal is existing, retained functionality (`renewExpiredClaim`, CLI `--renew-claim`, `claim-lease-renewal` owner commits) that Step 2 explicitly preserves. Dropping it would leave the audit vocabulary unable to express a transition the CLI still performs. A 10-minute renewal cadence would bury the issue timeline that `--coordination-audit` exists to make readable. Emit events for acquire, release, recovery, dispatch, completion, cancellation, and return only.
- Use the same hand-rolled validator approach as Step 4 for this schema. No JSON Schema meta-validator, no new dependency.
- Integrate event publication into successful state transitions only. Failed attempts may emit `result: refused` after the refusal is known, but must never look like ownership was acquired.
- Add `--coordination-audit --issue <n>` to rebuild the timeline from GitHub comments and refs, reject duplicate event IDs or impossible transitions, and output both human-readable text and stable JSON.
- Add fixtures under `scripts/fixtures/coordination-scenarios/` and a table-driven `scripts/coordination-scenarios.test.mjs` covering at least: dispatcher-issued contract before work; refused worker self-broadening; refused late contract; valid pre-work contract supersession; independent read/read work; write/read collision; competing writes; missing dependency; dependency cycle; closed-without-proof; cancellation; malformed completion report; advisory invalidation/supersession; and a fully successful end-to-end flow.
- **Lease scenarios are deliberately excluded from this step.** `stale lease while run active`, `stale lease after terminal grace`, and `old-generation write` require `scripts/lib/exclusive-lease.mjs`, which Step 6 creates. Placing them here would make Step 5 unmergeable and would falsify Step 8A's claim to depend only on Steps 1-6. They appear in Step 6's verification gate instead. Design the scenario table so Step 6 can append rows without restructuring it.
- Add the new suites to `.github/workflows/tools-offline-tests.yml` and the existing migration-author/collision workflow jobs that consume the same functions.

**Behavior when done:** a reviewer can reconstruct what happened without reading agent transcripts, and regressions are caught by repeatable scenarios rather than anecdotes.

**Dependencies:** Step 4 merged. Event publication may be added in report-only mode before Step 6 uses it for leases.

**Verification gate — you'll know it worked when:** every scenario has an expected accept/refuse decision, event sequence, and reason; `node --test scripts/agent-work-contract.test.mjs scripts/db-coordination-events.test.mjs scripts/coordination-scenarios.test.mjs` exits 0; and an audit of a fixture produces byte-stable JSON.

**Fresh-session cut:** stop after Steps 4-5 are merged and the report-only workflow has run successfully on at least one normal documentation PR and one structural test fixture.

### Phase 3 — make exclusive stages recoverable without split ownership

#### Step 6 — make exclusive stages recoverable and fenced, without heartbeats

**Change:**

- Add lease parsing/formatting helpers under `scripts/lib/exclusive-lease.mjs` and tests under `scripts/lib/exclusive-lease.test.mjs`.
- Replace the unstructured exclusive owner commit message with a versioned metadata block carrying: `kind`, `holder_id`, `github_run_id`, `github_run_attempt`, `owner`, `pr`, `head_sha`, `migration_versions`, `acquired_at`, and monotonic `generation`.
- **Preserve mutex-recovery compatibility in the same pull request as the format change.** `recoverStaleAuthorMutex` refuses to free any mutex whose owner commit message does not match its recognized-coordination-lock pattern (`/^db-coordination (?:author-acquisition|preview|merge|production|claim-…)\b/`). A new metadata block that does not match would make a crash *during* `acquireExclusive` — mutex held, exclusive ref possibly created — permanently unrecoverable by `.github/workflows/recover-author-mutex.yml`. Keep the recognized `db-coordination <kind>` prefix as the first line of the new block, or extend the pattern; then add a regression test proving a mutex owned by an exclusive-lease commit is still recoverable.
- **Preserve `MUTEX_RECOVERY_ACTIVE_REF`.** `acquireMutex` deliberately refuses while a recovery is in progress. Any new code path that takes the mutex inherits that refusal; do not bypass it and do not introduce a second recovery marker.
- Preserve the Git ref names in `EXCLUSIVE_REFS`; changing ref identity would create a second door.

**No heartbeat, and no lease clock as a safety input.**

- **Do not add `--renew-exclusive`, `lease_duration_seconds`, or `renewed_at`.** The previous revision specified a 30-minute lease renewed every 10 minutes. That is unsafe and unnecessary here, for three verified reasons:
  1. **It would make lanes permanently unreleasable.** `releaseOwnedRef` compares the ref's current SHA against the SHA captured at acquisition, and every calling workflow stashes that acquisition SHA at lock time (`guarded-migration-merge.yml`, `shared-supabase-migrations.yml`). A heartbeat moves the ref SHA, so the first renewal would cause release to be refused and the stage to stay locked — the exact failure this step exists to prevent.
  2. **It would introduce the split-ownership window fencing is meant to close.** `updateRef` PATCHes with `force=true` and no expected-SHA; there is no Git-level compare-and-swap. A heartbeat that writes the ref without holding `MUTEX_REF` can overwrite a recovery that already incremented `generation`.
  3. **It buys no liveness signal GitHub does not already give.** The calling workflows already pass `--owner "github-actions:${GITHUB_RUN_ID}"` (Step 6 is what persists it as `github_run_id`; today the owner-commit message does not record it), apply jobs already cap at 90 minutes, and recovery is already forbidden while the recorded run is active. Under that rule a clock cannot fire while the job lives, so the heartbeat's only function would be to stop a 30-minute clock from looking stale during a legitimate 90-minute apply. If `--assert-exclusive` then treated clock expiry as failure, a dead background renewer would fail a healthy production apply; if it ignored the clock, the duration would be dead code.
- **Liveness is a live query, not a stored timestamp.** Recovery reads `GET /repos/{owner}/{repo}/actions/runs/{github_run_id}` at decision time and inspects both `status`/`conclusion` and the current latest `run_attempt`. Never trust the attempt recorded in the lease blob: a re-run reuses `GITHUB_RUN_ID`, so a stored attempt can make a live run look completed.

**Mutex discipline and release keying.**

- `acquireExclusive` allocates generation 1 for a new ref, or the prior generation plus 1 for a proven recovery, under the existing tested global acquisition mutex: `MUTEX_REF`, `acquireMutex`, `createRefWithReadback`, and `requireOwnedRef` in `scripts/manage-migration-author-lanes.mjs`. Extend this one primitive; do not create another lock.
- **Every acquire, assert, recover, and release of an exclusive ref takes `MUTEX_REF` first, then calls `requireOwnedRef` against the exclusive ref's *current* SHA.** Because there is no Git compare-and-swap, the mutex is the only thing making these operations atomic.
- **Release keys off `holder_id` + `generation` read back at release time, not the acquisition SHA.** Update the calling workflows accordingly so they no longer stash and replay `ownerSha`.
- Add CLI operations `--assert-exclusive` and `--recover-exclusive`. Recovery changes holder, increments generation, and records the prior owner SHA.
- Before every side-effecting preview, merge, or production command, run `--assert-exclusive` against the exact current ref, holder, generation, PR, head SHA, target, and migration versions.
- **Specify the local-acquire case explicitly.** `acquireExclusive` is a public CLI, so a laptop acquire has no GitHub run to prove terminal. A lease with no `github_run_id` is **not eligible for `--recover-exclusive` at all**; only the recorded owner may release it, exactly as today. Do not invent a sentinel run id.

**The database fence GitHub cannot provide.**

- **Add a Postgres advisory lock at apply time.** A GitHub token cannot interrupt SQL already executing on Supabase, so recovery after a `cancelled` run plus grace still races a backend whose session has not yet ended; the next holder may then push migrations against the same target. Generation tokens cannot fence that — they fence GitHub, not the database.
- Register one advisory lock key for preview/production applies in `docs/advisory-lock-registry.md`, take it with `pg_try_advisory_lock` at apply start, and **fail closed** if it is already held.
- **Be precise about what this does and does not buy — do not overstate it in the final verification document.** A lock taken on the applier's own connection is released the instant that connection dies, which is exactly when the dying-holder race opens. So this lock reliably prevents **two concurrent live applies**; it does **not** by itself close the dying-backend window. That window is *bounded* by the 10-minute recovery grace, not eliminated.
- **Closing it properly is a larger change than it looks, and is an explicit open judgment.** `supabase db push` runs as a subprocess opening its own database sessions, so a lock held on a separate workflow connection does not cover the DDL. Genuinely fencing the DDL means pinning the lock to the session that executes it — replacing or wrapping `db push` with a session-pinned applier. Decide during Step 6 whether that is worth it. If it is not, ship the defense-in-depth lock and **say plainly that the residual window is grace-bounded**.
- Note two registry constraints before choosing a key: `docs/advisory-lock-registry.md` makes `pg_*_advisory_xact_lock` the default and requires a documented reason for a session-scoped lock, and the ColdLion precedent holds its lock *inside* the writing function's own transaction — which is the pattern that actually works, and the reason a workflow-side lock is weaker. A session-scoped lock taken through the transaction pooler (port 6543) is also unreliable.
- Recovery itself stays GitHub-only, as designed.

- **Release now needs `MUTEX_REF`, so it inherits the recovery refusal.** `acquireMutex` refuses while a mutex recovery is active. A healthy lane therefore cannot be released for the duration of an author-mutex recovery. That is acceptable and brief, but state it in the CLI's error text so an operator is not left guessing.
- **`EXCLUSIVE_REFS` shares one ref across `preview`, `preview-recovery`, and `preview-rehearsal`.** The new metadata block must record the exact `kind`, or a recovery cannot tell what it is fencing.

**Recovery preconditions** (all must hold): the recorded GitHub run is `completed` with a terminal conclusion on live query; no later active attempt or run exists for the same holder/PR/head; a 10-minute grace has elapsed since that terminal state; the current ref and generation still match what recovery read; and the global mutex grants the transition. If GitHub run state is unreadable, refuse. If the old holder later calls assert or release, refuse it because its generation is stale.

- Add an operator workflow `.github/workflows/recover-exclusive-db-lane.yml` using `workflow_dispatch`, least-privilege permissions, a dry-run default, and an explicit `apply_recovery=true` input. It must never contact the database; it only repairs the GitHub coordination ref after all proofs pass.
- Preserve `.github/workflows/guarded-migration-merge.yml` as the single current-`main` proof for structural merges. Lease assertions fence ownership; they do not duplicate branch ancestry or collision checks.

**Behavior when done:** crashed jobs no longer hold a stage forever; delayed old jobs cannot continue after a takeover at the GitHub layer; and two live applies cannot run against one target concurrently. The dying-backend overlap window is bounded by the 10-minute grace rather than eliminated, unless the session-pinned applier in the bullets above is also adopted.

**Dependencies:** Steps 4-5 merged. Do not combine this with another edit to `manage-migration-author-lanes.mjs`.

**Verification gate — you'll know it worked when:** tests prove wrong-holder refusal, wrong-generation refusal, active-run refusal, stale-`run_attempt` refusal, unreadable-run refusal, pre-grace refusal, successful terminal recovery, atomic mutex contention, a mutex owned by an exclusive-lease commit still being recoverable by `recoverStaleAuthorMutex`, refusal to recover a lease with no `github_run_id`, release by `holder_id`+`generation` succeeding, release by a stale acquisition SHA failing, pre-write assertion, and `pg_try_advisory_lock` failing closed when already held. Existing preview/merge/production acquisition and the guarded-merge current-`main` proof stay green.

**Fresh-session cut:** stop after the lease PR is merged. Do not activate recovery until one dry-run inspects each live ref kind and confirms no active stage is misclassified.

### Phase 4 — add isolated early database validation

#### Step 7 — pilot one opt-in Supabase pull-request branch (DEFERRED)

> **Deferred on 2026-08-23.** This step prevents no failure mode listed in §1 — it is a
> product experiment in early testing, not a coordination fix. Keeping it inside this
> plan makes issue #1366 unclosable while waiting for a suitable real migration that may
> never arrive. **Split it to a follow-up issue and close #1366 after Steps 8A and 9.**
> The text below is retained unchanged so the follow-up issue can adopt it verbatim; its
> blocked/waiting language was already correct. Nothing in Steps 1-6, 8A, or 9 depends
> on it.

**Change:**

- Write `docs/verification/supabase-pr-branch-readiness-<date>.md` from read-only checks: whether Supabase Branching is available, whether the GitHub integration is installed, what check name it emits, how branch refs are obtained, billing impact, seed behavior, and whether historical migrations can replay successfully.
- If enabling Branching requires a purchase or plan upgrade, stop and mark this step blocked; do not enable it.
- Add repository label `supabase-pr-branch-pilot` and repository variable `SUPABASE_PR_BRANCH_PILOT_ENABLED=false` first.
- Add `.github/workflows/supabase-pr-branch-pilot.yml`, triggered only for migration PRs carrying the pilot label and only when the variable is `true`. Use least privilege and a 90-minute timeout.
- The workflow waits for the official Supabase preview branch to become healthy, proves the branch is isolated and associated with the exact PR/head SHA, lists applied migrations, runs the repository's structural and behavior tests, and uploads a redacted evidence artifact containing PR, head SHA, branch ref, migration versions, and test results.
- Never put licensed data or secret values in the branch seed. Use the existing approved seed only after reviewing it for suitability; otherwise run schema-only with synthetic fixtures.
- Select the next genuine additive, low-risk migration whose prerequisites are already on `main`. Do not use a destructive migration, a historical out-of-order migration, a bulk load, or a migration whose success depends on production-only rows.
- The pilot passes only if: the branch is created for the exact PR; all migrations replay sequentially; the proposed migration and tests pass; closing/reopening behavior is understood; the branch is deleted or automatically cleaned up; and the normal shared-preview rehearsal still passes after merge.
- Keep the feature opt-in after the first pilot. Expansion to all additive migration PRs occurs only in Step 8B after a written go/no-go result. Step 8A core activation never waits for this pilot.

**Behavior when done:** one migration receives early isolated validation without contaminating the persistent shared preview, and the shared preview remains the final rehearsal.

**Dependencies:** Step 6 merged and activated. The pilot may wait for a suitable real migration; do not invent one. While it waits, proceed with Step 8A core activation. Keep Step 7 open and record whether it is waiting for a real candidate, blocked by unavailable/paid prerequisites, or completed with evidence.

**Verification gate — you'll know it worked when:** the readiness report proves prerequisites, the pilot PR has a successful isolated-branch artifact tied to its head SHA, the branch is cleaned up, and the same migration subsequently passes the existing post-merge shared-preview rehearsal.

**Fresh-session cut:** stop after publishing the pilot go/no-go evidence. A separate fresh session decides pilot rollout using Step 8B; it does not rely on the pilot session's memory. This cut does not delay Step 8A.

### Phase 5 — activate, document, and close safely

#### Step 8 — activate core guards and independently decide pilot expansion

##### Step 8A — core activation and compatibility retirement

**Change:**

- Audit every open PR and issue for legacy `objects:` use, missing agent contracts, and missing completion reports. Save only counts and public GitHub identifiers; do not copy licensed content.
- Keep active legacy structural claims valid until they release. Do not rewrite another session's claim.
- Set the activation commit/date in `config/agent-work-contract-activation.json` only after all active PRs are either compatible or explicitly grandfathered by exact PR number and head SHA.
- Make `Agent work contract` a required `main` context using the same read-modify-write/readback discipline as Step 1. Do not remove any existing required context.
- Remove the `--objects` CLI alias only after the queue audit finds zero open legacy issues/claims and documentation/examples have used `writes:` for at least 14 days. Until then, keep the alias with a visible warning.
- Run the end-to-end coordination audit for one successful structural work item and one refused conflict scenario.

**Behavior when done:** the core protocol is enforced without stranding existing work or silently dropping required checks, regardless of whether a suitable Supabase pilot migration has appeared.

**Dependencies:** Steps 1-6 complete. Step 7 is explicitly not a dependency for Step 8A.

**Verification gate — you'll know it worked when:** live branch protection includes all old contexts plus the new contract context; no non-grandfathered PR bypasses the contract; zero active claims depend on removed syntax; and both coordination audits validate.

##### Step 8B — optional Supabase pilot expansion decision (DEFERRED with Step 7)

> **Deferred on 2026-08-23** alongside Step 7. Move this to the same follow-up issue. Step 8A does not wait for it, and #1366 does not stay open for it.

**Change:**

- If Step 7 has completed a real pilot, review its committed evidence. Expand the pilot only if it reduced early failures, introduced no ledger ambiguity, cleaned up reliably, and did not weaken the final shared-preview gate.
- If Step 7 is waiting for a suitable migration, leave the label/variable opt-in and disabled by default. Do not delay Step 8A, do not invent a migration, and do not claim the pilot is complete.
- If Step 7 is blocked by unavailable or paid prerequisites, leave the feature disabled and retain the readiness evidence. Do not purchase or upgrade anything.
- Record the go/no-go/waiting result in the plan STATUS evidence and final verification document. A “no” or “waiting” result is not failure of the core coordination rollout.

**Behavior when done:** optional isolated-branch testing expands only after evidence, while core agent coordination and the shared-preview safety gate operate independently.

**Dependencies:** Step 7 evidence for a go/no-go decision. Step 8B may occur before or after Step 8A and never blocks Step 8A.

**Verification gate — you'll know it worked when:** the committed decision names the exact Step 7 artifact; the repository variable and workflow state match that decision; the shared-preview rehearsal remains required; and a waiting or blocked pilot is reported honestly rather than treated as core-rollout failure.

#### Step 9 — reconcile documentation, evidence, handoff, and issue state

**Change:**

- Update this STATUS table immediately after each prior step, citing a commit SHA and a verification artifact or exact rerunnable command.
- Update `AGENTS.md`, `docs/agents/section-4-anti-collision-rules.md`, `docs/owner-rulings.md`, and any shared-db skills whose trigger reaches this workflow. Remove superseded language instead of leaving competing instructions. Specifically: `docs/agents/section-4-anti-collision-rules.md` still advertises the Supabase per-PR branch pilot as part of this plan — point it at the follow-up issue instead.
- Update `plan_orchestrator-workflow-gaps.md` only for items actually proven complete; retain historical reasoning.
- Add a final `docs/verification/multi-agent-coordination-hardening-<date>.md` containing branch-protection readback (including preserved `strict: false`), test commands/results, compatibility audit, contract-authority evidence, lease recovery dry-runs, pilot state/decision, and remaining limitations.
- Run the full relevant offline suites and all repository guards affected by the changes.
- Open the follow-up issue carrying deferred Steps 7 and 8B, and link it from #1366 as successor work rather than as a blocker.
- Close issue #1366 through the validated completion command once Steps 1-6, 8A, and this step are merged and live, and delete this handoff in that closing PR. Do not hold #1366 open for the deferred Supabase pilot. Keep this plan as durable architecture unless the repository's completed-plan policy explicitly archives it.

**Behavior when done:** a fresh session sees one consistent operating contract and can prove the rollout from committed evidence.

**Dependencies:** Documentation reconciliation can proceed after Steps 1-6 and Step 8A. Issue #1366 closes once Steps 1-6, 8A, and this step are merged and live. The deferred Supabase pilot (Steps 7/8B) moves to its own follow-up issue and never holds #1366 open.

**Verification gate — you'll know it worked when:** this plan's STATUS table points to evidence for every completed row; affected required CI is green; and `git status --short` is empty after merge. Issue #1366 has a valid successful completion record, is closed, and this handoff is deleted in the closing PR; a separate follow-up issue exists for the deferred pilot and is linked as successor work, not as a blocker.

## 10. Tests required

### Existing suites that must stay green

```powershell
node --test scripts/manage-migration-author-lanes.test.mjs
node --test scripts/check-pr-object-collisions.test.mjs
node --test scripts/check-dispatch-collision.test.mjs
node --test scripts/check-migration-pr-lease.test.mjs
node --test scripts/check-orchestrator-marker.test.mjs
node --test scripts/check-cancelled-work.test.mjs
node --test scripts/check-handoff-contract.test.mjs scripts/report-stale-handoffs.test.mjs
node --test scripts/check-sql.test.mjs
```

Run `bash scripts/check-sql.sh` from Git Bash or the CI Linux environment when a phase touches migration guards. On Windows, do not replace operating-system binaries to make Bash scripts run.

### New behavior tests

- `scripts/manage-migration-author-lanes.test.mjs`
  - every work type maps to an owner outside or inside the orchestrator correctly;
  - all read/write conflict-matrix combinations;
  - legacy `objects:` compatibility and mixed-field refusal;
  - deterministic normalization/order;
  - dependency graph success/failure cases;
  - exclusive lease acquire/assert/recover/release and all stale-owner negatives (no renew: heartbeats were removed on 2026-08-23);
  - release by `holder_id`+`generation` succeeds; release by the acquisition SHA fails;
  - a mutex owned by an exclusive-lease commit is still recoverable by `recoverStaleAuthorMutex`;
  - a lease with no `github_run_id` is refused for `--recover-exclusive`;
  - live `run_attempt` is queried, not read from the lease blob;
  - `pg_try_advisory_lock` fails closed when the apply lock is already held.
- `scripts/agent-work-contract.test.mjs`
  - required/unknown fields;
  - path containment and exact changed-file ownership;
  - contract hash and head SHA binding;
  - contract-ref creation before the first worker commit, and refusal of a second publication at the same generation;
  - worker self-publication, late publication, and scope-broadening refusal;
  - valid dispatcher-issued contract supersession before new execution begins;
  - database claim reconciliation;
  - stop-condition and required-evidence failures;
  - minimal zero-database documentation/repo-maintenance contract.
- `scripts/db-coordination-events.test.mjs`
  - schema validation;
  - duplicate IDs;
  - impossible transitions;
  - stable ordering and JSON output;
  - cross-issue/PR join behavior;
  - advisory invalidation/supersession that preserves the earlier success record.
- `scripts/coordination-scenarios.test.mjs`
  - every scenario named in Step 5, each with an exact expected decision and trace.
- Workflow contract tests
  - no `paths:` filter on required repo-wide guards;
  - exact unique check names;
  - least-privilege permissions;
  - timeout present;
  - negative-path tests execute before the live guard;
  - preview/merge/production workflows assert the current lease immediately before side effects.
- `scripts/update-required-checks.test.mjs`
  - adds only `Orchestrator marker guard` and `Cancelled work guard` by exact set union;
  - preserves `required_status_checks.strict: false`, every pre-existing context, admin enforcement, force-push, and deletion settings;
  - fails closed on empty, unreadable, or incomplete protection input.

### Live read-only verification

```powershell
gh api repos/u2giants/shared-db/branches/main/protection
node scripts/manage-migration-author-lanes.mjs --queue-audit
git worktree list --porcelain
git status --short
```

Treat exit code 2 or unreadable/empty remote output as unknown/failure, never success.

## 11. Constraints, standing rules, and gotchas

1. **Owner ruling:** the orchestrator handles structure/schema only. Repository-maintenance sessions are started and owned separately.
2. Every implementation session uses its own isolated worktree from current `origin/main`; never implement in `C:\repos\shared-db`.
3. Shared-db changes use a branch and pull request. Stage only owned files. Before the first commit, `git var GIT_COMMITTER_IDENT` must show `Albert Hazan <u2giants@users.noreply.github.com>`.
4. No schema or database row write is authorized merely because this plan discusses database coordination.
5. Before any future preview or production write, prove the exact target using the repository's existing §4.2 procedure.
6. Preview, merge, and production remain one at a time. Per-PR branches are early tests only.
7. A permanent migration version is never reused, even if an author lease expires or a branch is abandoned.
8. Expiry is not enough to free an author claim. The fenced recovery design in Step 6 applies to exclusive stage leases, not permanent version reservations. Author-claim renewal (`renewExpiredClaim`, `--renew-claim`) is separate, still supported, and unaffected by the removal of stage heartbeats.
9. GitHub empty output is unknown. Existing incidents show server-side label filters and empty CLI output can lie.
10. Required workflows must not use `paths:` filters when their verdict can be invalidated by another PR or repository-wide state.
11. Never overwrite the required-status-check list. Always read, merge exact additions, write, and read back.
12. Do not log access tokens, database URLs with credentials, licensed rows, or secret-bearing commands.
13. The control-plane fence cannot interrupt a database command already executing outside GitHub Actions. Therefore recovery requires conclusive terminal run state and grace, not just token mismatch.
14. Static SQL dependency extraction is a backstop for honest authors, not a security boundary. Explicit declarations remain required.
15. Claude Agent Teams and Codex subagents may be used for independent read-only research, competing diagnoses, test execution, or independent reviews. They must not independently acquire or write the same database stage.
16. Start with no more than three parallel specialists. This matches the repository's three author lanes and the practical guidance from both Codex and Claude; more agents increase coordination cost without creating more safe database capacity.
17. Do not edit another session's handoff, active branch, worktree, claim, or migration.
18. Preserve `required_status_checks.strict: false`. Issue #1286 is the owner-authorized throughput decision and contains its own reconsideration threshold. This plan is not evidence that the threshold was met.
19. The structural current-`main` proof lives in `.github/workflows/guarded-migration-merge.yml`; do not duplicate it in lease code or assume `pull_request.base.sha` is the branch point. `scripts/check-pr-object-collisions.mjs:1063-1078` documents the correct `headSha...baseRef` comparison.
20. The worker never authors or widens its own contract. Scope changes return to the dispatcher and restart against a newly published contract.
21. Static inference cannot prove read completeness. The PR template/checklist must ask for indirect function, view, trigger, policy, and data-coupled reads; warnings are evidence, never automatic authority.
22. Step 8A core activation proceeds after Steps 1-6. It never waits for Step 7's optional real-migration pilot.

## 12. Access and environment

### GitHub

- Repository: `https://github.com/u2giants/shared-db`.
- `gh` was authenticated for read/write issue operations and branch-protection reads on 2026-08-21.
- Branch-protection mutation requires repository-admin permission. If the active credential cannot perform it, stop that sub-step and give Albert the exact missing permission/action; do not weaken the plan, remove other contexts, or change `strict: false`.
- Main is protected; force pushes and deletions were disabled in the 2026-08-21 readback.

### Supabase

- Production project ref: `qsllyeztdwjgirsysgai`.
- Preview project ref: read GitHub repository variable `PREVIEW_PROJECT_REF`; never hard-code a remembered value.
- Workflows receive `SUPABASE_ACCESS_TOKEN` through GitHub secrets. Never print it.
- If local secret access becomes necessary, use 1Password vault `vibe_coding` and discover the existing descriptive item by repository/project name. Do not invent an item title and do not copy values into chat, files, command arguments, logs, commits, or PRs.
- Per-PR branch identifiers and credentials are unique. Evidence may record a project/branch ref but never a database password or service-role key.

### Local runtime

- Node.js 22 is the workflow baseline.
- PowerShell is the local shell; GitHub Actions uses Ubuntu for repository guards.
- No root `package.json` exists. Run Node test files directly with `node --test`.
- Worktree setup pattern:

  ```powershell
  git -C C:\repos\shared-db fetch origin main
  git -C C:\repos\shared-db worktree add C:\repos\shared-db-worktrees\<unique-slug> -b codex/<unique-branch> origin/main
  ```

- Each phase must confirm its target worktree path does not already exist before creation.

## 13. Definition of done, risks, rollback, and open questions

### Definition of done

- [ ] The orchestrator boundary is explicit in code and docs: structural/schema only.
- [ ] `Orchestrator marker guard` and `Cancelled work guard` are required on `main`, `required_status_checks.strict` remains `false` per issue #1286, and live readback proves no prior context or protection field was removed.
- [ ] Read/write claims and the conflict matrix are active with a safe legacy window.
- [ ] Dependencies require existence, no cycles, and typed success evidence.
- [ ] Provider-neutral work contracts are dispatcher-issued before execution, cannot be widened by the worker, and completion reports are validated and required after a compatibility rollout.
- [ ] Coordination lifecycle events and deterministic scenario tests are green.
- [ ] Exclusive preview/merge/production leases fence old holders and recover only after live terminal-run proof plus grace. They deliberately do not renew.
- [ ] Core guard activation completed after Steps 1-6.
- [ ] Exclusive stages carry no heartbeat; release keys on holder plus generation; a mutex-owned exclusive-lease commit is still recoverable by `recoverStaleAuthorMutex`.
- [ ] Preview and production applies take a registered Postgres advisory lock and fail closed when it is held, and the verification document states its real scope: concurrent live applies prevented, dying-backend overlap grace-bounded rather than eliminated.
- [ ] Work contracts are pinned to create-if-absent Git refs, and the plan states the shared-identity limitation plainly rather than claiming forgery resistance.
- [ ] One completion schema serves every outcome, with `pr` required only for `merged`.
- [ ] No code citation in this plan or in the shipped code comments depends on a line number.
- [ ] The Supabase pilot is split to its own follow-up issue and is not a completion requirement for #1366.
- [ ] The shared preview remains the final rehearsal and no concurrent shared-target push is possible.
- [ ] Each phase has a merged PR, green required CI, updated STATUS evidence, and a clean worktree.
- [ ] Final verification evidence is committed. Issue #1366 is closed and the handoff retired once Steps 1-6, 8A, and 9 are merged and live; the deferred pilot does not hold either open.

### Principal risks and rollback

1. **Branch-protection overwrite or owner-ruling reversal.** Risk: an API update removes existing contexts or silently flips `strict: false` back to `true`. Prevention: snapshot, exact set union, explicit preservation of `strict: false`, and full readback. Rollback: restore every accidentally changed field from the snapshot while retaining only the intended added contexts; if that cannot be done atomically, block merges until protection matches the snapshot plus those additions.
2. **Active claim incompatibility.** Risk: a parser change strands an in-flight migration. Prevention: legacy `objects:` as writes and exact active-claim audit. Rollback: revert parser/CLI PR while leaving permanent version refs untouched.
3. **False dependency block.** Risk: valid work cannot dispatch because evidence parsing is too strict. Prevention: pure fixtures for each completion type and human-readable reasons. Rollback: revert enforcement to report-only; never treat closure alone as success.
4. **Split ownership during recovery.** Risk: old and new stage holders both write. Prevention: live terminal-run proof, grace, generation, global-mutex-serialized transitions (there is no Git compare-and-swap), and pre-write assertion. Rollback: disable the recovery workflow and return to explicit manual release; do not delete a live ref.
5. **Recovery misjudges a live run.** Risk: a healthy long apply is taken over, or a dead one is never freed. Prevention: liveness is a live `GET /actions/runs/{id}` at decision time including the current `run_attempt`, never a stored clock or a stored attempt; recovery is refused while the run is active or unreadable. Rollback: disable the recovery workflow and release manually with holder plus generation proof.
6. **Supabase branch migration-history mismatch.** Risk: historical/out-of-order migrations make a per-PR branch fail for repository-history reasons. Prevention: readiness replay and additive-only pilot. Rollback: disable the pilot variable and retain the shared-preview process unchanged.
7. **Provider drift.** Risk: Codex or Claude changes subagent behavior. Prevention: contracts, CI, refs, and traces are provider-neutral. Provider hooks remain optional reinforcement.
8. **Self-authorized scope.** Risk: a worker publishes a broad contract after seeing the changes it wants to make. Prevention: create-if-absent contract ref, pre-work publication, canonical hash, base/branch proof, and late-contract refusal. **Known limitation:** all sessions share one GitHub identity, so this bounds widening and backdating but does not prove publisher identity unless `--publish-contract` is restricted to a workflow token. Rollback: return contract enforcement to report-only while preserving all refs and comments; never accept the worker's broader contract.
9. **Pilot stalls core safety.** Risk: no suitable migration appears. Prevention: Step 8A depends only on Steps 1-6. Rollback: keep the pilot disabled/waiting; do not reverse core activation.

### Genuine open questions and decision criteria

1. **Is Supabase Branching available without a purchase on the current project?** Unknown, and now **out of scope** — it moves to the deferred Step 7 follow-up issue. This plan does not authorize spending.
1b. **Can `--publish-contract` be restricted to a distinct publisher identity such as `github-actions[bot]` without introducing a new secret?** Decide during Step 4. If yes, contract authority becomes genuinely forgery-resistant. If no, ship the ref pin and record in §8 that this layer is a cooperative protocol — do not overstate it.
2. **Which authenticated identity can add the two required GitHub contexts?** Unknown until Step 1 attempts the read-modify-write. If the current repo-maintenance session lacks admin permission, Albert must perform or authorize that exact context-only change. Do not change `strict: false`.
3. **Can the official Supabase integration expose enough branch identity to bind evidence to the exact PR/head?** Decide from the readiness report. If not, use the supported CLI/API only when it adds no paid requirement and can keep credentials in GitHub secrets.

No business-rule decision is otherwise open. The conflict matrix, orchestrator boundary, `strict: false` preservation, dispatcher contract authority, compatibility policy, recovery proof, and pilot deferral are locked above. There are no lease timings: heartbeats and lease durations were removed on 2026-08-23.

---

## Mandatory implementation-plan self-audit

### Checklist result

- [x] All 13 required sections are present.
- [x] The business goal appears first and includes “if a step conflicts with the goal, the goal wins.”
- [x] A fresh session has repository purpose, trigger, exact current state, sources, decisions, commands, files, dependencies, and stopping rules.
- [x] Rejected approaches and failed routing are recorded with reasons.
- [x] Every numbered step names concrete files/functions and has a verification gate.
- [x] Locked and open decisions are labeled.
- [x] The out-of-scope list is explicit.
- [x] Tests are named by file and behavior.
- [x] Paths, URLs, refs, issue number, base SHA, environment names, and terms are defined or linked.
- [x] Secrets are referenced by location only, never by value.
- [x] Definition of done includes commit, push, PR/CI, live setting verification, evidence, handoff, and issue closure.
- [x] This plan links to its new handoff, and the handoff links back. Root `HANDOFF.md` is untouched.

### Required audit questions

1. **Could a brand-new AI session with no project knowledge and no context from the planning conversation execute this plan without asking Albert anything?**

   **Yes.** Sections 1-4 explain the business outcome, repository, trigger, and boundaries. Sections 5-8 carry exact current evidence, research, dead ends, and locked decisions. Section 9 specifies files, functions, order, dependencies, phase cuts, and verification. Sections 10-13 define tests, rules, access, completion, rollback, and objective stop conditions. The two external capability checks have pre-decided blocked outcomes, so the implementer need not guess or purchase anything.

2. **Does the plan carry every piece of background, nuance, and reasoning currently known, including what was ruled out and why?**

   **Yes.** Section 3 records the corrected owner ruling, mistaken orchestrator route, and three-round Claude/Codex review. Sections 5-6 record the exact repository gaps, existing controls, official research, and why `strict: false` is intentional. Section 7 preserves every important rejection, including restoring strict mode, duplicate stale-base logic, worker-self-issued scope, pilot/core coupling, mandatory invalidation, and documentation path filters. Section 8 records the resulting locked decisions.

3. **Is the ultimate goal clear enough for a correct judgment call if an implementation step proves wrong?**

   **Yes.** Section 1 defines the business result and explicitly makes the goal controlling. Sections 4 and 8 establish the non-negotiable safety boundaries, while Section 13 provides rollback and decision criteria. An implementer can change a technical detail while preserving serialization, proof, provider neutrality, and the structure-only orchestrator boundary.

**Self-audit result: PASS.**
