# Issue #469 fixture-based live-proof probes — 2026-11-15

summary: Fixture probes for #469 (ingest filename gate, .ai sentinel 16 MB cap, user Stop mid-batch)
kind: verification-record
status: current
read-when: closing or resuming #469 live-proof checkboxes

## Scope and method

Deployed build `ce4d1a3` on dam/sg.designflow.app; live bridge `synology-bridge-1`
build `487af886` (heartbeat since 4:38 PM EST). Production gate:
`ai-task-gates start --class production` + `check --before production --acknowledge`
(scoped fixture-probe delegation; recorded verbatim in `evidence.json`). No
destructive actions, no schema changes, no credential changes, no scan was
triggered (no verification record establishes scan-triggering as a probe class).

Test files were placed with the repo's documented NAS fixture path — SSH alias
`edgesynology1`, files created inside the SSH session (same class as the #681
`_ai_test_681` fixture). Live config read first (`get-config`, read-only):
`SCAN_ROOTS = ["/mnt/nas/mac/Decor"]`, `SCAN_ALLOWED_SUBFOLDERS =
["generic decor", "character licensed"]`, `SCAN_MIN_DATE = 2020-01-01`,
`AUTO_SCAN_CONFIG = {enabled: true, interval_hours: 2}`. All fixtures sit under
`Decor/Generic Decor/Unused/_ai_test_681/` (inside an allowed subfolder, newer
than the min date, in the established fixture folder that stays on the NAS on
purpose).

## Fixtures placed (5:25 PM EST, before the ~6:38 PM EST auto-scan)

Root: `/volume1/mac/Decor/Generic Decor/Unused/_ai_test_681/` (= container
relative `Decor/Generic Decor/Unused/_ai_test_681/`).

| File | Size | Purpose |
|---|---|---|
| `a/#469probe.psd` | 75 B | Probe 1 positive — filename starts with `#` (folder Rule A prefix); a folder named `#469probe.psd` is excluded, the FILE must be ingested. Old `shouldSkipPath` applied folder rules to filenames and skipped it (`packages/path-filters/index.ts:89-100` now exempts the last segment). |
| `a/$469probe.psd` | 75 B | Same, `$` prefix (issue probe wording: `#`/`$`/`@`-named artwork files). |
| `a/@469probe.psd` | 75 B | Same, `@` prefix. |
| `#469probe-skip/inner.psd` | 86 B | Probe 1 negative — inside a `#`-prefixed folder, which `shouldSkipFolder` prunes; must NOT appear as an asset ("excluded folders stay skipped"). |
| `a/469probe-big.ai` | 16,999,996 B | Probe 2 — over the 16 MiB sentinel read cap (16,777,216). Header is plain text so `readHead` does not classify it old-format PostScript. |

`.psd` is unconditionally scanner-accepted (`apps/bridge-agent/src/scanner.ts:209`);
`.ai` passes the pre-flight with no PDF sibling. All names are clearly
469-probe fixtures; contents are filler text ("Harmless test file. Safe to delete.").

## 1. Ingest filename gate — FIXTURES PLACED, observation pending

Claim: `shouldSkipPath` no longer applies folder rules to filenames, and the
edge ingest gate `isExcludedRelativePath` no longer applies the directory
blocklist to the filename segment (`supabase/functions/_shared/path-filters.ts:102-115`
checks `parts.slice(0, -1)` only). Unit tests already pin both
(`src/test/path-filters-skip.test.ts:5-8`, `supabase/functions/_shared/path-filters.test.ts`
"is not apply directory rules to the filename segment").

