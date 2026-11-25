---
summary: "Finish the Windows 'Open Folder' launcher: a permanent automated test of the handler, a verified download of the handler file, the right site address, and documented installer behaviour."
kind: plan
status: open
read-when: "implementing #1231 (Windows popdam:// folder launcher findings from PR #1230)"
---

# Issue #1231 — The Windows "Open Folder" launcher is tested, verified on download, and documented

Covers [u2giants/popdam3#1231](https://github.com/u2giants/popdam3/issues/1231) (advisory review of PR #1230). Handoff:
[HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md](../../HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md).
Related, already merged: cleanup plan [issue-1200-19](issue-1200-19-downloadable-protocol-installers.md) (its Mac proof is separate and not part of this plan).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 0. Finding 1 (UNC paths rejected) | ✅ not a bug | Ran main's `public/downloads/popdam-open.js` under `cscript` on Windows 11 (al8960ofc, 2026-11-25, Explorer call replaced by an echo): `\\localhost\c$\Windows` → opened; `C:\Windows\notepad.exe` → opened parent; `\\.\c:` → refused. The illegal-character set does not contain `\`. |
| 0b. Finding 3 (32-bit wscript path) | ✅ no change needed | A 32-bit caller's `System32` is redirected to `SysWOW64\wscript.exe`, which runs the same JScript; nothing breaks. Recorded so nobody "fixes" it. |
| 1. Permanent handler test | ⬜ open | |
| 2. Verified download of the handler | ⬜ open | |
| 3. Download from the current site, not a fixed host | ⬜ open | |
| 4. Document installer behaviour | ⬜ open | |
| 5. Deploy + live proof | ⬜ open | |

**Fresh session starts at step 1.**

## 1. Ultimate goal

Designers click "Open Folder" in PopDAM and Windows Explorer opens the artwork's folder on the NAS. The small launcher file that makes this work must be protected by an automated test, must never be replaced by a web error page during setup, and setup instructions must match what the installers do. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, branch `main`) web app at https://dam.designflow.app (PopSG at https://sg.designflow.app, same build). "Open Folder" builds a `popdam://open-folder?path=<encoded path>` link (`src/lib/open-folder.ts`; default path mode `unc_host`, i.e. `\\NAS\share\…`). On Windows the link is handled by `C:\PopDAM\popdam-open.js` run by Windows Script Host (`wscript.exe`), registered under `HKCU\Software\Classes\popdam`. Files served from `public/downloads/`: `popdam-open.js`, `install-popdam-protocol.bat|.ps1|.reg|.sh`, legacy `popdam-open.bat`. Setup steps shown on `src/pages/DownloadsPage.tsx` (PowerShell snippets at lines 82-84). Frontend ships by `publish-frontend.yml` → GHCR → Coolify.

## 3. What triggered this work

Review of PR #1230 (deepseek) and its follow-up commit `e1237991`:
1. Claimed UNC paths are rejected — **disproved** (STATUS row 0).
2. No test exercises the handler (parsing, decoding, validation, parent-folder fallback). The native Windows run in [run 44608415127](https://github.com/u2giants/popdam3/actions/runs/44608415127) was a temporary branch workflow (`codex/popdam-1200-19-native`), not a permanent check.
3. Hard-coded `System32\wscript.exe` — harmless (row 0b).
4. `DownloadsPage.tsx:82` step 1 saves whatever `https://dam.designflow.app/downloads/popdam-open.js` returns (no content check), so an HTML error/login page could be saved and then run by WSH on every link; the host is hard-coded, so preview/self-hosted sites pull production's file.
5. `install-popdam-protocol.bat:21-26` and `.ps1:26-31` now refuse to register when the handler file is missing (exit 1) — reasonable, but undocumented.

## 4. Scope

In: a test for `popdam-open.js`, the two Downloads page snippets, installer messages/docs. **NOT in this plan:** the Mac launcher and its proof (plan issue-1200-19 step 4), path-mode logic in `open-folder.ts`, the Helper, code signing (abandoned forever).

## 5. Current state of the code (main @ 787c20b8)

`public/downloads/popdam-open.js` (39 lines, ES3 JScript): one argument; prefix regex `^popdam:\/\/open-folder\/?\?path=`; `decodeURIComponent`, `/`→`\`; accepts drive or UNC (not `\\.\`); rejects `<>:"|?*` and control chars after the first two characters; falls back to parent folder; `Shell.Application.Open`. Installers check the handler exists, then register `"%SystemRoot%\System32\wscript.exe" "C:\PopDAM\popdam-open.js" "%1"`.

## 6. Key findings and root cause

The launcher works; the gaps are verification (no permanent test, no download check) and documentation.

## 7. Approaches considered and rejected

- **Windows CI runner with `cscript`** — rejected as the main test: slower and a new workflow; a Node test that runs the same file with stubbed `WScript`/`ActiveXObject` covers the logic on the existing Linux runner. (A one-off native check stays in live proof.)
- **Checksum pinned in the page** — rejected: the file and page ship together but cached copies can drift; a marker-line check is enough and doesn't break on edits.
- **Change the wscript path to `Sysnative`** — rejected (row 0b).

## 8. Design decisions

Locked (2026-11-25): the handler file gets a fixed first line marker `// PopDAM's Windows URL handler.` (already line 1) — the download step must refuse to save a body that does not start with it. The download URL uses `window.location.origin` so each site serves its own copy. Installers keep refusing to register without the handler; the message says exactly how to get it (Downloads page step 1).
Open: none.

## 9. The plan

**Step 1 — Handler test (helper-ok).** Add `src/test/popdam-open-handler.test.ts` (root vitest `src/**/*.test.ts`): read `public/downloads/popdam-open.js`, run it in `node:vm` with a stub `WScript` (`Arguments.length/Item`, `Quit` throwing a sentinel with the code, `Echo` recorder) and stub `ActiveXObject` (`Scripting.FileSystemObject` with a fake folder set; `Shell.Application.Open` recorder). Cases: `opens a UNC folder`, `opens the parent of a UNC file`, `opens a drive path`, `accepts the slash ShellExecute inserts after the host`, `decodes %25 literally once`, `refuses \\.\ device paths`, `refuses quotes, pipes and colons after the drive`, `refuses a non-popdam prefix`, `refuses two arguments`, `refuses malformed percent encoding`, `reports folder not found`. Stop-and-ask: if the script cannot run in `vm` without editing it. Verify: `npx vitest run src/test/popdam-open-handler.test.ts` green.

**Adversarial cases (the `popdam://` link is external input — any web page can send one):**

| Input | Hostile case | Test that proves it |
|---|---|---|
| link prefix | `popdam://evil?path=…`, `popdamx://…` | `refuses a non-popdam prefix` |
| argument count | extra arguments injected | `refuses two arguments` |
| path encoding | `%E0%A4%A` malformed | `refuses malformed percent encoding` |
| path encoding | `%2525` double encoding | `decodes %25 literally once` |
| path target | `\\.\PhysicalDrive0`, `\\.\c:` (device namespace) | `refuses \\.\ device paths` |
| path characters | `C:\a"&calc&"`, `C:\a` + pipe + `b`, `C:\a:stream` | `refuses quotes, pipes and colons after the drive` |
| path target | a file (e.g. `.exe`) instead of a folder | `opens the parent of a UNC file` (parent opened, file never run) |
| download body | HTML error/login page instead of the script | step 2 marker check + `downloads-snippets.test.ts` |

**Step 2 — Verified download (lead-only: the snippet runs on employee PCs).** Change `winStep1` (`DownloadsPage.tsx:82`) to: `$r = Invoke-WebRequest -UseBasicParsing -Uri '<origin>/downloads/popdam-open.js' -ErrorAction Stop; if (-not $r.Content.StartsWith("// PopDAM's Windows URL handler.")) { Write-Host '[X] Download was not the PopDAM handler — nothing saved'; exit 1 }; Set-Content -Path 'C:\PopDAM\popdam-open.js' -Value $r.Content -Encoding ASCII`. Keep it one line (it is copied into PowerShell). Make `winStep2` start with `if (-not (Test-Path 'C:\PopDAM\popdam-open.js')) { Write-Host '[X] Run step 1 first'; exit 1 }`. Verify: run both snippets on a Windows machine against the preview site (or local `npm run dev` origin); a deliberately wrong URL leaves no file.

**Step 3 — Origin (helper-ok).** Build the URL from `window.location.origin` in `DownloadsPage.tsx` instead of the hard-coded host; add a test in an existing `DownloadsPage` test or new `src/test/downloads-snippets.test.ts` asserting the snippet contains the current origin and the marker check. Stop-and-ask: if the page is server-rendered anywhere (it is not on main; confirm). Verify: test green.

**Step 4 — Docs (helper-ok).** No doc on main describes the Windows launcher yet (`grep -rln popdam-open docs` finds only plans). Add a short "Open Folder on Windows" section to `docs/POPDAM_HELPER.md` (with the four-key header kept intact) to say: installers require `C:\PopDAM\popdam-open.js`; they stop without registering otherwise; get the file from the Downloads page step 1. Make the `.bat`/`.ps1` messages say the same in one plain sentence. Verify: `ai-doc-health --repo . --fix-index` runs clean (advisory).

**Step 5 — Deploy + live proof (lead-only).** Merge → `publish-frontend.yml` green → live site serves the merge SHA. On a Windows PC (this machine al8960ofc qualifies): run the two snippets from the live Downloads page, then click Open Folder on a real asset in https://dam.designflow.app; Explorer opens the NAS folder. Post with EST times on #1231 and close.

## 10. Tests required

Eleven handler cases (step 1) and the snippet test (step 3); root `npm test`, `npm run lint`, `npm run build` green.

## 11. Constraints, standing rules, gotchas

The handler is ES3 JScript — no `let`, arrow functions or template strings in `popdam-open.js`. Windows line endings for `.bat`/`.reg` must be preserved (`git diff` must not flip them; `.gitattributes` governs). Never execute downloaded content in tests. Branch + PR; AI merges; reviews advisory. Visual check of the Downloads page. Sign GitHub posts with `$AI_GH_SIGNATURE`.

## 12. Access and environment

`gh` as `u2giants`. Local: root `npm ci && npm run dev` (Downloads page needs sign-in: PopDAM test login in 1Password `vibe_coding`; never paste values). Windows machine with `cscript` for the native check.

## 13. Definition of done, risks, open questions

Done: steps 1-4 merged, CI green, live SHA verified, live Open Folder proof posted, #1231 closed, STATUS updated. Risk: users following old cached instructions — unchanged behaviour for them. Rollback: revert PR. Open: none.

## Self-audit

1. Executable without questions? Yes — §8 locks marker/origin/installer behaviour; §9 names files, lines, test names.
2. Background carried? Yes — STATUS rows 0/0b record the disproved and harmless findings with evidence; §7 rejections.
3. Goal clear? Yes — "Open Folder works, is tested, and setup can't save a wrong file".

## Lead launch prompt

```
Read docs/plans/issue-1231-windows-folder-launcher-followups.md (STATUS first) in u2giants/popdam3, then AGENTS.md.
You (lead) do steps 2 and 5. Hand steps 1, 3, 4 to your helper.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: finished work or an evidenced blocker; no design decisions; no merges or posts; bring back the step's stop-and-ask trigger; taken back after 30 minutes stuck.
You verify yourself: the handler and snippet tests, lint/build, the snippets on Windows, live Open Folder.
Delegation rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
```
