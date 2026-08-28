# Orchestrator throughput Phase 2 — consensus ledger

**Plan:** [`../../plan_orchestrator_throughput_phase_2.md`](../../plan_orchestrator_throughput_phase_2.md)
**Issue:** #1738
**Starting commit:** `1eacdacd52a5d6bbd212f718967391df1381138d`
**Reviewers:** Codex, Grok 4.6, Claude Opus 5
**Status:** debate in progress; initial revision rejected by both external reviewers

## Agreed decisions

- The transcript's root cause is coupling between claim protection/capacity, reviewed content/integration head, preview order/failure state, and route shape/late enforcement.
- Protected claims must never be released merely to free author capacity.
- Preview, merge and production writes remain single-holder.
- Review reuse requires a content-addressed bundle plus successful current-head integration proof; SQL-only or filename-only reuse is unsafe.
- Ambiguous/unavailable classification is `UNVERIFIABLE` and repeats full evidence.
- `WAITING` is coordination state, never GitHub success or apply/rebind proof.
- Required reviewer coverage is unchanged; `REVISE` is never replaced.
- Exclusive-stage heartbeat/renewal remains rejected.
- Phase 1 remains the truth/measurement foundation; Phase 2 does not duplicate it.

## Initial material objections and disposition

| Objection | Source | Disposition in revised plan |
|---|---|---|
| Wrong/nonexistent function anchors and fixed-five queue geometry | Claude, Grok | corrected §5/Step 2 with real functions and >cap protected-claim tests |
| Existing `db-author-lease` semantics could be confused with capacity | Claude, Grok | capacity state is explicit; clock expiry frees neither claim nor capacity |
| New locks omitted stale-recovery allowlist and duplicate test | Claude | Step 2/6 and tests require both updates |
| Existing `db-coordination-events.mjs` omitted | Claude | reused as sole lifecycle store in Steps 1/2/8/9 |
| Node qualification could duplicate Python risk/catalog rules | Claude | Step 7 specifies thin Node/Python diagnostic boundary and exit 2 |
| Five-to-eight owner instruction conflicted with Phase 2 | Claude | instruction incorporated: eight active leases after six-reviewer prerequisite |
| `updateRef` is not compare-and-swap; heartbeat does not exist and is unsafe | Grok | Steps 6/8 use create-if-absent or short mutex; no exclusive heartbeat |
| Global invalidator set and evidence-reuse authorization were open-ended | Grok | versioned discovered inventory plus closed current-head CI/merge-base/bundle contract |
| #1713 disjoint merge evidence was unspecified | Grok | real `ddcdd5da` file set embedded in plan and fixture requirement |
| Preview `WAITING` could accidentally satisfy required checks | Grok | explicitly non-success/non-artifact; consumer tests required |
| Doctor-before-assignment could shrink reviewer coverage | Grok | local doctor remains post-assignment local-dependency path |
| Auto-refill relied on nonexistent heartbeat/stale marker | Grok | explicit live-orchestrator reconciliation; no marker means no mutation |

Only the preview-wait/live-protection rows in this initial round are superseded by the final no-run design. All other dispositions remain current. The superseded row is retained solely as debate history: waiting now creates no workflow/check context at all.

## Claude second-round objections and disposition

| Objection | Disposition in current plan |
|---|---|
| Required `check-migration-pr-lease.mjs` consumer was omitted | Step 2 and §10 now keep relinquished/expired claims red until guarded resume plus renewal |
| Coordination events had no explicit writers or audit CLI | Step 2 names exported writers and `coordination-audit.mjs`; no second store |
| Six-reviewer prerequisite cannot be met by the four-provider live roster | §8/§13 and handoff require Albert to approve the exact two qualified providers before cap activation |
| Kimi's execution-context denial would recur after generic doctor handling | Step 6 uses only the current assigning process's doctor result for one attempt, never a persisted ban |
| Existing workflow test set was incomplete | §10 names the exact nine-suite workflow baseline, including lease, events and coordination scenarios |
| A neutral wait could become a skipped required context | Step 5 requires the wait context absent from Python `REQUIRED_CHECKS` and managed branch protection |