**Live proof target:** after the ~6:38 PM EST auto-scan, `#469probe.psd`,
`$469probe.psd` and `@469probe.psd` exist as their own `assets` rows, and
`#469probe-skip/inner.psd` does not. **Pending** — the auto-scan window was
still ahead at probe time (5:25 PM EST) and scan-triggering is not an
established probe class, so the files were left in place and the observation is
handed to the 2026-11-15 8:33 PM EST scheduled one-shot check (named on #469).

## 2. `.ai` sentinel 16 MB cap — FIXTURE PLACED, observation pending

Code in the **deployed** bridge build `487af886` (verified with
`git show 487af886:apps/bridge-agent/src/ai-sentinel-detect.ts`):
`SENTINEL_READ_LIMIT_BYTES = 16 * 1024 * 1024` and
`readFileWithinLimit(filePath, SENTINEL_READ_LIMIT_BYTES)` before any mupdf
work. `packages/agent-common/src/bounded-read.ts` stats the file first and
returns `null` **without reading content** when `size > maxBytes` — so an
over-cap `.ai` is never buffered whole at thumbnail concurrency
(`ai-sentinel-detect.ts:80-84` then reports `isSentinel: false, pageCount: 0`).
Cap introduced by PR #713 (Nov 4), long before the deployed build.

**Live proof target:** the ~6:38 PM EST pass thumbnails/ingests
`469probe-big.ai` (16,999,996 B > 16 MiB): it appears as its own asset and is
NOT recorded in `scanner_ai_ignores` as `no_pdf_compat` (an unbounded read of
this text-only filler would classify it a sentinel; the cap refuses the read),
with the bridge staying healthy throughout. **Pending** — same handoff to the
8:33 PM EST check.

## 3. User Stop mid-batch — PROVEN (5:26 PM EST)

One tiny single-asset AI-tag operation on ONE toytest-named fixture-class row
(`paulfrank_toytest_mockup1.png`, asset `d7bb23e1-…`) — the planned `_ai_test_681`
asset rows are purged from production (read-only query returned 0 rows), and
this is the smallest op the worker supports (`ai-tag-single-<id>`, one model
call; gate re-checked with the refined scope and allowed). Full log:
`stop-probe-log.json`.

- 5:26:20.15 PM EST — op `ai-tag-single-d7bb23e1-e259-49a1-a447-825166c1aad6`
  started (`status: running`, `params.asset_ids = [d7bb23e1…]`, exact UI shape
  from `src/components/library/AssetDetailPanel.tsx:334-345`).
- 5:26:26.1 PM EST — pre-stop snapshot: op untouched since start (worker holds
  the batch in flight).
- 5:26:26.1 PM EST — **user Stop** written (`status: interrupted`,
  `interruption_reason_code: user_stop`, `error: "Stopped by user"`, UI shape
  `src/hooks/usePersistentOperation.ts:222-229`).
- 5:26:41.0 PM EST — the batch completed its **apply underneath the stop**
  (`assets.ai_tagged_at = 5:26:40.978 PM EST`, 12 AI tags written) — i.e. the
  stop landed genuinely mid-batch, in the last-batch window of the original bug.
- The worker's post-batch persist and terminal write were **refused**: op
  `updated_at` stayed frozen at the stop write `5:26:26.099 PM EST` (22:26:26.099Z)
  on 12 observations over 120 s and on a later check at 5:29:08 PM EST.
- **No auto-resume**: status never returned to `running`;
  `next_auto_resume_at` stayed null on every observation.

Guard under test: `apps/worker/src/operation-loop.ts` persists every batch
progress and every terminal (`completed`/`failed`/`interrupted`) write through
`persistOpState(..., { onlyIfRunning: true })` → `update_bulk_operation` with
`p_only_if_status = "running"` (`guardedPersistOpState`), so a user stop is
never overwritten (#713 + PR #821 error-path guards). The observed frozen
terminal state after a batch that ran to completion is exactly the pre-#713
failure mode and it now holds.

Side effects (both in scope, disclosed): the one model call wrote 12 ordinary
AI tags to that toytest row (previously untagged; normal re-tag output, left in
place), and the op row is left `interrupted`/`user_stop` like the existing
stopped ops. No other row was touched.

## Cleanup

- **Stop probe:** done — nothing further to remove (op row and one toytest
  asset's ordinary AI tags are the disclosed, in-scope writes).
- **NAS fixtures:** PENDING — they must stay until the ingest observation.
  After the 8:33 PM EST check confirms (or refutes) ingest, remove with:
  `rm '/volume1/mac/Decor/Generic Decor/Unused/_ai_test_681/a/#469probe.psd'
     '/volume1/mac/Decor/Generic Decor/Unused/_ai_test_681/a/$469probe.psd'
     '/volume1/mac/Decor/Generic Decor/Unused/_ai_test_681/a/@469probe.psd'
     '/volume1/mac/Decor/Generic Decor/Unused/_ai_test_681/a/469probe-big.ai'
     '/volume1/mac/Decor/Generic Decor/Unused/_ai_test_681/#469probe-skip/inner.psd'`
  then `rmdir '/volume1/mac/Decor/Generic Decor/Unused/_ai_test_681/#469probe-skip'`.
  Any asset rows the scan created for these files should be purged through the
  normal admin path (asset detail → delete) and their ids noted on #469. The
  pre-existing `_ai_test_681/a/ai-test-681-moved-file.pdf` is NOT ours — leave it.

## Not run (per instructions)

- Tesseract `finally` termination, 10,000-iteration batch cap,
  `ensureRootMarkers` read-only-share backoff — need heavy bulk jobs or
  infrastructure state; left documented on #469 as remaining.
- `rich-pdf` (shared-db RPC), Download all (Helper), scan-triggering as a probe
  class — out of this pass.

Posted by MiMo chat unknown on desktop
