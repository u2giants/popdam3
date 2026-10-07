# Investigation: narrower shared-db promotion freezes

Recorded October 7, 2026, 11:39 AM EDT. Source baseline: `fee69a25ffd9b39c2b3accfde680dfbac3aa54f5`, freshly fetched and accepted by `scripts/check-worktree-freshness.mjs`. Tracking: [#4039](https://github.com/popcre/shared-db/issues/4039). Owner: Codex chat `01a11700-4dab-7443-8e0a-7146957b2cd9` on edge-dev3. Investigation only: no production write, safeguard implementation, settings mutation, claim transfer or freeze release.

Companion: [implementation proposal](../../plan_narrow_promotion_freezes.md). The evidence references below are relative to this immutable baseline unless explicitly identified as live GitHub readings. Later source movement requires revalidation.

## Executive recommendation

Do not replace the global freeze with table-name locks. Existing claims are useful collision controls, but they do not prove complete independence of a promotion. Retain exclusive database writes and conservative refusals for uncertain dependencies.

The revised recommendation after [three rounds with Muse](narrow-promotion-freezes-muse-debate.md) is **evidence first**, not immediate construction of a snapshot subsystem. Preserve the existing global freeze. Plan a separate exact-SHA/attempt cleanup-race correction, instrument causally attributable delay, and audit existing source/preview/risk/dispatch/recovery bindings before deciding whether a prose exception justifies its cost. No code or production action is authorized by this report.

If those gates justify a feature, reuse existing run context, freeze record and freshness module with one strict ordinary-prose mode. Do not create a separate snapshot namespace or approved-attestation lifecycle unless a new reviewed design establishes its necessity. All source/review/migration/runtime identity remains pinned, including run attempt; all downstream callers and queue/train races must be handled together. Incomplete artifact bindings stop feature work.

The potential feature offers **partial relief only**: ordinary prose during review/qualification. Every code/schema/unknown-dependency merge stays conservatively blocked, and every merge stays blocked during held production ownership. Exact-object claims are insufficient for broad conflict-only admission. Removing the early freeze while keeping equality gates is a separately evaluated liveness/retry alternative, not the current default. Existing guarded stale-source checks refuse changed main; that is not a proof of all queue/runtime interleavings.

Initial allocator-assigned Gemini approval of source 610e80cd remains retained in §9. Muse's owner-requested supplemental debate approved the revised evidence-first sequence, not feature implementation readiness or allocator authority. Earlier opinions are preserved verbatim rather than overwritten.

## 1. Current behavior and complete blocking map

| Control/path | Current behavior | Baseline source |
|---|---|---|
| Freeze read | Read create-only ref; malformed header/body, empty owner or bad expiry is treated as live; readable expiry removes blocking without deleting ref | `scripts/manage-migration-author-lanes.mjs:4063` |
| Freeze acquire | Integer issue/PR, nonempty owner, TTL 1–180 minutes; acquire global author mutex, refuse existing live/unreadable freeze, exact-SHA delete expired record, create replacement, release own mutex | same file `:4087` |
| Freeze release | Serialized by same mutex; match textual owner **or source PR**; exact observed ref deletion; absent is idempotent; unrelated readable live record refuses | same file `:4107` |
| Unreadable release exception | Any positive PR can release unreadable record; existing test explicitly exercises it. This is current recovery behavior, not permission exercised here | same file `:4116`; test `:11087` |
| Guarded migration/code merge | Merge lane acquisition checks production absence then live promotion freeze; there is no object filter. No migration claim required for ordinary code, but same global blocking remains | same file `:4026–4043`; `.github/workflows/guarded-migration-merge.yml:160` |
| Documents/maintenance authorization | Holds global mutex, proves production absent, checks same freeze, classifies exact base/head complete diff, checks PR unchanged, posts required authorization | same file `:4126–4158`; `.github/workflows/documents-only-merge-authorization.yml` |
| Migration trains | Exact main at authorization and dispatch; stage-one exception excludes trains and requires serialized mutual exclusion with outstanding train authority | `scripts/lib/lanes/cli-train.mjs:29–38,49–63`; `scripts/orchestrator-flow/migration-train.mjs:32,95–99` |
| Native queue | Group resolves **one** source PR; proves reviewed source head in synthetic group; acquires protected merge lane and rechecks latest PR authorization and production interlock immediately before group success | `.github/workflows/merge-queue-gate.yml:117`; `scripts/merge-queue-contract.mjs:233–276,436–468` |
| Queue multi-PR batches | Current supported contract resolves a single PR; a mixed batch must refuse, not inherit one member's clearance | `scripts/merge-queue-contract.mjs`; `scripts/configure-merge-queue.mjs` |
| Production lane | Requires exact **current** main before acquisition; merge and production mutually exclude. Global production ref independently blocks code and documents even after freeze TTL | `scripts/manage-migration-author-lanes.mjs:3943–3945,4042,4138` |
| Production revocation | Revokes authorization of every open PR; cleanup restores only statuses owned by this run; normal guarded reauthorization still required | `.github/workflows/shared-supabase-migrations.yml:1831` onward and after `:2188` |
| Pure exclusive policy | Unknown/missing/unreadable freeze state fails closed for merge; readable expired permits; preview/production not blocked by freeze | `scripts/lib/lanes/exclusive-policy.mjs:110–201` |
| Observability/configuration | Freeze included in snapshot and lane inventories, not additional admission readers | `scripts/orchestrator-snapshot.mjs:43`; `scripts/configure-merge-queue.mjs:49`; `scripts/capture-repository-transfer-baseline.mjs:48` |
| Production cleanup | Always attempts production ownership release first, then freeze release by **source PR**; freeze cleanup is continue-on-error | `.github/workflows/shared-supabase-migrations.yml:2159–2182` |

Search inventory: `rg -n 'assertNoPromotionFreeze|readPromotionFreeze|PROMOTION_FREEZE_REF|promotion-freeze' scripts .github/workflows`. Outside tests and inventories, direct live freeze readers are the lane module. The extracted exclusive policy expresses the same contract; callers must remain aligned. Search for production ref checks independently: a freeze-only patch would leave global blocking in place.

Migrations, workflow/tool/configuration changes and mixed PRs all use the guarded merge route and are refused regardless of object disjointness. Ordinary prose also refuses through its lightweight path. A group already holding the merge lane is not revoked merely by acquiring the promotion freeze: freeze acquisition does not drain or prohibit an already-held merge ref. Current exact-main checks are the backstop. A proposed snapshot must close this admission/final-merge race explicitly.

## 2. Promotion chain and immutable versus moving inputs

```text
Reviewed source PR head + durable allocator verdict(s) + leased object/version scope
    -> guarded merge [collision/freshness/lease rechecks, exclusive merge]
    -> merged source commit contained in current main S
    -> merged-main preview rehearsal at S [bounded ordered versions V]
    -> immutable artifact A [target, migration hashes, producer code, source membership]
    -> qualification [activation, exact S=current main, exact source head verdict,
                      source issue admission, preview provenance, risk assessment]
    -> auto-dispatch {S,V,source PR,work issue,A digest,review digest}
    -> review job [fixed checkout S, fresh ledger, deterministic risk/allowlist guards]
    -> exclusive production lock [currently insists S=current main]
    -> recheck artifacts/issue/target; bounded checkout=(remote ledger union V)
    -> fresh bounded dry-run; prove target immediately before write
    -> per-file transactional apply, ordered V; ledger/catalog proof
    -> record application acceptance separately; owned cleanup
```

Current workflow concurrency is already target-qualified: `shared-supabase-migrations-preview` and `shared-supabase-migrations-production`, with PR/group checks per ref (`.github/workflows/shared-supabase-migrations.yml:126–139`). Preview and production do not share one global workflow queue. Older dispatch/procedure comments still describe that historical group. Same-target scheduling, database exclusive refs and the promotion merge freeze remain distinct controls. Keeping source merges moving does not remove same-target write scheduling or shared-preview contention. Existing Step 10 work must be reused, not duplicated.

Immutable inputs: source head/merge commit, exact migration bytes, ordered allowlist, artifact digests and producer closure, risk assessment of the exact snapshot, activated safety policy identity, target, issue/contract identity and generation. Fresh inputs: current source-PR status, issue authority, artifact validity/expiry, live refs, live production ledger/catalog and target identity, newly introduced prohibitions and cancellations. Never pin a stale open issue or a cancelled verdict just because code is pinned.

### Current-main equality is not enforced uniformly

Migration-train authorization/dispatch also pins current main (`scripts/lib/lanes/cli-train.mjs:29–38,49–63`; `scripts/orchestrator-flow/migration-train.mjs:32,95–99`). Stage one explicitly excludes this route. It must reject candidate creation when any train has outstanding authorized/dispatched/failed state or unreadable latest-generation evidence, and reject new train authorization while a prose-admitting candidate is active, under the same coordination mutex. Proposed-only train data may be refreshed normally; no approved train may be silently invalidated by admitted prose. This requires a mutual exclusion handshake, not merely a one-time absence scan.

* Merged preview acquisition insists equality (`manage-migration-author-lanes.mjs:3953` onward); workflow preview calls freshness without `--production` (`shared-supabase-migrations.yml:431–436`).
* Qualification contains a literal `HEAD==S && origin/main==S` check (`:1173–1184`) and will dispatch nothing after even prose movement.
* Production review/apply checkout remains exactly S, but calls `check-main-tip-freshness.mjs --production` (`:1557–1564`, `:1821–1830`). That classifier already tolerates Markdown outside `.github`, selected `.agent` JSON, and test files (`scripts/check-main-tip-freshness.mjs:64–109,121–243`).
* Production lock acquisition still requires literal equality (`manage-migration-author-lanes.mjs:3943`). Thus the production-inert allowance alone cannot authorize a moved-main promotion.
* Risk/preview proofs compare migration bytes and runtime producer closure against the snapshot (`scripts/production_business_risk_gate.py:596`, `:1244`, `:2229`, `:3743`). The producer closure is wider than one workflow: SQL sidecars, scripts/configuration and registered verification artifacts matter. Additional recovery callers also retain equality: `scripts/dispatch-production-apply.mjs:119–122`, `.github/workflows/production-apply-review-evidence.yml:39–49` and `.github/workflows/production-catalog-verification-recovery.yml:27–33`. Their existing conservative recovery remains mandatory; support for harmless tail movement must not strand a partially applied run.
* Risk acceptance binds `mainSha`, ordered versions and source PR; tests reject any mismatch (`scripts/test_production_business_risk_gate.py:2410` onward). Preserve this binding to S; never relabel old evidence with new main T.

The proposed replacement is **S remains an approved protected-main ancestor, every intervening change S→T is positively proven ordinary inert prose, the pinned runtime closure and V bytes are identical, live safety/authority remains valid, and final admission/production acquisition is serialized**. This replaces repository-tip identity with exact promotion identity plus a verified harmless delta. No mixed, unknown, non-ancestor, empty unexplained, mode-changing, renamed-unclassified or over-ceiling comparison is accepted.

Do not reuse the path-only Markdown freshness predicate as the new admission classifier: behavior-changing instructions also use Markdown. Use the base-owned complete-change classifier plus an explicit runtime/instruction/global-invalidator denylist, reject symlinks/modes/deletions/renames unless exact semantics are proven, and verify no production-consumed prose is admitted. Existing test/evidence allowances are separate history; do not widen source-review equivalence to tests.

### Existing implementation and owned overlap

`plan_shared_db_workflow_refactor.md:294–302` already specifies unified production freshness and a bound promotion manifest under Step 10 / #3781. `scripts/target-queue-identity.mjs:247–357` already implements `evaluateProductionFreshness`, `digestManifestInputs`, `promotionManifestBinding` and `canReusePromotionManifest`; the latter validates prior inputs against prior binding and harmless path movement, but still needs live current-input comparison/ancestry where consumed. Do not replace it with another snapshot subsystem. The extracted policy calls these existing primitives. Live #3781 closeout comment at **October 6, 2026, 8:39:11 PM EDT** records PR #4018 merged as `2ccebea0f79b43a33bd4d8189460ac0fd34e26be`, explicitly **policy-level proof only**: production acquisition call-site wiring remains unimplemented because other PRs own the lane manager; real queue split acceptance remains unproved. Owner recorded there is the MiMo Step 10 workstream; current execution activity was not verified. This investigation does not take its scope or claim.

The proposed work is a narrow freeze-admission extension **after reconciling and consuming that existing implementation**, not a new Step 10 implementation. Future work must inspect the live owner/PR scope and stop shared-file edits until supported ownership release. #4039 tracks this investigation and any expressly authorized new freeze-specific follow-through; existing Step 10 acceptance stays on #3781.

Conditional identity lifecycle: if the binding/benefit gates in companion §§9.0–9.2 pass, retain exact S/V/source/runtime/baseline and attempt identity before risk review through existing context/records. Candidate identity permits only proven inert-prose admission, never production. Production requires the complete existing approved preview/risk/dispatch evidence join, with live cancellation/supersession checks. No separate candidate ref or approved-attestation object is mandated. If existing bindings are incomplete, stop and revise/re-review the design. Creating the first identity only after risk approval cannot relieve review-period blocking.

## 3. Claims, dependencies and blind spots

`parseClaimBlock` supports writes/reads and legacy objects-as-writes (`scripts/check-dispatch-collision.mjs:128` onward). Claims protect exact object writes versus both reads and writes, and claim lifetime is not ended automatically by lease expiry (`scripts/lib/lanes/claims.mjs:101–131`). Migration versions remain reserved, never recycled. Work contracts separately pin generation, scope and producer/evidence identities. These are real controls, not a complete SQL semantic model.

Dispatch parser coverage includes create/alter/drop table/function/view/index/type/policy and role operations to the extent described by `describeDispatchCoverage`; role reads are explicitly extracted (`scripts/check-pr-object-collisions.mjs:880–904`, `scripts/lib/sql-role-operations.mjs`). Claim gathering covers both open claims and PRs; missing metadata fails closed. Merge-time whole-object replacement detection is narrower than dispatch-time coverage; the source documents the distinction (`scripts/check-dispatch-collision.mjs:80–91`).

Blind spots needing conservative treatment: runtime resolution inside stored function bodies; nonliteral dynamic SQL and DO blocks; security-definer/search_path behavior; transitive role membership/default privileges; trigger-to-function-to-table dependencies; extension/operator/type/collation changes; schema-wide grant/ownership changes; cross-schema FK reads; data backfills sharing live rows; derived-from ancestry; migration ordering; production-consumed policy/workflow/tool changes and generated sidecars. Matching different schema names proves none of these absent.

`production_migration_guard.py` strips bodies for its static preflight, and the procedure warns that hidden apply-time references can pass it. A scanner can reject a dangerous batch; a green scan is not independence certification. Existing rehearsal and real application behavior proof remain mandatory.

Conclusion: scoped claims alone are insufficient. A future SQL extension needs conservative dependency closure including global privileges and promotion machinery, with UNKNOWN yielding refusal. For stage one there is no SQL independence claim at all: intervening migration/code merges remain blocked.

## 4. Alternatives and decision

| Alternative | Required changes | Residual pause | Decision |
|---|---|---|---|
| Remove/shorten early freeze, equality guards unchanged | Separately reviewed admission change; bounded retry/defer strategy | Exact-main refusals and late production interlock remain | Evaluate safety/liveness and repeated-review cost; never current default or permission to release another owner |
| Table/schema-only scoped freeze | Object-filter merge check | Writes serialized | Reject: dependency/order/control-code coverage inadequate |
| Fixed promotion identity + ordinary-prose exception | Conditional reuse of existing context/freeze record, one strict module, complete caller/queue/train conversion and separately fenced cleanup | All executable/migration merges during review; all merges during production lane | Consider only after measurement/binding gate; no mandatory new snapshot subsystem |
| Snapshot + proven disjoint additive SQL | Full read/write/global dependency closure, order barrier, reconciled live ledger, isolated baseline rehearsal, queue recomputation | Global control/security changes and unknown SQL; exclusive database writes | Defer: cannot prove safe with current extraction |
| Snapshot permitting all source-only SQL merges | Keep SQL execution pinned; prove tail not applied and reserve ordered future promotions | Policy/producer changes; writes | Plausible architecture, but not the requested conflict protection without explicit applied-state/dependency proof; reject automatic activation |
| Short staged global freezes | Review immutable candidate before freeze, then revalidate actual snapshot, issue, ledger, artifacts and risk inputs under freeze | Short final barrier plus production lock | Worth measuring; evidence-equivalent review must be proven, otherwise requires re-review and removes no delay |
| Review before source merge | Candidate/runtime equivalence with actual merged S and independent risk assessment | Final integration validation, production lock | Do not transplant candidate approval onto S without exact equivalence; changing SQL invalidates approval |

The shortest defensible window is event-defined, not a fixed minute target: final synchronized transition into the production lane through successful/failed apply verification and owned release. Stage one retains broad blocking for executable/migration changes before that window; prose can proceed through qualified snapshot checks. Removing the production-wide source pause itself is a later design, not part of the recommended first change.

## 5. Deterministic races and recovery

Here "snapshot/generation" means retained immutable promotion/attempt identity using existing records; it does not mandate a new authority ref. Storage and admission remain conditional on the plan gates.

| Scenario | Required proposed behavior/test |
|---|---|
| Two concurrent freeze/snapshot creators | Single coordination mutex plus create-only ref; exactly one wins; loser never replaces live record |
| Main advances between validation and authorization | Re-read under existing mutex, bind exact PR head/base/snapshot generation; recheck queue group at final success and production lock acquisition |
| Already-authorized group merges after snapshot begins | Snapshot activation drains existing merge lane or treats completed harmless prose through revalidation; conflicting advance refuses dispatch; no claim that acquisition revoked a prior group |
| Mixed disjoint/conflicting queue batch | Current single-PR contract refuses; future batch must classify every member and synthetic aggregate, no partial clearance |
| TTL expires during review | Readable expired freeze stops admission blocking, but promotion authority is separately revalidated; any non-prose advance voids promotion; new review snapshot required |
| TTL expires during apply | Production ref still blocks all source merges; database ownership never depends on freeze TTL; cancelled runner requires evidence-based exact-ref recovery |
| Promotion implementation/policy changes on main | Global invalidator; refuse continued promotion until new snapshot/evidence/review. Old trusted runner must also recognize live revocation |
| Missing/unreadable claim, snapshot, tail or artifact | Refuse before dispatch/write; no schema-based guess, no fallback to manual dispatch |
| Cleanup repeated | Exact {snapshot id,generation,freeze SHA,production owner SHA,run attempt} idempotence; absent is no-op |
| Old cleanup versus replacement on same source PR | **Current source-PR-only release is insufficient fencing**: an old attempt could release a newer freeze on the same PR. Proposed cleanup must compare recorded exact freeze SHA/generation, not merely PR or reusable textual owner |
| Unreadable record | Preserve fail-closed protection; route exact-record recovery with durable evidence. Do not invoke existing any-positive-PR exception here |
| Superseded/cancelled review | Live durable verdict and assignment remain authoritative; reject stale or returned assignment; no hand-edited retained response |
| Crash after apply file A, before file B | Reconcile actual ledger/catalog under exclusive ownership, record partial apply, promote only still-pending reviewed files in new bounded evidence; never rerun applied A |

The existing deletion helper compares the observed SHA and protects an atomic replacement race *within* one operation. It does not protect a later cleanup operation that matches a newly acquired same-PR record. Fixing that distinction is required before recommending shorter staged freeze/retry lifecycles.

## 6. Ordering, database drift and parity

Full production ledger reconciliation is required, not max(version). The documented database history has holes and preview/production differ both ways. Build bounded checkout from **all applied ledger versions plus exact V**, verify their immutable file digests, reject absent/ambiguous/edited applied versions, and verify fresh dry-run contains only pending V in exact order. Retain co-presence security pairs and declared derivation prerequisites (`production_migration_guard.py:1070,1543,2280,2511`; `migration_derivation.py`). A partial batch commits per file; rollback is normally a reviewed forward repair, not ledger surgery.

For stage one, no new version may merge after S, so before/after version scenarios both fail the harmless-delta proof. For a future SQL extension: a newly merged version sorting **before** promoted V must stop admission or force a newly reviewed ordered batch; sorting after V may merge only if it cannot be applied ahead of V and its dependencies are proven. Later snapshot promotion must reconcile the actual results of earlier snapshots, preserve skipped backlog explicitly, and never silently apply the full pending set. Extra applied production migrations absent from S require either exact governed provenance and byte equality in a new approved snapshot or refusal; do not downgrade the ledger or omit applied objects to fit old evidence.

Any production change after preview invalidates assumptions unless current ledger/catalog plus rehearsal provenance prove it compatible. Stage one keeps exclusive writes and requires existing fresh guards; it makes no new claim that preview equals production. A fixture rehearsal of a new concurrency design is not application acceptance. The implementing session must verify real dependent application behavior on the same issue before closure.

## 7. Test matrix and evidence

Existing observed checks: seven targeted promotion-freeze tests also passed (0 failed/skipped), in addition to 74 tests passed, 0 failed/skipped/cancelled from `node --test scripts/check-main-tip-freshness.test.mjs scripts/lib/lanes/exclusive-policy.test.mjs`. Output retained privately at `/tmp/narrow-freeze-evidence/tests.log`; this proves existing classifier/interlock tests, not the proposed design. Existing freeze unit tests include expiry, unreadable fail-closed, documents blocking and cleanup ordering (`manage-migration-author-lanes.test.mjs:11020–11124`). No new implementation tests were written during investigation.

Required new named tests are specified in companion §10. They must cover real counterexamples and synchronized concurrency, not just restate predicates. Positive first-stage case: ordinary docs advance T while exact S/V/A remain authorized during review. Positive later-stage case: independently proved additive schema tail merges while execution remains pinned — **deferred and must currently refuse**. Negative cases include shared grants/roles/functions, cross-schema FK, trigger, dynamic SQL, uncertain writes, earlier version, protected workflow/policy change, unknown diff, stale artifact and invalid source authority.

## 8. Measured delay and limits

Historical freeze record re-read live from GitHub commit `828a0fd49ed27738b4db24238937e97fd6349fc3`: source PR #3708 / issue #2875; owner chat `01a1126f-6efb-7a22-8034-4471909f2c86`; acquired **10:07:39 AM EDT**, expiry **12:07:39 PM EDT**. At 11:37 AM EDT that same record remained present. This is approximately 89 minutes of an active global freeze, not 120 minutes of observed actual hold. Maximum configured TTL is 180 minutes, not a service target. No production ref was listed in that read; do not attribute that whole interval to database writes.

A separate `author-acquisition` ref at `fdb146da76cecf84f2c2a82d0e588bc9f1008304` reads `db-coordination reviewer-assignment-lock issue=4037 pr=4033 head=9110b1610754b766860e7cb17ed8fcf758fc59ca`; a recovery-active ref named the same SHA. Owner engine/chat and whether work is active are not encoded in this header. No takeover occurred. Both locks may independently prevent an operation; removing the promotion freeze would not repair the mutex.

Observed open documents candidates: #4034 created 10:20:39 AM EDT, #4035 10:26:24 AM EDT, #4036 10:31:48 AM EDT. Their migration-workflow validation runs completed successfully at 10:22:01 AM EDT (37635906397), 10:27:32 AM EDT (37636704949), 10:32:48 AM EDT (37637467498). At the 11:37 AM EDT list reading they remained open: approximately 75, 69 and 64 minutes since those validation completions. These are **candidate blocked-work intervals**, not causal queue wait measurements: a passing validate job is not complete merge eligibility. For #4036, actual workflow 37637527628 failed at **10:33:26 AM EDT** with `REFUSED: merges are paused for a production run; promotion merge freeze held by "01a1126f-6efb-7a22-8034-4471909f2c86" for PR #3708 (issue #2875)`. This proves a freeze-caused authorization refusal for this ordinary-document PR; it still does not prove the entire subsequent open interval was caused only by that freeze. Its advisory status recorded failure at 10:33:24 AM EDT. Other candidates retain the causal limitation. #4032 is a code/reviewer repair, not eligible for the proposed prose exception; #4033 includes permission changes and must remain conservative.

Workflow-dispatch sample on October 7: 37627700686 failed from **9:20:22–9:23:07 AM EDT** (2m45s); 37618528900 failed **8:05:18–8:07:26 AM EDT** (2m08s); 37618171335 succeeded **8:02:17–8:05:21 AM EDT** (3m04s). Their run totals include job scheduling and validation and do not isolate production lock or apply duration. Last 25 migration-workflow runs mostly represent PR validation; they cannot establish production throughput. No current-main production run was observed in that sampled dispatch list. Historical 11:04 AM EDT risk approval in the incoming prompt was **not independently re-proved** and is not used as an observed review-duration measurement.

Potential savings: stage one can remove the portion of prose authorization delay caused exclusively by review-period global freezing (tens of minutes in these candidates); range **0 up to the remaining freeze-only wait** for each ready prose PR, never the full end-to-end interval by assumption. Production-lock time, runner time, other required checks and occupied mutex delays remain. No SLA or numeric expected mean is supported by this sample. Implement instrumentation measuring ready→refused, freeze acquire→release, review request→verdict, production lock acquire→release, and queue entry→merge separately, with exact causal status codes.

## 9. Independent review history, Muse debate and publication

Allocator sequence **5638** assigned **Gemini 3.8 Flash High**, excluding author engine Codex. Supported governed runner reviewed source **610e80cd3bc0ec523a794ec59db11699318cf31f** and returned **APPROVE**. Create-only durable verdict ref: `refs/db-review-verdicts/4039-4040-610e80cd3bc0ec523a794ec59db11699318cf31f`; [verdict commit](https://github.com/popcre/shared-db/commit/6bf4f63a2b6d1306c44e071fde74faf826fc96dc). Source digest `994bcb5b60f642ed7424106ba7decbc800c5893806bb19477663f0a8ae4731ad`; packet SHA `6ed4c4e3e0ef27b28cd735eae13da1af25bfa53ddf105ecffb356246c7af3234`. [Verbatim findings](https://github.com/popcre/shared-db/pull/4040#issuecomment-6041879781) are retained on PR #4040. This approves the proposed design, not implementation, deployment or live safety. Subsequent outcome bookkeeping does not extend exact-head approval to code.

Two supplemental same-engine critiques returned REJECT and remain verbatim in [first outcome](narrow-promotion-freezes-supplemental-review.md) and [second outcome](narrow-promotion-freezes-supplemental-review-2.md). All objections were addressed before the independent verdict: reuse existing Step 10 primitives/ownership, include recovery callers, establish pre-review candidate authority, register the literal router pointer, and exclude migration trains with a serialized candidate/train handshake. Neither supplemental verdict is relabelled APPROVE.

The genuine router registration and corrected ready repository-maintenance issue fields enabled supported allocation. Sequence 5637 Muse assignment on superseded 85fb7a16 was never launched and was returned using exact own superseded-target release; no provider health was changed. Task declaration was corrected to reviewer-safety after escalation; an initial combined publishing command incorrectly continued after refusal, without any merge/production action. Future mutations must follow a separate successful gate check.

Subsequent owner request: "run the report and implementation plan past Muse and debate it out with Muse. give Muse all the relevant background and context about promotions freezes blocking a lot of work". Three completed turns in the same protected Muse conversation produced substantive revisions and concessions, retained in [debate ledger](narrow-promotion-freezes-muse-debate.md). The original heavier design is superseded by the evidence-first companion plan. No later design is labelled allocator-approved from the earlier Gemini verdict.

Historical publication blocker: PR #4040's authorization at **12:08:29 PM EDT, October 7** refused the renewed #2875/#3708 freeze expiring **12:37:55 PM EDT**. A later read at **12:54 PM EDT** found no advertised promotion-freeze/production/author-acquisition refs, main d241515e and document authorization passing. That does not establish #2875 application acceptance. Recheck live ownership and authorization before landing. No foreign record was released. This Codex workstream owns documentation publication; future workstream on #4039 owns all gated implementation proof.

Future implementing workstream owns actual binding completeness, consumed-prose/runtime closure, train-read backend guarantees, revocation/queue barriers, attempt fencing, shared-preview freshness and separated cost/benefit measurements. Existing coordination-IO/Step 10 ownership must be reconciled. Assigned reviewer owns technical readiness and exact-head code review. Every uncertainty is a named plan gate, not a business approval request.

## 10. Explicit answers

1. **Can every shared-db merge except conflicts safely proceed today?** No. Current guards block globally; dependency knowledge is insufficient for generic conflict-only admission. Prose is a defensible bounded proposal. Unknown SQL, shared security and promotion-runtime changes retain repository-wide conservative blocking.
2. **Can a fixed approved snapshot remain deployable after main advances?** Conceptually yes after proven inert prose; current qualification and production acquisition refuse it. Implement common snapshot/harmless-delta authority first. Broader SQL movement remains unproved.
3. **Which invariants demand equality and what replaces it?** Preview acquisition, qualification and production acquisition insist current main. Replace only harmless movement with protected-main ancestry + full deny-by-default delta + immutable runtime/migration provenance + synchronized live authority/ledger rechecks. Keep exact source review and exact snapshot risk assessment.
4. **Are claims enough?** No; they omit complete transitive privileges, runtime references, global code and ordering.
5. **Smallest safe window?** Retain global pause from final production acquisition through post-apply verification/release; allow prose during review only after binding, benefit and strict-mode gates are proved. No measured minimum in minutes.
6. **Cleanup/crash recovery?** Exact ref/generation/run fencing, preserve database ownership, reconcile partial apply and use supported evidence-based recovery. TTL removes source admission blocking but never certifies a promotion or abandoned database lock. Never release another owner by appearance or age.

Initial design approval and subsequent Muse debate concurrence are distinguished above. The revised sequence is evidence-first; feature feasibility remains conditional. No implementation, deployment or production/application acceptance is asserted.

## Session closeout — October 7, 2026

During closeout checks at **2:48–2:51 PM EDT**, GitHub reverified #4040 MERGED as e682fd77de6f9420cedc00862596e5f8b825f40b at **1:22:13 PM EDT**, final reviewed source 2f9e29990a66d8c6c8af563d16264f13c9a72a21; #4039 CLOSED with all investigation deliverables checked. Main at inspection was a456e842ec7d9ec5cd06c2857a57fa98c326ecf1; latest migration filename version 20261007171252 belongs to other work, not this session. Those moving facts are dated observations, never future execution authority.

Five completed persistent Muse turns include final exact-written-source approval with no remaining findings: [retained final report](https://github.com/popcre/shared-db/pull/4040#issuecomment-6042904088). Earlier complete reports remain verbatim. The heavier design was superseded, the original Gemini approval remains historical and no code or live-promotion approval is inferred. Plan STATUS now separates completed investigation/publication from future OPEN/NOT AUTHORIZED phases.

Own completed HANDOFF.d/2026-10-07T1545Z-edge-dev3-codex-narrow-promotion-freezes.md is retired. Successor review passed: its source commits are reachable from main; its publication/review obligations are actually complete; future conditional gates are carried in the plan; failed allocation/gating attempts, both supplemental REJECT rounds and Muse concessions remain in this report/debate ledger. The retired text remains recoverable in #4040's merged history. No other session's handoff was edited/read for cleanup.

No migrations or rows authored/applied to shared preview or production, no structural claims or dispatched subagents, no foreign locks released, no production launched. Preview/database state was not inspected and is not claimed clean. Review helpers ran in protected disposable copies; final outcomes are durable. Secrets sweep found no credential/token/connection-string values; no vault access needed. No new fix, measurement run or automation was started during wrap-up. Current scope is closed; future implementation requires a new scoped request and all plan gates.
