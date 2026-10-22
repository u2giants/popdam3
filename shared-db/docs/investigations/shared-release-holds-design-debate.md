# Shared release holds — substantive Muse design debate

Scope: proposal/design only. No runtime safeguard changes or database actions.
Parent [implementation plan](../../plan_shared_release_hold_reduction.md), tracker
[#3779](https://github.com/popcre/shared-db/issues/3779); narrower-freeze integration
uses the existing [#4039 design](../../plan_narrow_promotion_freezes.md).
All four implementation outcomes and every STATUS implementation row remain open.

## October 16, 2026 EDT — first substantive critique

Muse reviewed published main `6669538515a8a5813887e9fa98eb422682f9ca4b` in persistent
session `shared-release-holds-plan-critique` (Muse Spark 1.3 Contributor).
The native completed report found six design blockers, ten meaningful improvements
and five polish findings. This was a design critique, not merely publication safety.
Earlier safe-to-publish approvals did not establish implementation feasibility.
Raw prompts/transcripts/provider reports remain private; the source-only dispositions
below carry everything a new implementing session needs.

| Finding | Accepted correction / explicit disagreement | Revised plan location |
|---|---|---|
| B1 overlapping reviewed design | Adopt #4039 strict mode and full caller matrix; no duplicate classifier. `.txt`, evidence, tests and instructions deny by default. | §4, step6 |
| B2 undefined quarantine | Quarantine is the existing exact lease retained after ambiguous write, not a new service; named catalog/preview recovery ceremony. | §8.1 B–C |
| B3 unchosen admission architecture | Revoke all, then strict fresh re-admission during EARLY freeze only. **Keep production-held blockade** as #4039 requires; do not silently broaden its prior review into a during-apply exception. | step6 |
| B4 infeasible assumed fence | 8a independently buildable identity/release fixes; 8b isolated writer/pooler/unlock/termination experiment; 8c takeover only after GO. No claim that an opaque CLI can share a coordinator connection. | step8 |
| B5 release race / missing assertions | All five release paths use the shared mutex and bound identity; acquisition outputs passed to every actual mutating path. Old/new CLI compatibility and activation drain specified. | step8a, §8.1 F |
| B6 no durable receipt contract | Choose existing Git coordination transport with immutable prepared/write-intent/terminal/report-complete receipts; strict schema/provenance, bounded retries, failure and absent-receipt reconstruction. **Do not claim full reconstruction if preimage/provenance remains unknowable.** | §8.1 A–C |
| M1 producer closure/staged modules | Reuse risk producer/runtime closure, target manifest helpers and reconcile #3781/staged exclusive-policy. | step6 |
| M2 conflicting inert classifiers | One strict `promotionProseTail` predicate; ordinary CI/document classifiers retain only their original roles. | step6 |
| M3 admitted but no jobs | Exact group/run-start observation, bounded alert, one owner-qualified normal requeue and verification; no overrides or credential expansion. | §8.1 E, step9 |
| M4 mixed versions | Compatible readers/release adapter first; all callers next; no old active writer before enabling recovery/strict routes. | §8.1 F, step8a |
| M5 checkout drift/starvation | Refuse before write, owner-qualified release; at most one fresh redispatch, second drift stops and records competing source. | §8.1 D |
| M6 nonexistent merge prep | Name actual checkout/setup/preflights/quota work; no fictional long-test or packet stage, no transferable prep authority. Step3 independent of receipt schema. | step3 |
| M7 stall signal/host | Existing read-only queue-hygiene collector/schedule, run/job/attempt + acquisition/step timing; formatter/router roles corrected. | step7 |
| M8 rollback | Disable optional routes, reconcile active work, drain/revalidate groups, consumers before schemas; retain safety fixes and immutable evidence. | §8.1 F |
| M9 trains omitted | Complete caller matrix plus two-sided train/candidate exclusion and complete backend histories; no concurrent SQL. | step6 |
| M10 cancellation outcomes | Explicit state→release/retain/obligation table, including lost receipt, successor ownership, reporting/restoration errors. | §8.1 C |
| P1 reviewer waiting already pre-lock | Treat approval evidence re-verification as live checks; no invented reviewer wait stage. | step4 / actual step inventory |
| P2 freeze timing | Freeze checked on acquisition; production interlock preserves critical protection. | step6 / baseline |
| P3 duplicate module | No `release-independence.mjs`; reuse strict freshness module per #4039. | step6 |
| P4 release time source | Use actual Actions step/acquire/release timing, not an assumed durable ref-delete timestamp. | §3 |
| P5 tool version | Record the installed psql version in preparation as tool identity; no unexpected install under hold. | step4 |

## Debate positions sent for follow-up

1. Re-admission must not override the production-held blockade. #4039's prior
review explicitly keeps it. The useful narrower scope is inert prose during the
long early qualification freeze; actual database critical work remains serialized.
2. Minimal immutable operation receipts are justified for crash reconstruction
and early release; they do not introduce a second promotion approval/snapshot
service. They are not self-authenticating authority: validate trusted producer,
identity, current revocations and necessary live state. Cannot recover from an
unknown preimage by declaration.
3. Identity assertions and mutex-safe cleanup are valuable independently; they
cannot be advertised as fencing in-flight SQL. The experiment must qualify all
writer connections before takeover automation. If it cannot, mark that outcome
open instead of changing engines or granting new production access implicitly.
4. The admission incident establishes a liveness signature, not a definitive
provider-token root cause. One ordinary exact-head, approved requeue is the
bounded operational repair; permanent identity changes need their own reviewed
configuration inputs, not a guessed new credential.

## Round 2 — completed October 16, 2026, 10:59 AM EDT

Muse reviewed source `73e5f7949c4c3d675974a59a8789b5393e420a3b` in the SAME
persistent conversation. Native completion verified session identity and response.
Its actual assessment: all six original blockers architecturally resolved; every
prior disposition accepted, with M7/P1 partial because stale sentences remained.
It agreed with early-freeze-only admission, conservative absent-preimage handling,
receipt evidence without new approval authority, and the research-gated recovery
split. It did not claim that an opaque CLI can qualify fencing; NO-GO remains a
real possible outcome. Its bounded new punch list is addressed below.

| Round-2 finding | Root disposition and correction |
|---|---|
| N1 exact-key activation reader | Accepted. Compatible reader code first, old running versions drained, then optional default-false config field. Exact legacy-or-extended schemas only; all existing checks preserved. §8.1F/step6/tests. |
| N2 acquisition freshness semantics | Accepted. Explicit exact-match→strict-tail relaxation ONLY during recognized activated early freeze; all workflow production gates aligned in that case. Outside it preserve existing acquisition and caller modes. Preview recovery intentionally excluded. step6/tests. |
| N3 dependency inversion | Accepted. Step8a after2 and before4–5; step3 independently after1. PhaseB and individual dependencies now explicit. |
| N4 pre-prepared crash prover | Accepted conservative correction. Qualified backend-idle observation via8c/8b GO, otherwise retain lease with a named blocker. Terminal run or absent intent alone never clears it. §8.1B/tests. |
| N5 proof-kind ambiguity | Accepted. Success command-exit/post-state attestation distinct from recovery backend-termination observation; neither substitutes for the other. §8.1A/tests. |
| N6 drift watcher mechanics | Accepted. Existing no-DB controller observes exact dispatched attempt within bounded budget, validates strict trusted refusal artifact/marker, uses one chain-bound redispatch. New run collects baseline. Nonterminal waits owned; manual path reuses native helper. §8.1D/tests. |
| N7 repair host/once-only mechanics | Accepted. Calling bounded waiter or separate unprotected observation job; native normal dequeue plus exact-head normal enqueue; one create-only repair claim under coordination mutex, ambiguous results reconcile without a second repair. §8.1E. |
| N8 stale superseded sentences | Accepted. Corrected Git evidence transport, existing freshness test suite, already-outside approval waits, qualified-fence wording and early-freeze exception. |
| N9 slow reads under mutex | Accepted. 30-second total/two-attempt bounded fresh reads; immutable prefetch outside, timeout refuses and retains stage lease. step8c/tests. |
| N10 deletion invariant | Accepted. Audit namespace excluded from all janitors until separately reviewed retention; explicit deletion-selector regression. §8.1A/tests. |
| N11 ledger pointers | Accepted. P4 points to§3; P1/M7 now corrected across the full plan. |

No unresolved business choice. Round-2 corrections are committed in
`d35663b7296c930c1319753b51790c0965c99baf`; they have NOT received a subsequent
completed Muse verification. Research GO and all ten runtime implementation
outcomes remain unproved and open.

## Supported continuation blocked — October 16, 2026, 11:03 AM EDT

The additional same-session verification request failed local source preflight
before snapshot/provider launch because its asserted head was abbreviated. The
wrapper had already replaced the active-turn descriptor. Correcting the input
cannot resume: native state is `preparation_failed`, and supported `reconcile`
refuses because no exact successful retained process exists for this failed
invocation. Both earlier completed debates remain valid for their actual source
heads, never for the unreviewed correction head. No provider replacement, metadata
restore, replay, synthetic approval or fence bypass is authorized.

Recorded under the existing [Muse recovery issue #674](https://github.com/popcre/ai-devops/issues/674#issuecomment-6218354939).
Codex chat `01a144d8-b318-7ed0-af97-e852be49d231` owns this plan's publication
blocker; the toolkit's existing recovery owner retains its separate workstream.
Native shipment gate refuses absent an exact-head assigned approval. Revision
publication is NOT complete. Preserve the same conversation and qualified native
recovery evidence; resume verification only through a supported repaired path.
No shared release hold or database writer was acquired for this revision.

Posted by Codex chat 01a144d8-b318-7ed0-af97-e852be49d231 on hetz

## Round 3 — completed October 20, 2026, 11:18 AM EDT

The supported recovery path restored this persistent session after the
pre-provider failure above. Toolkit fix
[`112c0914`](https://github.com/popcre/ai-devops/commit/112c0914efb70b515fbf890ebcb188993998fb0f)
plus follow-up [PR #1879](https://github.com/popcre/ai-devops/pull/1879)
(merged `b100981f`) made `reconcile` accept an archived prior whose recorded
Muse runtime predates the current pin. Recovery evidence-bound, no replay and
no fence bypass: `recovered pre-provider Muse follow-up ... (historical runtime
1.4.7-R6101.1)`. Tracked on
[ai-devops#1876](https://github.com/popcre/ai-devops/issues/1876).

Same conversation `shared-release-holds-plan-critique` then completed a real
Muse turn over the broader draft at `3eda5c30d5c3db9d2c6c1984e0314dec9e58e393`.
Native report:
`muse-shared-release-holds-plan-critique-20261020T151823Z-694430-21304.md`.

Publication-scoped result at that head:

- **N1–N11 confirmed textually present** (reader-first rollout, freeze-conditional
  freshness, 8a-before-4–5, backend-idle prover, proof-kind split, drift watcher,
  repair mechanics, leftover fixes, mutex-read bound, janitor exclusion, pointers).
- **No blocking finding.** Prose-only scope held; proposal-only status intact;
  no authorization granted; no false completion claims; no secrets or private data.
- **Draft is publishable** at `3eda5c30`, subject to the native exact-head
  approval and PR merge that remain outside this review.

Polish items named for merge time (non-blocking): stale branch pointer in the
plan (PUB-1), self-stale handoff commit count (PUB-2), this ledger entry (PUB-3,
now recorded), and an `ai-pr-wait` scope note in step 9 (PUB-4).

Research GO and all ten runtime implementation outcomes remain unproved and
open. No shared release hold or database writer was acquired for this revision.

Posted by MiMo chat ses_ffe5ea6d797e3ffeQD5vdooveb on edge-dev
