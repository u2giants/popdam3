---
summary: Issue #973 plan: make restore-from-snapshot single-flight, validate the candidate list, flag truncated version lists, and fix the root-file folder label. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-973, or changing the admin "Older copies" restore feature
---

# Plan: harden restore-from-snapshot ("Older copies") — u2giants/popdam3#973

Issue: https://github.com/u2giants/popdam3/issues/973 (review finding on PR #971, folder shortening #963 Phases 1–2)
Parent plan (do not rewrite; read its STATUS first): [`plan_folder_shortening_snapshot_restore.md`](../../plan_folder_shortening_snapshot_restore.md) — Phase 2
Handoff: [HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md](../../HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md)
Written 2026-11-25 (3:55 PM EST) by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Re-confirm the four findings on `main` | ⬜ open | |
| 2 | Bridge: single-flight guard for `snapshot_versions` / `snapshot_restore` | ⬜ open | |
| 3 | Server: validate `candidates` shape before delivery | ⬜ open | |
| 4 | Bridge + UI: `truncated` flag when more than 200 versions | ⬜ open | |
| 5 | UI: `folderOf()` for a file with no folder | ⬜ open | |
| 6 | Tests, PR, CI, merge, bridge release | ⬜ open | |
| 7 | Live proof on production and close #973 | ⬜ open | |

**Where a fresh session starts:** step 1.

---

## 1. The ultimate goal

Albert (owner) can open any file in PopDAM, press "Find older copies", see every older version kept in the NAS snapshots (even from before a folder was renamed), and restore one beside the current file. The goal of this plan is that this feature is **safe and honest**: one press makes exactly one restored copy (never a surprise second copy), a damaged setting can never crash the NAS helper, the list says so when it is not complete, and the folder labels on the list are correct.

**If a step conflicts with this goal, the goal wins — stop and flag it on #973.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, live at https://dam.designflow.app) is POP Creations' library of design files kept on a Synology NAS (share `mac`, `/volume1/mac`, on `edgesynology1`). Parts that matter here:

- **Web app** (`src/`, React + Vite, deployed by Coolify after merge to `main`). The "Older copies" section is `src/components/library/OlderCopiesSection.tsx`, admin-only, shown in the asset detail panel and the style panel's Files tab.
- **Edge functions** (`supabase/functions/`, Supabase project `qsllyeztdwjgirsysgai`, deployed by `.github/workflows/deploy-supabase.yml` on merge). `admin-api` receives the browser's request; `agent-api` serves the NAS helper. Shared logic: `supabase/functions/_shared/snapshot-requests.ts`, handlers in `supabase/functions/_shared/admin-handlers/snapshot-handlers.ts`.
- **Bridge agent** ("the helper", `apps/bridge-agent/`), a Node container on the NAS. Every heartbeat it receives pending commands; `snapshot_versions` lists versions in `/volume1/mac/#snapshot/<GMT…>/…`, `snapshot_restore` copies one back. Code: `apps/bridge-agent/src/commands/heartbeat-commands.ts`, `apps/bridge-agent/src/handlers/snapshot-commands.ts`, `apps/bridge-agent/src/handlers/snapshot-tools.ts`. Ships only with a `apps/bridge-agent/package.json` version bump (now `1.17.3`) via `.github/workflows/publish-bridge-agent.yml` (`:stable` image); the NAS applies it when an admin requests an update (`AGENT_UPDATE_REQUEST`, Settings → Agents).
- The request/response channel is a single row per kind in `admin_config` (`SNAPSHOT_VERSIONS_REQUEST`, `SNAPSHOT_RESTORE_REQUEST`, and `…_RESULT`). A request stays `status: "pending"` until the bridge reports back with the same `request_id` (`reportResult`, `snapshot-requests.ts`).

## 3. What triggered this work

The advisory AI reviewer (Muse) reviewed PR #971 (merged 2026-11-11) and filed #973 with four findings. The fixer only deferred it. No incident has been reported; finding 1 is a real risk because a restore is a NAS write.

## 4. Scope

In: the four findings below, their tests, and a bridge release.

### NOT in this plan
- Any change to which paths are candidates (`dam_asset_path_candidates` in shared-db) or to rename history.
- Any change to snapshot retention or Hyper Backup.
- Non-admin access to the feature (stays admin-only).
- The folder-shortening renames themselves (parent plan Phase 5).

## 5. Current state of the code (checked on `main` @ `787c20b8`, 2026-11-25)

