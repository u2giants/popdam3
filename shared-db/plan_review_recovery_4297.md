# IMPLEMENTATION PLAN — review recovery (#4297, October 14, 2026 EDT)

## 1. Ultimate goal
Failed review services must not prevent healthy independent reviewers from reviewing unchanged work. Spending stays bounded and rejected work still needs repair. If any step conflicts with this goal, the goal wins — stop and flag it.

## 2. Application
Canonical popcre/shared-db tooling coordinates shared schema review. This is zero-database repository maintenance in a dedicated current-upstream worktree. Node.js modules, GitHub immutable refs, allocator mutex and guarded merge are existing capabilities.

## 3. Trigger
The review-recovery work addresses bounded paid-review exhaustion, independent reviewer assignment, owner-quoted fresh-slot policy widening, and valid review carry across equivalent content. The combined source and approval-composition repair are delivered atomically as PR #4294; PR #4294 source is incorporated with its original commit history and attribution, without a separate dependency merge.

## 4. Scope
Budget accounting, out-of-order assignments, automatic verified terminal releases, fresh-slot allowlist widening, carried-slot policy and exact-head approval composition, documentation, and adversarial tests. NOT migrations, production/database writes, historical proof fabrication, reviewer roster changes, removing gates, or paid automatic retry loops.

## 5. Current state
The canonical candidate combines the #4297 recovery changes with the inherited #4294 assignment and carry behavior in one PR #4294. The circuit breaker tracks verified failures by reviewer; peer resolution supports either-slot-first order, every live peer, earliest-peer policy, and the newest valid equivalent-content slot-one assignment when present. Latest replacements require exact failure binding; returned or refused assignments cannot be revived from older history. The approval gate composes only valid required-slot approvals from equivalent ancestor and current heads, with distinct reviewers and no return/refusal fallback. The runner automatically releases only recognized exact-bound terminal failures with no verdict. Owner-quoted widening applies only to a fresh later-slot draw; each slot's own durable policy remains exact on retry and replacement. The coordinator retains final policy and delivery decisions.

## 6. Findings
`assertPaidReviewCapacity` preserves conservative starts and returns reviewers exhausted by two exact-bound service failures for the unchanged content and slot. `resolvePeerSlots` validates own, slot-one, and all peer histories; it includes the newest valid carried slot-one record only when current-head slot one is absent and prior review content is equivalent. Assignment and replacement enforce own-slot policy first and recheck current peer policy under the mutex. The approval gate selects the latest valid assignments and refuses fallback through returned or refused slots. The governed runner releases only a verified terminal failure with no verdict or artifact.

## 7. Rejected approaches
No unlimited retries, deleting history, dummy source edits, refunding REJECT/REVISE, freeing unknown starts, reducing review count or bypassing current gates. A larger global failure cap just recreates the same dead end. The combined change preserves PR4294's independent source history and attribution while applying its policy with the #4297 recovery rules. It does not require a separate dependency merge; all combined source is independently reviewed together on PR #4294.

