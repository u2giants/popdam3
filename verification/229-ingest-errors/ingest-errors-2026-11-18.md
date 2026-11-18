---
summary: "Characterization of the 17 ingest errors in the running pass on bridge build 487af886 — no containment or ingest regression; ordinary-ingest box closed on #229."
kind: verification-record
status: current
read-when: closing or revisiting #229 ordinary-ingest box, or diagnosing bridge counters.errors
---

# #229 ordinary ingest — 17-error characterization (bridge build 487af886)

Date: 2026-11-18, about 11:55 AM–12:10 PM EST. Read-only evidence (admin-api
`run-query` SELECT only, `SUPABASE_SECRET_KEY` injected via 1Password op_run; NAS
SSH read-only attempts). Production DB read-only. No schema or credential
changes. No scan was triggered. Task gate: `ai-task-gates start --class
private-evidence` in `wt-229-errors` at `f6d49340`.

## 1. Question and answer

The current live pass on `synology-bridge-1` build `487af886` (session
`9aee7246-7e33-4fcb-95e2-bd6b774193c5`, ingest phase since 2026-11-17 11:32 PM
EST) reports `errors: 17`. Are they a regression from the #229 containment
changes, or benign per-file exceptions?

**Answer: benign per-file processing exceptions. No containment false-positives
and no ingest regression.** The containment delta from #229 is not in the
ordinary-ingest code path at all (verified in code), the error rate is 0.010%
(17 of 164,338 files), the errors stopped occurring, and ingest throughput is
healthy and ongoing.

## 2. Counters (read 2026-11-18 12:00–12:04 PM EST)

`SCAN_PROGRESS` (`admin_config`), running pass session `9aee7246`, at
`updated_at 2026-11-18T16:59:36Z`:

```
files_checked 164,338 | files_total_encountered 434,713 | candidates_found 164,338
updated_existing 15,164 (climbing) | ingested_new 0 | moved_detected 0
errors 17 | roots_invalid 0 | roots_unreadable 0 | files_stat_failed 0
dirs_skipped_excluded 52,464 | dirs_skipped_permission 0
rejected_wrong_type 228,971 | rejected_junk_file 27,286 | skipped_before_min_date 3,226
rejected_ai_has_pdf_sibling 14,180 | unresolved_licensor 2,220 | unresolved_property 2,220
```

`agent_registrations.metadata.counter_history` (synology-bridge-1, 60 retained
heartbeats, 2026-11-18 16:30:26Z–17:00:40Z = 11:30 AM–12:00 PM EST): `errors: 17`
**constant across the whole retained window** while `updated_existing` climbed
13,998 → 15,227 (~40 files/min). `metadata.last_error` is **null**;
`metadata.diagnostics` reports `scan:ingest (164338 candidates)` active, marker
`Decor: ok` (17:03Z), `scan_roots_readable: true`, `mount_root_exists: true`.

So: the 17 errors all occurred between the ingest-phase start (Nov 17 11:32 PM
EST) and 11:30 AM EST Nov 18 (outside the retained counter window); no new
errors in the last 30+ minutes while ingest continued normally.

## 3. What the 17 errors can be (code analysis)

`counters.errors` increments at exactly three sites in
`apps/bridge-agent/src/index.ts`:

- `index.ts:1038` — "0 files checked" (end of walk). Not applicable: 164,338
  files checked.
- `index.ts:1051` — failed to clear scan checkpoint before ingest (would abort
  the scan). Not applicable: scan is running.
- `index.ts:1376` — `catch` around per-file processing (`processFile`). **This
  is the only possible source of the 17.**

Inside `processFile`'s `try`, only two calls can throw:

1. `computeQuickHash(file.absolutePath)` (`apps/bridge-agent/src/hasher.ts:19`) —
   `stat()` or `open()` failure: ENOENT (file vanished mid-pass), EACCES, or EIO
   (transient NAS I/O).
2. `api.ingest(...)` via `callApi`
   (`packages/agent-common/src/agent-api-transport.ts`) — throws on HTTP non-2xx
   (`agent-api ingest returned <status>`), `data.ok === false` (`agent-api ingest
   error: ...`), or network failure after 5 retry attempts.

Everything else in `processFile` is throw-safe or counts elsewhere:

- `processThumbnail` (`index.ts:788`) has its own `catch` and returns
  `{ thumbnailError }` — thumbnail failures never reach `counters.errors`.
- `isAiWithoutPdfCompat` (`thumbnailer.ts:115`) has its own `catch`, returns
  `false`.
- `.ai` pre-flight `stat(pdfSiblingPath)` is wrapped in `try/catch`.
- Skip/reject classes have their own counters (verified all distinct and
  non-overlapping in the read): `rejected_wrong_type`, `rejected_junk_file`,
  `skipped_before_min_date`, `rejected_ai_has_pdf_sibling`, `noop_unchanged`,
  `files_stat_failed`. None of them feed `errors`.

**So the 17 are file-read failures (ENOENT/EACCES/EIO) or ingest-call failures
(HTTP/network) on individual files — nothing else.**

## 4. Regression check — containment is not in the ingest path

