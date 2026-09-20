# Shared-db workflow refactor: deliver application work without artificial blocker chains

## STATUS — read first

Planning date: **2026-09-20**. Tracker: [#3306 — non-orchestrator repository-maintenance work](https://github.com/popcre/shared-db/issues/3306). This is a progress index, **not a prerequisite issue for every application**. Do not add it to application `depends_on` lists.

| Step | Independently verifiable outcome | Status | Updated | Acceptance artifact |
|---|---|---|---|---|
| 0 | Fresh baseline, overlapping-work ownership and explicit acceptance contracts | Complete | 2026-09-20 | [Dated baseline and ownership map](docs/verification/workflow-refactor-baseline-20260920T1932Z.md) |
| 1 | Task evidence no longer conflicts between unrelated pull requests | Partial | 2026-09-20 | PR 3323 merged; canonical identity, metadata exclusions, immutable-generation and full delivery acceptance remain |
| 2 | Per-source audit dispositions replace the shared global digest bottleneck | Partial | 2026-09-20 | PR 3330 merged; enclosing-symbol identity and whitespace-only reason regressions remain |
| 3 | Maintenance and structural completion use truthful, compatible evidence | ⬜ open | 2026-09-20 | Required: lifecycle regressions and accepted maintenance closeout trace |
| 4 | Dependencies resume from proven stages; reports separate delivery from paperwork | ⬜ open | 2026-09-20 | Required: event replay tests and recovered dependency trace |
| 5 | One current procedure replaces contradictory operational instructions | ⬜ open | 2026-09-20 | Required: policy matrix checks, canonical skill links and route walkthrough |
| 6 | Required-check discovery is authoritative; advisories remain advisory | ⬜ open | 2026-09-20 | Required: configuration readback and shadow/enforced comparison |
| 7 | Acceptance probes qualify permissions, shape and execution before promotion | ⬜ open | 2026-09-20 | Required: negative fixtures and exact-probe qualification/live proof pair |
| 8 | Existing native merge-queue work is completed and accepted | ⬜ open | 2026-09-20 | Required: existing transfer plan's remaining acceptance artifacts |
| 9 | Merge preparation no longer occupies the serial mutation lane | ⬜ open | 2026-09-20 | Required: lock-race tests and bounded workflow concurrency trace |
| 10 | Preview and production have separate target queues with intact interlocks | ⬜ open | 2026-09-20 | Required: independent-target trace and conflicting-write refusal |
| 11 | Qualified low-risk work uses isolated rehearsal; evidence retries are idempotent | ⬜ open | 2026-09-20 | Required: baseline/closure tests and real eligible delivery trace |
| 12 | Review briefs discover whole risk classes and produce valid verdicts | ⬜ open | 2026-09-20 | Required: brief regression corpus and governed review trace |
| 13 | Second-review policy is decided from measured defect yield and risk | ⬜ open | 2026-09-20 | Required: decision artifact; if adopted, classifier and activation proof |
| 14 | End-to-end delivery and sustained safety are measured and accepted | ⬜ open | 2026-09-20 | Required: comparable before/after report, live traces and residual register |

**Implementation baseline refreshed 2026-09-20 19:32 UTC. Start at the remaining Step 1 requirements.** The original planning publication implemented none of these fixes. The [fresh baseline](docs/verification/workflow-refactor-baseline-20260920T1932Z.md) identifies intervening merged work and active owners; do not rebuild those changes. After Step 0, choose a ready step from the dependency map in §9; this is not a mandatory fifteen-step serial train. Re-read this table and all downstream phases before starting each phase. A done row must link an actual commit, test artifact and live result where required, not merely an issue number or a claimed count. A landed-but-unproven step must name exactly one owned live-proof issue opened at landing, and remains partial.

Companion handoff: [2026-09-20T1507Z-916-codex-workflow-refactor.md](HANDOFF.d/2026-09-20T1507Z-916-codex-workflow-refactor.md). Investigation: [workflow bottleneck audit](docs/verification/shared-db-workflow-bottleneck-audit-20260920.md). The handoff carries execution context; this plan is the implementation specification. Update their current-state claims as execution progresses; do not restart completed work from historical text.

## 1. Ultimate goal

Applications should receive safe database changes promptly, without spending days waiting for unrelated changes, repeated paperwork or forgotten completion records. Every outstanding outcome must have one accountable owner, a truthful next action and only real prerequisites. Work already delivered must stop appearing as a delivery blocker.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Do not speed up by suppressing a real failure, skipping an unproven prerequisite, hiding unknown data, weakening production identity checks or calling merged code a working feature. Do not grow another mandatory approval system to fix the existing one.

Success means independent work advances independently, necessary shared writes stay exclusive, and each acceptance claim is backed by evidence another session can verify. Measurement must distinguish elapsed delivery time, genuine risk controls, resource contention, implementation defects and administrative delay.

## 2. What this system is

`popcre/shared-db` is the canonical shared database repository for POP Creations' CRM, product management/PIM, DAM and DesignFlow PLM applications. It contains PostgreSQL/Supabase migrations, database tests, GitHub Actions workflows, Node.js coordination tools, Python production guards, and operating instructions. The owner moved the public repository from `u2giants/shared-db` to `popcre/shared-db` on September 18; old links redirect. Use the canonical identity and repository-identity helpers, not copied owner strings.

GitHub `main` is the deployment source. Work is authored in separate current-upstream worktrees and lands through pull requests. Consumers receive mirrored `shared-db/` content; do not edit those copies. Production's documented project is `qsllyeztdwjgirsysgai` at `https://qsllyeztdwjgirsysgai.supabase.co`; **verify the configured target immediately before any operation**. Preview is a shared mutable Supabase environment identified by repository variable `PREVIEW_PROJECT_REF`; historic preview IDs in older documents are not current authority. Isolated CI databases run the repository's existing ephemeral test setup.

The sole structural orchestrator handles database shape and curated Master Data under the applicable rules. Maintenance, proofs, reports, scripts and documentation belong to ordinary repository sessions. A self-service additive route already permits eligible changes wholly inside `crm`, `pim` or `dam`; it retains object claims, independent review and guarded delivery. `plm`, `core` and `api` are not automatically app-private boundaries.

Important terms:

- **Claim:** a durable ownership record for exact database objects and migration versions; not a count-based author slot.
- **Exact head:** the source PR commit whose actual content was reviewed; approved content may carry forward only under the existing verified equivalence rules.
- **Rehearsal:** applying/testing the selected change on a qualifying non-production target.
- **Outcome:** what an application can actually use, potentially requiring production application, generated types, application code and a live assertion.
- **Completion record:** immutable evidence consumed by dependency logic. Issue closure alone is not one.
- **Mutation lane:** the exclusive period protecting a shared database write or a merge/production interaction.
- **Producer:** the trusted workflow/code that creates an evidence artifact. Matching migration bytes alone cannot authenticate an arbitrary producer.

## 3. Trigger and observed failures

Albert reported that the orchestrator is backed up for days or weeks, holding applications behind nested blockers, and asked which procedures and checks should be refactored. He then requested a detailed plan to fix **all** findings. This is authorization to publish this plan; it is not an instruction to perform production mutations during planning.

Read-only source baseline: `57269b19416ccca6c20a0053ed05e397b1bd0e19`, current upstream during investigation. Around **2026-09-20 15:00 UTC**, GitHub showed 124 open issues, of which 75 declared maintenance, 29 structural and 6 curated work. The remaining categories include documentation, source data, security settings, coordination and claim/alarm records. Sixty-eight issues were older than seven days, 27 older than fourteen and two older than thirty. These are nested age buckets, not verified undelivered-outcome counts. Do not use bot-updated `updatedAt` as productive activity.

Reproducible examples, all to be rechecked before action:

1. [Merge run 35408114960](https://github.com/popcre/shared-db/actions/runs/35408114960) and [35398598421](https://github.com/popcre/shared-db/actions/runs/35398598421) refused main refreshes with shared `.agent/contract.json` and `.agent/completion.json` conflicts. Their implementation changes were unrelated to some of the intervening work.
2. Open maintenance issues [3245](https://github.com/popcre/shared-db/issues/3245), [3235](https://github.com/popcre/shared-db/issues/3235), [3229](https://github.com/popcre/shared-db/issues/3229) and [3222](https://github.com/popcre/shared-db/issues/3222), all **non-orchestrator work**, had merged implementation PRs while source-data parent [3179](https://github.com/popcre/shared-db/issues/3179), also **non-orchestrator work**, closed with [scheduled live acceptance](https://github.com/popcre/shared-db/issues/3179#issuecomment-5740923544). Child acceptance must be checked individually; these observations do not authorize bulk closure.
3. Structural [2611](https://github.com/popcre/shared-db/issues/2611), **orchestrator work**, applied but its proof lacked permission. Structural permission fix [3191](https://github.com/popcre/shared-db/issues/3191), **orchestrator work**, applied; then the proof timed out. Query recovery [3299](https://github.com/popcre/shared-db/issues/3299), **non-orchestrator work**, owns that remaining repair. A [recorded diagnostic](https://github.com/popcre/shared-db/issues/2611#issuecomment-5746537149) reported equivalent assertions in 0.5 seconds under the production read-only role. The planning session did not rerun the database query.
4. A pure local call to `buildPreviewGraph` with one preview-only older version and an unrelated later claim creates `preview-ledger-predecessor-not-on-main`. No semantic object dependency needs to be supplied. This is a real constraint of the shared rehearsal ledger, not a reason to delete protection blindly.

## 4. Scope

Included: all seven audit findings; the same-class shared audit-artifact conflict; existing merge-queue completion; acceptance-proof readiness; adoption of the existing self-service route; reviewer brief quality and a measured decision on risk-tier review; metrics, compatibility, rollout, rollback and durable ownership.

**NOT in this plan:** redesigning business schemas; bulk data loading; changing application business rules; creating new Supabase projects without resource authorization; deleting existing migration history or claims; rebuilding consumer applications; changing the global secrets model; rotating credentials; cleaning arbitrary worktrees; unpausing reviewers; taking over the structural orchestrator; increasing author/reviewer count caps, which already do not exist; or automatically closing historical issues on the basis of a merged PR.

Most implementation steps are **non-orchestrator repository maintenance**. If a step discovers a genuine structural requirement, isolate it into its own shape issue and follow the currently resolved structural route. Do not route the whole maintenance program through the orchestrator. Do not let optional review-policy or automation changes become prerequisites for unrelated artifact and documentation fixes.

## 5. Current state: what exists and what does not

Line references below are anchored to the baseline above; locate symbols after refreshing upstream. There is no root `package.json`; use the checked-in Node/Python test workflows, not an invented `npm test` command.

| Area | Implemented state at planning baseline | Primary source |
|---|---|---|
| Parallel authors/reviewers | Unlimited authoring/reviewer concurrency under exact-object/version protection; no provider-busy queue | `AGENTS.md:53-55`; `scripts/manage-migration-author-lanes.mjs` |
| Content-equivalent review reuse | Exists; do not implement another cache | `scripts/check-exact-head-approval.mjs:426-472`; `scripts/lib/pr-content-equivalence.mjs` |
| Main freshness | Independent changes can pass; actual Git conflicts still refuse, including evidence files | `scripts/check-main-tip-freshness.mjs:249-309` |
| Task evidence | Fixed pair written by every task | `.github/workflows/agent-work-contract.yml:86-87`; `scripts/agent-work-contract-git-evidence.mjs` |
| Audit dispositions | One global call-site digest/count couples otherwise unrelated edits | `scripts/check-throughput-truth-audit.mjs`; `scripts/throughput-guard/check-throughput-truth-audit.test.mjs`; `docs/verification/throughput-guard-truth-audit-20260828.json` |
| Completion | Immutable work records plus a structural outcome lifecycle; maintenance compatibility needs a reproducing test | `scripts/lib/work-dependencies.mjs`; `completeWork` in lane manager; `scripts/orchestrator-flow/outcome-lifecycle.mjs` |
| Queue reporting/resume | Existing read-only hygiene report, throughput report and flow reconciliation; investigate coverage, do not duplicate | `scripts/queue-hygiene-report.mjs`; `scripts/orchestrator-flow/reconcile.mjs`; `scripts/orchestrator-flow/throughput-report.mjs` |
| Self-service | Delivered, not future work | `plan_orchestrator_required_load_reduction.md` STATUS; `scripts/check-self-service-additive-lane.mjs`; `scripts/orchestrator-flow/admission.mjs` |
| Required checks | Live protection: 13 contexts, strict=false; committed mirror: 12 contexts captured September 8; merge token falls back after HTTP 403 | `scripts/check-required-checks-preflight.mjs:157-165`; `docs/verification/main-required-status-checks.json` |
| Native queue | Transfer completed; existing queue implementation/activation/live acceptance still open in its plan | `plan_shared_db_popcre_transfer_merge_queue.md` STATUS steps 7–11; [PR 3279 — non-orchestrator work](https://github.com/popcre/shared-db/pull/3279) |
| Shared preview dependencies | Every earlier preview-only migration can block later unapplied versions | `scripts/orchestrator-flow/preview-graph.mjs:14-15`; `select-preview-route.mjs:107` |
| Workflow serialization | Whole merge workflow is global; all preview/production non-PR dispatches share another global group | `.github/workflows/guarded-migration-merge.yml:25-27,108`; `shared-supabase-migrations.yml:121-127` |
| Isolated route | Existing conservative production evidence alternative, not universally adequate baseline proof | `scripts/production_business_risk_gate.py`; `scripts/test_production_preview_skip.py`; `docs/agents/ephemeral-route-hop-table.md` |
| Automatic promotion | Existing narrow workflow runs after successful merged-main preview; no-preview automatic dispatch is not generally authorized | `shared-supabase-migrations.yml:1002+`; hop table above |
| Probe qualification | Premerge SQL presence/syntax checks; exact result and permissions are only proven by later execution | `scripts/check-live-proof-probe.mjs:35-37`; `scripts/shared_db_live_proof.py` |
| Second reviews | Every migration requires two independent slots; ordinary governed code requires one | `scripts/check-exact-head-approval.mjs:229-241` |

Completed throughput plans record prior improvements and should be treated as implementation references. Their stale “Fresh implementation starts at Step 1” text is a documentation defect, not authority to redo them. The current ai-devops checkout search did **not** find a separate task-evidence validator; shared-db owns the concrete validator. Do not invent a cross-repository code dependency for Step 1.

This planning publication contains prose only. No implementation code, deployed behavior, database state, review-count policy or production authority was changed. Publication is not completion of the STATUS rows.

## 6. Root causes and evidence

1. **Shared mutable evidence creates false coupling.** Task evidence and the global call-site digest are shared writes with no business dependency. Review-content equivalence cannot prevent Git conflicts on them. See §3 runs and Step 2's existing [2832 — non-orchestrator work](https://github.com/popcre/shared-db/issues/2832).
2. **Dependency truth and issue state are conflated.** `classifyDependency` in `scripts/lib/work-dependencies.mjs` reports an open issue before inspecting completion evidence. Conversely, a closed issue without valid evidence is not complete. Different consumers need different stages; a single open/closed bit cannot express those obligations.
3. **Completion paths may exclude modern maintenance scopes.** `completeWork` rejects a merged outcome when `scope.changeType !== null`, directing callers to the authoritative lifecycle; `completeOutcome` accepts structural scope only. Reproduce this with a maintenance fixture before treating it as a confirmed bug or changing code.
4. **Shared preview makes ordering a global requirement.** Deleting timestamp edges would ignore ledger inconsistency. Isolated, qualifying baselines remove that resource dependency; they do not erase genuine cross-object dependencies.
5. **Workflow-wide queues protect too much.** Static checks, quota waits and target-independent preparation can occupy global concurrency before a protected write begins. Meanwhile `acquireExclusive('production')` also has its own freshness rule; changing the workflow alone is insufficient.
6. **The fallback required-check set is broader than its name.** `evaluateWithoutRequiredList` requires all observed successes except explicit advisories, because the settings source is unavailable. A synchronized authoritative source is required before narrowing it safely.
7. **Late proof qualification creates repair chains after application.** Syntax validation does not prove runtime role permissions, useful result shape, data assumptions or bounded query execution.
8. **Procedural history is presented as current policy.** Section-4 lines 424–429 permit concurrent provider reviews while 643–646 contradict it; lines 750–754 say production activation is inactive despite the active configuration. Current documents routing also differs from older instructions.
9. **Some remaining manual actions are deliberate authority decisions.** The ephemeral hop table explicitly records a completed “no code change” conclusion. Reopening that design is a policy proposal, not fixing an accidentally omitted trigger. Review judgment must remain independent.

## 7. Rejected approaches and why

- More author/reviewer slots: no such ceilings remain; more drafts can increase the queue behind the same protected resource.
- Remove object claims, duplicate-version prevention, target proof, exclusive production locks or live verification: these cover real independent failure modes and do not solve administrative conflicts.
- Remove preview dependency edges while retaining the same contaminated ledger: would conceal missing baseline closure.
- Treat any passing ephemeral job as production equivalence: the adopted history needs CI bootstrap objects/seeds; residual replay failures and quarantined tests exist. Prove the relevant closure.
- Silently automate no-preview production because a script can dispatch it: capability is not authority; the standing exception is narrower.
- Drop reviewer two immediately: the audit has no measurement of unique defects it catches. Improve brief quality first and make a documented decision.
- “Keep ours” or union-merge task evidence: may silently bind another task's proof to the current change.
- A new global evidence index: recreates the shared-file collision at another path.
- Bulk regenerate audit dispositions: would turn substantive per-site review into an unchecked digest update.
- Close every merged issue or mark every closed issue successful: loses live acceptance, cancellation and supersession semantics.
- A new watcher, queue or orchestration service by default: existing reconciliation, issue watcher and merge-queue work must be reused first.
- Restore `strict: true` or force refresh after every main update: knowingly recreates unrelated-suite churn. Keep existing exact-content and lock-time checks.
- Increase production query timeouts as the probe repair: diagnose plan/permissions and preserve bounded assertions first.
- Merge all fifteen steps as one large PR or assign all leftover proofs to a later session: violates isolated outcomes, increases rollback risk and creates the very nested backlog being repaired.

## 8. Design decisions and authority

### Locked design requirements — 2026-09-20

- This program is non-orchestrator work except separately identified structural changes. Every issue's current scope controls its route; a predecessor's route is not inherited.
- One step owns one unproven live outcome. Steps sharing files execute in sequence or coordinate an explicit single writer. A program index is not a gate.
- Reuse existing lifecycle, route classifier, guards, transport, locks, CI baseline and canonical skill infrastructure. Any new module below exists to consolidate an identified responsibility, with a named owner and retirement path for its predecessor.
- Unknown, truncated, stale, mismatched or unauthorized evidence cannot yield success. Make conservative routing visible; never silently downgrade safeguards.
- Bind evidence to repository identity, task, source PR/content, selected migrations, baseline where relevant, policy and producer. Reuse supported equivalents only after verifying those bindings.
- Keep two migration reviewers until an approved policy amendment is activated. Keep recorded refusals effective regardless of later tier reclassification.
- Preserve one writer per shared target and merge/production freeze interactions. Queue-splitting alone does not relax target ownership.
- Keep production post-apply assertions even after pre-promotion qualification. Keep application return outcomes owned by their application.
- Issue opener retains closure authority under current rules. Dependency readiness may use a valid required-stage record while administrative closure is pending; changing automated closure authority requires a separately reviewed explicit policy amendment.

### Proposed policy changes — not active instructions

**P1: Risk-tiered reviewer count.** Step 13 may recommend one independent reviewer for a tightly defined mechanically verified additive class. Until evidence and explicit policy adoption exist, keep two. A defensible retain-two decision satisfies the evaluation deliverable; it must not be mislabeled as removal of review overhead.

**P2: No-preview automatic production transition.** Step 11 first supports the existing governed isolated route. Extending the standing automatic promotion exception to accept direct isolated evidence would be a change to the present hop-table ruling. Prepare the complete technical proposal and dispatch contract for independent review under Albert's standing technical-approval policy. Only an explicit, durable approval within the authority applicable to the exact change can activate it. No session-made production dispatch, new trigger or resource creation is authorized by this plan alone. If approval is absent, finish and prove the existing supported route and record automation as blocked with an owner; do not block Steps 1–10 or hide the limitation.

**P3: Automated issue closure.** Not needed to remove false delivery dependencies. Keep owner-driven closure while implementing verified stage readiness. If later desired, propose explicit delegated closure authority, identity and revocation rules; this plan does not quietly grant it.

Routine design choices are delegated to the implementer within these constraints: module naming, test fixture layout and conservative feature controls. Material deviations affecting permissions, allowed SQL, production triggers or reviewer count require a recorded decision before activation. No questions are needed to begin Step 0 or the non-policy fixes.

## 9. Executable implementation plan

### Common execution contract for every step

Start in a fresh current-upstream worktree, declare the actual task class, inspect current ownership/PRs, and refresh the step's existing issue. Before a stronger action, run `ai-task-gates check --before <action>` for the applicable action. Redeclare protected classes when warranted; a prose plan does not make its future executable changes prose. Do not fork a duplicate implementation issue when an existing owner is active. Transfer work explicitly or take a different independent step.

Before implementation, name the exact acceptance claim, positive and negative probes, target, roles, dependencies and likely blockers together. Run the new negative test first. Before independent review, audit the whole risk class and sibling readers/writers. Stage only owned files; verify branch and committer identity. Merge through current applicable repository policy, prove deployed behavior, update the STATUS artifact, and stop at that natural boundary.

If code lands without proof, open exactly one owned live-proof issue immediately, not a bundle later. A real cross-issue blocker uses `ai-blocker-watch wait <owner/repo#blocker> --for <owner/repo#work> --note "<specific next action>"`; do not hold a chat indefinitely. Do not send automated messages to other sessions merely because this plan exists; use authorized dispatch channels when implementation is assigned.

### Dependency and concurrency map

- Step 0 feeds all steps with scope/owners, but it is a bounded intake exercise, not a long design committee.
- Steps 1, 2, 5, 6, 7 and 12 can proceed independently after Step 0 **only with non-overlapping owned files**. Steps 1 and 7 both touch the probe reader, so serialize those edits; Step 5's router updates follow the changing policy-owning code.
- Step 3 reuses Step 1's resolver if it touches task evidence. Step 4 depends on Step 3's accepted-stage semantics, but read-only baseline reporting can start earlier.
- Step 8 follows the existing queue plan and its existing owner. Steps 9 and 10 share workflows/locks with Step 8: sequence those changes on accepted current main, never have three agents editing the same workflow independently.
- Step 11 requires Step 7 and qualified Step 10 behavior, and integrates with accepted queue behavior from Step 8. Preparation/baseline analysis can happen earlier.
- Step 13 uses Step 12 plus measurements from Steps 0/14; it does not block unrelated fixes.
- Step 14 instrumentation starts at Step 0, then acceptance completes after relevant changes and sufficient observation. A measurement period is not a reason to hold safe application delivery.

Natural phases: **A** baseline/artifact independence (0–2); **B** completion/procedure/check truth/probe readiness (3–7); **C** queue and rehearsal isolation (8–11); **D** review quality, policy and sustained acceptance (12–14). Each numbered step can be a separate fresh session. At every cut, use the applicable fresh-session procedure and re-read downstream sections for drift.

### Step 0 — Establish current truth, ownership and acceptance

**Files:** this STATUS table; existing `scripts/queue-hygiene-report.mjs`, `scripts/orchestrator-flow/throughput-report.mjs`; a new prose report `docs/verification/workflow-refactor-baseline-<UTC>.md`. Use existing JSON artifacts privately or through established public-data validation; do not dump issue bodies, private row data or transcripts into this public repository.

**Actions:** fetch current main; read each overlap issue/PR below; capture current required checks/rulesets, queue states, release workflow behavior and completed plan artifacts. Classify unique business outcomes separately from maintenance/claim/alarm records. Record creation, ready, review, rehearsal, merge, applied, verified, completion and closure times where evidence exists; absent time is unknown. Sample real blocked chains and capture actual error/run links. Give each selected step one owner, issue, file set, target and acceptance condition. Do not open all child issues merely to inflate a tracker.

**Overlap map:** [2708](https://github.com/popcre/shared-db/issues/2708) task evidence; [2832](https://github.com/popcre/shared-db/issues/2832) global digest; [2824](https://github.com/popcre/shared-db/issues/2824) completion writers; [2596](https://github.com/popcre/shared-db/issues/2596) closeout; [2836](https://github.com/popcre/shared-db/issues/2836) same-repo return; [3002](https://github.com/popcre/shared-db/issues/3002) serialization; [3273](https://github.com/popcre/shared-db/issues/3273) stale queue place; [2530](https://github.com/popcre/shared-db/issues/2530) native queue; [2923](https://github.com/popcre/shared-db/issues/2923) review briefs — **all non-orchestrator work**. Refresh state; an open old report is not proof a defect persists. Closed [3199](https://github.com/popcre/shared-db/issues/3199) and [3027](https://github.com/popcre/shared-db/issues/3027), **non-orchestrator work**, are delivered references.

**Verification gate:** you'll know it worked when the report can reproduce category/age counts and sampled chains from dated evidence, names an owner for each selected implementation, and distinguishes real outstanding acceptance from stale paperwork. No mutable production action is needed. **Rollback:** none; correct erroneous reports rather than rewriting history.

### Step 1 — Isolate task evidence without invalidating existing work

**Files/functions:** `scripts/agent-work-contract-git-evidence.mjs` (`METADATA_FILES`, `classifyEvidencePair`, `verifyGitEvidence`); `scripts/agent-work-contract.mjs`; `.github/workflows/agent-work-contract.yml`; `scripts/refresh-code-pr-branch.mjs` (`EVIDENCE`, `refresh`, `rebindCompletion`); `scripts/check-live-proof-probe.mjs`; `scripts/check-documents-only-pull-request.mjs`; completion readers in `scripts/manage-migration-author-lanes.mjs`; `scripts/lib/pr-content-equivalence.mjs`; `scripts/check-main-tip-freshness.mjs`.

**Design:** introduce one shared resolver, proposed `scripts/lib/task-evidence.mjs`, for `.agent/work/<issue>/<generation>/contract.json` and `completion.json`. Issue and generation must be validated canonical identifiers, not arbitrary filesystem paths. Generation records are append-only after commit. Resolve from the PR's complete changed-file set plus contract identity, never “newest filename.” Exactly one current pair may claim the task/generation. Earlier committed generations remain historical; they cannot silently replace the selected pair. Bind actual code diff, base/head semantics, work issue and PR consistently with the existing contract model.

**Transition:** land dual-format readers first, then switch writers/templates. A legacy active PR can finish with its exact legacy pair; new writes use scoped pairs after the cutover. Reject ambiguous mixed current pairs. Census active legacy writers before deprecating support. Exclude only verified evidence records from equivalence/inert classifications, not arbitrary executable content hidden under `.agent/`. Do not introduce a global mutable index. The existing shared-db validator is canonical; cross-repo skill prose updates do not create an invented ai-devops runtime dependency.

**Tests:** extend `agent-work-contract-git-evidence.test.mjs`, `refresh-code-pr-branch.test.mjs`, `check-live-proof-probe.test.mjs`, `check-documents-only-pull-request.test.mjs`, `check-main-tip-freshness.test.mjs`, `lib/pr-content-equivalence.test.mjs`; add resolver tests in proposed `scripts/lib/task-evidence.test.mjs`. Cover inherited/wrong-task evidence, partial/duplicate pairs, generation edits, traversal, symlinks, case aliases, metadata-only refresh, real code conflicts, and changed implementation requiring renewed approval.

**Verification gate:** you'll know it worked when two genuine independent PRs with different tasks can land sequentially without an evidence-only conflict or unnecessary substantive re-review, while wrong-task/inherited evidence and genuine implementation conflicts still fail. Record exact heads, diffs, merge commits and CI traces. **Rollback:** stop new-format writers but retain dual readers; never roll back to a reader that cannot validate already-issued new records.

### Step 2 — Remove global audit-disposition contention

**Files:** `scripts/check-throughput-truth-audit.mjs`; `scripts/throughput-guard/check-throughput-truth-audit.test.mjs`; `docs/verification/throughput-guard-truth-audit-20260828.json`; related ledger helpers in `scripts/throughput-guard/`. Reuse the existing issue 2832, non-orchestrator work.

**Design:** partition substantive dispositions by source file, under proposed `docs/verification/throughput-dispositions/<escaped-source-path>.json`. Give each call site an identity derived from source path plus normalized enclosing symbol/snippet and an explicit reviewed disposition. Line numbers are diagnostics, not sole identity. Reject identity collisions/ambiguous duplicates. Discover the complete source set deterministically, compare expected versus discovered identities both ways, and require a reason for every disposition. Derive global counts/digests in CI reports rather than requiring authors to edit one aggregate artifact. A changed source file edits its own disposition file; two edits to the same source still require normal integration.

**Transition:** migrate all existing dispositions losslessly in a dedicated change, with an equivalence report. Initially evaluate old and new catalogs and require equivalence; cut over atomically when every site is accounted for. Retain the old artifact as explicitly historical evidence, not an active second source. Do not give a bulk update command authority to approve new sites.

**Tests:** `disposition_unknown_site_refuses`, `disposition_deleted_site_requires_retirement`, `disposition_path_rename_preserves_review`, `disposition_duplicate_identity_refuses`, `disposition_empty_reason_refuses`, `disposition_partition_complete_equivalence`, `independent_source_dispositions_merge_without_global_edit` in the existing test module. Include malicious path encodings and excluded-directory attempts.

**Verification gate:** you'll know it worked when the old reviewed coverage is exactly preserved and two unrelated source changes merge without touching a common count/digest, while an undispositioned new site fails. **Dependencies:** Step 0; coordinate with other throughput-guard changes. **Rollback:** restore old evaluation only with a generated, reviewed full current catalog; never revive a stale aggregate that omits new sites.

### Step 3 — Make completion truthful for maintenance as well as structure

**Files/functions:** `scripts/lib/work-dependencies.mjs` (`validateCompletionRecord`, `findCompletionRecord`, `classifyDependency`); `scripts/manage-migration-author-lanes.mjs` (`completeWork`, `parseQueueScope`); `scripts/orchestrator-flow/outcome-lifecycle.mjs` (`outcomeHistory`, `advanceOutcome`, `completeOutcome`, `repairOutcomeHistory`). Existing tests: `scripts/lib/work-dependencies.test.mjs`, `scripts/manage-migration-author-lanes.test.mjs`, `scripts/orchestrator-flow/admission-outcome.test.mjs`.

**First reproduce:** a maintenance issue with `change_type: repo-maintenance` and valid merged implementation must have a supported completion path without pretending to be structural. If current main already fixes it, cite the regression instead of rebuilding it.

**Design:** extend the existing lifecycle with typed maintenance acceptance and a versioned required-stage contract. Define stages with explicit evidence, not a universal linear assumption: implementation merged; database applied where relevant; live verified; application accepted where relevant. A documentation-only outcome can legitimately finish at reviewed/merged publication; a loader fix cannot unless its acceptance contract says no runtime proof is needed. Preserve one final immutable completion record; use stage events for intermediate progress rather than issuing conflicting final records.

Read/reconciliation results must distinguish `delivered-closeout-pending`, `awaiting-live-proof`, `incomplete`, `cancelled-or-superseded`, and `unverifiable`. Verify actual squash/merge membership on main, issue/PR linkage and required evidence. A parent assertion may discharge a child only when its exact child acceptance is explicitly covered; references alone are insufficient.

Use idempotency keys bound to task, stage and evidence digest, conditional writes, and exact readback. Recover after a successful comment write whose response is lost; never duplicate contradictory records. Preserve authoritative historical records, with explicit repair/supersession events rather than edits. Keep issue closure with the opener or authority explicitly permitted by current rules; produce an owner-action packet for closeout instead of a background mass closer.

**Verification gate:** you'll know it worked when a real accepted maintenance outcome records completion through the governed route, a structural outcome still requires its full live acceptance, and a crash between record/writeback/closure can resume without duplicate claims. Named regressions in §10 must pass. **Dependencies:** Step 1 where evidence readers are shared; existing lifecycle semantics otherwise. **Rollback:** retain v2 readers and verified records; turn off new writers or read as pending, never reinterpret accepted evidence as a different stage.

### Step 4 — Reconcile dependencies, routing and durable resume

**Files:** `scripts/lib/work-dependencies.mjs`; `buildDynamicQueues` in lane manager; `scripts/orchestrator-flow/reconcile.mjs`; `scripts/orchestrator-flow/admission.mjs`; `scripts/queue-hygiene-report.mjs`; `.github/workflows/queue-hygiene-report.yml`; `scripts/orchestrator-flow/throughput-report.mjs`. Discover the existing `ai-blocker-watch` integration in the installed toolkit before changing any resume transport; do not create a second scheduler.

**Design:** add an explicit required stage to new dependency declarations using a backward-compatible parser. Old declarations keep their previous full-completion requirement until individually migrated with evidence; do not auto-lower them. Dependency readiness is based on the required verified stage, including the necessary current-world validity checks, not solely the issue's open bit. Closure stays visible as administrative work. Failed/revoked proof must not remain usable after an evidence/state change. Detect cycles and missing owners; a long genuine chain is reported, not bypassed because of its length.

Separate technical prerequisites, resource waits, evidence repair and optional follow-up relationships. Only actual prerequisites block. Feed evidence transition events through existing reconciliation so work resumes after a durable checkpoint even if its chat has ended. Delivery is at-least-once; consumers deduplicate by event identity and revalidate before any mutation. Lost events are recovered by a bounded reconciliation scan. Rate-limited/unreadable sources produce `unverifiable`, not success. Notification is meaningful-change only.

Keep scheduled hygiene read-only, including its write-stripped IO. It reports unique undelivered outcomes, delivered-but-unclosed tasks, structural/curated/maintenance categories, oldest meaningful event, real current failing gate, named owner and technical critical path. It must not release claims or edit issues from a read-only workflow. Route existing eligible self-service work visibly to its application owner using the current classifier; do not expand the allowed schemas or invent a parallel admission lane.

**Verification gate:** you'll know it worked when one real dependent outcome resumes from proven prerequisite acceptance despite pending administrative closure, a closed-without-proof prerequisite still refuses, duplicate events cause no duplicate dispatch, and self-service-eligible work avoids central triage without bypassing boundary guards. **Dependencies:** Step 3 for new acceptance semantics; baseline report work may precede it. **Rollback:** stop new-stage writers/dispatch, preserve events, keep new readers and return affected work visibly to conservative waiting; never silently map unrecognized stages to complete.

### Step 5 — Consolidate the current procedure and remove contradictions

**Files:** `AGENTS.md`; `docs/agents/section-4-anti-collision-rules.md`; proposed `docs/agents/current-workflow.md`; completed throughput and load-reduction plans named in §5; transfer plan's stale fresh-start statement. Canonical cross-tool skills live separately in `popcre/ai-devops`: `skills/shared/shared-db-orchestrator/SKILL.md`, its `references/operating-manual.md`, and `skills/shared/shared-db-handover/SKILL.md`. Verify actual paths on fresh upstream before editing them. Installed user skills are deployment copies, not source.

**Design:** create one short current route/runbook with a small explicit policy matrix: scope boundaries; reviewer concurrency; review counts; documents route; activation state; target identity source; resource locks; completion ownership. Link incident rationale/history rather than keeping contradictory executable instructions. The matrix references authoritative configuration or code and states when a topic is an owner ruling; do not use a second free-floating config as policy authority. Add proposed `scripts/check-current-workflow-policy.mjs` with `.test.mjs` to validate the small matrix and required routing links. Do not attempt an unreliable parser of arbitrary prose.

Mark completed plans historical and remove active restart instructions only after rechecking their artifacts. Keep relevant evidence and decisions. Register this plan with literal link-only routing rows. Update the canonical skills through their own repository worktree/PR and supported deployment; record any temporarily unsynced copies. Do not write personal persistent memory without a direct user request.

**Verification gate:** you'll know it worked when the concurrency/activation/document-route contradiction fixtures fail before repair and pass afterward; mutation of a matrix value fails; a fresh reader can follow maintenance, structural and self-service examples without contradictory instructions. **Dependencies:** Step 0; coordinate against already-landed policy-owning changes. **Rollback:** revert inaccurate prose with a corrective PR while keeping historical evidence; do not roll back implemented safety behavior via documentation.

### Step 6 — Establish a trustworthy required-check set

**Files/functions:** `scripts/check-required-checks-preflight.mjs` (`readRequiredChecksMirror`, `evaluateWithoutRequiredList`, `evaluatePreflight`, `gatherPreflightInput`); `scripts/update-required-checks.mjs` (`readLive`, `mirrorDocument`, `writeMirror`, `verifyReadback`); `docs/verification/main-required-status-checks.json`; their existing `.test.mjs` files; guarded merge workflow.

**Design:** first reconcile the actual protection/ruleset set with its mirror through the supported settings owner/readback mechanism. A plan author must not silently change settings to match an old mirror. Define authority as repository numeric identity/canonical repository, protected branch, effective branch protection plus applicable rulesets, source identity and captured revision. Prefer a fresh effective-settings read at the protected merge boundary. Where direct reads are unavailable, a trusted settings-owner attestation is acceptable only with a proven invalidation protocol, not expiry alone: every applicable repository or inherited organization ruleset/protection mutation must freeze authorization, revoke the old attestation, and publish verified replacement state before merges resume. If all mutation paths cannot be covered, do not enable the snapshot route; establish a supported live read instead. An unexpired signature cannot prove settings have not changed. If the current effective revision cannot be established, refuse authorization. Do not invent unsupported GitHub Actions permissions or broaden personal credentials to bypass the 403.

Evaluate required contexts and allowed producer identities against the reviewed head. Advisory failures remain visible but do not become required implicitly. Re-run mutable facts under merge lock; a PR must not author its own weakened requirement list. Refresh settings evidence when policy changes. Shadow old/proposed decisions before activating the new evaluator; explain every disagreement.

**Verification gate:** you'll know it worked when required missing/pending/failing states all refuse, a failing advisory is visible without independently blocking, a newly added effective ruleset requirement cannot be omitted even when the previous attestation remains within its expiry, and live readback matches the active manifest. GitHub's actual merge protection still enforces the current policy; normal executable releases must not use an administrative bypass to defeat it. No broad permission increase is needed merely to pass. **Dependencies:** Step 0; Step 8 consumes the same authority. **Rollback:** restore conservative evaluation while preserving synchronized evidence; never use stale authority to declare success.

### Step 7 — Qualify the entire acceptance probe before promotion

**Files/functions:** `scripts/check-live-proof-probe.mjs` (`evaluateProbe`, `probeShapeProblem`); `scripts/shared_db_live_proof.py` (`build_proof`); `.github/workflows/shared-db-live-proof.yml`; `.github/workflows/shared-supabase-migrations.yml`; `.github/workflows/database-contract-tests.yml`; `scripts/production_business_risk_gate.py` qualification; existing `check-live-proof-probe.test.mjs`, `test_shared_db_live_proof.py`, `test_automatic_qualification_route.py`.

**Design:** after applying the selected migrations on the qualifying rehearsal target, run the exact committed acceptance SQL under the intended read-only execution role or a proven equivalent role configuration. Use a server-enforced read-only transaction, statement/lock time limits and least-privilege credentials; a SELECT-looking function is not proof it has no side effects. Reuse the existing validator and execution path rather than creating a second SQL parser. Verify exactly one row and exactly one boolean `passed=true` column. Check relation/function permissions, schema search path, data prerequisites, bounded plan/cost and representative volume. Missing fixtures cannot be broadly classified as an exemption; route to the target capable of proving the requirement.

Qualification evidence binds probe digest, migration hashes/closure, source PR/content, execution role, target identity, baseline, duration/budget, trusted producer and result. Promotion requires the evidence appropriate to its route. Preview success is not a production outcome; production executes the same committed probe afterward. For outcomes returning to an application repo, validate the application acceptance contract rather than inventing a shared-db SQL proof that claims to test its UI.

**Transition:** first report-only on genuine work to distinguish missing fixtures from actual defects; then require qualification for newly admitted changes. Existing approved work is either qualified before dispatch or remains on its existing reviewed route with explicit compatibility evidence—no silent grandfathering of failed probes.

**Verification gate:** you'll know it worked when permission denial, timeout and wrong-result fixtures refuse before dispatch; an exact real probe qualifies under the correct role and later passes production; changed probe bytes invalidate prior qualification. **Dependencies:** Step 1 reader integration; no dependency on fewer reviewers. **Rollback:** return to the existing stricter accepted route, preserve artifacts, and repair qualification defects; never disable the final production assertion.

### Step 8 — Finish the native merge queue already under construction

**Files:** follow `plan_shared_db_popcre_transfer_merge_queue.md` STATUS steps 7–11 and the current diff/owner of PR 3279, non-orchestrator work. Expected surfaces include queue triggers, required context aggregation, `scripts/check-merge-queue-workflows.test.mjs` as specified by that plan, and guarded merge integration. Verify which planned files now exist; do not recreate a closed predecessor PR.

**Actions:** accept ownership only if released by the current owner; otherwise coordinate a non-overlapping step. Complete implementation while direct guarded merging remains available, verify all required checks run on merge groups, activate settings only with the exact required authority, prove a harmless non-migration queue passage, then use the next genuine migration to prove rehearsal/promotion holding behavior. Do not create a fake migration to test the queue.

**Verification gate:** you'll know it worked when that plan's own remaining rows cite actual queue-run/merge/rehearsal evidence, no required context is lost, stale/ejected work yields to ready work per accepted policy, and no second queue competes for delivery. **Dependencies:** existing plan, Step 6 authority if changed. **Rollback:** use the existing plan's documented guarded direct route/settings rollback; preserve required checks and claim/proof protection.

### Step 9 — Move preparation outside merge serialization

**Files/functions:** `.github/workflows/guarded-migration-merge.yml`; `scripts/manage-migration-author-lanes.mjs` (`acquireExclusive`, `assertExclusive`, `releaseExclusive`, `recoverExclusive`); `scripts/orchestrator-flow/runner-lanes.mjs`; required-check/freshness helpers and tests.

**Design:** split independent static preparation into per-request jobs before the short protected merge job. Quota waits, downloads, long tests and non-mutating evidence construction must not hold the merge mutex or its workflow-wide queue. At the protected boundary re-prove exact head/current compatible base, effective required results, reviews/refusals, claims/collisions, route and freeze state; then authorize/merge once. Preparation produces bound evidence, not a transferable green flag.

GitHub concurrency groups are not a durable FIFO contract. Use accepted native queue semantics where available, and the existing resource lock mechanism otherwise; never rely on a pending workflow run surviving arbitrary later dispatches. Preserve operator-visible refusal/ejection and automatic safe resumption. Do not hold a mutation lock during a 900-second external retry. Cancellation/timeout uses ownership-aware release; an expired timestamp alone does not authorize stealing a live lock.

**Verification gate:** you'll know it worked when one quota-limited preparation does not stop another ready independent merge, while simultaneous merge attempts and merge-versus-production races admit only the authorized writer. Verify job start/lock acquire/release times, not merely overall green status. **Dependencies:** Step 8's accepted integration; execute sequentially with Step 10 on shared files. **Rollback:** restore the original workflow grouping while retaining safe lock ownership/recovery semantics.

### Step 10 — Separate preview and production queues without weakening coordination

**Files:** `.github/workflows/shared-supabase-migrations.yml:121-127`; lane manager exclusive-lock functions; `scripts/check-main-tip-freshness.mjs`; `scripts/orchestrator-flow/runner-lanes.mjs`; `scripts/run-preview-rehearsal-transaction.mjs` and tests.

**Design:** use target-qualified concurrency groups for distinct preview and production resources; keep PR validations per ref. Resolve trusted target identity before choosing a mutation group; untrusted workflow input cannot manufacture a different name for the same database. Retain the production/merge interlock and deliberate invalidation of stale authorization. Enumerate a compatibility matrix: preview/preview same target forbidden; production/production forbidden; merge/production forbidden during protected freeze; preview/production distinct targets allowed only if shared evidence/ref mutations and lock ordering are proven safe.

Unify production freshness policy between workflow checks and `acquireExclusive('production')`, which currently independently demands current main. Bind a promotion manifest to exact selected migration bytes, producer/policy inputs and effective dependencies. Only explicitly proven inert main changes may reuse it; substantive/unknown drift requalifies. Do not relax to “same migration filenames” or remove the freeze as incidental cleanup.

**Verification gate:** you'll know it worked when independent target preparation/execution can overlap without postponing approved production behind preview recovery, while all conflicting-target and lock-ownership tests refuse. Run sandbox/fake-lock tests first; use real production observations only on an independently authorized genuine release. **Dependencies:** Step 9 and accepted queue integration. **Rollback:** restore the old global target grouping; keep immutable manifests and retained evidence, never roll back applied migrations.

### Step 11 — Promote qualified isolated rehearsal and make evidence recovery idempotent

**Files/functions:** `scripts/orchestrator-flow/preview-graph.mjs`, `select-preview-route.mjs`; `scripts/production_business_risk_gate.py` (`preview_required_reasons`, `prove_ephemeral_ci_evidence`, `qualify_automatic_route`); `.github/workflows/database-contract-tests.yml`; `.github/workflows/shared-supabase-migrations.yml`; `supabase/ci-bootstrap/010_pre_adoption_baseline.sql`, `020_test_fixture_seed.sql`; `scripts/dispatch-production-apply.mjs`; `scripts/run-preview-rehearsal-transaction.mjs`; existing evidence bundle/ready-record helpers in `scripts/orchestrator-flow/`.

**Baseline contract:** use existing isolated CI infrastructure before considering paid hosted branches. The adopted history is not self-contained: captured bootstrap objects, invented fixture rows, two-pass replay and quarantined assertions cannot be ignored. Produce typed evidence containing baseline identity/hash, ordered selected dependency closure and migration digests, effective role/permission setup, exact source, trusted producer, every replay failure, relevant contract-test results/quarantines and Step 7 probe qualification. A selected migration succeeding after a prerequisite failed is not enough. Refuse isolated eligibility when data sensitivity, lock risk, unsupported SQL, missing external object/dependency, relevant quarantine or unknown catalog truth prevents adequate proof.

**Routing:** reuse the existing conservative classifier and self-service boundary where applicable. First run isolated proof alongside shared preview and compare. Then enable only an explicitly enumerated proven class, starting with eligible app-owned additive changes. Shared/unknown/data-dependent changes continue to shared preview. Keep timestamp edges for work using the shared ledger. An isolated route must genuinely avoid entering that shared preview dependency queue; otherwise the intended benefit is not delivered.

**Evidence recovery:** assign a stable attempt identity bound to source, migration set, target/baseline and producer. Separate apply from verification/artifact delivery. A retry after a confirmed apply verifies existing state and recovers evidence; it does not rerun the migration write. If application status is ambiguous, reconcile the ledger/catalog under the appropriate lock before deciding. Multiple successful artifacts cannot be selected by arbitrary latest timestamp; use exact attempt identity and content digest. Pin trusted producer code to the accepted release contract so an unrelated producer update cannot corrupt an in-flight attempt; a security-relevant producer change explicitly invalidates incompatible evidence.

**Authority:** first deliver the existing governed isolated route with its supported dispatch tooling and current authority. P2 in §8 governs any proposal to connect direct isolated qualification to automatic production. Reuse the existing production lane and independent re-proofs; do not build a second production path or quietly make a push event an authorization. An unapproved P2 extension is a named limited blocker, not a reason to leave existing eligible work trapped in shared preview.

**Verification gate:** you'll know it worked when a genuine eligible change has exact baseline/closure/probe evidence, safely completes the supported release route without waiting for an unrelated preview-only migration, and an evidence-delivery retry causes no second application. At least one ineligible and one tampered-evidence case must refuse. **Dependencies:** Steps 7, 8/10 as integrated; policy activation only if separately approved. **Rollback:** explicitly route new work back to shared preview, retain accepted artifacts and database ledgers, finish in-flight attempts through their pinned contract or a reviewed recovery; no destructive cleanup.

### Step 12 — Improve reviewer briefs before changing review count

**Files:** `scripts/run-governed-review.mjs` and the brief builders/templates it actually imports; lane-manager review assignment; applicable tests; canonical reviewer brief guidance in ai-devops only if it is the owning source. Locate the verdict formatter/parser with `rg` before editing—do not create a competing format. Reuse issue 2923, non-orchestrator work.

**Design:** construct a complete review packet: actual diff, role/permission changes, object/dependency list, migration immutability, rollback, probe/index/volatility checks, known related refusals and tests. Require a whole-class review, all findings together, and the precise existing terminal verdict format bound to head. Validate packet completeness before consuming a paid reviewer draw. Preserve provider independence and the right to reject; do not prompt toward approval or force a reviewer to ignore new concerns.

**Verification gate:** you'll know it worked when fixtures reproduce and catch the missing-terminal-line and omitted probe-checklist cases before dispatch, and a genuine governed review returns parseable evidence with the full packet. Record rounds and reasons without claiming every future review will finish in one round. **Dependencies:** Step 0; may proceed independently of merge-queue changes. **Rollback:** restore the previous packet builder only with correct terminal format; keep prior verdicts and independent reviewer refusal semantics.

### Step 13 — Decide risk-tier review from evidence, then activate only if justified

**Files:** `scripts/check-exact-head-approval.mjs`; assignment paths in lane manager; conservative SQL classifier in `scripts/production_business_risk_gate.py`; review/throughput evidence collectors; a new decision record `docs/verification/workflow-review-tier-decision-<UTC>.md`. If adopted, use one shared policy representation consumed consistently by assignment, review and merge; no three independent regex classifiers.

**Measurement:** collect at least the existing throughput report's minimum completed sample requirement, separated by risk class. Record unique confirmed defects found only by reviewer two, duplicate/false-positive findings, review/replacement waiting, re-review with unchanged implementation, and brief quality. Small samples remain insufficient; a zero-defect sample is not proof of zero risk.

**Decision:** recommend retain-two by default while evidence is insufficient. A proposed one-review tier must have an exact supported SQL/object boundary, deterministic protection for the omitted review's covered risks, negative-case coverage and an explicit policy adoption record. Unknown, mixed, destructive, permission/RLS, shared-function and unsupported changes remain two. Same provider/session cannot satisfy independent slots when two are required. A recorded rejection or owed returned slot cannot disappear through reclassification. Policy changes invalidate cached tier decisions.

**Verification gate:** you'll know it worked when the decision record states measured evidence and a defensible adopted/rejected result. If adopted, shadow classification, then limited activation, proves all adversarial cases and a genuine reviewed delivery. If retained, explicitly record that review count was not shown to be dispensable; remaining delay work remains on briefs/reuse/replacement. **Dependencies:** Step 12 and sufficient measurements. **Rollback:** switch back to two for new work, retain refusal/evidence history, requalify in-flight lower-tier work as required; never fabricate a second approval.

### Step 14 — Accept the full delivery behavior and measure improvement

**Files:** extend existing `scripts/orchestrator-flow/throughput-report.mjs` and tests; `scripts/queue-hygiene-report.mjs`; final `docs/verification/workflow-refactor-acceptance-<UTC>.md`; this STATUS table and handoff.

**Measure from Step 0 onward:** ready-to-live outcome latency, median and p90 by comparable change class; time in preparation versus protected locks; preview waits due solely to unrelated versions; evidence-only refresh/review loops; administrative closure lag; verified-but-open tasks; required versus advisory refusals; unique confirmed review defects; safety regressions. Preserve the existing minimum-sample/`INSUFFICIENT_SAMPLE` behavior. Use a minimum fourteen-day before/after observation window where history exists and at least twenty comparable completed samples per reported aggregate; if insufficient, report exact coverage and extend observation without blocking application delivery. These thresholds are reporting gates, not concurrency caps or a promise of statistical causality.

**Functional acceptance:** show separate real traces for task-evidence independence, per-source disposition independence, maintenance completion, dependency resume, qualified live proof, queue/lock exclusion, and eligible isolated delivery. Reuse a trace across compatible assertions only when every assertion is explicit; do not hide several unfinished proofs in a single catch-all issue. Confirm cold-start recovery after an interrupted session, safe handling of API failures and no loss of substantive required checks.

**Verification gate:** you'll know it worked when every applicable step has accepted artifacts or a clearly recorded policy decision, no unresolved regression compromises safety, and the report separates measured improvement from unmeasured claims. Close tracker 3306, non-orchestrator work, only through authorized ownership after implementation acceptance, and retire its handoff in the same closing change. **Rollback:** each step's independently tested rollback applies; no program-wide destructive reset.

## 10. Tests and adversarial cases

Names below are **required new case names/behaviors**, not a claim they already exist. Add them to the named existing suites or the explicitly proposed module tests. Keep production secrets/network out of offline tests. Use fake IO and local disposable databases for negative cases; never inject faults into production to prove a guard.

| External input / trust boundary | Hostile or failure case | Required test |
|---|---|---|
| Evidence path | `..`, absolute path, symlink, case alias escapes task namespace | `task_evidence_path_escape_refuses` |
| PR changed-file inventory | Truncated/unreadable list or hidden rename | `task_evidence_incomplete_inventory_refuses` |
| Evidence identity | Wrong issue/PR, inherited pair, partial or ambiguous current pair | `task_evidence_wrong_or_ambiguous_identity_refuses` |
| Evidence generation | Editing an already committed generation | `task_evidence_generation_mutation_refuses` |
| Implementation digest | Executable content hidden under metadata path | `task_evidence_executable_metadata_not_inert` |
| Source disposition catalog | Missing site, duplicate identity, empty justification, forged partition | `disposition_catalog_complete_and_reviewed` |
| Completion comment | Wrong repo/PR/merge SHA, unauthorized author or duplicate conflicting record | `completion_forged_or_conflicting_record_refuses` |
| Maintenance scope | `change_type` populated and valid merged maintenance work | `maintenance_change_type_has_supported_completion_path` |
| Issue state | Closed without proof; open with valid required-stage acceptance | `dependency_state_does_not_replace_stage_evidence` |
| Parent outcome | Parent accepted but child's specific assertion absent | `parent_acceptance_does_not_infer_child_success` |
| Live evidence | Applied but probe failing or application return unfinished | `applied_is_not_live_verified` |
| Ownership | Another session attempts closure without permitted authority | `completion_closure_authority_refuses_other_session` |
| Network write | Record accepted then response lost or crash before close | `completion_retry_after_lost_response_is_idempotent` |
| Dependency events | Duplicate, out-of-order, lost event or cycle | `dependency_event_replay_preserves_single_transition` |
| GitHub API | Rate limit, pagination ceiling, 403, stale cached state | `dependency_unreadable_state_is_unverifiable` |
| Self-service issue/SQL | Shared-schema reference, rename, existing migration edit, unknown SQL | `self_service_boundary_still_refuses_cross_schema` |
| Scheduled reporter | Any mutating IO method added or invoked | `queue_hygiene_remains_read_only` |
| Policy matrix | Contradictory review/activation/doc-route value | `current_policy_matrix_mismatch_refuses` |
| Effective checks | Missing/new ruleset context, stale mirror or untrusted settings attestation | `required_checks_unknown_authority_refuses` |
| Effective settings mutation | Repository or inherited ruleset changes after an unexpired attestation | `required_checks_policy_change_revokes_unexpired_attestation` |
| Check result | Spoofed producer, wrong head, duplicate old status | `required_checks_latest_trusted_head_only` |
| Advisory result | Optional red with every true required check green | `advisory_failure_visible_without_requirement_promotion` |
| PR settings artifact | PR tries to remove its own requirements | `pr_cannot_weaken_own_required_manifest` |
| Probe SQL | Side-effect function, write CTE or multi-statement input | `probe_read_only_execution_refuses_side_effects` |
| Probe result | False/null/zero rows/extra rows/extra columns | `probe_exact_true_row_shape_required` |
| Probe role/data | Missing EXECUTE, missing table, absent fixture, unbounded plan | `probe_runtime_qualification_refuses_before_promotion` |
| Probe artifact | Changed hash, wrong source/role/target/migrations | `probe_qualification_binding_mismatch_refuses` |
| Proof stage | Preview qualification submitted as final production acceptance | `preview_proof_is_not_production_outcome` |
| Merge attempts | Two simultaneous writers, head movement after preparation | `merge_lock_revalidates_and_admits_single_writer` |
| Production interaction | Merge while production freeze is active | `production_freeze_still_blocks_merge` |
| Target group | Alias or attacker-supplied group name for same database | `target_alias_cannot_escape_single_writer` |
| Cancellation | Old holder releases a newer holder's lock | `lock_release_requires_exact_ownership` |
| Quota wait | One preparation waits while unrelated prepared work is ready | `quota_wait_outside_mutation_lane` |
| Main movement | Inert versus policy/producer/migration-changing update | `promotion_manifest_accepts_only_proven_inert_drift` |
| Isolated baseline | Missing adopted object/seed, stale hash, failed prerequisite | `isolated_baseline_closure_required` |
| Test coverage | Relevant quarantine despite a green aggregate | `isolated_relevant_quarantine_refuses` |
| Evidence producer | Modified workflow, wrong job/head, tampered artifact | `isolated_evidence_requires_trusted_producer` |
| Apply retry | Write completed, artifact missing or duplicate attempts exist | `evidence_retry_never_reapplies_confirmed_migration` |
| Apply ambiguity | Ledger cannot be read after interrupted application | `ambiguous_apply_stays_blocked_without_rewrite` |
| Review packet | Missing terminal line or incomplete probe risk checklist | `review_brief_complete_before_draw` |
| Tier policy | Mixed/unknown/renamed migration or changed classifier version | `review_tier_unknown_or_stale_requires_two` |
| Prior refusal | Second slot rejected/returned then tier reduced | `review_refusal_cannot_be_reclassified_away` |
| Reviewer identity | Same provider used for both required slots | `two_slots_require_independent_providers` |
| Metrics | Too few samples, missing timestamps, bot update as progress | `throughput_insufficient_sample_never_claims_improvement` |

Use the current CI entrypoints as authoritative suite definitions: `.github/workflows/tools-offline-tests.yml` invokes Node tests, including throughput guard and repository identity suites; `.github/workflows/shared-supabase-migrations.yml` invokes all `scripts/test_*.py` through `python -m unittest`; `.github/workflows/database-contract-tests.yml` owns ephemeral/Postgres integration. Focused examples after the corresponding changes are `node --test scripts/agent-work-contract-git-evidence.test.mjs scripts/refresh-code-pr-branch.test.mjs`, `node --test scripts/lib/work-dependencies.test.mjs scripts/orchestrator-flow/admission-outcome.test.mjs`, and `python -m unittest scripts.test_shared_db_live_proof scripts.test_automatic_qualification_route scripts.test_production_preview_skip`. Check actual suite paths at current main before running. Run required full suites once at the landing boundary; do not keep rerunning green suites without a changed risk.

## 11. Constraints and operational traps

- Canonical checkouts are landing-only. Each write-capable task uses its own current-upstream worktree and verifies its branch before every commit. Never stage another session's files.
- Run `git var GIT_COMMITTER_IDENT`; it must be Albert Hazan with `u2giants@users.noreply.github.com`. Sign GitHub bodies with actual chat ID and machine. Every shared-db issue has `db-work` plus a valid `db-work-scope`; maintenance `writes:`/`reads:` are empty database-object lists, not file lists.
- Reuse issue owners and current work; a successor does not inherit route or object authority. Only the issue opener closes under current instructions. A marker is not self-authorized; resolve an actual structural destination with `node scripts/check-orchestrator-marker.mjs --resolve` only when routing shape work.
- Never push protected main directly. Own and complete the PR merge under repository policy. This prose planning publication follows Albert's prose-only merge exception after verifying the full file list. Future scripts/workflows/configuration/rule changes use their normal guarded route and checks; do not infer executable exemption from this plan's publication.
- Do not edit applied migrations, hand-delete claims/reviewer refs, expire-away object ownership or sweep dirty/remote worktrees. Roll forward or use reviewed recovery.
- No background session fan-out without explicit scope/ownership; no count ceilings. Only protected shared operations serialize.
- Use repository transport/conditional-read helpers; no new parallel GitHub clients, unsanctioned polling loops or weakened timeout limits. Watch checks with the existing bounded event-aware waiter. Diagnose stalls at a stated threshold.
- No public data leaks. This repository is public. No licensed source rows, customer/order contents, tokens, raw prompts/transcripts, private artifact paths or secret values in tests/reports/issues.
- Before production trigger/infrastructure/state changes, follow the standing incident/runbook and exact-resource approval rules. Existing automatic promotion is the narrow exception, not blanket authority for manually dispatched production commands.
- Keep every fallback/refusal visible and actionable. Missing inventory is not zero; an empty table is not proof a loader did not run; catalog absence is not proof no migration exists. Check actual ledger and relevant evidence when needed.
- Keep documents, handoff and scope state accurate after each accepted step. A green unrelated workflow is not the step's proof.

## 12. Access and environment

Planning host: Windows 11 `916-ALIEN`, PowerShell 7, Node.js and Python test tooling, Git and authenticated `gh`. Planning worktree: `C:/Users/ahazan2/.codex/worktrees/orchestrator-workflow-audit/shared-db`, branch `codex/orchestrator-workflow-refactor-plan`. Future sessions must use their own managed worktree from fresh `origin/main`, not reuse this directory blindly. Repository: `https://github.com/popcre/shared-db`; target branch: `main`.

Read-only GitHub access was verified through issue, PR, Actions and branch-protection APIs during planning. The workflow's integration token cannot necessarily read what the interactive `gh` identity can; that discrepancy is Step 6's problem. Authenticate via supported tools; do not ask Albert to run commands before checking the available access yourself.

No database credential was loaded and no live SQL was run for this plan. For an implementation step that genuinely requires database access, load `codex-shared-db-change` and read `docs/agents/runbooks-credentials-cli-and-gotchas.md`. Secrets are in 1Password vault **`vibe_coding`**. Resolve the exact current item title from that runbook/configured target after loading `secrets-to-1password`; no item title or credential was verified during planning, so none is invented here. Access 1Password serially; move values through protected files/pipes, never arguments or output. Use the read-only role for inspection/proof execution and the existing governed workflow for authorized mutation.

Discover preview with `gh variable get PREVIEW_PROJECT_REF --repo popcre/shared-db`. Prove any CLI/MCP target immediately before a write; an MCP may be production-bound. Local ephemeral integration uses the exact bootstrap and services defined by `database-contract-tests.yml`, not an empty handcrafted database assumed equivalent. No UI app is added by this plan; UI screenshots are N/A unless a later scope explicitly adds a user interface.

Canonical machine/tool skill changes belong in a separate `popcre/ai-devops` worktree. Read that repository's own AGENTS and task gates before modifying it. No persistent personal memory update is part of this request.

## 13. Definition of done, risks and open decisions

### Done means

- Every finding is mapped to an accepted step or explicit evidence-backed policy disposition; no finding disappears because its ticket was closed.
- Each implementation is committed, pushed and merged; required checks pass; workflow/tool deployment and exact running revision are verified where applicable.
- Each live outcome has its own proof or one owned leftover-proof issue created at landing. An umbrella cannot conceal several unproven steps.
- Required-check authority, target identity, independent review, collision/version protection, dependency closure, write isolation and post-apply verification remain effective under the adversarial cases.
- Independent task artifacts and dispositions no longer force unrelated edits; qualified isolated work actually avoids unrelated preview waits; preparation does not occupy shared mutation lanes.
- Maintenance delivery and dependency readiness are truthful; closed-without-proof and open-but-accepted cases remain distinct; closure authority is preserved.
- Canonical instructions, linked skills, STATUS and handoff match accepted behavior. Completed predecessor handoffs are retired only under the documented successor rule. Root `HANDOFF.md` remains untouched.
- Metrics report real sample sizes and comparable latency/defect results. Insufficient evidence remains explicitly insufficient, not a marketing claim.
- Tracker 3306, non-orchestrator work, closes only when its selected implementation/policy obligations are accepted; its handoff is retired then. Publishing this plan alone leaves implementation open.

### Main risks and rollback

The largest risk is accepting evidence produced for the wrong task, baseline or policy while simplifying coordination. Version readers before writers, use explicit immutable bindings and negative fixtures, shadow compare before enforcing changed authority, and preserve the prior safe route until replacement acceptance. Never roll back a reader so it cannot understand already-issued valid records.

Parallel queue changes can expose races formerly hidden by broad serialization. Prove the compatibility matrix and exact ownership release with fake interleavings, then bounded non-production traces, then authorized real work. If unsafe, restore old grouping without disabling protection or altering applied history.

Isolated databases may omit production dependencies/data semantics. Unknown coverage stays on shared rehearsal. Reviewer-count reduction might lose important defects; retain two until the evidence and authority support a narrow amendment. Documentation consolidation may erase nuance; preserve historical rationale while clearly separating it from current commands.

### Open decisions with deterministic handling

| Decision | Owner / required evidence | Default that permits useful progress |
|---|---|---|
| Exact active owner for each existing overlapping issue | Step 0 implementation session, using current issue/PR activity and explicit acceptance | Take a non-overlapping step; do not take over silently |
| Whether maintenance completion gap persists | Step 3 implementer, reproducing fixture against current main | Preserve guards; fix only confirmed unsupported path |
| Whether no-preview automatic transition should replace the deliberate hop | Step 11 proposer and independent authorized technical reviewer; P2 exact scope/dispatch contract | Use the existing governed isolated route; no new production automation |
| Whether second review is dispensable for a narrow class | Step 13 proposer plus explicit policy adoption, measured defect/latency evidence | Keep two; improve briefs and reuse |
| Whether historical children can close | Original issue owner, exact acceptance and completion evidence | Report delivered-closeout-pending only when proven; preserve genuinely unmet outcomes |
| Whether isolated baseline covers a change | Deterministic classifier/closure proof with qualified engineer review of unsupported cases | Shared preview, with reason and owner |
| Whether performance improved | Step 14 owner, comparable sufficient samples | Report insufficient sample and continue measuring without blocking safe delivery |

No new owner answer is required to publish this plan or begin the non-policy implementation steps. This does not pre-authorize policy activation or production mutations. Prepare any later required approval as a complete, reviewable result and raise all then-known decisions together.

### Mandatory planning self-audit

All thirteen required sections are present. The STATUS table identifies every step as open, and the plan/handoff link both ways. §1 states the business goal and conflict rule; §§2–6 provide system, trigger, scope, current state and evidence; §7 records dead ends; §8 distinguishes locked decisions from proposals; §9 names files, behavior, dependencies, rollout, rollback and verification per step; §10 defines adversarial inputs and named tests; §§11–12 define constraints/access; §13 defines landing, measurement, risks and decision handling. No planning-chat knowledge or secret value is required.

1. **Can a brand-new session execute without asking the planner for context? Yes.** §§2–6 establish the system and source evidence; Step 0 resolves changing owners from live sources; §9 gives each concrete edit boundary and success test; §§8/13 give defaults and exact activation decision points. The plan does not promise away external authorization: it tells the implementer exactly which work can proceed and what evidence a later approval needs.
2. **Does it preserve the reasoning and rejected approaches? Yes.** §§3, 6 and 7 preserve actual failures, the shared-ledger constraint, maintenance-completion caveat, existing self-service/queue work, partial baseline coverage, intentional manual hops and why blanket guard removal was rejected. §§8–10 preserve the resulting tradeoffs and negative cases.
3. **Is the ultimate goal sufficient to guide a correct judgment call? Yes.** §1 prioritizes verified application delivery over both bureaucratic waiting and false success; §§8/13 turn that goal into invariant safeguards, conservative defaults and measurable acceptance. A step that adds an artificial program-wide dependency conflicts with that goal and must be corrected.

**Self-audit result: PASS for the planning artifact.** Implementation, policy activation and live acceptance remain the separately tracked open work above.
