# Implementation plan — provider-neutral multi-agent database coordination hardening

**Repository:** `u2giants/shared-db`

**Tracking issue:** [#1366](https://github.com/u2giants/shared-db/issues/1366)

**Created:** 2026-08-21

**Work class:** repository maintenance; this plan does not authorize a database structure or data change

**Session handoff:** [`HANDOFF.d/2026-08-21T2223Z-edge-dev-codex-agent-coordination-plan.md`](HANDOFF.d/2026-08-21T2223Z-edge-dev-codex-agent-coordination-plan.md)

## STATUS — read this before doing anything

| Step | Outcome | State | Evidence |
|---|---|---|---|
| 1 | Lock the orchestrator boundary and finish the two existing required-check gaps | ⬜ open | Not started |
| 2 | Replace flat database-object claims with compatible read/write claims | ⬜ open | Not started |
| 3 | Make issue dependencies prove successful completion | ⬜ open | Not started |
| 4 | Add a provider-neutral agent work contract and completion report | ⬜ open | Not started |
| 5 | Add durable coordination events and repeatable failure scenarios | ⬜ open | Not started |
| 6 | Add heartbeat, terminal-state recovery and fencing to exclusive stage leases | ⬜ open | Not started |
| 7 | Pilot isolated Supabase branches for early pull-request checks | ⬜ open | Not started |
| 8 | Activate the new guards and retire compatibility paths safely | ⬜ open | Not started |
| 9 | Reconcile documentation, evidence, handoff and issue state | ⬜ open | Not started |

**Fresh-session starting point:** Step 1. This plan-writing session changed documentation only. Before every later phase, start a fresh repository-maintenance session, re-read the remaining plan from that phase onward, and use an isolated worktree created from current `origin/main`.

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
- a pull request may receive an isolated early database test, while the existing shared preview remains the final integration rehearsal;
- GitHub will retain a reconstructable record of dispatch, claim, review, rehearsal, merge, promotion, release, cancellation, and recovery.

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

That ruling is locked. The current code still describes `repo-maintenance`, `documentation`, and `security-settings` as work the orchestrator should `FORK` (`scripts/manage-migration-author-lanes.mjs:165-182`) and reports all non-structural issues to the orchestrator (`scripts/manage-migration-author-lanes.mjs:264-278`). Step 1 corrects that mismatch before adding more coordination machinery.

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
- Add renewable, fenced exclusive leases and safe stale recovery.
- Pilot one opt-in Supabase pull-request branch on the next suitable additive migration.
- Keep the shared preview as the final integration and production rehearsal gate.
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

## 5. Current state of the code and operations

### What already works and must be preserved

1. **Three author lanes, one shared mutable stage at a time.** `docs/agents/section-4-anti-collision-rules.md:9-12` allows up to three unrelated migration authors and keeps preview, merge, and production serial. Lines 14-30 require an isolated worktree, exact object claim, and permanent 14-digit version before a migration file is opened.
2. **GitHub is the coordination store.** `scripts/manage-migration-author-lanes.mjs:127-142` maps preview, merge, and production to Git refs. `acquireExclusive` begins at line 1409 and release is routed through `releaseOwnedRef` at line 1544.
3. **Queue scopes are machine readable.** `parseQueueScope` at `scripts/manage-migration-author-lanes.mjs:203-241` parses `status`, `work_type`, `route`, `priority`, `depends_on`, and `objects`.
4. **The queue serializes exact object overlap.** `buildDynamicQueues` at `scripts/manage-migration-author-lanes.mjs:249-301` groups overlapping `objects` and fills no more than three lanes.
5. **Pull requests receive a second collision check.** `.github/workflows/pr-object-collision.yml` runs `scripts/check-pr-object-collisions.test.mjs`, `scripts/check-dispatch-collision.test.mjs`, `scripts/manage-migration-author-lanes.test.mjs`, and then the live read-only checker.
6. **Migration pull requests require a live branch-bound claim.** `.github/workflows/migration-author-lease.yml` runs the claim tests and `scripts/check-migration-pr-lease.mjs`.
7. **Handoffs have a checked contract.** `.github/workflows/handoff-contract-guard.yml` validates only handoff files touched by the pull request and fails closed when issue state is unreadable.
8. **The two missing checks are already built.** `.github/workflows/orchestrator-marker-guard.yml` and `.github/workflows/cancelled-work-guard.yml` each contain their own negative-path tests. The unresolved work is branch-protection enforcement, not checker implementation.

### Exact gaps

1. **Orchestrator scope is too broad in prose and output.** `NON_STRUCTURAL_EXITS` labels repo maintenance and documentation as `fork` at `scripts/manage-migration-author-lanes.mjs:171-182`; `buildDynamicQueues` sends all non-structural issues to `notOrchestratorWork` at lines 264-274. This invited the routing mistake that triggered the owner correction.
2. **Object claims have no access mode.** `parseQueueScope` collects only `objects` at lines 208-214 and returns only `objects` at line 241. Queue overlap at lines 284-297 treats all contact as identical.
3. **Dependencies mean only “not currently open.”** `buildDynamicQueues` creates an `openNumbers` set at line 250 and blocks only dependencies found in that set at lines 280-281. A missing issue, a manually closed failure, a cancelled issue, or a dependency cycle is not rejected.
4. **Static collision detection admits semantic blind spots.** `scripts/check-pr-object-collisions.mjs:75-77` explicitly says that different named objects can still be coupled, such as a view and the function it calls.
5. **Exclusive stage locks have ownership but no renewable lease record.** `acquireExclusive` currently writes a commit message containing the stage, request, PR, and head SHA (`scripts/manage-migration-author-lanes.mjs:1409-1415`). It does not record holder run ID, acquire time, renew time, duration, or generation.
6. **Author lease expiry deliberately does not unlock.** `docs/agents/section-4-anti-collision-rules.md:188-193` makes expiry an audit warning only. That rule is correct for permanent migration versions and object ownership; it must not be casually copied into recoverable stage leases.
7. **Branch protection is incomplete and has drifted to non-strict.** A live read on 2026-08-21 returned nine required contexts but omitted `Orchestrator marker guard` and `Cancelled work guard`; it also returned `strict: false`. `plan_orchestrator-workflow-gaps.md:314-319` and `:382-385` already identify the missing contexts, while `.github/workflows/pr-object-collision.yml:24-27` explains why the collision guard depends on branches being up to date before merge. Because protection can drift, every implementation session must re-read it live.
8. **No provider-neutral completion contract exists.** Codex and Claude can each return summaries, but no repository guard checks that the assigned paths, required tests, database objects, stop conditions, and evidence were satisfied before completion.
9. **No single lifecycle trace exists.** State is reconstructable from issues, refs, PRs, workflows, and comments, but there is no validated event vocabulary or audit command covering an end-to-end work item.

### Current branch and deployment state when this plan was written

- Base commit: `36a04b2fc8905e61f3b9b3a7d3202d9ca4b3da2b` on `origin/main`.
- Plan branch: `codex/plan-agent-coordination-hardening` in isolated worktree `C:\repos\shared-db-worktrees\plan-agent-coordination`.
- Repository was clean before the plan files were created.
- No preview or production write was performed.
- Branch protection was read through `gh api`; no setting was changed.

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

## 7. Approaches considered and rejected

1. **Rejected: make the shared-db orchestrator dispatch every kind of work in this repository.** This contradicts Albert's 2026-08-21 ruling. The orchestrator owns database structure and schema only. Repo maintenance, documentation, security settings, source work, application data, and curated Master Data use their own governed sessions.
2. **Rejected: enable Claude Agent Teams as the migration-author control plane.** The feature is experimental and session-local; task status and resumption can lag. Repository safety must work identically for Claude, Codex, or a human operator.
3. **Rejected: let multiple agents run `supabase db push` against the same target.** Supabase explicitly recommends one remote deployer at a time. Parallelism stops before shared preview or production.
4. **Rejected: replace the shared preview with one Supabase branch per pull request.** Per-PR branches are useful for early isolation but cannot prove integration against the exact shared preview environment and history used for production rehearsal.
5. **Rejected: infer every read dependency from SQL.** Static parsing cannot safely resolve dynamic SQL, search paths, indirect function calls, or data-coupled migrations. The plan adds explicit read declarations and limited validation; it does not claim perfect inference.
6. **Rejected: remove `objects:` immediately.** Open issues, active claims, scripts, and documentation use it today. A compatibility window treats legacy `objects:` as `writes:` and makes new writes explicit without invalidating active work.
7. **Rejected: treat a closed dependency issue as success.** Closure can mean cancellation, return, duplicate, failure, or manual cleanup. Success requires typed evidence.
8. **Rejected: recover a stale lease solely because its clock expired.** TTL-only takeover can overlap an old holder. Recovery requires terminal GitHub-run proof, grace time, unchanged generation, and a compare-and-swap update.
9. **Rejected: store the coordination trace in one mutable Markdown or JSON file.** Parallel sessions would conflict on it. Append-only GitHub issue/PR comments are the durable event log; reports are derived.
10. **Rejected: require provider-specific hooks as the enforcement point.** Claude hooks and Codex instructions may improve behavior, but repository scripts and required CI checks are the authority.
11. **Rejected: create a dummy production schema object to test the Supabase branch pilot.** The pilot waits for the next genuine, additive, low-risk migration and adds no fake business object.

## 8. Design decisions already made

### Locked decisions — do not relitigate

1. **2026-08-21 owner ruling:** the shared-db orchestrator handles database structure and schema only. It must not implement or dispatch repository-maintenance work.
2. GitHub issues, PRs, refs, checks, and immutable comments remain the durable coordination control plane.
3. A maximum of three unrelated migration authors remains in force.
4. The shared preview, guarded merge, and production promotion remain serialized.
5. Legacy `objects:` means `writes:` during a documented compatibility window; it never means read-only.
6. Conflict matrix: write/write blocks; write/read blocks in either direction; read/read does not block.
7. All database dependency keys remain normalized, schema-qualified object identities and are sorted before multi-object comparison or acquisition.
8. A dependency is satisfied only by a validated typed completion record, not by issue state alone.
9. Agent work contracts and completion reports use versioned JSON validated by repository code. Prose remains explanatory, not authoritative.
10. Coordination events are append-only GitHub comments. No shared mutable trace file is introduced.
11. Exclusive stage leases use a 30-minute duration, renew at least every 10 minutes, and require a 10-minute grace period after the recorded GitHub run is terminal before recovery. These values are configuration constants with tests, not scattered literals.
12. A lease generation is monotonic. Every heartbeat and side-effect preflight must present holder ID plus generation. A recovered lease increments generation, fencing the prior holder.
13. Recovery never proceeds while the recorded GitHub Actions run is queued, in progress, unreadable, or not conclusively terminal.
14. The per-PR Supabase branch pilot is opt-in and additive-only. It supplements, never replaces, the shared preview rehearsal.
15. No purchase, plan upgrade, or new paid Supabase feature is authorized by this plan. If Branching would cost money or is unavailable, produce the readiness report and stop the pilot as blocked.
16. The two already-built guard contexts must become required and `required_status_checks.strict` must be restored to `true` before later coordination guards are activated.

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
- In `scripts/manage-migration-author-lanes.mjs`, replace the ambiguous `fork` exit for non-structural work with explicit destinations. Keep `structural -> orchestrator`; use `repo-session`, `curated-governance`, and `return-to-owner` as internal audit outcomes. Do not change the public `work_type` or `route` values unless a test proves a compatibility need.
- Update `buildDynamicQueues` output headings so repo maintenance is reported as `OUTSIDE ORCHESTRATOR — OWNED BY REPO SESSION`, not a worklist for the orchestrator.
- Update `scripts/manage-migration-author-lanes.test.mjs` and queue-audit fixtures for every work type/status/route combination.
- Re-read branch protection with:

  ```powershell
  gh api repos/u2giants/shared-db/branches/main/protection
  ```

- Add `Orchestrator marker guard` and `Cancelled work guard` to the existing required contexts without removing or renaming any current context. Set `required_status_checks.strict` to `true` so a PR must be current with `main` before its cross-PR collision verdict can authorize merge. Preserve force-push, deletion, and admin-enforcement settings. Use a read-modify-write operation, then read the full protection document back and save a redacted verification artifact under `docs/verification/`.
- Update `plan_orchestrator-workflow-gaps.md` STATUS/evidence for B1 and C2 only after the live readback proves both contexts are required.

**Behavior when done:** a repo-maintenance issue cannot be interpreted as orchestrator work, and a PR cannot merge while either existing guard is red.

**Dependencies:** none. Do this first because every later phase relies on the corrected authority boundary and branch protection.

**Verification gate — you'll know it worked when:** all queue tests pass; `node scripts/manage-migration-author-lanes.mjs --queue-audit` labels documentation/repo maintenance as outside the orchestrator with no dispatch instruction; and the live protection JSON contains both exact context names in addition to the nine contexts observed on 2026-08-21, with `required_status_checks.strict: true`.

**Fresh-session cut:** stop after this PR is merged. Confirm issue #1366 remains open, update this STATUS table with the merge SHA and verification artifact, then start Phase 1 in a fresh worktree.

### Phase 1 — model conflicts and prerequisites correctly

#### Step 2 — add read/write claims with backward compatibility

**Change:**

- Extend `parseQueueScope` in `scripts/manage-migration-author-lanes.mjs` to parse `writes:` and `reads:` lists in addition to legacy `objects:`.
- Reject a scope that mixes `objects:` and `writes:`. Interpret legacy `objects:` as `writes:` and return `{ writes, reads, legacyObjects }` internally.
- Structural work must have at least one write. Non-structural work must not declare database reads or writes in `db-work-scope`; a read-only schema inspection does not need a claim.
- Replace `overlaps(a, b)` with a pure conflict function implementing: `A.writes ∩ (B.writes ∪ B.reads)` or `B.writes ∩ A.reads`. Sort and de-duplicate normalized keys before comparison.
- Update `claimBody`, `parseAuthorLease`, `acquireAuthorLane`, renewal, expansion, reversion, supersession, and release code to carry reads and writes. Keep `--objects` as a deprecated alias for `--writes` for one compatibility phase; refuse using both.
- Update `scripts/check-dispatch-collision.mjs` and `scripts/check-migration-pr-lease.mjs` to compare the new claim shape. A migration's statically extracted changed objects are writes. Declared reads are authoritative dependencies that CI carries and compares; CI must not pretend it can prove the list complete.
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
- Define a versioned `db-work-completion` JSON comment with outcomes: `merged`, `owner-ruling-recorded`, `returned`, `cancelled`, `superseded`, and `failed`.
- A structural dependency is successful only when the completion record names the merged PR, merge SHA contained in `main`, and exact migration versions added by that PR.
- An owner-decision dependency is successful only when the record links the durable ruling and records the resolving commit or issue comment.
- `returned`, `cancelled`, `superseded`, and `failed` never satisfy a dependency. They produce a blocked reason that names the outcome.
- Add `--complete-work --issue <n> --report-file <path>` to the CLI. It validates the JSON, re-derives GitHub evidence, posts the immutable comment, reads it back, and only then permits the caller to close the issue.
- Update queue output to distinguish `waiting`, `invalid dependency`, and `dependency completed unsuccessfully`.

**Behavior when done:** no task starts merely because a dependency disappeared from the open-issue list.

**Dependencies:** Step 2 merged because dependency records will reuse normalized read/write identities and the provider-neutral report foundation.

**Verification gate — you'll know it worked when:** tests cover missing, self, duplicate, two-node and longer cycles; open prerequisites; manually closed prerequisites with no completion record; merged structural success; owner-ruling success; and each unsuccessful terminal outcome. The live `--queue-audit` must remain read-only and fail closed on unreadable evidence.

**Fresh-session cut:** stop after Steps 2-3 are merged, update plan evidence, and re-read Phases 2-5 from current `main` before continuing.

### Phase 2 — make every agent assignment explicit and auditable

#### Step 4 — add the provider-neutral work contract and completion report

**Change:**

- Add `config/agent-work-contract.schema.json` and `config/agent-completion-report.schema.json`, JSON Schema draft 2020-12, each with `schema_version: 1` and `additionalProperties: false` at every object layer.
- Work contract required fields: `work_issue`, `work_type`, `route`, `goal`, `base_sha`, `owner`, `branch`, `worktree`, `allowed_paths`, `file_writes`, `db_reads`, `db_writes`, `prohibited_actions`, `required_checks`, `assumptions`, and `stop_conditions`.
- Completion report required fields: `work_issue`, `contract_sha256`, `head_sha`, `files_changed`, `db_reads`, `db_writes`, `checks` (command, exit code, evidence), `assumptions_resolved`, `stop_conditions_hit`, `pr`, and `outcome`.
- Add `scripts/agent-work-contract.mjs` and `scripts/agent-work-contract.test.mjs`. Commands: `--validate-contract`, `--publish-contract`, `--validate-completion`, and `--publish-completion`.
- Publish contracts and reports as immutable fenced JSON comments on the work issue. Hash the canonicalized contract and require the report to carry that hash.
- For structural work, reconcile contract `db_reads/db_writes` with the active claim. For repo maintenance, require empty database sets unless the contract is explicitly read-only inspection.
- Require `files_changed` to be a subset of `allowed_paths` and `file_writes`. Refuse glob patterns that resolve outside the repository or are broad enough to include the repository root.
- Add `.github/workflows/agent-work-contract.yml` with no `paths:` filter. Initially run in report-only mode controlled by `config/agent-work-contract-activation.json`; it must still fail on malformed present contracts/reports.
- Update dispatch instructions in `docs/agents/section-4-anti-collision-rules.md` so Codex and Claude receive the same contract file/comment, not provider-specific prose. If a canonical skill outside this repository still contradicts the merged contract, open a separately owned `ai-devops` repository-maintenance task; do not make cross-repository skill edits in this plan's shared-db PR.

**Behavior when done:** a fresh agent can tell exactly what it owns, what it may touch, what it must prove, and when it must stop; “done” is machine-checkable.

**Dependencies:** Step 3 merged. Do not add a required context until the compatibility audit in Step 8.

**Verification gate — you'll know it worked when:** schema tests reject missing fields, unknown fields, path escapes, SHA mismatches, undeclared changed files, database-set mismatches, missing evidence, and false success after a stop condition; valid Codex-, Claude-, and human-authored fixtures normalize to the same canonical JSON.

#### Step 5 — record lifecycle events and add coordination evaluation scenarios

**Change:**

- Add `config/db-coordination-event.schema.json`, `scripts/db-coordination-events.mjs`, and `scripts/db-coordination-events.test.mjs`.
- Event fields: `schema_version`, `event_id`, `event_type`, `timestamp`, `work_issue`, optional `claim_issue`, optional `pr`, `head_sha`, `actor`, `provider`, `holder_id`, `generation`, `db_reads`, `db_writes`, `result`, and `evidence_urls`.
- Supported event types: `dispatched`, `claim_acquired`, `claim_renewed`, `claim_expanded`, `review_started`, `review_completed`, `preview_acquired`, `preview_renewed`, `preview_released`, `merge_acquired`, `merge_released`, `production_acquired`, `production_released`, `recovery_started`, `recovery_completed`, `work_completed`, `work_cancelled`, and `work_returned`.
- Integrate event publication into successful state transitions only. Failed attempts may emit `result: refused` after the refusal is known, but must never look like ownership was acquired.
- Add `--coordination-audit --issue <n>` to rebuild the timeline from GitHub comments and refs, reject duplicate event IDs or impossible transitions, and output both human-readable text and stable JSON.
- Add fixtures under `scripts/fixtures/coordination-scenarios/` and a table-driven `scripts/coordination-scenarios.test.mjs` covering at least: independent read/read work; write/read collision; competing writes; missing dependency; dependency cycle; closed-without-proof; cancellation; stale lease while run active; stale lease after terminal grace; old-generation write; malformed completion report; and a fully successful end-to-end flow.
- Add the new suites to `.github/workflows/tools-offline-tests.yml` and the existing migration-author/collision workflow jobs that consume the same functions.

**Behavior when done:** a reviewer can reconstruct what happened without reading agent transcripts, and regressions are caught by repeatable scenarios rather than anecdotes.

**Dependencies:** Step 4 merged. Event publication may be added in report-only mode before Step 6 uses it for leases.

**Verification gate — you'll know it worked when:** every scenario has an expected accept/refuse decision, event sequence, and reason; `node --test scripts/agent-work-contract.test.mjs scripts/db-coordination-events.test.mjs scripts/coordination-scenarios.test.mjs` exits 0; and an audit of a fixture produces byte-stable JSON.

**Fresh-session cut:** stop after Steps 4-5 are merged and the report-only workflow has run successfully on at least one normal documentation PR and one structural test fixture.

### Phase 3 — make exclusive stages recoverable without split ownership

#### Step 6 — add renewable, fenced exclusive leases

**Change:**

- Add lease parsing/formatting helpers under `scripts/lib/exclusive-lease.mjs` and tests under `scripts/lib/exclusive-lease.test.mjs`.
- Replace the unstructured exclusive owner commit message with a versioned metadata block carrying: `kind`, `holder_id`, `github_run_id`, `github_run_attempt`, `owner`, `pr`, `head_sha`, `migration_versions`, `acquired_at`, `renewed_at`, `lease_duration_seconds`, and monotonic `generation`.
- Preserve the Git ref names in `EXCLUSIVE_REFS`; changing ref identity would create a second door.
- `acquireExclusive` must allocate generation 1 for a new ref or the prior generation plus 1 for a proven recovery, under the existing global acquisition mutex.
- Add CLI operations `--renew-exclusive`, `--assert-exclusive`, and `--recover-exclusive`. Renewal preserves holder/generation and advances `renewed_at`; recovery changes holder, increments generation, and records the prior owner SHA.
- Change safe release to validate current `holder_id` plus `generation`, not the acquisition's original commit SHA, because heartbeats legitimately move the ref.
- Before every side-effecting preview, merge, or production command, run `--assert-exclusive` against the exact current ref, holder, generation, PR, head SHA, target, and migration versions.
- In `.github/workflows/shared-supabase-migrations.yml`, `.github/workflows/guarded-migration-merge.yml`, and `.github/workflows/preview-ledger-orphan-reconciliation.yml`, start a heartbeat after acquisition, renew every 10 minutes, stop it in `always()`, and release only with current ownership proof.
- Recovery preconditions: lease expired; recorded GitHub run is `completed`; conclusion is terminal; 10-minute grace elapsed; current ref and generation still match; target workflow has no later active run for the same holder/PR/head; and the global mutex grants the compare-and-swap transition.
- If GitHub run state is unreadable, refuse recovery. If the old holder later calls heartbeat, assert, or release, refuse it because its generation is stale.
- Add an operator workflow `.github/workflows/recover-exclusive-db-lane.yml` using `workflow_dispatch`, least-privilege permissions, a dry-run default, and an explicit `apply_recovery=true` input. It must never contact the database; it only repairs the GitHub coordination ref after all proofs pass.

**Behavior when done:** crashed jobs no longer hold a stage forever, but delayed old jobs cannot continue after a takeover.

**Dependencies:** Steps 4-5 merged. Do not combine this with another edit to `manage-migration-author-lanes.mjs`.

**Verification gate — you'll know it worked when:** tests prove heartbeat renewal, wrong-holder refusal, wrong-generation refusal, active-run refusal, unreadable-run refusal, pre-grace refusal, successful terminal recovery, compare-and-swap loss, stale release refusal, and pre-write assertion. Existing preview/merge/production acquisition tests must remain green. Run `node --test scripts/lib/exclusive-lease.test.mjs scripts/manage-migration-author-lanes.test.mjs scripts/coordination-scenarios.test.mjs` and workflow contract tests.

**Fresh-session cut:** stop after the lease PR is merged. Do not activate recovery until one dry-run inspects each live ref kind and confirms no active stage is misclassified.

### Phase 4 — add isolated early database validation

#### Step 7 — pilot one opt-in Supabase pull-request branch

**Change:**

- Write `docs/verification/supabase-pr-branch-readiness-<date>.md` from read-only checks: whether Supabase Branching is available, whether the GitHub integration is installed, what check name it emits, how branch refs are obtained, billing impact, seed behavior, and whether historical migrations can replay successfully.
- If enabling Branching requires a purchase or plan upgrade, stop and mark this step blocked; do not enable it.
- Add repository label `supabase-pr-branch-pilot` and repository variable `SUPABASE_PR_BRANCH_PILOT_ENABLED=false` first.
- Add `.github/workflows/supabase-pr-branch-pilot.yml`, triggered only for migration PRs carrying the pilot label and only when the variable is `true`. Use least privilege and a 90-minute timeout.
- The workflow waits for the official Supabase preview branch to become healthy, proves the branch is isolated and associated with the exact PR/head SHA, lists applied migrations, runs the repository's structural and behavior tests, and uploads a redacted evidence artifact containing PR, head SHA, branch ref, migration versions, and test results.
- Never put licensed data or secret values in the branch seed. Use the existing approved seed only after reviewing it for suitability; otherwise run schema-only with synthetic fixtures.
- Select the next genuine additive, low-risk migration whose prerequisites are already on `main`. Do not use a destructive migration, a historical out-of-order migration, a bulk load, or a migration whose success depends on production-only rows.
- The pilot passes only if: the branch is created for the exact PR; all migrations replay sequentially; the proposed migration and tests pass; closing/reopening behavior is understood; the branch is deleted or automatically cleaned up; and the normal shared-preview rehearsal still passes after merge.
- Keep the feature opt-in after the first pilot. Expansion to all additive migration PRs occurs only in Step 8 after a written go/no-go result.

**Behavior when done:** one migration receives early isolated validation without contaminating the persistent shared preview, and the shared preview remains the final rehearsal.

**Dependencies:** Step 6 merged and activated. The pilot may wait for a suitable real migration; do not invent one.

**Verification gate — you'll know it worked when:** the readiness report proves prerequisites, the pilot PR has a successful isolated-branch artifact tied to its head SHA, the branch is cleaned up, and the same migration subsequently passes the existing post-merge shared-preview rehearsal.

**Fresh-session cut:** stop after publishing the pilot go/no-go evidence. A separate fresh session decides rollout using the criteria in Step 8; it does not rely on the pilot session's memory.

### Phase 5 — activate, document, and close safely

#### Step 8 — activate required guards and retire compatibility paths

**Change:**

- Audit every open PR and issue for legacy `objects:` use, missing agent contracts, and missing completion reports. Save only counts and public GitHub identifiers; do not copy licensed content.
- Keep active legacy structural claims valid until they release. Do not rewrite another session's claim.
- Set the activation commit/date in `config/agent-work-contract-activation.json` only after all active PRs are either compatible or explicitly grandfathered by exact PR number and head SHA.
- Make `Agent work contract` a required `main` context using the same read-modify-write/readback discipline as Step 1. Do not remove any existing required context.
- Remove the `--objects` CLI alias only after the queue audit finds zero open legacy issues/claims and documentation/examples have used `writes:` for at least 14 days. Until then, keep the alias with a visible warning.
- Review the Supabase pilot evidence. Expand the pilot only if it reduced early failures, introduced no ledger ambiguity, cleaned up reliably, and did not weaken the final shared-preview gate. Otherwise leave it opt-in or disable the variable; do not remove the evidence.
- Run the end-to-end coordination audit for one successful structural work item and one refused conflict scenario.

**Behavior when done:** the new protocol is enforced without stranding existing work or silently dropping required checks.

**Dependencies:** Steps 1-7 complete or Step 7 explicitly blocked by unavailable/paid prerequisites with its readiness artifact committed.

**Verification gate — you'll know it worked when:** live branch protection includes all old contexts plus the new contract context; no non-grandfathered PR bypasses the contract; zero active claims depend on removed syntax; and both coordination audits validate.

#### Step 9 — reconcile documentation, evidence, handoff, and issue state

**Change:**

- Update this STATUS table immediately after each prior step, citing a commit SHA and a verification artifact or exact rerunnable command.
- Update `AGENTS.md`, `docs/agents/section-4-anti-collision-rules.md`, `docs/owner-rulings.md`, and any shared-db skills whose trigger reaches this workflow. Remove superseded language instead of leaving competing instructions.
- Update `plan_orchestrator-workflow-gaps.md` only for items actually proven complete; retain historical reasoning.
- Add a final `docs/verification/multi-agent-coordination-hardening-<date>.md` containing branch-protection readback, test commands/results, compatibility audit, lease recovery dry-runs, pilot decision, and remaining limitations.
- Run the full relevant offline suites and all repository guards affected by the changes.
- Close issue #1366 through the validated completion command only after every non-blocked requirement is merged and live. In the same final PR, delete this session's handoff file under the handoff successor rule. Keep this plan as durable architecture unless the repository's completed-plan policy explicitly archives it.

**Behavior when done:** a fresh session sees one consistent operating contract and can prove the rollout from committed evidence.

**Dependencies:** all prior steps.

**Verification gate — you'll know it worked when:** issue #1366 has a valid successful completion record and is closed; its handoff file is deleted in the closing PR; this plan's STATUS table points to evidence for every row; affected required CI is green; and `git status --short` is empty after merge.

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
  - exclusive lease acquire/renew/assert/recover/release and all stale-owner negatives.
- `scripts/agent-work-contract.test.mjs`
  - required/unknown fields;
  - path containment and exact changed-file ownership;
  - contract hash and head SHA binding;
  - database claim reconciliation;
  - stop-condition and required-evidence failures.
- `scripts/db-coordination-events.test.mjs`
  - schema validation;
  - duplicate IDs;
  - impossible transitions;
  - stable ordering and JSON output;
  - cross-issue/PR join behavior.
- `scripts/coordination-scenarios.test.mjs`
  - the twelve scenarios named in Step 5, each with an exact expected decision and trace.
- Workflow contract tests
  - no `paths:` filter on required repo-wide guards;
  - exact unique check names;
  - least-privilege permissions;
  - timeout present;
  - negative-path tests execute before the live guard;
  - preview/merge/production workflows assert the current lease immediately before side effects.

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
8. Expiry is not enough to free an author claim. The renewable/fenced recovery design in Step 6 applies to exclusive stage leases, not permanent version reservations.
9. GitHub empty output is unknown. Existing incidents show server-side label filters and empty CLI output can lie.
10. Required workflows must not use `paths:` filters when their verdict can be invalidated by another PR or repository-wide state.
11. Never overwrite the required-status-check list. Always read, merge exact additions, write, and read back.
12. Do not log access tokens, database URLs with credentials, licensed rows, or secret-bearing commands.
13. The control-plane fence cannot interrupt a database command already executing outside GitHub Actions. Therefore recovery requires conclusive terminal run state and grace, not just token mismatch.
14. Static SQL dependency extraction is a backstop for honest authors, not a security boundary. Explicit declarations remain required.
15. Claude Agent Teams and Codex subagents may be used for independent read-only research, competing diagnoses, test execution, or independent reviews. They must not independently acquire or write the same database stage.
16. Start with no more than three parallel specialists. This matches the repository's three author lanes and the practical guidance from both Codex and Claude; more agents increase coordination cost without creating more safe database capacity.
17. Do not edit another session's handoff, active branch, worktree, claim, or migration.

## 12. Access and environment

### GitHub

- Repository: `https://github.com/u2giants/shared-db`.
- `gh` was authenticated for read/write issue operations and branch-protection reads on 2026-08-21.
- Branch-protection mutation requires repository-admin permission. If the active credential cannot perform it, stop that sub-step and give Albert the exact missing permission/action; do not weaken the plan or remove other contexts.
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
- [ ] `Orchestrator marker guard` and `Cancelled work guard` are required on `main`, `required_status_checks.strict` is `true`, and live readback proves no prior context was removed.
- [ ] Read/write claims and the conflict matrix are active with a safe legacy window.
- [ ] Dependencies require existence, no cycles, and typed success evidence.
- [ ] Provider-neutral work contracts and completion reports are validated and required after a compatibility rollout.
- [ ] Coordination lifecycle events and deterministic scenario tests are green.
- [ ] Exclusive preview/merge/production leases renew, fence old holders, and recover only after terminal proof plus grace.
- [ ] One suitable additive migration has completed the opt-in Supabase branch pilot, or a committed readiness report proves the feature is unavailable/paid and records the blocked state without purchasing it.
- [ ] The shared preview remains the final rehearsal and no concurrent shared-target push is possible.
- [ ] Each phase has a merged PR, green required CI, updated STATUS evidence, and a clean worktree.
- [ ] Final verification evidence is committed; issue #1366 is successfully completed and closed; the open handoff is retired in the closing PR.

### Principal risks and rollback

1. **Branch-protection overwrite.** Risk: an API update removes existing required contexts. Prevention: snapshot, set union, explicit `strict: true`, readback. Rollback: restore every accidentally changed field from the snapshot while retaining the intended added contexts and `strict: true`; if that cannot be done atomically, block merges until protection is correct.
2. **Active claim incompatibility.** Risk: a parser change strands an in-flight migration. Prevention: legacy `objects:` as writes and exact active-claim audit. Rollback: revert parser/CLI PR while leaving permanent version refs untouched.
3. **False dependency block.** Risk: valid work cannot dispatch because evidence parsing is too strict. Prevention: pure fixtures for each completion type and human-readable reasons. Rollback: revert enforcement to report-only; never treat closure alone as success.
4. **Split ownership during recovery.** Risk: old and new stage holders both write. Prevention: terminal-run proof, grace, generation, mutex/CAS, and pre-write assertion. Rollback: disable the recovery workflow and return to explicit manual release; do not delete a live ref.
5. **GitHub Actions heartbeat failure.** Risk: healthy long work appears expired. Prevention: lease is not recoverable while its run is active, regardless of time. Rollback: renew manually with the same holder/generation after proof.
6. **Supabase branch migration-history mismatch.** Risk: historical/out-of-order migrations make a per-PR branch fail for repository-history reasons. Prevention: readiness replay and additive-only pilot. Rollback: disable the pilot variable and retain the shared-preview process unchanged.
7. **Provider drift.** Risk: Codex or Claude changes subagent behavior. Prevention: contracts, CI, refs, and traces are provider-neutral. Provider hooks remain optional reinforcement.

### Genuine open questions and decision criteria

1. **Is Supabase Branching available without a purchase on the current project?** Unknown until Step 7's read-only readiness check. If no, the correct result is a blocked pilot with evidence; this plan does not authorize spending.
2. **Which authenticated identity can add required GitHub contexts?** Unknown until Step 1 attempts the read-modify-write. If the current repo-maintenance session lacks admin permission, Albert must perform or authorize that exact settings change. No other technical design changes.
3. **Can the official Supabase integration expose enough branch identity to bind evidence to the exact PR/head?** Decide from the readiness report. If not, use the supported CLI/API only when it adds no paid requirement and can keep credentials in GitHub secrets.

No business-rule decision is otherwise open. The conflict matrix, orchestrator boundary, compatibility policy, lease timings, recovery proof, and pilot role are locked above.

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

   **Yes.** Section 3 records the corrected owner ruling and the mistaken orchestrator route. Sections 5-6 record the exact repository gaps and official research. Section 7 preserves every important rejection: autonomous team control, concurrent push, replacement preview, perfect static inference, abrupt compatibility removal, closure-as-success, TTL-only recovery, mutable trace files, provider-only enforcement, and dummy migrations. Section 8 records the resulting decisions.

3. **Is the ultimate goal clear enough for a correct judgment call if an implementation step proves wrong?**

   **Yes.** Section 1 defines the business result and explicitly makes the goal controlling. Sections 4 and 8 establish the non-negotiable safety boundaries, while Section 13 provides rollback and decision criteria. An implementer can change a technical detail while preserving serialization, proof, provider neutrality, and the structure-only orchestrator boundary.

**Self-audit result: PASS.**
