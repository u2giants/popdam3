# Issue #469 live-proof pass — 2026-11-15

summary: Live-proof pass for #469 audit correctness items on deployed PopDAM/PopSG (build ce4d1a3)
kind: verification-record
status: current
read-when: closing or resuming #469 live-proof checkboxes

## Scope and method

Deployed build on both hosts: `ce4d1a3` (`version.json`, 2026-11-13 1:32 PM EST) —
verified to contain PR #992 (merge `ad999066`). Read-only evidence only: headless
Chromium (Playwright) with the approved admin tester session (1Password
`vibe_coding`, item "DAM AI tester login - PopDAM (administrator, …)"), session
injected into `localStorage['sb-popdam-auth-token']` — the established repo
live-proof method (`verification/popsg-readiness/admin-console-qa-2026-09-15.md`).
Authenticated export reads matched the 2026-11-05 export proof class on #469.
No production writes, no schema changes, no credential changes, no licensed
row contents or filenames retained (counts and SHA-256 identity digests only).

## Proven on production (4)

| Item | Evidence |
|---|---|
| Export paging (ORDER BY + bounded ranges; non-1000-multiple page_size no longer over-fetches) | `export-table` with page_size 337/333/500 (none a multiple of 1000): `render_queue` 2,093 rows = 7 pages `[337×6, 71]`; `properties` 837 = 3 pages `[333,333,171]`; `asset_path_history` 28,268 = 57 pages `[500×56, 268]`. Every full page returned exactly page_size (no over-fetch), unique keys == table count, 0 duplicates, 0 cross-page overlap, `countMatchesTable: true` for all three. Identity digests in `evidence.json`. |
| PopSGLibraryPage name search debounce | On `sg.designflow.app/library`, counted only `search_style_guide_library_v2` RPC calls. 6 keystrokes at 40 ms (inside the 350 ms debounce) → **1** call. Sensitivity control: 4 keystrokes at 700 ms → 2 calls (one per pause). Request count tracks pauses, not keystrokes. |
| `normalizeRelativePath` accepts `Final..v2.psd` | Path Tester (`dam.designflow.app/settings?tab=storage`): input `Decor/Art/Final..v2.psd` → `Valid: YES`, canonical relative path preserved verbatim. Negative control `Decor/../secret.psd` → `Valid: NO`, "Path traversal (..) not allowed". Filename `..` accepted; real `..` segment still rejected. |
| `AiTaggingSection` rate label `/min` | AI tagging panel (`dam.designflow.app/settings?tab=processing`) renders `0 assets/min` and `1 assets/min`; no per-second (`/s`) rate label anywhere on the panel. The defect was the label text itself; the deployed label is `/min`. |

## Observed, not yet decisive (1)

- `useAgentStatus.parseCounters` (`rejected_subfolder`, `skipped_before_min_date`):
  production `agent_registrations` counter history carries both from real scans
  (sums at observation: rejected_subfolder 990, skipped_before_min_date 420,024).
  Scan-diagnostics renders `Rejected: subfolder filter | 30` (non-zero, on screen).
  The `skipped_before_min_date` surface is the library scan-progress "too old"
  chip (`LibraryTopBar.tsx:946`), which renders only while scan progress reports
  it; no scan was live to capture it. Remaining probe: one admin UI read of the
  library scan-progress panel during a scan that skips pre-min-date files.

## Not required

- `ResourceAndPolling` slider resets — disproved and dropped (PR #992 checklist);
  behavior verified in code, no live proof required.

## Needs an unapproved production write or a production action (unchecked)

| Item | Exact probe that would prove it |
|---|---|
| User Stop not overwritten mid-batch | Stop a running bulk operation mid-batch on production and observe it stays stopped with no auto-resume (error-path tick). Job-control action; no live Stop experiment has been run (2026-11-05 note). |
| `StyleGroupDetailPanel` Download all | Configured workstation with Helper 1.4.15+ and a root: Download all on a multi-file group must check out every file from one `popdam://checkout-batch` launch. Prior session established the QA device has zero configured roots (platform prerequisite, #469 comment 2026-11-05). |
| StylesPage targeted row refresh | Real persisted cell edit on a large sheet: no full-grid reload, value persists after refresh. The installed task gate refuses production writes for this UI workflow; prior intercepted-save check is partial frontend proof only. |
| AgentSetup test-render poll guard | Start a test render (sends a render job), leave the tab mid-poll: no console errors, no post-unmount state updates. |
| `useScanLifecycle` "Scan ended" wording | Interrupt a running scan and read the toast ("Scan ended", not "Scan complete"). |
| `shouldSkipPath` filenames + `shouldSkipFolder` walk + ingest filename gate | Production scan/ingest run: `#`/`$`/`@`-named artwork files appear as assets while excluded folders stay skipped. Ingesting a test file into the live pipeline is an unapproved production write and was not done. |
| `ensureRootMarkers` hourly backoff | Point a root at a read-only share; log must show `docker_write_backoff` with at most hourly retries. Config change on production agents. |
| `.ai` sentinel 16 MB cap | Thumbnail an `.ai` over 16 MB and observe bounded agent memory. |
| Tesseract `finally` termination | Run OCR backfill; no worker processes survive the run. |
| `set-user-apps` grant-before-revoke | Change a user's apps while forcing a write failure; existing access must remain. Production write. |
| Batch loop iteration cap | A bulk run that would exceed 10,000 iterations must stop with "Stopped after too many batches". Production bulk run. |

## Needs shared-db (out of scope here)

- `rich-pdf` failed-extraction retry: needs `get_pdf_rich_extraction_hashes` to
  expose `parse_error` (shared-db RPC change, claim-first in popcre/shared-db).
  Not attempted, per instruction.

## Machine evidence

`evidence.json` (this directory): build stamps, export counts/digests, debounce
request counts, path tester results, rate labels, counter sums, UI snippets.
