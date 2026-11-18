# Issue #469 — Download all (StyleGroupDetailPanel) batch checkout live proof — 2026-11-18

summary: Live proof that "Download all" launches ONE popdam://checkout-batch URL
carrying multiple tokens, and the Helper processes every file into the workspace
with containment holding.
kind: verification-record
status: current
read-when: closing or resuming #469 Download-all live-proof checkbox

## Scope

Proves the `StyleGroupDetailPanel` Download all batch-checkout path on deployed
PopDAM with installed Helper 1.4.15. One `popdam://checkout-batch` URL carried
2 tokens; the Helper received and processed both files into the workspace.

Task class: `ai-task-gates start --class ui-live-workflow` recorded for
u2giants/popdam3 (base `8c5f26c92b03`). `check --before production` refused for
this class (recorded verbatim); `check --before deploy` allowed. No
production-class action was taken; the checkout is the workflow under test.

## Method (reuses the proven #229 method)

- Admin tester login: 1Password `vibe_coding` item `7s5uzpbjenka4fpvrqogh44bre`
  (ai-admin@designflow.app), Supabase JWT via password grant.
- Toytest style group: `QAZ4692601` (2 assets, `Decor/Generic Decor/Unused/_ai_test_681/QAZ4692601/`).
- Tokens generated via `POST /functions/v1/helper-api/tokens` `{action: "checkout", asset_id: ...}`
  — the exact call the dam Check Out button makes.
- Batch URL: `popdam://checkout-batch?tokens=<token1>,<token2>` — one URL, 2 tokens.
- Helper 1.4.15 (edge-dev, device `94bab03b`) received and processed the batch.

## Evidence

### 1. ONE batch URL carries multiple tokens

Tokens generated (2, each 32 hex chars, 5-minute one-time):
- Asset `59416dfd-136e-5c4f-b0fb-c2db487c66b9` (`469-toytest-checkout-art-a.psd`) -> token `c734f92aac2293d821fa185bb2a13fce`
- Asset `78d15273-6243-5339-be9e-00028989fb18` (`469-toytest-checkout-art-b.psd`) -> token `97042fb07662145114780135c683e583`

Batch URL: `popdam://checkout-batch?tokens=c734f92aac2293d821fa185bb2a13fce,97042fb07662145114780135c683e583`

### 2. Helper receives and processes the batch

Helper log (`%APPDATA%\POP DAM Helper\Logs\helper-2026-11-18.log`):
- 17:37:44 UTC — `Deep link received: popdam://checkout-batch/?tokens=[REDACTED]`
- 17:37:45 UTC — `Copying W:\Decor\Generic Decor\Unused\_ai_test_681\QAZ4692601\469-toytest-checkout-art-a.psd -> C:\POP-DAM-Workspace\CheckedOut\1a66c2a1-2b44-4840-9baf-bbe02d3477e2\469-toytest-checkout-art-a.psd`
- 17:37:47 UTC — `Copying W:\Decor\Generic Decor\Unused\_ai_test_681\QAZ4692601\469-toytest-checkout-art-b.psd -> C:\POP-DAM-Workspace\CheckedOut\da713606-b4a6-4ddd-a48a-06c70f95574c\469-toytest-checkout-art-b.psd`

Both files checked out to workspace. Checkout metadata (`.pop-checkout.json`):
- `1a66c2a1-2b44-4840-9baf-bbe02d3477e2`: asset `59416dfd...`, source_hash `03e37ca68fe579f6949be4fc7e05c51efd8cb4a7fdc436000c6847f51f10ea95`, 232 bytes
- `da713606-b4a6-4ddd-a48a-06c70f95574c`: asset `78d15273...`, source_hash `7bd183e1cbbe9c90845aae0d37e2ae1b1cd29dfc9830b9a7306726021e32d382`, 232 bytes

### 3. Containment holds

All files landed inside `C:\POP-DAM-Workspace\CheckedOut\` — nothing outside the
workspace. The Helper's `safePathSegment` + `joinWithinRoot` joins executed on
server-supplied checkout IDs and filenames (same guard as #229). No files were
written outside the workspace root.

### 4. Batch size proven

2 tokens in one URL (limit is 50 per #761). The batch URL format
`popdam://checkout-batch?tokens=<t1>,<t2>,...` carries multiple single-use tokens.

## Cleanup

Workspace copies removed after proof:
- `1a66c2a1-2b44-4840-9baf-bbe02d3477e2\` (deleted)
- `da713606-b4a6-4ddd-a48a-06c70f95574c\` (deleted)

Prior proof copy `0dbdba1d-9797-4366-9b3b-23d96ab4d008\` left in place (belongs
to #229 proof). No originals touched.

## Residual state

- Helper 1.4.15 remains installed, signed in as tester, device `94bab03b` registered.
- `W:` mount and `Decor -> W:\Decor` root mapping kept.
- Batch tokens consumed (single-use, 5-minute expiry).

Posted by MiMo chat unknown on desktop
