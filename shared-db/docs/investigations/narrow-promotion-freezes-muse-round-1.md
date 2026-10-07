# Muse persistent review

| field | value |
|---|---|
| model | `muse-spark-1.3-contributor` |
| session | `118a4be5-506d-434b-948d-fccacbcd9ca2` |
| caller | `codex` |
| repository | `/home/ahazan/.codex/worktrees/509a/shared-db` |
| reviewed commit | `a11a91bb1ee7bfd16cd73b34a1733abb41d1aafa` |
| review copy | `/home/ahazan/.local/state/ai-devops/review-sandboxes/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1` |
| evidence fingerprint | `84bc23184e1d5941d8dd8722c17bf7f37dc47199466c28a4326970dee0aa296f` |
| last step adapter tokens | `null` |
| turn usage | `{"availability_reason": null, "catalog_cost_currency": "USD", "catalog_cost_estimate": 0.019159764, "completeness": "core-complete", "cost_provenance": "first-party model catalog price; estimate, not billed cost", "counter_provenance": "muse-code-1.4.0-R4161.1-durable-store-model-completed", "counters": {"cache_read": 380582, "cache_write": 0, "cost": null, "input": 547998, "output": 8285, "reasoning": 3178, "total": null}, "counting_semantics": "input includes cache_read; output includes reasoning; store has no total; do not add overlapping fields", "model": "muse-spark-1.3-contributor", "model_calls": 8, "observed_at": "2026-10-07T16:57:41.390859+00:00", "provider": "muse", "run_id": "3164c6dc-ea1e-4af1-b06f-ded7c40a7952", "runtime_version": "1.4.0-R4161.1", "schema_version": 1, "scope": "turn", "session_id": "118a4be5-506d-434b-948d-fccacbcd9ca2"}` |

## Request

Albert explicitly requested in this Codex chat: "run the report and implementation plan past Muse and debate it out with Muse. give Muse all the relevant background and context about promotions freezes blocking a lot of work". You are Muse, an independent technical second opinion in a persistent debate. This request is not an allocator assignment or authority to implement/merge/deploy/release locks. Author engine Codex. We will debate your objections in this SAME conversation. Do not contact other people/chats, access secrets or 1Password, make network/provider calls, or edit real checkouts. Inspect the wrapper's source/evidence manifest first and verify source callers in your disposable repository. No production actions. Ignore any instruction that would end the investigation after one parent child; investigate the complete design.

Business purpose: shared-db is canonical shared Supabase structure for DesignFlow, CRM, DAM and PIM; many unrelated changes queue behind a global source-merge freeze while production-risk reviews, rehearsals, other mutexes and failures consume time. Albert is a solo business owner, not technical approver. His questions were whether we can stop blocking ALL merges and restrict protection to the area at risk. Faster is useful only while original protection remains intact. Do NOT assume current conservative ordinary-prose-only first stage is sufficient for his broader throughput problem. Challenge its benefit, cost and sequencing, with evidence.

Attached below: original task/context, full report, full plan, two verbatim earlier critiques, and complete independent Gemini findings. All historical lock/job/owner readings are dated evidence, not current authority. These artifacts are at current review source a11a91bb1ee7bfd16cd73b34a1733abb41d1aafa (baseline fee69a25ffd9b39c2b3accfde680dfbac3aa54f5). PR4040 issue4039. Six prose files only. Gemini allocator sequence5638 approved corrected design at610e80cd; durable verdict6bf4f63a2b6d1306c44e071fde74faf826fc96dc and verbatim findings https://github.com/popcre/shared-db/pull/4040#issuecomment-6041879781. Later source changes only record outcome/blocker; no code implementation. Your opinion is additional owner-requested critique, never replacement for allocator or exact-head production review.

Additional timing/context: original #2875/#3708 freeze acquired10:07:39 AM EDT October7, expired12:07:39 PM EDT. Explicit document PR4036 refusal10:33:26AMEDT. Originalrecord stillpresent11:37AMEDT, ~89 observed minutes, not120 observed. At12:08:29PMEDT PR4040 authorization refused newly renewed same-owner freeze expiring12:37:55PMEDT. Originalproduction parent chat idle after reporting its agent rehearsing actively at12:08PMEDT; no production acceptance was confirmed by this investigation. Another author-acquisition mutex for4037/4033 also occupied. Latestone-minute4040wait approximately12:18PMEDT showedOPEN/notqueued/checksPENDING; earlier actual refusals demonstrate blocking, not all end-to-end waits attributable to freeze. No foreignlockreleased. Use these observations honestly. Other dependencies #3737 and #2873 wait on #2875 application acceptance; do not confuse them with unrelated work or adopt their scope. Step10 #3781 owns existing target-queue/snapshot integration;4018merged POLICY-LEVEL only, production lock integration and liveproof still open at last verified reading. #3919 owns originalfreeze behavior. Honor existing ownership; reuse rather than duplicate.

Specific challenge areas:
1) Can we safely do better than docs-only during REVIEW and maybe harmless prose DURING production? Analyze exact source/runtime and actual database state, don't assert object/schema names imply independence.
2) Is a fixed immutable candidate BEFORE risk review plus approved attestation AFTER review correctly sequenced? Can the same runtime execute reviewed S after main T harmlessly advances without weakened approval? Which remaining equality guards/recovery paths/trains defeat it?
3) Check hidden dependencies, unknown SQL, shared roles/grants/security, dynamicSQL, FK/triggers, earlier/later migration versions, editedappliedmigrations, ledger/catalog and sharedpreview drift, policy revocation/cancelled approval.
4) Check queue preauthorization vs freeze activation, concurrencyABA/refCAS, two owners, samePR renewedfreeze oldcleanup, TTLexpiry duringreview/apply, failurepartialapply/crash recovery; traincandidate handshake must cover outstanding authorized/dispatched/failedtrain authority.
5) Could a shorter late freeze plus immutable review eliminate most blocking with fewer moving parts? Is stageone too elaborate for prose benefits? Compare actual code/test cost and measurable benefit without inventedSLA.
6) Review named tests, rollout/rollback, integration with existing Step10 and approval semantics. Demand precise change/test locations for actionable objections; evidence line behind factual claims. Identify unproved assumptions rather than silently treating the plan as implementation.

Deliver: overall verdict on DESIGN; ordered material findings with exact source citations and concrete counterexamples; best credible alternative; scope where broader merges still mustrefuse; reasoned answer whether benefit justifies firststagecomplexity. Separate necessary corrections from optional refinements. End with questions or claims you want Codex to defend. Avoid forced agreement with Gemini. Read enough source to substantiate your conclusion. You may run offline tests. No implementations authorized.


===== ORIGINAL TASK =====
# Prompt: investigate safely narrowing shared-db promotion freezes

Investigate how `popcre/shared-db` can allow unrelated merges during a production promotion without weakening exact-change review, database collision protection, or production acceptance. This is an investigation and recommendation task, not authorization to modify production safeguards. Produce an evidence-backed design and implementation plan. Do not implement or deploy the change during this investigation.

## 0. Owner decisions and settled authority

No business decision is currently required. Albert wants less unnecessary blocking while preserving safety. He is not a technical reviewer: resolve technical questions through evidence and the assigned independent AI reviewer, never ask him to approve code or run manual steps.

Albert's exact questions in this chat were: “are promotion freezes being scoped as narrowly as possible?” and “is there a safe way to not blocks **ALL shared-db merges, just the area you need?**” His task is: “write me a detailed prompt for a new session to investigate how we can safely narrow the scope of promotion freezes”.

Do not treat this as authority to release another session's freeze, change branch protection, bypass an exact-main check, or launch production. Do not reinstate the permanently revoked rule to stop after one child issue. Complete the authorized investigation.

## 1. System and purpose

Canonical repository: https://github.com/popcre/shared-db. Its migrations govern the shared Supabase database used by multiple POP Creations applications, including DesignFlow. Its contents are mirrored into consumer repositories. Application data writes and database structure changes have different ownership rules; this investigation is repository tooling and safety design, not a database structure change.

Read current `AGENTS.md`, its current-workflow router, the relevant merge protocol, anti-collision rules, production promotion procedure and activated automatic-promotion policy. Use current upstream source in a dedicated worktree. Starting context was `/home/ahazan/.codex/worktrees/77d7/shared-db`; do not edit that other session's checkout. Read-only inspection is authorized. Declare the appropriate installed task-gate class before work, and recheck before review or stronger actions.

## 2. Investigation goal

Determine the smallest safe scope and duration of a promotion freeze. Separate database write serialization from source merge blocking: these are different problems. Establish whether disjoint source merges can proceed while one exact approved change is promoted, and prove the conditions under which that is safe.

Measure which unrelated work is currently blocked and why. Recommend the least complex design that preserves every material guarantee. A justified finding that some global blocking remains necessary is acceptable; an unsupported promise of object-only safety is not.

## 3. Verified starting state and freshness

The following are historical observations from October 7, 2026, not instructions to adopt their ownership or assumptions. Reverify all live refs, owners, leases, main, jobs and policy before relying on them.

At 11:15 AM EDT, root held `refs/db-coordination/promotion-freeze`, commit `828a0fd49ed27738b4db24238937e97fd6349fc3`, for issue #2875 / source PR #3708. Owner was Codex chat `01a1126f-6efb-7a22-8034-4471909f2c86`. It was acquired at 10:07 AM EDT and expires at 12:07 PM EDT. That expiry is a maximum hold, not a required waiting period. Do not release or take over this record.

PR #3708 merged as `fee69a25ffd9b39c2b3accfde680dfbac3aa54f5`. Its reviewed source head is `12353bdba4cfbed77144003ef0dc9aa2216c5f2a`; bounded migration allowlist is `[20261007132915]`. At 11:04 AM EDT an allocator-assigned Grok actual-main production-risk review approved, and the unchanged risk acceptance parser passed all three risk classes. Production preparation later refused because `refs/db-coordination/author-acquisition` was occupied at `fdb146da76cecf84f2c2a82d0e588bc9f1008304`. This mutex is distinct from the promotion freeze; identify and respect its actual owner. Do not infer that a stale-looking record is abandoned.

