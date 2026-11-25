---
summary: Issue #1188 plan: make the Windows render agent's 8.3 short-name path resolver fail safe — strict short-name pattern, stat errors skip a candidate, bounded depth and per-branch isolation. Read its STATUS first.
kind: plan
status: open
read-when: changing apps/windows-agent/src/smb-resolve.ts or debugging render jobs on NAS names with forbidden characters
---

# Plan: Windows render agent 8.3 name resolution, fail safe — u2giants/popdam3#1188

Issue: https://github.com/u2giants/popdam3/issues/1188 (review of PR #1187 "resolve NAS folders listed only as 8.3 mangled names", which fixed #1186)
Related plan: [issue-1236 exact NAS file names](issue-1236-exact-nas-file-names.md)
Handoff: [HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md](../../HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md)
Written 2026-11-25 (3:55 PM EST) by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Re-confirm the three findings on `main` | ⬜ open | |
| 2 | Strict 8.3 short-name test | ⬜ open | |
| 3 | A failing `stat` skips that candidate | ⬜ open | |
| 4 | Bounded depth and total work; per-branch isolation | ⬜ open | |
| 5 | Tests | ⬜ open | |
| 6 | PR, CI, merge, release the Windows agent | ⬜ open | |
| 7 | Live proof on a real job and close | ⬜ open | |

**Where a fresh session starts:** step 1.

---

## 1. The ultimate goal

PopDAM makes preview images of design files with a Windows "render agent" that opens them over the network from the NAS. Some NAS names contain characters Windows forbids (for example `12"`), and Windows then sees those names only as short codes like `1736GU~Y`. PR #1187 taught the agent to find the right file anyway. The goal of this plan: **the agent must only ever render the exact file asked for** — if it cannot be sure, it fails that one job cleanly; it must never pick a wrong file, never crash a whole lookup because one neighbour is unreadable, and never stall for minutes on a deep tree.

**If a step conflicts with this goal, the goal wins — stop and flag it on #1188.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, live at https://dam.designflow.app) indexes POP Creations' design files on a Synology NAS (share `mac`). Render jobs (thumbnails, previews) for formats the NAS can't render go to the **Windows render agent** (`apps/windows-agent/`, version `0.17.0` in its `package.json`), which runs on a Windows PC, reaches the share over SMB (`\\edgesynology1\mac\…` or a mapped drive), and renders with Inkscape/ImageMagick/Ghostscript/Poppler. Releases are GitHub Releases (see `docs/deployment.md` → Windows agent). Jobs come from `agent-api` (`supabase/functions/agent-api/index.ts`); the agent reports with `api.completeRender`.

The resolver: `apps/windows-agent/src/smb-resolve.ts` (171 lines). `resolveExistingSmbPath(windowsPath, expected)` (`:164-171`) returns the path as the share lists it, or the input unchanged. `resolveFrom` (`:128-162`) walks segments: exact name → `matchSmbName` (catia character mapping, `:51-55`) → for the last segment `matchMangledFile` (`:72-86`: mangled name, same extension, same size, mtime within 2 s, exactly one) → for a folder segment it probes every mangled sub-folder recursively and accepts only if exactly one branch resolves. Caller: `apps/windows-agent/src/index.ts:533` in `processJob`; any throw is caught at `:534-537`, logged as "Rejected unsafe render path" and the job fails permanently with that message.

## 3. What triggered this work

#1186 (closed): 61 of 75 previews queued by an 8:16 PM scan failed in the render agent because folder names were visible only as 8.3 names. PR #1187 fixed it; the advisory reviewer (Muse) filed #1188 with three findings and a missing-test note; the fixer's PR #1190 was closed and the issue deferred.

## 4. Scope

In: the three findings and tests; a Windows agent release.

### NOT in this plan
- Enabling Samba `catia`/`fruit` mapping on the NAS (host change via `u2giants/ansible`, and a separate decision).
- Renaming NAS files.
- Exact-name handling in ingest or the library UI (issue-1236 plan).

