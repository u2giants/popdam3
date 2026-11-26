# Handoff — #1087 live proof (Helper upload list)

## 1. Goal
Close https://github.com/u2giants/popdam3/issues/1087 with live proof that a torn write of the Helper's upload list keeps pending check-ins through a restart on a real installed Helper.

## 2. State
- Steps 1-5 of https://github.com/u2giants/popdam3/blob/main/docs/plans/issue-1087-helper-upload-queue-failure-paths.md are done: PR https://github.com/u2giants/popdam3/pull/1390 (merge eb5de4c2), Helper 1.4.19 published (Windows + Mac `latest*.yml` serve 1.4.19, verified 2026-11-25 5:48 PM EST).
- Step 6 (live proof) is blocked: no Windows PC reachable from the Linux session; `helper_devices` (2026-11-25 4:27 PM EST) showed no device ≥1.4.16 (edge-dev 1.4.15 newest). Blocked comment: https://github.com/u2giants/popdam3/issues/1087#issuecomment-7175090093

## 3. What was tried
- Local Linux run of Helper 1.4.19 (`electron-vite dev`) with a garbage `upload-queue.json` and no `.bak`: started cleanly, logged "Upload queue unreadable", no crash. Window screen (banner + Repair button, retry/failed notes) checked in a browser preview with sample data only.

## 4. Next action
On a Windows PC (edge-dev likely): install Helper from release `popdam-helper-latest`, then run step 6 of the plan exactly (firewall-block, check in, end process, truncate `%APPDATA%\POP DAM Helper\upload-queue.json`, relaunch, verify restore-from-backup log line + `.corrupt-<ms>` copy + job listed; remove rule; confirm `asset_checkouts` row reaches `complete`). Also exercise "Repair upload list" with no `.bak`.

## 5. Verify
Read-only: `select device_name, helper_version, last_seen_at from public.helper_devices order by last_seen_at desc limit 20;` shows the device on 1.4.19; the check-in row `status = complete`.

## 6. Close-out
Post EST evidence on #1087 (version, device, checkout id, log lines), tick "live proof", close #1087, set plan STATUS step 6 ✅, delete this file.

## 7. Known noise
Root `npx vitest run` had 10 failures outside the Helper (web filter sidebar, order list, useAuth, two windows-agent, one bridge-agent) on 2026-11-25; CI for #1390 was green, so likely environment-local. Not investigated.

## 8. Access
DB token: 1Password `vibe_coding` item "Supabase CLI Personal Access Token", project `qsllyeztdwjgirsysgai`, Management API `database/query/read-only`. PopDAM test login: `vibe_coding`.

## 9. Owner
Next Claude/Codex session on a Windows machine.
