# Plan: [Agents] Enforce path containment for server-supplied filenames and paths (u2giants/popdam3#229)
Issue: https://github.com/u2giants/popdam3/issues/229
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| A | Code fix: bridge + Windows agents (`resolveUnderRoot`) | ✅ landed on main (not accepted on this issue until live proof) | PR #307 merged 2026-10-11; shared helper `packages/agent-common/src/path-containment.ts:46`; tests `path-containment.test.ts:11-29` run in CI via `apps/windows-agent/package.json:10` |
| B | Code fix: desktop helper (`safePathSegment` + `joinWithinRoot`) | ✅ landed on main (not accepted) | PR #311 merged 2026-10-11; `apps/popdam-helper/src/main/pathSafety.ts:16-42`; tests `pathSafety.vitest.ts:5-27` |
| C | Live proof: bridge installed build rejects/contains | ✅ done 2026-10-22 (issue comment 11:46 AM EDT) | bridge 1.16.19 contained #307; today bridge is 1.16.21 (#681) |
| 1 | Verify main still carries both fixes and no new unguarded join crept in (regression sweep) | ⬜ open | §9 step 1 |
| 2 | Add the missing unit tests (agent-common adversarial rows; helper single-segment rows; the `copySnapshotToManagedPath` root check) | ⬜ open | §9 step 2, §10 |
| 2b | Test the issue's acceptance wording: a job with a `..`/absolute `relative_path` is reported failed and the next job still processes (both agents) | ⬜ open | §9 step 2b; audit of the issue found no test or proof of this behaviour |
| 3 | Live proof: Windows agent installed build (0.17.0.194) rejects a `..`/absolute `relative_path` job, normal jobs still run | ⬜ open | `- [ ] live proof` on #229 |
| 4 | Live proof: installed Helper (Windows device registered 2026-11-04 12:53 PM EST, 1.4.13 from the 2026-10-21 build) does a normal checkout + check-in, from dam and sg as the issue asks (sg: see §9 step 4) | ⬜ open | `- [ ] live proof` on #229 |
| 5 | Close #229 with evidence; leave `- [ ] live proof` rows ticked on the same issue | ⬜ open | |

Where a fresh session starts: **Step 1**, then step 2 (code), then steps 3–4 (proof). Steps 3 and 4 can run in parallel.

---

## 1. The ultimate goal

The on-site agents and the desktop helper write files to the NAS and to employees' computers using names and paths that the cloud tells them. If a bad or corrupted record in the cloud says a file is called `..\..\Startup\x.bat`, the agent must **refuse** rather than write outside the folder it was given. **When this is done, no path or filename received from the server can make any agent or the helper read or write outside its configured root, and normal scanning, rendering, checkout and check-in still work exactly as before.**

If a step conflicts with this goal, the goal wins — stop and flag it. "Still works for normal files" is as much a part of the goal as "rejects hostile ones".

## 2. What this application is