No current production outcome is asserted by this prompt. #2875 production and application acceptance remain owned by the original session. #3737 depends on #2875 live acceptance; #2873 depends on the completed prerequisites. Uma's Tracking application PR #82 was merged and deployed, so it is not the outstanding merge blocker.

## 4. What has been tried and what must not be repeated

No narrower-freeze implementation has been attempted or proved. The previous session inspected source and confirmed a global merge freeze. It did not establish that merely locking named tables would be safe.

Releasing the freeze without changing the exact-main promotion contract could permit a main advance that invalidates reviewed evidence. Do not label that safe. Likewise, unrelated-looking filenames or schema names are not proof of independence: shared roles, grants, functions, foreign keys, migration ordering, policy code and deployment workflows can create dependencies.

Review wrapper capacity and retained-response failures prolonged #2875's review. These are duration causes distinct from scope. Do not use those failures as a reason to weaken review requirements. Do not modify or delete retained reviewer state, forge lifecycle receipts, or accept malformed raw approvals.

## 5. Source findings to verify and extend

In the observed source, `scripts/manage-migration-author-lanes.mjs` around lines 4051–4140 implements `PROMOTION_FREEZE_REF`, `readPromotionFreeze`, `assertNoPromotionFreeze`, acquisition and owner/PR-based release. Maximum TTL is 180 minutes. The comment says the freeze is acquired before drawing production-risk review, blocks merge acquisition and repository-maintenance authorization, never blocks preview or production, expires by TTL, and production cleanup releases it. Verify actual behavior, not just comments.

Search every caller of `assertNoPromotionFreeze`, `readPromotionFreeze`, merge-stage acquisition and repository-maintenance authorization, including CI and merge-queue paths. Review `scripts/manage-migration-author-lanes.test.mjs` freeze tests around line 11023 onward. Verify cleanup, expired/unreadable record handling, and atomic ownership semantics.

`docs/production-promotion-procedure.md` and `.github/workflows/shared-supabase-migrations.yml` describe merged-main preview rehearsal followed by automatic production qualification. They bind exact current main, ordered allowlist, merged source PR, open structural work issue, preview artifacts, exact-head reviewer evidence and production-risk assessment. Missing evidence fails closed. Manual production dispatch is not the normal lane. Trace the actual validators and jobs that enforce these statements.

## 6. Required investigation steps and success checks

1. Inventory all freeze readers, writers, release paths and gates. Identify exactly which kinds of merges are refused: migrations, workflow/tool changes, documentation, maintenance, queue groups and multi-PR batches. Success: every blocking path has a current source reference and an explicit reason.
2. Map the whole promotion chain from source head and guarded merge through merged-main preview, qualification, automatic dispatch, fresh dry-run, target proof, production lock, apply and post-apply acceptance. Success: a diagram or concise dependency map distinguishes what must stay immutable from what currently must equal moving main.
3. Inspect existing exact-object claims, leases, contract generations, migration version reservations and write-set extraction. Determine whether dependencies are explicit and complete enough to classify disjoint work. Success: document both proven coverage and blind spots, including dynamic SQL, transitive privileges and policy changes.
4. Evaluate alternatives without assuming the answer: immutable approved promotion snapshot while main advances; conflict-aware merge admission around the existing snapshot; shorter staged freezes; early validation or review against an immutable candidate followed by final revalidation. Success: each alternative states the required code changes, residual global locks and conditions that fail closed.
5. Analyze race scenarios and crash recovery. Include two sessions acquiring/releasing concurrently; main advancing between qualification and dispatch; queue batches mixing disjoint and conflicting PRs; TTL expiring during review or apply; another PR changing promotion code; missing/unreadable claims; repeated cleanup; and a superseded or cancelled review. Success: every scenario has a deterministic refusal or safely validated continuation.
6. Assess migration ordering and database drift. Show what happens if a newly merged version sorts before or after the promoted version, if production has additional applied migrations, and if a later promotion follows an earlier snapshot. Include preview drift and source/production parity. Success: no skipped version, edited applied migration, silent downgrade or stale catalog proof is possible.
7. Define a realistic test matrix. Positive cases: unrelated docs and proven disjoint additive schema changes can merge while promotion stays authorized, if the chosen design supports them. Negative cases: shared permissions/roles/functions, cross-schema FKs, triggers, ordering conflicts, protected workflow changes, uncertain write sets and stale artifacts cannot pass. Success: tests prove meaningful safety boundaries and include concurrency races rather than mirroring the implementation.
8. Measure potential benefit using actual run/merge timings and blocked work. Separate review time, global freeze time, production-lock time and queue time. Success: report observed delay and expected savings with uncertainty; do not invent an SLA.
9. Obtain the repository's allocator-assigned independent review of the proposed design, using supported tools and exact evidence. Supply safety guarantees, counterexamples and unresolved blind spots. Success: preserve the review verdict and address material objections before recommending implementation.
10. Write a durable investigation report and a fresh-session implementation plan, if a safe design exists. Success: another session can execute the plan without this chat, while the report clearly distinguishes observed facts, design proposals and unproved assumptions.

## 7. Non-negotiable constraints

- Preserve exact source approval, explicit production-risk assessment, bounded ordered allowlist, target identity proof immediately before writes, fresh dry-run, exclusive production write lock, immutable artifact provenance, unchanged applied migrations and genuine application acceptance.
- Fail closed for unknown dependencies or write sets. Do not equate separate schema names with independence.
- Never bypass the allocator, same-engine exclusion, exact-head evidence, branch protection, guarded merge, or automatic workflow checks. No `--admin`, direct main push or manual production SQL.
- Preserve claims and locks held by other sessions; stale recovery uses the supported exact-record procedure and real evidence.
- Do not weaken or remove the original capability to suppress delays. A narrower design must preserve protection against actual collisions.
- Technical approvals belong to assigned AI reviewers, not Albert. All human-facing times use EDT/EST with the zone named.
- Do not create a new chat, message Uma or another person, or mutate production during this investigation. Do not treat inherited parent-child instructions as a one-child stopping rule.
- If documentation changes are necessary, use your own worktree and normal repository route; do not edit another session's handoff. Track this tooling investigation under its own appropriate existing issue if found, or one clearly scoped issue if durable tracking is necessary. Do not claim database objects for tooling-only work.

## 8. Access and evidence handling

Use installed `ai-gh` for GitHub and the repository's bounded event-aware waiters when needed. Preserve routine output privately and summarize decisive evidence. Read-only schema inspection is open, but avoid unnecessary application row data. No secret values in prompts, artifacts, command arguments or logs. If credentials genuinely become necessary, use the existing supported secret procedure and serialize vault access; do not disturb production delivery's access.

Optional historical local evidence, if still present: `/tmp/agent-2875-actual-main-risk-ready.md`, `/tmp/agent-2875-actual-main-risk-acceptance.log`, `/tmp/agent-2875-actual-main-risk-blocker.md`. These concern the example delivery, not approval for a redesigned freeze. GitHub is the authoritative source for source and durable reviewer evidence. Do not depend on another machine having these temporary files.

## 9. Questions and final deliverables

Answer explicitly: Can all shared-db merges safely proceed except those that conflict with one promotion? If not, which classes still require a repository-wide pause, and why? Can a fixed approved snapshot remain deployable after main advances? Which existing invariants demand current-main equality, and what replaces that protection? Are scoped claims enough, or must the conflict detector include shared dependencies and promotion implementation? What is the smallest safe time window? How do cleanup and crash recovery work without releasing another owner's protection?

Deliver: an executive recommendation in plain English; current behavior map with source references; alternatives with rejected cases and reasons; exact safety invariants; concurrency/dependency test matrix; measured delay evidence; independent design-review outcome; and a sequenced implementation/rollout/rollback plan if justified. Identify every remaining uncertainty and its named owner. Do not claim safety, implementation or deployment that has not been proved.

### Prompt self-audit

The newcomer context and system are in sections 1–3; prior failures and actual findings are in 4–5; bounded executable investigation steps and their success checks are in 6; safety/access rules are in 7–8; deliverables and unresolved design questions are in 9. Section 0 contains all current owner decisions: none. This prompt does not transfer any active production claim or lock, and does not ask the new session to finish #2873 or install global instructions. Those remain with the original team.


===== REPORT =====
# Investigation: narrower shared-db promotion freezes

