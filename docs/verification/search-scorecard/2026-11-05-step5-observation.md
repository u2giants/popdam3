# Search scorecard observation — November 5, 2026

Status: live acceptance remains open on PopDAM #725, #680 and #706.

The original 119-case set and a separate frozen 21-case supplement were run serially as the ordinary viewer. No historical pre-ranking baseline is available. The original observation ran 6:58:04–7:55:37 AM EST; the supplement finished at 8:06:56 AM EST. Natural tagging continued. A separate database rollout committed at 7:31:09 AM EST, so comparisons are observational and cannot isolate the application repair as the sole cause.

## Preliminary BEFORE observations

These counts use the saved initial judgments. Errors, latency failures and unjudged hits remain explicit; they are not clean relevance acceptance. Final before/after scoring must use the same unified judgments for both runs.

- Original dam: 96/119 preliminary passes, 13 errors, p50 15.392s, p95 45.001s, unjudged share 0.040.
- Original sg_guides: 44/65 preliminary passes, 4 errors, p50 9.924s, p95 31.175s, unjudged share 0.002.
- Original sg_files: 53/65 preliminary passes, 1 errors, p50 6.522s, p95 31.394s, unjudged share 0.045.
- Supplement dam: 12/21 preliminary passes, 5 errors, p50 34.187s, p95 45.002s, unjudged share 0.425.
- Supplement sg_guides: 3/3 preliminary passes, 0 errors, p50 10.641s, p95 12.976s, unjudged share 0.000.
- Supplement sg_files: 3/3 preliminary passes, 0 errors, p50 10.867s, p95 11.313s, unjudged share 0.000.

## Repair and live readiness

[PR #794](https://github.com/u2giants/popdam3/pull/794) merged at 8:15:02 AM EST, source fc88ef0bcc2326fc10f975a0b2cdc17772a74f6e. Deployed search version 38 contains all 14 expected source files with matching SHA-256 hashes. The first ordinary-viewer readiness attempt failed during authentication at its existing 30-second limit, checked 8:21:08 AM EST. No search or AFTER evaluation followed. The [native deployment](https://github.com/u2giants/popdam3/actions/runs/42034105299) completed its function deployment step, then FAILED generating types: `failed to get typescript types: request timed out` at 8:22:55 AM EST. Do not describe the workflow as successful or blindly rerun it during the shared-backend incident.

## Unresolved acceptance

Canonical spelling, known-code search, normal semantic results and visible unavailable/Retry recovery still need ordinary-user proof. Both identical AFTER partitions remain unstarted. Unknown-code picture policy remains open: the proposed complete-format catalog probe timed out at its existing 1,000ms statement budget on a full miss and was withheld. Deployed code/picture classification was preserved. No tagging control, credential, canonical evaluation set or database structure was changed.

## Artifact integrity

Private raw results, case manifests, checkpoints and initial reports remain protected; no licensed names, paths or result identities are published here.
- vb-before-report.json: SHA-256 31871ce670aa552d0b7f567bc6cddaf3fbdafe1165dadb5ffd9b5cb822178818
- vb-before-raw.json: SHA-256 3e4f5696e767e575f98073a9c2abd60215b2e443d5d5744d8e1b1ca6b36c59df
- vb-supplement-before-report.json: SHA-256 011b1b4c4fba68e88d7b0a895b2aec89e1b2811e2846605d93fb87b0c156e011
- vb-supplement-before-raw.json: SHA-256 c73f77b56a714be7ae5003b96db252ad8fab48665e944b8e91c34171a719d05f
- vb-supplement-cases.json: SHA-256 847c8dc447b1f83ffb7e574305981cadf907088c3d1178f099b932f31e5848a9

Continuation: [#725 live-proof hold](https://github.com/u2giants/popdam3/issues/725#issuecomment-6659069720), [#680 observation](https://github.com/u2giants/popdam3/issues/680#issuecomment-6658877346), [#706 observation](https://github.com/u2giants/popdam3/issues/706#issuecomment-6658877738).
