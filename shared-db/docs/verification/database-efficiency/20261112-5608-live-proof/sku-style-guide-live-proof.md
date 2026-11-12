---
summary: "Issue 5608 live proof: four consecutive tagged nightly successes under 60 s; committed probe passed via the Shared DB Live Proof workflow"
kind: proof
status: done
read-when: checking 5608 three-night acceptance, nightly run timings, or the live-proof artifact identity
---

# #5608: live proof — three consecutive tagged nightly successes

The nightly SKU-to-style-guide resolver met the issue's live assertion on
production. The committed probe `.github/live-proofs/5608.sql` returned
`passed = true` through the supported read-only route. This completes the
three-night acceptance bar with one extra passing night.

## Nightly runs (production, job 17 `resolve-sku-style-guide-links-nightly`)

Every run below carries the exact v4 command
`call public.resolve_sku_style_guide_links_run() /* shared-db:20261106171924 */`
and status `succeeded`. Times are America/New_York (EST); UTC dates are what the
probe counts as distinct nights.

| UTC date | started (EST) | duration | role in proof |
|---|---|---|---|
| 2026-11-08 | 2026-11-07 23:30:00 | 26.087692 s | streak night 1 (recorded 2026-11-08) |
| 2026-11-09 | 2026-11-08 23:30:00 | 20.312699 s | streak night 2 |
| 2026-11-10 | 2026-11-09 23:30:00 | 27.516373 s | streak night 3 |
| 2026-11-11 | 2026-11-10 23:30:00 | 23.047747 s | streak night 4 (spare) |

The probe's "latest three ALL runs" window is therefore 2026-11-09..2026-11-11
UTC: three distinct consecutive dates, each tagged, each succeeded, each well
under 60 s. Preceding runs (2026-11-05 and earlier) are the retained historical
120 s failures of the old untagged command and are not part of the window.
Job row 17: active, owned by `postgres`, schedule `30 4 * * *`, exact tagged
command. No `sku-style-guide-links-catchup-5608` job remains (catch-up
self-removed as designed).

## Durable acceptance artifact

- Shared DB Live Proof workflow run
  [43147565616](https://github.com/popcre/shared-db/actions/runs/43147565616)
  (`workflow_dispatch`, `work_issue=5608`) on main
  `131c015a0f0adf33408e1a96d3fcde07ebd9b7a1`, job `prove` conclusion `success`,
  step "Run the committed probe read-only against production" `success`,
  observed 2026-11-12 03:20:50 UTC (2026-11-11 10:20:50 PM EST).
- Artifact `shared-db-live-proof-5608-131c015a0f0adf33408e1a96d3fcde07ebd9b7a1`,
  ID **13911503678**, digest
  `sha256:c0a6dbde0470a06440139d442f632f8bf497885e1380263049bba27b966dbd4b`.
  Contents of `db-live-proof.json`: `work_issue` 5608,
  `application_commit_sha` `131c015a0f0adf33408e1a96d3fcde07ebd9b7a1`,
  `environment` `production`, `result` **passed**, `observed_at`
  `2026-11-12T03:20:50Z`, and the issue's verbatim `live_assertion`.

The probe was also executed once directly (read-only Management API, before
dispatch) and returned `[{ "passed": true }]`; the workflow artifact above is
the authoritative acceptance record.

## What this does and does not claim

Claims: the committed probe passed on production against the three genuine
consecutive source-tagged scheduled nights; runtime stayed far under the 60 s
budget (20–27 s); the tagged job identity, schedule and active state are
unchanged; catch-up completed and self-removed; resolver progress carries
`v4:` portal hashes with active link sets.

Does not claim: any new migration, schema change, or production write (none was
made); anything about the separate PopSG matview refresh jobs; preview state.

Posted by MiMo chat unknown on edge-dev
