# Muse persistent review

| field | value |
|---|---|
| model | `muse-spark-1.3-contributor` |
| session | `118a4be5-506d-434b-948d-fccacbcd9ca2` |
| caller | `codex` |
| repository | `/home/ahazan/.codex/worktrees/509a/shared-db` |
| reviewed commit | `a11a91bb1ee7bfd16cd73b34a1733abb41d1aafa` |
| review copy | `/home/ahazan/.local/state/ai-devops/review-sandboxes/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1` |
| evidence fingerprint | `9c59cd381657dbb9149d02d6c42927dc2b0054b6d05d686ddcda32d5fbe3b3f9` |
| last step adapter tokens | `null` |
| turn usage | `{"availability_reason": null, "catalog_cost_currency": "USD", "catalog_cost_estimate": 0.010212412, "completeness": "core-complete", "cost_provenance": "first-party model catalog price; estimate, not billed cost", "counter_provenance": "muse-code-1.4.0-R4161.1-durable-store-model-completed", "counters": {"cache_read": 123106, "cache_write": 0, "cost": null, "input": 217318, "output": 2725, "reasoning": 356, "total": null}, "counting_semantics": "input includes cache_read; output includes reasoning; store has no total; do not add overlapping fields", "model": "muse-spark-1.3-contributor", "model_calls": 2, "observed_at": "2026-10-07T17:02:52.239107+00:00", "provider": "muse", "run_id": "18d326a1-2c8e-4493-ae0d-36fa9e336a2b", "runtime_version": "1.4.0-R4161.1", "schema_version": 1, "scope": "turn", "session_id": "118a4be5-506d-434b-948d-fccacbcd9ca2"}` |

## Request

Final substantive round in SAME conversation, before editing documents. We agree original overbuilt plan should be superseded by a phased gated proposal; no code implementation today. Three precision corrections before I encode consensus:

A) Train listing: your claim "listRefs is git-backed" is only true under reviewWireBudget. Actual production githubIo.listRefs at manage-migration-author-lanes.mjs:784–788 reads: if(reviewWireBudget)return gitRemoteRefRows(prefix); otherwise ghPaginated(`repos/${REPO}/git/matching-refs/${short}?per_page=100`).map(...).filter(row=>row.sha). Following comments explicitly say GitHub matching-refs IS NOT paginated and earlier pagewalking defects. Thus cannot replace completeness tests with timestampalone. assertRecordedTrain nonarrayrefusal doesn'tdetect partialARRAY or filteringinvalidrows. Strict adapter must validate both supported backends, reject malformed/incomplete/failed reads and synthetic truncatedcompleteflagfalse, reject missing advertisedSHA; whole-reading evidence +mutexheld +refidentities nottimestampmagic. Existing backend guarantees need recordedactualproof. Owner existing coordinationIO maintainer/implementingworkstream. You should retract nonarrayalreadycoversTRUNCATION claim. Two-sidedmutex/loadtests agreed; no newactive pointer.

B) Measurement units: blocked PR wallclock minutes cannot be added to retryevents and compared with engineerhours. Overlapping PRwaits mustn't count twice as humanhours; code/schema workremainsblocked and observational samplemayzeroreadyprose. Pre-register next2 naturallyauthorizedpromotions OR14days as OBSERVATIONBOUND, not automatictimebasedschedulerorhardperformancepromise; unmet/insufficientsample => featurehold. Separate causaleligibleblockedPRminutes, criticalpathwallclockdelay, retry providerdollars+activeagenttime, implementation/review/upkeep estimated costs. Translateonlyusing explicit defensibleconversion, otherwise technicalgo/nogo remains insufficient evidence. No defaultneedAlbertapproval: owneralreadyrequestedpartialreliefinvestigation; reviewerjudges technical readiness+sound evidence, only actual businessscope/budgetchoice would belongAlbert. Also move economicgate BEFORE featurecodebuild, notstep5 AFTERbuildingit. Keep productionwritepauseunchanged. Alternative "deleteearlyfreeze" is evaluatedproposalonly, nevercurrentdefaultunlessseparatelyreviewedchange; currentdefault remains existingglobalfreeze.

C) Your modeflip wording: git diff --name-only reports a modechangedPATH, not invisiblepath. Correct defect is mode/type are NOT validated: returned docs/path.md classifiedinert; an otherwiseunchanged +x/symlink is accepted. Don'tstate gititselfinvisible. The current broadpredicates aren'tnecessarily unsafe everywhere due pinnedcheckout/backstops; strictmodeextension threatmodel is whatwe'reproving.

