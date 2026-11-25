---
summary: "Finish the Helper's crash-safe check-in retry list: an unreadable list must never crash the Helper, blank its window or hide a stuck check-in, then prove a 1.4.16+ Helper in use."
kind: plan
status: open
read-when: "implementing or proving #1087 (Helper upload queue), or the folded review findings #1128 and #1148"
---

# Issue #1087 — Helper check-in retry list survives interruptions and damage

Covers [u2giants/popdam3#1087](https://github.com/u2giants/popdam3/issues/1087) and the folded review findings
[#1128](https://github.com/u2giants/popdam3/issues/1128) (review of PR #1125) and
[#1148](https://github.com/u2giants/popdam3/issues/1148) (review of PR #1138). Handoff that registers this plan:
[HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md](../../HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 0. Crash-safe write/read store | ✅ done | `apps/popdam-helper/src/main/queueStore.ts` on main; PR #1125 (merge in main history), tests in `apps/popdam-helper/src/main/queueStore.vitest.ts` |
| 0b. Released to Helpers | ✅ done | Helper 1.4.16 via PR #1138; main now ships `HELPER_VERSION = "1.4.18"` (`apps/popdam-helper/src/shared/constants.ts:1`) |
| 1. Guard every queue consumer | ✅ done | branch claude/helper-queue-failure-paths |
| 2. Show stuck/failed retries in the window | ✅ done | branch claude/helper-queue-failure-paths |
| 3. Repair path for an unreadable list | ✅ done | branch claude/helper-queue-failure-paths |
| 4. Tests for the failure paths | ✅ done | branch claude/helper-queue-failure-paths |
| 5. Release a Helper patch | 🟡 PR open | Helper 1.4.19 |
| 6. Live proof | ⬜ open | |

**Next: merge, confirm release, then step 6 on a Windows PC.**

## 1. Ultimate goal

When a designer checks a file back in, the Helper keeps a small "still to upload" list on their computer so the upload is retried if the network drops or the computer restarts. That list must never lose a pending check-in, and if it is ever damaged the Helper must keep running, tell the designer plainly what happened, and keep their work safe — never crash, never show a blank window, never silently stall. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM is POP Creations' internal library of licensed product artwork (Disney, Marvel…). Source files live on a Synology NAS. The **PopDAM Helper** (`apps/popdam-helper/`) is an Electron desktop tray app (Windows + Mac) that designers use to Check Out a file (lock it, copy it to a local workspace) and Check In (snapshot the edited file, upload it back to the NAS or Seafile, unlock). Repo `u2giants/popdam3`, release branch `main`. Helper builds are published as GitHub Releases (`popdam-helper-latest`) by `.github/workflows/publish-popdam-helper.yml`; installed Helpers update themselves at launch via electron-updater. Installers are unsigned forever (owner decision). The server side is the Supabase edge function `supabase/functions/helper-api/` on shared project `qsllyeztdwjgirsysgai`. Docs: `docs/POPDAM_HELPER.md`.

## 3. What triggered this work

November 18 audit finding 7: the Helper rewrote `upload-queue.json` directly, so a write interrupted by a crash/power loss left a truncated file that read as empty, and the next enqueue overwrote it — losing pending check-ins. PR #1125 fixed the store. Two advisory reviews then found that the fix made the read **throw** on an unreadable file, and three of four callers do not handle the throw:

- `processQueue()` is called fire-and-forget at `apps/popdam-helper/src/main/main.ts:190` and from `enqueue()` at `apps/popdam-helper/src/main/uploadQueue.ts:117`; its `try/finally` (`uploadQueue.ts:126-139`) has no `catch`, so an unreadable queue becomes an unhandled promise rejection in the Electron main process (startup error dialog or crash). It also stops the loop mid-run if the file goes bad while jobs retry.
- `getPendingJobs()` (`uploadQueue.ts:290`) is called by the `get-checkouts` IPC handler (`apps/popdam-helper/src/main/ipc.ts:64-72`) with no try/catch; the window's `refresh()` (`apps/popdam-helper/src/renderer/TrayPanel.tsx:58-68`) awaits it unguarded, so the window never shows checkouts.
- `enqueue()` throws inside `checkin()` (`apps/popdam-helper/src/main/checkoutManager.ts:372`); that catch resets the checkout to `active` and rethrows a raw "Upload queue unreadable and no usable backup: SyntaxError…" message with no remediation, after the server already moved the checkout to `checkin_queued`.
- `uploadJobs` (status + retryCount) is loaded into the window but never rendered (`TrayPanel.tsx:195` assigns `uploadJob` and never uses it), so a job stuck `pending`/`failed` still shows "Uploading…".
- Upgrade case: a user upgrading from ≤1.4.15 with a truncated file has **no `.bak`**, so the throw path is reachable on first launch.
- Minor: `.bak` is the pre-write copy, so after `removeJob()` the backup still holds the just-finished job; if the primary is later damaged, that job is restored and re-run (duplicate upload / spurious failure dialog).
- #1148 also noted the release text claimed installed Helpers pick up the fix; they only do on next launch (`checkForUpdatesAndNotify()` runs once at startup, `main.ts` ~226).

Live proof from #1087 is also still open: no Helper had been confirmed reporting ≥1.4.16 in `helper_devices` (last check 2026-11-23, no DB access).

## 4. Scope

In: the Helper main-process queue consumers, the tray window's display of retry state, a safe repair action for an unreadable list, tests, one Helper patch release, live proof.
**NOT in this plan:** the server route `complete-checkin` idempotency (that is [#1116's plan](issue-1116-complete-checkin-idempotent-retry.md)); retry-record content (cleanup plan [issue-1200-09](issue-1200-09-check-in-retry-records.md), already merged); moving the queue to SQLite or any native module; signing installers; changing the auto-update cadence beyond a release note; any shared-db change.

## 5. Current state of the code (main @ 787c20b8)

- `apps/popdam-helper/src/main/queueStore.ts` — `readQueueFile` (missing → backup or `[]`; unreadable primary → restore `.bak` and copy the bad file aside as `.corrupt-<ms>`; unreadable with no backup → throw `QueueUnreadableError`). `writeQueueFile` writes `.tmp`, validates, copies the good primary to `.bak`, renames. Sound; keep.
- `apps/popdam-helper/src/main/uploadQueue.ts` — `initQueue` (catches and logs, lines 36-45), `readJobs` (throws, 94-98), `enqueue` (106-118), `processQueue` (122-139), `processJob`, `updateJob`/`removeJob` (276-288), `getPendingJobs` (290-296).
- Callbacks wired in `main.ts:150-187` (progress, verifying, failed → `markUploadFailed`, notification, dialog).
- Tray tooltip `apps/popdam-helper/src/main/tray.ts:144-161` derives state only from checkouts, never from queue health.
- Tests: `apps/popdam-helper/src/main/*.vitest.ts`, run by the root `vitest.config.ts` project that includes `apps/**/src/**/*.vitest.ts` (`npm test` at repo root).

## 6. Key findings and root cause

Root cause: PR #1125 correctly changed the read contract from "never throws, returns []" to "throws when unreadable" (so damage is never mistaken for empty), but did not update the callers. The fix is at the caller layer, not in `queueStore.ts`. The unhandled-rejection path is real on Electron 31 (Node unhandled rejections are fatal by default in main).

## 7. Approaches considered and rejected

- **Return `[]` again on unreadable** — rejected: that is the original data-loss bug (next enqueue overwrites the damaged file).
- **Auto-delete or auto-reset the damaged file** — rejected: destroys the only copy of the pending work; the snapshot path inside it is how the user's edit is found.
- **Wrap everything in one global `process.on('unhandledRejection')`** — rejected as the fix: it hides the failure instead of telling the user. A last-resort logger is fine in addition.
- **Dedupe guard against `.bak` resurrection via server lookup** — rejected for now: the server route is idempotent for the same upload hash once #1116 lands; a duplicate run is acceptable. Instead step 3 makes the backup hold the *post*-write list (see step 1d).

## 8. Design decisions

Locked (2026-11-25, this plan; consistent with #1087 acceptance):
- An unreadable list with no backup is **kept on disk untouched** until the user chooses the repair action.
- While the list is unreadable, new check-ins are refused with a plain message and the checkout stays checked out locally (edits safe); they are not silently dropped.
- Retry delays stay as they are (`UPLOAD_RETRY_DELAY_MS * retryCount`, well under 30 minutes). No new hold may exceed 30 minutes.
Open (implementer's judgment): wording of messages (plain, non-technical, mention "your edits are safe"); whether the repair action lives in the tray menu, the window, or both (criterion: reachable when the window cannot list checkouts).

## 9. The plan

**Step 1 — Guard every queue consumer (lead-only: changes failure behaviour of a production desktop app).**
a. `uploadQueue.ts`: add exported `getQueueHealth(): { ok: true } | { ok: false; message: string }` that tries `readJobs()` and caches the last error. Add module state `queueError: string | null` set whenever a read throws.
b. `processQueue()`: add `catch (e)` that records `queueError`, logs once, calls a new `setQueueErrorCallback` listener (wired in `main.ts` to `sendToRenderer("checkouts-changed")` + `updateTrayIcon()` + one notification), and returns normally. Change both call sites (`main.ts:190`, `uploadQueue.ts:117`) to `void processQueue().catch(...)` belt-and-braces.
c. `getPendingJobs()`: on throw return `[]` **plus** expose the error via `getQueueHealth()`; `ipc.ts` `get-checkouts` returns `{ ok: true, data: { checkouts, uploadJobs, queueError } }` and is wrapped in try/catch returning `{ ok: false, error }` for anything else. Update the type in `apps/popdam-helper/src/shared/types.ts` and `preload/index.ts`. Note returning `[]` here is display-only — it is never written back.
d. `enqueue()`: before reading, if the list is unreadable, throw a typed `QueueUnreadableError` whose message is the plain sentence: "PopDAM Helper can't read its list of pending uploads. Your edits are safe in your workspace. Use 'Repair upload list' and check in again." `checkin()` already resets to `active`. Server state: helper-api has no "undo prepare-checkin" route (routes at `supabase/functions/helper-api/index.ts:735-746`); do not call `/checkouts/discard` (it releases the lock). Leave the server row as is and say so in the PR; confirm in testing that a later check-in of the same checkout succeeds from `checkin_queued` (stop-and-flag if not).
e. `writeQueueFile` ordering (`queueStore.ts:69`): copy to `.bak` **after** the rename succeeds (copy the new primary), so the backup equals the latest good list and cannot resurrect removed jobs. Keep the validate-before-replace step.
Verify: step 4 tests pass; manually, with a garbage `upload-queue.json` and no `.bak` in the Helper userData folder, `npm run dev` in `apps/popdam-helper` starts with no error dialog and the window lists checkouts.

**Step 2 — Show retry state in the window and tray (helper-ok: UI wiring with exact targets).** In `TrayPanel.tsx`, use `uploadJob` (line 195): show "Retrying upload (attempt N of 5)" when `status === "pending" && retryCount > 0`, "Upload failed — check in again" when `status === "failed"`. When `queueError` is set, show a top banner with the message and a "Repair upload list" button. `tray.ts:updateTrayIcon` shows "Error" when `getQueueHealth().ok === false`. Stop-and-ask: any change to checkout status values or server calls. Verify: screenshot of the window with a seeded failed job and with a damaged list.

**Step 3 — Repair action (lead-only: touches the user's only copy of pending work).** New IPC `repair-upload-queue` → `uploadQueue.repairQueue()`: rename the damaged file to `upload-queue.json.corrupt-<ms>` (never delete), write `[]` with `writeQueueFile`, clear `queueError`, log the aside path, then for every local checkout still in `uploading` with a `snapshotPath` that exists, set it back to `active` so the user can check in again. Verify: unit test in step 4 plus manual run shows the aside file kept and the checkout card back to "Check In".

**Step 4 — Tests (helper-ok).** Add `apps/popdam-helper/src/main/uploadQueue.vitest.ts` with `vi.mock("electron", () => ({ app: { getPath: () => tmpDir } }))` and mocks for `./damClient`, `./synologyClient`, `./credentials`, `./logger`:
- `processQueue resolves (does not reject) when the queue file is garbage and no backup exists`
- `getPendingJobs returns [] and getQueueHealth reports the error for an unreadable queue`
- `enqueue throws QueueUnreadableError with the plain message and leaves the damaged file byte-identical`
- `repairQueue keeps the damaged file aside and leaves an empty readable queue`
- in `queueStore.vitest.ts`: `backup equals the latest written list after a removal`.
Stop-and-ask: if mocking Electron requires changing production module structure. Verify: `npx vitest run apps/popdam-helper` green; root `npm test` green; `npm run typecheck` (or `npx tsc -p apps/popdam-helper/tsconfig.node.json --noEmit`) green.

**Step 5 — Release (lead-only).** Bump `apps/popdam-helper/package.json` version and `HELPER_VERSION` together (test `src/test/helper-version.test.ts` enforces sync). Release body must say installed Helpers update at their next launch. Merge; confirm `Publish PopDAM Helper` workflow green and `latest.yml` serves the new version (`gh release view popdam-helper-latest -R u2giants/popdam3`).

**Step 6 — Live proof (lead-only judgment).** Read-only query on production: `select device_name, helper_version, last_seen_at from public.helper_devices order by last_seen_at desc limit 20;` (columns written by `supabase/functions/helper-api/index.ts:101-102`). Proof = at least one Helper on the new version with a check-in that reached `complete` after its update (`asset_checkouts.checked_in_at` later than that device's update). Post on #1087 with EST times, tick `- [ ] live proof`, close #1087. If no Helper has relaunched, report `Waiting on —` the designer machines with last-seen time; never more than one "still waiting" turn — use the weekly routine named in `HANDOFF.d/2026-11-20T1352Z-hetz-claude-close-nested-priority-issues.md`.

## 10. Tests required

New tests listed in step 4 (names exact). Existing suites that must stay green: root `npm test` (includes all `apps/**/src/**/*.vitest.ts`), `apps/popdam-helper` typecheck/build (`npm run build` in that folder), `src/test/helper-version.test.ts`.

## 11. Constraints, standing rules, gotchas

Feature branch + PR to protected `main`; the AI merges after required checks; reviews are advisory. No shared-db change. Never delete user data files — rename aside. Helper installers stay unsigned. Do not hand-edit `apps/*/src/common/` (generated). Electron main-process rejections are fatal — every floating promise needs `.catch`. Visual check of the tray window for step 2. Times in EST on GitHub. Sign GitHub posts with `$AI_GH_SIGNATURE` (if unset, end with "Posted by <tool> chat <id> on <machine>").

## 12. Access and environment

`gh` authenticated as `u2giants`. Local run: `cd apps/popdam-helper && npm ci && npm run dev`. Helper userData folder: Windows `%APPDATA%\POP DAM Helper\`, Mac `~/Library/Application Support/POP DAM Helper/` (confirm via `app.getPath("userData")` log line). Production reads need the Supabase MCP or `SUPABASE_ACCESS_TOKEN` (1Password vault `vibe_coding`, item for the shared Supabase project); never paste values.

## 13. Definition of done, risks, open questions

Done: steps 1-5 merged, CI green, release `popdam-helper-latest` serves the new version, step 6 proof posted, #1087 closed, plan STATUS updated with PR/commit/run ids. Risk: refusing check-ins while the list is unreadable blocks a user until they press Repair — acceptable and explicit. Rollback: previous Helper release stays downloadable; revert the PR and re-publish with a higher version. Open: none beyond the step-1d test confirmation.

## Self-audit

1. Fresh session can execute without asking? Yes — §3 lists every failing caller with line refs, §9 names files/functions/tests, §12 gives run commands. Gap fixed: added the upgrade-without-backup case and the `.bak` ordering fix.
2. All background carried, including rejections? Yes — §7 records the four rejected options and why; §3 carries both review findings.
3. Goal clear enough for judgment calls? Yes — §1 states "never lose pending work, never crash/blank/stall", which decides e.g. whether to auto-reset (no).

## Lead launch prompt

```
Read docs/plans/issue-1087-helper-upload-queue-failure-paths.md (STATUS first) in u2giants/popdam3, then AGENTS.md.
You (lead) do steps 1, 3, 5, 6. Hand steps 2 and 4 to your helper after step 1 lands on your branch.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges or GitHub posts; bring back any stop-and-ask trigger named in the step; if stuck 30 minutes, you take the step back.
You verify yourself: run the step-4 tests and root npm test, screenshot the tray window (step 2), confirm the release workflow and latest.yml, run the step-6 read-only query.
Delegation rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
```
