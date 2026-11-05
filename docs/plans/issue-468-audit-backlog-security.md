# Plan: Audit backlog: security and authorization (u2giants/popdam3#468)
Issue: https://github.com/u2giants/popdam3/issues/468
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Item (from the 2026-10-21 audit) | State | Evidence / notes |
|---|---|---|---|
| i | `admin-api` user-accessible actions let any JWT relink/queue scans | ✅ done, live-proved 2026-10-22 7:15 AM EST | Owner ruling "designers and admins only"; PR #472; gate at `supabase/functions/admin-api/index.ts:216` (403 "designer or admin role required"); proof comment on #468 |
| ii | `TAXONOMY_SYNC_CONFIG` plaintext API keys | ✅ disproved 2026-11-04 (no keys in production); retired UI removed in PR #713 | `docs/audit-2026-10-21.md` (PR #713 version) "Disproved" paragraph; `src/components/settings/ApisTab.tsx` SyncSource editor deleted in #713 |
| iii | `browse_dir` lists any absolute path | 🟡 fixed in PR #713 (merged 2026-11-04 5:12 PM EST as `2287f1b5`); live proof open | bridge `apps/bridge-agent/src/handlers/path-tools.ts` `isInsideAllowedRoots`; Windows `apps/windows-agent/src/handlers/dir-browse.ts` realpath check |
| iv | `claim-render`/`claim-sg-render` trust body `agent_id` | 🟡 fixed in PR #713 (merged 2026-11-04 5:12 PM EST as `2287f1b5`); live proof open | `supabase/functions/agent-api/index.ts` `handleClaimRender(body, agentId)` / `handleClaimSgRender(_body, agentId)` with `agentId` from `authenticateAgent` (`:93-125`, router `:4946-4948`) |
| v | Helper `popdam://checkin` / `popdam://discard` run unconfirmed | 🟡 fixed in PR #713 (merged 2026-11-04 5:12 PM EST as `2287f1b5`); live proof open | `apps/popdam-helper/src/main/protocol.ts` `confirmDeepLink` dialog before `checkin`/`discard` |
| 1 | Merge PR #713 | ✅ done | merged 2026-11-04 5:12 PM EST as `2287f1b5`; deploy verification still belongs to step 3–5 |
| 2 | Add missing containment/identity tests | prepared, held | #787 actual browse handlers/full agent suites; #789 actual router/key lookup/claim handler, full edge suite261passed/1existing skip |
| 3 | Live proof iv: authenticated identity ignores body override; original agent capability remains | common-auth live proof and actual renders observed; direct claim override not synthetically leased | SELECT-only actual-agent paired/mismatched-body requests both200/equal private hashes; real render start/completion receipts; #468 comment6651505892 |
| 4 | Live proof iii: installed bridge (next in-app update, #681) and Windows agent (auto-release) refuse a browse outside the NAS root; Settings folder picker still browses | ⬜ open | `- [ ] live proof` on #468 |
| 5 | Live proof v: installed Helper shows genuine confirmation; Cancel does nothing | live Cancel proven; configured original capability open | Installed 1.4.15 native check-in and discard dialogs/Cancel, zero POSTs, unchanged absent queues, original local status ok; #468 comments 6651233421/6651288244 |
| 6 | Repair newly confirmed global browse-request custody before ordinary installed browse proof | backend preparation, same #468 | Canonical claim #5652/version20261105065814; approved private request-owned table/RPCs, no agent update; no production browse request written |
| 7 | Close #468 with all live outcomes | open | Original configured checkout and installed ordinary browse still open |

Current machine evidence (2026-11-05): installed Helper 1.4.15 genuine native check-in/discard Cancel is proven with zero POSTs, unchanged absent queues, original local status, and owned-task/process cleanup. Original configured checkout remains unproven. Installed Windows agent 0.17.0.202's actual browse handler is byte-identical to the compiled handler exercised by #787; actual render starts/completions are observed read-only. Its authenticated SELECT-only path ignores a mismatched body ID. These do not substitute for an actual installed browse invocation. Ordinary queued browse proof was stopped before mutation after confirming unconditional global request/result overwrite, delivery to both agents, and missing authenticated report correlation. The same #468 now owns that repair; backend first/live before dependent app code. No scan/tag/render job was stopped or restarted.

Where a fresh session starts: **Step 2** (#713 merged after this plan was written; §5 below describes the pre-merge code) in a follow-up PR, then steps 3–5 as each deploy lands.

---

## 1. The ultimate goal

The October audit found five places where PopDAM trusted the wrong party: any signed-in person could re-file assets, the cloud could tell an on-site agent to list any folder on the NAS box, a render agent could claim work while pretending to be another agent, a secret might reach the browser in plain text, and a web link could silently throw away an employee's unsaved work. **When this plan is done, every one of the five is either fixed in production with proof, or shown with evidence not to be a real problem, and normal work (relinking by designers, folder picking in Settings, rendering, check-in/discard from the app's own buttons) still works.**

If a step conflicts with this goal, the goal wins — stop and flag it. In particular, a fix that blocks the Settings folder picker or stops the real agents from claiming renders is a regression, not a fix.

## 2. What this application is

See `issue-714-replace-do-spaces-key.md` §2 and `issue-229-agent-path-containment.md` §2 for the system and the three on-site programs. Relevant here in addition: the `admin-api` edge function (`supabase/functions/admin-api/index.ts`, called by the Settings/admin UI with a user JWT) and the `agent-api` edge function (`supabase/functions/agent-api/index.ts`, called by agents with an `x-agent-key` header). Edge functions deploy automatically on merge to `main` via `.github/workflows/deploy-supabase.yml` (path filter `supabase/functions/**`, only diffs `HEAD~1` — dispatch manually after a multi-commit push).

## 3. What triggered this work

Full-codebase audit merged 2026-10-21 as PR #458; the verified-but-unfixed backlog was written to `docs/audit-2026-10-21.md` ("Backlog" section, security block at lines ~81-96 on `main`) and split into issues #468 (security), #469 (correctness), #470 (efficiency), #471 (dead code), #708 (duplicates). Memory `project_audit_backlog_2026_10_21` says: pick from the doc, do not re-audit; and `op_run` cannot see the Claude scratchpad (`$TMPDIR` is under `/var/tmp/ai-sessions-1000`).

## 4. Scope

In: the five security/authorization items in the #468 body; merging the open fix PR; tests; live proof; closing.

**NOT in this plan**
- #469 correctness, #470 efficiency, #471 dead code, #708 duplicates (same PR #713 touches some of them; they are tracked on their own issues).
- The broader `require_dam_access` policy for all `USER_ACCESSIBLE_ACTIONS` (`admin-api/index.ts:173`) — Albert's ruling covered the four sibling-image actions only; the general gate waits on app-access rows being complete for every real user (memory `project_popdam_permission_layers`). Raise it as its own issue if a later audit wants it; do not expand #468.
- A signed token for deep links (the audit's "no token") — the confirmation dialog is the chosen fix (§8); tokens would need web-app changes and are out of scope.
- #229's `relative_path` containment (separate plan).
- The DO Spaces key (#714) even though PR #713 edits `fix_admin_config_secret_rotation.md`'s status line.

## 5. Current state of the code

`main` @ `01fcfc34` (2026-11-04): items iii, iv, v are **still unfixed on main**:
- `supabase/functions/agent-api/index.ts:1772` `const agentId = requireString(body, "agent_id")` in `handleClaimRender`; `:3614` `const agentId = body.agent_id as string` in `handleClaimSgRender`. The authenticated id is available at `:4948` and already passed to other handlers (`handleHeartbeat`, `handleIngest`).
- `apps/bridge-agent/src/handlers/path-tools.ts` `handleDirBrowse` (from `:55`) and `apps/windows-agent/src/handlers/dir-browse.ts:7-30` `readdir(target)` any non-empty path.
- `apps/popdam-helper/src/main/protocol.ts:82-84, 95-98` call `checkin()`/`discard()` straight from the parsed URL.

PR #713 (`claude/audit-backlog-fixes`, OPEN, all checks passing as of 2026-11-04 4:40 PM EST: `lint-test-build`, `deno-fmt`, `forbid-shared-db-bypass`, `guard`, `verify`) contains the fixes shown in the STATUS table plus unrelated #469/#471 work. Diff saved while planning at `$SCRATCHPAD/pr713.diff` (re-fetch with `gh pr diff 713`). Specifics worth knowing before merging:
- Bridge `isInsideAllowedRoots(target, [config.nasContainerMountRoot, ...config.scanRoots])` uses `realpath` on both sides; `scanRoots` is an array (`config.ts:83-86`), so the spread is correct.
- Windows check compares `realpath(getMountRoot())` with `realpath(target)`; `getMountRoot()` falls back to `\\\\host\\share` (`apps/windows-agent/src/index.ts:411`) — `realpath` on a UNC root works on Windows but will **throw** if the share is unreachable, which surfaces as the normal error reply.
- Helper confirmation uses `dialog.showMessageBox` with Cancel as default/cancel id; `checkout`, `open`, `reveal` are unchanged (they are non-destructive).
- `docs/audit-2026-10-21.md` is rewritten in #713 to a "Re-verification 2026-11-04" section listing fixed/disproved/still-open.
- **No tests** were added for iii, iv or v in #713 (`git diff --stat` shows only `src/test/path-filters-skip.test.ts`).

Item i is done and proved (PR #472, 2026-10-22). Item ii was disproved by reading production `TAXONOMY_SYNC_CONFIG` (fields `code,name,apiUrl,enabled`; no keys) and the unused editor + always-failing Sync button were deleted in #713.

## 6. Key findings and root cause

1. The remaining work is landing + proving, not designing. The previous session (Claude chat 996090b1, 2026-11-04) wrote the fixes and the issue comment "Close after #713 merges; live proof comes with agent and helper release (#681)".
2. `agent-api` already authenticates every non-bootstrap action and hands `agentId` to the router (`:4946-4948`); the two claim handlers simply ignored it. Root cause: the handlers predate the auth refactor.
3. `browse_dir` is only used by the Settings folder picker (`src/components/settings/windows-agent/AgentSetup.tsx` and the bridge setup UI) which always starts from the mount root; containing to the mount root + scan roots cannot break that picker, but the Windows mount root must be resolvable for `realpath` to succeed.
4. `popdam://` links are registered OS-wide; any web page can trigger them. Only `checkin` and `discard` mutate state (`checkoutManager.ts:333,398`).
5. Agents and helper only change on release: Windows agent auto-publishes on merge to `main` (`publish-windows-agent.yml`) and self-updates; the bridge updates in-app only (#681 owns it; bridge 1.16.21 deployed 2026-11-04 1:47 PM EST); the helper publishes on merge (`publish-popdam-helper.yml`) and installs update themselves via `latest.yml`.

## 7. Approaches considered and rejected

- Gate all `USER_ACCESSIBLE_ACTIONS` on `require_dam_access` now — rejected (memory: many real users lack an app role; would lock them out). Only the four sibling actions were gated, per Albert's words "designers and admins only".
- Store taxonomy keys under `*_API_KEY` names (audit suggestion) — moot: there are no keys in production; the dead editor was removed instead.
- Allow-list of browsable roots managed in `admin_config` — rejected: the agent already knows its roots from env/heartbeat; a second list would drift.
- Signed one-time tokens on deep links — deferred (out of scope); the confirmation dialog removes the "silent" part of the risk with no web-app change.
- Cherry-picking only the security hunks of #713 into a new PR — rejected unless #713 fails to merge: it is green and the other hunks are low risk; splitting costs more than it saves. If a merge conflict appears, **then** split (§9 step 1b).

## 8. Design decisions

| Decision | State |
|---|---|
| Sibling-image actions: PopDAM admin role or app-schema designer/administrator (ruling 2026-10-22) | LOCKED |
| `claim-*` use the authenticated agent id; body `agent_id` is ignored (not rejected) so old agent builds keep working | LOCKED |
| `browse_dir` allowed roots = mount root + configured scan roots (bridge); mount root only (Windows) | LOCKED |
| Deep-link confirmation via native dialog; default button Cancel | LOCKED |
| Where the new tests live (§10) | OPEN — follow the file conventions given; naming is the implementer's |
| Merge #713 whole vs. split | OPEN — whole unless it conflicts (§7) |

## 9. The plan

Declare class `code` (plus `deployment` when merging, since merge deploys edge functions and publishes the Windows agent and helper).

### Step 1 — Land PR #713
1a. `gh pr view 713 --json mergeable,mergeStateStatus`; `gh pr checks 713`. If `mergeable` is `MERGEABLE` and checks green: merge (`gh pr merge 713 --squash --delete-branch`), then `bin/ai-pr-wait 713` is unnecessary post-merge; instead watch the deploy runs: `gh run list --workflow=deploy-supabase.yml --limit 1`, `publish-windows-agent.yml`, `publish-popdam-helper.yml`. If the edge deploy run skipped because of the `HEAD~1` diff trap, dispatch it: `gh workflow run deploy-supabase.yml -f deploy_functions=true -f generate_types=false`.
1b. If it conflicts: create `claude/468-security-hunks` from `main`, apply only the hunks for `agent-api/index.ts`, `path-tools.ts`, `dir-browse.ts`, `protocol.ts`, `ApisTab.tsx` (taxonomy removal) and the audit doc; PR, wait with `bin/ai-pr-wait <pr>` in the background, merge.
Gate: `git log origin/main --oneline -1` contains the merge; `gh run list` shows the three publish/deploy runs succeeded; `curl -X POST …/functions/v1/agent-api` with action `claim-render` and no key → 401 (sanity that the deploy is live).

### Step 2 — Tests (follow-up PR `claude/468-security-tests`)
- **iv (edge):** `supabase/functions/_shared/claim-identity.test.ts` cannot import the monolithic `agent-api/index.ts`; instead extract the two-line identity rule into a tiny pure helper `supabase/functions/_shared/claim-identity.ts` `export function claimAgentId(authenticatedId: string, body: Record<string, unknown>): string` that returns `authenticatedId` and logs (not errors) when `body.agent_id` is present and different; call it from both handlers. Tests: `uses the authenticated agent id`, `ignores a mismatched body agent_id`, `ignores a missing body agent_id`. Runs under the root vitest project that includes `supabase/functions/**/*.test.ts` (`vitest.config.ts:29`).
- **iii (agents):** `handleDirBrowse` already takes injectable pieces on Windows (`getMountRoot`); move the containment check into `packages/agent-common/src/browse-containment.ts` `export async function assertBrowsable(target, roots, fsRealpath = realpath)` and use it from both agents. Tests in `packages/agent-common/src/browse-containment.test.ts` (node:test, added to both agents' `npm test` lists like `path-containment.test.ts`): `allows the mount root itself`, `allows a child of a scan root`, `rejects a sibling of the mount root`, `rejects a symlink that resolves outside` (use a temp dir with a real symlink), `rejects when the root cannot be resolved`.
- **v (helper):** `protocol.ts` imports Electron; refactor `handleDeepLink` to accept an injected `confirm: (msg, detail) => Promise<boolean>` (default = `confirmDeepLink`) so `apps/popdam-helper/src/main/protocol.vitest.ts` can mock `./checkoutManager` and `./tray` with `vi.mock`: `checkin runs only after confirmation`, `discard is skipped when the dialog is cancelled`, `checkout/open/reveal never prompt`.
Gate: root `npm run test`, `npm test --prefix apps/windows-agent`, `npm test --prefix apps/bridge-agent` green; each new test fails when its guard is removed (prove once locally).

### Adversarial-cases table (trust boundary: cloud → agent commands, agent → cloud claims, web → helper)

| Input | Hostile case | Expected | Test |
|---|---|---|---|
| `claim-render` body `agent_id` | another agent's UUID | claim recorded under the caller's authenticated id | `ignores a mismatched body agent_id` |
| same | absent | same | `ignores a missing body agent_id` |
| `claim-sg-render` body | same two cases | same | reuse helper; `claimAgentId` tests cover both call sites |
| `browse_dir.path` | `/etc` (bridge), `C:\Windows` (Windows) | error "outside the configured NAS root(s)", no listing | `rejects a sibling of the mount root` |
| same | `/nas/../etc` | rejected after realpath | covered by `rejects a sibling…` with a traversal input |
| same | symlink inside root pointing outside | rejected | `rejects a symlink that resolves outside` |
| same | `""` | lists mount root (unchanged behaviour) | `allows the mount root itself` |
| same | a scan root child (bridge) | allowed | `allows a child of a scan root` |
| `popdam://discard?checkoutId=…` | opened by a hostile web page | dialog; Cancel → nothing | `discard is skipped when the dialog is cancelled` |
| `popdam://checkin?checkoutId=…` | same | dialog; Continue → checkin | `checkin runs only after confirmation` |
| `popdam://checkout?token=…` | n/a (non-destructive) | no prompt | `checkout/open/reveal never prompt` |

### Step 3 — Live proof iv (after the edge deploy)
Using the real bridge agent key is not available to the AI; instead use the `agent_registrations` evidence: after deploy, confirm both agents still claim and complete renders (`render_queue` rows with `claimed_by`/`agent_id` equal to the registered ids, `updated_at` after the deploy time) — proves the authenticated path works. For the negative case, pair a throwaway agent through the admin "repair agent"/pairing-code flow is overkill; instead cite the unit test plus a read-only check that no `render_queue` row since deploy carries an `agent_id` not in `agent_registrations`. Post on #468 with EST times.

### Step 4 — Live proof iii
Windows agent: after it self-updates to the post-merge release, from Settings → Windows agent → folder picker (Playwright as the admin tester) browse the root (works) and, via the admin-api `browse_dir` command path with `path: "C:\\Windows"`, observe the error reply in the agent's command result. Bridge: wait for #681's next in-app update, then repeat with `path: "/etc"`. Gate: screenshots/JSON of one allowed and one refused browse per agent.

### Step 5 — Live proof v
Needs a helper on a post-merge build. Today's Windows helper device (registered 2026-11-04 12:53 PM EST) will auto-update from `latest.yml`. If it is an AI-driven machine, open `popdam://discard?checkoutId=<nonexistent>` and screenshot the dialog; Cancel; confirm no error notification. If it is an employee's machine, record the proof as pending on #468 and leave the `- [ ]` row (do not drive a user's machine). Decide by `helper_devices.user_id`.

### Step 6 — Close
Comment on #468: five items with state (done/disproved/fixed+proved), PR numbers, test names, EST times. Close.

## 10. Tests required

New: `supabase/functions/_shared/claim-identity.test.ts` (3 cases), `packages/agent-common/src/browse-containment.test.ts` (5 cases), `apps/popdam-helper/src/main/protocol.vitest.ts` (3 cases) — names in §9. Keep green: CI (`npm run lint`, `typecheck`, `test`, worker build/test, windows-agent test, build) and `npm test --prefix apps/bridge-agent` locally.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR; AI merges; never push to `main`. Wait on CI with `bin/ai-pr-wait <pr>` in the background.
- No shared-DB change anywhere in this plan.
- Merging #713 deploys edge functions and publishes the Windows agent and helper automatically; the bridge does not update (#681). Dispatch `deploy-supabase.yml` manually if the run skipped (`HEAD~1` trap).
- `packages/agent-common` is synced into `apps/*/src/common/` by `sync.mjs`; edit the package only; add new test files to both agents' `npm test` lists.
- Edge tests run under the root vitest project, not Deno; keep new `_shared` helpers free of Deno globals.
- Reviews are advisory; the `review-fixer` bot may open `review-finding` issues after merge — handle them normally, do not wait.
- Never drive an employee's helper machine; proof on their device is observed from data only.
- Times in EST; sign posts with `$AI_GH_SIGNATURE`; `op_run` cannot see the Claude scratchpad — use `$TMPDIR`.

## 12. Access and environment

hetz; `gh` as `u2giants`; Supabase MCP `execute_sql` → live Virginia project (read-only); admin and viewer tester logins in 1Password `vibe_coding` (memory `project_popsg_tester_login`; same two used for the #472 proof); Playwright/Chrome via skills for dam.designflow.app; Windows agent host per `docs/MULTI_TENANT_AGENTS.md`; NAS SSH `ai@edgesynology1` for bridge logs. Local: `npm ci` at root and in each agent dir.

## 13. Definition of done, risks, open questions

Done: #713 (or its split) merged and deployed; tests PR merged, CI green; live proofs iii (both agents), iv, v posted on #468 with EST times (v may stay `- [ ]` if only an employee's device exists — say so); #468 closed with each of the five items accounted for.
Risks: Windows `realpath` on an unreachable UNC root makes `browse_dir` error instead of listing — acceptable (the picker already fails when the share is down), rollback = revert the dir-browse hunk. `claim-*` ignoring body `agent_id`: no agent sends a foreign id today, so no behaviour change. Helper dialog: if the helper runs headless the dialog could block — Electron tray apps always have a UI session; note if observed.
Open: whether today's helper device is AI-driven (step 5); whether #713 still merges cleanly when the implementer arrives (step 1b handles it).

## Self-audit

1. Executable without questions? Yes — §5 pins every unfixed line on `main` and the exact fix hunks in #713, §9 gives commands and gates per step, the table names a test per hostile case, §12 names every login by vault/title.
2. Carries all background and rejections? Yes — §3/§5/§6 record the audit origin, the ruling for item i, the disproof of item ii, the no-tests gap in #713, the deploy-trap and release mechanics; §7 lists five rejected routes.
3. Goal clear enough for judgment? Yes — §1 states both halves (close the five trust holes, keep designers/picker/renders/check-in working), which decides the split-vs-merge and "ignore vs reject body agent_id" choices.