Proposed revised plan:
0 preregister metricsandactualbindingsaudit, noauthoritychange; independentlycleanup exactCAS/attemptfence canbe separate firstsmallreviewedfix laterauthorized.
1 inventory/cost/benefit gate with verified existingartifactbindingmatrix; decide usingevidence whether buildstrictproseexception atall, keepglobalfreezebydefault.
2 onlyifgatepasses, extendexistingclassifier withonepromotionProseTail/fulltreedenylistmode and existingruncontext/freezeschemav2, no new snapshotref/attestationobject IF existingapprovedartifactjoin verifiedcomplete. Ifnotcomplete stopandreviseproposal, noautomaticstrongernewsubsystem.
3 wire ALLcallers recovery/qualifier/preview/prodacq/dispatch/admission andqueue+two-sidedtrainmutex, preserve exactsource/runtime/dryrun/target/ledger/sourceapproval/risk/writepause.
4 negativeconcurrency/loadtests, assignedexactheadreview+CI, shadow/canary completeoriginalappacceptance measured; conservative rollbackdoesn'tcancelapply/deletelock.

Please provide final settledverdict and explicit concessions/remaining objections to this revised proposal. Distinguish APPROVEasdocumentdebate from implementationauthority and allocatorapproval. Is it now executable as an evidence-first gatedplan (not a feature-readyimplementationblueprint)? Can you approve that proposedsequencewhileleaving featurefeasibilityconditional? I will retain fullverbatimthree-turnreviews and correctionledger, notoverwriteearlieropinions. Confirm exact open gates/owners, no forcedagreement.

Read .ai-review-muse-codex-narrow-freeze-4039-debate/MANIFEST.md first for the exact change and test evidence; ignore its answer-format section and use the answer format this request asks for. Return ALL findings in one pass, grouped by severity, with file and line evidence; check for sibling issues of the same class before returning. You work in a disposable, remote-less copy of the repository: you may run commands, builds and tests and edit files there to check your findings, but never edit the .ai-review-muse-codex-narrow-freeze-4039-debate evidence directory. Your edits are discarded after this turn and are not part of the change under review.

## Result

## Provisional verdict

**APPROVE** the change under review (head `a11a91bb`, six prose files, no code). On the revised 0–4 gated proposal: approved **as an evidence-first gated plan, not a feature blueprint** — feature feasibility stays conditional on the open gates below. This approval is debate concurrence only: no implementation authority, no substitute for allocator-assigned exact-head review.

## Concessions (all three corrections accepted)

**A) Train listing — retracted.** Verified: production `listRefs` is REST-backed, not git-backed: `ghPaginated(.../git/matching-refs/...)` with `.filter((row) => row.sha)` ([manage-migration-author-lanes.mjs:784-788](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:784)). Git-backed `gitRemoteRefRows` applies only under `reviewWireBudget`. I retract both claims: (1) "point snapshot complete-as-of-read" — the comments record `matching-refs` ignores `per_page`/`page` with measured 726-ref evidence ([same file:798-804](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:798)), which is historical measurement, not a contract — backend behavior can change without our code changing; (2) "non-array refusal covers truncation" — `assertRecordedTrain` refuses non-array ([migration-train.mjs:76-80](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/orchestrator-flow/migration-train.mjs:74)) but a partial-yet-valid array passes, and `:787`'s `.filter(row => row.sha)` silently drops malformed rows instead of refusing them. Required: strict adapter validating both backends, refusing malformed/incomplete/failed reads and any synthetic truncated-complete flag, whole-reading evidence + mutex-held + ref identities. Owner: existing coordination-IO maintainer / implementing workstream. Two-sided mutex + load tests stand agreed; no new active-train pointer.

**B) Measurement units — corrected.** Wall-clock blocked minutes, retry-event counts, and engineer-hours are incommensurable; overlapping PR waits double-count as human-hours. I accept: pre-register the observation bound (next 2 naturally authorized promotions or 14 days) as an observation bound, never a scheduler or performance promise; insufficient sample ⇒ feature hold. Report four separate ledgers (causal eligible-blocked PR minutes, critical-path wall-clock delay, retry provider-dollars + active-agent time, implementation/review/upkeep estimates); convert only via explicit defensible conversion or record go/no-go as insufficient-evidence. Economic gate moves before feature build (your step 1, not step 5). Albert's standing request covers the investigation; technical readiness is the reviewer's call; only a real scope/budget choice would go to Albert. Current default stays the existing global freeze; "delete early freeze" remains an evaluated proposal, never the default absent a separately reviewed change.