The #229 containment additions (`assertSafeFilename` / `resolveUnderRootFilename`
in `packages/agent-common/src/path-containment.ts`) are wired into exactly one
production call site: `apps/bridge-agent/src/handlers/snapshot-tools.ts:160`
(snapshot-restore destination join). Grep of
`assertSafeFilename|resolveUnderRootFilename|assertSafeRelativePath` across
`apps/bridge-agent/src` confirms no use in `scanner.ts`, `index.ts`
(`processFile`/`processScanCandidates`), `hasher.ts`, `thumbnailer.ts`, or
`api-client.ts` — the ordinary-ingest call graph.

The older `resolveUnderRoot` is used in `pdf-backfill.ts`, `checkin-verifier.ts`,
`ai-sentinel-scanner.ts`, `pdf-text-sampler.ts`, `stale-record-retirement.ts` —
none of which run inside `processFile`. The deployed image delta
`baa75e24..487af886` is only `snapshot-tools.ts` (4 lines) plus the shared
path-containment additions and tests (independently recorded in
`verification/issue-229/agent-rollout-live-proof-2026-11-15.md` §3).

Containment errors (`PathContainmentError`, message prefix `Unsafe path:`) can
therefore never reach `counters.errors`. **No containment false-positive is
possible in ordinary ingest on this build.**

## 5. Corroborating DB surfaces (all clean)

| Surface | Read (SELECT only) | Result |
|---|---|---|
| `processing_queue` | all rows | **0 rows** (no failed ingest processing rows at all) |
| `render_queue` | rows created in pass window | **0 rows** |
| `assets.thumbnail_error` | non-null, updated in pass window | **1 row**: `deferred_to_windows_agent` (benign deferral, not an error) |
| `scanner_ai_ignores` | created in pass window | **0 rows** (no ignore-list churn beyond the counters) |
| `agent_registrations` metadata | `last_error`, `last_error_at` | **null / null** |
| error-bearing tables | `information_schema` | no ingest-error table exists (34 error columns across unrelated domains) |

## 6. Why per-file error strings are not recoverable

The bridge logger (`packages/agent-common/src/logger.ts`) writes JSON lines to
stdout (Docker logs) and keeps an in-memory 200-line buffer shipped only with
**Windows-agent** heartbeats (`getLogTail` is not called anywhere in
`apps/bridge-agent`). The bridge does not persist per-file error strings to any
DB table — `processFile`'s catch logs `File processing failed {file, error}` to
Docker stdout only.

NAS read attempts 2026-11-18 ~12:05 PM EST (SSH alias `edgesynology1`, user
`ahazan`):

- `docker` not in PATH for the SSH user; full path exists
  (`/usr/local/bin/docker`) but the daemon socket is **permission denied**
  (user not in the docker group).
- `/volume1/@docker/` (container data incl. `*-json.log`): **permission denied**
  (root-owned).
- `sudo` requires a password (documented privileged-credential mismatch).

This matches the recovery-pass finding (`verification/recovery-checks/recovery-checks-2026-11-18.md`
§1). The error strings are log-only and not readable from this machine.

## 7. Verdict — ordinary ingest is healthy

Decisive evidence that ordinary ingest processes normally on build `487af886`:

1. **Positive ingest proof (restored copy):** `XA12SP_PACKAGING (restored
   2026-09-30).ai` ingested as its own asset `416586df-eba9-4488-9824-a8b91b86e11d`
   at 2026-11-15 9:35:08 PM EST on the first full pass of this build
   (file_size 2,438,951 = the snapshot version's exact size; Spaces thumbnail
   present; `thumbnail_error` null) — recorded in the recovery checks.
2. **Ingest throughput live:** `updated_existing` climbing ~40 files/min with
   zero new errors across 30+ minutes of retained heartbeats (11:30 AM–12:00 PM
   EST today).
3. **Error rate and shape:** 17 errors / 164,338 files = 0.010%, all attributable
   to per-file read or ingest-call exceptions by code analysis; errors stopped
   occurring; no systemic pattern (roots/stat all clean).
4. **No regression mechanism:** the #229 containment delta cannot execute in the
   ingest path (code-verified, §4); no failed queue rows; no abnormal
   thumbnail/ignore records.

The literal "0 errors" counter (the pre-#991 build's 3:15 PM EST Nov 15 pass
reported 0) is not reproduced on this pass — the honest reading is **"no
containment/ingest regressions; 17 benign per-file exceptions (0.010%)"**. The
individual error strings are not recoverable (§6); their class is established by
code analysis and corroborating DB surfaces.

## 8. #229 box state after this record

- [x] live proof: new bridge-agent + windows-agent build (containing #991) deployed
- [x] live proof: a job with `..` or absolute `relative_path` is reported as failed post-deploy (negative probe)
- [x] live proof: normal checkout + check-in from dam and sg on an installed Helper
- [x] live proof: ordinary ingest still processes normally post-deploy — no containment/ingest regressions; 17 benign per-file exceptions (0.010% of 164,338) characterized above; restored copy ingested as its own asset

All four boxes stand on decisive evidence → #229 closable.

Posted by MiMo chat unknown on desktop
