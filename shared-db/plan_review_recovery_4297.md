# IMPLEMENTATION PLAN — review recovery (#4297, October 14, 2026 EDT)


## STATUS — proof recorded October 14, 2026, 5:01 PM EDT

| Step | Recorded state | Evidence / next action |
|---|---|---|
| Scope and delegation | DONE | Immutable generations1–13; bounded High/Extra High lanes. Do not re-plan. |
| Failure accounting and either-slot assignment | DONE implementation | Combined source on main through4294; remaining count-only gap/diagnostic repair on4308. Do not rewrite completed source. |
| Guarded terminal release and approval composition | DONE implementation | Exact tuple/CAS, private carry and negative/returned-slot behavioral gates pass. |
| Adversarial and audit verification | DONE local | 1,289 behavioral passes, one existing skip; required truth-audit16/16 and Tools Offline throughput72/72. |
| Independent approval and guarded delivery | OPEN at dispatch | PR4308 owns the assigned exact-head review, required CI and guarded merge. Earlier external4294 merge is not approval evidence. |
| Merged-source live acceptance | PARTIAL at dispatch | Genuine slot2-first resolver and isolated historical refunds pass on5af/fad source; final4308 source and actual review execution still require proof. No live two-failure exhaustion pair was established. |
| Model-effort comparison | DONE | No controlled benefit demonstrated for Extra High; High is the default for bounded mechanical work. |