**C) Mode-flip wording — corrected.** `git diff --name-only` does report a mode-changed path; git is not blind. The defect is validation-blindness: the path returns, is classified inert by extension, and nothing checks mode/type. Strict-mode threat model stands as reworded; broad predicates remain safe today only via pinned-checkout backstops plus exact-equality gates.

## Findings (full pass, grouped by severity)

**High**
- H1 — Silent row-drop in production listing: `.map(...).filter((row) => row.sha)` ([manage-migration-author-lanes.mjs:787](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:787)) discards malformed ref rows without refusal. Sibling of the same class: any consumer treating the filtered array as complete inherits the gap — `assertRecordedTrain`'s supersession scan ([migration-train.mjs:76-80](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/orchestrator-flow/migration-train.mjs:74)) and the candidate train-absence check. Strict adapter must refuse on malformed rows, not filter them.
- H2 — Instruction files pass the doc predicate: `isDocumentationPath` accepts any `.md` outside `.github/` ([check-main-tip-freshness.mjs:74-83](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/check-main-tip-freshness.mjs:74)), covering `AGENTS.md` and `skills/`/`.claude/` instruction Markdown that the merge lane treats as rulebook ([documents-only-change.mjs:31-52](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/lib/documents-only-change.mjs:31)). Strict `promotionProseTail` mode must carry an explicit consumed-prose denylist; reusing the predicate unchanged would admit instruction edits as tail.
- H3 — Same-PR cleanup ABA: PR-matched release ([manage-migration-author-lanes.mjs:4107-1124](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:4107)) vs exact `--owner-sha` production release ([shared-supabase-migrations.yml:2167-2171](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/shared-supabase-migrations.yml:2167)) with PR-matched `always()` freeze cleanup ([same workflow:2173-2181](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/shared-supabase-migrations.yml:2173)). Separable first fix; precondition to any staged lifecycle.

**Medium**
- M1 — Recovery paths are the strictest gates in the chain (non-`--production` freshness in both recovery workflows) and must convert in the same change as acquire/qualifier, or a prose-advanced promotion strands at partial-apply recovery. Required test: partial-apply + prose tail ⇒ recovery completes on the original attempt without replaying applied files.
- M2 — Train authorize/dispatch take no coordination mutex today; two-sided handshake adds mutex acquisition to those paths (new contention on the hot lock — load evidence required) while preserving failed/partial-apply authority, never administratively canceling trains.
- M3 — Queue `recheckQueueInterlock` reads production-ref presence + head status, never the freeze ([merge-queue-contract.mjs:436-468](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/merge-queue-contract.mjs:436)); freeze protection arrives only via head-status revocation ([same file:233-264](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/merge-queue-contract.mjs:233)). Stage 3 must add candidate-generation + full-group-delta re-read under mutex; `productionHeld` blockade and revoke/restore loop stay untouched.
- M4 — `.txt`/tests/evidence predicate disagreement across the three classifiers is safe-direction (refusal) but needs a liveness test: refused-then-requalified promotions must complete cleanly, not wedge.

**Low**
- L1 — Backend-guarantee comments (matching-refs non-pagination, measured 2026-09-02) are dated measurements, not contracts; the strict adapter must not depend on them.
- L2 — Two causal refusals (#4036, #4040) establish authorization blockage, not duration; no SLA inferred.

## Revised 0–4 sequence: approved as gated plan

Executable as an evidence-first gated plan: yes. Each stage has a falsifiable exit (binding matrix incomplete ⇒ stop; sample insufficient ⇒ hold; inequality fails ⇒ fallback). I approve the sequence with feature feasibility explicitly conditional. Step 0/1 (metrics + bindings audit + standalone cleanup fix) may proceed to separate authorization; steps 2–4 require the step-1 gate record plus allocator-assigned exact-head review. Conservative fallback (keep equality, defer moved candidate, no auto paid-review rerun) remains the default the feature must beat. Production write pause unchanged throughout; code/schema merges stay refused in any prose stage — partial relief, stated as such.

## Open gates / owners

1. Binding matrix (preview artifact, risk `mainSha`, dispatch inputs, recovery evidence, train-absence proof) — implementing workstream; blocks step 2.
2. Strict-adapter backend validation + train listing completeness — coordination-IO maintainer / implementing workstream.
3. Observation-bound ledgers + pre-registered inequality — implementing workstream; reviewer judges sufficiency.
4. Exact-head implementation review + CI + shadow/canary with original app acceptance — allocator-assigned reviewer, not this debate.

Remaining objection: none blocking the plan-as-gated; my standing objection is to any reading of this debate as implementation approval — it is not. All three turns retained verbatim per your ledger; no forced agreement beyond the concessions above.

## Verdict

**APPROVE**
