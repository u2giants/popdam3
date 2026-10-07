# Muse persistent review

| field | value |
|---|---|
| model | `muse-spark-1.3-contributor` |
| session | `118a4be5-506d-434b-948d-fccacbcd9ca2` |
| caller | `codex` |
| repository | `/home/ahazan/.codex/worktrees/509a/shared-db` |
| reviewed commit | `a11a91bb1ee7bfd16cd73b34a1733abb41d1aafa` |
| review copy | `/home/ahazan/.local/state/ai-devops/review-sandboxes/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1` |
| evidence fingerprint | `218d153ecf9eee83155c73400767aa7afc4a1c1292d39a5a844369cc1a136cc4` |
| last step adapter tokens | `null` |
| turn usage | `{"availability_reason": null, "catalog_cost_currency": "USD", "catalog_cost_estimate": 0.010558454, "completeness": "core-complete", "cost_provenance": "first-party model catalog price; estimate, not billed cost", "counter_provenance": "muse-code-1.4.0-R4161.1-durable-store-model-completed", "counters": {"cache_read": 394677, "cache_write": 0, "cost": null, "input": 478342, "output": 7013, "reasoning": 1636, "total": null}, "counting_semantics": "input includes cache_read; output includes reasoning; store has no total; do not add overlapping fields", "model": "muse-spark-1.3-contributor", "model_calls": 5, "observed_at": "2026-10-07T17:01:04.003882+00:00", "provider": "muse", "run_id": "0c28c29c-535c-4f09-99bd-4191bfcafbae", "runtime_version": "1.4.0-R4161.1", "schema_version": 1, "scope": "turn", "session_id": "118a4be5-506d-434b-948d-fccacbcd9ca2"}` |

## Request

Continue the SAME review conversation. I read your full first report and verified the cited code. Debate your strongest claims, not a rubberstamp.

1. I accept your important distinction: before production ownership, an early merge freeze primarily preserves completion/liveness and avoids invalidating expensive reviewed evidence. Current literal-main downstream gates REFUSE stale source; deletion of the early freeze does not automatically authorize stale production. But your unconditional "no unsafe apply becomes possible" is stronger than source demonstrates: it assumes ALL queue/merge/lock paths interlock atomically and runtime always pinned. Please bound this claim to verified guarded paths and distinguish no unsafe stale-source continuation from production starvation and repeated review expense. Keeping all equality guards and late serial merge/write barrier could be a simpler conservative fallback: defer a moving candidate, do not auto-rerun paid review endlessly. Would you support this as an alternative only if retry/liveness cost is measured acceptable?

2. Your three-gates simplification omits actual production acquire at manage-migration-author-lanes:3940 plus evidence/catalog recovery equality. Adding freeze.S and using classifyMainTip unchanged is NOT enough: source's diff is name-only, extension-based, no filemode/symlink/runtime-consumed-prose proof. It accepts AGENTS.md and docs/policy Markdown, and --production admits tests/evidence. Thus a shared STRICT checked-delta mode is necessary; ordinary .txt currentlylightweightallowed but freshnessreject is safe refusal notcorruption. Confirm whether you withdraw "exactly hardparts/same safety" as stated. We agree not to add a fourth independent policy: extend EXISTING classifyMainTip or same existing module, with one strict promotionProseTail mode; reuse ancestry/two-point/no-renames but add base-owned consume-denylist, full tree mode/type checks and exact runtimeclosure. Preserve unrelated legacy allowances only outside explicitly activated new mode. All NEW admission/qualifier/acquire/recovery callers use the same strict mode, no Python policy duplication.

3. Agree simplify storage and reuse. Plan says extend EXISTING target-queue manifest/canReusePromotionManifest/evaluateProductionFreshness, not build independentnamespace/service. I can remove the requirement for a separate approved-attestation object IF current preview/risk/dispatch artifacts already bind exact(S, sourcePR/head, orderedV,digests, producer identity), and final validator joins/verifies them under live authority. Before review, admission still needs an exact candidate identity and activation barrier. This can be existing freeze schema v2 + immutable source/attempt identity, while bounded freeze TTL controls merge pause only. Expiry/release of freeze cannot authorize production OR invalidate valid artifactbindings. Need retained candidate identity after freeze ends for recovery and cancelled/superseded/partialapply checks; can use existing run artifact/context instead of a newref. Please enumerate minimal needed fields/storage and name precise missing bindings to inspect before selecting freeze+S vs stronger manifest. Do not reduce to S alone if multiple attempts reuse S.