Start at the live acceptance checklist on [issue4297](https://github.com/popcre/shared-db/issues/4297) and [PR4308](https://github.com/popcre/shared-db/pull/4308), not at completed authoring. This dated table records dispatch-time proof; those live cards are authoritative for later approval, delivery and closure.

## 1. Ultimate goal
Failed review services must not prevent healthy independent reviewers from reviewing unchanged work. Spending stays bounded and rejected work still needs repair. If any step conflicts with this goal, the goal wins — stop and flag it.

## 2. Application
Canonical popcre/shared-db tooling coordinates shared schema review. This is zero-database repository maintenance in a dedicated current-upstream worktree. Node.js modules, GitHub immutable refs, allocator mutex and guarded merge are existing capabilities.

## 3. Trigger
The review-recovery work addresses bounded paid-review exhaustion, independent reviewer assignment, owner-quoted fresh-slot policy widening, and valid review carry across equivalent content. The combined source and approval-composition repair were externally merged through PR #4294 with original history and attribution. PR #4308 completes the remaining genuine audit and conservative-counting repairs; both delivery and formal review remain separate proof obligations.

## 4. Scope
Budget accounting, out-of-order assignments, automatic verified terminal releases, fresh-slot allowlist widening, carried-slot policy and exact-head approval composition, documentation, and adversarial tests. NOT migrations, production/database writes, historical proof fabrication, reviewer roster changes, removing gates, or paid automatic retry loops.

## 5. Current state
The PR #4308 candidate combines the #4297 recovery changes with the inherited #4294 assignment and carry behavior. The circuit breaker tracks verified failures by reviewer; peer resolution supports either-slot-first order, every live peer, earliest-peer policy, and the newest valid equivalent-content slot-one assignment when present. Latest replacements require exact failure binding; returned or refused assignments cannot be revived from older history. The approval gate composes only valid required-slot approvals from equivalent ancestor and current heads, with distinct reviewers and no return/refusal fallback. The runner automatically releases only recognized exact-bound terminal failures with no verdict. Owner-quoted widening applies only to a fresh later-slot draw; each slot's own durable policy remains exact on retry and replacement. The coordinator retains final policy and delivery decisions.

## 6. Findings
`assertPaidReviewCapacity` preserves conservative starts and returns reviewers exhausted by two exact-bound service failures for the unchanged content and slot. `resolvePeerSlots` validates own, slot-one, and all peer histories; it includes the newest valid carried slot-one record only when current-head slot one is absent and prior review content is equivalent. Assignment and replacement enforce own-slot policy first and recheck current peer policy under the mutex. The approval gate selects the latest valid assignments and refuses fallback through returned or refused slots. The governed runner releases only a verified terminal failure with no verdict or artifact.

## 7. Rejected approaches
No unlimited retries, deleting history, dummy source edits, refunding REJECT/REVISE, freeing unknown starts, reducing review count or bypassing current gates. A larger global failure cap just recreates the same dead end. The combined change preserves PR4294's independent source history and attribution while applying its policy with the #4297 recovery rules. It does not require a separate dependency merge; PR #4308 carries the complete combined source for independent review.

## 8. Locked decisions
A. **SUPERSEDED 2026-10-16 by owner (#4399): spend on the same content is uncapped.** The two conservative review-round starts per unchanged content/slot and the third-draw refusal are removed. Starts remain recorded for diagnostics; verified verdict-less infrastructure failures stay classified as reinstated. Five recognized service failure codes include exact-bound verdictless reviewer_cannot_read_repository.
B. **SUPERSEDED 2026-10-16 by owner (#4399): no per-reviewer failure ceiling.** Two exact-bound service failures no longer exclude a reviewer from new draws (`exhaustedReviewers` is always empty). Failures stay in immutable history. Retryable released failures may be redrawn last (#4284); hard exclusions (confirmed unfixable local dependency, failure-ref=self) stay fail-closed. Provider-unavailable and insufficient-quota evidence may still use the monotonic provider pause path.
C. A slot can be assigned first. Resolve every peer and keep fresh under-mutex revalidation. The earliest live peer anchors a new slot's policy. A fresh slot 2-or-later draw may widen that policy only with a nonempty recorded owner quote and a strict-superset allowlist; a subset, disjoint policy, unquoted widening, or restriction of an unrestricted peer refuses. A slot's own durable policy remains exact for retry and replacement, with no widening. When current slot one is absent, carry only the newest valid historical assignment for equivalent review content; verify latest replacement against its exact failure evidence. A returned or refused slot cannot be revived from older history. Preserve final exact-head approval count and distinct reviewers.
D. Runner auto-releases only a paid-started recognized terminal failure with no parseable verdict anywhere in stdout/stderr, using existing releaseFailedReviewer with exact held sequence, slot, reviewer, issue and head, confirmNoVerdict/confirmNoArtifact and existing CAS checks. No paid retry is launched. Release failure is reported with original error and preserved diagnostics, never treated as successful recovery. Unknown or malformed output remains conservatively counted.
E. Coordinator owns all policy, security, integration, commits, review and merge decisions. Workers implement mechanical edits only within assigned files.

## 9. Steps and gates
1. Budget module: replace global refund ceiling with separate exact-bound failure totals per reviewer; return failedReviewers/exhaustedReviewers and reinstated count plus existing paidAttempts/remaining. Preserve every provenance and scope validation; filter issue as well as PR/slot. Tests cover >2 failures across different reviewers,2 failures one reviewer exhausted,unknown starts exhausted,substantive change distinction,head refresh no reset,tampering. Gate node --test scripts/lib/lanes/review-circuit-breaker.test.mjs.
2. Peer resolver and manager: retain all peer discovery, returns filtering, malformed-history refusal and the 25-request ceiling. Carry the newest valid equivalent prior slot-one record when present without requiring one; validate replacements against exact failure evidence and never revive returned or refused history. New-slot policy comes from earliest live peer; a quoted strict-superset widening is limited to fresh slot 2+ draws. Own-slot retries and replacements inherit exactly. Fresh peer, carried-history and policy reads remain under-mutex checks. Candidate filtering incorporates exhaustedReviewers in EVERY ordinary/replacement/fallback/reuse branch. Gate node --test scripts/manage-migration-author-lanes.test.mjs.
3. Runner: add guarded automatic terminal release seam to injected deps and production deps; preserve exact sequence from held assignment/start evidence, not caller guess. Gate node --test scripts/run-governed-review.test.mjs. Workers must flag any missing bound sequence seam before editing wider modules.
4. Approval composition and documentation: preserve byte-identical `.agent/`-only equivalence, ancestor relation, returns/refusals, newest valid assignments, required review count and reviewer diversity. Record finite budgets, service recovery vs substantive rejection, independent assignment, all-pool exhaustion and historical proof limits. Run all four gates centrally and applicable full offline checks. Compare High and Extra High through actual findings, errors and coordinator corrections, explicitly no controlled performance claim.
5. Deliver one atomic PR #4308 containing all combined source, then draw an independent code reviewer under existing rules while CI runs and batch corrections. PR #4294 is already merged as inherited source; no separate dependency merge is required. Guarded merge only after the lifecycle-recorded exact-head approval and required checks. Merged-source runtime verification must exercise actual supported tooling without DB write or paid loop. Preserve original author attribution and commit history; do not assign retroactive authority to earlier commits.

### Adversarial cases
| Input | Hostile case | Required test |
| failure ref | wrong issue/PR/head/slot/sequence/reviewer | exact-binding refund refusal |
| failure record | verdict exists or unsupported code | no refund or automatic release |
| historical starts | main refresh,empty commit,revert | capacity cannot reset |
| historical starts | repeated failures one reviewer | exhausted reviewer never selected |
| assignment peers | slot2 then slot1, slot2 then slot1 with equivalent prior head, and 3 then2 | distinct providers; no slot-1 redraw for carried content |
| task allowlist | exact peer policy, quoted strict superset, unquoted widening, subset, and same-slot changed policy | inherit exact, permit only quoted fresh slot-2+ widening, refuse all other changes |
| failure release | moved head,concurrent verdict,stolen lease | existing CAS refuses and diagnostic retained |
| runner output | quoted/stray REJECT/REVISE/APPROVE | no automated verdict-less claim |
| failure accounting | unknown running starts | count conservatively |

## 10. Tests
All three commands above. Preserve circuit-breaker Git provenance tests, request-cost tests, carried-slot and either-slot-first tests, independent final approval tests, engine exclusion tests, release/CAS tests and runner source receipts. Add behavior assertions, not implementation-mirroring assertions. No paid provider calls from test fixtures.

## 11. Constraints
Dedicated worktree only; no structural claim; declared reviewer-safety class and action gates. Publish immutable scope before edits. Centralize shared manager edits. Do not alter current PR4294 or its files in another checkout. No secrets or reviewer credentials during formal review. Sign GitHub posts.

## 12. Access
Authenticated gh read/write exists. Supported installed ai-task-gates. Node tests local. No secret needed for code/tests; official reviewer wrapper preflight determines runtime availability. Long output goes to session TMPDIR.

## 13. Definition of done and risks
Published contract, bounded implementation, adversarial checks passing, exact-head independent APPROVE, required CI passing, guarded merge, merged-source runtime proof, documented limits and evidence-based model comparison. Unknown historical starts may remain blocked; never invent terminal evidence. Risk: independent draws could inherit inconsistent policy; adversarial tests and mutex revalidation must prove safe. Rollback is reviewed revert preserving immutable records. No HANDOFF needed while work remains active; if externally blocked, preserve on issue4297 and write required handoff. No business questions remain.

## 14. Observed model comparison

The original delegation split two Luna High and two Luna Extra High lanes, but the lanes covered different work and did not expose comparable token or cost measurements. That is not a controlled effort-level comparison. The follow-through used Luna High for CI diagnosis, reconciliation, independent audit and live-proof preparation. High found a concrete historical carried-slot replacement defect after initial reconciliation, and supplied a bounded repair with behavioral regression coverage. Extra High therefore has no demonstrated advantage on this job; High is the default for scoped mechanical work, with coordinator decisions and independent formal review retained. A stronger effort setting should be selected only when a comparable task shows fewer material errors or less coordinator correction at an acceptable measured cost. These observations do not establish a general speed or quality ranking.

## 15. Delivery continuation

The combined source was externally merged from PR4294 at c10b22feeb407e4404275e6c19cc7bb937013e89 into93a6a4499bb2f5ad60f5cfe47b30e40b3292c91a while Tools Offline and its aggregate were red. This coordinator did not authorize that merge or obtain its formal exact-head approval. Earlier source and all immutable review-start history remain preserved; an external merge alone is not approval evidence.

The seven genuine remaining audit, conservative-counting and diagnostic repairs continue on codex/4297-final-repair under issue4297, from current main5af6ca6768999460c944f65ee67f3380851e8a4b. Generation13 prospectively authorizes integration and final evidence; source526db1c7f was authored under generation12 and is explicitly inherited. The generation11 pair already on main remains unchanged; only generation13 is added by this follow-up. No licensing, database or production source is changed. Fresh assigned approval explicitly examines the complete combined reviewer implementation, with required CI and guarded merge for this follow-up. No old paid attempt is erased, refunded, or replayed.


The allocator conservatively counts a historical start with the established narrow canonical merge-gap refusal as unchanged when no direct proof chain resolves it. It records conservativeHeads, never treats that result as substantive or a chain intermediate, and still refuses a third conservative round. All other provenance, lineage, binding and transport failures remain hard refusals. The source-provenance function itself is unchanged and still rejects foreign/noncanonical merges; this grants no changed-content proof, refund or additional allowance.

## 16. Lifecycle-recorded delivery integration (generation 14)

The inherited direct provider launch did not create the provider-neutral lifecycle report required by the installed ship gate. The governed runner now routes active assigned pool reviewers through the installed `ai-review` front door with the allocator-selected provider, exact merge base, exact head and detected implementing engine. It accepts only the resulting report under the current review worktree after checking provider, repository, source digest, head and one terminal verdict; otherwise no shared-db verdict is recorded. This uses the existing lifecycle and pool and adds no retrospective import or alternate approval path.

The lifecycle report path is retained in the governed runner result and remains available to the exact ship gate. Delivery still requires a fresh assigned exact-head review of the complete PR content, required checks, the guarded merge, and a read-only proof of merged-source operation. This report's lifecycle evidence, the separate shared-db verdict artifact, source tests and live proof remain distinct facts.


## 17. Current-upstream integration (generation 15)

The successor accepted technical custody of issue4297 while continuing the eight-issue licensing agenda. Preserved source70960d3784636cd0528b3e5c16af05a1ff548855 is integrated additively with upstream ab3b833b5bd35b93e5edc531b363aa83650803cf. Earlier generation11 delivery prose is historical; the actual external merge and remaining follow-up above govern current state. All original source, contracts, reviews and failure/start evidence remain retained. No force-push, capacity reset, refund or retrospective lifecycle import is permitted.

Owner ruling6.27 requires one independent exact-head approval for every change, including migrations. Current upstream checker and its tests are preserved. The two real integration conflicts are resolved in this plan and the accurate current diagnostic disposition; no approval guard is weakened. The already merged #1766 receipt fix must be installed through its separate protected current-release review and installation route before a real lifecycle-metered source review. Required CI, guarded merge and merged-source runtime proof remain separate uncompleted gates. No database or production write is in scope.

## 18. Native lifecycle dispatch compatibility

Generation 18 forwards an explicitly supplied top-level test command unchanged as one `ai-review --tests` argument for lifecycle-metered pool reviews; omission leaves prior dispatch unchanged, and unsupported/empty requests fail before review start. The report parser retains the established legacy pool format and adds only the exact native engine format, binding its provider, `final-check` mode, lexical run ID to the report's run field, exact lifecycle runner, repository, head, source digest, real report path, analysis and single verdict. Tests cover both valid formats and adversarial identity, path, digest and verdict mismatches. No reviewer call, budget/history change, database action or delivery authorization is part of this integration.

## 19. Original preparation-failure recovery and CLI verification (generations 23–25)

The real SQL migration guard identified the bare `tests` option identifier as a repository data directory. The option declaration now enumerates actual canonical command-line flags; parsing still retains accepted aliases and forwards the explicit test command unchanged. The runtime-read scanner remains unchanged. This source repair passed the full 1,526-test Python lane and the focused governed-runner tests before subsequent recovery implementation.

The original DeepSeek start at sequence 6531 has a retained native exit-1 diagnostic for `source-receipt-conflict` and no provider verdict. Its PR had moved before failure recording, so ordinary current-head release correctly refused. A separate strict historical preparation-failure variant must bind the original assignment/start/source receipt and active lease, complete unique temporal diagnostic match, current open descendant head and absence of any verdict. It must retain original evidence and disclose that the diagnostic and source receipt do not share a run ID. No unknown result is converted into a failure or approval.

Generation23 prospectively authorized the CLI repair; generation24 prospectively authorized the strict historical evidence route; generation25 adds required diagnostic-catalogue scope and final source completion. All publications and earlier source remain immutable. Final delivery still requires a new assigned exact-head lifecycle review, required CI, guarded merge and actual merged-source proof. Source preparation is not delivery.
