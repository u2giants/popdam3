---
issue: 4039
status: OPEN
owner: codex/investigate-narrow-promotion-freezes
---

# Narrow promotion-freeze investigation successor

October 7, 2026, 11:45 AM EDT. Owner Codex chat 01a11700-4dab-7443-8e0a-7146957b2cd9 on edge-dev3. [Issue #4039](https://github.com/popcre/shared-db/issues/4039).

## Goal and authority

Albert's task: "perform this task: /tmp/investigate-narrow-promotion-freezes.md". Investigation/design only, expressly no implementation/deployment, no production mutation, no ownership transfer. Complete the investigation; do not inherit any one-child stop instruction. No business question is open.

## Read first

[Report](../docs/investigations/narrow-promotion-freezes.md) carries source map, alternatives, races, ordering/drift, actual timing limits and review gap. [Plan](../plan_narrow_promotion_freezes.md) carries STATUS, 13-section implementation specification and named adversarial gates. Re-read STATUS before acting. Baseline fee69a25ffd9b39c2b3accfde680dfbac3aa54f5 was freshly verified. Dedicated worktree /home/ahazan/.codex/worktrees/509a/shared-db; do not edit predecessor 77d7.

## Completed versus unproved

Existing source and live GitHub records inspected; 74 existing classifier/exclusive-policy tests passed. Proposed minimum: ordinary inert prose may advance a fixed approved snapshot during review; all source merges remain paused during exclusive production ownership. Generic disjoint SQL admission is not proved or approved. Current production-inert freshness allowance is contradicted by other literal equality gates. Same-PR cleanup needs generation/ref fencing.

No safeguards changed, no SQL written, no foreign freeze/mutex released, no production launched. Independent design review is complete: allocator sequence 5638 Gemini APPROVE on 610e80cd3bc0ec523a794ec59db11699318cf31f, durable verdict commit 6bf4f63a2b6d1306c44e071fde74faf826fc96dc. Report §9 retains provenance; two earlier supplemental REJECT critiques remain verbatim and their material objections were addressed. This is design approval only. Validation: 74 freshness/exclusive-policy tests, seven freeze tests, 29 queue/dispatch tests and SQL static checks passed.

## Owner-requested Muse debate and current continuation

Albert's subsequent request: "run the report and implementation plan past Muse and debate it out with Muse. give Muse all the relevant background and context about promotions freezes blocking a lot of work". Three actual persistent Muse turns completed in session narrow-freeze-4039-debate (provider 118a4be5-506d-434b-948d-fccacbcd9ca2). Full source-only reports and correction ledger linked from report. Original feature-first proposal is superseded: Muse concurs with evidence-first gated sequence, not feature implementation readiness. Retain original Gemini exact-source verdict as history only; no re-labelled allocator approval for new design.

Upstream d241515e refreshed/merged into own worktree; new upstream SQL belongs to #4033, not this documentation diff. Later live refs showed no advertised promotion-freeze/production/author mutex; prior blocked publication is historical. No foreign ref released. Recheck before ordinary merge; current authorization may change. Own PR #4040 / issue #4039 remain the card.

Next exact action: finalize Muse review of written revisions in the same named conversation; retain wrapper terminal proof and record outcome without manufacturing a formal assignment. Validate complete prose diff/links; task-gate ship; commit/push only owned docs; normal document authorization/merge queue. Update #4039 investigation checklist and leave future code/live-proof gates OPEN/NOT AUTHORIZED. This workstream owns publication. Do not end while unblocked publication is undone.

## Future implementation: not started and not authorized

Plan §§9.0–9.4 define observations/binding audit and separate cleanup proposal; gate benefit BEFORE feature building; conditional reuse of existing strict classifier/run context/freeze schema; complete callers, two-sided train mutex and completeness/load tests; reviewed rollout/canary/original application acceptance. Existing global freeze stays default. Two promotions/14 days is future observation bound, not scheduler or authority to launch anything. Missing evidence holds feature. Future successor must register on #4039 and reconcile Step 10/coordination-IO scope before writes. Existing application acceptance remains with its original owner.

## Access and validation

ai-gh/task gates/Node/Python3 available; no credentials required. Ephemeral raw captures /tmp/narrow-freeze-evidence are not successor authority. Re-run repository freshness/in-flight and relevant gates; current source/live records outrank this handoff. Existing SQL guard/document classifier checks passed before publication. Supplemental second REJECT on 85fb7a16 found only omitted migration trains; revised scope excludes them and requires serialized train/candidate mutual exclusion. Original verdict and subsequent debate are retained; current publication state must be verified live. Times EDT/EST; sign GitHub posts with actual chat id and host.

## Completion and retirement

Success means independently reviewed investigation and durable protected publication. Any later implementation additionally requires every plan gate and original live acceptance. Retire this file only when tracked work actually completes; do not mark DONE or rewrite shared HANDOFF.md. This record preserves exact state without changing another session's notes.