See §2 of `issue-714-replace-do-spaces-key.md` for the overall system. The three programs this plan touches:
- **Bridge agent** `apps/bridge-agent/` — Node in Docker on Synology `edgesynology1`, mounts the NAS at `NAS_CONTAINER_MOUNT_ROOT` (default `/nas`, `apps/bridge-agent/src/config.ts:82`), scans/ingests, backfills PDF text, verifies check-ins. Published by `publish-bridge-agent.yml` to GHCR `popdam-bridge:stable`; running agents update only on an in-app update (#681).
- **Windows render agent** `apps/windows-agent/` — renders thumbnails via Photoshop/Illustrator on a Windows box with the NAS mapped at a UNC/drive root. Published by `publish-windows-agent.yml` as GitHub release `windows-agent-latest` (latest today: `v0.17.0.194`, 2026-11-04 3:52 PM EST).
- **PopDAM Helper** `apps/popdam-helper/` — Electron tray app on employees' PCs/Macs; checks assets out into a local workspace and back in. Published by `publish-popdam-helper.yml` to release tag `popdam-helper-latest` (assets dated 2026-10-21 22:17 UTC from main `53e848c1`, which contains #311). `package.json` version is still `1.4.13`, so the version string **cannot** distinguish pre- and post-fix installs; the install/registration date can.
- Shared code: `packages/agent-common/` (copied into each agent's `src/common/` by `sync.mjs` before build/test — `packages/agent-common/package.json` description) and `packages/path-filters/`.

## 3. What triggered this work

Code audit of main @ `4ba6de13` (issue body, 2026-10-07): `join(destDir, asset.filename)` in the helper and `join(mountRoot, relative_path)` in both agents' PDF backfill and text sampler had no containment. Severity Medium: the server (or anyone who can write `assets.relative_path`) could direct writes outside the workspace/mount.

## 4. Scope

In: all places where a server-supplied `relative_path`, `filename`, or `checkoutId` is joined to a local root in the bridge agent, Windows agent, and helper; tests proving it; live proof on installed builds.

**NOT in this plan**
- `browse_dir` containment (cloud-supplied absolute path for the setup UI) — that is #468 / PR #713 (`docs/plans/issue-468-audit-backlog-security.md`).
- Helper deep-link confirmation (`popdam://checkin`, `popdam://discard`) — #468.
- Helper local HTTP server path rules (`localServerSecurity.ts`) — already covered by its own tests; only reused here.
- Bumping the helper version number scheme (worth doing, but a separate small issue; note it in the close-out).
- Agent self-update mechanics (#681 owns the bridge update).

## 5. Current state of the code (main @ `01fcfc34`, 2026-11-04)

**Agents — done in #307 (merged 2026-10-11 11:24 AM EDT), moved to shared package in #324 (2026-10-11 12:43 PM EDT):**
- `packages/agent-common/src/path-containment.ts:21-41` `assertSafeRelativePath` rejects empty, NUL, POSIX/drive/UNC absolute, and any `..` segment; `:46-63` `resolveUnderRoot(root, rel, pathApi)` resolves and re-checks the result stays under the root.
- Call sites: bridge `pdf-backfill.ts:239`, `pdf-text-sampler.ts:483`, `ai-sentinel-scanner.ts:23`, `stale-record-retirement.ts:33-35`, `checkin-verifier.ts:70`; Windows `pdf-backfill.ts:352`, `pdf-text-sampler.ts:492`.
- Tests: `packages/agent-common/src/path-containment.test.ts` — four `test()` blocks (`:11` traversal/absolute/UNC/drive/NUL, `:19` posix accept, `:24` UNC/drive accept, `:29` empty root). Run by CI through `npm test --prefix apps/windows-agent` (`apps/windows-agent/package.json:10` lists `../../packages/agent-common/src/path-containment.test.ts`). The bridge's own `npm test` also lists it (`apps/bridge-agent/package.json:11`) but **CI does not run the bridge test script** (`.github/workflows/ci.yml:44-60` runs root, worker, windows-agent only).

**Helper — done in #311 (merged 2026-10-11 11:57 AM EDT):**
- `apps/popdam-helper/src/main/pathSafety.ts:16-30` `safePathSegment(name, what)` rejects empty, >255, `.`/`..`, any `\ / :`, control chars, Windows device names; `:34-39` `joinWithinRoot(root, sub)` via `resolveWithinRoot` (`localServerSecurity.ts:47-54`).
- Call sites: `fileOps.ts:73,77` (checkout/snapshot dirs from `checkoutId`), `:100` `copyToWorkspace`, `:218` `createSnapshot`; `checkoutManager.ts:63` `safeWorkspaceFilePath` (logs and returns `""` on unsafe input rather than throwing).
- Tests: `pathSafety.vitest.ts:5-27` (4 cases), run by root `npm run test` (vitest project include `apps/**/src/**/*.vitest.ts`, `vitest.config.ts:41`).
- **Managed-path check-in (`fileOps.ts:113-128` `copySnapshotToManagedPath`):** verified contained 2026-11-04 — `resolveAssetPath` (`fileOps.ts:26-37`) strips the root segment, runs `sanitizeRelativePath` (`:49-64`, rejects absolute/UNC/drive/`..`) and then `joinWithinRoot(mapping.local_path, …)`; the temp file is placed in `dirname(finalPath)` of that contained result. No gap; it has **no unit test** — add one (table row "managed-path check-in refuses escape").

**Live proof state (issue comments):** bridge proven 2026-10-22 11:46 AM EDT (1.16.19, contains 22ba16fa). Helper proof was BLOCKED then because no post-fix helper was online. **New fact 2026-11-04 (read-only query of `helper_devices`):** a Windows device registered 2026-11-04 12:53 PM EST, `helper_version 1.4.13`, last seen 1:52 PM EST. Because the only published helper build since 2026-10-11 is the 2026-10-21 one, a device first registered today almost certainly runs the post-fix build; confirm in step 4. Windows agent proof was fixture-only (Codex comment Oct 11: module-level diagnostic on 0.16.6.172); the installed agent is now 0.17.x (releases list) and heartbeating (last heartbeat 2026-11-04 4:45 PM EST).

## 6. Key findings

1. The fix is on main in both places; what is missing is (a) a full adversarial test matrix (current tests cover ~8 of the 16 rows in §9), (b) a regression check of `copySnapshotToManagedPath`, (c) the Windows-agent and Helper live proofs.
2. The helper's `checkoutManager.ts:63` path deliberately degrades to `""` instead of throwing so one bad server record cannot wedge startup — keep that behaviour; test it.
3. `resolveUnderRoot` on Windows: `path.win32.relative` is case-insensitive about drive letters but `realpath` is not used — symlink escapes are out of scope for this check (the NAS mount is a fixed root; symlinked folders are skipped by the scanner). Record, don't fix.
4. The helper version is not bumped per build (`apps/popdam-helper/package.json:3` still `1.4.13`), so `helper_devices.helper_version` cannot prove a fix level; registration date can, and `latest.yml` in the release carries the build's file hash.

## 7. Approaches considered and rejected

- `path.basename()` on every server filename (issue's suggested "basename + reject separators") — the helper does the stricter thing (reject, not strip) so a hostile name fails loudly instead of being silently renamed; keep reject semantics (LOCKED).
- Sanitising at the API (edge function) instead of at the agent — rejected as the *only* line: the agents must defend themselves because the DB can be written by other paths (bulk tools, migrations). Edge validation is welcome but out of scope here.
- Realpath-based containment in `resolveUnderRoot` — rejected for the agents: `relative_path` for a not-yet-existing output file cannot be realpath'd, and the NAS mount root is constant. (PR #713 uses realpath for `browse_dir` because that path must exist — different case.)
- Waiting for a user to "install the helper" (Oct 22 comment) — superseded: a device is online today; the AI drives the proof itself.

## 8. Design decisions

| Decision | State |
|---|---|
| Reject (throw / log-and-skip), never strip or rename hostile names | LOCKED |
| Single shared helper for agents (`packages/agent-common/src/path-containment.ts`); helper uses its own `pathSafety.ts` because it cannot import agent-common (different build) | LOCKED |
| Unsafe helper server records are ignored (`""`), not fatal | LOCKED |
| Where new agent-common tests live: extend `path-containment.test.ts` (node:test) rather than a new file | LOCKED |
| Whether to add the bridge test script to CI | OPEN — recommended yes (one `npm test --prefix apps/bridge-agent` step after the Windows one); if the bridge install needs native deps that fail on the runner, skip and note it |

## 9. The plan

Declare class `code` with `ai-task-gates`. Branch `claude/229-path-containment-tests` from `main`.

### Step 1 — Regression sweep (read-only)
Grep both agents and the helper for joins of server-supplied input that bypass the helpers:
`grep -rn "join(\|resolve(" apps/bridge-agent/src apps/windows-agent/src apps/popdam-helper/src/main --include=*.ts | grep -v "resolveUnderRoot\|joinWithinRoot\|node_modules"` and read each hit; any that takes `relative_path`, `filename`, `checkoutId`, or `server_path` from an API response must route through the helper. `resolveAssetPath` is already verified (§5); cite `fileOps.ts:26-37` in the PR body. Gate: a written list in the PR description of every hit and why it is safe, plus any new call site converted.

### Step 2 — Tests (see §10 for names)
Extend `packages/agent-common/src/path-containment.test.ts` and `apps/popdam-helper/src/main/pathSafety.vitest.ts` with every row of the table below that is not already covered; add `apps/popdam-helper/src/main/fileOps.vitest.ts` for `resolveAssetPath`/`copySnapshotToManagedPath` (mock `node:fs/promises` `copyFile`/`rename`/`mkdir`). Gate: `npm test --prefix apps/windows-agent`, `npm test --prefix apps/bridge-agent`, and root `npm run test` green locally; each new test fails if its guard line is commented out (do this once, locally, to prove the test bites).

### Step 2b — Job-level failure behaviour (issue comment 2026-10-11: "reported as failed and normal jobs still process")
The module tests prove the helper throws; nothing proves the job outcome. Code as of `origin/main` `e037dd7a`: the call sits inside the per-file `try` and the `catch` pushes `extraction_method: "failed"` with `extraction_error`, then the loop continues: `apps/windows-agent/src/pdf-backfill.ts:353`, `apps/bridge-agent/src/pdf-backfill.ts:238`; samplers `apps/windows-agent/src/pdf-text-sampler.ts:491`, `apps/bridge-agent/src/pdf-text-sampler.ts:482`. Test by behaviour for both agents' backfill: a two-asset batch whose first `relative_path` is `../../etc/passwd` yields a `failed` result naming that asset, the extractor is never called for it, and the second asset is processed. `runPdfBackfill` is the only loop export (`windows-agent/src/pdf-backfill.ts:314`) and it calls the API module; if mocking that is impractical, extract the loop body into an exported per-asset function without changing behaviour. Test name: `unsafe relative_path is reported failed and the batch continues`. This test plus the installed-module diagnostic (step 3) deliberately replaces writing a hostile row to production `assets`; say so on #229 when ticking the box. It also covers the bridge, whose 2026-10-22 proof showed containment and ordinary ingest but no rejection. Gate: test green, and red if `resolveUnderRoot` is removed from the `try`.

### Adversarial-cases table (mandatory)

| Input (source) | Hostile case | Expected | Test name |
|---|---|---|---|
| `asset.relative_path` (agents) | `../../etc/passwd` | `PathContainmentError` | `rejects parent traversal segments` |
| same | `a/../../b` (mid-path) | reject | `rejects traversal in the middle of the path` |
| same | `/etc/passwd` | reject | `rejects posix absolute` |
| same | `C:\Windows\x` and `C:x` | reject | `rejects drive-letter paths` |
| same | `\\\\evil\\share\\x` | reject | `rejects UNC paths` |
| same | `a\0b` | reject | `rejects NUL bytes` |
| same | `""` / `"   "` | reject | `rejects empty relative path` |
| same | `Final..v2.psd` (dots inside a segment) | **accept** | `accepts filenames containing double dots` |
| same | `a/./b` | accept, resolves to `root/a/b` | `accepts dot segments` |
| same | root `\\\\nas\\share` + `sub/file.psd` (win32) | accept | `accepts normal relative paths (UNC and drive roots)` (exists) |
| root | `""` | reject | `rejects empty root` (exists) |
| `asset.filename` (helper) | `..\\..\\Startup\\x.bat` | throw | `rejects traversal, separators, drives and device names` (exists) |
| same | `CON`, `nul.txt`, `com1` | throw | `rejects Windows device names` |
| same | 256-char name; name with `\x01` | throw | `rejects overlong and control-character names` |
| same | `report (final).psd` | accept | `accepts ordinary filenames` (exists) |
| `checkoutId` (helper) | `../other`, `x/y`, `.` | throw at `fileOps.ts:73` | `checkoutDir rejects non-single-segment ids` |
| server record with hostile filename (helper startup) | as above | `safeWorkspaceFilePath` returns `""` and logs; startup continues | `unsafe server records are skipped, not fatal` |
| `relativePath` to `copySnapshotToManagedPath` | `rootId/../../x` | throw before any copy | `managed-path check-in refuses escape` |

### Step 3 — Windows agent live proof
Preconditions: `agent_registrations.windows-render-agent` heartbeating; its installed version ≥ 0.16.6 (fix contained since `v0.16.6.172`). Method (read-only on production data; no hostile row is written to `assets`): run the installed agent's module-level diagnostic the Codex comment described (import `common/path-containment` from the installed build's `dist` and call `resolveUnderRoot` with three unsafe inputs and one safe one) over the existing SSH/WinRM path used for Windows-agent ops (see `docs/MULTI_TENANT_AGENTS.md` and the Windows agent docs routed from AGENTS.md); plus confirm one ordinary render job completed after the agent's current build was installed (`render_queue` rows completed today). Gate: diagnostic output shows 3 rejections + 1 accept with the installed file's SHA256; one post-install completed render. Post both on #229, tick the row.

### Step 4 — Helper live proof
Preconditions: a helper online — today's Windows device (registered 2026-11-04 12:53 PM EST). Identify who owns it (`helper_devices.user_id` → user) and whether it is one of the AI tester accounts; if it is a real employee's machine, do **not** drive it — instead confirm from `checkouts` that a checkout + check-in completed on that device after registration (`checkouts` rows with `device_id` = that device, `status` history active → checked_in). If it is an AI-driven machine, perform a normal checkout from dam.designflow.app and a check-in with the tester login. **sg:** the issue comment says "from dam and sg", but `src/pages/popsg` and `src/components/popsg` contain no checkout or helper code on `origin/main` `e037dd7a` (grep for `checkout`, `helper-api`, `popdam://`). Re-run that grep, and if still empty record "PopSG has no checkout surface" on #229 instead of a proof; if a path exists, repeat the round trip from sg.designflow.app. Gate: one checkout and one check-in on a post-2026-10-21 install with no helper error; file hash preserved (`checkouts` row `hash` equals the uploaded object's). Post on #229.

### Step 5 — Close
Comment with: PR number (tests), test names added, both proofs with EST times, and the statement that `browse_dir`/deep links are tracked on #468. Close #229.

## 10. Tests required

New (names in the table): node:test cases in `packages/agent-common/src/path-containment.test.ts` and vitest cases in `apps/popdam-helper/src/main/pathSafety.vitest.ts`; new `apps/popdam-helper/src/main/fileOps.vitest.ts` for the managed-path row. Must stay green: `npm run lint`, `npm run typecheck`, `npm run test` (root), `npm test --prefix apps/windows-agent`, `npm test --prefix apps/bridge-agent` (local; see §8 OPEN).

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; AI merges; `bin/ai-pr-wait <pr>` in the background for CI; never sleep-loop.
- No shared-DB changes; nothing in this plan writes to production tables. Live proof reads only.
- `packages/agent-common` is copied by `sync.mjs` into `apps/*/src/common/` before test/build — edit the package, never the copies (they are build artefacts).
- Windows path tests must pass `path.win32` explicitly (`resolveUnderRoot(root, rel, path.win32)`) because CI runs on Linux.
- Helper code must stay free of Electron imports in `pathSafety.ts` (file header) so vitest can load it.
- Merging to `main` with changes under `apps/popdam-helper/**` triggers a helper release (`publish-popdam-helper.yml:5-8`); test-only changes (`*.vitest.ts`) still match that path — expect a rebuild; harmless, but it changes the `latest.yml` hashes used in step 4, so finish step 4's evidence capture before merging or re-read the hashes after.
- Agent releases: Windows agent publishes on push to main as well; the bridge only updates in-app (#681).
- Times in EST; sign GitHub posts with `$AI_GH_SIGNATURE`.

## 12. Access and environment

hetz; `gh` as `u2giants`; Supabase MCP `execute_sql` (Virginia project, read-only); tester logins in 1Password `vibe_coding` (memory `project_popsg_tester_login`); Windows agent host access per `docs/MULTI_TENANT_AGENTS.md`; NAS SSH as `ai` to `edgesynology1` (memory `feedback_nas_sudo_block_ritual` if docker is needed). Local run: `npm ci` at root; `npm ci --prefix apps/windows-agent`; `npm ci --prefix apps/bridge-agent`.

## 13. Definition of done, risks, open questions

Done: step-1 sweep recorded; all table rows have passing tests; PR merged; CI green; Windows-agent and Helper live proofs posted and ticked on #229; issue closed.
Risks: a stricter `safePathSegment` row (device names) could reject a real filename like `con.psd` — it already does today; the test only pins it. Helper release rebuild on merge: no behaviour change.
Open: who owns today's helper device (decides manual vs. observed proof in step 4); whether bridge tests are added to CI (§8).

## Self-audit

1. Executable without questions? Yes — §5 gives every call site and test file with lines, §9 gives commands, inputs and gates per step, and the table names a test per hostile case.
2. Carries all background and rejections? Yes — §5 records both PRs, the CI coverage gap, the helper version-string limitation and today's new device; §7 lists the four rejected routes with reasons.
3. Goal clear enough for judgment calls? Yes — §1 pins "reject hostile, keep normal working", which settles the reject-vs-strip and non-fatal-startup decisions in §8.