## 5. Current state (verified on `main` @ `787c20b8`, 2026-11-25)

- **W1** `smb-resolve.ts:64-65` `isMangledName = name.includes("~")`; it gates folder probing at `:147-154`. A real folder like `~tmp` or `my~notes` is a candidate; if it alone contains the rest of the path it is accepted (`:159-161`). For files the size+mtime check protects; for folders nothing does.
- **W2** `:144` passes `(n) => fs.stat(win.join(cur, n))` to `matchMangledFile`, whose filter (`:83`) calls it with no try/catch; `realFs.stat` (`:111-113`) is a raw `statSync`. One unreadable candidate throws through every recursion level → job fails as "unsafe path" though another candidate was right.
- **W3** `:155-158` recurses into every mangled folder with no depth limit and no per-branch try/catch; `MAX_MANGLED_DIR_CANDIDATES = 64` (`:118`) caps breadth per level only (worst case 64^depth SMB listings).
- Tests: `apps/windows-agent/src/smb-resolve.test.ts` covers `matchMangledFile` (5 pure cases) and folder resolution (one hit, two hits refused, none). Nothing for stat throws, depth, the cap, or an ordinary `~` folder.

## 6. Key findings

Samba's default "hash2" mangling produces names of the form: up to 6 (sometimes fewer) upper-case/digit characters of the original, `~`, one character, then optionally `.` and an extension of up to 3 characters, all upper-case — e.g. `4TQCYS~A.AI`, `1736GU~Y`. Ordinary designer names with `~` (lower-case letters, longer than 8.3, or `~` at the start) never match that shape.

## 7. Approaches considered and REJECTED

- **Matching folders by content (comparing child listings)**: expensive over SMB and still ambiguous.
- **Removing folder probing**: re-opens #1186 (61 failed previews).
- **Asking the NAS for the long name via an agent-api call**: the bridge already sends `relative_path`; the problem is the Windows view, not the name. Would add a round trip per job.
- **Catching everything at the top and returning the input**: hides which branch failed and still allows a wrong match.

## 8. Design decisions

Locked: never accept a near match; ambiguous (2+) → no match; on any doubt return the input unchanged so the job fails with the normal "file not found" path, not "unsafe path".
Open: limits. Suggested: depth of mangled-folder probing ≤ 3 levels, total `list`+`stat` calls per job ≤ 500. Criterion: the #1186 job set (re-queue a few from it) still resolves; worst-case lookup under ~10 s.

## 9. The plan

**Step 1 — Re-confirm.** Re-read §5 lines on current `main`. `lead-only`. Gate: noted in PR.

**Step 2 — Strict short-name test (W1).** Replace `isMangledName` with `isShortName(name)`: `/^[A-Z0-9_$%'@{}!#()&^\-]{1,7}~[A-Z0-9]{1,6}(\.[A-Z0-9_$%'@{}!#()&^\-]{1,3})?$/` with the base (before the dot) at most 8 characters. Use it for both files (`matchMangledFile`) and folders. `lead-only` (decides which files can be rendered). Gate: tests "ordinary ~ folder is never a candidate", "real short names are candidates".

**Step 3 — Stat errors skip a candidate (W2).** Wrap the `statOf(n)` call in `matchMangledFile`'s filter in try/catch → `false`. `helper-ok`. Stop-and-ask: none. Gate: test "one unreadable candidate does not hide the right one".

**Step 4 — Bounds and isolation (W3).** Add a budget object passed through `resolveFrom` (`{ calls: 500, depth: 3 }`); every `list`/`stat` decrements `calls`; probing a mangled folder decrements `depth` for that branch; when exhausted, the branch returns null. Wrap each branch's `resolveFrom` in try/catch → null. `resolveExistingSmbPath` stays non-throwing: any unexpected error returns the input unchanged and logs once at warn with the job's path (caller keeps its catch). `lead-only`. Gate: tests "depth limit stops deep probing", "call budget stops wide trees", "a throwing branch is skipped".