Only the neutral-wait row in this second round is superseded by the final no-run design. All other dispositions remain current. There is now no wait check context to classify or protect.

Plan and handoff prose are explicitly non-authoritative at runtime; versioned code/config and synchronized standing instructions remain policy inputs.

## Third-round objections and disposition

| Objection | Source | Disposition in current plan |
|---|---|---|
| Execution-context denial could become a standing caller/provider ban | Grok, Claude | current-process doctor result only; no persisted ban/TTL; later clean contexts remain eligible |
| Preview wait could false-green a missing/skipped required check | Grok, Claude | wait only on `workflow_dispatch`; required PR jobs unchanged; live protection comparison; no lock/apply artifact |
| Undefined `idle` capacity state could bypass guarded relinquishment | Grok | removed as fence state; dashboard-only label still counts active capacity |
| Cap 8 can exceed concurrent reviewer supply | Claude | explicit `review-wait`; all-busy never returns a reserved reviewer; cap and reviewer supply are separate |
| Retired GLM label is not an independent provider | Claude | exact recommendation must contain distinct provider/wrapper identities and at least one genuinely new provider |
| Existing manager tests hard-code cap/roster | Claude | §10 explicitly updates those assertions while preserving all safety coverage |
| Static branch-protection fixture is not live truth | Claude | authenticated live read is mandatory and unreadable/inconsistent state is `UNVERIFIABLE` |
| Owner gate absent from rollout/definition of done | Claude | repeated in Step 10 rollout and definition of done |
| AGENTS/skill drift could span phases | Claude | matching skill/drift change is part of Phase A and blocks its fresh-session cut |
| `--flow-audit --json` lacked a direct test | Claude | explicit coordination-audit CLI test added |

Only the preview-wait/workflow-dispatch/live-protection row in this third round is superseded by the final no-run design. Every reviewer-allocation, capacity, owner-gate, skill-drift and audit disposition remains current.

## Fourth-round objections and disposition — MIXED CURRENT AND SUPERSEDED ITEMS

> Only rows whose objection or disposition depends on an automatic dispatcher, dispatch admission, preview wait workflow/job or wait check context were superseded by the replacement design after commit `3f76c28`. Reviewer-wait, overflow, execution-key aliasing, skill drift, cap/owner gates, dead-releaser recovery, unreadable reservation truth and wait-generation rollover remain current. The rows are retained for exact debate provenance.

| Objection | Source | Disposition in current plan |
|---|---|---|
| Live PR contexts, Python production checks and YAML jobs are different sets | Grok | live protection is authoritative only for PR requirements; no set equality; wait is forbidden from both enforcing sets |
| Early wait could still run `if: always()` apply-artifact upload | Claude | separate short-lived dependency job; preview job never starts while waiting |
| Waiting dispatch could hold the global workflow concurrency group | Claude | wait job emits metadata and exits immediately; reconciliation redispatches later |
| `review-wait` lacked durable order and independent waker | Claude | immutable wait refs; release plus Step 8 reconciliation re-enter guarded allocator |
| Context doctor had only a post-assignment entry point | Claude | factor read-only doctor-only function; run per candidate outside mutex before reservation |
| Process-local rule contradicted leftover durable/caller prose | Claude | root cause and Step 6 compatibility prose now consistently process-local |
| Manager `--flow-audit --json` still untested | Claude | manager CLI delegation and output contract test added |
| Reviewer names can alias one serialized wrapper | Claude | reservations keyed by canonical provider/wrapper execution identity, with display reviewer in payload |
| Cap test timing could assert eight before approval | Claude | production remains five until gate; parameterized fixtures test proposed eight beforehand |

## Fifth-round objections and disposition — MIXED CURRENT AND SUPERSEDED ITEMS