4. Agree same-PR cleanup exactSHA/runattempt fencing is an independent precondition and can be delivered first WITHOUT changing admission. No requirement to bundle cleanup with a new subsystem. A safety improvement with deterministic ABA regression test; explicit unreadable legacy recovery stays conservative, never any new bypass.

5. Agree train partial read needs explicit pagination/completeness/refidentity test, malformed/failed/unreadable unknown alwaysrefuse. But your one-sided handshake alternative insufficient if candidate reads absence then trainauthorizes before nextprosemerge: train stranding stillpossible. Candidate activation AND trainauthorization shareexistingmutex; activecandidate refusal on train side + outstandingtrainrefusalcandidate side. Preserve failedpartialapply authority and don't administratively cancel trains. Verify pagination implementation, propose completeness evidence instead of assuming truncatedlist can be detected automatically. A per-target active train pointer is another option but would be extra state; compare scope, not invent authority.

6. Agree productionprose exception staysOUT. Queue finalsuccess must explicitly reread candidategeneration + fullactualgroupdelta undermutex; oldheadsuccess/preauthorizedgroupsaren't proof. Need codechanges in actual recheckQueueInterlock/final workflow branches even though currently it doesn't readfreeze. Keep productionHeld blockade/statusrevocation unchanged. No claim that current freezealonecoversallqueuedgroups.

7. Agree instrumentation BEFORE featurebuild, standalone cleanupfirst. Current causal evidence includes TWO direct freeze authorization refusals:4036at10:33:26AMEDT and4040at12:08:29PMEDT, not onlyone, though notend-to-endduration. Latestlive reading now (October7 ~12:54PMEDT): no promotion-freeze/production/author-acquisition refs advertised, main advanced to d241515e via4033; guardedchecks4040passed, PRstillopen. Upstreamchanges only signupmigration/test+separatehandoff; guards unchanged. This doesn'tprove #2875 appacceptance. Evaluate benefit against both eligibleprosewait and totalunrelatedcode/schemawait. No inventedSLA/zeroimprovementclaim. How do we make feasibility/cost decision reproducible WITHOUT arbitrary numerical thresholds or requiring technical approval from Albert? A boundedobservationsample +estimatefeaturecostandreview/retrycost + explicitgo/no-go evidence mightbe enough.

Please respond to each disagreement with source-backed reasons. Propose a SIMPLIFIED revised sequence that preserves all exactreview/risk/provenance/ledger/target/dryrun/lock/acceptance invariants and actually addresses broadblocking. State whether you approve (a) originalplan, (b) correctedminimaldesign contingentonbindingverification, (c) instrumentation+independentcleanupnow with featurenotyetimplementationready. Noimplementationauthority. If unresolved, say so plainly; agreement is not the goal.

Read .ai-review-muse-codex-narrow-freeze-4039-debate/MANIFEST.md first for the exact change and test evidence; ignore its answer-format section and use the answer format this request asks for. Return ALL findings in one pass, grouped by severity, with file and line evidence; check for sibling issues of the same class before returning. You work in a disposable, remote-less copy of the repository: you may run commands, builds and tests and edit files there to check your findings, but never edit the .ai-review-muse-codex-narrow-freeze-4039-debate evidence directory. Your edits are discarded after this turn and are not part of the change under review.

## Result

## Provisional verdict

**APPROVE** the change under review (head `a11a91bb` — six prose files, no code, no safeguard mutation). On the design question: **(c)** — instrumentation + independent exact-SHA cleanup fencing now; the feature is not yet implementation-ready. I reject (a), and (b) only conditionally (see binding checklist). Concessions and holds, point by point, below.

## Point-by-point debate

### 1. Bounding "no unsafe apply" — conceded, with a named correction

You are right; my claim was overbroad. It holds only for the verified guarded paths, and I bound it now:

