# #469 heavy live-proof pass — 2026-11-15 (build `ce4d1a3`)

Three remaining heavy items from the audit checklist. Evidence in this folder;
production access via the admin tester session and admin-api (task gate class
`production`, allowed by owner authorization — verbatim text in
`backfill-run-log.json`). No NAS fixtures touched, no schema/credential/permission
changes, no scan triggered.

## 1. Tesseract workers terminate in `finally` — **proven**

The repo's own OCR backfill job was triggered and observed end to end
(`trigger-pdf-backfill` → heartbeat → `windows-render-agent` `runPdfBackfill`):
**619/619 files, 6:52–6:57 PM EST**, normal terminal state (`idle`), agent healthy
throughout. Run outcome: 608 `pdf_text` (embedded-text fast path), 9 `failed`
(all pre-OCR `ENOENT` at file stat — source files no longer on the NAS), 2
`skipped`. **Zero OCR workers were created and zero survived the run** —
`ocr_engine` is null on every output row.

Code path + failure evidence (the audit's "even on failure"):

- All four OCR sites carry the #713 fix verbatim
  `await worker.recognize(pngBuffer).finally(() => worker.terminate())`
  (`apps/bridge-agent/src/pdf-backfill.ts:154`,
  `apps/bridge-agent/src/pdf-text-sampler.ts:267`,
  `apps/windows-agent/src/pdf-backfill.ts:186`,
  `apps/windows-agent/src/pdf-text-sampler.ts:249`); the old two-statement order
  (terminate skipped when recognize rejects) is gone from all four.
- `tesseract-finally-sim.mjs` executes the **verbatim fix statement from each
  site** against a mock worker whose `recognize()` rejects: `terminate()` runs
  exactly once on rejection at every site (the success path too), while a
  pre-#713 statement-order control leaks (terminate zero times). 12/12 PASS —
  `sim-tesseract-finally.txt`.
- Deployed builds carry the fix: bridge `487af886` and windows `ad999066` both
  contain fix commit `2287f1b5` (`git merge-base --is-ancestor`).

Scope note: the live run took the embedded-text fast path for 608/619 files, so
the OCR branch (Indra first, tesseract.js fallback) never engaged;
`ocr_indra.state=ready` on the windows agent. Routing OCR to the bridge
(`force_bridge`) was deliberately not used — the repo keeps Tesseract off the
Synology NAS because it spikes CPU there (agent-api compat-audit comment), and
tonight's fixture checks depend on that host.

## 2. Batch loop cap (10,000 iterations) — **proven (smallest scope, documented)**

A real bulk run that would exceed the cap is huge/destructive on production data
(≈5M requeued render-error rows for the PopSG loops; purging millions of assets
for the two purge loops), so the smallest scope that proves the cap was used:

- `batch-loop-cap-sim.mjs` extracts the **four real loop bodies verbatim** from
  `PopSGSettingsPage.tsx` (×2), `ScanAndOutputSettings.tsx` and
  `ActionsSection.tsx` and runs each against a never-completing batch call:
  every loop stops at **exactly 10,000** iterations with
  `Stopped after too many batches; run it again to continue.` A completion
  control per loop (stops after 3 batches) proves the cap does not fire early.
  8/8 PASS — `sim-batch-loop-cap.txt`.
- Deployed production bundles (fetched from sg.designflow.app, 74 chunks
  searched) contain **all four cap checks**, minified cap constants all `1e4`
  (10,000), exact message — `/assets/PopSGSettingsPage-CndcbEBH.js` (2),
  `/assets/SettingsPage-1q-RZ_PK.js` (2). `deployed-bundle-pin.json`.
- Deployed build `ce4d1a3` ancestry contains fix commit `2287f1b5`.

## 3. `ensureRootMarkers` hourly backoff — **proven at closest safe level**

Proving this live requires pointing a root at a read-only share — an SMB/share
permission change (infrastructure), which was **not** made. Closest safe level:

- `root-marker-backoff-sim.mjs` runs the **real `ensureRootMarkers` + backoff
  constants extracted verbatim** from `apps/bridge-agent/src/index.ts` against
  controlled fs/docker/clock stubs (6 scenarios PASS —
  `sim-root-marker-backoff.txt`):
  - first direct-write + Docker-fallback failure sets `markerDockerRetryAfter`
    to `now + 3,600,000 ms` (the `MARKER_DOCKER_RETRY_MS = 60 * 60 * 1000`
    constant);
  - the next heartbeats **inside** the hour report
    `error: "docker_write_backoff"` and spawn **zero** Docker containers
    (pre-#713 code started one every 30 s forever);
  - **exactly one** Docker retry after the hour;
  - a later success clears the backoff; a direct-write control spawns none.
- Source pins + deployed bridge build `487af886` contains fix commit `2287f1b5`.
- Live state observed read-only: `synology-bridge-1`
  `marker_statuses: {"Decor": {"ok": true, "method": "exists"}}` — healthy root,
  no failure condition exists in production to observe.

**Remains for live proof:** a root actually write-failing (read-only share) so
the deployed bridge logs the Docker-fallback failure and then
`docker_write_backoff` with at most hourly retries. Creating that condition
requires an infrastructure permission change — not authorized here.

## Disclosed production writes

- `PDF_BACKFILL` admin_config replaced by the standard trigger (pre-image in
  `backfill-run-log.json`; prior `indra_rescan` record captured there; its 693
  remaining stay data-derived and claimable).
- 608 + 9 + 2 `pdf_text_samples` rows from the backfill run (the job's normal
  output). 0 `sku_files_used` rows added.

## Not touched

Tonight's `_ai_test_681/` NAS fixtures (`#469probe.psd`, `$469probe.psd`,
`@469probe.psd`, `469probe-big.ai`, `#469probe-skip/inner.psd`) owned by the
6:55 PM / 8:33 PM EST scheduled checks. No scans, no SMB/permission changes, no
schema or credential changes.
