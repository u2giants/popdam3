---
summary: Issue #719 plan: fix: close verified audit backlog findings. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-719
---

# Plan: Review finding: u2giants/popdam3#713 fix: close verified audit backlog findings (u2giants/popdam3#719)
Issue: https://github.com/u2giants/popdam3/issues/719
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 1 | New branch `fix/719-audit-review-findings` from current `origin/main` | ⬜ open | #713 merged unrevised as `2287f1b5`; its branch is finished, do not push to it |
| 2 | Finding 1 (must fix): Windows hygiene walker skips excluded directories again | ⬜ open | `apps/windows-agent/src/index.ts:1365` on the PR head still calls `shouldSkipPath(entry.name)` |
| 3 | Finding 1 test: directory-name case in the path-filter test | ⬜ open | `src/test/path-filters-skip.test.ts` has only file cases |
| 4 | Finding 2: out-of-root `browse_dir` reports an error, not an empty folder | ⬜ open | both agents call `reportDirBrowse(id, target, [])` in the catch |
| 5 | Finding 3: drop dead imports in `ApisTab.tsx` | ⬜ open | `src/components/settings/ApisTab.tsx:2,12,14` |
| 6 | Finding 4: `handleClaim` takes identity from the key, not the body | ⬜ open | `supabase/functions/agent-api/index.ts:1936-1942` on PR head |
| 7 | Finding 5: `useScanLifecycle` records an honest status for a scan that ended without a result | ⬜ open | `src/hooks/useScanLifecycle.tsx:76` |
| 8 | Finding 6: `docs/API_CONTRACTS.md` `claim-render` request field | ⬜ open | `:175-176` still lists `agent_id` |
| 9 | New PR `Closes #719`, CI green, merge, deploys and agent publish green | ⬜ open | |
| 10 | Live proof after release | ⬜ open | agents reach machines only at their next release (#681 bridge); `- [ ] live proof` stays on #719 |

Where a fresh session starts: Step 1, Finding 1 first.

**Correction (verified on `origin/main` `e037dd7a` (Nov 4, 2026, 6:05 PM EST)):** PR #713 merged at 5:12 PM EST as `2287f1b5` with none of the six findings fixed. All six are confirmed on `main` (`windows-agent/src/index.ts:1365`; both dir-browse catches; `ApisTab.tsx` imports; `agent-api/index.ts:1936,4973`; `useScanLifecycle.tsx` `setLastScanStatus`; `API_CONTRACTS.md:171-176`). **The Finding 1 regression has shipped:** "Publish Windows Agent" succeeded for `2287f1b5` and `4970cdeb`, and the agent self-updates, so the next hygiene scan may crawl `#snapshot`. Check the agent's version; until the fix is released, do not start a hygiene scan. Everything below that says "PR #713's branch", "merge #713", "PR head" or "never merge with Finding 1 unfixed" now means: a new PR from `main`. §7's rejection of a new PR and §8's fourth LOCKED item are void. Skip §9's prerequisite and Step 1's merge; line numbers are from `73196e65`, so re-grep. Step 9 pushes the new branch, runs `bin/ai-pr-wait <pr>`, merges, and confirms `publish-windows-agent.yml` as well as the frontend and edge workflows. Step 10's hygiene-scan proof is now the priority proof.

---

## 1. The ultimate goal

PR #713 closes a batch of verified security/robustness findings from the 2026-10-21 audit (`docs/audit-2026-10-21.md`) — agent identity spoofing, out-of-root directory browsing, helper confirmations, dead code. It must land **without** introducing the one serious regression the review caught: the Windows agent's `.ai` hygiene scan descending into Synology system folders (`@eaDir`, `#snapshot`, `#recycle`) and `_old`/`SAMPLE` trees. That would turn a bounded scan into a crawl of point-in-time share copies (this repo's own bridge code calls that traversal catastrophic, `apps/bridge-agent/src/index.ts:523-526`) and produce duplicate hygiene findings from stale copies.

When this is done: #713 is merged with the walker skipping excluded directories (proven by a test), admins browsing an out-of-root path see an error instead of a fake empty folder, the `claim` route can no longer be told "I am agent X" by the request body, and the docs match the code.

**If a step conflicts with this goal, the goal wins — stop and flag it.** In particular: merging #713 with Finding 1 unfixed is never acceptable, whatever else is done.

## 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed consumer-product artwork. Repo `u2giants/popdam3`, branch `main`. Components touched by #713 (see `AGENTS.md` → Repo structure / Deployment):
- **Windows render agent** `apps/windows-agent/` — runs on a Windows VM, renders, backfills PDF text, and runs the `.ai` hygiene scan; released through `.github/workflows/publish-windows-agent.yml` (channel `windows-agent-latest`); manual install on the VM.
- **Bridge agent** `apps/bridge-agent/` — Synology NAS scanner (`edgesynology1`), image `ghcr.io/u2giants/popdam-bridge:stable` via `publish-bridge-agent.yml`; bridge update tracked on #681.
- **Shared path filter package** `packages/path-filters/index.ts` — Node workspace package used by both agents (`apps/*/package.json` `file:../../packages/path-filters`). A separate Deno copy lives at `supabase/functions/_shared/path-filters.ts` (different API: `isExcludedDirectory`, `isExcludedRelativePath`, `shouldSkipFile`), **not** changed by #713.
- **Edge functions** `supabase/functions/agent-api/index.ts`, `admin-api/index.ts` — deployed by `deploy-supabase.yml` on merge, Supabase project `qsllyeztdwjgirsysgai`.
- **Frontend** `src/` — React/Vite, `publish-frontend.yml` → GHCR → Coolify app `qxj8a0j3tpa9lq4q5rs6pezy` at dam.designflow.app.

## 3. What triggered this work

The advisory AI review (GLM, run 41913797168) of PR #713 at head `e7309b91` filed #719 with six findings. A later commit `73196e65` ("honor user Stop on worker terminal writes and cap sentinel reads") was pushed to the PR after the review; it does not touch any of the six. The review-fixer bot did **not** open a fix PR for #719 (no fixer label on the issue; contrast #711/#716). The PR body says "Agent and helper changes reach machines at their next release; #681 covers the bridge update. No shared database change."

## 4. Scope

**In:** the six findings as listed in §3/§6, fixed on PR #713's own branch, plus bringing the branch up to date with `origin/main`, merging #713, and closing #719.

**NOT in this plan:**
- Re-reviewing the rest of #713 (the "Verified as correct" section was truncated in the issue; trust CI + the reviewer's statement that all other changed files were read).
- Releasing the Windows agent or bridge image (separate workflows; #681 for bridge). This plan records what must be observed after release.
- Changing the Deno `_shared/path-filters.ts` (its API never had the file/folder ambiguity).
- Any shared-db change (none needed).
- The other #713 follow-ups the audit doc defers to named issues (#468 #469 #471 remain the owning issues for their areas).

## 5. Current state of the code (PR head `73196e65` unless stated)

**Finding 1 — regression:**
- `packages/path-filters/index.ts:89-111` (PR head): `shouldSkipPath` now treats the **last segment as a file** — `isFile ? seg.startsWith(".") : shouldSkipFolder(seg)`. On `origin/main` (`:96-97`) every segment went through `shouldSkipFolder`.
- `apps/windows-agent/src/index.ts:1365` (PR head, identical on `origin/main`): `if (shouldSkipPath(entry.name, () => {})) continue;` inside `walkDir` for `entry.isDirectory()`. A bare directory name is a single segment → now treated as a file → `@eaDir`, `#snapshot`, `#recycle`, `$RECYCLE.BIN`, `node_modules`, `_old`, `sample` no longer skip. **Regression confirmed on the PR head.**
- Other `shouldSkipPath` call sites all pass **file** paths and are fine: `windows-agent/src/index.ts:526` (render job relative_path), `:1094` (TIFF job), `:1225` (TIFF reinspect), `:1369` (the `.ai` file branch of the same walker); `bridge-agent/src/scanner.ts:222` (fullPath of a file, after the directory branch at `:180` which correctly uses `shouldSkipFolder(entry.name)`).
- `src/test/path-filters-skip.test.ts` (root vitest, added by #713; commit `e7309b91` moved it out of the agent package build): three file-path cases only. No directory-name case.
- Windows agent imports: `apps/windows-agent/src/index.ts:30` `import { resetSkipWarnings, shouldSkipPath } from "@popdam/path-filters";` — `shouldSkipFolder` not imported yet.

**Finding 2 — silent empty listing:**
- `apps/bridge-agent/src/handlers/path-tools.ts:95-101` and `apps/windows-agent/src/handlers/dir-browse.ts:44-50`: `catch (e) { logger.warn("Dir browse failed"...); await api.reportDirBrowse(cmd.request_id, target, []); }`. The new containment check throws "Path is outside the configured NAS roots" into this catch.
- `apps/bridge-agent/src/api-client.ts:306-319` and `apps/windows-agent/src/api-client.ts:352`: `reportDirBrowse(requestId, path, entries: DirEntry[])` posts `{request_id, path, entries}`.
- `supabase/functions/agent-api/index.ts:2088-2120` `handleReportDirBrowse`: requires `entries` array; stores `admin_config.DIR_BROWSE_RESULT = {request_id, path, entries, listed_at}`; marks `DIR_BROWSE_REQUEST` completed.
- `supabase/functions/admin-api/index.ts:2173` `get-dir-browse-result` returns that value.
- `src/components/settings/DirectoryBrowserTab.tsx:95-112`: Realtime + 500 ms poll; `finish(r)` with `{request_id, path, entries, listed_at}`; `fail(msg)` exists for the 60 s timeout and surfaces via `toast.error` at `:125`.
- `docs/API_CONTRACTS.md:90,212-214,247-257` document `browse_dir` / `report-dir-browse` with no error field.

**Finding 3 — dead imports:** `src/components/settings/ApisTab.tsx:2` imports `ExternalLink, Plus, Trash2` (lucide), `:12` `Switch`, `:14` `CURRENT_APP`; each name occurs only on its import line (grep count 3 = the three import lines). Lint does not catch it (`eslint.config.js:23` disables `no-unused-vars`; `tsconfig.app.json` has `noUnusedLocals: false`).

**Finding 4 — spoofable `agent_id`:** `supabase/functions/agent-api/index.ts:1936-1942` `async function handleClaim(body)` → `requireString(body, "agent_id")` → RPC `p_agent_id`. Router `:4972-4973` `case "claim": return await handleClaim(body);` while the sibling `:4966-4967` `case "claim-render": return await handleClaimRender(body, agentId);` (fixed by #713). Comment at `:2309` documents the intended rule: "agent_id comes from the authenticated key." No agent in this repo calls route `claim` (grep of `apps/*/src` and `src/` finds no caller); it is a legacy bulk-job claim route.

**Finding 5 — lifecycle status:** `src/hooks/useScanLifecycle.tsx:11,27` type `lastScanStatus: "completed" | "completed_with_errors" | "failed" | null`; `:67-70` the `curr === "idle"` branch toasts "Scan ended … without a final result"; `:76` then sets `"completed"` regardless.

**Finding 6 — doc drift:** `docs/API_CONTRACTS.md:172-180` `POST /agent/claim-render` Request: `agent_id`; code now ignores the body field (`agent-api/index.ts:1771-1780` uses `agentId` from the key).

**Branch state:** `origin/claude/audit-backlog-fixes` has three commits over `22280a22` (`87c6c6dd`, `e7309b91`, `73196e65`); `origin/main` has since gained `14d3d546`, `01fcfc34`, `ba0144d5`, `b19fac79`, `4409e2d3`. Overlap risk is low (#717/#721 touch `apps/worker/src/handlers/*` and `tag-finish`; #713 touches `apps/worker/src/operation-loop.ts` only in the worker) but the shared-db sync commit touches `shared-db/` and `supabase/` types — merge, don't guess. PR CI (`lint-test-build`, `verify`, `deno-fmt`, `forbid-shared-db-bypass`) was green at `73196e65`.

## 6. Key findings and root cause

- Finding 1's root cause is an **API semantic change without auditing callers**: `shouldSkipPath` changed meaning (last segment = file) to fix the audit item "`#1 Dad.psd` must not be skipped", and the one caller that passes a directory *name* rather than a path was missed. The bridge scanner was written with the right primitive (`shouldSkipFolder`) and is unaffected. The fix is a one-token change at the call site **plus** a test that encodes "a bare excluded directory name is skipped" so the next semantic change cannot repeat it.
- Finding 2 is a contract gap, not a bug in the containment check: the agent → edge → admin → UI pipeline has no error channel, so "refused" and "empty" are indistinguishable. Adding an optional `error` string end-to-end is backward compatible (old agents never send it; old UIs ignore it).
- Finding 4 is the exact pattern #713 set out to close; leaving it open makes `docs/audit-2026-10-21.md:87-88` ("`claim-render`/`claim-sg-render` identity" fixed) read as if the class were closed.
- Finding 5: the hook's status union has no value for "ended without result"; the toast was fixed but the state was not.

## 7. Approaches considered and rejected

- **Revert the `shouldSkipPath` semantic change and instead special-case `#1 Dad.psd`-style names.** Rejected: the audit item is legitimate (files named `#…`/`@…` are artwork); the new semantics are right, only the directory caller is wrong.
- **Make `shouldSkipPath` detect "single segment ⇒ treat as folder".** Rejected: a bare filename (`._foo.psd`, `#1 Dad.psd`) is also a single segment; ambiguity is the bug, not the fix. Callers must say what they have.
- **Open a new PR for the fixes instead of pushing to #713.** Rejected: Finding 1 must never reach `main` separately from the change that causes it; fix on the same branch so #713 merges whole. (If the branch owner session is still active, coordinate on the PR with a signed comment first; the branch is a Claude session branch, not Albert's.)
- **Report dir-browse errors by writing a special entry `{name:"<error>", is_dir:false}`.** Rejected: pollutes the entries contract and the UI table; an explicit `error` field is cleaner.
- **Fix Finding 4 by rejecting bodies whose `agent_id` differs from the key's agent.** Rejected: the documented rule (`agent-api/index.ts:2309`) is "drop the body field, use the key"; do the same as `handleClaimRender`.
- **Add `"ended"` to the lifecycle status and leave consumers untouched.** Kept, but only after grepping consumers (Step 7) — do not widen a union blindly.

## 8. Design decisions

- **LOCKED:** `shouldSkipPath` keeps #713's semantics (last segment is a file). Directory callers use `shouldSkipFolder(name)`.
- **LOCKED:** dir-browse error channel is an **optional** `error?: string` field on `report-dir-browse` and on `DIR_BROWSE_RESULT`; `entries` stays a required array (`[]` on error) so old consumers keep working.
- **LOCKED:** `handleClaim(body, agentId)` mirrors `handleClaimRender`; body `agent_id` ignored.
- **LOCKED:** all fixes land on PR #713's branch; #713 merges as one PR; #719 closes on that merge.
- **OPEN (implementer):** exact new lifecycle status literal (`"ended"` vs `"ended_without_result"`) — pick whichever reads best in the consumers found in Step 7; the requirement is only that it is not `"completed"`.
- **OPEN:** whether to also add a `shouldSkipFolder` unit test row for `$RECYCLE.BIN`/`#snapshot` in `src/test/path-filters-skip.test.ts` — recommended, cheap.

## 9. The plan

Prerequisite: own worktree on the PR branch: `git fetch origin && git worktree add "$TMPDIR/wt-713" origin/claude/audit-backlog-fixes` then `git switch -c claude/audit-backlog-fixes --track origin/claude/audit-backlog-fixes` inside it (or `gh pr checkout 713` in a fresh worktree). Never work in the canonical checkout.

### Step 1 — Update the branch (no dependencies)
- `git merge origin/main` (merge, not rebase, to keep the PR's reviewed SHAs). Resolve conflicts preferring `origin/main` for `shared-db/**` and generated types, and the PR for its own files.
- **Gate:** `git merge-base --is-ancestor origin/main HEAD` succeeds; `npm ci && npm run lint && npm run typecheck && npm run test && npm run build` pass locally; `npm ci --prefix apps/worker && npm run build --prefix apps/worker && npm run test --prefix apps/worker` pass; `npm ci --prefix apps/windows-agent && npm test --prefix apps/windows-agent` pass.

### Step 2 — Finding 1 fix (after Step 1)
- `apps/windows-agent/src/index.ts:30`: import `shouldSkipFolder` alongside `shouldSkipPath`.
- `apps/windows-agent/src/index.ts:1365`: `if (shouldSkipFolder(entry.name)) continue;` (keep the `.ai` file branch at `:1369` using `shouldSkipPath(relativePath, …)`).
- Grep the whole repo once more for `shouldSkipPath(` and confirm every remaining call passes a file path (list in §5 is current as of this plan).
- **Gate:** `npm run build --prefix apps/windows-agent` compiles; `grep -n "shouldSkipFolder(entry.name)" apps/windows-agent/src/index.ts` finds the line.

### Step 3 — Finding 1 test (parallel with Step 2)
- `src/test/path-filters-skip.test.ts`: add
  - `it("skips excluded directory names handed to shouldSkipFolder", …)` → `shouldSkipFolder("@eaDir")`, `"#snapshot"`, `"#recycle"`, `"$RECYCLE.BIN"`, `"node_modules"`, `"_old"`, `"SAMPLE"` all `true`; `"Decor"` `false`.
  - `it("a bare excluded directory name is not treated as a file by shouldSkipPath", …)` — documents the trap: `shouldSkipPath("@eaDir")` is `false` by design (single segment = file), hence directory callers must use `shouldSkipFolder`. This test is the tripwire for the next person.
- Also add a Windows-agent-level unit test if `walkDir` can be isolated cheaply (it is a closure inside the hygiene handler; if extracting it costs more than ~20 lines, skip and rely on the package test — say so in the PR).
- **Gate:** `npm run test -- src/test/path-filters-skip.test.ts` passes; temporarily reverting Step 2 does **not** make this test fail (it tests the package, not the caller) — so the caller line is additionally pinned by a `src/test` grep-style test *only if* the implementer adds one; otherwise record the manual check in the PR.

### Step 4 — Finding 2: error channel (after Step 1)
- `apps/bridge-agent/src/api-client.ts:313` and `apps/windows-agent/src/api-client.ts:352`: `reportDirBrowse(requestId, path, entries, error?: string)` → body `{request_id, path, entries, ...(error ? {error} : {})}`.
- `apps/bridge-agent/src/handlers/path-tools.ts:97-101`, `apps/windows-agent/src/handlers/dir-browse.ts:44-50`: in the catch, pass `msg` as the fourth argument. Keep the `logger.warn`.
- `supabase/functions/agent-api/index.ts:2088-2120` `handleReportDirBrowse`: read `optionalString(body, "error")`; include `error` in `DIR_BROWSE_RESULT.value` when present; still mark the request completed.
- `src/components/settings/DirectoryBrowserTab.tsx`: extend `BrowseResult` with `error?: string`; in both the Realtime handler (`:100`) and the poll (`:108-110`), if `r.error` call `fail(r.error)` instead of `finish(r)`. The existing `toast.error` at `:125` shows it.
- `docs/API_CONTRACTS.md:212-214` (and `:90`): document optional `error` on `report-dir-browse` and on the stored result.
- **Gate:** vitest test `DirectoryBrowserTab shows the agent's error instead of an empty listing` (render with a mocked `useAdminApi.call` returning `{result:{request_id, path, entries:[], error:"Path is outside the configured NAS roots"}}` → `toast.error` called with that text and no "empty folder" state). Edge: `supabase/functions/agent-api` deno test if a harness exists for `handleReportDirBrowse`; otherwise `deno fmt`/`deno check` and a manual curl against the deployed function is the proof (Step 10).

### Step 5 — Finding 3 (parallel)
- `src/components/settings/ApisTab.tsx:2,12,14`: remove `ExternalLink`, `Plus`, `Trash2`, `Switch`, `CURRENT_APP`.
- **Gate:** `npm run typecheck && npm run lint` pass; `grep -c "ExternalLink\|Trash2\|CURRENT_APP" src/components/settings/ApisTab.tsx` → 0.

### Step 6 — Finding 4 (parallel)
- `supabase/functions/agent-api/index.ts:1936`: `async function handleClaim(_body: Record<string, unknown>, agentId: string)`; delete the `requireString(body, "agent_id")` line; router `:4973` → `handleClaim(body, agentId)`.
- `docs/API_CONTRACTS.md`: find the `POST /agent/claim` section (if present) and drop `agent_id` from its request fields; if absent, add one line under claim-render noting the same rule.
- `docs/audit-2026-10-21.md:87`: add `claim` to the identity list.
- **Gate:** `deno fmt --check supabase/functions` passes (CI `deno-fmt`); grep `requireString(body, "agent_id")` returns nothing in `agent-api/index.ts`.

### Step 7 — Finding 5 (parallel)
- `grep -rn "lastScanStatus" src/` to list consumers (`useScanLifecycle.tsx:11,27,76,90,141` plus any component reading it).
- Widen the union at `:11,27` with the chosen literal; at `:76` set it when `curr === "idle"` and no terminal status; keep `"completed"`/`"completed_with_errors"` otherwise. Update consumers that switch on the value (if any render "Completed", render "Ended without result").
- **Gate:** `npm run typecheck` passes (the union change surfaces every consumer); vitest test `scan ending without a terminal status is not recorded as completed` if the hook has a test harness (`src/test/*scan*`); otherwise manual: Settings → Scan Diagnostics after a scan that goes `running → idle`.

### Step 8 — Finding 6 (parallel)
- `docs/API_CONTRACTS.md:172-180`: Request for `claim-render`: replace `agent_id` with "none; the agent is identified by `x-agent-key`". Same for `claim-sg-render` if listed.
- **Gate:** `git diff docs/API_CONTRACTS.md` shows only these sections.

### Step 9 — CI, merge, close (after 1–8)
- Commit per finding or as one commit; message `fix(audit-backlog): skip excluded dirs in hygiene walk, surface browse errors, pin claim identity (#719)`; push to `claude/audit-backlog-fixes` (the PR branch). Post a signed comment on #713 listing the six fixes with file:line.
- `bin/ai-pr-wait 713` in the background; rerun on exit 2; do independent work meanwhile.
- Merge #713 when required checks pass (reviews advisory). Close #719 with a signed comment: merged SHA, CI run id, the test names, and the `- [ ] live proof` checklist (Step 10).
- **Gate:** `origin/main` contains the merge; `publish-frontend.yml` and `deploy-supabase.yml` runs succeed for that SHA.

### Step 10 — Live proof (after Step 9; partly waits on releases)
- Edge + frontend (deploy on merge): at dam.designflow.app → Settings → Directory Browser, request a path outside the roots (e.g. `/etc`) once a **new** bridge image is running (#681); until then the old bridge still returns `[]` — record that explicitly.
- Windows agent: after `publish-windows-agent.yml` releases and the VM updates (self-updater; see memory note "Bridge self-updater" for the false "Build mismatch"), run a hygiene scan from Settings and check the agent log shows no `@eaDir` paths in `Hygiene scan` lines and the `totalDirs` count is in the same range as the last pre-#713 scan.
- Leave on #719: `- [ ] live proof: hygiene scan on released Windows agent skips @eaDir/#snapshot` and `- [ ] live proof: out-of-root browse shows error on released bridge`. Same issue, never a new one.

## 10. Tests required

New:
- `src/test/path-filters-skip.test.ts`: `skips excluded directory names handed to shouldSkipFolder`; `a bare excluded directory name is not treated as a file by shouldSkipPath`.
- `src/test/` (vitest, component): `DirectoryBrowserTab shows the agent's error instead of an empty listing`.
- `src/test/` (hook) if harness exists: `scan ending without a terminal status is not recorded as completed`.
- Optional windows-agent `tsx --test`: `hygiene walker does not descend into excluded directories` (only if `walkDir` is extracted).

Existing that must stay green (CI "CI" workflow): root `npm run lint && npm run typecheck && npm run test`, `npm run build`; `apps/worker` build+test; `apps/windows-agent` test (`package.json:10` list incl. `path-containment.test.ts`, `bounded-read.test.ts`); `deno-fmt`; `forbid-shared-db-bypass`; `verify`.

### Adversarial cases (external inputs: NAS directory names; admin-supplied browse paths; agent request bodies)

| Input | Hostile case | Test |
|---|---|---|
| Directory entry name | `@eaDir`, `#snapshot`, `#recycle`, `$RECYCLE.BIN`, `_old`, `SAMPLE` | `skips excluded directory names handed to shouldSkipFolder` |
| File name | `#1 Dad.psd`, `@home.ai` must **not** skip | existing `does not apply folder prefix rules to filenames` |
| File name | `._art.psd`, `.DS_Store` must skip | existing `still excludes hidden files and excluded folders` |
| Admin browse path | outside configured roots (`/etc`, `..\\..`) | `DirectoryBrowserTab shows the agent's error…` + `packages/agent-common/src/path-containment.test.ts` (existing, run by both agents) |
| `report-dir-browse` body | `error` non-string / missing | `optionalString` ignores it; entries still required (`agent-api/index.ts:2092`) — covered by manual curl in Step 10 |
| `claim` body | `agent_id` of another agent | Step 6 removes the read; grep gate |

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; never push `main`; the AI merges after required checks (lean: only data-damage/secret-leak checks block); reviews are advisory and never gate.
- No shared-db change; none needed. `forbid-shared-db-bypass` check must stay green — do not touch `supabase/migrations`.
- Commit as Albert's verified identity; stage only your hunks; own worktree.
- `bin/ai-pr-wait 713` in background; no sleep loops; sign GitHub posts with `$AI_GH_SIGNATURE`.
- **Gotcha:** `src/test/path-filters-skip.test.ts` imports `../../packages/path-filters/index` (root vitest); commit `e7309b91` deliberately keeps it out of the agent package builds — do not move it into `apps/*`.
- **Gotcha:** `apps/windows-agent` and `apps/bridge-agent` consume `@popdam/path-filters` via `file:` dependency; after editing the package, `npm ci --prefix apps/windows-agent` re-links it (CI does this).
- **Gotcha:** `packages/agent-common/src` is synced into `apps/*/src/common` at build — edit the package, not the copies (`AGENTS.md:169`).
- **Gotcha:** Deno edge code must pass `deno fmt --check`; run `deno fmt supabase/functions/agent-api/index.ts` before committing.
- **Gotcha:** this plan's worktree is behind `origin/main`; all file:line refs are from the PR head `73196e65` (and `origin/main` where stated).
- **Gotcha:** agent changes do not reach machines on merge; the Windows VM needs the release channel update and the NAS needs the new `:stable` image (#681). Say so in every status.
- Times for humans in EST.

## 12. Access and environment

- Machine hetz; `gh` authenticated as `u2giants`; Supabase MCP for read-only checks (project `qsllyeztdwjgirsysgai`); Railway MCP not connected this session (not needed).
- Target: PR #713 branch `claude/audit-backlog-fixes` → `main`. Deploys on merge: edge functions (`deploy-supabase.yml`), frontend (`publish-frontend.yml` → Coolify `qxj8a0j3tpa9lq4q5rs6pezy`). Agents: release workflows named in §2.
- Secrets: 1Password `vibe_coding`; admin test login for dam.designflow.app per `docs/1password.md`; never values.
- Local run: `npm ci && npm run dev` for the frontend; agents are not run locally (tests only).

## 13. Definition of done, risks, open questions

Done when:
- [ ] Branch merged with `origin/main`, all six findings fixed on the PR branch (file:line in the PR comment).
- [ ] New tests in §10 green; CI run id recorded on #719.
- [ ] #713 merged; merged SHA on #719; edge + frontend deploy runs green.
- [ ] `docs/API_CONTRACTS.md` and `docs/audit-2026-10-21.md` updated in the same PR.
- [ ] #719 closed with the two `- [ ] live proof` items left on it (or ticked if the releases happened in-session).
- [ ] This plan's STATUS and the handoff STATUS updated.

Risks: merge conflicts with #717/#721 in `apps/worker` (low; #713 touches only `operation-loop.ts` there); widening the lifecycle union may touch a UI label — typecheck finds it. Rollback: revert the merge commit of #713 (one commit) — nothing in it is data-destructive.

Open questions: none blocking. If the owner session of `claude/audit-backlog-fixes` is still pushing, coordinate via a signed comment on #713 before pushing; otherwise proceed (30 minutes without progress on a PR branch counts as idle).

## Self-audit

1. **Executable without questions?** Yes — §5 lists every finding with the exact PR-head file:line and the surrounding plumbing (api-client, edge handler, admin route, UI poll), §9 gives per-step edits, gates and test names, §12 the environment and deploy paths.
2. **All background and rejected paths?** Yes — §3 records that the fixer did not act and that a post-review commit exists, §6 the root cause of the regression (API semantic change without caller audit), §7 six rejected alternatives, §8 locked vs open.
3. **Goal clear for judgment calls?** Yes — §1 states the business stake (no snapshot crawl, honest browse errors, no spoofable claim) and the hard rule that #713 never merges with Finding 1 unfixed.