- `heartbeat-commands.ts:113-132` — `snapshot_versions` and `snapshot_restore` call `ctx.handleSnapshotVersions(...)` / `ctx.handleSnapshotRestore(...)` fire-and-forget with only `.catch`. No busy flag. `BridgeBusyFlags` (`heartbeat-commands.ts:20-30`) has flags for every other long job (pattern: `isCrawlingStyleGuides` at `:241-247`, accessors in `apps/bridge-agent/src/index.ts:338-339`).
- `snapshot-commands.ts:8-30` — both handlers run to completion and then report. Until the report lands, the server keeps re-delivering the same pending command on every heartbeat (`snapshotCommands`, `snapshot-requests.ts:126-141`).
- `snapshot-tools.ts:161-170` — restore loop: on `EEXIST` it tries the next name `(restored DATE 2)`. So a second concurrent run of the same request makes a second copy.
- `snapshot-requests.ts:131` — `candidates: (v.candidates as string[]) ?? []` trusts the stored value; a string or object reaches the bridge, where `cmd.candidates.length` (`snapshot-commands.ts:9`) or `.filter` throws.
- `snapshot-tools.ts:17,113` — `MAX_VERSIONS = 200`; `versions.slice(-MAX_VERSIONS)` drops the oldest silently. Test `cap of 200 respected` exists (`snapshot-tools.test.ts:69`). The UI (`OlderCopiesSection.tsx:122-126`) has no notion of truncation.
- `OlderCopiesSection.tsx:48` — `const folderOf = (p) => p.slice(0, p.lastIndexOf("/"))`; for `x.psd` this returns `"x.ps"`. Used at `:66` and `:184` ("was in:" label).

## 6. Key findings and root cause

1. **Duplicate restore**: re-delivery + no in-flight guard. Heartbeats are seconds apart; a hash-verified copy of a large PSD takes longer than that, so the second delivery starts a second copy. Root cause is the bridge, not the server: the server cannot know the bridge started.
2. **Unchecked shape**: `admin_config.value` is JSON; anything can be stored there by hand or by a future bug.
3. **Silent truncation**: the cap is right (protects the heartbeat payload) but the UI is not told.
4. **Root file**: `lastIndexOf` returns `-1`. Real impact is a wrong label only; restore of such a file is already refused (`snapshot-requests.ts:81-82`).

## 7. Approaches considered and REJECTED

- **Server-side "claimed" status** (bridge marks the request `in_progress` before working): needs a new agent-api action and still races if two heartbeats return before the claim lands. The bridge-local guard is simpler and sufficient because there is exactly one bridge.
- **Dedupe in `restoreFromSnapshot` by checking for an existing `(restored DATE)` file**: would block a legitimate second restore of the same version on purpose.
- **Raising or removing the 200 cap**: the result travels through one `admin_config` row and the heartbeat path; keep the cap, add the flag.

## 8. Design decisions

- **Locked:** restore stays copy-beside, never overwrite; destination computed on the server from the asset row (parent plan D-decisions, 2026-11-11). Admin-only.
- **Locked:** guard key is the `request_id`, plus one boolean per kind so only one listing and one restore run at a time.
- **Open (implementer):** whether to hold the in-flight set in `index.ts` or inside `snapshot-commands.ts` module scope. Criterion: whichever lets `heartbeat-commands.test.ts` test it with the existing `makeCtx` helper.

## 9. The plan

**Step 1 — Re-confirm on `main`.** Re-read the files in §5; if any finding is already fixed, mark the row "moot" with the commit SHA. `lead-only` (judgment). Gate: §5 still matches, noted in the PR description.

**Step 2 — Single-flight on the bridge.** In `heartbeat-commands.ts`, add `isListingSnapshots` and `isRestoringSnapshot` to `BridgeBusyFlags`, with accessors in `index.ts` next to `isCrawlingStyleGuides`. In the two handlers (`:113-132`): if the flag is set, log at debug "snapshot X already running for <request_id>" and return; otherwise set it, run, and clear it in `.finally`. Also remember the last finished `request_id` per kind for 10 minutes so a re-delivery that arrives after completion but before the server stores the result does not run again. Report both flags in the heartbeat status object next to `style_guide_crawl` (`index.ts:417`) so the admin page can see them. Behaviour when done: pressing Restore once produces exactly one `(restored DATE)` file even if the copy takes minutes. `lead-only` (production NAS write path). Gate: new test in `heartbeat-commands.test.ts` "snapshot_restore is not started twice while running" passes.

**Step 3 — Validate candidates on the server.** In `snapshotCommands` (`snapshot-requests.ts:126-141`) deliver `snapshot_versions` only when `Array.isArray(v.candidates)` and every entry is a non-empty string; otherwise deliver `null` and write `VERSIONS_RESULT_KEY` `{ request_id, ok:false, error:"Stored request is damaged; press Find older copies again", versions:[] }` and set the request to `completed`, so the browser stops polling. Also in the bridge handler, treat a non-array as an error report rather than a throw. `helper-ok` — files and behaviour fully named. Stop-and-ask: if `snapshotCommands` is called somewhere it cannot write (it is pure today), bring it back to the lead instead of adding a db parameter. Gate: `snapshot-handlers.test.ts` cases "non-array candidates are not delivered" and "string candidates produce a failed result".

