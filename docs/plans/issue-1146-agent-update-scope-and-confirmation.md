---
summary: "Make the Settings update screens trustworthy: a bridge update never restarts Windows renderers from any button, the server validates and records the requested scope, and an install is confirmed only with real build evidence."
kind: plan
status: open
read-when: "implementing #1146 (agent update screen findings from PR #1136)"
---

# Issue #1146 — Agent update buttons do only what they say, and confirm only real installs

Covers [u2giants/popdam3#1146](https://github.com/u2giants/popdam3/issues/1146) (advisory review of PR #1136, which fixed #1092/#1093). Handoff:
[HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md](../../HANDOFF.d/2026-11-25T2058Z-al8960ofc-claude-helper-agent-plans.md).

## STATUS

| Step | State (2026-11-25) | Evidence |
|---|---|---|
| 1. Scope the second bridge button | ⬜ open | |
| 2. Validate + store scope on the server | ⬜ open | |
| 3. No version fallback when a build id is expected | ⬜ open | |
| 4. Status matching: agent type required, small clock tolerance | ⬜ open | |
| 5. Tests | ⬜ open | |
| 6. Deploy + live proof | ⬜ open | |

**Fresh session starts at step 1.** All four findings verified present on main 787c20b8 (2026-11-25).

## 1. Ultimate goal

An administrator updating the NAS "bridge" agent from PopDAM Settings must not accidentally restart every Windows rendering machine (that interrupts work in progress), and the screen must say "installed" only when the agent really runs the new build. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, branch `main`) is POP Creations' artwork library; web app `src/` (React, served at https://dam.designflow.app via Coolify after `publish-frontend.yml`). Two agent kinds: **bridge** (`apps/bridge-agent/`, Docker on the Synology NAS; updates when it sees the `admin_config` key `AGENT_UPDATE_REQUEST`) and **windows-render** (`apps/windows-agent/`; treats `agent_registrations.metadata.trigger_update = true` as "install now and restart"). The admin edge function `admin-api` handles `trigger-agent-update` in `supabase/functions/_shared/admin-handlers/agent-handlers.ts:703-760`, deployed by `deploy-supabase.yml`. Agents report results in `admin_config` key `AGENT_UPDATE_STATUS`, written by `agent-api` (`supabase/functions/agent-api/index.ts:2774-2795`, always sets `agent_type` and server `reported_at`).

## 3. What triggered this work

Review of PR #1136 (muse-meta) — the four findings, all still true:
1. `src/lib/agent-update-confirmation.ts:40-41` — if a target build id (`targetSha`) is known but the agent reports none, the code falls through to comparing versions; when only the build changed (same version string), a stale agent confirms at once.
2. `src/components/settings/worker-management/UpdateAgentButton.tsx:112` calls `trigger-agent-update` with `{ update_action: "apply" }` and **no** `agent_type`, so `shouldFlagWindowsRenderers("apply", undefined)` (`supabase/functions/_shared/agent-update-scope.ts:5-7`) is true and every Windows renderer is flagged — the #1093 fleet-restart bug survives on this button. (The other bridge button, `src/pages/settings/AgentStatusSection.tsx:74,90`, already passes `agent_type: "bridge"`.)
3. `agent-handlers.ts:717-731` — `agent_type` is neither validated nor stored in `AGENT_UPDATE_REQUEST`; any typo (`"Bridge"`, `null`) silently means "everything".
4. `agent-update-confirmation.ts:14-21` — accepts a status with no `agent_type`, and uses `reported >= requested` with no tolerance; a 1-2 s skew between edge instances discards a real result and the 30 s poll times out. Missing tests for these and for the missing-build case.

## 4. Scope

In: the two web files, the admin handler and scope helper, tests, deploy. **NOT in this plan:** bridge/Windows agent code; how Windows agents install; the `get-latest-agent-build` route; adding a request id to agent reports (would need a bridge release — rejected below); any DB/schema change.

## 5. Current state of the code (main @ 787c20b8)

Files and lines as in §3. Tests: `src/lib/agent-update-confirmation.test.ts` (9 cases), `supabase/functions/_shared/admin-handlers/agent-update-trigger.test.ts`. Validation helpers `requireString`/`optionalString` are imported in `agent-handlers.ts:9`.

## 6. Key findings and root cause

The scope fix in #1136 was applied at one caller and as a "not bridge ⇒ everyone" default on the server. Defaults that mean "restart the whole fleet" must be explicit, not implied by a missing field.

## 7. Approaches considered and rejected

- **Flip the server default so missing `agent_type` means bridge-only** — rejected alone: a typo would still be accepted silently. Instead require an explicit, validated value.
- **Match status to request by request id** — rejected for now: the bridge report does not carry it, so it needs a bridge release; a small clock tolerance plus agent-type check solves the observed failure.
- **Remove `UpdateAgentButton`** — rejected: capability must be preserved; check whether it is still rendered (`WorkerManagementTab.tsx`) and keep it working, scoped.

## 8. Design decisions

Locked (2026-11-25):
- `trigger-agent-update` requires `agent_type` ∈ {`"bridge"`, `"windows-render"`, `"all"`}; anything else (including missing) → 400 `agent_type must be 'bridge', 'windows-render' or 'all'`. `shouldFlagWindowsRenderers(action, type)` is true only for `apply` with `windows-render` or `all`. `AGENT_UPDATE_REQUEST` is written only for `bridge`/`all` and stores `agent_type`.
- Before tightening the server, every web caller passes an explicit type (step 1 ships in the same PR, so no window where the UI sends nothing).
- Confirmation: when `targetSha` is known, a report with no `build_sha` is **not** confirmed.
- Status match: `agent_type` must equal `"bridge"`; accept `reported_at >= requested_at - 2000 ms`.
Open: none.

