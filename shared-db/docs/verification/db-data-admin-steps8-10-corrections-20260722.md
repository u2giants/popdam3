# DB Data Admin Steps 8–10 corrections — 2026-07-22

This is the verification record for the corrective pass over the already-delivered Steps 8, 9,
and 10. It closes specific gaps found against `DB_Data_Admin.md` §8.3 (merge workflow §8.3.3/6/7),
§8.4 (tree reachability), §8.1 (per-app status), and §5 (no accidental reactivation). It changes
frontend, CSS, tests, and adds one additive migration that was applied and verified on preview
only. It does **not** edit any previously applied migration and leaves
`fix_impl_visual_admin_page.md` byte-for-byte untouched.

## What was corrected and why

### 1. Step 9 — the merge preview now shows the exact aliases and source references that move

`DB_Data_Admin.md` §8.3.3 requires the preview to "display exactly what will move or change:
aliases, source references, dependent links…". The prior preview showed only affected-row counts
and per-app conflicts.

- **Additive migration** `supabase/migrations/20260722210000_db_data_admin_merge_preview_moving_detail.sql`
  is a `create or replace` of the private `app.db_data_admin_merge_preview(text,uuid,uuid)` helper
  that faithfully extends the applied `20260722194100` body (identical helpers, `search_path`,
  and `extensions.digest` token computation) and adds two arrays to the preview payload:
  - `moving_aliases` — the loser's real `core.customer_alias` / `core.factory_alias` rows
    (`origin = 'existing_alias'`), plus the loser's own display name that the merge wrapper adds
    as a new survivor alias (`origin = 'loser_name'`, because the wrapper is always called with
    `p_alias_loser_name => true`).
  - `moving_source_refs` — the loser's real `core.company_source_ref` /
    `core.factory_source_ref` rows. The Vendor branch omits `source_name`, which
    `core.factory_source_ref` does not have (§9 note).
- **Token coverage.** Both arrays are folded into the same `v_payload` that is SHA-256 hashed into
  `preview_token`, and `app.db_data_admin_merge_execute` recomputes the token by calling this same
  function. If the loser's aliases or source references change between preview and execute, the
  token goes stale and the merge is loudly rejected — so the displayed detail is an exact,
  token-covered representation, not a best-effort echo.
- **Frontend.** `MergeDialog.tsx` renders "Aliases that will move to the survivor" and "Source
  references that will move to the survivor" lists; the loser-name alias carries a
  "duplicate's current name" badge. `lib/data-admin.ts` adds `MergeMovingAlias` /
  `MergeMovingSourceRef` types.
- **Tests.** `supabase/tests/db_data_admin_merge_preview_moving_detail.sql` (rollback-safe, no
  hard-coded row counts) proves both arrays contain the actual moving rows, that mutating an alias
  changes the token, and that an executed merge really transfers them. `MergeDialog.test.tsx`
  proves the lists render. `grid.spec.ts` proves them in the browser.

### 2. Step 9 — accessible success receipt with final survivor and audit/operation ID

`DB_Data_Admin.md` §8.3.6 requires the UI to "show the operation/audit ID and final survivor".
The prior dialog closed on success, showing nothing.

- `MergeDialog.tsx` now keeps the dialog open on success and shows a persistent receipt in a
  `role="status"` region: a "Merge complete" heading, "<duplicate> was absorbed", the **final
  survivor** (name + status from the merge result), the **audit / operation ID** in a `<code>`,
  and a note that the merge is in the immutable audit history and that the loser's old codes/names
  now resolve through the survivor (§8.3.7). The parent grid/detail/audit still refresh underneath;
  `DataAdmin.mergeComplete` no longer force-closes the dialog.
- **Tests.** `MergeDialog.test.tsx` asserts the receipt content and that `onMerged` still fires;
  `grid.spec.ts` captures `db-data-admin-step9-merge-receipt.png`.

### 3. Step 9 — merge candidates are no longer limited to the loaded grid page

A legitimate duplicate may not be on the currently loaded grid page (server mode, or beyond the
client-mode cap), which made it unreachable as a merge loser.

- `lib/data-admin.ts` adds `searchMergeCandidates`, a **bounded** (single 25-row,
  inactive-inclusive) name search through the same protected `db_data_admin_<kind>_list` RPC,
  excluding the survivor — never an unbounded scan.
- `MergeDialog.tsx` adds a "Search all <kind>s for a duplicate…" control that appends found
  records to the select options. `DataAdmin.tsx` wires `onSearchCandidates`.
- **Tests.** `lib/data-admin.test.ts` asserts the exact RPC params and survivor exclusion;
  `MergeDialog.test.tsx` proves a duplicate outside the loaded grid becomes selectable.