> Superseded here: preview-only wait/entry workflow and every wait-run/displacement disposition. Current here: durable reviewer-wait generation, overflow policy, Phase C operator/skill synchronization, and the rule that authenticated live protection is an operator gate while CI uses injected fixtures.

| Objection | Source | Disposition in current plan |
|---|---|---|
| A wait inside the existing workflow still holds its workflow-level concurrency group | Claude | new preview-only entry workflow; waiting never dispatches the shared preview/production workflow |
| Repeated waits could displace a pending real preview/production run | Claude | waits never enter that concurrency group; only ready state dispatches it |
| Production could accidentally use the wait route | Claude | entry workflow accepts preview targets only and rejects production |
| Wait wake could bind a stale PR head/bundle | Claude | every waker revalidates live head/bundle/eligibility; drift terminally supersedes and requeues current content |
| Immutable waits lacked atomic claim, terminal lifecycle and ref-safe ordering | Claude | mutex-allocated ref-safe sequence, create-if-absent claim, append-only outcome, fenced dead-claim recovery |
| Overflow reviewer policy was absent from the new eligibility seam | Claude | active tier first; approved overflow only with immutable proof all active keys unavailable; arbitrary inactive names fail |
| Phase C operator semantics were not synchronized to docs/skill | Claude | Phase C cut now requires same-phase AGENTS/docs/skill/drift updates |
| Default CI cannot read admin branch protection | Claude | live read is operator activation only; CI uses mocked fixtures |

## Sixth-round objections and disposition — MIXED CURRENT AND SUPERSEDED ITEMS

> Superseded here: dispatcher ownership, dispatch admission and automatic ready dispatch. Current here: reviewer reservation release, unreadable-reservation fail-closed behavior, wait-generation rollover, and the no-run/no-check/no-artifact waiting invariant.

| Objection | Source | Disposition in current plan |
|---|---|---|
| Workflow-to-workflow dispatch mechanism/ref/permissions were undefined | Claude | removed intermediary workflow; authenticated operator CLI dispatches exact current ref with readback |
| Preview input passthrough could drop recovery inputs | Claude | closed adapter covers every target input; discovery test fails on either-side drift |
| Preview wait wake had no owner | Claude | Step 8 invokes guarded dispatcher after dependency satisfaction |
| Automatic ready dispatch could replace a pending preview/production run | Claude | shared dispatch-admission ref plus zero queued/in-progress proof; preview and production use same guarded admission |
| Verdict landed but dead releaser could strand a reservation | Claude | verdict/PR-close/head-move are normal release proof; dead terminal releaser is recoverable separately from no-verdict recovery |
| Unreadable reservation truth had no shadow/activation rule | Claude | legacy derived state controls shadow; unreadable new truth never triggers paid overflow and fails closed after activation |
| Refreshed PR could lose its queue position | Claude | new bundle/head becomes next generation under the same primary sequence |
| Wait cycles could accumulate PR check runs | Claude | waiting is operator coordination only and creates no Actions/check run |
| New dispatcher was outside preview custody | Claude | corrected later: operator scripts are untrusted proposers; the workflow-side admission validator is the pinned enforcing producer |

## Seventh-round objections and disposition — MIXED CURRENT AND SUPERSEDED ITEMS

> Superseded here: shared dispatcher/admission/producer-custody and workflow-wait implementation dispositions. Current here: the no-run/no-check/no-artifact wording, reviewer reservation recovery and successor-first wait-generation recovery.

