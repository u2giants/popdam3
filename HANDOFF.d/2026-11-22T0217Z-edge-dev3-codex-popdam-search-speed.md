---
summary: Continue production PopDAM search timing and preserve the independent indexing evidence boundary.
kind: record
status: open
read-when: resuming the PopDAM three-second search target after artwork reconciliation
---

# PopDAM search speed continuation

## 0. Business decisions
None needed. Keep the existing three-second target at the 95th percentile, signed-in relevance and permissions intact, and normal shared workload running.

## 1. Application and ownership
PopDAM is the internal artwork library. Search is served by the PopDAM app and ranks candidates in the shared database. [Open performance issue #6871](https://github.com/popcre/shared-db/issues/6871) owns the speed work. Read its newest comments and verify ownership before taking work. This session did not own its database claim or author its migrations.

## 2. Goal
Find the remaining cause of slow production searches and verify at least 95 percent complete in under three seconds, with 137/137 expected cases passing and zero errors under normal shared load.

## 3. Delivered and verified
PopDAM #1037 artwork reconciliation corrected a legacy character assignment and two PopDAM catalog records using the source catalog. It preserved original item codes, the item master, and search mode. Signed-in search showed exactly eight clocks and the frame control passed. All three changed records were indexed with an empty queue and no errors. [Production reconciliation](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7018277179)

The timeout and ranking changes reached production. The latest completed test checked here passed 137/137 with zero errors, median 1.766 seconds and 95th percentile 5.760 seconds. [Post-release result](https://github.com/popcre/shared-db/issues/6871#issuecomment-7051089276) · [Latest scorecard](https://github.com/u2giants/popdam3/actions/runs/44967511540)

## 4. Attempts and evidence to exclude
Overlapping scorecards and releases distorted timing. Retain overlap windows as diagnostic only. An isolated run during heavy indexing passed 137/137 but measured 8.783 seconds at the 95th percentile. A targeted viewer check apportioned most of the slower requests to database search. [Earlier observations](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7020074188)

## 5. Current lead
Full database plans showed that the keyword leg read many file hits before discarding them on group-only requests. The corresponding fix [merged in #6937](https://github.com/popcre/shared-db/pull/6937). Its live release and a passing scorecard require verification. Six diagnostic comparisons kept identical results; the isolated ranking comparison went from 4.056 to 2.227 seconds. [Evidence](https://github.com/popcre/shared-db/issues/6871#issuecomment-7071829600)

## 6. Exact next actions
1. Check #6871 and #6937 for current ownership and confirm whether the automatic production release installed the exact fix. Coordinate with the active owner and reuse existing runs. Do not run evaluators concurrently or during a release.
2. With ordinary viewer credentials, repeat the clock and frame controls. Use [the scorecard guide](https://github.com/u2giants/popdam3/blob/main/docs/SEARCH_EVAL.md). Wait for the supported stable-release window, then verify the actual output on the same test set: 137/137, zero errors, and p95 under three seconds under normal shared load. Check release and evaluator overlap after the run.
3. If slow, localize the tail to database ranking, picture matching or other request stages on the same workload. Compare bounded measurements and exact ordered results and permissions before proposing a targeted fix. Preserve meaning-based search and indexing.

The independent model review of the latest artifact found combination searches at 3.460 s median and 7.048 s p95, character searches at 6.251 s p95, and code searches at 2.648 s p95. Pair slow combination and character requests with ranking and picture timings for the same request. Count searches under 3,000 ms directly. At least 131 of 137 must qualify.

## 7. Constraints
Keep licensed identifiers, raw judgments, credentials and screenshots private. Production schema releases use the shared database's automatic route. Leave the performance issue open until live proof. Review current claims before structural work.

## 8. Access
Use the production viewer test account and protected evaluation access described in [the 1Password guide](https://github.com/u2giants/popdam3/blob/main/docs/1password.md). See [worker guidance](https://github.com/u2giants/popdam3/blob/main/apps/image-embed-worker/README.md) for read-only indexing evidence.

## 9. Indexing and closeout
Albert confirmed #1037 is closed. [The closeout note](https://github.com/u2giants/popdam3/issues/1037#issuecomment-7039448653) records 11,801 writes in the prior 24 hours, zero pending or dead jobs and no alert. That receipt does not establish the separately requested uninterrupted window after the last observed restart. Look for a newer worker receipt, and record any verified continuity evidence on the existing issue without reopening it on the strength of this gap alone. Speed remains on #6871.

## Self-audit
1. Sections 1–3 and 8 identify the app, intended result, evidence and access.
2. Sections 4–6 preserve the unsuccessful comparisons, current lead and exact independent verification.
3. Sections 3 and 5–9 distinguish real deployment, test thresholds, production permissions, live timing and the separate indexing gap.
4. Sections 1–9 were checked for owner decisions. No new business rule, authorization request or open classification decision is required; section 0 records the existing target and constraints.