### 4. Step 10 — every property reachable past the old 24-item cap

`DB_Data_Admin.md` §8.4 requires every canonical Property to appear under exactly one Licensor.
The prior tree hard-sliced properties at `VISIBLE_PROPERTIES * 6 = 24` with no way to see the rest.

- `LicensorTree.tsx` replaces the silent slice with `INITIAL_VISIBLE = 50` plus an accessible
  "Show all N properties (M hidden)" / "Show fewer" control per licensor and for the orphan list.
  The control **names the exact hidden count** — never a silent truncation. When a search term is
  active, properties are already narrowed to matches and all are shown, so search reaches a
  property beyond the initial cap without needing show-all.
- **Tests.** `LicensorTree.test.tsx` adds a 60-property licensor and proves property #59 is hidden
  until "show all", reachable after it, and reachable directly via search.

### 5. Step 8 — per-app status reflects the record's current status (no accidental reactivation)

`DB_Data_Admin.md` §5 forbids accidental reactivation. Opening the editor and selecting an
application previously defaulted its status to "Active" even when that application was currently
inactive, so a save would silently reactivate it.

- `RecordEditor.tsx` adds `currentAppStatus(row, app)`; selecting an application adopts that
  application's current status and shows "Currently <status> in <APP>." inline.
- **Test.** `RecordEditor.test.tsx` proves selecting PM for a PM-inactive record shows `inactive`,
  not `active`.

### 6. Step 8 — stale concurrency-token failure and one-click recovery

`DB_Data_Admin.md` §7 requires conflicting edits to be rejected loudly. The failure path existed
but there was no recovery.

- `RecordEditor.tsx` renders a "Reload record" button inside the stale-token conflict alert.
  `DataAdmin.tsx` `reloadRecord()` re-fetches the record's fresh detail (new `updated_at`) and
  remounts the editor via a reload key, so the next save carries the current token and succeeds.
- **Evidence.** `grid.spec.ts` adds a browser test that forces a `stale_token` result, captures the
  loud failure (`db-data-admin-step8-stale-token.png`), clicks "Reload record", and captures the
  successful recovery (`db-data-admin-step8-stale-token-recovered.png`). `RecordEditor.test.tsx`
  proves the reload button invokes recovery.

### 7. CSS reconciliation and dead-CSS removal

- Removed the dead `.show-more` rule (no element used it).
- Added the rules the code actually references: `.link-button`, `.show-all`, `.tree-show-all`,
  and `.reload-record` (with `:hover`/`:focus-visible` for keyboard accessibility). Verified every
  new class used by `LicensorTree.tsx`, `MergeDialog.tsx`, and `RecordEditor.tsx`
  (`sr-only`, `badge`/`badge-warn`, `mono`, `tree-label`, `merge-candidate-search`,
  `merge-moving`, `merge-receipt`) resolves to a defined selector.

## Automated evidence (run from `apps/db-data-admin/`, plus repo-root SQL check)

- `npm run lint` — **passed** (ESLint, no warnings).
- `npx vitest run` — **29 unit tests passed** across 8 files (adds merge moving-detail, receipt,
  candidate-search, per-app current-status, reload-recovery, and 60-property reachability tests).
- `npm run build` — **passed** (`tsc -b` + Vite).
- `npx playwright test` — **6 Chromium tests passed**, including the corrected merge preview/receipt
  and the new stale-token failure/recovery.
- `bash scripts/check-sql.sh` (repo root) — **static checks passed**, including the new migration
  and SQL test.

## Visual evidence

- `db-data-admin-step9-moving-detail-preview.png` — moving aliases (with "Duplicate's Current Name" badge)
  and moving source references, plus affected counts and the conflict choice.
- `db-data-admin-step9-merge-receipt.png` — the persistent success receipt with final survivor and
  audit/operation ID.
- `db-data-admin-step8-stale-token.png` — the loud stale-token failure with the "Reload record"
  recovery control.
- `db-data-admin-step8-stale-token-recovered.png` — successful save after reload.
- `db-data-admin-step10-licensor-tree.png` — the read-only tree (reachability control exercised by
  unit tests against a 60-property fixture).

## Scope and safety

- Migration `20260722210000` was dry-run, applied, and verified on preview
  (`rjyboqwcdzcocqgmsyel`) only. All nine rollback-safe DB Data Admin suites passed there and the
  final dry-run reported the remote database up to date. Production was not linked or changed;
  execution stays behind the feature gate. No previously applied migration
  (`20260722194000`/`194100`/`203000`/`203100`/`170000`) was edited.
- `fix_impl_visual_admin_page.md` was not modified.
- Application deployment follows the branch/PR pipeline after this preview verification; no
  production database apply or production write-gate change is part of this corrective pass.
