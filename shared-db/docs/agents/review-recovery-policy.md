# Review service recovery policy

Owner-authorized implementation is tracked on [#4297](https://github.com/popcre/shared-db/issues/4297). The combined source was externally merged through PR #4294; remaining audit and conservative-counting repairs continue on that same work issue. Original source, history and attribution are preserved. The earlier external merge is not evidence of independent approval. This tooling policy requires one independent exact-head approval for every change, including migrations (owner ruling §6.27), and preserves guarded merge. Every drawn slot still owes its own qualifying verdict.

## Spend is uncapped (owner 2026-10-16)

Owner ruling (Albert, 2026-10-16, issue #4399): spend on the same content is uncapped. The earlier two-round start ceiling and the two-failure per-reviewer exclusion are removed. "Reviewer pool is exhausted" must never appear. Unlimited concurrent reviewer slots already landed in #3130; these spend brakes were leftovers that still emptied a finite roster.

A paid start is still recorded for diagnostics and provenance. Immutable terminal evidence that binds the exact issue, PR, head, sequence, reviewer and recorded slot and proves no verdict or artifact with a supported reviewer-side service failure is still classified as a reinstated (non-charged) start for accounting. Unknown, running and unrecorded starts remain counted in `paidAttempts`. Negative verdicts are never treated as service failures. Source-history verification remains mandatory; empty commits, evidence-only commits, upstream refreshes and net reverts and changing the linked work issue do not create a spend refusal.

Supported service failures are wrapper_terminal_failure, provider_unavailable, insufficient_quota, turn_limit_cancelled and reviewer_cannot_read_repository. Every proven failure is bound to its exact issue, PR, head, sequence, reviewer and slot and kept in immutable history. Failures never remove a reviewer from the draw. Provider-unavailable and insufficient-quota events may still use the existing monotonic provider pause path for outage courtesy; that pause is not a pool-exhaustion stop.

When no never-failed independent candidate remains, a retryable released failure (quota, outage, wrapper, turn-limit, repository-read) may be redrawn last (#4284). Hard exclusions — confirmed unfixable local dependency, failure-ref=self without a release record — stay fail-closed and are never redrawn. Same-head slot distinctness, preflight usability, quarantine/retire roster, and exact-head verdicts stay binding.

## Independent assignments

A slot can be assigned first. Every live peer is checked before and under the assignment mutex to prevent duplicate reviewers, and the earliest live peer supplies initial policy for a new slot. A slot's own durable policy governs its retries and replacements exactly. A fresh later draw may widen the earliest peer's allowlist only with a recorded nonempty owner quote and a strict superset; subsets, disjoint policies, unquoted widening, and restricting an unrestricted peer remain refused. The quote is stored only on an assignment that actually widens policy. If slot 1 is absent at the current head, the newest valid tree-identical or content-equivalent prior slot-1 assignment may carry for independence and policy; a verified latest replacement is selected, and invalid replacement history refuses. A returned or refused slot is never revived from an older assignment. No slot-1 prerequisite blocks a later slot. Fresh peer, policy and carried-history reads are repeated under the mutex. Provider eligibility, author-engine exclusion, immutable assignment records, compare-and-swap lease transitions, distinct reviewers and the final exact-head approval count remain binding.

## Automatic failure evidence

The governed runner records a paid-start marker before invoking a reviewer. When an existing recognized terminal service failure produces no verdict-like line in either output stream, it calls the existing guarded failure-release operation using the exact sequence and slot in that marker and the held reviewer lease. Release rechecks live issue/head, no existing verdict/artifact, and ownership under the mutex. A failed release preserves the original diagnostics and reports the recovery refusal. Unknown failures, pre-start refusals and output containing any verdict-like line do not automatically claim verdict-less service failure.

Release does not launch another paid reviewer. The next supported assignment or replacement chooses an eligible independent reviewer within both allowances. A direct inline replacement that has not first recorded its failure remains conservatively subject to existing capacity checks; automatic guarded release closes this path for recognized runner failures.

## Historical wrapper-preparation failure evidence

The supported historical variant recognizes the exact DeepSeek native wrapper preparation-failure format. An explicitly requested historical release may classify its retained `source-receipt-conflict` preparation failure after the open PR has advanced. It never assigns a reviewer to the old source. The old head must be an ancestor of the current eligible open PR head; the original assignment, paid start, source receipt, active lease and absence of a verdict or artifact must all agree. Ordinary current-head release requirements remain unchanged.

The retained private diagnostic must prove exit 1, no signal or spawn error, packet construction followed by the exact source-receipt failure, and no provider dispatch or verdict. Its original source receipt must independently match the immutable start's receipt-path hash and source identity. A complete original-tuple start inventory must identify exactly one matching reviewer start before the diagnostic. This is recorded honestly as unique temporal binding, not a shared cryptographic run identifier. Missing, ambiguous or changed evidence refuses. Private original bytes remain private; the immutable failure record retains only normalized facts and hashes.

All evidence and canonical PR/lease/verdict state are re-proved under the coordination mutex. One compare-and-swap operation creates the original tuple's failure record and removes only its exact held lease. Original starts, source, decisions and counters remain untouched. Only that proven verdict-less preparation failure receives the existing service-failure treatment; unknown or negative results remain charged. A fresh current-head assigned review is still mandatory.

## Lifecycle-recorded delivery

For active assigned reviewers, the governed runner dispatches through the installed `ai-review` front door in `final-check` mode, naming the assigned provider, exact merge base, exact head and implementing engine. That front door starts the provider lifecycle before dispatch and writes the qualified report under the review worktree's `.ai/reviews` directory. The governed runner checks that the report binds the assigned provider, repository, source digest and head before it records the separate shared-db verdict. A missing, malformed or mismatched report produces no shared-db verdict. Manual lifecycle begin/finish, retrospective imports and direct provider calls do not satisfy delivery.

An explicit top-level `--tests COMMAND` is forwarded as one opaque argument to this front door; it is never split or recovered from inherited wrapper arguments. When omitted, dispatch remains unchanged. Only the exact native engine report (`provider final-check — RUN`, matching run field and `ai-review-engine (review-lifecycle-core/1)` runner) and the established legacy pool report are accepted; both retain the report path, source identity, analysis and single-verdict checks.

The preserved report path is the input to `ai-task-gates check --before ship --reviewer-approval <report>`. The ship gate independently verifies the completed lifecycle record, provider/implementer independence, exact source and action. A shared-db verdict comment or immutable lane artifact alone is not a substitute for this provider-neutral report.

## Verification and delivery

Circuit-breaker, assignment-order, carried-slot, candidate-exhaustion, approval-composition and runner-release adversarial tests must pass. The complete combined source receives one independent lifecycle-recorded review and required CI on PR #4308; the already-merged PR #4294 remains inherited source, not a delivery prerequisite. The independent review remains pinned to the final code head. Merged-source runtime verification is distinct from source tests and does not authorize a database write, production action or a retry of historical spent work. PR4206 and its licensing claims remain owned by their existing session.


The allocator conservatively counts a historical start with the established narrow canonical merge-gap refusal as unchanged when no direct proof chain resolves it. It records conservativeHeads, never treats that result as substantive or a chain intermediate. There is no third-round refusal: spend is uncapped (owner 2026-10-16). All other provenance, lineage, binding and transport failures remain hard refusals. Foreign and unrestored noncanonical merges remain refused; the separately proved forward restoration below grants no special spend status.

## Forward canonical restoration

An authored edit accidentally included in an upstream merge is not an authored-capacity witness. Recovery must retain that history and first restore the complete effective source to the clean canonical Git merge of the mixed merge's actual first parent and incorporated protected main. The classifier may recognize exactly one such mixed merge, bounded by a later checkpoint on the same complete first-parent spine. The projection must be a plain, clean Git tree; a conflict-specific projection, partial restoration, source mode change, or caller assertion is insufficient. Existing immutable contract and evidence validation must authenticate every excluded metadata path before any checkpoint comparison.

Every crossed merge still has exactly two parents and a second parent in protected main. Foreign ancestry, multiple mixed merges, ambiguous ancestry, unsupported conflicts, and unverified metadata remain hard refusals even when later source was restored. The derived proof records the actual anchor, mixed merge, checkpoint and incorporated main identities.

The mixed merge and every commit in its neutralized segment are excluded from authored witnesses. Valid earlier author edits and later standalone edits still need the existing surviving-source witness against the final source. A restoration, empty commit, evidence-only follow-up or net revert cannot itself create a substantive-content proof. Original starts, negative decisions, slot identities and failure history are unchanged: spend remains uncapped (owner 2026-10-16). The checkpoint is a source-equivalence proof, not a review, budget reset, source-history rewrite, or authorization to apply anything.

## Paid starts before wholly transient evidence (#4889)

A historical paid start may precede every work-evidence file of its issue.
An ordinary later retirement of a complete evidence pair that is absent at both
comparison endpoints does not require inventing a trusted start pair. Recovery
first proves that start-side absence, authenticates the current complete Git
evidence against its actual immutable published contract chain, and authenticates
every retained transient pair's regular JSON identity, schema and contract hash
against that same bounded chain. Foreign issues or PRs, partial/unreadable pairs,
forged hashes/contracts, unavailable published contracts and endpoint-present
records retain refusal.

The transient reports' claimed checks and implementation tails are not accepted
as approval or source proof. No transient path is excluded from the source/merge
comparison; ordinary source ancestry, protected-main merge validation and the
ban on metadata source witnesses remain unchanged. The diagnostic result lists
`preEvidenceRetirements` and classifies that legacy start conservatively as
unchanged, even when genuine product edits survive. All unknown/nonterminal
starts remain charged; no history, negative verdict, review equivalence rule or
production gate is rewritten. A new independent exact-head review is required.

A wholly transient provisional report may have a missing required-check label
that the same author corrected before retiring that generation. The pre-evidence
recovery recognizes this only when all recorded provisional checks passed, its
only contract problems are missing required checks, and a later fully satisfied
same-generation report has the exact same immutable contract, implementation
head and every non-check report field. Every provisional observation must precede
a corrected witness on the same first-parent history. That witness must prove its
actual implementation files and canonical own-pair-only tail against the published
contract chain. Failed checks, changed source or other report fields, partial or
unreadable records, missing later correction and forged/foreign bindings refuse.
No command text is normalized or treated as equivalent. The result retains hashes
and witnesses under `supersededTransientCheckRecords`; original reports and paid
charges remain intact. Neither report becomes approval-equivalence authority.
