# Plan: author-lane abandonment lifecycle and permanent retirement

Tracked by [issue #2301](https://github.com/u2giants/shared-db/issues/2301). It was registered by the handoff `HANDOFF.d/2026-09-04T1453Z-edge-dev-codex-author-lane-lifecycle-plan.md`, which was retired when the work finished; this file is the durable record in its place.

This is repository-maintenance work. It authorizes no database migration, database write, preview deployment, production deployment, infrastructure change, claim cleanup, pull-request closure, or worktree mutation.

## STATUS — read first

| Step | Deliverable | State | Evidence |
|---|---|---|---|
| 1 | Extend relinquished-claim metadata and fail-closed parsing | ✅ complete | Phase A PR #2640 merged 2026-09-15 as `7eac0c7110e597bb8380c75037f2f1b4730d6a9b` (guarded merge at head `e7619dc3e391cefa016c5cfad8510d59b41d6cbe`, governed APPROVE ref `refs/db-review-verdicts/2994-2640-e7619dc3e391cefa016c5cfad8510d59b41d6cbe`, sub-issue #2994 closed); implementation commit `c039ca46e21528ef4d2ded2e7f8b5137dfd0aadf`; pre-cut census recorded on issue #2301; 528 focused manager/reconcile/lease tests passed |
| 2 | Make capacity relinquishment machine-independent and recovery-gated | ✅ complete | Phase A PR #2640 merged 2026-09-15 as `7eac0c7110e597bb8380c75037f2f1b4730d6a9b`; at that exact head 630/630 lane/capacity, 57/57 exclusive-lease and scenario, and 252 production-guard tests passed; clean/dirty/absent/remote and recovery/rollback scenarios passed; recovery artifacts are dereferenced, not shape-checked; 533 lane/capacity tests, 57 exclusive-lease/scenario tests and 239 production-guard tests passed |
| 3 | Add immutable terminal-retirement tombstones and resurrection guards | ✅ complete | Phase B PR #3000 merged 2026-09-15 as `1dcf196ea9b506ec14feb55e8465b53d9faf1706` (guarded merge at head `cd4aa51dd35d9c8d7cb828dd215f54d798f1b34c`, implementation commit `43c14f8d96895a945679d1a6d769ae16121097c1`, sub-issue #2999). A tombstone is written before the claim closes and read back before it is trusted; a retired version is refused on every claim-reactivation path, not only on acquire; malformed and conflicting payloads fail closed |
| 4 | Separate capacity reconciliation from preview readiness | ✅ complete | Phase C PR #3010 merged 2026-09-15 as `0a11c42d3e373fe9b45e826a3015c93bb7cf4704` (guarded merge at head `c94a69ca93b1dc78b6753e740cfb4c575ec2c718`, implementation commit `c922c0c99219cbdfba14f356bf6aa84b28947a98`, sub-issue #3011). Capacity truth and preview truth are reported separately, each with its own status, so an unreadable preview edge can no longer make capacity look healthy |
| 5 | Add hourly and dispatch-time read-only detection | ✅ complete | Phase C PR #3013 merged 2026-09-16 as `95e1ac957a9692bbcaf00a46c9c9073abd25e2d7` (guarded merge at head `b1f9bbc0f304ed52f9223c29c6310df2492d1f10`, governed APPROVE ref `refs/db-review-verdicts/3012-3013-b1f9bbc0f304ed52f9223c29c6310df2492d1f10`, implementation commit `b5fcd818c270f765e5d9e2779e8e77465c3ecdf4`, sub-issue #3012). `--abandonment-audit` runs the Step 4 reconciler with its write hooks removed before the reconciler sees them, so it is read-only by construction rather than by environment; exit `0` clean, `2` expired, `3` unverifiable, with unverifiable outranking expiry. The hourly `Author Lane Abandonment Audit` workflow holds only `read` scopes and files nothing. The orchestrator skill half landed as `popcre/ai-devops` PR #491, merge commit `131f1167ff12d7229238e40213cb842beca945cb`, and `node scripts/check-skill-drift.mjs` reports no contradictions against that landed text |
| 6 | Synchronize operating rules, skill text, and abandonment evidence template | ✅ complete | Phase D PR #3016 merged 2026-09-16 as `3fdd16effbd154e1602c29aa5610161910138d68` (guarded merge at head `4f3f25b86a81d290467461ce53315a82ba389c72`, governed APPROVE ref `refs/db-review-verdict-replacements/3015-3016-a44638c2f704ac4a19a74db1a8e4e9867f153468-2918`, implementation commit `1d1ed815e7aec817fcf74482413c111c7b7f48ff`, sub-issue #3015). `AGENTS.md`, `docs/agents/section-4-anti-collision-rules.md` and the new `.github/ISSUE_TEMPLATE/author-lane-abandonment.md` now state the same lifecycle the code enforces, and twelve agreement tests in `scripts/test_production_migration_guard.py` fail if any venue drifts. The reviewer caught three real defects before merge: the printed commands used the boolean `--claim` instead of the value flag `--claim-number`, the printed relinquish omitted the mandatory `--worktree-state`, and the template shipped no machine-readable `abandonment-audit` fence, so the guarded revalidation could never have run. The orchestrator skill half landed as `popcre/ai-devops` PR #493, merge commit `db3d0b9cb7f8c08fd34c8b57bdff6127de063a25` |
| 7 | Full regression, independent review, guarded landing, and live report proof | ✅ complete | Phase D. Full §10 suites at this head: 653/653 capacity/reconcile/lane/lease, 57/57 exclusive-lease and coordination scenarios, 272 production-guard tests OK. Live read-only proof on 2026-09-16 found and fixed a real defect the unit suites could not see: `--abandonment-audit` refused outright and described no lane at all, because live claim #2871 is titled `CLAIM: issue-2870-cutover-columns` and the identity read threw out of the snapshot before any lane was described — one legacy title silenced the whole hourly instrument. The claim-identity read is now its own failing leg, so one unreadable claim is one unreadable row. The hourly workflow run at head `3fdd16ef` proved a second, separate defect in how that refusal was announced: the generic handler exits `2`, which on this command already means "an expired author lane was found", so the job logged `Expired author lane(s) detected` about lanes it had never managed to read. A refusal on `--abandonment-audit` now exits `3`, because an instrument that could not read is exactly the unverifiable case and unverifiable outranks expiry; the refusal message is still printed in full, and every other command keeps exiting `2`. Both fixes are pinned by their own tests (lanes 580/580). The live audit then reported all eight lanes with `mutating: false` and zero mutating actions: capacity 8 issues / 7 actions / 1 unverifiable, exit `3`. That agrees exactly with `--queue-audit`, which reports the same seven lanes without a live lease (six expired reports plus the one unreadable claim) and one active lane. No database, preview, production or infrastructure write occurred, and no ref, branch or worktree was deleted |

**This plan is complete. Nothing here is left to implement.** Steps 1–6 landed on `main` between 2026-09-15 and 2026-09-16, Step 7 is the change that carries this paragraph, and issue #2301 is closed as soon as this change is verified on `main`. The file stays as the durable record of what was built and why: read the STATUS table for the exact commits, §7 for the twelve approaches that were rejected, and §13 for the proven definition of done. Do not restart it, and do not re-run a phase to "check" it — the live lifecycle is already in force, and applying it to a live claim needs that claim's own current evidence and an authorized operator decision, never this plan as authority.

---

# Part 1 — Why

## 1. The ultimate goal

Database work must keep moving even when an author session stalls or disappears, without allowing two authors to change the same database objects and without losing unfinished work.

When this plan is complete, an abandoned work item can stop consuming one of the eight active-author slots while its database-object locks, migration-version reservation, branch, pull request, and worktree remain protected. Returning work can resume only after its state is recovered and every current collision and capacity rule passes. Work deliberately retired as unrecoverable can never silently re-enter later.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Never trade collision safety, recoverability, or unfinished work for apparent queue movement.

## 2. What this application is

`u2giants/shared-db` is the canonical public repository governing the structure of the shared Supabase database used across POP Creations applications. Its migration-author manager gives unrelated structural changes parallel author capacity while preserving exclusive claims over migration versions and database objects.

The coordination implementation is Node.js ESM under `scripts/`; policy is in `AGENTS.md` and `docs/agents/`; required checks run in GitHub Actions. GitHub `main` is the code truth. Structural database work is dispatched only by the single live shared-db orchestrator, but this plan and its implementation are `repo-maintenance` and must be completed by a separate repository session.

The repository is public. Do not put application rows, licensed-source contents, secrets, private paths beyond necessary worktree identities, or private session transcripts into commits, issues, logs, test fixtures, or reviewer prompts.

## 3. What triggered this work

On 2026-09-04 another session reported that all eight author lanes were occupied and that stalled authors with open pull requests prevented new dispatch. A fresh read-only audit at commit `1e2f5ee79f6a72a7d445dbf5db73ac203beb31a9` returned:

- eight of eight active-author capacity slots occupied;
- five claims classified `expired-unconfirmed`: #2181, #2226, #2195, #2184, and #2182;
- three claims classified active;
- zero relinquished claims and no dispatchable lane.

This is reproducible read-only with:

`node scripts/manage-migration-author-lanes.mjs --queue-audit`

Counts are a dated incident snapshot, not a permanent assertion. Re-run the command before any implementation or operational conclusion.

Codex and GLM 5.3 debated the repair in persistent GLM session `author-lane-lifecycle`. Both concluded that the Phase 2 separation between claim protection and author capacity is fundamentally correct, but lifecycle handling is incomplete. GLM independently identified five gaps:

1. no scheduled or event-wired detection;
2. reconciliation has no actionable `expired-unconfirmed` branch;
3. the repository has no durable author-abandonment evidence type;
4. capacity relinquishment depends on reading a local worktree on the invoking machine;
5. preview uncertainty collapses the entire reconciliation result to `UNVERIFIABLE`.

The debate also identified a sixth gap: a released claim issue can be manually reopened, and retired branch/worktree identities are not rejected at acquisition. Current guards prevent the old work from merging, but do not prevent confusing or capacity-consuming re-entry.

## 4. Scope

### In scope

- richer, fail-closed metadata for `capacity_state: relinquished`;
- safe capacity-only relinquishment when a worktree is clean, dirty, absent, or remote;
- recovery-gated atomic resume;
- an immutable retirement tombstone for deliberately finished/abandoned claims;
- refusal of retired claim, branch, worktree, and version tuples;
- independent capacity and preview reconciliation outcomes;
- report-only expiry detection hourly and before dispatch;
- an abandonment-audit evidence template and operating procedure;
- unit, scenario, failure-injection, workflow, policy-drift, and live report verification;
- synchronized shared-db rules and the canonical `shared-db-orchestrator` skill source.

### NOT in this plan

- any database schema or row change;
- automatically deciding that an author abandoned work;
- treating elapsed time or lease expiry as abandonment proof;
- deleting, moving, cleaning, resetting, or overwriting any worktree;
- automatically closing a pull request or claim issue;
- deleting claim, reservation, reviewer, or retirement refs;
- weakening collision, version, lease, reviewer, preview, merge, or production gates;
- permitting expired or relinquished work to merge;
- raising the eight-lane cap as an accounting workaround;
- changing the reviewer-provider pool;
- repairing the distinct expired-claim expansion defect tracked by issue #2280;
- immediately clearing the five claims in the dated incident snapshot. Each needs its own current evidence and authorized lifecycle decision after this tooling lands.

---

# Part 2 — What we already know

## 5. Current state of the code

All references below describe `main` at `1e2f5ee79f6a72a7d445dbf5db73ac203beb31a9`. Re-resolve lines after rebasing; function names and behavior are authoritative.

### Already implemented and working

- `scripts/manage-migration-author-lanes.mjs:39-40` sets eight author-capacity slots and recognizes `active`, `relinquished`, and derived `expired-unconfirmed` states.
- `parseAuthorLease()` near line 780 derives `expired-unconfirmed` when an active lease passes its time, but keeps `capacityActive` true. Expiry therefore frees nothing.
- `assertLaneAvailable()` near lines 813-827 counts only capacity-active claims against the cap but collision-checks every protected claim, including relinquished claims.
- `relinquishAuthorLease()` near lines 4200-4236 changes only the claim issue body under the author mutex, with readback and rollback. It does not delete the claim, version reservation, branch, PR, worktree, or stage ref.
- `resumeAuthorLease()` near lines 4239-4283 atomically reacquires capacity, renews time, checks the permanent version reservation, and rechecks collisions/capacity.
- `renewExpiredClaim()` near line 4287 restores an expired active claim through exact matching guards.
- `scripts/check-migration-pr-lease.mjs:34-37` requires exactly one matching open claim and refuses expired or non-active capacity. A relinquished claim cannot merge.
- `scripts/reap-merged-worktrees.mjs` limits cleanup to merged work and refuses dirty worktrees. Open-PR abandoned work is not automatically reaped.
- `--queue-audit` reports expired claims and exits 2 when queued work is behind them.
- `scripts/orchestrator-flow/capacity-state.test.mjs` covers separation of protection and capacity, expiry retaining capacity, more protected claims than the cap, and guarded relinquish/resume.
- Phase 2 is recorded complete in `plan_orchestrator_throughput_phase_2.md`; this plan is a follow-on lifecycle repair, not a reason to reimplement Phase 2.

### Incomplete or defective

- `relinquishAuthorLease()` currently requires `io.localClean(lease.worktree)` near line 4218. The check runs on the invoking machine and blocks exactly the remote/absent/dirty cases that need capacity-only quarantine.
- `localClean()` near line 1529 uses `git status --porcelain`. Even success does not prove all commits were pushed, so it is not durable-work preservation proof.
- `resumeAuthorLease()` has no worktree recovery precondition.
- `replaceCapacityState()` and `parseAuthorLease()` have no `worktree_state` or recovery-artifact fields.
- the shared `AUTHOR_CAPACITY_STATES` array currently also accepts `expired-unconfirmed` as a declared fence value even though it should be a derived read state only;
- `reconcileFlow()` in `scripts/orchestrator-flow/reconcile.mjs:82-91` relinquishes only declared active capacity with an unresolved durable blocker. It has no actionable expired-claim transition.
- `flowSnapshot()` derives preview readiness for every claim; one preview error makes the aggregate result `UNVERIFIABLE`, even though capacity actions execute independently.
- no GitHub workflow invokes `--queue-audit` or `--reconcile-flow` for author-capacity detection.
- `--release-claim` closes a claim but writes no immutable terminal record.
- `openClaims()` treats a manually reopened retired claim as active again.
- new claim acquisition does not reject an open or retired duplicate branch/worktree identity.
- current tests commonly stub `localClean: () => true`; dirty, absent, remote, and throwing cases are not covered.

### Repository and deployment state

- No implementation for issue #2301 exists yet.
- This plan is documentation only and must land on `main` through a branch and pull request.
- There is no application deployment or database promotion for this work. Completion is GitHub `main`, required CI, and live read-only command behavior.

## 6. Key findings and root cause

### Root cause

Phase 2 correctly separated durable claim protection from renewable author capacity, but the operational lifecycle still assumes a reachable, clean worktree and an explicit human transition. When an author disappears, the claim expires into `expired-unconfirmed`, which intentionally remains capacity-active. The queue can therefore fill with safe-but-unresolved claims.

The permanent fix is not to remove locks. It is to make “stop consuming capacity while preserving everything” a complete, evidence-backed lifecycle across all worktree states.

### Non-obvious findings

1. **Open PR is not the cause.** The claim issue and its lease fence are the capacity source. An open PR should remain because it helps preserve recoverable work.
2. **Expiry is not proof of abandonment.** Slow CI, owner decisions, provider outages, or legitimate pauses can outlive a lease. Expiry must remain advisory and fail closed.
3. **Clean local worktree is not durable proof.** `git status` can be clean while unpushed commits exist, and a remote worktree cannot be inspected from another machine.
4. **Capacity-only relinquishment is non-destructive.** The current operation changes only claim metadata; all work and collision protections remain.
5. **Protection must outlive capacity.** Releasing the object claim merely to free a slot would allow a second migration to overlap the first.
6. **Recovery needs explicit evidence.** Dirty/absent/remote work cannot resume merely because the author returned; the system needs proven clean state or an immutable recovery artifact.
7. **Terminal retirement needs a tombstone.** Current closed-claim guards stop merge/resume, but manual issue reopening and identity reuse can reintroduce retired work into capacity and queue calculations.
8. **Capacity and preview are separate questions.** Missing preview readiness must not make read-only capacity truth unavailable.
9. **Reviewer slots are unrelated.** There are eight migration-author lanes and a separately configured reviewer-provider pool. Never use reviewer-lease repair commands for this incident or infer one system's capacity from the other.

## 7. Approaches considered and REJECTED

These decisions were agreed by Codex and GLM 5.3 on 2026-09-04 and are locked unless new evidence proves a safety defect.

1. **Increase the cap above eight.** Rejected because it postpones recurrence and hides incorrect lifecycle accounting.
2. **Release or delete expired claims automatically.** Rejected because it drops object/version protection and can dispatch overlapping migrations.
3. **Use a wall-clock TTL as abandonment proof.** Rejected because time cannot distinguish a dead author from legitimate blocked work.
4. **Automatically close open PRs.** Rejected because PRs preserve work/evidence and closure is not proof that work is disposable.
5. **Delete refs by hand.** Rejected because refs are durable coordination authority; manual deletion silently removes safety history.
6. **Clean, reset, move, or delete the abandoned worktree.** Rejected because it can destroy uncommitted work and is unnecessary for capacity-only relinquishment.
7. **Require physical recovery of the original worktree before any capacity release.** Rejected because a remote or dead machine would retain a slot forever even though all locks can remain safely protected.
8. **Add a new top-level `quarantined` capacity state.** Rejected because its control behavior equals `relinquished`; metadata supplies the recovery distinction without widening every parser and validator.
9. **Allow resume solely from an operator assertion.** Rejected for dirty/absent/remote work; resume needs verified cleanliness or a typed immutable recovery artifact.
10. **Treat the existing closed-claim guards as sufficient retirement.** Rejected because a claim issue can be reopened and retired branch/worktree identities can be reused.
11. **Globally freeze mutations when any preview is unverifiable.** Rejected because unrelated stage serialization already protects preview/merge/production; capacity truth should be reported independently.
12. **Conflate this with issue #2280.** Rejected. #2280 repairs atomic expand-then-renew of an expired claim whose PR reveals child objects. This plan handles abandonment, quarantine, recovery, and retirement.

## 8. Design decisions already made

### Locked decisions

- **One capacity state, richer metadata:** use `capacity_state: relinquished`; do not add `quarantined`.
- **Mandatory state evidence:** every relinquished fence carries `blocked_on` plus `worktree_state: clean|dirty|absent|remote`.
- **Optional recovery evidence:** `recovery: artifact:<https-url-or-40-to-64-hex-digest>` uses the existing typed-artifact discipline.
- **Opportunistic local inspection:** a reachable clean worktree records `clean`; false/throw/absence never silently passes and must record the explicitly supplied accurate state.
- **No protection changes:** relinquishment changes capacity metadata only.
- **Recovery-gated resume:** dirty/absent/remote work resumes only after proven clean on the resuming machine or a valid recovery artifact.
- **Immutable terminal record:** use create-if-absent `refs/db-claims-retired/<version>` as machine authority plus a manager-written human-readable terminal block on the claim issue.
- **Create first, close second:** terminal tombstone must be written/read back before the claim issue is closed. Failure leaves the claim open.
- **Permanent old version:** successors always receive a newly reserved migration version. Neither the original reservation nor retirement tombstone is deleted.
- **Identity refusal:** active and retired branch/worktree identities cannot be reused.
- **No automatic abandonment decision:** mutation requires a typed durable abandonment-audit issue or immutable artifact and the live marker/mutex guards.
- **Owner boundary:** clean or proven-absent routine retirement may be executed by the orchestrator with evidence. Retiring `dirty` or `remote` potentially recoverable uncommitted work needs Albert’s explicit decision; capacity relinquishment does not.
- **Detection cadence:** report before dispatch and hourly as a read-only backstop. No scheduled mutation.
- **Independent result domains:** capacity and preview each return per-issue outcomes and separate summary/exit semantics.
- **Derived expiry is never writable:** split declared states (`active`, `relinquished`) from derived read states; claim creation and replacement must refuse a written `expired-unconfirmed` value.

### Open implementation judgment

- Exact JSON property names for independent reconciliation summaries may vary if backward compatibility requires it, provided capacity and preview truth remain separately machine-readable and existing consumers do not silently change meaning.
- The abandonment-audit issue may use an issue form or a checked-in template. Prefer the fewest moving parts that guarantees all required fields and `db-work`/scope classification.
- The exact CI workflow filename and schedule minute are flexible. It must run hourly, have bounded timeout/concurrency, be read-only, and expose failures without creating duplicate issues/comments.

---

# Part 3 — How to build it

## 9. The plan

### Phase A — represent and safely relinquish recoverable work

#### Step 1 — extend the lease fence and parsers

Change:

- `scripts/manage-migration-author-lanes.mjs`
  - `parseAuthorLease()`;
  - `claimBody()`;
  - `replaceCapacityState()`;
  - CLI argument parsing/help for explicit `--worktree-state` and `--recovery-artifact` inputs;
  - any duplicate parser used by audit/guards.
- `scripts/check-migration-pr-lease.mjs` only if its parser contract requires synchronized fields; it must retain the same merge refusal.
- `scripts/orchestrator-flow/capacity-state.test.mjs` and `scripts/manage-migration-author-lanes.test.mjs`.

Behavior:

- `worktree_state` is required if and only if declared capacity is `relinquished`.
- accepted values are exactly `clean`, `dirty`, `absent`, `remote`;
- `blocked_on` remains mandatory for relinquished capacity;
- `recovery` is absent or one typed `artifact:` reference validated with the same URL/digest strictness as blocker artifacts;
- active and legacy-compatible claims retain their current grammar and behavior;
- duplicate, missing, unknown, or contradictory fields fail closed;
- clock-derived `expired-unconfirmed` remains derived, never written as declared state.
- before changing the parser, a read-only census of every open claim body must prove no fence currently declares `capacity_state: expired-unconfirmed`; save the privacy-safe count and claim numbers as issue #2301 evidence. If any exist, do not reinterpret or mutate them: add a guarded exact-claim normalization sub-step to this plan that can choose renew or relinquish only from current evidence, and land that recovery before tightening the parser.

Dependencies: none. Preserve backward compatibility for every existing active/relinquished claim shape; if existing relinquished live claims lack the new field, add an explicit legacy parse path that reports `worktree_state: unknown-legacy` and blocks mutation until reconciled. Do not reinterpret them as active or silently synthesize `clean`.

Verification gate: the focused parser tests pass and prove the full valid/invalid matrix, including legacy behavior. Run:

`node --test scripts/orchestrator-flow/capacity-state.test.mjs scripts/manage-migration-author-lanes.test.mjs scripts/check-migration-pr-lease.test.mjs`

#### Step 2 — make relinquish machine-independent and resume recovery-gated

Change:

- `relinquishAuthorLease()` and `resumeAuthorLease()` in `scripts/manage-migration-author-lanes.mjs`;
- production `githubIo.localClean()` handling near line 1529 without weakening its other call sites;
- `scripts/orchestrator-flow/capacity-state.test.mjs`;
- `scripts/coordination-scenarios.test.mjs`.

Behavior:

- relinquishment still requires exact claim/owner, typed live blocker, no active preview/merge/production holder, mutex ownership, readback, rollback, and event emission;
- local inspection is evidence, not an unconditional precondition:
  - inspection passes → record `clean`;
  - inspection returns dirty → accept only explicit `--worktree-state dirty`;
  - path not found → accept only explicit `absent`;
  - known other machine/unreachable context → accept only explicit `remote`;
  - ambiguous error → refuse rather than guessing;
- capacity becomes non-active while claim/version/branch/PR/worktree remain untouched;
- idempotent replay requires an identical blocker, state, and recovery tuple;
- resume from `clean` follows current guards;
- resume from `dirty`, `absent`, or legacy unknown requires current proven-clean state or a **dereferenceable** immutable recovery artifact;
- resume from `remote` requires a dereferenceable recovery artifact **regardless of local observation** — a clean tree at the same literal path on this machine is a different tree and can never stand in for the machine that holds the work;
- an unreadable or ambiguous worktree observation **blocks resume even when a recovery artifact is present**; an unknown state is never excused by a stored reference;
- successful resume removes relinquishment-only metadata, renews expiry, rechecks capacity/collisions/version, and records events atomically;
- no code path deletes, moves, cleans, resets, or writes inside the worktree.

**What "recovery-gated" means here, exactly.** A recovery artifact is accepted
only if it is an immutable object hash this repository can dereference right
now, through `githubIo.verifyArtifact()` (`git cat-file -t`). Shape validation
alone was rejected during review of PR #2640: forty invented hexadecimal
characters are well-formed, so a shape-only gate is an assertion, not a control.
Two consequences are deliberate and recorded here rather than left implicit:

- an `artifact:https://…` reference is **refused** for `--recovery-artifact`,
  because this tool cannot dereference a URL. https references remain valid for
  `--blocked-on`, which is an informational blocker rather than a recovery gate;
- the stored reference is **re-verified on every resume**, never trusted because
  it was accepted once.

**Legacy relinquishment freeze applies to every mutator.** A pre-Phase-A
relinquished fence (`relinquishmentMetadataLegacy`) is refused by
`resumeAuthorLease`, `renewExpiredClaim`, `recoverExpiredClaimFromPr`,
`expandActiveClaimFromPr`, and `expandActiveClaimFromIssue`. Enforcing it on the
resume path alone would have let a legacy claim be renewed or expanded around
the freeze.

**Orchestrator flow adapters (`githubFlowAdapter`) call
`relinquishAuthorLease`/`resumeAuthorLease` without `worktreeState` or
`recoveryArtifact`.** That is intentional and it fails closed: those adapters can
only relinquish work whose worktree is observably clean on the calling machine,
and can only resume work that is observably clean now. **Machine-independent
relinquishment (`dirty`/`absent`/`remote`) is NOT reachable through the flow
adapters** and must be driven through the CLI with explicit evidence flags. No
caller should assume otherwise.

Dependencies: Step 1.

Verification gate: failure-injection tests cover `localClean` true, false, missing path, known remote, and thrown ambiguous error; blocker closure between snapshot and mutation; crash/readback rollback; idempotent replay; resume refusal and both recovery-success paths. Existing collision and required-check tests remain green.

**Fresh-session cut:** after Phase A lands, update this STATUS table with commit/CI evidence, re-read Phase B against current `origin/main`, and start a new isolated session.

### Phase B — make deliberate retirement permanent

#### Step 3 — add immutable retirement tombstones and resurrection guards

Change:

- `scripts/manage-migration-author-lanes.mjs`:
  - add the canonical retired-ref prefix `refs/db-claims-retired/`;
  - parse/format/validate a versioned retirement payload;
  - extend `--release-claim` with exact retirement evidence;
  - add one bounded retirement-ref snapshot per command;
  - refuse tombstoned tuples in acquire, resume, renew, expand, split recovery, and other claim-reactivation paths;
  - reject duplicate active or retired branch/worktree identities at acquisition;
  - report `RETIRED-REOPENED` when an open claim’s version is tombstoned.
- `scripts/check-migration-pr-lease.mjs` and tests to pin existing exactly-one-open-claim/retired-branch merge refusal.
- `scripts/manage-migration-author-lanes.test.mjs` and scenario tests.

Tombstone payload must bind at least:

- schema version;
- claim issue number;
- PR number and exact head SHA;
- branch;
- migration version;
- recorded worktree path and `worktree_state`;
- typed retirement decision/evidence;
- successor issue number when one exists;
- creation time and actor identity derivable from the signed Git commit/ref target.

Behavior:

- `--release-claim` validates current claim/PR/evidence and creates the tombstone before closing the issue;
- identical retry is idempotent; conflicting existing tombstone refuses;
- unreadable or unavailable tombstone evidence fails closed;
- a manually reopened tombstoned claim cannot consume capacity, resume, renew, expand, merge, or be treated as ordinary queue work;
- new claims cannot reuse a retired branch or worktree path;
- successors use a fresh branch, worktree, claim, and permanently distinct migration version;
- retirement/tombstone refs are never deleted;
- dirty or remote terminal retirement requires an owner-decision record. Ordinary capacity relinquishment does not.

Dependencies: Step 1’s `worktree_state`. Step 2 should already be landed so retirement is not used merely to free capacity.

Verification gate: tests prove create-first/close-second ordering, rollback, identical retry, conflicting retry, malformed ref refusal, reopened claim refusal across every mutation path, branch/worktree reuse refusal, permanent version behavior, unaffected successor work, and zero retirement-ref deletion paths. API-budget tests prove one bounded ref listing rather than per-claim calls.

**Fresh-session cut:** after Phase B lands, update the STATUS table, re-read Phases C–D, and start a new isolated session.

### Phase C — make the problem visible and actionable

#### Step 4 — separate capacity reconciliation from preview readiness

Change:

- `scripts/orchestrator-flow/reconcile.mjs`;
- `flowSnapshot()` and CLI exit handling in `scripts/manage-migration-author-lanes.mjs`;
- `scripts/orchestrator-flow/reconcile.test.mjs`;
- any event schema/renderer tests touched by new report-only actions.

Behavior:

- each issue has separate `capacity` and `preview` outcomes;
- aggregate output exposes independent counts/statuses and does not call capacity truth unavailable merely because preview readiness cannot be derived;
- existing safe capacity actions continue independently;
- `expired-unconfirmed` produces a report-only action containing claim, expiry/age, PR state, blocker state, and queued-behind count;
- reconciliation never automatically transitions an expired claim. Its report emits the exact suggested `--relinquish-author-lease` shape only when the blocker is specifically a live `repo-maintenance` abandonment-audit issue naming the same claim/PR/head/owner; an ordinary work dependency is not abandonment evidence;
- the operator supplies `--worktree-state` explicitly when running that separate guarded command. The command revalidates the abandonment-audit issue, exact claim tuple, current worktree observation/result, mutex, and live orchestrator marker before changing capacity;
- expiry alone never mutates;
- missing/unreadable evidence remains exit 2 for its own domain;
- preserve backward compatibility or version the output explicitly. Never silently redefine existing `UNVERIFIABLE` consumers.

Dependencies: Steps 1–3.

Verification gate: tests combine multiple claims so one preview-unverifiable issue cannot hide another issue’s capacity report/action; expired without abandonment evidence reports only; an ordinary dependency blocker never produces a relinquish suggestion; an exact abandonment-audit issue produces only the suggested separate command; the separate command remains marker/mutex gated; stale blocker TOCTOU refuses; exit codes are deterministic per domain.

#### Step 5 — add hourly and dispatch-time read-only detection

Change:

- add one `.github/workflows/` workflow following the bounded/concurrent pattern of `.github/workflows/migration-ledger-drift.yml`;
- `scripts/test_production_migration_guard.py` or the repository’s canonical workflow-policy test;
- `C:\repos\ai-devops\skills\shared\shared-db-orchestrator\SKILL.md` in its own synchronized ai-devops change, plus the installed skill via the normal sync process—not by hand-editing only the installed copy.

Behavior:

- GitHub Actions runs the read-only JSON audit hourly and on manual dispatch;
- it has explicit least permissions, bounded timeout, concurrency cancellation, pinned runtime/actions, and no mutation token requirement beyond repository reads;
- non-empty expired claims produce a visible failing/attention result with exact claim and queued-behind counts but create no repeated issues/comments;
- malformed/unlabelled/unknown audit states remain fail-closed and distinguishable from expiry;
- the orchestrator skill requires a queue audit before every allocation/refill tick and tells the operator to use the evidence-backed lifecycle, not delete locks;
- scheduled workflows never call `--reconcile-flow` mutation.

Dependencies: Step 4 for stable output. The ai-devops skill change can be prepared in parallel but must not claim completion until shared-db behavior and drift tests agree.

Verification gate: workflow-policy tests prove schedule, permissions, timeout, concurrency, read-only command, and absence of mutating flags. A manual workflow run on the landed exact head reports the then-current live state accurately.

**Fresh-session cut:** after Phase C lands, update STATUS/evidence, re-read Phase D, and start a new isolated session.

### Phase D — document, review, and land the whole behavior

#### Step 6 — synchronize operating rules and abandonment evidence

Change:

- `docs/agents/section-4-anti-collision-rules.md`;
- relevant author-capacity sections of `AGENTS.md`;
- an issue-form/template or documented `db-work-scope` example for an abandonment audit;
- `C:\repos\ai-devops\skills\shared\shared-db-orchestrator\SKILL.md` canonical source and its drift fixture;
- this plan’s STATUS/current-state sections as phases land.

The abandonment record must identify claim, PR/head, recorded owner, branch, migration version, last known worktree/machine, expiry, evidence the author is terminal/unreachable, observed worktree state, and recovery/successor references. It must be privacy-safe.

Document two separate procedures:

1. **Quarantine/recovery:** create durable abandonment audit → relinquish capacity with explicit worktree state → keep PR/claim/locks/work untouched → recover → resume atomically.
2. **Terminal retirement:** when work cannot or should not return, record evidence → obtain Albert’s explicit decision only for dirty/remote potentially recoverable work → close PR through the normal authenticated operator flow → tombstoning `--release-claim` → successor obtains fresh tuple/version.

Record the already-settled authority boundary in both the rules and handoff: the orchestrator may retire `clean` work or `absent` work whose absence is proven and whose durable branch/PR evidence is complete; Albert decides only whether potentially recoverable `dirty` or `remote` uncommitted work may be abandoned.

Dependencies: Steps 1–5 so docs describe actual commands and output.

Verification gate: drift/static tests fail when AGENTS, docs, CLI help, workflow, or canonical skill disagree. A fresh-developer dry read can follow both procedures without chat context or unsafe improvisation.

#### Step 7 — full verification, independent review, guarded landing, and live proof

Before commit in each repository:

- recheck `git var GIT_COMMITTER_IDENT` equals `Albert Hazan <u2giants@users.noreply.github.com>`;
- rebase/merge current `origin/main` according to repository policy;
- inspect `git status --short` and actual diff;
- stage only owned files.

Run the full suites in §10. Obtain an independent read-only review bound to the exact final head. Because this is code/configuration, wait for all required GitHub checks. Open and merge the shared-db PR yourself only after exact-head approval and green checks. Land/sync the ai-devops skill change through its own repository policy and verify the installed skill matches the canonical source.

After merge, verify:

- `main` contains the merge commit;
- hourly workflow exists and a manual exact-head run reports current live capacity without mutation;
- `--queue-audit` and the split reconciliation report agree on current capacity facts;
- a hermetic fixture demonstrates relinquish preserving locks, recovery-gated resume, and retired resurrection refusal;
- no database migration, preview write, or production write occurred.

Do not apply the new lifecycle to live expired claims merely to prove it. Each live transition needs its own current evidence and authorized operator decision.

Verification gate: all definition-of-done items in §13 are proven with artifacts and the STATUS table cites them. Close issue #2301 only then and retire this plan’s handoff in the same completion change.

## 10. Tests required

### Focused unit and behavior tests

- lease parser accepts every valid new tuple and refuses missing, duplicate, unknown, contradictory, and illegal-state fields;
- declared-state writers and parsers refuse a written `capacity_state: expired-unconfirmed`; the pre-cut live census and any required guarded normalization are tested;
- legacy relinquished records are reported safely and cannot mutate until reconciled;
- local worktree evidence matrix: clean, dirty, absent, remote, ambiguous exception;
- relinquishment preserves claims, reservations, branches, PRs, worktrees, object locks, and stage serialization;
- idempotent relinquish requires identical evidence;
- resume requires clean/recovery evidence where applicable and retains existing collision/capacity/version/atomicity checks;
- blocker closes or changes between snapshot and mutex acquisition: refuse with no partial write;
- tombstone create/readback/close ordering, rollback, idempotence, conflicting payload, and malformed payload;
- reopened retired claim is refused in acquire/resume/renew/expand/split/merge and reported `RETIRED-REOPENED`;
- retired branch/worktree identity reuse is refused;
- successor with fresh tuple/version is unaffected;
- no code path deletes a retirement tombstone;
- capacity and preview outcomes/exit codes are independent;
- expired claims report without mutation; typed evidence plus matching marker permits guarded relinquish;
- one bounded retired-ref listing stays inside current GitHub API budgets;
- static safety assertion: no relinquish/retirement code calls worktree delete/move/clean/reset operations.

### Existing suites that must stay green

Run quietly and preserve exact summaries:

`node --test scripts/orchestrator-flow/capacity-state.test.mjs scripts/orchestrator-flow/reconcile.test.mjs scripts/manage-migration-author-lanes.test.mjs scripts/check-migration-pr-lease.test.mjs`

`node --test scripts/lib/exclusive-lease.test.mjs scripts/coordination-scenarios.test.mjs`

`python scripts/test_production_migration_guard.py`

Run any additional package/repository test command required by current `package.json`, current required checks, or files changed. Do not omit a failing unrelated required test; classify it with evidence.

### Live read-only verification

- `node scripts/check-orchestrator-marker.mjs --resolve` — parse the current marker; it is not proof of reachability.
- `node scripts/manage-migration-author-lanes.mjs --queue-audit` — record current occupied/expired/relinquished/queued facts.
- manual hourly-workflow dispatch on the exact merged head — confirm report-only behavior and zero mutation.

## 11. Constraints, standing rules, and gotchas

- This is `repo-maintenance`, outside the structure/schema orchestrator. The orchestrator may consume the finished commands but must not implement this plan in its own context.
- Work in fresh isolated worktrees. Preserve every dirty checkout and unrelated change.
- Shared-db uses a branch and PR. Code/config changes require all required checks and exact-head independent review before merge.
- Never hand-edit an existing migration or reuse a reserved version.
- Never hand-delete coordination refs or synthesize evidence.
- Never auto-release based on time, open/closed PR alone, missing path alone, or silence from a session.
- A marker proves only a declared routing address, not that the session is reachable. Mutation still requires the live sole-marker checks already encoded.
- Keep GitHub API calls bounded. Read retirement refs once per operation, not once per claim.
- Preserve backward compatibility and fail closed on records the new parser cannot understand.
- Do not weaken the required migration lease check to silence relinquished/expired PR noise.
- Do not place licensed rows, source data, secrets, or raw transcripts in public artifacts.
- Do not edit the installed orchestrator skill alone. Change the canonical ai-devops source and use its supported sync path.
- Do not close issue #2301 or delete its handoff until implementation, CI, merge, skill sync, and live read-only proof all finish.
- Current incident counts may drift. Re-resolve; never hard-code claim numbers in production logic or permanent tests except as clearly synthetic incident-derived fixtures.

## 12. Access and environment

- Repository: `C:\repos\shared-db`; GitHub: `u2giants/shared-db`; target branch: `main`.
- Canonical orchestrator skill source on this machine: `C:\repos\ai-devops\skills\shared\shared-db-orchestrator\SKILL.md`; resolve the installed copy through the supported Codex skill-sync process rather than hard-coding a user-home path.
- `git`, `gh`, Node.js, and Python are available on EDGE-DEV. Verify authentication with read-only commands before relying on them.
- No Supabase, production, preview, or cloud credentials are needed because this plan changes coordination tooling only.
- If authenticated GitHub access needs repair, use the existing machine setup and 1Password vault `vibe_coding`; never expose item values in arguments, output, files, or chat.
- GLM debate evidence is in the persistent `ai-glm` review session `author-lane-lifecycle`; it is supporting reasoning, not runtime authority. Re-read current code rather than trusting an old transcript.
- The dated planning baseline is `origin/main` SHA `1e2f5ee79f6a72a7d445dbf5db73ac203beb31a9`; implementation must start from fresh current `origin/main`.

---

# Part 4 — Landing it

## 13. Definition of done, risks, and open questions

### Definition of done

Every box below was confirmed against a named artifact at the completion step, not
asserted. Where a box is satisfied by more than one step, the STATUS table above
holds the per-step commits, sub-issues and suite counts.

Where a box covers review, checks, merge or issue closure, it is ticked for Steps
1–6, which were already on `main` when this list was written. The completion
step's own review, checks, merge and closure necessarily happen after the commit
that carries this list, so this list does not vouch for them: the pull request
that landed this file is their record.

- [x] Steps 1–7 are marked done with commit, test, CI, workflow, or exact command artifacts. The STATUS table records, for Steps 1–6, the merge commit, guarded-merge head, implementation commit and sub-issue; Step 7's row records its suites, its live proof and the two defects that proof found, and its own merge is the commit that carries this file.
- [x] Every new/changed parser and command fails closed on unavailable or contradictory evidence. Proven by the parser and lifecycle tests in the lane suite, and by the audit itself: an unreadable claim reports `UNVERIFIABLE`, never "clean".
- [x] A relinquished dirty/absent/remote claim consumes no capacity but retains every object/version/work artifact protection. Step 3 and Step 4 tests, including the blocked-on relinquish and the object-retention assertions.
- [x] Resume requires proven recovery and atomically renews/rechecks current truth. Step 3 resume tests: recovery evidence is required, and the renewal and the recheck are one operation.
- [x] Deliberately retired work has an immutable tombstone and cannot re-enter through issue reopening or identity reuse. Step 3 tombstone tests plus the `RETIRED-REOPENED` audit line, which reports a reopened retired claim instead of silently allowing it.
- [x] Capacity and preview outcomes are independently machine-readable. The reconcile output carries a separate `capacity` and `preview` block with its own status, and the two legs fail independently — pinned by the Step 4 and Step 7 tests.
- [x] Hourly and dispatch-time audits are read-only, bounded, and visibly report expiry. Step 5 landed the hourly workflow; the live run reports `"mutating": false`, no action carries `"mutates": true`, and expiry surfaces as `expired-unconfirmed-report` with exit `2`.
- [x] Shared-db rules and canonical/installed orchestrator skill agree and drift tests enforce them. Step 6 agreement tests over all four in-repo venues, plus `check-skill-drift` for the canonical `popcre/ai-devops` skill, which landed as its own pull request.
- [x] All focused and existing suites pass with exact summaries. Final run: 653/653 across capacity-state, reconcile, lanes and migration-pr-lease; 57/57 exclusive-lease and coordination scenarios; 272 production-guard tests OK, all with zero failed, cancelled, skipped or todo.
- [x] Independent reviewer approves the exact final heads. Steps 1–6 each carry a governed `APPROVE` verdict artifact pinned to the exact reviewed head, created by the review runner and never by hand; the STATUS table names the ref for the later steps and the sub-issue for every step, from which the rest can be read back.
- [x] Required GitHub checks pass; PRs merge; merge SHAs are verified on each `main`. Steps 1–6 each merged through `guarded-migration-merge.yml` at an exact head, and each merge commit was read back from `main` rather than assumed.
- [x] Manual exact-head workflow run and live read-only commands prove reporting works without mutation. The hourly workflow was dispatched by hand at an exact `main` head, which is how the second Step 7 defect was found; `--abandonment-audit` and `--queue-audit` were then run live at the fixed head, reported `mutating: false` with no mutating action, and agree with each other. The workflow is dispatched once more on the head this step produces, and that run is recorded on the pull request rather than here.
- [x] No database, preview, production, infrastructure, worktree, or ref deletion occurred. Every step is repo-maintenance: empty `writes:` and `reads:` fences, no migration version, no preview dispatch, no ref or branch deleted.
- [ ] Issue #2301 is closed only after all evidence is recorded. This box is deliberately left open in the commit that carries it, because the evidence is not all recorded until this commit is on `main`. The issue is closed by hand once that merge is verified — a pull request may close exactly one work issue, and this one's is its own step issue — and the closing comment on #2301 is the record of it.
- [x] The linked handoff is retired in the completion commit; this plan remains as the durable implementation/history record with final STATUS. The Step 7 pull request deletes `HANDOFF.d/2026-09-04T1453Z-edge-dev-codex-author-lane-lifecycle-plan.md`, as the handoff-contract rule requires of any pull request that closes its issue.

### Risks and mitigations

- **Parser rollout strands legacy records.** Mitigation: explicit legacy classification, fail-closed mutation, fixtures from real historical fence shapes.
- **A false abandonment record frees capacity.** Mitigation: capacity only; locks/work remain. Mutation requires typed durable evidence and current marker/mutex validation.
- **A dirty worktree is lost later.** Mitigation: no worktree mutation; record state; recovery-gated resume; dirty/remote retirement requires Albert’s decision.
- **A recovery artifact names something that does not exist.** Mitigation: the reference is dereferenced through `githubIo.verifyArtifact()` at relinquish AND at every resume; an unverifiable reference, an absent verification hook, and a verification error all refuse.
- **Retired work resurfaces.** Mitigation: immutable tombstone, tuple guards, audit classification, permanent version reservation, fresh successor tuple.
- **GitHub API budget grows.** Mitigation: one bounded ref snapshot per command plus budget regression tests.
- **Hourly workflow creates noise.** Mitigation: one run/check result, concurrency cancellation, no duplicate comments/issues, structured exact claims.
- **Preview failures hide capacity truth.** Mitigation: independent per-domain outcomes and exit semantics.
- **Two repositories drift.** Mitigation: canonical ai-devops skill change, supported sync, cross-repo drift fixture, exact SHAs in completion evidence.

### Rollback and forward-recovery procedure

- Before each phase merges, capture the current live fence-shape census and keep the phase small enough to revert independently.
- If a new parser or guard fails on live records after merge, do not weaken it and do not edit claim bodies or refs by hand. Stop author-lane mutation, leave all claims/capacity protected, revert only that phase through a reviewed PR if the prior parser still reads every live record safely, then correct fixtures and reland.
- If reverting would make a record written by the new version unreadable to the old version, do not revert. Ship a forward compatibility repair that reads both shapes while continuing to refuse unsafe mutation.
- The hourly audit workflow is independently revertible because it is read-only. Reverting it removes alerts only; it must never be used to change claim state.
- Retirement tombstones are permanent data in Git refs and are never rolled back or deleted. Code rollback must continue recognizing every already-written tombstone shape; otherwise use forward recovery.

### Open questions

No owner decision blocks implementation. The only conditional owner gate occurs if a future operator proposes terminal retirement of a `dirty` or `remote` worktree containing potentially recoverable uncommitted work. At that point, consolidate the exact evidence and recommendation into one request to Albert; do not ask during ordinary capacity relinquishment.

Implementation may choose exact JSON field names, workflow minute, and issue-template mechanism under the criteria in §8. Any choice that changes a locked safety decision requires stopping and updating this plan with evidence before code proceeds.

## Mandatory plan self-audit — 2026-09-04

1. **Could a brand-new AI session execute this perfectly without asking Albert anything? Yes.** Sections 1–4 define the business goal, system, trigger, and boundaries; §§5–8 carry current code, root cause, dead ends, and locked/open decisions; §§9–12 provide files, functions, order, commands, gates, rules, and environment. The only future owner gate is precisely bounded in §13.
2. **Does the plan carry all current background, nuance, and reasoning, including rejected approaches? Yes.** Sections 3, 5, and 6 preserve the dated live incident and GLM/Codex findings; §7 records twelve rejected approaches; §8 records the final consensus decisions and remaining implementation discretion.
3. **Is the ultimate goal clear enough to guide judgment if a step is wrong? Yes.** Section 1 states the owner outcome in plain English, prioritizes both throughput and safety, and explicitly says the goal wins if a step conflicts.

Checklist result: **all requirements pass** — all 13 sections exist; STATUS and fresh-session cut points are present; steps name exact targets and verification gates; tests are behavior-specific; secrets are location-only; landing, rollback, and forward-recovery procedures are explicit; and the plan and write-once handoff link to each other.
