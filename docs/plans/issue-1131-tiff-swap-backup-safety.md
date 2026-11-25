---
summary: "Make the Windows agent's TIFF compression swap fail closed: never overwrite an existing backup or _big original, report true errors with a dedicated code, and prove it through the whole job."
kind: plan
status: open
read-when: "implementing #1131 (Windows agent TIFF swap / rollback findings from PR #1130)"
---

# Issue #1131 — TIFF compression never risks the only copy of an original

Covers [u2giants/popdam3#1131](https://github.com/u2giants/popdam3/issues/1131) (advisory review of PR #1130, the fix for #1086). Handoff:
[HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md](../../HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 1. Fail closed before the first move | ⬜ open | |
| 2. Honest errors + dedicated codes | ⬜ open | |
| 3. Safe test-mode rollback | ⬜ open | |
| 4. One cleanup owner for the temp file | ⬜ open | |
| 5. Whole-job tests | ⬜ open | |
| 6. Release + live proof | ⬜ open | |

**Fresh session starts at step 1.** All findings still present on main 787c20b8 (checked 2026-11-25).

## 1. Ultimate goal

PopDAM can shrink very large TIFF artwork files on the NAS to save space. The original artwork is irreplaceable. Whatever goes wrong — a locked file, a leftover backup from an earlier run, a network share hiccup — the original must still exist, at its normal place or at a clearly reported backup place, and the job's error must say truthfully where it is. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, branch `main`) manages licensed artwork on a Synology NAS. The **Windows render agent** (`apps/windows-agent/`) runs on Windows machines in the office, claims jobs from the server (`agent-api` edge function), and works on NAS files over SMB. One job type is TIFF compression: `compressTiff` in `apps/windows-agent/src/tiff-optimizer.ts`, invoked from `apps/windows-agent/src/index.ts:1152`. Modes: **test** (keep the original beside the file as `<base>_big<ext>`) and **process** (keep a temporary `<file>.popdam_backup`, delete it after a verified swap). The agent ships via `.github/workflows/publish-windows-agent.yml` on any `apps/windows-agent/**` change on main (GitHub Release `windows-agent-latest`, agents self-update).

## 3. What triggered this work

PR #1130 (fix for #1086) added `swapInCompressed` (`tiff-optimizer.ts:659-686`): move original → backup, move compressed temp → original path, and on failure move the backup back. Review (deepseek, body of #1131) plus the review-fixer verification comment found:
1. **Overwrite risk.** Node's `fs.rename` on Windows uses `MoveFileEx` with replace-existing, so if `<base>_big<ext>` (test mode) or `<file>.popdam_backup` (process mode) already exists from an earlier run, the first move **replaces it** — in test mode that existing `_big` may be the only true original (the current file is already a compressed copy). Nothing checks the destination is free.
2. If the **first** move fails, the error path still says "original is at backup path" (misleading); it never moved.
3. Rollback failures are a plain `Error`; the job result has no dedicated `error_code` (`index.ts:1152-1190` passes through `result.error_code`), so triage cannot find "original only at backup".
4. On restore failure the helper keeps the temp file, on the other branch deletes it; the outer catch in `compressTiff` (`:418`) deletes it anyway — inconsistent ownership.
5. Test-mode `safeRollback` (`:708-719`) deletes the current file before moving `_big` back; if that move fails the failure is only logged and the job still reports a normal timestamp failure.
6. No test drives a failed swap through `compressTiff`/process mode.

## 4. Scope

In: `swapInCompressed`, `handleTestMode`, `handleProcessMode`, `safeRollback`, `atomicRollback`, the catch in `compressTiff`, new error codes, tests, agent release. **NOT in this plan:** compression settings, page verification (`verifyTiffPagesPreserved`), timestamp logic (`tiff-timestamps.ts`), the TIFF request routes (cleanup [issue-1200-10](issue-1200-10-tiff-agent-requests.md)), scanning, any server or DB change. `TIMESTAMP_ERROR` lives in `tiff-timestamps.ts`; adding constants there is allowed, changing existing ones is not.

## 5. Current state of the code (main @ 787c20b8)

`apps/windows-agent/src/tiff-optimizer.ts`: `compressTiff` 311-427 (catch at 417-426 unlinks temp); `handleTestMode` 467-534 (`bigPath` 477, swap 479, rollback 490); `handleProcessMode` 538-650 (`backupPath` 564, swap 568, `atomicRollback` 585); `swapInCompressed` 659-686 (injectable `renameFn`); `atomicRollback` 689-705; `safeRollback` 708-719. Tests: `apps/windows-agent/src/tiff-swap.test.ts` (3 cases, node:test), `tiff-optimizer-pages.test.ts`; both listed in `apps/windows-agent/package.json` `test` script.

## 6. Key findings and root cause

The swap assumes rename-to-existing fails (POSIX-like expectation), but on Windows it replaces. So safety must come from checking the destination before moving, not from rename semantics. Error reporting was built around one failure order and mislabels the others.

## 7. Approaches considered and rejected

- **Rely on `rename` failing when the destination exists** — rejected (finding 1; Windows replaces).
- **Copy instead of rename for the backup** — rejected: doubles I/O on multi-GB files over SMB and still needs the destination check.
- **Auto-delete a stale `.popdam_backup` / `_big`** — rejected: it may be the only original.
- **Unique backup names (timestamped)** — rejected for test mode: `_big` is a user-visible, documented name and `deleteOriginalBackup` (`:723-735`) depends on it. Acceptable for process mode only if the implementer prefers it over failing (open decision below).

## 8. Design decisions

Locked (2026-11-25):
- If the backup destination exists, the job fails **before any move** with `error_code: "TIFF_BACKUP_EXISTS"`, message naming the path, all files untouched.
- New codes (add to `TIMESTAMP_ERROR` or a new `TIFF_SWAP_ERROR` const in `tiff-optimizer.ts`): `TIFF_BACKUP_EXISTS`, `TIFF_SWAP_FAILED_RESTORED` (original back at its path), `TIFF_ORIGINAL_AT_BACKUP` (manual intervention: original only at backup path; message names it).
- `swapInCompressed` returns/throws a typed result carrying the code; callers map it into `TiffJobResult.error_code`.
- Temp-file cleanup is owned by `compressTiff`'s catch only; `swapInCompressed` never deletes the temp file.
- Test-mode rollback moves `_big` back **without deleting first** where possible: rename current compressed file aside to `<file>.popdam_rollback`, move `_big` → file, then delete the aside; if the second move fails, move the aside back and report `TIFF_ORIGINAL_AT_BACKUP` with the `_big` path.
Open: process mode — fail closed on an existing `.popdam_backup` (default) or pick a unique backup name; criterion: whichever never overwrites and keeps `atomicRollback` simple. Default to fail closed.

## 9. The plan

**Step 1 — Destination check (lead-only: protects originals).** At the top of `swapInCompressed`, `await stat(backupPath)`; if it exists throw `SwapError("TIFF_BACKUP_EXISTS", ...)`. If the first `renameFn` throws, throw `SwapError("TIFF_SWAP_FAILED_RESTORED", "could not move original; nothing changed: …")` (original untouched). Use an injectable `statFn` like `renameFn` for tests. Verify: new tests in step 5.

**Step 2 — Codes through to the job (lead-only).** In `handleTestMode`/`handleProcessMode`, catch `SwapError` and return a `TiffJobResult` with `success:false`, `error_code`, `timestamp_restore_status:"skipped"`, and for `TIFF_ORIGINAL_AT_BACKUP` include the backup path in `error`. Check `index.ts:1152-1190` forwards `error_code` (it does) — no change there. Verify: whole-job test asserts `error_code`.

**Step 3 — Safe test-mode rollback (lead-only).** Rewrite `safeRollback` per §8 and make it return `boolean`; when false, `handleTestMode` returns `error_code: "TIFF_ORIGINAL_AT_BACKUP"`. Verify: test with rename failing on the `_big`→file move leaves the compressed copy at the file path and the original at `_big`, and the result names `_big`.

**Step 4 — Temp ownership (helper-ok).** Remove `unlink(tempPath)` from `swapInCompressed` (line 683) and rely on `compressTiff`'s catch (line 418) — but ensure the catch runs: `handleTestMode`/`handleProcessMode` returning a failure result (not throwing) must also unlink `tempPath` if it still exists. Stop-and-ask: if any path leaves the compressed temp as the only compressed artefact the result depends on. Verify: tests assert no `.tmp` residue in the directory listing.

**Step 5 — Tests (helper-ok).** Extend `apps/windows-agent/src/tiff-swap.test.ts` (node:test, real temp dirs):
- `existing backup: swap refuses before moving anything (TIFF_BACKUP_EXISTS)` — `_big` pre-exists with "OLDORIGINAL"; after call both files unchanged.
- `first rename fails: error says nothing changed, original in place`
- `second rename fails: original restored, temp cleaned by caller`
- `second rename and restore fail: TIFF_ORIGINAL_AT_BACKUP names backup path`
Add `apps/windows-agent/src/tiff-job-swap.test.ts` driving `handleProcessMode`/`handleTestMode` through an exported test seam (export them or add `__test` export) with injected rename/stat: `process mode failed swap leaves art.tif = ORIGINAL and no .popdam_backup`, `test mode rollback failure reports _big path`. Add the new file to the `test` script in `apps/windows-agent/package.json`. Stop-and-ask: if exporting needs signature changes beyond adding optional injected fns. Verify: `cd apps/windows-agent && npm test` green.

**Step 6 — Release and live proof (lead-only).** Merge → `publish-windows-agent.yml` green → agents report the new version in heartbeat (`agent_registrations` metadata / Settings → Agents screen on https://dam.designflow.app). Live proof: run one test-mode compression on a disposable TIFF copy in a scratch NAS folder that already has a `<base>_big.tif`; confirm job fails with `TIFF_BACKUP_EXISTS` and both files are byte-identical (compare sizes/hashes before/after). Post on #1131 with EST times; close it.

## 10. Tests required

Four new cases in `tiff-swap.test.ts`, two in new `tiff-job-swap.test.ts` (names above). Existing: full `apps/windows-agent` `npm test` (includes `tiff-optimizer-pages.test.ts`, `tiff-timestamps.vitest.ts`), `npx tsc -p apps/windows-agent --noEmit`.

## 11. Constraints, standing rules, gotchas

Never delete or overwrite an original in any code path. Windows rename replaces existing files; tests on Linux CI will not reproduce that — the destination check must not depend on rename behaviour. SMB paths: keep using `path.join` and existing helpers. Branch + PR; AI merges; reviews advisory. Do not edit `apps/windows-agent/src/common/` (generated from `packages/agent-common`). Sign GitHub posts with `$AI_GH_SIGNATURE`.

## 12. Access and environment

`gh` as `u2giants`. Local: `cd apps/windows-agent && npm ci && npm test`. Live proof needs a Windows render agent online and a disposable TIFF in a scratch folder on the NAS (ask nothing of Albert; use an existing test folder documented in `docs/verification/` or create one under a scratch path the agent can reach). Admin web login for the Agents screen: 1Password `vibe_coding`, PopDAM admin test login item; never paste values.

## 13. Definition of done, risks, open questions

Done: steps 1-5 merged, CI green, Windows agent release published and heartbeat shows it, live proof posted, #1131 closed, STATUS updated with PR/run ids. Risk: jobs on files with leftover backups now fail instead of proceeding — intended; the message tells the admin which file to inspect. Rollback: revert PR; the publish workflow ships the previous code with a new build. Open: process-mode unique name vs fail-closed (§8, default fail closed).

## Self-audit

1. Executable without questions? Yes — §8 locks codes and behaviour; §9 names functions/lines/tests; §12 commands.
2. Background carried? Yes — §3 covers all six findings incl. the Windows rename fact; §7 the rejected options.
3. Goal clear? Yes — "original always exists and is truthfully reported" decides any unlisted case.

## Lead launch prompt

```
Read docs/plans/issue-1131-tiff-swap-backup-safety.md (STATUS first) in u2giants/popdam3, then AGENTS.md.
You (lead) do steps 1, 2, 3, 6. Hand steps 4 and 5 to your helper after steps 1-3 are on your branch.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: finished work or an evidenced blocker; no design decisions; no merges or posts; bring back the step's stop-and-ask trigger; taken back after 30 minutes stuck.
You verify yourself: apps/windows-agent npm test, tsc, publish workflow, heartbeat version, the live proof on a disposable TIFF.
Delegation rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
```
