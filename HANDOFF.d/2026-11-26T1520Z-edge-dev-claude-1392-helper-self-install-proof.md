# Handoff: #1392 Helper auto-update — final self-install proof

## 1. Goal
Close https://github.com/u2giants/popdam3/issues/1392. Done-when: an installed older Helper **finds and installs** a newer Helper while a Windows-agent release is GitHub's "latest", with no latest.yml 404 in its log.

## 2. State (verified 2026-11-26 10:17 AM EST)
- Root cause: the GitHub update provider follows `releases/latest`; `publish-windows-agent.yml` creates `windows-agent-latest` with `--latest` (no latest.yml). That the Helper worked earlier was luck.
- Fix merged: https://github.com/u2giants/popdam3/pull/1409 (1.4.21), which pins the feed with generic `setFeedURL` to `releases/download/popdam-helper-latest/` (https://github.com/u2giants/popdam3/blob/main/apps/popdam-helper/src/main/main.ts).
- Also merged: https://github.com/u2giants/popdam3/pull/1410 (1.4.22, #1396) and https://github.com/u2giants/popdam3/pull/1418 (1.4.23, version-only, for this proof).
- `releases/latest` = `windows-agent-latest`, set on purpose for the proof.
- edge-dev runs 1.4.22. Its log shows `06:43:28Z Found version 1.4.23`, then the download, with no latest.yml 404. The 1.4.23 installer waits in the updater's `pending` folder.
- Evidence comment so far: https://github.com/u2giants/popdam3/issues/1392#issuecomment-7184140978

## 3. Blocker
electron-updater installs only on a normal app quit. Tried and failed: a force kill (it skips the install) and `taskkill /PID` without /F from an interactive scheduled task (ignored, since no window is open). The Helper has no quit command reachable through a second instance or a popdam:// link. No session has computer use on edge-dev. Albert must click the POP DAM Helper tray icon → Quit on edge-dev (the coordinator is asking him).

## 4. Next steps
1. After the Quit click, wait about 60 s, then over ssh edge-dev check that the version of `%LOCALAPPDATA%\Programs\popdam-helper\popdam-helper.exe` is 1.4.23. If the Helper isn't running, start it through an interactive scheduled task (`schtasks /create ... /it`, then `/run`).
2. Grep today's `%APPDATA%\POP DAM Helper\Logs\helper-<date>.log` for `v1.4.23 started`, and confirm it has no `latest.yml` 404 (the blockmap 404 is harmless).
3. Post the evidence on #1392, restore the latest label (`gh api -X PATCH repos/u2giants/popdam3/releases/<id of popdam-helper-latest> -f make_latest=true`), and close #1392.
4. Tell the #1396 session and the coordinator.

## 5. Tips
- Run PowerShell over ssh with `-EncodedCommand` (UTF-16LE base64). Plain quoting gets mangled by cmd.
- Never force-kill the Helper (coordinator rule). The quit guard shows a dialog if checkouts are outstanding.
- No 1.4.21 installer exists anywhere anymore; don't try a downgrade.

## 6. Follow-up idea (not started)
Add a quit path that doesn't need the tray (for example a `popdam://quit`, or `autoUpdater.quitAndInstall()` after a download when the Helper is idle), so updates install without a user quit. Needs its own issue.