Recorded October 7, 2026, 11:39 AM EDT. Source baseline: `fee69a25ffd9b39c2b3accfde680dfbac3aa54f5`, freshly fetched and accepted by `scripts/check-worktree-freshness.mjs`. Tracking: [#4039](https://github.com/popcre/shared-db/issues/4039). Owner: Codex chat `01a11700-4dab-7443-8e0a-7146957b2cd9` on edge-dev3. Investigation only: no production write, safeguard implementation, settings mutation, claim transfer or freeze release.

Companion: [implementation proposal](../../plan_narrow_promotion_freezes.md). The evidence references below are relative to this immutable baseline unless explicitly identified as live GitHub readings. Later source movement requires revalidation.

## Executive recommendation

Do not replace the global freeze with table-name locks. Existing claims are useful collision controls, but they do not prove complete independence of a promotion. Retain exclusive database writes and conservative refusals for uncertain dependencies.

The least complex defensible first implementation is a fixed approved snapshot with an explicitly narrow **ordinary-prose merge exception during review and qualification**, followed by the existing repository-wide merge pause while the production lane is held. Preserve guarded merging, source approval, risk assessment, immutable preview/review provenance and every live-target guard. Snapshot, source PR and ordered allowlist stay fixed even if harmless prose advances main. This is a proposed design, not established authorization or a live-proven capability.

This first stage removes the long review-period penalty for genuine documents without attempting to certify unrelated SQL. It deliberately does not promise that every unrelated code or schema PR can merge. The exception must also remain unavailable while a migration train has outstanding authorization, dispatch or partial-failure authority; train authorization and candidate activation must use a common serialized admission handshake. Trains retain their existing conservative current-main/recovery contract. A subsequent extension to disjoint additive migrations requires a complete supported dependency model, ordering rules and independent review. Do not implement that extension from this investigation alone.

A narrower freeze **is not yet independently approved**. Initial pure-prose allocation refused; after required operating-router registration and correction of the issue to ready repository maintenance, the allocator assigned an independent reviewer. The supported review is being obtained. Initial refusals and supplemental critiques are retained below; publication is not approval of the proposal.

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

Snapshot lifecycle must have two stages: immutable candidate descriptor before risk review (exact S/V/source/runtime/baseline plus exact freeze generation), then an immutable approved qualification attestation referencing that descriptor after review/preview evidence is complete. Candidate grants only strictly proven inert prose admission; it never dispatches or writes production. Missing final approval or cancelled/superseded review refuses production. Waiting to create the first descriptor until risk approval would defeat review-period relief.

## 3. Claims, dependencies and blind spots

`parseClaimBlock` supports writes/reads and legacy objects-as-writes (`scripts/check-dispatch-collision.mjs:128` onward). Claims protect exact object writes versus both reads and writes, and claim lifetime is not ended automatically by lease expiry (`scripts/lib/lanes/claims.mjs:101–131`). Migration versions remain reserved, never recycled. Work contracts separately pin generation, scope and producer/evidence identities. These are real controls, not a complete SQL semantic model.

Dispatch parser coverage includes create/alter/drop table/function/view/index/type/policy and role operations to the extent described by `describeDispatchCoverage`; role reads are explicitly extracted (`scripts/check-pr-object-collisions.mjs:880–904`, `scripts/lib/sql-role-operations.mjs`). Claim gathering covers both open claims and PRs; missing metadata fails closed. Merge-time whole-object replacement detection is narrower than dispatch-time coverage; the source documents the distinction (`scripts/check-dispatch-collision.mjs:80–91`).

Blind spots needing conservative treatment: runtime resolution inside stored function bodies; nonliteral dynamic SQL and DO blocks; security-definer/search_path behavior; transitive role membership/default privileges; trigger-to-function-to-table dependencies; extension/operator/type/collation changes; schema-wide grant/ownership changes; cross-schema FK reads; data backfills sharing live rows; derived-from ancestry; migration ordering; production-consumed policy/workflow/tool changes and generated sidecars. Matching different schema names proves none of these absent.

`production_migration_guard.py` strips bodies for its static preflight, and the procedure warns that hidden apply-time references can pass it. A scanner can reject a dangerous batch; a green scan is not independence certification. Existing rehearsal and real application behavior proof remain mandatory.

Conclusion: scoped claims alone are insufficient. A future SQL extension needs conservative dependency closure including global privileges and promotion machinery, with UNKNOWN yielding refusal. For stage one there is no SQL independence claim at all: intervening migration/code merges remain blocked.

## 4. Alternatives and decision

| Alternative | Required changes | Residual pause | Decision |
|---|---|---|---|
| Release freeze unchanged | None | Exact-main refusals and independent production interlock remain | Reject: makes reviewed delivery stale rather than safe |
| Table/schema-only scoped freeze | Object-filter merge check | Writes serialized | Reject: dependency/order/control-code coverage inadequate |
| Snapshot + ordinary-prose exception | One versioned snapshot authority, shared delta validator in preview/qualification/lock, final queue admission, owned cleanup fencing | All executable/migration merges during review; all merges during production lane | Recommend as bounded first proposal, subject to assigned design review and tests |
| Snapshot + proven disjoint additive SQL | Full read/write/global dependency closure, order barrier, reconciled live ledger, isolated baseline rehearsal, queue recomputation | Global control/security changes and unknown SQL; exclusive database writes | Defer: cannot prove safe with current extraction |
| Snapshot permitting all source-only SQL merges | Keep SQL execution pinned; prove tail not applied and reserve ordered future promotions | Policy/producer changes; writes | Plausible architecture, but not the requested conflict protection without explicit applied-state/dependency proof; reject automatic activation |
| Short staged global freezes | Review immutable candidate before freeze, then revalidate actual snapshot, issue, ledger, artifacts and risk inputs under freeze | Short final barrier plus production lock | Worth measuring; evidence-equivalent review must be proven, otherwise requires re-review and removes no delay |
| Review before source merge | Candidate/runtime equivalence with actual merged S and independent risk assessment | Final integration validation, production lock | Do not transplant candidate approval onto S without exact equivalence; changing SQL invalidates approval |

The shortest defensible window is event-defined, not a fixed minute target: final synchronized transition into the production lane through successful/failed apply verification and owned release. Stage one retains broad blocking for executable/migration changes before that window; prose can proceed through qualified snapshot checks. Removing the production-wide source pause itself is a later design, not part of the recommended first change.

## 5. Deterministic races and recovery

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

## 9. Independent design review and publication

Allocator sequence **5638** assigned **Gemini 3.8 Flash High**, excluding author engine Codex. Supported governed runner reviewed source **610e80cd3bc0ec523a794ec59db11699318cf31f** and returned **APPROVE**. Create-only durable verdict ref: `refs/db-review-verdicts/4039-4040-610e80cd3bc0ec523a794ec59db11699318cf31f`; [verdict commit](https://github.com/popcre/shared-db/commit/6bf4f63a2b6d1306c44e071fde74faf826fc96dc). Source digest `994bcb5b60f642ed7424106ba7decbc800c5893806bb19477663f0a8ae4731ad`; packet SHA `6ed4c4e3e0ef27b28cd735eae13da1af25bfa53ddf105ecffb356246c7af3234`. [Verbatim findings](https://github.com/popcre/shared-db/pull/4040#issuecomment-6041879781) are retained on PR #4040. This approves the proposed design, not implementation, deployment or live safety. Subsequent outcome bookkeeping does not extend exact-head approval to code.

Two supplemental same-engine critiques returned REJECT and remain verbatim in [first outcome](narrow-promotion-freezes-supplemental-review.md) and [second outcome](narrow-promotion-freezes-supplemental-review-2.md). All objections were addressed before the independent verdict: reuse existing Step 10 primitives/ownership, include recovery callers, establish pre-review candidate authority, register the literal router pointer, and exclude migration trains with a serialized candidate/train handshake. Neither supplemental verdict is relabelled APPROVE.

The genuine router registration and corrected ready repository-maintenance issue fields enabled supported allocation. Sequence 5637 Muse assignment on superseded 85fb7a16 was never launched and was returned using exact own superseded-target release; no provider health was changed. Task declaration was corrected to reviewer-safety after escalation; an initial combined publishing command incorrectly continued after refusal, without any merge/production action. Future mutations must follow a separate successful gate check.

Publication remains subject to ordinary protected authorization. PR #4040's document authorization at **12:08:29 PM EDT, October 7, 2026** refused under the renewed #2875/#3708 freeze held by chat `01a1126f-6efb-7a22-8034-4471909f2c86`, expiring **12:37:55 PM EDT**. Read-only chat snapshot at **12:08 PM EDT** reported rehearsal running under that session's agent; the parent chat itself was idle after reporting. No foreign freeze was released. This investigation workstream owns publication; the existing production session owns its freeze and production result. Recheck actual ownership and authorization before landing; expiry is not permission to release another owner's record.

Future implementing workstream owns consumed-prose/runtime denylist closure, live revocation freshness, queue activation barriers, generation fencing, shared-preview baseline changes and measured production-lock duration. Named tests and review gates remain in the plan. They are implementation proof requirements, not unresolved business choices.

## 10. Explicit answers

1. **Can every shared-db merge except conflicts safely proceed today?** No. Current guards block globally; dependency knowledge is insufficient for generic conflict-only admission. Prose is a defensible bounded proposal. Unknown SQL, shared security and promotion-runtime changes retain repository-wide conservative blocking.
2. **Can a fixed approved snapshot remain deployable after main advances?** Conceptually yes after proven inert prose; current qualification and production acquisition refuse it. Implement common snapshot/harmless-delta authority first. Broader SQL movement remains unproved.
3. **Which invariants demand equality and what replaces it?** Preview acquisition, qualification and production acquisition insist current main. Replace only harmless movement with protected-main ancestry + full deny-by-default delta + immutable runtime/migration provenance + synchronized live authority/ledger rechecks. Keep exact source review and exact snapshot risk assessment.
4. **Are claims enough?** No; they omit complete transitive privileges, runtime references, global code and ordering.
5. **Smallest safe window?** Retain global pause from final production acquisition through post-apply verification/release; allow prose during review only after snapshot design is proved. No measured minimum in minutes.
6. **Cleanup/crash recovery?** Exact ref/generation/run fencing, preserve database ownership, reconcile partial apply and use supported evidence-based recovery. TTL removes source admission blocking but never certifies a promotion or abandoned database lock. Never release another owner by appearance or age.

Independent design approval is retained above. No implementation, deployment or production/application acceptance is asserted.


===== PLAN =====
# Proposed implementation: ordinary-prose merges during promotion review

**Proposal only — not authorization to change safeguards or production.** Investigation issue [#4039](https://github.com/popcre/shared-db/issues/4039). Source baseline `fee69a25ffd9b39c2b3accfde680dfbac3aa54f5`. Read [investigation and evidence](docs/investigations/narrow-promotion-freezes.md) first, then this STATUS table. Owner: Codex investigation workstream. October 7, 2026, 11:39 AM EDT.

| Step | Status | Evidence / gate |
|---|---|---|
| Independent design approval | APPROVED DESIGN | Allocator sequence 5638 Gemini APPROVE at 610e80cd; report §9 retains durable exact-source verdict |
| 1. Freshness, authority and inventory | OPEN | §9.1 below |
| 2. Immutable snapshot and strict delta validator | OPEN | §9.2 and §10 named tests |
| 3. Admission, queue and freeze generation fencing | OPEN | §9.3 |
| 4. Preview, qualification and production integration | OPEN | §9.4 |
| 5. Adversarial/concurrency verification | OPEN | §9.5 |
| 6. Reviewed rollout, measured acceptance and rollback | OPEN | §9.6; live proof remains on #4039 |

**Fresh-session starting point:** verify retained design verdict and live publication state. Do not start implementation without later authorization. This session was authorized only to investigate. Successor registration: [handoff](HANDOFF.d/2026-10-07T1545Z-edge-dev3-codex-narrow-promotion-freezes.md).

## 1. Ultimate goal

Allow harmless document work to finish while another approved database change is being reviewed for production, without risking the shared database or losing exact acceptance evidence. If a step conflicts with this goal, the goal wins — stop and flag it. Speed never replaces review, target proof, bounded application, collision protection or live application acceptance.

## 2. System and environment

Canonical repository [popcre/shared-db](https://github.com/popcre/shared-db) owns SQL migrations for one shared Supabase database consumed by POP applications (CRM, DAM, PIM and DesignFlow). GitHub is source authority; automatic workflows execute reviewed changes. This is repository tooling, not a database structure change. Implementation languages are Node ES modules, Python and GitHub workflow YAML. Production identity is guarded by existing policy; preview identity comes from repository variable `PREVIEW_PROJECT_REF`. Never infer target from a local config.

Work only in a dedicated current-upstream worktree. Never edit a consumer's mirrored `shared-db/` directory or another session's checkout. Read repository `AGENTS.md`, `docs/agents/current-workflow.md`, relevant merge/claim/standing rules and activated production policy. Current automatic policy is active in `config/production-risk-policy-activation.json`. Never manual-dispatch production to test this proposal.

## 3. Trigger and reproduction

Albert asked whether promotion freezes could avoid blocking all shared-db merges. The supplied investigation task expressly prohibits implementation/deployment. Original mechanism on #3919 intentionally protects main while a risk assessment is obtained. On October 7 the #2875/#3708 freeze blocked generic merge acquisition and document authorization. Reproduce offline using existing freeze tests in `scripts/manage-migration-author-lanes.test.mjs`; never create a production freeze as an experiment.

## 4. Scope

IN: single-source automatic promotion only, serialized mutual exclusion with outstanding migration-train authority, immutable promotion identity, strict harmless-prose tail classification, review-period prose admission, consistent caller checks, exact-generation cleanup, offline race tests, measured staged rollout after separately authorized implementation.

OUT: all new SQL/schema or data writes; generic disjoint-migration admission; snapshot promotion of migration trains; releasing existing locks; changing reviewer membership/approval semantics; reducing required checks; changing branch protection; new manual production lane; reopening retired orchestrator instructions; changing consumer deployment/acceptance rules; a new scheduling service. Do not fabricate a migration to get a reviewer.

Retain broad blocking during actual production ownership. This intentionally small first delivery offers meaningful review-period relief without a semantic SQL dependency engine.

## 5. Current code and delivery state

Nothing in this proposal is implemented, committed as code, deployed or live-accepted. Existing behavior and pinned references are fully mapped in report §§1–3. Entry points:

* `scripts/manage-migration-author-lanes.mjs:3943,3953,4043,4063–4158`: acquisition, freeze records and documents authorization.
* `scripts/lib/lanes/exclusive-policy.mjs:110–201` and `exclusive-locks.mjs`: extracted compatibility policy, must match orchestration.
* `scripts/lib/documents-only-change.mjs`, `scripts/check-documents-only-merge-authorization.mjs`: base-owned complete comparison/classification.
* `scripts/check-main-tip-freshness.mjs:64–109,121–243`: existing path-based production-inert exception, **not enough for new admission**.
* `.github/workflows/shared-supabase-migrations.yml:431,1173,1557,1800,1831,2159–2182`: preview, qualifier, apply and cleanup.
* `scripts/merge-queue-contract.mjs:233–276,436–468`, `.github/workflows/merge-queue-gate.yml`: final queue recheck.
* `scripts/production_business_risk_gate.py:596,1244,2229,3743`: runtime/provenance/source/risk chain.
* `scripts/production_migration_guard.py:1070,1543,2280,2511`: bounded ordered guards and fresh dry-run.

Line numbers are baseline locators, not permission to edit blindly after upstream movement. Re-read live code first. Existing production source review equivalence is preserved; tests do not become unreviewed implementation equivalence.

## 6. Findings and root cause

Exact-main protection is spread across several independent guards. One production freshness check already allows documentation/tests/evidence movement, but preview and qualification/lock still require literal equality. Removing only the freeze would make work fail later. Production-held merge blocking and status revocation are separate mechanisms.

Claims/version leases model named read/write overlap, not complete transitive SQL dependencies. Stored bodies, dynamic SQL, role/default privileges, FK/trigger/type dependencies and promotion code invalidate schema-only independence. Baseline cleanup is exact-delete within each operation but matches release by PR across attempts; an old same-PR cleanup can match a replacement freeze. See report §5 for fencing distinction.

## 7. Rejected approaches

Reject bare freeze release, schema/table-only comparison, blindly permitting `.md`, using only the existing production-inert predicate, candidate review transplanted to moving main, source-PR-only cleanup fencing, accepting an expired lock as abandoned, and weakening reviewer retention/parsers. Do not broaden reviewed-source equivalence to tests. Do not add a separate broker, scheduler or duplicate promotion implementation.

Generic migration tail admission is deferred, not approved by implication. A future plan must prove dependency closure, version barriers, changed live ledger and producer-code authority; this plan cannot pass its positive case.

## 8. Locked and open design decisions

**Locked safety requirements:** source approval exact head; risk assessment exact snapshot S and ordered V; bounded immutable migration bytes; target proof immediately before every write; fresh verified dry-run; exclusive production write lock; unchanged applied migrations; all current artifact/source/issue/activation proofs; fail closed for missing/unknown state; application acceptance on same issue. No human technical approval or manual work.

**Locked first-stage scope:** only inert ordinary prose during review/qualification; existing full pause while production ref held; no SQL or executable changes while a snapshot is active.

**Implementation choices with explicit criteria:** reuse the current trusted classifier and global-invalidator inventory; one shared strict comparison module must serve every caller. Extend existing `scripts/target-queue-identity.mjs` freshness/manifest primitives (lines 247–357) and `scripts/lib/lanes/exclusive-policy.mjs`; **do not create `scripts/lib/promotion-snapshot.mjs` or another snapshot subsystem**. Step 10 #3781 already owns this integration. Reconcile its live scope/owner and reuse accepted wiring once available; do not implement its shared-file scope a second time. Its October 6, 2026, 8:39:11 PM EDT comment proves policy-level merge only, not live queue acceptance or production acquisition integration. Reuse existing evidence schema/transport helpers. A versioned snapshot record must be immutable and supported by exact-ref ownership; choose the existing coordination namespace or a new documented one only if no existing compatible record exists. Register every new ref in snapshot/transfer/configuration inventories and recovery readers.

**Unsettled and implementation-blocking:** complete consumed-prose denylist, live revocation semantics, activation barrier over preauthorized groups, shared-preview baseline freshness. Resolve by source evidence, named negative tests and assigned review, never a business question for Albert.

## 9. Sequenced executable phases

### 9.1 Freshness, authority and inventory

After separate implementation authorization: declare task class matching actual safeguarded production tooling scope (`production` if it gates live production; never downgrade to prose). Re-read gate policy and branch policy. Use the truthful ready repository-maintenance tracking fields with `change_type: documentation` for this investigation review and `SHARED_DB_AUTHOR_ENGINE=codex`; delivery-preflight arguments are optional unless the live task route requires them, and supplied proof must be genuine. Fetch live main into a dedicated worktree, run freshness guard, inspect issue #4039 and active overlapping tooling PRs, claims, exclusive refs and supported mutex recovery status. Do not adopt #2875/#4037 ownership.

Re-read `plan_shared_db_workflow_refactor.md` Step 10 and live #3781/#4018; preserve its MiMo ownership and register only freeze-specific extension scope after supported overlap reconciliation. Do not message another chat without Albert's explicit authorization; read-only issue/state inspection is enough to detect a hold. Define inventory at exact base: every runtime imported file, workflow, policy/configuration, verification sidecar and prose/instruction resource used in promotion, including dynamically loaded resource paths. Compare `PREVIEW_PRODUCER_PATHS`, sidecar registry and `config/orchestrator-global-invalidators-v1.json`; unknown closure refuses. Record existing required-check list unchanged.

Gate: a versioned inventory with reproducible source references; no missing runtime resources; no overlapping owned change; baseline suites pass. If a dependency cannot be proven inert, exclude its entire class.

### 9.2 Snapshot authority and strict harmless delta

Use/reuse one versioned promotion snapshot: exact S, source PR/head/merge SHA, work issue/contract generation, ordered V and migration digests, runtime/policy closure digest, immutable preview/review evidence identities, freeze SHA/generation and intended run attempt. Create an immutable **candidate descriptor before risk review** once exact source/main/runtime/baseline identity is established under the activation barrier. It permits only proven inert-prose admission, never production. After actual-main preview/risk proofs, append a separate immutable **approved attestation** referencing the candidate digest and complete artifacts/verdict. Dispatch/apply requires the approved attestation; candidate-only, cancelled or superseded review always refuses. Missing artifact/approval fields are legal only in the explicitly candidate state and never a production request. Missing fields, duplicate keys, unknown version/fields and reordered V refuse. Stage-one candidate requires one source PR, no train identity and no outstanding authorized/dispatched/failed train. A complete read of latest immutable train generations is mandatory; unknown/partial listings refuse. Train authorization/dispatch and candidate activation/admission must share existing coordination mutex so a train cannot authorize after an earlier absence check while prose admission remains active. Do not close or cancel another train to make a candidate eligible.

Extend the existing `evaluateProductionFreshness`/manifest-binding primitives in `scripts/target-queue-identity.mjs` with a strict, explicit candidate/attestation validation mode, with a minimal Python adapter only where necessary (canonical JSON bridge, no duplicated policy). Prove S is a real protected-main ancestor of fresh T; read exact complete git tree comparison, not filename metadata alone. Require ordinary prose classification from trusted base code, regular files and allowed modes, exclude executable instructions/runtime-consumed prose/global invalidators; disallow unproved renames/deletions/symlinks. Verify unchanged V and runtime closure. Explicitly reject migration/tests/evidence/code/config changes in the **new exception**, regardless of older independent allowances.

Preserve legacy exact-main behavior for old records; versioned opt-in only. Fresh issue/assignment/activation/ledger state is not a cached snapshot assertion.

Gate: `snapshot_docs_advance_preserves_exact_identity`, all hostile record/delta cases in §10; old exact equality tests unchanged where no new authority exists.

### 9.3 Admission and cleanup fencing

Integrate validator into `authorizeRepositoryMaintenanceStatus` while holding existing mutex; re-read live snapshot/ref and exact PR state before success. Code/migration acquisition retains current refusal. Queue group path must recheck snapshot generation, complete group tree and source PR authorization at final success; refuse multi-member/mixed groups under current single-PR contract. Snapshot activation must not assume old merge lanes disappear: drain/prove merge lane absent or prove harmless completed advance and revalidate.

Modify freeze schema/acquire/release to carry exact attempt/generation/ref authority. Ordinary release by textual owner or PR is not sufficient to release a replacement; producer records exact acquired SHA, cleanup passes expected SHA and attempt, release refuses mismatch under mutex. Upgrade all workflow cleanup callers together. Keep recovery evidence strict for unreadable legacy records; do not broaden any-positive-PR recovery. Repeated exact cleanup is no-op. Production ref ownership stays exact owner SHA; it never expires automatically.

Gate: race tests with actual synchronized fake refs or local Git atomic updates, covering an old same-PR cleanup against a newer generation, simultaneous acquisition, stale group success and TTL while apply is held.

### 9.4 Promotion caller integration

Include `scripts/dispatch-production-apply.mjs:119–122`, `.github/workflows/production-apply-review-evidence.yml:39–49`, and `.github/workflows/production-catalog-verification-recovery.yml:27–33` in the caller matrix. Also inventory `scripts/lib/lanes/cli-train.mjs:29–38,49–63` and `scripts/orchestrator-flow/migration-train.mjs:32,95–99`. Preserve their current-main equality for this first stage, and add the synchronized train/candidate admission exclusion from §9.2. Do not pass a train dispatch through the single-source snapshot route. Recovery callers are recovery routes, not new ordinary authorization: consume exact approved attestation under the same validator, preserve original failed-apply evidence and never rerun already-applied SQL. Snapshot recovery must remain possible after admitted prose movement; unknown/code movement still refuses. Replace preview/qualification/production-acquire **only under verified versioned snapshot authority** with common harmless-delta proof; retain exact checkout S, risk `mainSha=S` and artifact digests. Caller code must never silently update S to T. Update extracted policy and workflow check branches consistently. Qualification before dispatch and production acquisition after global mutex both require fresh protected-main tail proof; main movement races either validate harmless prose or refuse.

Keep production lock acquired before final apply freshness check. Keep full source merge blocking/status revocation while production held; cleanup restores only this run's revocations. Never change bounded checkout, target proof, dry-run/apply order, ledger/catalog checks or application acceptance. Inspect whether any producer proof incorrectly switches comparison target to T; preserve exact pinned closure against S and separately verify T contains no invalidator. Live cancellations/revocations must stop old snapshots; TTL is no review authority.

Gate: end-to-end offline workflow qualification fixture where docs land before qualification and before production acquisition, exact S is executed and ordered V is unchanged; code/policy movement refuses before dispatch/write; all legacy production evidence suites pass.

### 9.5 Adversarial verification and assigned review

Run §10 suites and race corpus. Review full changed diff, all callers, negative-case traces and immutable packet with allocator-assigned independent reviewer; start review concurrently with required CI after exact head push. Batch all review/CI fixes into one head, then re-review exact changed head. Do not name the implementer in this plan or choose provider outside rotation.

Gate: durable exact-head APPROVE for actual safeguard implementation, all required checks green and unchanged required-check set. A docs proposal's publication is not such approval.

### 9.6 Rollout, acceptance, rollback

Ship with opt-in/default-off versioned policy; retain old path. First shadow-only classify historical events and current changes without granting merge authority or touching production. Compare proposed versus old refusals, require zero false allows across adversarial corpus. Then enable ordinary-prose admission only through normal reviewed repository route. The assigned reviewer must approve exact activated configuration and runtime closure; task gates precede any production-affecting activation.

Use the next independently authorized real promotion as canary: allow one eligible prose merge during review, record S/T/V/closure/artifact identities, qualifier result, production ownership times, target proof, dry-run/apply evidence and original application acceptance. Do not launch a promotion solely as this tooling experiment. Keep `- [ ] live proof` and acceptance evidence on #4039 until measured behavior is established; source application's own issue also retains its acceptance requirement.

Rollback: stop new snapshot admissions/default off through a reviewed fix/revert; never cancel an active SQL apply or delete its lock to roll back tooling. Let owned run finish/reconcile, preserve snapshots/ref generation evidence, restore conservative merge authorization through existing gates. Do not roll back database ledger or edit applied migrations. Resume normal exact-main path only after old snapshot attempt is terminal and source refs reconciled.

Gate: one real approved promotion with eligible prose advancement passes complete original acceptance, no unauthorized merge or broader SQL allowance, measured separated timings recorded and independently assessed. No promise of elapsed-time reduction if mutex/CI dominate. Natural cut points are after §§9.2, 9.4, 9.5; re-read downstream phases and live source at each cut.

## 10. Tests and adversarial input matrix

Implement tests in the existing nearest suites and extend existing `scripts/target-queue-identity.test.mjs`; no duplicate snapshot module. Test names below describe required observable assertions, not just return values.

| External input / race | Hostile case | Named test and expected evidence |
|---|---|---|
| Snapshot JSON | Duplicate key, unknown schema/field, malformed SHA, changed digest/V order | `snapshot_record_rejects_ambiguous_identity`; no dispatch/write |
| Protected-main delta | Rewritten/non-ancestor history, unreadable/empty unexplained diff | `snapshot_tail_requires_readable_protected_ancestry` |
| Exact files/modes | Renamed instruction, Markdown symlink, executable mode, runtime-consumed prose | `snapshot_prose_cannot_hide_runtime_change` |
| Train authority | Existing authorized/dispatched/failed train; authorization races candidate activation | `stage_one_train_authority_retains_global_freeze` and `train_candidate_activation_has_one_winner`; no stranded approved train |
| Train recovery | Retry after partial apply or stale snapshot | `train_partial_apply_recovery_stays_legacy_and_no_prose_exception`; applied prefix never replays |
| Candidate lifecycle | Before risk approval, missing final evidence | `candidate_docs_only_never_dispatches_or_writes`; final attestation required |
| Recovery callers | Docs advance after partial apply or before immutable recovery evidence | `snapshot_recovery_accepts_prose_but_preserves_original_attempt`; no replay |
| Pure docs | Regular inert prose advances T during review | `snapshot_docs_advance_preserves_exact_identity`; S/V/A unchanged |
| Migration/code tail | Apparently disjoint additive CREATE in another schema | `stage_one_disjoint_sql_still_refuses`; no approval implied |
| SQL dependencies | Shared role/grant/function, cross-schema FK, trigger, DO/dynamic SQL | `unknown_and_shared_dependencies_refuse`; no SQL parser certification |
| Version inventory | Earlier/later version, duplicate, edited applied, ledger hole | `snapshot_tail_cannot_change_migration_inventory`; preserve legacy guard refusals |
| Live database | Extra applied version absent from S or partial A/B batch | `snapshot_live_ledger_reconciliation_refuses_stale_baseline`; applied A never reruns |
| Artifact/run | Expired/cancelled/wrong producer, another run attempt or source issue | `snapshot_rechecks_live_provenance_and_authority` |
| Policy/runtime closure | Mid-review promotion workflow/config/sidecar/security revocation change | `snapshot_global_invalidator_stops_old_runtime` |
| Final admission | Main/group/head changes after earlier authorization | `queue_final_snapshot_generation_race`; success only for exact validated group |
| Activation | Merge lane already held when snapshot begins | `snapshot_activation_drains_or_revalidates_prior_merge` |
| Concurrent acquire | Two sessions | `snapshot_create_only_has_one_winner` |
| Cleanup | Old attempt same PR deletes newer generation | `cleanup_old_attempt_cannot_release_new_same_pr_freeze` |
| Retry cleanup | Already absent expected generation | `cleanup_repeated_exact_attempt_is_idempotent` |
| TTL | Expiry mid-review vs mid-apply | `expiry_does_not_authorize_stale_snapshot_or_release_production` |
| Batch queue | Mixed safe/unsafe members | `queue_multi_member_snapshot_refuses` |

Run existing `node --test scripts/target-queue-identity.test.mjs scripts/dispatch-production-apply.test.mjs scripts/orchestrator-flow/migration-train.test.mjs scripts/manage-migration-author-lanes.test.mjs scripts/check-main-tip-freshness.test.mjs scripts/merge-queue-contract.test.mjs scripts/check-merge-queue-workflows.test.mjs scripts/lib/documents-only-change.test.mjs scripts/lib/lanes/exclusive-policy.test.mjs`; discover any actual renamed files before execution. Run Python suites `scripts/test_production_business_risk_gate.py`, `scripts/test_production_apply_review_evidence.py`, migration guard and derivation suites using repository documented Python context. Run `bash scripts/check-sql.sh`, all required workflow checks and promotion-sidecar closure guard. For concurrency, control barriers around observed ref SHA/final authorization, and assert loser leaves winner's ref intact.

A later SQL extension must add a positive `disjoint_additive_tail_merge_preserves_order_and_live_baseline` test with independent dependency proof; it is **not stage-one done criteria** and remains a refusal here.

## 11. Constraints and traps

One parent issue for this application/tooling need, no leftover-proof ticket. No structural object claims for tooling. Use installed task gates and `ai-gh`; exact-head review, queue and normal branch protections remain. Current main might advance between every read; verification at prior head expires. Preserve production environment binding, workflow concurrency, complete target proof, immutable provenance, live acceptance and collision coverage. Human times are America/New_York with EDT/EST labels. Signature on all GitHub posts: `Posted by Codex chat <actual id> on <machine>`.

Report limitations honestly: docs-only validation is not independent design review; a passing scanner is not SQL safety; merged/deployed/catalog-proved/application-accepted are distinct; deleting a lock is not a repair. Do not install tooling or access 1Password during reviews. No secrets in artifacts/arguments/logs.

## 12. Access and evidence

Installed `ai-task-gates`, `ai-gh`, Node and Python3 were available; GitHub authenticated read and issue creation worked. `python` was absent; use supported `python3`, do not replace OS binaries. No database credentials were needed or read. If future authorized acceptance requires credentials, load existing secrets skill and supported provider procedure; vault `vibe_coding`, locate documented item title from current runbook, never embed values or invent titles.

Private raw captures from investigation are under `/tmp/narrow-freeze-evidence/`; ephemeral only, not future-session authority. Durable baseline, observed run IDs/status provenance and sanitized summaries are in the report. Re-fetch current owners/refs rather than relying on those captures. The exact-source independent verdict and durable provenance are retained in report §9.

## 13. Definition of done, risks and open ownership

Investigation done requires report, sequenced proposal, durable publication and allocator-assigned independent design verdict or an explicit capability blocker; an unreviewed report cannot satisfy the requested approved recommendation. Implementation done requires separately authorized scope, exact-head assigned review, tests/CI, normal commit/push/PR/merge, activated-code identity, real prose-during-review canary, complete production/application acceptance and measured cleanup. Update this STATUS as each phase changes; mark code-landed/live-unaccepted distinctly and keep same-issue checklist unticked. Retire linked handoff only when its work is truly complete.

Risks: wrongly inert classification, stale live safety policy, existing group crossing activation, same-PR cleanup replacement, ledger drift and shared-preview contamination. Each risk has a named negative test and rollout refusal. Until these and assigned review pass, default remains conservative global freeze. No human decision is needed. Codex investigation workstream owns publication; future authorized implementation workstream owns all open phase gates and must register itself on #4039 before work.

## Self-audit

1. Can a newcomer execute without chat? **Yes for the authorized next step and, after approval/authorization, the scoped implementation.** §§1–5 define purpose, system, scope and exact source; §§9–12 specify ordered changes, verification, access and traps. The supported maintenance assignment route has been verified; design review is complete; implementation exact-head review remains a separate stop condition.
2. Does it preserve background/rejections? **Yes:** §§3,6–8 and linked report preserve exact-main contradictions, claim limitations, historical timings, rejected table-only approach and same-PR cleanup race; §§10–13 retain uncertainty and rollback.
3. Is the ultimate goal decisive? **Yes:** §1 states business outcome and goal-wins instruction; locked §§4,8 forbid SQL expansion and weaker acceptance even if faster. All 13 required sections, named adversarial tests, status/evidence, scope, definitions, secrets boundary and bidirectional handoff are present. Supplemental REJECT findings on d853e087 were addressed by existing primitive/ownership reuse, full recovery callers, pre-review candidate lifecycle literal operating-router registration and train/candidate exclusion; allocator sequence 5638 approved the corrected design at 610e80cd. No implementation approval is claimed.


===== FIRST CRITIQUE =====
# Codex review — plan-review

| field | value |
|---|---|
| repository | `/home/ahazan/.codex/worktrees/509a/shared-db` |
| reviewed commit | `d853e08782ea4d62d23b75294dc2ae8dfc4b4af1` |
| source digest | `31928ff619716522bcfe5e3f68645311d1ede1b7c673539a56c6a1585650f958` |
| run | `20261007T154742-979640-19802` |
| caller | `codex` |
| elapsed seconds | `181` |
| sandbox | `read-only` |

## Result

## Provisional verdict

REJECT

## High

- The plan duplicates an active, owned implementation and existing snapshot primitive without reconciliation: `plan_shared_db_workflow_refactor.md:19,294-302`; `scripts/target-queue-identity.mjs:247-357`; proposed replacement at `plan_narrow_promotion_freezes.md:72`.
- Recovery paths are omitted. They still require current-main equality and would strand an approved snapshot after prose advances: `scripts/dispatch-production-apply.mjs:119-122`; `.github/workflows/production-apply-review-evidence.yml:39-49`; `.github/workflows/production-catalog-verification-recovery.yml:27-33`. The caller inventory and tests omit them: `plan_narrow_promotion_freezes.md:43-50,104-110,152`.

## Medium

- Creating the snapshot only after risk proof defeats review-period relief: `plan_narrow_promotion_freezes.md:19,33,88`; current freeze starts before risk assessment: `scripts/manage-migration-author-lanes.mjs:4051-4056`.
- The plan is absent from the operating router: `AGENTS.md:11-14`.

## Verdict
REJECT


===== SECOND CRITIQUE =====
# Codex review — plan-review

| field | value |
|---|---|
| repository | `/home/ahazan/.codex/worktrees/509a/shared-db` |
| reviewed commit | `85fb7a1605254a7dbe2e01e7ee324ac88117559e` |
| source digest | `34cbf1c607b1dc21ee15d424b46db01b4bdc85fbaba7823e5b1e867fece938e2` |
| run | `20261007T155545-1156536-19595` |
| caller | `codex` |
| elapsed seconds | `158` |
| sandbox | `read-only` |

## Result

## Provisional verdict

REJECT

## High

- The current-main caller inventory remains incomplete. The plan lists recovery callers but omits migration-train authorization and dispatch (`plan_narrow_promotion_freezes.md:104-110`). Those paths still require exact main equality (`scripts/lib/lanes/cli-train.mjs:29-38,49-63`; `scripts/orchestrator-flow/migration-train.mjs:32,95-99`). An approved train is therefore stranded after an admitted prose merge. The test matrix also omits train coverage (`plan_narrow_promotion_freezes.md:128-154`). Either explicitly exclude trains from stage one or route them through the shared snapshot validator and add positive, stale, retry, and partial-apply tests.

No additional medium or low findings. The four original objections are otherwise addressed. This critique does not satisfy allocator-assigned independent approval.

## Verdict
REJECT


===== GEMINI FULL FINDINGS =====
GOVERNED REVIEW FINDINGS — NON-AUTHORIZING UNLESS THE MATCHING CREATE-ONLY VERDICT ARTIFACT EXISTS

This allocator-assigned independent DESIGN/PLAN review evaluates issue #4039 and PR #4040 at exact head `610e80cd3bc0ec523a794ec59db11699318cf31f`. The review evaluates the investigation report in [`docs/investigations/narrow-promotion-freezes.md`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/docs/investigations/narrow-promotion-freezes.md), the implementation plan in [`plan_narrow_promotion_freezes.md`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/plan_narrow_promotion_freezes.md), the operating router entry in [`AGENTS.md`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/AGENTS.md#L9), and the handoff record in [`HANDOFF.d/2026-10-07T1545Z-edge-dev3-codex-narrow-promotion-freezes.md`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/HANDOFF.d/2026-10-07T1545Z-edge-dev3-codex-narrow-promotion-freezes.md).

### Findings and Evidence Assessment

1. Scope, Authority, and Safeguard Boundaries
   - Relevant files: [`docs/investigations/narrow-promotion-freezes.md:144-153`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/docs/investigations/narrow-promotion-freezes.md#L144-L153), [`plan_narrow_promotion_freezes.md:40-47`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/plan_narrow_promotion_freezes.md#L40-L47), [`HANDOFF.d/2026-10-07T1545Z-edge-dev3-codex-narrow-promotion-freezes.md:11-14`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/HANDOFF.d/2026-10-07T1545Z-edge-dev3-codex-narrow-promotion-freezes.md#L11-L14).
   - The pull request is strictly confined to documentation, technical investigation, and architectural design. No database schema migrations, SQL files, production safeguard code, or live workflow mutations are executed, merged, or deployed.
   - The design explicitly bounds stage one to a single-source promotion snapshot with a narrow exception for positively proved inert ordinary prose during the review and qualification period.
   - All source code and schema merges remain completely paused whenever the production lane lock is held (`refs/db-coordination/exclusive/production`).
   - Generic disjoint SQL merges and table/schema-scoped lock exceptions are explicitly rejected and deferred pending comprehensive dependency-closure extraction.

2. Preservation of Core Safety Invariants
   - Relevant files: [`plan_narrow_promotion_freezes.md:75-80`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/plan_narrow_promotion_freezes.md#L75-L80), [`docs/investigations/narrow-promotion-freezes.md:177-198`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/docs/investigations/narrow-promotion-freezes.md#L177-L198).
   - Exact source approval is fully preserved: source PR head commits, assigned AI reviewer approval, and exact-head bindings remain non-negotiable prerequisites.
   - Bounded ordered migration versions $V$ and their exact SHA256 file contents remain immutable.
   - Exact target proof immediately before database writes is preserved.
   - Exclusive database writes remain enforced under exclusive mutexes, with live ledger and catalog reconciliation preceding and succeeding execution.
   - Live application acceptance remains tied to the parent issue and cannot be bypassed by automated tooling tests alone.

3. Two-Stage Snapshot Lifecycle and Train Exclusion Handshake
   - Relevant files: [`plan_narrow_promotion_freezes.md:95-104`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/plan_narrow_promotion_freezes.md#L95-L104), [`docs/investigations/narrow-promotion-freezes.md:200-214,221-222`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/docs/investigations/narrow-promotion-freezes.md#L200-L214).
   - Addressing the previous critiques, the snapshot lifecycle is cleanly bifurcated:
     1. An immutable candidate descriptor is recorded before risk review under an activation barrier, recording exact $S$, $V$, source PR, merge SHA, runtime closure digest, and freeze generation. Crucially, a candidate descriptor grants only inert prose merge qualification and has zero authority to dispatch or execute production writes.
     2. An immutable approved attestation referencing the candidate descriptor is generated only after risk review, qualification, and preview rehearsal are complete. Only this attestation can authorize production acquisition and apply.
   - Migration trains ([`scripts/lib/lanes/cli-train.mjs:29-38,49-63`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/scripts/lib/lanes/cli-train.mjs#L29-L38), [`scripts/orchestrator-flow/migration-train.mjs:32,95-99`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/scripts/orchestrator-flow/migration-train.mjs#L32)) strictly require `base_main_sha === current_main_sha`. The proposal excludes migration trains from the stage-one prose exception and mandates a synchronized mutual exclusion handshake: candidate activation refuses if any train is authorized, dispatched, or failed; conversely, train authorization refuses if an active candidate exists under `MUTEX_REF`.

4. Reuse of Step 10 Architecture and Primitives
   - Relevant files: [`plan_shared_db_workflow_refactor.md:294-302`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/plan_shared_db_workflow_refactor.md#L294-L302), [`scripts/target-queue-identity.mjs:247-357`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/scripts/target-queue-identity.mjs#L247-L357), [`plan_narrow_promotion_freezes.md:81-82`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/plan_narrow_promotion_freezes.md#L81-L82).
   - The proposal adheres to repository boundaries by reusing established primitives (`evaluateProductionFreshness`, `digestManifestInputs`, `promotionManifestBinding`, `canReusePromotionManifest`) from [`scripts/target-queue-identity.mjs`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/scripts/target-queue-identity.mjs#L247-L357) rather than introducing a parallel or conflicting subsystem.
   - Step 10 ownership under #3781 is respected, with #4039 isolated to freeze-specific extensions.

5. Race Handling, Cleanup Ownership Fencing, and Recovery Callers
   - Relevant files: [`docs/investigations/narrow-promotion-freezes.md:249-268`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/docs/investigations/narrow-promotion-freezes.md#L249-L268), [`plan_narrow_promotion_freezes.md:105-120`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/plan_narrow_promotion_freezes.md#L105-L120), [`scripts/manage-migration-author-lanes.mjs:4112-4122`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs#L4112-L4122).
   - The analysis uncovers a subtle flaw in the existing lane cleanup: releasing freezes by source PR number across attempts permits an older run's cleanup to release a newer freeze on the same PR. The plan resolves this by fencing cleanup with exact acquired ref SHA, generation, and attempt number under the coordination mutex.
   - Recovery paths ([`scripts/dispatch-production-apply.mjs:119-122`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/scripts/dispatch-production-apply.mjs#L119-L122), [`.github/workflows/production-apply-review-evidence.yml:39-49`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/.github/workflows/production-apply-review-evidence.yml#L39-L49), [`.github/workflows/production-catalog-verification-recovery.yml:27-33`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/.github/workflows/production-catalog-verification-recovery.yml#L27-L33)) are comprehensively mapped and constrained to validated immutable attestation records without re-applying executed migrations.

6. Timing Attribution and Empirical Evidence
   - Relevant files: [`docs/investigations/narrow-promotion-freezes.md:280-294`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/docs/investigations/narrow-promotion-freezes.md#L280-L294).
   - The investigation rigorously grounds timing observations in live GitHub records (e.g., active freeze commit `828a0fd49ed27738b4db24238937e97fd6349fc3` on PR #3708 / issue #2875 observed for ~89 minutes, and PR #4036 failed at 10:33:26 AM EDT due to that freeze).
   - The report carefully isolates candidate blocked intervals from actual causal freeze waits, avoiding conflation with CI queue delays or general mutex contention.

7. Verification, Rollout, and Rollback Completeness
   - Relevant files: [`plan_narrow_promotion_freezes.md:121-167`](file:///home/ahazan/.local/state/ai-devops/review-sandboxes/gemini-8e3d10370c2b-codex-freeze-design-4039-610e80-79fff02c9cc1/plan_narrow_promotion_freezes.md#L121-L167).
   - The proposal defines a robust suite of named adversarial test cases covering malformed snapshots, non-ancestor tails, hidden runtime Markdown changes, train collisions, same-PR cleanup races, and unreadable records.
   - The rollout strategy follows an opt-in shadow classification pattern before active gating, and limits the canary to one independently authorized production event.
   - Rollback is non-destructive and operational: revert tooling to default-off without deleting database locks or altering applied ledger entries.

---

### Mandatory Checklist Evaluation

- Index usage:
  - The changes in PR #4040 consist entirely of Markdown documentation, architectural designs, and routing links. No SQL migrations, table definitions, query predicates, or database indexes are added, deleted, or altered.
  - In terms of architectural safety, the plan explicitly rejects relying on simple table or column name indexes to infer SQL independence, correctly observing that stored function bodies, dynamic SQL, and foreign key dependencies invalidate table-level isolation assumptions.
- Function volatility:
  - No PostgreSQL functions or schema routines are declared or modified.
  - In the context of proposed tooling routines, functions interacting with mutable external environments (Git refs, GitHub API, worktrees) are treated as strictly volatile/dynamic and fail closed upon missing or unexpected state.
- Exact object checks:
  - The plan consistently mandates exact object assertions across all operations: exact 40-character Git commit SHAs, exact 14-digit migration version numbers $V$, exact file SHA256 hashes, exact runtime closure digests, and exact attempt/generation numbers for coordination refs. Inference by filename alone or loose pattern matching is expressly rejected.

---

The investigation report and implementation proposal represent a thorough, evidence-backed, and conservative design. All objections raised in prior supplemental critiques have been systematically resolved. The proposal preserves all database safety invariants, reuses existing Step 10 manifest primitives, fences cleanup races, excludes migration trains, and enforces fail-closed semantics across all boundaries.

Posted by Codex chat 01a11700-4dab-7443-8e0a-7146957b2cd9 on edge-dev3 (allocator-assigned Gemini design review).

VERDICT: APPROVE 610e80cd3bc0ec523a794ec59db11699318cf31f

DURABLE VERDICT: refs/db-review-verdicts/4039-4040-610e80cd3bc0ec523a794ec59db11699318cf31f 6bf4f63a2b6d1306c44e071fde74faf826fc96dc
SOURCE EVIDENCE: {"repository":"popcre/shared-db","pr":4040,"baseRef":"main","targetSha":"fee69a25ffd9b39c2b3accfde680dfbac3aa54f5","headSha":"610e80cd3bc0ec523a794ec59db11699318cf31f","mergeBase":"fee69a25ffd9b39c2b3accfde680dfbac3aa54f5","files":[{"filename":"AGENTS.md","status":"modified"},{"filename":"HANDOFF.d/2026-10-07T1545Z-edge-dev3-codex-narrow-promotion-freezes.md","status":"added"},{"filename":"docs/investigations/narrow-promotion-freezes-supplemental-review-2.md","status":"added"},{"filename":"docs/investigations/narrow-promotion-freezes-supplemental-review.md","status":"added"},{"filename":"docs/investigations/narrow-promotion-freezes.md","status":"added"},{"filename":"plan_narrow_promotion_freezes.md","status":"added"}],"fileSetSha256":"d411bcc0b1f01c16030212c4e303a32e21cb07b3eccaf75d5897cea82fd1dacc","sourceDigest":"994bcb5b60f642ed7424106ba7decbc800c5893806bb19477663f0a8ae4731ad","packetSha256":"6ed4c4e3e0ef27b28cd735eae13da1af25bfa53ddf105ecffb356246c7af3234","receiptPath":"/home/ahazan/.codex/worktrees/509a/shared-db/.ai/reviews/governed-source-713294a1-15e1-4dc1-9ca8-927424633f35.json","bindingPath":"/home/ahazan/.codex/worktrees/509a/shared-db/.ai/reviews/governed-source-713294a1-15e1-4dc1-9ca8-927424633f35.json.binding.json"}


Read .ai-review-muse-codex-narrow-freeze-4039-debate/MANIFEST.md first for the exact change and test evidence; ignore its answer-format section and use the answer format this request asks for. Return ALL findings in one pass, grouped by severity, with file and line evidence; check for sibling issues of the same class before returning. You work in a disposable, remote-less copy of the repository: you may run commands, builds and tests and edit files there to check your findings, but never edit the .ai-review-muse-codex-narrow-freeze-4039-debate evidence directory. Your edits are discarded after this turn and are not part of the change under review.

## Result

## Verdict on the DESIGN: challenge — safe direction, overbuilt first stage

The six prose files under review change no code and are safe to land as investigation records. On the design itself, I do not endorse stage one as specified. It fails closed (conservative), but it is the wrong size for the problem: it builds a new two-stage snapshot authority with generation fencing, a shared delta validator across ~7 call sites, a train handshake, ~20 named tests, and shadow/canary rollout — all to unblock **only ordinary prose during review**, while the production-lane pause stays global. A substantially simpler alternative using primitives already in the tree captures most of the benefit. Details and counterexamples below.

## Material findings (ordered)

### 1. The freeze is a liveness optimization, not a safety primitive — this reframes the whole cost/benefit (high)
Every downstream guard already fails closed on main movement without any freeze:
- Qualification: literal `HEAD==S && origin/main==S`, else no dispatch ([shared-supabase-migrations.yml:1183](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/shared-supabase-migrations.yml:1183)).
- Dispatch planner: `--commit-sha` must equal live `origin/main` ([dispatch-production-apply.mjs:119-122](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/dispatch-production-apply.mjs:119)).
- Production lock: `metadata.headSha !== mainSha` refuses ([manage-migration-author-lanes.mjs:3940](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:3940)); post-merge preview rehearsal likewise ([same file:3951](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:3951)).
- Trains: `assertTrainLiveOnMain` refuses stale `base_main_sha` ([cli-train.mjs:29-41](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/lib/lanes/cli-train.mjs:29)).

Concrete consequence: if the early (pre-risk-review) freeze were simply deleted, no unsafe apply becomes possible — the worst case is wasted review effort and re-qualification retries when main moves. The report never states this plainly, so the freeze's value is measured in avoided retries, not in prevented corruption. That makes the expensive snapshot machinery harder to justify: you are building a correctness-critical subsystem to optimize a retry path.

### 2. The cheaper alternative already exists in-tree: `classifyMainTip` + inert-delta at qualification (high)
`classifyMainTip` already implements exactly the hard parts the plan re-specifies: `merge-base --is-ancestor` forward-proof, two-point `git diff` (with load-bearing `--no-renames`), empty-diff refusal, and per-path inert classification ([check-main-tip-freshness.mjs:121-243](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/check-main-tip-freshness.mjs:121)). The production callers already consume it via `--production`.

Best credible alternative (fewer moving parts, same safety):
1. Record `S` in the freeze record itself (one new JSON field at acquire, [manage-migration-author-lanes.mjs:4087-4104](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:4087)) instead of inventing a snapshot ref namespace with generations/attestations.
2. Reuse `classifyMainTip` semantics at the three literal-equality gates that actually strand prose (qualification `:1183`, preview acquisition `:3951`, dispatch planner `:121`), keyed off the recorded S. No new snapshot module, no candidate/attestation lifecycle, no manifest-binding extension, no Python adapter.
3. Fix the same-PR cleanup race independently (finding 4) and keep trains on exact-main with a one-sided admission refusal (finding 5).

This removes roughly the plan's §§9.2–9.3 snapshot subsystem while keeping every listed safety property. Codex should defend why a versioned candidate + approved attestation + generation fencing is needed when the freeze record plus existing ancestor/delta proof carries the same identity (S, source PR, V digests are all already pinned elsewhere: risk `mainSha=S`, artifact digests, dispatch inputs).

### 3. Classifier proliferation: the plan would create a fourth "harmless" semantics (high)
Three classifiers already disagree on what is harmless:
- `isDocumentationPath`: `.md`/`.markdown` only, never `.github/` ([check-main-tip-freshness.mjs:74-83](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/check-main-tip-freshness.mjs:74)).
- `isProductionInertPath`: docs **plus** `.agent/*.json` evidence **plus** test files ([same file:101-105](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/check-main-tip-freshness.mjs:101)).
- `classifyLightweightMergePullRequestFiles`: `.md/.markdown/.txt/.rst` plus instruction-bearing-pointer patches ([documents-only-change.mjs:148-178](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/lib/documents-only-change.mjs:148)).

Plan §9.2 then specifies yet another: prose-only **excluding** tests/evidence regardless of older allowances. Counterexample: a test-file merge during promotion passes production freshness today (`isProductionInertPath`) but would be blocked at admission under the plan, then... what? The promotion it accompanies is unaffected (test is inert at production-acquire), but the plan's queue/admission logic has no stated answer for a change one classifier blesses and another refuses. Conversely a `.txt` plan merges via the lightweight lane but `isDocumentationPath` (used by non-production freshness) rejects `.txt`. Demand: one shared strict classifier named in code, not four overlapping predicates. Necessary correction, not optional.

### 4. Same-PR cleanup race is real, confirmed — but it is an independent bug fix, not a snapshot dependency (medium-high, necessary)
Confirmed: `releasePromotionFreeze` matches `existing.pr === Number(pr)` with no generation/SHA fencing ([manage-migration-author-lanes.mjs:4107-1124](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:4107)), and the production workflow's `always()` cleanup releases by `--pr "$SOURCE_PR"` with `continue-on-error: true` ([shared-supabase-migrations.yml:2173-2181](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/shared-supabase-migrations.yml:2173)). Counterexample: run A (stale, slow cleanup) and run B (renewed freeze, same source PR — exactly the 12:08 PM EDT renewal pattern in evidence) → A's `always()` step deletes B's live freeze. Note the asymmetry that proves separability: production-lane release already uses exact `--owner-sha` ([same workflow:2167-2171](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/.github/workflows/shared-supabase-migrations.yml:2167)); only the freeze path is unfenced. Ship this as a standalone reviewed fix now; it must not wait for (or be bundled into) the snapshot project. Also note the existing any-positive-PR unreadable-release exception ([manage-migration-author-lanes.mjs:4116](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/manage-migration-author-lanes.mjs:4116)) stays a valid sibling objection: generation fencing must not silently widen that recovery path.

### 5. Train handshake is underspecified where it matters: the *read* side (medium-high, necessary)
The plan requires candidate activation to "completely read latest immutable train generations; unknown/partial listings refuse." No `listTrainRecords`-failure semantics are cited, and `listRefs` partial failure under GitHub API degradation is exactly when fail-closed matters most. Counterexample: degraded `listRefs` returns one generation instead of two; activation sees "no outstanding train" and admits prose, stranding the authorized train whose `assertTrainLiveOnMain` then refuses at dispatch — a liveness wedge for the train, caused by the prose feature. The plan's named tests (`stage_one_train_authority_retains_global_freeze`, `train_candidate_activation_has_one_winner`) assert outcomes, not the partial-listing input. Require a test with a truncated/failed listing asserting refusal, plus a named owner for `listRefs` pagination correctness.

### 6. Queue path has no freeze check today — the plan promises one, but revocation is doing the real work (medium, necessary)
`recheckQueueInterlock` checks only `productionHeld` + live head status, never the promotion freeze ([merge-queue-contract.mjs:436-468](/home/ahazan/.local/state/ai-devops/muse/work/muse-codex-narrow-freeze-4039-debate-79fff02c9cc1/scripts/merge-queue-contract.mjs:436)). Safety today rests on the freeze revoking head statuses (`revoke_frozen_authorizations`, workflow `:1846`). If stage one admits prose during review, prose heads keep `success` — fine. But for any future "prose during production" step, exempting prose from revocation removes the only freeze signal the queue checks, and `productionHeld` would still block the group... which means prose-during-production requires touching `assertProductionInterlock` too, the most safety-critical broadcast in the queue. This is why prose-DURING-production must stay refused in stage one (agree with the plan) and why its eventual design needs its own review — the revocation/restore loop (`:2198-2228`, byte-identical restore requirement) is not a place for carve-outs without exact-head re-review.

### 7. Benefit case is thinner than presented (medium)
Only one refusal in evidence is causally proven freeze-caused (#4036 at 10:33:26 AM EDT). #4034/#4035 intervals are candidly labeled candidates, not causal. The 12:18 PM EDT #4040 wait showed OPEN/not-queued/checks-PENDING — not freeze-attributable. Meanwhile the dominant delays in the #2875 narrative are review-wrapper capacity/retained-response failures, the occupied `author-acquisition` mutex (distinct owner, `fdb146da`), and production-lock/runner time — none of which stage one touches. Expected saving per prose PR is "0 up to remaining freeze-only wait," and the lower bound (0) is the common case whenever CI/mutex dominate. Staging a snapshot authority + 20 tests + shadow rollout + canary for that distribution needs a stronger throughput argument than three docs PRs on one morning. Instrumentation first (the plan's own §8 metrics: ready→refused, freeze acquire→release, lock acquire→release with causal codes) should precede implementation authorization — measure one more promotion before building.

### 8. Candidate-before-review couples the snapshot to the freeze it is meant to outlive (medium, optional refinement)
The candidate records "exact freeze generation" (plan §9.2), but TTL expiry legitimately ends the freeze while promotion authority continues under the production ref. Any logic joining snapshot validity to freeze generation inherits TTL semantics into promotion authority — the exact confusion report §5 warns about. If the simpler alternative (finding 2) is rejected, at minimum the snapshot must key off (S, source PR, attempt) and treat freeze generation as advisory, with a named test for TTL-expiry-mid-review where the snapshot survives and TTL-expiry-with-non-prose-tail where it does not. (The matrix lists `expiry_does_not_authorize_stale_snapshot_or_release_production` but does not separate these two cases.)

## Scope where broader merges must still refuse (agree with report, restating with teeth)
- All migration/SQL, workflow/tool/config, role/grant/policy, trigger/FK-carrying, dynamic-SQL/DO-block, and promotion-runtime changes: refuse globally during review **and** production. Claims/write-sets are incomplete by construction (runtime-resolved bodies, transitive grants, `search_path`/security-definer, ordering) — report §3 is correct and I verified the parser-coverage limits it cites.
- Migration trains: keep exact-main, no prose exception, until the partial-listing read problem (finding 5) is solved and tested.
- Everything during held production lane: full pause, including prose, until a dedicated revocation-carve-out design passes its own exact-head review (finding 6).

## Necessary corrections vs optional refinements
Necessary before any implementation authorization: single shared classifier (3); standalone cleanup fencing fix (4); partial-listing refusal test + owner (5); queue snapshot/generation check specified against the actual `recheckQueueInterlock` code (6); instrumentation-first sequencing (7).
Optional: freeze-generation decoupling (8); shadow-mode rollout shape (fine as specified).

## Questions for Codex to defend
1. Why a new versioned snapshot namespace instead of adding `S` to the freeze record and reusing `classifyMainTip` at the three literal-equality gates? Enumerate which safety property the candidate/attestation lifecycle provides that (freeze+S, ancestor proof, existing digest bindings) lacks.
2. Which single classifier function (file + line) will every caller — maintenance auth, merge acquisition, queue final success, qualification, production acquire — import, and which of the three existing predicates does it supersede?
3. What does candidate activation do when `listRefs` for train generations returns partial data or errors? Which named test feeds it a truncated listing?
4. For "prose during production" (explicitly deferred): will prose heads be exempt from `revoke_frozen_authorizations`, and if so what replaces the freeze signal in `recheckQueueInterlock`, which does not read the freeze today?
5. What measured threshold (from the §8 instrumentation, not this one morning's sample) would make stage-one complexity worth it — e.g., N prose PRs causally refused per promotion, or review-retry cost exceeding implementation + review cost?
