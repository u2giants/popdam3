# Close-nested handoff: Helper fixes tree, round 3 (edge-dev, 2026-11-26)

Written by the coordinator (Claude chat e54e1440 on edge-dev3) at 10:50 AM EST Nov 26 2026. This file replaces the round-2 file `2026-11-26T1525Z-edge-dev3-claude-close-nested-helper-fixes-2.md`. Albert will run the next coordinator **from a session on edge-dev itself**, so that session can do the clicks below with computer use.

## 1. Goal
Finish the live proofs for the POP DAM Helper fixes on edge-dev and close #1392, #1396 and #1423.

## 2. Tree closed
- Coordinator e54e1440, branch `claude/popdam3-coordinator-de8aa9`. It made only this handoff.
- "#1392 Helper self-install proof", branch `claude/jolly-hermann-ca68ab`. Clean, no commits, can be discarded.
- "#1396 Helper check-out proof", branch `claude/loving-lalande-519014`. Clean, no commits, can be discarded.
- "#1423 Helper no-click update install", branch `claude/quizzical-vaughan-1191b5`. Merged as PR #1425, and the remote branch is deleted.

## 3. Landed (verified on GitHub)
- https://github.com/u2giants/popdam3/pull/1425 merged at 15:33Z: Helper 1.4.24. A downloaded update installs and restarts on its own once no files are checked out. The update feed now offers 1.4.24 (child-verified).
- Earlier: PRs #1390, #1402, #1409, #1410 and #1418 (see the round-2 file in git history).
- #1423 was auto-closed by the merge. The coordinator reopened it at 10:49 AM EST because the live proof was still missing.

## 4. Open tasks
All of these need computer use on edge-dev. Do them **in this order** in one session, because each click affects the next proof.

### Task 1: #1392 self-install proof (tray Quit)
- Issue: https://github.com/u2giants/popdam3/issues/1392
- State at 10:33 AM EST: edge-dev runs Helper 1.4.22 (started 1:43 AM EST), and the 1.4.23 download is pending.
- Next action: on edge-dev, click the POP DAM Helper tray icon, then Quit. Wait for it to restart. Then follow steps 1-4 of https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-26T1520Z-edge-dev-claude-1392-helper-self-install-proof.md: the exe version is newer than 1.4.22, the log shows `vX started` with no latest.yml 404, post the evidence, restore the latest label on `popdam-helper-latest`, and close #1392. The updater may install 1.4.23 or 1.4.24; either one proves #1392.
- Done when: the evidence is posted on #1392 and the issue is closed.

### Task 2: #1423 no-click install proof (after Task 1)
- Issue: https://github.com/u2giants/popdam3/issues/1423
- Next action: if Task 1 landed on 1.4.23, do one more tray Quit to reach 1.4.24. Once edge-dev runs 1.4.24, publish 1.4.25 through a version-only bump PR (same pattern as #1418). Then, with no click, watch the log for the download, the automatic install and `v1.4.25 started`.
- Done when: the log proves the no-click move to 1.4.25, the evidence is posted on #1423, and the issue is closed.
- Branch: fresh from main for the bump.

### Task 3: #1396 check-out proof (any time after Task 1's restart)
- Issue: https://github.com/u2giants/popdam3/issues/1396
- State at 10:32 AM EST: no check-out since 08:14Z, no 401s, heartbeats steady.
- Next action: on edge-dev, click Check out on any asset at https://dam.designflow.app (the test asset was `b41f7e0d-96e4-4d63-9c36-8373de614369`). Verify per section 4 of https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-26T1518Z-edge-dev3-claude-1396-checkout-proof.md. Check the asset back in afterwards, because an outstanding check-out blocks the no-click install in Task 2.
- Done when: a new `asset_checkouts` row dated after 08:14Z Nov 26 exists, the Helper log shows that check-out with no 401, the evidence is posted on #1396, and the issue is closed.
- Blocker found: the read-only database check failed. The pooler password in 1Password item `qbvfk7umc3n75ejekd65zwd4ty` was rejected, and no item named "Supabase CLI Personal Access Token" exists in vibe_coding. Find a working read-only credential (search vibe_coding for a Supabase access token) before verifying. Never ask Albert to create one.

## 5. Child handoffs
- https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-26T1520Z-edge-dev-claude-1392-helper-self-install-proof.md
- https://github.com/u2giants/popdam3/blob/main/HANDOFF.d/2026-11-26T1518Z-edge-dev3-claude-1396-checkout-proof.md

## 6. Edge-dev rules
- Never install Helpers by hand and never force-kill the Helper.
- Logs are at `C:/Users/ahazan/AppData/Roaming/POP DAM Helper/Logs/helper-<date>.log`, in UTC.

## 7. Secrets
No new secrets.

## 8. Retention
Delete this file, the round-2 file and the 0415Z coordinator file once #1392, #1396 and #1423 are closed with live proof.
