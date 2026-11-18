---
summary: Recovery of the 2026-11-15 8:33 PM EST scheduled checks for #229 ordinary ingest and #469 fixture/chip/rich-pdf observations, run 2026-11-18.
kind: verification-record
status: current
read-when: closing or resuming #229 ordinary-ingest or #469 live-proof checkboxes
---

# Recovery checks for the missed 2026-11-15 scheduled run — 2026-11-18

The one-shot checks scheduled for Friday 2026-11-15 8:33 PM EST never ran (the
scheduled prompts left no output). This record recovers them on Wednesday
2026-11-18 (~11:20 AM–12:00 PM EST) from three days of production state, under a
scoped parent-agent delegation. Task gate: `ai-task-gates start --class
production`; `check --before production --acknowledge` and `check --before
database --acknowledge` before each write class (acknowledge text = this scoped
delegation; each gate returned "allowed by owner authorization"). No scan was
triggered. No schema or credential changes. No real design files touched.

Reads: admin-api (`list-agents`, `run-query` SELECT-only) with
`SUPABASE_SECRET_KEY` from 1Password via op_run env injection only; DeepSeek
health via one benign `deepseek-chat` completion; NAS state over SSH alias
`edgesynology1` (read-only listing before the removals).

## 1. #229 ordinary-ingest box — ingest proven, "0 errors" not confirmable