## 9. The plan

**Step 1 — Scope the caller (helper-ok).** `UpdateAgentButton.tsx:112` → `{ update_action: "apply", agent_type: "bridge" }`. Callers on main (checked 2026-11-25 with `grep -rn "trigger-agent-update" src supabase .github scripts apps`): only this button and `AgentStatusSection.tsx:74,90` (already bridge). No web button or script asks for a Windows-renderer apply through this route, so `"windows-render"`/`"all"` exist for completeness and admin/system calls (`userId === "system"` branch). Stop-and-ask: any caller whose intended scope is unclear. Verify: grep shows every call has `agent_type`.

**Step 2 — Server validation (lead-only: decides which machines restart).** In `handleTriggerAgentUpdate`, read `agent_type` with `requireString`, validate per §8, store it in the request value, skip the `AGENT_UPDATE_REQUEST` upsert for `windows-render`, update `shouldFlagWindowsRenderers` and its doc comment. Check `agent-api` reading of `AGENT_UPDATE_REQUEST` (`agent-api/index.ts:597-608`) ignores the extra field (it does — it reads `requested_at`). Verify: step 5 tests.

**Step 3 — Confirmation (helper-ok).** `isInstallConfirmed`: `if (base.targetSha) return sha !== null && sha === base.targetSha;` before the version comparison. Stop-and-ask: if `targetSha` can be set while the published build lacks one (check `get-latest-agent-build` response) — then report back. Verify: tests.

**Step 4 — Status matching (helper-ok).** `isStatusForRequest`: require `status.agent_type === "bridge"`; `return reported >= requested - 2000;`. Verify: tests.

**Step 5 — Tests (helper-ok).** In `src/lib/agent-update-confirmation.test.ts` add: `does not confirm when a target build is expected but the agent reports none`, `confirms same-version build change only on matching build id`, `rejects status without agent_type`, `accepts a result reported 1s before the request (clock skew)`, `rejects a result 5s before the request`, `rejects invalid timestamps`. In `agent-update-trigger.test.ts` add: `apply bridge does not flag Windows renderers`, `apply windows-render flags renderers and writes no bridge request`, `apply all does both`, `missing or misspelled agent_type returns 400 and writes nothing`, `stored request includes agent_type`. Verify: root `npx vitest run src/lib/agent-update-confirmation.test.ts supabase/functions/_shared/admin-handlers` green; root `npm test`, `npm run lint`, `npm run build` green.

**Step 6 — Deploy + live proof (lead-only).** Merge → `deploy-supabase.yml` and `publish-frontend.yml` green; confirm the live site serves the merge SHA (stale-site check in `docs/deployment.md`). Live proof: on https://dam.designflow.app Settings → workers, press the bridge "check" (not apply) and confirm the result appears; read `agent_registrations` (`select id, metadata->>'trigger_update' from agent_registrations where agent_type='windows-render'`) shows no flag set. An apply is only run when a new bridge build is actually pending; then confirm Windows renderers kept running (heartbeat uptime unchanged) and the screen confirmed on the new build id. Post with EST times on #1146 and close.

## 10. Tests required

Eleven new cases named in step 5; existing 9 confirmation tests and existing trigger tests; root `npm test`, `npm run lint`, `npm run build`, Deno check of `admin-api`.

## 11. Constraints, standing rules, gotchas

Branch + PR; AI merges; reviews advisory. Ship UI caller change and server tightening in one PR (a deployed server requiring the field before the frontend sends it would break the button — frontend and functions deploy separately, so order: the frontend change already sends the field harmlessly; the server change is safe once the frontend is live. If deploy order is uncertain, make the server accept missing `agent_type` as `bridge` for one release and log it, then tighten — note this in the PR). No DB change. Visual check of the Settings screen. Sign GitHub posts with `$AI_GH_SIGNATURE`.

## 12. Access and environment

`gh` as `u2giants`. Local: root `npm ci`, `npm run dev`, `npx vitest run …`. Admin login for live check: 1Password `vibe_coding`, PopDAM admin test login item (never paste values). Production read-only SQL via Supabase MCP with `SUPABASE_ACCESS_TOKEN` from the same vault.

## 13. Definition of done, risks, open questions

Done: steps 1-5 merged, CI/deploys green, live SHA verified, live check posted, #1146 closed, STATUS updated. Risk: an unknown script calling `trigger-agent-update` without `agent_type` gets 400 — the log line from the transition release (§11) surfaces it. Rollback: revert PR. Open: none.

## Self-audit

1. Executable without questions? Yes — §8 locks values and behaviour, §9 names lines, §11 covers deploy order.
2. Background carried? Yes — §3 four findings, §7 three rejected options.
3. Goal clear? Yes — "never restart renderers by accident; confirm only real installs".

## Lead launch prompt

```
Read docs/plans/issue-1146-agent-update-scope-and-confirmation.md (STATUS first) in u2giants/popdam3, then AGENTS.md.
You (lead) do steps 2 and 6. Hand steps 1, 3, 4, 5 to your helper (1 first).
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: finished work or an evidenced blocker; no design decisions; no merges or posts; bring back the step's stop-and-ask trigger; taken back after 30 minutes stuck.
You verify yourself: all named tests, lint/build, deploy SHAs, the live Settings check and renderer flags.
Delegation rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
```