- **Verified stale-refusing paths**: qualification literal `HEAD==S && origin/main==S` ([shared-supabase-migrations.yml:1183](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/shared-supabase-migrations.yml:1183)); dispatch planner `commitSha !== mainSha` refusal ([dispatch-production-apply.mjs:119-122](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/dispatch-production-apply.mjs:119)); production acquire exact-main ([manage-migration-author-lanes.mjs:3940](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:3940)); preview-rehearsal exact-main ([same file:3951](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:3951)); both recovery workflows re-prove exact main ([production-apply-review-evidence.yml:39-49](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/production-apply-review-evidence.yml:39); [production-catalog-verification-recovery.yml:27-33](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/production-catalog-verification-recovery.yml:27)).
- **Not verified**: that every queue/merge interleaving interlocks atomically (the queue's final recheck reads production-ref presence + head status, never the freeze itself — [merge-queue-contract.mjs:436-468](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/merge-queue-contract.mjs:436)), and that runtime closure is always pinned (producer-closure digest exists in manifest code but live wiring at acquisition is Step-10-open per the report).

Corrected claim: deleting the early freeze cannot authorize a stale-source *continuation through the verified guarded paths* — each refuses. What it can cause is production **starvation** (every prose merge re-stales the candidate, paid review discarded each cycle) and repeated review expense. Your conservative fallback — keep all equality guards, defer a moved candidate, no auto-rerun of paid review — I support **only** with the measurement in point 7: if retry cost proves acceptable, the fallback is not just simpler, it is strictly safer than any delta-validator because it adds zero new trusted code. It should be the explicit default the feature must beat.

### 2. "Same safety / hard parts" — withdrawn as stated

I withdraw "exactly the hard parts / same safety." Verified against source, your characterization is correct:

- `classifyMainTip` diffs with `git diff --name-only --no-renames -z` ([check-main-tip-freshness.mjs:196](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/check-main-tip-freshness.mjs:196)) — **name-only, no mode/symlink/type checks**. A mode-only (`+x`) flip or symlink swap on an otherwise-unchanged tree is invisible to it.
- `isDocumentationPath` accepts **any** `.md`/`.markdown` outside `.github/` ([same file:74-83](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/check-main-tip-freshness.mjs:74)) — including `AGENTS.md`, which the merge classifier treats as rulebook/instruction ([documents-only-change.mjs:31,45-52](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/lib/documents-only-change.mjs:31)). Sibling issue of the same class: any `skills/.../*.md` or `.claude/.../*.md` instruction file would also pass freshness today. That is safe only because exact-equality gates elsewhere currently refuse *all* movement; the moment a delta-validator *permits* movement on this predicate, instruction files become admissible tail. This is the single strongest reason a strict mode is necessary, not optional.
- `--production` additionally admits tests/`.agent` evidence ([same file:101-105](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/check-main-tip-freshness.mjs:101)); recovery evidence workflow uses **non-`--production`** freshness (stricter) — so recovery already disagrees with acquire on `.txt`/tests. The `.txt` asymmetry you note is safe-direction (refusal), agreed.

I agree to the resolution: extend the existing `check-main-tip-freshness.mjs` module with one strict `promotionProseTail` mode — reuse ancestry/two-point/`--no-renames`, add full-tree mode/type checks, base-owned consumed-prose denylist (rulebook paths, global invalidators, runtime-consumed prose), exact runtime-closure comparison. All new admission/qualifier/acquire/recovery callers use that mode; legacy allowances persist only outside it. No fourth policy, no Python duplication.

### 3. Storage: freeze-schema-v2 + retained candidate identity — agreed with a binding checklist

Agreed: no new ref namespace/service; extend existing manifest primitives. But "freeze + S" alone is insufficient — S is reusable across attempts (retry after failure reuses S), so identity must disambiguate attempts. Minimal field set for freeze schema v2:

`{ schema: 2, S, sourcePR, sourceHead, orderedV, migrationDigests, runtimeClosureDigest, producerID, policyID, freezeSHA/self, attempt (run_id + run_attempt), trainAbsentProof }`

Missing bindings to inspect before choosing (each must be verified as already binding exact S, not assumed):
1. Preview artifact → does it bind (S, V, digests, producer)? Check `PREVIEW_PRODUCER_PATHS`/sidecar registry contents.
2. Risk assessment → binds `mainSha` + ordered versions + source PR (report cites tests at `test_production_business_risk_gate.py:2410`; verify live).
3. Dispatch inputs → `commit_sha`, allowlist, digests (`dispatch-production-apply.mjs:plan`).
4. Recovery evidence → binds `apply_main_sha` + artifact digest (verified above in the recovery workflow env block).
5. Train absence → no artifact binds this today; the v2 record must carry its own train-state proof or generation cursor.

Retained identity after freeze TTL/release: agree, use the existing run artifact/context (the production run's own inputs already carry `commit_sha`/`source_pr`/digests) rather than a new ref — but then the final validator must join run-context + v2 freeze record + live authority under the mutex, and cancelled/superseded/partial-apply checks need the attempt discriminator. If any of bindings 1–5 fails inspection, fall back to the stronger manifest record. Do not ship admission before this inspection is recorded.

### 4. Cleanup fencing standalone — agreed, ship first

Confirmed the defect and its separability: PR-matched release ([manage-migration-author-lanes.mjs:4107-1124](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:4107)) vs exact `--owner-sha` production release ([shared-supabase-migrations.yml:2167-2171](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/shared-supabase-migrations.yml:2167)) vs PR-matched `always()` freeze cleanup ([same workflow:2173-2181](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/shared-supabase-migrations.yml:2173)). Your 12:08 PM EDT renewal (same PR, new freeze) is the live ABA shape. Deterministic regression test + conservative unreadable-legacy path, no admission changes. No disagreement.

### 5. Train handshake must be two-sided — conceded; my one-sided alternative is withdrawn

Your TOCTOU is correct: candidate reads absence at T0, train authorizes at T1. One-sided refusal strands the train. I withdraw it. Further verified scope cost: **train paths currently take no mutex at all** — no `acquireMutex`/`MUTEX_REF` in `cli-train.mjs` or `orchestrator-flow/migration-train.mjs` (grep returns nothing), and `assertRecordedTrain` already fails closed on unreadable/non-array listings ([migration-train.mjs:74-81](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/orchestrator-flow/migration-train.mjs:74)) — so the real gap is not detection of truncation (already refused) but the cross-mutex atomicity, which requires *adding* mutex acquisition to train authorize/dispatch. That is new contention on the hottest lock in the system; it must be load-tested, not just unit-tested. On completeness evidence: `listRefs` is git-backed ([manage-migration-author-lanes.mjs:784](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:784)), so a point snapshot is complete-as-of-read; the evidence to record is read-timestamp + mutex-held proof, not pagination cursors. Per-target active-train pointer: extra state, extra owner — reject; shared-mutex both-sides is the smaller change.

### 6. Queue final-success rework — agreed, with the production-lane blockade untouched

Confirmed: queue recheck never reads the freeze ([merge-queue-contract.mjs:436-468](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/merge-queue-contract.mjs:436)); freeze protection arrives via head-status revocation ([same file:233-264](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/merge-queue-contract.mjs:233)). So `recheckQueueInterlock`/final workflow branches need real code changes to re-read candidate generation + full group delta under mutex; pre-authorized groups and old head `success` prove nothing post-activation. `productionHeld` blockade and revoke/restore loop stay byte-identical. No disagreement; this is a necessary line item the original plan under-specified.

### 7. Instrumentation-first, two refusals acknowledged, decision rule without Albert-as-approver

Accepted: two direct freeze-caused refusals (#4036 10:33:26, #4040 12:08:29 EDT) — causal for *authorization refusal*, not end-to-end duration. Noted live state (refs clear, main at `d241515`, #4040 checks green/still open, guards unchanged) — consistent with your reading; proves nothing about #2875 acceptance. Benefit must be scored on eligible-prose wait **and** total unrelated code/schema wait (the latter stays blocked in stage one — Albert's actual question — so stage one must be presented as partial relief, honestly).

Reproducible go/no-go without arbitrary thresholds and without making Albert a technical approver: I propose decision by **pre-registered inequalities**, not thresholds — the implementing session records, over a bounded sample (next 2 promotions or 14 days, whichever first): (i) causally freeze-attributed prose-refusal minutes, (ii) paid-review retry events caused by prose movement, (iii) estimated implementation + independent-review cost in the same unit (engineer-hours). Go iff (i)+(ii) exceed (iii) with the allocator-assigned reviewer concurring on the arithmetic. Albert's role stays what it is: business owner accepting/rejecting the *trade* (spend review budget to save merge wait), never approving code. The technical verdict stays with the assigned reviewer.

## Findings (full pass, grouped by severity)

**High**
- H1 — `isDocumentationPath` admits instruction files (`AGENTS.md`, `skills/…`, `.claude/…` `.md`) as "documentation": [check-main-tip-freshness.mjs:74-83](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/check-main-tip-freshness.mjs:74) vs rulebook definition [documents-only-change.mjs:31-52](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/lib/documents-only-change.mjs:31). Safe today only via exact-equality backstops; any delta-permit built on this predicate without a consumed-prose denylist admits instruction edits as tail. Strict mode must explicitly deny these. Sibling: `.github/*.md` is correctly excluded — extend that pattern, don't invent a new list.
- H2 — Name-only diff is blind to mode/symlink/type changes: [check-main-tip-freshness.mjs:196](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/check-main-tip-freshness.mjs:196). Strict mode needs full-tree (`ls-tree` comparison incl. modes/symlinks) over S..T, not just `--name-only`.
- H3 — Same-PR cleanup ABA (finding 4 above): [manage-migration-author-lanes.mjs:4107-1124](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:4107) + [shared-supabase-migrations.yml:2173-2181](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/shared-supabase-migrations.yml:2173). Independent precondition; blocks any staged-freeze/retry lifecycle.

**Medium**
- M1 — Recovery workflows pin exact main with the *stricter* non-`--production` gate ([production-apply-review-evidence.yml:39-49](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/production-apply-review-evidence.yml:39), [production-catalog-verification-recovery.yml:27-33](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/production-catalog-verification-recovery.yml:27)); any strict-mode rollout must convert all three recovery/acquire call sites together or a prose-advanced promotion recovers into refusal (stranded partial-apply). Test: partial-apply + prose tail → recovery succeeds on original attempt, never replays applied files.
- M2 — Train paths take no coordination mutex today (verified by absence); two-sided handshake adds mutex acquisition to train authorize/dispatch — new lock contention needing load evidence, plus failed/partial-apply authority preservation (never administratively cancel a train to admit prose).
- M3 — Queue final success needs new code (`recheckQueueInterlock` + gate workflow branches) to re-read candidate generation + full group delta under mutex; pre-authorized groups prove nothing.
- M4 — `.txt`/tests/evidence three-way inconsistency (admission-allowed vs freshness-refused) is safe-direction but will strand promotions as liveness failures; strict mode must define one set and the matrix needs a test asserting the refusal path re-qualifies cleanly rather than wedging.

**Low**
- L1 — `assertRecordedTrain` already fails closed on unreadable listings ([migration-train.mjs:74-81](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/orchestrator-flow/migration-train.mjs:74)); keep that shape, add mutex + generation-cursor test rather than new pagination machinery.
- L2 — Report's "0 up to remaining freeze-only wait" range stands; second refusal (#4040) strengthens causal-refusal count to two but still not duration. No SLA invented.

## Simplified revised sequence (preserves all invariants: exact review, risk-at-S, provenance, ledger/catalog, target proof, dry-run, exclusive lock, app acceptance)

1. **Now, standalone**: exact-SHA/attempt cleanup fencing + ABA regression test (H3); instrumentation with causal status codes (point 7). No admission change.
2. **Binding inspection**: verify artifact bindings 1–5 (point 3) against live source; record which hold. If any fails, stop — feature not ready.
3. **Strict mode**: extend `check-main-tip-freshness.mjs` with `promotionProseTail` (H1/H2 denylists + mode/symlink + runtime-closure); freeze schema v2 carrying the point-3 field set; all new callers (admission, qualifier, preview-acquire, production-acquire, both recoveries, dispatch planner) on the same mode.
4. **Concurrency**: two-sided train/candidate mutex (M2); queue final-success re-read (M3); race corpus incl. partial-apply+prose (M1).
5. **Gate**: pre-registered inequality decision (point 7) + allocator-assigned exact-head review of the implementation. Default if measurement disappoints: conservative fallback (keep equality, defer moved candidate, no auto paid-review rerun).

Step 10 ownership, branch protection, reviewer semantics, revocation loop, and production-lane blockade: untouched throughout. Broader code/schema merges stay refused; that is Albert's throughput question stage one does **not** answer, stated plainly.

## Design choice

- (a) original plan: **reject** (overbuilt storage/lifecycle; under-specified queue + recovery conversion; fourth-policy risk).
- (b) corrected minimal design: **conditionally supportable**, contingent on the point-3 binding inspection passing and H1/H2/M1–M4 closed with named tests + independent exact-head review.
- (c) **approved course**: instrumentation + independent cleanup now; feature not yet implementation-ready.

Unresolved, stated plainly: whether preview-artifact/producer binding (checklist item 1) already pins exact S — I did not verify the sidecar registry contents this turn, so (b) cannot be green-lit from this session alone.

## Verdict

**APPROVE**
