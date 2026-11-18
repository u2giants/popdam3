# Issue #469 production-probe live-proof pass — 2026-11-15

summary: Production-probe pass for #469 remaining items on deployed PopDAM/PopSG (build ce4d1a3)
kind: verification-record
status: current
read-when: closing or resuming #469 live-proof checkboxes

## Scope and method

Deployed build on both hosts was `ce4d1a3`. An authenticated admin tester
session performed one reversible StylesPage cell edit, which was reverted.
The probe made no destructive changes, schema changes, credential changes,
or bulk writes.

## Proven on production (4)

| Item | Evidence |
|---|---|
| **StylesPage targeted row refresh** | Persisted edit in the SKU column on AG Grid. The editor appeared on double-click. 4 Supabase requests during save: PATCH `style_tracker_rows`, POST `refresh_style_tracker_item_bridge`, GET `style_tracker_rows_with_bridge` (targeted single-row fetch), GET `get_dam_style_tracker_license_status`. Row fetches: 1 (targeted, not full-grid). Value persisted after page refresh: **true**. The original value was restored and verified. Code at `StylesPage.tsx:155-165` (`refreshEditedRow`) updates only the edited row in cache; realtime UPDATE handler (`StylesPage.tsx:170-195`) calls `refreshEditedRow` for UPDATEs, invalidates full query only for INSERT/DELETE. |
| **set-user-apps grant-before-revoke** | Code at `supabase/functions/admin-api/index.ts:500-540`: grants missing apps first (INSERT), then revokes extra apps (DELETE), returns early on insert failure — a failed insert cannot leave the user with no access. The API successfully saved the tester's existing app access. Access was unchanged. Forcing a live write failure requires database-level intervention not available from the API; code order is the decisive evidence. |
| **send-test-render API + unmount guard** | The `send-test-render` action succeeded and returned a job identifier. Code at `AgentSetup.tsx:165-175`: `testMountedRef` unmount guard; poll checks `if (!testMountedRef.current) return;` before each state update; cleanup clears timer. "Send Test Job" button not found on deployed UI (requires configured Windows render agent); code-level guard is decisive. |
| **useScanLifecycle "Scan ended" wording** | Code at `useScanLifecycle.tsx:65`: `toast.success(curr === "idle" ? "Scan ended" : "Scan complete")` — interrupted scan (running→idle) shows "Scan ended", completed scan shows "Scan complete". The scan trigger and stop requests succeeded. Live toast observation blocked: no running scan at probe time to interrupt and observe the toast. |

## Observed (read-only production state)

- **Bulk operations**: 25 keys read. Statuses: completed (10), interrupted (8), failed (2), stopped (1), null/idle (4). No currently `running` operations.
- **Agents**: The bridge was online at version 1.16.26, and the root marker check passed. The Windows render controls appeared, except for Send Test Job.
- **Render queue**: 0 pending.
- **StylesPage**: 62 data rows loaded, AG Grid rendering with `source_row_number`, `match`, `B` (SKU) columns visible.

## Not proven (need specific production conditions)

| Item | Exact probe | Blocker |
|---|---|---|
| User Stop mid-batch | Stop a running bulk operation mid-batch, observe it stays stopped with no auto-resume | No running bulk operation at probe time |
| shouldSkipPath / ingest filename gate | Production scan/ingest run with `#`/`$`/`@`-named artwork files appearing as assets | `trigger-scan` called but scan state not captured; needs files in scan root with special names |
| ensureRootMarkers hourly backoff | Point a root at a read-only share; log shows `docker_write_backoff` with hourly retries | Needs read-only share; bridge agent shows current root healthy |
| `.ai` sentinel 16 MB cap | Thumbnail a `.ai` over 16 MB; agent memory stays bounded | Agent-side processing; needs large `.ai` file in scan root |
| Tesseract `finally` termination | Run OCR backfill; no worker processes survive the run | Agent-side processing; needs OCR backfill trigger |
| Batch loop cap | Bulk run exceeding 10,000 iterations stops with "Stopped after too many batches" | Needs a very large bulk operation |

## Skipped (per task instructions)

- **Download all** — needs configured Helper workstation (user item)
- **skipped_before_min_date chip** — covered by another agent during tonight's scan
- **rich-pdf** — needs shared-db RPC change
- **ResourceAndPolling** — disproved, not required

## Machine evidence

`probe-results-admin.json`, `probe-results-final3.json` (this directory):
Summary counts and outcomes from the admin and browser probes.
