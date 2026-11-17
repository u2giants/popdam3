# PR #1033 / shared-db #6520 — "Clear my last HFC upload" sandbox-only, live proof (2026-11-16)

summary: Live evidence that the Burlington Clear item is gone from production, works on sandbox, and the RPC refuses on production
kind: verification-record
status: current
read-when: reopening the sandbox-only question or resetting the preview database

## Owner correction

Albert, 2026-11-16: "the 'Clear my last HFC upload' should only be on the
https://dam-sandbox.designflow.app site, not the live production site."

## Changes

- `src/pages/OrdersPage.tsx` — menu item + `ClearBuySheetDialog` render only
  when `IS_NON_PRODUCTION_DATABASE` (PR #1033, merged, build `3b72a75`).
- `public.clear_dam_buy_sheet_import` — deny-by-default guard on
  `admin_config.SANDBOX_ENABLED_TOOLS` (shared-db #6520, migration
  20261201110000, PR #6521; preview apply run 43984192801 and production apply
  run 43984795285 both succeeded). The enable row exists on preview only.

## Live proof (2026-11-16, 5:24–7:20 PM EST)

- **Production UI** — `https://dam.designflow.app/orders` (build `3b72a75`,
  deployed 5:24 PM EST), headless Chromium with the approved admin tester
  session: Burlington menu = `Import buy sheet (HFC)`, `Bamboo Rose sheet`.
  No Clear item. Screenshot `prod-orders.png`.
- **Sandbox UI** — `https://dam-sandbox.designflow.app/orders` (same build):
  Burlington menu includes `Clear my last HFC upload`. Screenshot
  `sandbox-orders.png`.
- **Sandbox dialog end-to-end after the guard deployed on preview** — the
  dialog calls the RPC as the signed-in preview tester and reaches normal
  behaviour (`clear_dam_buy_sheet_import: no buy-sheet import to clear`),
  i.e. the guard opens via the enable row. Screenshot
  `sandbox-dialog-after-guard.png` (`sandbox-dialog.png` is the same probe
  before the guard reached preview).
- **Production RPC refusal** — production `qsllyeztdwjgirsysgai`:
  guard present in the live `pg_get_functiondef`; `admin_config` has no
  `SANDBOX_ENABLED_TOOLS` row; an authenticated call refuses with
  `clear_dam_buy_sheet_import: sandbox-only tool, not enabled on this database`
  (SQLSTATE 42501) before any data access.
- **Preview RPC open** — preview `mvpkijzfmfcxhnzqogzs`: guard present, enable
  row present, authenticated call passes the guard and returns the normal
  no-import refusal.

Preview tester account: `zcode.dam.preview@designflow.app` (1Password
`vibe_coding`, item "DAM preview tester login - ZCode"). It was created because
#952 removed the no-login sandbox tester. If the preview is reset, re-add both
the account's access rows and the `SANDBOX_ENABLED_TOOLS` row.