## 8. Locked decisions
A. Keep two conservative review-round starts per unchanged content/slot. Starts with no verified verdict-less infrastructure proof consume that allowance. Five recognized service failure codes include exact-bound verdictless reviewer_cannot_read_repository; unsupported codes remain conservative.
B. Every exact-bound verified infrastructure failure is accounted separately, regardless of total. At TWO such failures for a reviewer on unchanged content/slot, exclude that reviewer from NEW draws. Other healthy eligible reviewers retain capacity. Finite registered roster bounds new starts by two conservative rounds plus two service failures per reviewer; provider-unavailable and insufficient-quota evidence may use the existing monotonic provider pause path. No clock/head refresh reset. All exhausted pools yield a precise blocked state, never pointless source-edit advice.
C. Either slot may be first. Resolve every peer and keep fresh under-mutex revalidation. The earliest live peer anchors a new slot's policy. A fresh slot 2-or-later draw may widen that policy only with a nonempty recorded owner quote and a strict-superset allowlist; a subset, disjoint policy, unquoted widening, or restriction of an unrestricted peer refuses. A slot's own durable policy remains exact for retry and replacement, with no widening. When current slot one is absent, carry only the newest valid historical assignment for equivalent review content; verify latest replacement against its exact failure evidence. A returned or refused slot cannot be revived from older history. Preserve final exact-head approval count and distinct reviewers.
D. Runner auto-releases only a paid-started recognized terminal failure with no parseable verdict anywhere in stdout/stderr, using existing releaseFailedReviewer with exact held sequence, slot, reviewer, issue and head, confirmNoVerdict/confirmNoArtifact and existing CAS checks. No paid retry is launched. Release failure is reported with original error and preserved diagnostics, never treated as successful recovery. Unknown or malformed output remains conservatively counted.
E. Coordinator owns all policy, security, integration, commits, review and merge decisions. Workers implement mechanical edits only within assigned files.

## 9. Steps and gates
1. Budget module: replace global refund ceiling with separate exact-bound failure totals per reviewer; return failedReviewers/exhaustedReviewers and reinstated count plus existing paidAttempts/remaining. Preserve every provenance and scope validation; filter issue as well as PR/slot. Tests cover >2 failures across different reviewers,2 failures one reviewer exhausted,unknown starts exhausted,substantive change distinction,head refresh no reset,tampering. Gate node --test scripts/lib/lanes/review-circuit-breaker.test.mjs.
2. Peer resolver and manager: retain all peer discovery, returns filtering, malformed-history refusal and the 25-request ceiling. Carry the newest valid equivalent prior slot-one record when present without requiring one; validate replacements against exact failure evidence and never revive returned or refused history. New-slot policy comes from earliest live peer; a quoted strict-superset widening is limited to fresh slot 2+ draws. Own-slot retries and replacements inherit exactly. Fresh peer, carried-history and policy reads remain under-mutex checks. Candidate filtering incorporates exhaustedReviewers in EVERY ordinary/replacement/fallback/reuse branch. Gate node --test scripts/manage-migration-author-lanes.test.mjs.
3. Runner: add guarded automatic terminal release seam to injected deps and production deps; preserve exact sequence from held assignment/start evidence, not caller guess. Gate node --test scripts/run-governed-review.test.mjs. Workers must flag any missing bound sequence seam before editing wider modules.
4. Approval composition and documentation: preserve byte-identical `.agent/`-only equivalence, ancestor relation, returns/refusals, newest valid assignments, required review count and reviewer diversity. Record finite budgets, service recovery vs substantive rejection, independent assignment, all-pool exhaustion and historical proof limits. Run all four gates centrally and applicable full offline checks. Compare High and Extra High through actual findings, errors and coordinator corrections, explicitly no controlled performance claim.
5. Deliver one atomic PR #4294 containing all combined source, then draw an independent code reviewer under existing rules while CI runs and batch corrections. No separate dependency merge is required. Guarded merge only after required approval/checks. Merged-source runtime verification must exercise actual supported tooling without DB write or paid loop. Preserve original author attribution and commit history; do not assign retroactive authority to earlier commits.

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

## 15. Canonical delivery card

The complete combined source is prepared for existing PR4294 / mimo/allowlist-widen-slot2 so the MiMo approach continues. Original Codex publication PR4299 at8c6590ee6c7be4363e39cf665d24265234d8176d and MiMo publication at8393f1db01705339132f92d093f1e6d76cf1e25f are retained as ancestors. Generation11 prospectively covers the latest-head reconciliation and service-code repair; it does not claim earlier source authoring. Original PR4299 is preserved as superseded after exact combined source is published. Both approaches are incorporated; no source branch is overwritten or force-pushed. One assigned current-head independent review and all required checks gate the combined source.