Bridge `synology-bridge-1`, build `487af886` (PR #991 merge), has run auto-scans
since the 2026-11-15 ~6:38 PM EST pass.

**Restored copy ingested — proven.** `XA12SP_PACKAGING (restored 2026-09-30).ai`
exists as its own asset `416586df-eba9-4488-9824-a8b91b86e11d`, created
2026-11-15 9:35:08 PM EST (during the first full pass on build `487af886`),
`file_size` 2,438,951 (the snapshot version's exact size), Spaces thumbnail
present, `thumbnail_error` null.

**Bridge health (read 2026-11-18 11:20–11:21 AM EST):** online, version 1.16.26,
build_sha `487af8868596694a96c2d2e5ac7818569ea8d6d2`, `last_error` empty, marker
`Decor: ok`, `scan_roots_readable: true`, `mount_root_exists: true`.

**Counters (running pass, session `9aee7246-7e33-4fcb-95e2-bd6b774193c5`,
ingest phase since 2026-11-17 11:32 PM EST):** files_checked 164,338;
files_total_encountered 434,713; candidates_found 164,338; updated_existing
13,869 (climbing); ingested_new 0; moved_detected 0; **errors 17**;
roots_invalid 0; roots_unreadable 0; files_stat_failed 0;
dirs_skipped_excluded 52,464; dirs_skipped_permission 0; rejected_wrong_type
228,971; rejected_junk_file 27,277; skipped_before_min_date 3,226;
rejected_ai_has_pdf_sibling 14,180; unresolved_licensor 2,130;
unresolved_property 2,130.

**Why "0 errors" is not confirmable:** `counter_history` retains only the last
60 heartbeat entries (~30 minutes at cadence), and `SCAN_PROGRESS` is a single
row overwritten by the running pass — there is no per-scan history table. The
Nov 15–17 completed-pass counter snapshots have aged out. The retained window
shows `errors: 17` in the current pass (per-file processing exceptions;
`processing_queue` has 0 failed rows since 2026-11-15; the per-file causes are
not retained on any readable surface — docker log inspection on the NAS is
blocked by the documented privileged-credential mismatch, `sudo` requires a
password).

**Verdict posted on #229:** ingest processes normally post-deploy and the
restored copy is ingested (box half satisfied); the literal "0 errors" counter
confirmation is not recoverable and the live counter shows 17, so the box stays
unchecked and #229 stays open on that item only.

## 2. #469 fixture observations — both probes observed clean (boxes ticked)

All observations are from the 2026-11-15 ~6:38 PM EST auto-scan on bridge build
`487af886` (fixtures placed 5:25 PM EST that evening per
`verification/469-fixtures/live-proof-2026-11-15.md`).

**Probe 1 (ingest filename gate) — clean.** Three probe files ingested as their
own `assets` rows at 9:36 PM EST 2026-11-15:

| File | asset id | created (EST) | size |
|---|---|---|---|
| `a/#469probe.psd` | `4823df3f-7ffd-46bc-8aaf-1be0c8dcf9a8` | 21:36:23.45 | 75 |
| `a/$469probe.psd` | `3899f321-5b0f-48d2-9b01-c9c8b43f7328` | 21:36:23.72 | 75 |
| `a/@469probe.psd` | `b0b1029b-217e-461d-ba71-f72d602a123f` | 21:36:24.71 | 75 |

Negative control `#469probe-skip/inner.psd`: **no asset row** (folder pruned by
`shouldSkipFolder`). Relative paths match
`Decor/Generic Decor/Unused/_ai_test_681/…`.

**Probe 2 (`.ai` sentinel 16 MiB cap) — clean.** `a/469probe-big.ai`
(16,999,996 bytes > 16,777,216) ingested as its own asset
`37fc028f-eb48-4d73-aefe-49d9d5a2f0a5`, created 21:36:24.70 PM EST, file_size
16,999,996. `scanner_ai_ignores` has **0 rows** for any `*469probe*` path — the
over-cap read was refused before mupdf, so the text filler was never classified
as a `no_pdf_compat` sentinel. `thumbnail_error = "deferred_to_windows_agent"`,
`thumbnail_url` null — consistent with the capped path refusing the 17 MB
buffer. Bridge healthy throughout (live read 2026-11-18).

## 3. #469 `skipped_before_min_date` chip — counters recovered, UI read deferred

`SCAN_PROGRESS` (running session, read 2026-11-18 11:21 AM EST) persists
`skipped_before_min_date: 3,226`; `parseCounters` (`src/hooks/useAgentStatus.ts`)
carries it through to the "too old" chip
(`LibraryTopBar.tsx:946`). The box's exact target is one admin **UI** chip read
during a live scan that skips pre-min-date files. Today's ~6:38 PM EST auto-scan
is outside this session's window (7 hours ahead), so the UI chip read stays with
the next scan; box left unchecked.

## 4. #469 rich-pdf retry leg — NOT proven; provider healthy, worker key invalid

- **Provider healthy.** 2026-11-18 ~11:35 AM EST: one benign `deepseek-chat`
  completion against `https://api.deepseek.com/chat/completions` returned HTTP
  200 (`deepseek-flash` alias, reply "OK"). The Nov 15 "total provider outage"
  did not reproduce.
- **Retry attempt failed on auth.** `rich-pdf-extract` set `status=running`,
  cursor 0 at 11:36:31 AM EST (the recorded observation step). Worker picked up
  within 5s and auto-stopped at 11:36:54 AM EST with the same signature as Nov
  15: `Auto-stopped: Failure rate 84% (90 failed out of 107 processed)`,
  `interruption_reason_code: repeated_failure`, `scanned 200 / skipped 17 /
  processed 0 / failed 90`.
- **Root cause (from persisted failure rows): `HTTP 401: Authentication Fails,
  Your api key: ****80f9 is invalid`** (`authentication_error`) on every
  attempted extraction. The Railway worker's `DEEPSEEK_API_KEY` is invalid. The
  identical Nov 15 signature is explained by the same 401 — Friday's
  "provider-side" diagnosis was wrong. Related finding: the documented 1Password
  home (item `ai provider api keys openai deepseek chatgpt qwen`, field
  `deepseek`) is **empty**; the live worker value exists only in the Railway
  worker env.
- The fixture `a4690000-4690-4000-8000-000000000001` sorts at offset 18,814 of
  28,535 `pdf_text_samples` rows (ordered by `asset_id`); the run dies in the
  first 200-row window on the failing front rows and never advances its cursor,
  so the fixture was never retried. When observed, the fixture still carried
  `parse_error="probe-induced failure for 469 retry verification"` and the
  seeded `extracted_at=2026-11-14T18:21:29-05:00`.
- Box left unchecked. To prove Leg 2: restore a valid DeepSeek key in the
  Railway worker env (and fill the empty 1Password `deepseek` field), rerun
  `rich-pdf-extract`, and observe `parse_error` cleared on a seeded failure row.

## 5. Cleanup — done 2026-11-18 ~11:42 AM EST

- **NAS fixtures removed** with the exact commands recorded in
  `verification/469-fixtures/live-proof-2026-11-15.md` (all five files:
  `#469probe.psd`, `$469probe.psd`, `@469probe.psd`, `469probe-big.ai`,
  `inner.psd`). The `rmdir` of `#469probe-skip/` needed one extra step: the NAS
  had created a root-owned `@eaDir` metadata dir inside it, which was removed
  first, then the folder. Pre-existing `a/ai-test-681-moved-file.pdf` left in
  place, untouched. Post-removal listing confirms only that file remains in
  `a/`.
- **Fixture asset rows purged** (Management API SQL, fixture rows only):
  `4823df3f-…`, `3899f321-…`, `b0b1029b-…`, `37fc028f-…` (probe assets) and
  `a4690000-4690-4000-8000-000000000001` (rich-pdf toytest) — after its
  `pdf_text_samples` and `dam.pdf_rich_extraction` rows (exact statements in
  `verification/469-richpdf-retry/live-proof-2026-11-15.md` cleanup). Verified:
  0 matching asset rows, 0 `pdf_text_samples` rows, 0 `dam.pdf_rich_extraction`
  rows remain for the fixtures. Per the cleanup scope the rich-pdf retry fixture
  is gone; a new toytest failure row must be seeded when the worker key is fixed.

## Residual items

- #229 ordinary-ingest box: needs a completed-pass counters read on build
  `487af886` showing `errors: 0` (or owner acceptance of the asset-row proof as
  the criterion).
- #469 parseCounters chip: needs one admin UI chip read during a live scan that
  skips pre-min-date files (next scan window).
- #469 rich-pdf Leg 2: blocked on a valid `DEEPSEEK_API_KEY` in the Railway
  worker env (401 `****80f9`), plus the empty 1Password `deepseek` field.

Posted by MiMo chat unknown on desktop