**Step 5 — Tests.** See §10, in `apps/windows-agent/src/smb-resolve.test.ts` using the injectable `SmbFs`. `helper-ok`. Stop-and-ask: if a case needs real SMB. Gate: `npm --prefix apps/windows-agent test` green.

**Step 6 — Land and release.** Bump `apps/windows-agent/package.json` patch version, branch `claude/issue-1188-short-name-resolver`, PR to `main` ("Refs #1188"), merge when required checks pass, publish the release per `docs/deployment.md` (Windows agent section), and confirm the agent on the render PC reports the new version (Settings → Agents in PopDAM). `lead-only`.

**Step 7 — Live proof.** Re-queue one render job for a file inside a folder whose name has a forbidden character (find one: `select relative_path from public.assets where relative_path ~ '["<>:|?*]' and is_deleted = false limit 5;` read-only) via the admin re-render action; confirm it renders and the agent log shows the resolved short-name path. Comment on #1188 with evidence and EST times (signed `$AI_GH_SIGNATURE`) and close. `lead-only`.

### Adversarial cases (SMB directory listings are external input)

| Input | Hostile case | Test |
|---|---|---|
| folder listing | ordinary `~tmp` / `my~notes` folder holds the rest of the path | `ordinary ~ folder is never a candidate` |
| folder listing | two real short-name folders both hold the rest | existing "two hits refused" |
| file listing | one candidate's `stat` throws EACCES/ENOENT | `one unreadable candidate does not hide the right one` |
| tree shape | 5 nested short-name levels | `depth limit stops deep probing` |
| tree shape | 64 short-name folders at each of 3 levels | `call budget stops wide trees` |
| listing | `list` throws inside a branch | `a throwing branch is skipped` |
| names | lower-case `abc~1.ai`, 9-char base `ABCDEFGH~1` | `real short names are candidates` (negative rows) |

## 10. Tests required

In `smb-resolve.test.ts`: ordinary ~ folder is never a candidate; real short names are candidates (`4TQCYS~A.AI`, `1736GU~Y` yes; `~tmp`, `my~notes`, `abc~1.ai`, `ABCDEFGHI~1` no); one unreadable candidate does not hide the right one; depth limit stops deep probing; call budget stops wide trees; a throwing branch is skipped; resolveExistingSmbPath never throws. Must stay green: `npm --prefix apps/windows-agent test`, root `npm run typecheck`.

## 11. Constraints and gotchas

- Never push to protected `main`; AI merges; reviews advisory.
- The agent only changes on the PC after a release and update; check its reported version.
- No NAS or host changes (Ansible owns hosts).
- Times to Albert in EST/EDT.

## 12. Access and environment

- `gh` as `u2giants`. Local: `npm --prefix apps/windows-agent ci` then `test` (tests are pure; no SMB needed).
- Admin login for re-queue: 1Password `vibe_coding` → PopDAM `ai-admin`.

## 13. Definition of done, risks, open questions

Done when: STATUS rows ✅; PR merged; release published and running; live render proof posted; #1188 closed.
Risks: a too-strict pattern misses a real short-name form → those jobs fail as before #1187; the live proof and the #1186 sample catch it; rollback = previous release. Open: limit values (§8).

## Self-audit

1. *Fresh session without questions?* Yes — §2 explains the resolver and caller, §5 exact lines, §9 files/behaviour/gates.
2. *Background and rejected options?* Yes — §3 history (#1186, #1187, #1190), §6, §7.
3. *Goal clear?* Yes — §1: exact file or a clean failure.

## Lead launch prompt

```
You are the lead for u2giants/popdam3 issue #1188. Read AGENTS.md, then docs/plans/issue-1188-windows-agent-short-name-resolution.md (STATUS first).
Do steps 1, 2, 4, 6, 7 yourself. Hand steps 3 and 5 to your helper.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; no design decisions; no merges, pushes or GitHub posts; bring every stop-and-ask trigger back to you; if stuck 30 minutes, you take the step back.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
You run all tests, review the helper diff, release, and do the live proof. Update STATUS in the same PR.
```