**Step 4 — Truncation flag.** Change `listSnapshotVersions` (`snapshot-tools.ts:113`) to return `{ versions, truncated, total }` (or add `truncated` to the report payload in `snapshot-commands.ts:10-11`). Pass it through `reportResult` unchanged (it already stores the body). In `OlderCopiesSection.tsx`, when `truncated` is true show one line above the list: "Showing the newest 200 of N versions. Older ones exist in the snapshots." `helper-ok`. Stop-and-ask: if the merged list in `mergeVersions` changes the count meaningfully, ask which number to show. Gate: updated `cap of 200 respected` test asserts `truncated === true` and `total`; UI checked visually (step 7).

**Step 5 — `folderOf` for root files.** `const folderOf = (p) => { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }`. `helper-ok`. Stop-and-ask: none. Gate: unit test in `src/test/older-copies-merge.test.ts` (new) that `folderOf("x.psd") === ""` (export the helper).

**Step 6 — Land.** Bump `apps/bridge-agent/package.json` version (patch), run all tests (§10), branch `claude/issue-973-snapshot-hardening`, PR to `main` with "Fixes #973" only after live proof (use "Refs #973" in the PR), merge when required checks pass (reviews are advisory). Confirm the bridge image published (`publish-bridge-agent.yml` run green) and request the update in Settings → Agents. `lead-only` (merge/release). Gate: heartbeat shows the new bridge version.

**Step 7 — Live proof.** As an admin (1Password `vibe_coding` → the `ai-admin` PopDAM test login item; never paste values) open a file that has older copies, Find older copies, Restore one version once; confirm exactly one `(restored …)` file appears (PopDAM's next scan ingests it as a new asset, per parent plan 2.5) and bridge logs show no second run. Then delete the restored test copy via the NAS (it is our own test file — record it). Post a comment on #973 with times in EST, then close. `lead-only` (live judgment). Gate: the comment exists with evidence.

## 10. Tests required

- `apps/bridge-agent/src/commands/heartbeat-commands.test.ts`: "snapshot_restore is not started twice while running"; "snapshot_versions is not started twice while running"; "a finished request_id redelivered within 10 minutes is ignored".
- `apps/bridge-agent/src/handlers/snapshot-tools.test.ts`: extend "cap of 200 respected" to assert `truncated` and `total`; "under 200 versions is not truncated".
- `supabase/functions/_shared/admin-handlers/snapshot-handlers.test.ts`: "non-array candidates are not delivered"; "string candidates produce a failed result".
- `src/test/older-copies-merge.test.ts`: `folderOf` root file and nested file.
- Must stay green: `npm test`, `npm run typecheck`, `npm --prefix apps/bridge-agent test`.

## 11. Constraints and gotchas

- Never push to protected `main`; branch + PR. Reviews are advisory and never block.
- No database structure change is needed; if one seems needed, it goes to `popcre/shared-db`, never this repo's `supabase/migrations/`.
- The bridge only updates when its version is bumped and an update is requested.
- Restores write to production NAS `edgesynology1`; the live proof makes one copy and must remove it afterwards.
- NAS writes happen on edge1 only; edge2 is a one-way copy.
- Times quoted to Albert in EST/EDT.

## 12. Access and environment

- `gh` authenticated as `u2giants` for `u2giants/popdam3`.
- Admin test login: 1Password vault `vibe_coding`, PopDAM `ai-admin` item (look it up by title; never print values).
- Local: `npm ci` at repo root; `npm --prefix apps/bridge-agent ci`.
- Production site: https://dam.designflow.app.

## 13. Definition of done, risks, open questions

Done when: all STATUS rows ✅ with evidence; PR merged; edge functions deployed (deploy-supabase run green); bridge image published and running the new version; live proof comment on #973; #973 closed.

Risks: a guard bug could stop restores entirely — rollback is to request the previous bridge `:stable` digest (or revert the PR and bump again). Open: none.

## Self-audit

1. *Could a fresh session execute this without asking?* Yes — §2 names every component, §5 gives line refs, §9 names files, behaviour and gates.
2. *Does it carry the background and rejected options?* Yes — §6 root causes, §7 three rejected designs.
3. *Is the goal clear enough for judgment calls?* Yes — §1: one press, one copy; honest list; correct labels.

## Lead launch prompt

```
You are the lead for u2giants/popdam3 issue #973. Read AGENTS.md, then docs/plans/issue-973-snapshot-restore-hardening.md (STATUS first) and Phase 2 of plan_folder_shortening_snapshot_restore.md.
Do steps 1, 2, 6, 7 yourself. Hand steps 3, 4, 5 to your helper in that order, one at a time.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; make no design decisions; no merges, pushes or GitHub posts; bring a stop-and-ask trigger back to you; if stuck 30 minutes, you take the step back.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
You run every test in §10 yourself, review the helper's diff, and do the live proof. Update the STATUS table in the same PR.
```
