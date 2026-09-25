# Workflow review-tier decision — 2026-09-20

Decision: **retain two independent reviewers**. This records the conservative
Step 13 policy disposition; it does not declare Step 12 or all Step 13 acceptance
complete and activates no reviewer-count change.

## Evidence and limits

The selected plan is [PR 3318](https://github.com/popcre/shared-db/pull/3318),
head `b5139f8618baca976f38068f59886a55d64e2caf`, Steps 13–14. Its default is two
reviewers unless sufficient comparable evidence justifies a narrowly bounded
alternative with explicit policy adoption.

The existing [historical baseline](orchestrator-throughput-phase-2-baseline-20260828.json)
contains six observed outcomes within 108 minutes on August 28. Only one explicitly
records production verification. This is not twenty comparable completed outcomes
per risk class. Passing these unmodified records into the legacy throughput
collector gives `INSUFFICIENT_SAMPLE`, n=0, because normalized estimate/completion
fields are absent. That result does not say the work never happened.

Unique confirmed reviewer-two defects, duplicate or false-positive findings,
replacement waiting, unchanged-implementation re-review and brief quality have no
normalized measured corpus in the inspected throughput baseline and blocker ledger.
Their rates are unknown, not zero. The blocker reporter currently has zero observed
resolved incident samples; its single ledger incident is estimated and unresolved.
A zero-defect sample would not establish zero risk even if one existed.

## Disposition

Review count has **not** been shown dispensable. Keep both independent slots and
all prior rejection/returned-slot history. Unknown, mixed, destructive, permission,
RLS, shared-function and unsupported changes remain under existing policy. No
assignment, merge, SQL classifier, production route or concurrency setting changes.

Remaining delay work belongs to brief quality, evidence reuse and replacement
behavior. Root integration owns Step 12 proof and final Step 13 acceptance. A later
proposal needs class-specific defect and latency evidence, deterministic coverage
of omitted-review risks, adversarial tests, and explicit policy adoption; it cannot
reclassify an existing refusal away.

Owner: Codex parent chat 01a0c04c-509a-7721-a6f1-4fc61f39a07e; measurement work is
[issue 3365](https://github.com/popcre/shared-db/issues/3365), non-orchestrator work.