| Objection | Source | Disposition in current plan |
|---|---|---|
| Run-state check would include continuous pull-request validation | Claude | admission checks queued/in-progress `workflow_dispatch` runs only |
| Production did not own the same dispatch admission path | Claude | shared dispatcher owns both sanctioned preview and production; preview front end calls it |
| Shared admission lock lacked allowlist/recovery | Claude | both recognized-kind lists updated; exact-payload terminal/dead fenced recovery specified |
| Operator local bytes were not proven by producer custody alone | Claude | clean worktree plus exact `origin/main` blob proof, immutable admission record and explicit executable discovery |
| Stale workflow-wait wording contradicted operator-state redesign | Claude | all waiting language now says no run/check/artifact |
| Crash between superseded outcome and successor wait could lose issue | Claude | successor-first rollover under mutex plus two-generation recovery/failure injection |
| Ready preview and reconciliation dispatch tests were missing | Claude | exact one-lock ready-preview test and reconcile dispatch/busy/recovery cases added |

## Eighth-round objections and disposition — MIXED CURRENT AND SUPERSEDED ITEMS

> Superseded here: unauthorized dispatch regrouping, admission records, operator-executable inventory and production dispatcher/helper. Current here: preserving the existing concurrency expression and `cancel-in-progress: false`, completeness testing and newest-state wait-generation recovery.

| Objection | Source | Disposition in current plan |
|---|---|---|
| Editing concurrency could collapse PR validation groups | Claude | existing expression and `cancel-in-progress: false` preserved verbatim and statically tested |
| Unauthorized dispatch isolation could weaken serialization | Claude | no concurrency regrouping; first dispatch guard fails before target/lease work |
| Admission record had no namespace/lifecycle | Claude | immutable `refs/db-dispatch-admissions/<id>` plus terminal outcome; lock remains separate/recoverable |
| Operator-executable inventory had no file | Claude | `config/orchestrator-operator-executables-v1.json` created and discovery-tested |
| Local script cannot securely attest its own bytes | Claude | scripts are untrusted proposers; enforcing workflow revalidates all target/ref/inputs; no false producer-custody claim |
| Production caller/procedure was missing | Claude | **SUPERSEDED automatic-dispatch design:** the replacement preserves the existing manual production procedure and adds Phase A behavioral guards |
| New config files would fail completeness gate | Claude | each is pinned or precisely exempted and filesystem-completeness test stays required |
| Second head drift could leave no current wait generation | Claude | recovery snapshots newest live state and exits only with exactly one current generation |

## Ninth-round objections and disposition — MIXED CURRENT AND SUPERSEDED ITEMS

> Superseded here: admission-gate placement, unauthorized dispatch grouping, production helper/procedure mutation and admission validator. The general `UNVERIFIABLE` rule remains current; the manual workflow/procedure is preserved by Phase A behavioral guards.

| Objection | Source | Disposition in current plan |
|---|---|---|
| Four target jobs had no shared admission-gate location | Claude | first workflow-dispatch-only step in existing shared `validate` job; all target jobs already depend on it |
| New gate job would break literal production `needs` invariant | Claude | no new job/needs edge; existing literal list remains and is tested |
| Admission check could displace deliberately-first target steps | Claude | upstream validate step; target-ref and exact-confirmation remain first in their own jobs |
| Empty unauthorized dispatch could stall/replace sanctioned group | Claude | empty admission gets unique unauthorized group; PR branch and sanctioned global group preserved |
| Ambiguous dispatch lost `UNVERIFIABLE` rule | Claude | unreadable/ambiguous dispatch, admission or validation is explicit exit 2 |
| Production procedure file was unnamed | Claude | **SUPERSEDED automatic-dispatch design:** Phase A protects existing semantics; Step 5 adds/pins the historical-dry-run warning in the procedure and synchronized operator guidance |
| Ledger contradicted operator trust boundary | Claude | older disposition corrected; workflow validator, not operator script, is pinned authority |
| Admission validator file/tests were unnamed | Claude | named validator and test plus existing production guard test cover all four target paths/concurrency |

## Rejected alternatives

- Release blocked claims, raise the cap as a substitute for decoupling, parallelize database writes, reuse SQL-only evidence, trust path names alone, time-delete mutexes, add exclusive-stage heartbeat, build a general SQL analyzer, or accept production apply without verification.

