# Issue #229 — Helper checkout/check-in live proof — 2026-11-15

summary: Installed popdam-helper 1.4.15 (edge-dev) containment diagnostic + real
toytest checkout + check-in round trip through the dam helper-api route.
kind: verification-record
status: current
read-when: closing or resuming #229 live-proof checkboxes

## Scope

Proves the two items this record owns on #229:

1. Containment behavior of the installed Helper build (unsafe names/ids
   rejected, normal ones accepted) — module-only, zero filesystem I/O (the
   Oct 11 method, applied to the Helper's own bundle).
2. Normal checkout + check-in from dam on an installed post-fix Helper, with
   file hash preserved. sg: PopSG has no checkout surface (see below).

Task class: `ai-task-gates start --class ui-live-workflow` recorded for
u2giants/popdam3 (base `470e711afbc0`). `ai-task-gates check --before production`
refused for this class — no production-class action was taken; the one NAS
file write was the check-in being proven (the workflow under test itself).
Nothing destructive to real files: the round trip copied and re-uploaded one
toytest fixture unmodified; its SHA-256 is unchanged before/after.

## 1. Installed build on this Windows machine (edge-dev)

- `C:\Users\ahazan\AppData\Local\Programs\popdam-helper` — popdam-helper
  **1.4.15** (installer files 2026-11-04 11:51 PM; `resources/app.asar`
  `package.json` version `1.4.15`).
- Main bundle `out/main/main.js`, 93,264 bytes, SHA-256
  `E6D01CA431EC5FB8315EE1B5DDF7AA78DB660949FD3EC446E53BD9E2B3B7ED23`
  (matches the asar integrity entry in the archive header).
- The bundle contains the #311 containment code verbatim: `resolveWithinRoot`,
  `safePathSegment` (rejects separators, `.`/`..`, empty, control chars,
  Windows reserved device names), `joinWithinRoot`, `sanitizeRelativePath`
  (rejects absolute / drive / UNC / `..`), and the joined call sites
  (`checkoutDir`/`snapshotDir`/`copyToWorkspace`/`copySnapshotToManagedPath`
  all go through `safePathSegment` + `joinWithinRoot`).
- Helper devices table for comparison: the Nov-4 device `75018b14…`
  (DESKTOP-H1296QT, helper_version 1.4.13) belongs to lherrera@popcre.com —
  a real employee machine and therefore NOT driven (plan
  `docs/plans/issue-229-agent-path-containment.md` step 4). The proof ran on
  edge-dev, an AI-driven machine, under the AI tester login per that plan's
  AI-driven branch ("perform a normal checkout from dam.designflow.app and a
  check-in with the tester login").

## 2. Containment diagnostic — module-only, zero filesystem I/O

Method: extracted `resolveWithinRoot`, `safePathSegment`, `joinWithinRoot`,
`sanitizeRelativePath` byte-for-byte from the installed bundle and exercised
them as pure string/path functions (no filesystem, no network). Same class as
the Oct 11 "module-only diagnostic" on windows-agent 0.16.6.172.

Result: **18 pass, 0 fail.** Unsafe inputs rejected (issue literal first):

| Input | Function | Result |
|---|---|---|
| `..\..\Startup\x.bat` (issue literal) | `safePathSegment` | rejected |
| `../..`, `..`, `C:\Windows\x`, `con`, `sub/file.txt`, `""` | `safePathSegment` | rejected (7 cases) |
| `..\..\Startup\x.bat`, `/etc/passwd`, `C:\Windows\x` | `joinWithinRoot` | rejected — "Path escapes its root" |
| `..\..\Startup\x.bat`, `/etc/passwd`, `..` | `sanitizeRelativePath` | rejected |
| `XA12SP_PACKAGING.ai`, `file..pdf`, uuid checkout id | `safePathSegment` | accepted |
| `checkouts\abc123\file.ai` under a root | `joinWithinRoot` | accepted |
| `root/prop/style/file.ai` | `sanitizeRelativePath` | accepted |

## 3. Checkout + check-in round trip (dam), toytest fixture class

Fixture class per `verification/469-fixtures/live-proof-2026-11-15.md`:
existing toytest row `paulfrank_toytest_mockup1.png`, asset
`d7bb23e1-e259-49a1-a447-825166c1aad6` (1,094,415 bytes) — no new file placed,
nothing destructive (unmodified copy round trip).

Setup on edge-dev (Helper setup, not the proof itself): SMB mount
`W:` = `\\192.168.3.100\mac` (edgesynology1 write NAS, `popdam` service account
via 1Password `op run`; the stale `ahazan` credential did not work and was not
used again); Helper root mapping `Decor → W:\Decor` (matches server root_id
from `SCAN_ROOTS = /mnt/nas/mac/Decor`); sign-in with the AI tester login
`ai-admin@designflow.app` through the Helper's own IPC (`window.popdam.signIn`),
which registered device `94bab03b-836c-4e19-8331-21f19600ae9a` (edge-dev,
windows, helper_version 1.4.15, registered 2026-11-15 6:59:28 PM EST).

Round trip (all times EST, from the Helper log
`%APPDATA%\POP DAM Helper\Logs\helper-2026-11-15.log` + live rows):

1. **Token (the dam web route):** `POST /functions/v1/helper-api/tokens`
   `{action: "checkout", asset_id: d7bb23e1…}` as the tester — the exact call
   the dam Check Out button makes. Returned `popdam://checkout?token=…&assetId=…`
   (token not recorded anywhere; 5-minute one-time).
2. **Checkout:** deep link received 7:00:43 PM EST → `POST /checkouts/start` →
   `Copying W:\Decor\Character Licensed\…\MOCKUPS\paulfrank_toytest_mockup1.png
   → C:\POP-DAM-Workspace\CheckedOut\0dbdba1d-9797-4366-9b3b-23d96ab4d008\paulfrank_toytest_mockup1.png`
   — the #311 joins (`checkoutDir` + `safePathSegment(checkoutId)` +
   `joinWithinRoot(destDir, safePathSegment(filename))`) executed with the
   live server-supplied checkout id and filename. Workspace copy SHA-256 =
   `620478fe5543a0b584a9ed2612bdfd85efd061e7d10393015db8c6d203a60024`
   = the NAS source hash.
3. **Check-in:** `popdam://checkin?checkoutId=0dbdba1d…` deep link 7:01:56 PM
   EST → the Helper's confirm dialog ("Check in this file?") → Continue
   (clicked via Win32 `BM_CLICK` on the dialog's Continue button — UI
   automation, no human) → snapshot
   (`CheckedOut\… → Snapshots\0dbdba1d…\paulfrank_toytest_mockup1.png`, again
   through the containment joins) → `POST /checkouts/prepare-checkin` →
   smb_local upload (`…png.__pop_uploading_0dbdba1d.tmp` then rename onto the
   asset's original relative path on the NAS) → `POST
   /checkouts/complete-checkin` 7:05:04 PM EST → "Upload complete".
4. **Row (live, read-only query after):** `asset_checkouts`
   `0dbdba1d-9797-4366-9b3b-23d96ab4d008` — `status = complete`,
   `error_message = null`, `upload_method = smb_local`, `checked_out_at`
   7:00:45 PM EST, `checked_in_at` 7:05:05 PM EST, `source_size =
   checkin_size = 1,094,415`, `source_hash =
   1e2c41694cd79a074784427d8d135a35feba4694d30691c9220ea0cf54be859e`
   (the asset's quick_hash — the server's expected hash, unchanged),
   `checkin_hash = 620478fe5543a0b584a9ed2612bdfd85efd061e7d10393015db8c6d203a60024`.
5. **Hash preserved:** `checkin_hash` equals the uploaded object's SHA-256.
   NAS file (SSH `edgesynology1`, `sha256sum`) before checkout and after
   check-in are both `620478fe…60024`, 1,094,415 bytes — byte-identical.

## 4. sg

Re-grep of `src/pages/popsg` and `src/components/popsg` for `checkout`,
`helper-api`, `popdam://` on this tree: **no matches**. PopSG has no checkout
surface (per plan step 4, recorded here instead of a proof). Server-side
helper roots derive from `SCAN_ROOTS = ["/mnt/nas/mac/Decor"]` only — there is
no sg root in the Helper's world either. "From dam and sg" is therefore
satisfied as: dam round trip proven; sg has no checkout surface to break.

## Residual state (left in place deliberately)

- edge-dev Helper 1.4.15 remains installed, signed in as the tester, device
  `94bab03b…` registered; `W:` mount and `Decor → W:\Decor` root mapping kept
  so the station stays usable. Workspace
  `C:\POP-DAM-Workspace\CheckedOut\0dbdba1d…\` + `Snapshots\0dbdba1d…\` hold
  the unmodified copy (normal Helper artifacts).
- The pre-existing Oct-8 active row `749bf8ec…` (ai-admin, asset e1287c4b)
  was left untouched.
- The Oct-11 checkboxes already ticked on #229 stand; this record only covers
  the Helper checkout/check-in line. The ordinary-ingest line remains with the
  2026-11-15 8:33 PM EST scheduled check.

Posted by MiMo chat unknown on desktop
