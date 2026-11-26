# Close-nested handoff: Helper upload-queue proof tree (edge-dev, 2026-11-26)

Written by Claude Code chat 5e9c8923 on edge-dev, 11:15 PM EST Nov 25 2026.
Repo: https://github.com/u2giants/popdam3. Two Helper bugs remain open: #1392 and #1396. Albert asked for their fixes to be carried forward ("include in the handoff the fix for the other two bugs").

## 1. Goal
Fix the last two POP DAM Helper defects found during the #1087 live proof, then prove each fix live on a real installed Helper on edge-dev.

## 2. Tree closed
- The coordinator was Claude Code chat 5e9c8923, on worktree branch `claude/helper-upload-queue-proof-082dfc`. It made no code commits, its worktree is clean, and the branch can be discarded.
- Child session "Fix stuck failed Helper uploads (#1401)", branch `claude/recursing-swirles-a344e2`, is done: PR #1402 is merged, and the coordinator verified its live proof.

## 3. Landed (verified)
- #1087, crash-safe upload list. The live proof passed on Helper 1.4.18, and the issue is closed. Evidence: https://github.com/u2giants/popdam3/issues/1087#issuecomment-7181863002
- #1401, a failed check-in can be retried. Fixed by https://github.com/u2giants/popdam3/pull/1402, merged 10:44 PM EST Nov 25 and released as Helper 1.4.20. The live proof passed: checkout `75dff9a3-...` reached `complete` at 10:58 PM EST, which the coordinator checked in the database. The issue is closed.
- edge-dev now runs Helper 1.4.20. W: is mapped to `\\192.168.3.100\mac`, using the 1Password item "edgesynology1 NAS - popdam service account" in vault vibe_coding.

## 4. Open tasks

### Task A: #1392, Helper auto-update checks the wrong release
- Issue: https://github.com/u2giants/popdam3/issues/1392
- Problem: the updater asked for the repository's newest GitHub release, which was `windows-agent-latest` (no latest.yml). It got a 404, so installed Helpers never updated.
- New evidence, which may mean it is already fixed: tonight's Helper 1.4.18 log on edge-dev, `2026-11-26T03:29:49Z`, shows `Found version 1.4.19 ... popdam-helper-latest` followed by a successful download. The blockmap 404 is harmless because it falls back to a full download. Config: https://github.com/u2giants/popdam3/blob/main/apps/popdam-helper/electron-builder.yml#L68-L72 (`releaseType: release`, no channel or tag pin).
- Next action: find out whether the fix is structural or just luck. Did the newest release happen to be `popdam-helper-latest` at that moment? Check `gh release list -R u2giants/popdam3` and the updater feed code under https://github.com/u2giants/popdam3/tree/main/apps/popdam-helper/src/main. If it is luck (a newer Windows-agent release would break it again), pin the Helper feed to the `popdam-helper-latest` tag with a generic `setFeedURL` or a dedicated channel, then ship a Helper version through PR.
- Done when: an installed older Helper finds and installs the newer Helper while a newer Windows-agent release exists, with no latest.yml 404 in its log. Post the evidence on #1392 and close it.
- Branch: fresh from main. No blockers.

### Task B: #1396, Helper sign-in expires after one hour
- Issue: https://github.com/u2giants/popdam3/issues/1396
- Problem: every call returns 401 starting one hour after sign-in, until the user signs in again. Checkouts, check-ins and heartbeats all fail.
- Likely cause: `storeSession`/`loadSession` in https://github.com/u2giants/popdam3/blob/main/apps/popdam-helper/src/main/credentials.ts#L101-L115 keep a refresh token, but https://github.com/u2giants/popdam3/blob/main/apps/popdam-helper/src/main/damClient.ts has no refresh path. Also check `oauth.ts` and `ipc.ts`.
- Next action: when a call returns 401, or before the token expires, refresh the session with the stored refresh token through Supabase auth, store the new pair, and retry the call once. If the refresh fails, show the normal signed-out state. Add unit tests. Ship as the next Helper version through PR.
- Done when: an installed Helper on edge-dev stays signed in for more than 2 hours with successful heartbeats and no 401 in the log, and a check-out works after that. Post the evidence on #1396 and close it.
- Branch: fresh from main. Albert must sign the Helper in once, which he has been doing. Doing A and B in parallel is fine. They touch different files, but both bump the Helper version, so expect a version conflict and rebase the second one.

## 5. Things that work on edge-dev (learned the hard way)
- The Chrome extension's Browser 1 is on edge-dev. Other browsers are on other machines.
- Checkout tokens expire within seconds. Mint them on a click from the dam.designflow.app page, using the user's session, POST `helper-api/tokens`, then go to the returned URL.
- To check in a file, run the Helper exe with `popdam://checkin?checkoutId=<id>`. A Continue dialog opens and needs one computer-use click. Computer use fails while the screen is locked, so ask Albert to unlock it.
- To disconnect W:, run `Remove-PSDrive W` and then `net use W: /delete /y`. To remap it, use pwsh `New-PSDrive -Persist` with the credentials through op_run. `net use` with a UNC path fails from Git Bash.
- The Helper log is `%APPDATA%\POP DAM Helper\Logs\helper-<date>.log`, with timestamps in UTC.

## 6. Verification query
Read-only, through the Supabase Management API: `select id, status, checked_in_at from public.asset_checkouts order by created_at desc limit 3;`

## 7. Secrets
No new secrets. All credentials used live in 1Password vault vibe_coding.

## 8. Not done or out of scope
Nothing else is open in this tree.

## 9. Retention
Delete this file once #1392 and #1396 are both closed with live proof.