## Unresolved objections

- Pending fresh Grok 4.6 and Claude Opus 5 review of the replacement design. The user explicitly authorized a new Grok session after the prior session's rebuttal ceiling.

## Evidence still needed

- Same-head Grok and Claude approval of the read-only selector/manual-dispatch boundary before final merge.

## Last verified path state

- Initial external reviews read commit `1eacdacd52a5d6bbd212f718967391df1381138d` and rejected it.
- Grok's prior-session last approved head was `18cdcba`; Claude's latest rejected head was `1302d03`. The automatic-dispatch design has now been removed; the replacement revision is pending fresh same-head review.

## Replacement design after the exhausted first Grok debate

The current conversation instructed Codex to start a fresh Grok session; this is operational provenance, not durable external authorization for a database or production action. Codex replaced, rather than patched, the disputed automatic dispatcher. Phase 2 now ends at a read-only route selector and durable idempotent `PREVIEW_READY` record. It creates no Actions run/check, changes no workflow concurrency/permissions/inputs, and leaves the incident-derived manual preview/production dispatch procedure intact. Automatic behavior is limited to dependency detection, durable readiness and optionally waking the live sole-orchestrator task with exact current evidence.

## Fresh-review objections on the replacement design

| Objection | Source | Disposition in current plan |
|---|---|---|
| New Node tests were local-only and would miss required CI | Claude | Phase A adds a guarded, named-backstop `scripts/orchestrator-flow/*.test.mjs` array to required CI; every test is offline/injected and later files extend the backstop when created |
| No named static test protected unchanged workflow invariants | Claude | Phase A extends `scripts/test_production_migration_guard.py` before Step 5 with parsed workflow and promotion-procedure invariants |
| `PREVIEW_READY` had no store/dedupe/lifecycle | Claude | immutable ready refs, existing events, terminal outcome refs and head/bundle supersession |
| No live marker could lose an automatic wake | Claude | wait state remains durable/derivable; no-marker audit reports only; next matching marker materializes readiness once |
| Admission-era ledger rows looked current | Claude | each mixed round now scopes exactly which automatic-dispatch rows are superseded and which reviewer/cap/recovery decisions remain current |
| Classifier and rollout retained dispatch-era wording | Claude | selector/ready artifact is the integration surface; rollout says durable wait plus manual dispatch |
| Preview identity incorrectly used a pinned literal | Grok | live authenticated `PREVIEW_PROJECT_REF` is validated as set and unequal to production before each fresh ledger read; Step 5 forbids fallback to the drift literal |
| Frozen `mode`/early `dispatched` would break dry-run then apply | Grok | mode is per-run; dry-run is nonterminal; only completing apply/recovery records dispatched; terminal ready IDs cannot run again |
| Procedure and workflow safety assertions were deferred or absent | Claude | Phase A adds behavioral production-guard assertions before Step 5 and keeps all required tests hermetic |
| Three policy/provenance inputs had no manifest disposition | Claude | `source_pr`, `preview_run_id` and `preview_artifact_digest` are explicitly excluded from manual preview routes |
| Event test required an unexported implementation detail | Claude | the gate is behavioral; no `STAGE_PAIRS` export is required |
| Historical recovery was incorrectly given a dry-run phase | Grok | ordinary/merged routes remain dry-run then apply; historical rebind is apply-only, with a fresh live recheck before its one run |
| Main movement could terminally supersede and regenerate the same ready ID | Claude | merged/historical ready identity includes current-main `commit_sha`; either route gets a new ID after tip movement |
| Historical route omitted current-main freshness | Claude | both commit-bound routes prove current-main immediately before every required run |
| Workflow permits green historical dry-run no-op | Claude | selector forbids it; Step 5 adds/pins the procedure and synchronized operator warning; shared workflow mutation remains outside Phase 2 |
| Live variable and drift literal could diverge silently | Claude | selector queries only the live variable but fails closed and instructs same-change repair when identities disagree |
| Selector import rule contradicted its identity cross-check | Claude | literal import is allowed only for equality comparison; using it as query/default/fallback is forbidden |
| Ledger-helper refactor omitted affected files and invalidator inventory | Claude | Step 5 names drift module/test, shared helper/test and global invalidator/discovery updates |
| Successor ready ID could inherit a stale dry-run | Claude | each ready ID owns its dry-run evidence; a new commit-bound ID must dry-run again before apply |
| Main churn could create unbounded readiness history | Claude | edge satisfaction creates once; audit drift is report-only; marker-bound pre-dispatch preparation alone refreshes with successor-first duplicate recovery |
| Step 5 omitted CI workflow and helper test/injection seam | Claude | modify list names required CI; required tests name the helper; adapters are `readRepoVariable` and `fetchAppliedVersions` |
| Churn pause had no storage or recovery and contradicted Step 8 | Claude | pause/counter/index removed; Step 8 owns initial materialization and explicit preparation owns later refresh |
| Warning was routed away from the procedure operators read | Claude | Step 5 updates the existing rehearsal-aware procedure and pins it plus synchronized operator instructions |
| Separate dry-run doubles main-tip exposure | Claude | standing merge protocol still requires it; apply's internal dry-run is complementary, and any new ready ID must repeat external dry-run |
| Mutating preparation was attached to the read-only selector | Claude | selector remains read-only; marker-bound Step 8 reconciler alone owns initial readiness, preparation refresh and lifecycle mutation |
| Ordinary reconcile still implied automatic churn supersession | Claude | ordinary reconcile is report-only for drift; explicit preparation is the sole successor-first refresh path |
| Duplicate unresolved ready refs had no recovery | Claude | preparation creates/readbacks the one live successor first, then terminalizes provably stale duplicates; ambiguity fails closed |
| Step 5 gate required Step 8 mutation before reconciler existed | Grok, Claude | Step 5 gate is read-only; every readiness mutation/recovery/failure-injection gate moved to Step 8 |
| Phase C docs named a Phase D command | Claude | Phase C documents read-only decisions only; Step 8 lands and synchronizes marker-bound prepare instructions |
| Preparation CLI was not wired through the manager | Claude | Step 8 names manager flag, argument validation, marker resolution, delegation and operator sequence |
| Crash then second tip move could leave zero current successors | Grok, Claude | preparation always creates/readbacks newest live successor first even when zero existing refs match, then terminalizes proven stale refs |
| Step 5 event writers lost tests and STAGE_PAIRS wording conflicted | Claude | writers move to Step 8; event tests require EVENT_TYPES exports and forbid readiness lifecycle events from STAGE_PAIRS |
| Ready identity/mode/outcome contention assertions were dropped | Claude | Step 8 gate restores new-ID/no-inherited-dry-run, single outcome ref and mode-specific dispatched assertions |
| Unreadable readiness could wedge a live issue forever | Claude | fenced marker-bound repair requires event binding and no-dispatch proof; otherwise explicit owner decision, never silent deletion |
| Step 8 omitted CI, invalidator and manager-test files | Claude | Step 8 names required-CI backstop, invalidator discovery and manager tests; its global invalidation forces fresh bundle reviews |
| Repair relied on retention-bound absence and could cancel a dispatched record | Claude | repair uses positive v2 event identity only; run/artifact absence is never proof |
| Repair could cancel the only legal current digest | Grok, Claude | wrong-digest stale refs may be superseded; a corrupt live-digest ref receives no write and requires owner decision |
| Event schema could not bind ready ID and ordering was undefined | Claude | schema v2 adds ready ID/full tuple with v1 reader; event lands before ref and crash retries idempotently |
| Repair/event/recovery files and operator entrypoint were inconsistent | Claude | Step 8 names event files, lock recovery, manager tests and one exact manager CLI; STAGE_PAIRS remains private and is tested behaviorally |
