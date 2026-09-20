# Shared-db workflow bottleneck audit — 20 September 2026

## Recommendation

Refactor coordination before removing database safeguards. The workflow creates dependencies between unrelated changes, makes tasks overwrite shared evidence files, and leaves completed prerequisites looking unresolved. These are concrete sources of delay. Removing target checks, collision protection or production verification would not repair them.

Move toward a durable delivery pipeline that advances eligible work automatically. The orchestrator should handle genuine conflicts and decisions; it should not have to keep a conversation alive to shepherd each routine transition. Reuse the existing scheduling, evidence reuse and automatic promotion machinery rather than building a second system.

This audit changes no workflow, database, issue or repository setting. The findings below distinguish confirmed mechanisms from policy proposals. Source inspected: commit `57269b19416ccca6c20a0053ed05e397b1bd0e19`. Live GitHub observations were collected around 15:00 UTC on 20 September; the queue continues to change.

## What the live evidence says

- The issue snapshot contains 124 open issues: 75 declare repository maintenance, 29 structural work and 6 curated master data; the remaining 14 have other or absent classifications. These are declared categories, not independently re-admitted scopes. Do not describe all 124 as the structural orchestrator queue.
- 68 issues are older than seven days; 27 older than fourteen days; two older than thirty days. These are nested age thresholds, and issue age is not a measure of time spent blocked.
- There are 16 open pull requests in the snapshot. The twelve latest guarded-merge attempts split six successes and six failures. This small recent sample is diagnostic, not a historical failure rate.
- Current branch protection has 13 required contexts, with strict branch freshness disabled. No rulesets were returned. The native merge-queue implementation is still an open pull request; the transfer plan marks queue activation and acceptance proof unfinished.
- The observed issues include stale completion bookkeeping as well as real technical blockage. Maintenance issues [3245](https://github.com/popcre/shared-db/issues/3245), [3235](https://github.com/popcre/shared-db/issues/3235), [3229](https://github.com/popcre/shared-db/issues/3229) and [3222](https://github.com/popcre/shared-db/issues/3222) are all **non-orchestrator work** and remain open. Their associated pull requests 3246, 3236, 3231 and 3220 merged on September 17–18. The parent [3179](https://github.com/popcre/shared-db/issues/3179), **non-orchestrator source-data work**, closed September 19 after recorded live acceptance. This is a candidate for evidence reconciliation, not permission to close four issues merely because their code merged.

## Ranked findings

### 1. HIGH — Shared preview manufactures cross-application dependencies

**Confidence: high for mechanism; total delay share unmeasured.**

`scripts/orchestrator-flow/preview-graph.mjs:14-15` adds an edge from every preview-only migration to every later, unapplied migration. The edge is based on version ordering, not whether the changes touch related objects. `scripts/orchestrator-flow/select-preview-route.mjs:107` then returns `WAITING` for those edges.

A local, read-only synthetic test confirmed that an older preview-only version blocks a later claimed version without any object relationship being supplied. Thus one unfinished preview change can hold unrelated application work.

**Refactor:** make isolated rehearsal a first-class route for explicitly supported low-risk changes. A route already exists in the production risk machinery, but ordinary automatic promotion still depends on shared preview (`shared-supabase-migrations.yml:1004-1008`; `production_business_risk_gate.py:3255`). Use shared preview for changes needing shared-data or integration proof. Measure isolated-environment cost and baseline fidelity before expanding eligibility.

**Do not simply delete the edges.** They protect consistency with the current shared migration ledger. Isolation must include the needed baseline, dependencies, roles and relevant data behavior, followed by fresh production checks. Unknown dependencies stay on the conservative route.

### 2. HIGH — Unrelated tasks overwrite the same proof documents

**Confidence: high; directly observed failures.**

`.github/workflows/agent-work-contract.yml:86-87` fixes every task's evidence at `.agent/contract.json` and `.agent/completion.json`. `scripts/check-main-tip-freshness.mjs:257-258,294-296` requires a conflict-free merge including these files. Excluding them from the implementation digest does not remove their Git conflicts.

Two live failures explicitly named those evidence files among unrelated changes and refused because updating from main conflicted: [September 19 run](https://github.com/popcre/shared-db/actions/runs/35408114960) and [September 18 run](https://github.com/popcre/shared-db/actions/runs/35398598421).

**Refactor:** store immutable evidence per task/attempt, with an explicit binding to that task and reviewed content. Update the validators, live-proof reader and evidence classifiers together. Retain the existing content-equivalence rules so unrelated evidence changes do not trigger fresh substantive review.

**Preserve:** proof belongs to the right task and exact implementation. Never resolve this with an automatic “keep ours” merge rule; it could silently attach the wrong evidence.

### 3. HIGH — Serial queues cover more work than the protected operation

**Confidence: high for code behavior; contention duration unmeasured.**

`.github/workflows/shared-supabase-migrations.yml:121-127` puts all non-PR dispatches, for both preview and production, into one concurrency group. `.github/workflows/guarded-migration-merge.yml:25-27` serializes the entire merge workflow, including preflight; line 108 permits a 900-second API quota wait there.

**Refactor:** run qualification and quota recovery before entering the narrow serialized section. Use separate target queues for preview and production, while retaining the explicit coordination needed between merges and production. In the protected section, revalidate the small set of facts that can change: head, claims, target, required results and mutation ownership.

**Preserve:** one writer per shared target and the actual merge/production interlock. Separate queues are not permission for conflicting writes. Revalidate cross-lane invariants before adopting this change.

### 4. HIGH — Completion and dependency state do not reliably follow delivery

**Confidence: high for stale issue states; whether each issue can close requires its own acceptance check.**

The four maintenance issues above remain open after their implementation merged and the parent outcome was accepted. Dependency watchers and humans can therefore continue treating already-delivered work as an active blocker. Some work is genuinely pending; a large open count alone cannot distinguish it.

**Refactor:** reconcile each issue against implementation, production application where relevant, and its stated acceptance evidence. Close only when all three match. Classify dependency edges explicitly: technical prerequisite, shared resource wait, evidence repair, or follow-up improvement. A follow-up improvement must not block an already-safe delivery unless a concrete acceptance condition requires it.

Use a durable owner per issue and event-driven resume. Existing automatic-resume work is recorded complete in the throughput plan; investigate its coverage and actual execution rather than commission another watcher. Keep feature acceptance truthful: do not mark an application delivered merely because schema merged.

### 5. MEDIUM — Unreadable protection settings turn extra checks into blockers

**Confidence: high for mechanism and configuration drift; no measured total delay attribution.**

`scripts/check-required-checks-preflight.mjs:157-165` uses the committed required-check mirror when live settings cannot be read, then requires every other reported check to succeed, except a narrow advisory list. The mirror has 12 contexts and a September 8 capture date; the live list has 13, including the queue-sensitive aggregate.

[A recent failed run](https://github.com/popcre/shared-db/actions/runs/35409129037) confirms the workflow gets HTTP 403 reading protection and uses the mirror. That particular refusal also had a genuinely required failed check: it is not evidence that an optional check alone caused that failure.

**Refactor:** synchronize the authoritative required-check manifest through the settings owner, or provide a supported narrowly scoped read mechanism. Classify required and advisory checks explicitly. Preserve refusal when the required set cannot be established; do not solve this by silently trusting a stale list.

### 6. MEDIUM — Current instructions contradict the implemented policy

**Confidence: high.**

Examples in `docs/agents/section-4-anti-collision-rules.md`:

- Lines 424–429 allow one provider to run concurrent reviews; lines 643–646 say a reviewer leased elsewhere is not independent.
- Lines 750–754 say automatic production-risk activation remains inactive; `config/production-risk-policy-activation.json:2` says `active: true`.
- Lines 873–882 broadly require the guarded route for documents; `AGENTS.md:1756-1762` describes its lighter route.

Completed throughput plans still say to restart at step one. The transfer plan marks steps zero through six done but still says fresh work starts at step zero.

**Refactor:** one short current procedure, checked against policy configuration, with old incidents and superseded instructions in clearly historical material. Keep incident evidence; remove its authority as current instructions. These contradictions can recreate approvals and capacity waits already removed. Their precise contribution to elapsed delay is not measured here.

### 7. HIGH — Live-proof defects are discovered after production application

**Confidence: high for the observed chain; wider frequency unmeasured.**

[2611](https://github.com/popcre/shared-db/issues/2611), **orchestrator work**, applied September 17 but its verification lacked function permission. That led to [3191](https://github.com/popcre/shared-db/issues/3191), **orchestrator permission work**. The permission was applied September 20, then the original verification timed out. [3299](https://github.com/popcre/shared-db/issues/3299), **non-orchestrator proof recovery**, now owns the query repair. The [recorded diagnostic](https://github.com/popcre/shared-db/issues/2611#issuecomment-5746537149) says an equivalent bounded query returned `passed=true` in 0.5 seconds under the actual read-only production role. This is recorded session evidence; this audit did not execute that query.

**Refactor:** qualify the complete acceptance probe before promotion: actual verification role, required permissions, realistic data volume, query plan and execution budget. Ship the probe alongside the change. A syntax-only proof check is insufficient. Retain post-apply live verification; qualifying it earlier prevents foreseeable repair chains rather than suppressing failure.

## Which safeguards should change?

**Remove accidental duplication:** shared task-evidence collisions, obsolete approval instructions, repeated manual routing and closure paperwork, universal serialization of preparation, and treating every reported check as required when its status is actually advisory.

**Make proportionate, after measurement:** two independent reviews are mandatory for every migration (`scripts/check-exact-head-approval.mjs:229-241`), including narrowly additive self-service changes. Test a tightly defined low-risk class with one independent reviewer plus deterministic checks. Keep two for permission changes, destructive operations, shared-function changes and difficult recovery. Record which defects the second reviewer uniquely catches before changing the policy. This audit does not establish that the second review is useless.

**Use the lighter route already available:** additive work entirely in `crm`, `pim` or `dam` can bypass central orchestrator triage while retaining claims, review and guarded delivery (`AGENTS.md:359-369`). Make eligible routing automatic and visible. Do not assume everything in `plm`, `api` or `core` is similarly independent.

**Keep:** target identity proof, immutable migration versions, exact-object collision protection, independent review of the actual change, tested dependency closure, permission/destructive-change checks, bounded production allowlists, exclusive mutation locks and live outcome verification. These protect distinct failure modes.

## Recommended order

1. **Reconcile the queue and repair current instructions.** Identify genuinely open acceptance conditions, close proven-complete work, assign real blockers, and activate the existing resume behavior where it is failing. This improves truth and avoids wasting effort on already-delivered work.
2. **Remove shared evidence-file collisions.** This has direct live failure evidence and does not require weakening any database rule.
   In parallel, qualify acceptance probes before production application so permission and timeout failures do not create another chain after delivery.
3. **Finish and prove the existing merge-queue work.** Do not start another competing queue project. Native ordering can reduce merge races, but it will not by itself fix contaminated preview or evidence collisions. The existing implementation [PR 3279](https://github.com/popcre/shared-db/pull/3279) is repository maintenance, **non-orchestrator work**.
4. **Narrow serialized sections and separate target queues.** Prove all current safety refusals still work and independent ready work can advance.
5. **Make isolated rehearsal the supported default for a proven low-risk class.** Expand only after comparison with the shared integration route demonstrates sufficient coverage.
6. **Evaluate risk-tiered reviewer counts last.** Measure defect yield first; review reduction is a policy proposal, not the most strongly evidenced first fix.

Each refactor should own one independently provable outcome. Do not turn this audit into a six-step mandatory prerequisite chain before any application can ship. Land independent improvements independently; preserve the old safe route until each replacement is proven.

## How to know the refactor worked

Track time from ready-for-work to verified application outcome, median and 90th percentile; active work versus waiting by cause; review restarts with unchanged implementation; conflicts caused only by evidence files; age of ready work; and completed-but-open issues. Count technical dependency depth separately from administrative follow-ups. Use a before/after observation period and compare similar change classes.

Initial acceptance targets: no conflict caused solely by another task's evidence; no re-review solely for irrelevant bookkeeping; completed prerequisites reconciled automatically after acceptance; every wait names a real dependency or occupied resource; and no unrelated preparation holds a mutation queue. No promised percentage or deadline is justified until these timings are measured.

## Scope and verification limits

Three independent read-only passes covered procedure, executable pipeline and live queue. High-priority mechanisms were checked against source; shared-preview edge behavior was reproduced locally; example issue/PR states and failed action logs were independently checked. No database query, migration, deployment, paid external review, issue mutation or settings change was performed. This is a completed diagnostic report, not an implemented workflow refactor.
