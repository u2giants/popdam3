# Plan: Review finding: u2giants/popdam3#677 fix(ingest): retire stale duplicate records once their path is gone (u2giants/popdam3#678)
Issue: https://github.com/u2giants/popdam3/issues/678
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS (read first)

| # | Step | State | Evidence / date |
|---|------|-------|-----------------|
| 1 | Re-verify the four findings on `main` | ⬜ open | Verified present at plan time on `01fcfc34` (§5) |
| 2 | Finding 1: write a history row when reviving a retired record | ⬜ open | |
| 3 | Finding 3: extract the revive decision into a tested helper | ⬜ open | |
| 4 | Finding 4: bridge logs the server's refusal reason | ⬜ open | |
| 5 | Finding 2: document `stale_candidates` and `retire-stale-asset` in `docs/API_CONTRACTS.md` | ⬜ open | |
| 6 | Update `docs/KNOWN_QUIRKS.md` #81 wording; bridge version bump | ⬜ open | |
| 7 | PR, CI, merge, edge deploy + bridge image published | ⬜ open | |
| 8 | Live proof (revive row visible), close #678 | ⬜ open | |

**Where a fresh session starts:** Step 1. No branch exists for this issue. Coordinate with the #681 plan (same folder): its moved-file test files on the NAS are the cheapest live-proof fixture for Step 8.

---

## 1. The ultimate goal

PopDAM keeps one record per design file. When staff reorganise folders on the NAS, the old record used to stay "live" forever (5,683 of them were cleaned up on Nov 3). PR #677 added automatic retirement of such stale records and automatic revival if the file ever comes back to its old path. The review found that this revival can wrongly bring back a record an admin deliberately purged, that the API documentation does not mention the new behaviour, that the revival logic has no test, and that when the server refuses a retirement the NAS agent says nothing about why.

When this is done: a record an admin purged stays purged even if a file reappears; the API contract document describes what the agent and server actually exchange; the revive decision is covered by a test; and refusal reasons are visible in the bridge log. **If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM is POP Creations' internal Digital Asset Manager for licensed product art (web app dam.designflow.app). A bridge agent in Docker on Synology NAS `edgesynology1` scans `/volume1/mac` design files and calls Supabase edge function `agent-api`; the web app and admin tools call `admin-api`.

- Repo https://github.com/u2giants/popdam3, branch `main`; feature branch + PR; the AI merges.
- Edge functions: `supabase/functions/` (Deno), deployed by `.github/workflows/deploy-supabase.yml` to Supabase project `qsllyeztdwjgirsysgai`.
- Bridge agent: `apps/bridge-agent/` (Node), image built by `.github/workflows/publish-bridge-agent.yml` on `main` pushes touching `apps/bridge-agent/**`, `packages/path-filters/**`, `packages/agent-common/**`; published to GHCR `popdam-bridge:stable`. The NAS applies it only on an in-app update request (`admin_config.AGENT_UPDATE_REQUEST {action:"apply"}`, `AGENTS.md:438`, `docs/deployment.md:258`).
- Machine: hetz. Today 2026-11-04.

## 3. What triggered this work

PR #677 (head `aadc7a38`, merged Nov 3) added:
- `supabase/functions/_shared/stale-asset-retirement.ts` (pure helpers `staleRetirementRefusal`, `inheritedAiFields`, `RETIRED_STALE_MARKER = "retired-stale-duplicate:"`) with tests;
- `agent-api` route `retire-stale-asset` (`supabase/functions/agent-api/index.ts:1309-1386` on today's main) and `stale_candidates` in the ingest `created` response (`:1291-1306`);
- the ingest "revive" branch (`:1202-1218`): a soft-deleted record at the incoming path is revived (`is_deleted:false`) if its **latest** `asset_path_history` row's `new_relative_path` starts with the marker;
- `apps/bridge-agent/src/stale-record-retirement.ts` (`retireConfirmedStaleRecords`) with node:test tests; bridge version 1.16.20;
- `docs/KNOWN_QUIRKS.md` #81.

The advisory AI review (reviewer "glm", run 41683962860) raised four findings. The fixer deferred ("source moved to 56b46074", a `deno fmt` commit that shifted line numbers). Nothing has been fixed since: `git log` on the files shows only the fmt commit after #677.

Finding 4's text is truncated in the issue body and in the PR comment (`apps/bridge-agent/src/st` then cut). Its title is "Refusal reasons silently dropped (observability, informational)". Reading the code confirms the only match: `apps/bridge-agent/src/stale-record-retirement.ts:37` calls `await deps.retire(...)` and discards the returned `{ retired, reason }`, so a server refusal (`not_found`, `same_record`, `not_live`, `path_changed_since_check`, `same_path`, `hash_mismatch`, `filename_mismatch`, `size_mismatch`, `open_checkout`) is never logged. This plan treats that as the finding.

## 4. Scope

In scope: the four findings; a regression test for the revive decision; doc updates; bridge patch bump; deploy; live proof.

**NOT in this plan:**
- Changing the retirement identity rules (filename + `quick_hash` + `file_size`), the open-checkout refusal, or the copy-to-survivor logic. Reviewer verified them sound.
- Touching the #51 move guard or `relative_path` handling.
- Making the admin purge (`supabase/functions/_shared/admin-handlers/purge-handlers.ts:43-47`, `:151-155`) write history rows. The fix is on the revive side (D1); purge stays as is.
- Any DB schema change (none needed; `asset_path_history` has the columns used: `asset_id`, `old_relative_path`, `new_relative_path`, `detected_at`).
- Re-retiring or re-checking the 5,683 records from Nov 3, or the 493 live records still carrying an `ENOENT` read error (DB count 4:46 PM EST) — those belong to #681/#684.
- Requesting the NAS agent update as part of this PR (see D5).
- Issue #705 (separate plan, also bumps the bridge version: see §11 ordering note).

## 5. Current state of the code (verified on `main` = `01fcfc34`, 2026-11-04 4:45 PM EST)

- **Finding 1 present.** `supabase/functions/agent-api/index.ts:1202-1218`:
  ```ts
  let revive = false;
  if (existingByPath.is_deleted) {
    const { data: lastHistory } = await db.from("asset_path_history").select("new_relative_path")
      .eq("asset_id", existingByPath.id).order("detected_at", { ascending: false }).limit(1).maybeSingle();
    revive = lastHistory?.new_relative_path?.startsWith(RETIRED_STALE_MARKER) ?? false;
  }
  const updateFields = { ...(revive ? { is_deleted: false } : {}), filename, ... };
  ```
  No history row is written on revive. The purge handlers soft-delete with `update({ is_deleted: true })` and write no history (`purge-handlers.ts:43-47` and `:151-155`). Hence: retired → returns (revived, no row) → purged (no row) → returns again → last row is still the marker → wrongly revived. `docs/KNOWN_QUIRKS.md:1309` promises "A file returning under a purge's soft delete is unchanged."
- **Finding 2 present.** `docs/API_CONTRACTS.md:94-123` documents `POST /agent/ingest` response as `action`, `asset_id`, `ok` only; grep for `stale` or `retire` in that file returns nothing.
- **Finding 3 present.** No test file under `supabase/functions/agent-api/` (only `index.ts`); the revive decision is inline in `handleIngest` (`:950` onward). Existing tests: `supabase/functions/_shared/stale-asset-retirement.test.ts` (refusal + inheritance), `apps/bridge-agent/src/stale-record-retirement.test.ts` (4 cases: retires on ENOENT; keeps when file exists; keeps on unmounted share; keeps on non-ENOENT error).
- **Finding 4 present.** `apps/bridge-agent/src/stale-record-retirement.ts:37`: `await deps.retire(candidate.id, survivingAssetId, candidate.relative_path);` result unused. `api.retireStaleAsset` (`apps/bridge-agent/src/api-client.ts:267-274`) does return `{ retired, reason }`.
- Other history writers, for consistency of row shape: move (`agent-api/index.ts:1162-1166`), manual move (`:1487-1491`), retire (`:1379-1383`). All insert `{ asset_id, old_relative_path, new_relative_path }`. The detail panel lists the last 10 rows (`src/components/library/AssetDetailPanel.tsx:229-240`).
- Bridge `package.json` version today: `1.16.21`; the NAS runs `1.16.21` build `522e5722` (DB `agent_registrations`, 4:46 PM EST).
- Live: 5,683 marker rows, last written Nov 3 12:53 PM EST; none since (no agent has retired anything yet because the running scan only finished ingesting rule-proof files; see #681 plan).

## 6. Key findings and root cause

- Root cause of finding 1: the revive signal is "last history row is a marker", but two state changes (revive, purge) write no row, so the marker stays "last" indefinitely. Any fix must make a revive leave a non-marker row as the newest row; then a later purge (no row) is followed by a return whose last row is the revive row (not a marker) → no revive. That is exactly the documented invariant.
- `handleIngest` is a ~350-line handler with DB calls interleaved; there is no harness for edge route handlers in this repo (convention noted by the reviewer). The practical way to test the decision is to extract a pure function into `_shared/stale-asset-retirement.ts` (already vitest-covered via the root "edge-functions" project).
- The bridge's `Deps.retire` type already carries `reason`; only the caller ignores it. `logger.warn(message, details)` is the established pattern (`index.ts:1292`).
- A bridge change requires a version bump in the same commit (`docs/deployment.md:268`). The #705 plan also bumps; whichever merges second must bump again.

## 7. Approaches considered and REJECTED

- **Make purge write a history row** (so the marker is superseded by the purge) — rejected: it fixes only the purge path; any other soft delete (duplicate cleanup, future tools) would leave the same hole. Writing the row on revive closes the hole at its source and keeps purge handlers untouched.
- **Delete the marker row on revive** — rejected: history is an audit trail and the retirement backup/undo procedure (NAS `stale-retirement-backup/UNDO.sql`, see #681 handoff) relies on the marker rows existing.
- **Store a `revived_at`/`retired_reason` column on `assets`** — rejected: schema change through shared-db for a problem solvable with the existing history table.
- **Test `handleIngest` end-to-end with a fake Supabase client** — rejected: no harness exists, the handler has dozens of chained calls, and the reviewer's own convention note accepts helper-level tests. Extract and test the decision instead.
- **Have the bridge count refusals into scan counters** — rejected for now: counters are a persisted contract (`SCAN_PROGRESS.counters`) shown in the UI; a log line satisfies the informational finding without widening the contract. OPEN to revisit if refusals turn out frequent.

## 8. Design decisions

LOCKED (2026-11-04):
- D1. On revive, insert `asset_path_history { asset_id: existingByPath.id, old_relative_path: <the marker value just read, e.g. "retired-stale-duplicate:<survivorId>">, new_relative_path: relativePath }` **before** the `assets` update. `new_relative_path` is a real path so it never matches `startsWith(RETIRED_STALE_MARKER)`. The detail panel will show it as "retired-stale-duplicate:<id> → Decor/.../file.pdf", which reads as "came back".
- D2. New pure helper in `supabase/functions/_shared/stale-asset-retirement.ts`:
  `export function revivalFromHistory(lastNewRelativePath: string | null | undefined, assetId: string, relativePath: string): { asset_id: string; old_relative_path: string; new_relative_path: string } | null` — returns the row to insert when the last history row is a marker, else `null`. `handleIngest` becomes `const revival = existingByPath.is_deleted ? revivalFromHistory(lastHistory?.new_relative_path, existingByPath.id, relativePath) : null;` and `revive = revival !== null`.
- D3. Bridge: in `retireConfirmedStaleRecords`, capture `const result = await deps.retire(...)`; if `!result.retired`, call `deps.warn("Stale record kept by server", { assetId: candidate.id, reason: result.reason ?? "unknown" })`. Successful retirements stay silent (no log spam on the first real cleanup run).
- D4. Docs: `docs/API_CONTRACTS.md` gets `stale_candidates` under the ingest response and a new `### POST /agent/retire-stale-asset` block (request: `asset_id`, `surviving_asset_id`, `confirmed_absent_path`; response: `ok`, `retired`, `reason` with the enumerated reasons; rules: agent-only auth, never moves a record, copies first then marks, revive semantics). `docs/KNOWN_QUIRKS.md:1309` sentence "A file that returns to that path revives the record." gains ", writing a history row so a later purge is not undone".
- D5. Bridge version bump in the same commit (patch). **Do not** request the NAS agent update from this PR; the NAS is mid full scan (`SCAN_PROGRESS.status = running` at 4:46 PM EST) and #681 owns agent updates. Note on #681 that `1.16.2x` carries the refusal logging so its next update picks it up.
- D6. No change to the retire route's server-side checks.

OPEN:
- O1. Whether `revivalFromHistory` should also require `old_relative_path`'s survivor to still exist. Default: no (keeps the helper pure and the behaviour as reviewed); revisit only if a live case shows a revived record whose survivor was since deleted.
- O2. Whether to also log the server's `not_found` reason at `info` instead of `warn`. Default: `warn` for everything; it is rare.

## 9. The plan

Branch `fix/678-stale-retirement-review` from `main`. One PR. Order below avoids merge pain with #705 (see §11).

**Step 1 — Re-verify (10 min).** `git fetch origin`, confirm the four §5 locations. If #705's PR already merged, `apps/bridge-agent/package.json` is `1.16.22`; plan your bump as `1.16.23`.
Gate: §5 lines match what you see.

**Step 2 — Helper + test (finding 3).**
File `supabase/functions/_shared/stale-asset-retirement.ts`: add `revivalFromHistory` per D2, exported, with a doc comment naming the purge scenario.
File `supabase/functions/_shared/stale-asset-retirement.test.ts`: add `describe("revivalFromHistory")` with the tests in §10.
Gate: `npx vitest run supabase/functions/_shared/stale-asset-retirement.test.ts` passes.

**Step 3 — Revive writes a history row (finding 1).**
File `supabase/functions/agent-api/index.ts:1202-1218`. Replace the inline `revive` computation with the helper (D2). After computing `revival`, when non-null:
```ts
const { error: revivalHistoryError } = await db.from("asset_path_history").insert(revival);
if (revivalHistoryError) return err(revivalHistoryError.message, 500);
```
Keep `...(revive ? { is_deleted: false } : {})` in `updateFields`. Order matters: history first, then the asset update (if the asset update fails, a stray revive row for a still-deleted record is harmless: the next ingest at that path finds a non-marker last row and does not revive — flag this in a code comment).
Also import nothing new beyond the helper (already imported from `../_shared/stale-asset-retirement.ts` at `:70`).
Gate: `npm run lint && npm run typecheck` green; `deno check supabase/functions/agent-api/index.ts` if deno is on PATH (optional; CI's deploy step type-checks on deploy).

**Step 4 — Bridge logs refusals (finding 4).**
File `apps/bridge-agent/src/stale-record-retirement.ts:37` per D3. File `apps/bridge-agent/src/stale-record-retirement.test.ts`: add the two tests in §10 (the `run` helper at lines 7-18 needs a `warn` capture and a `retire` stub that can return `{ retired: false, reason: "hash_mismatch" }`).
File `apps/bridge-agent/package.json`: bump patch.
Gate: `npm test --prefix apps/bridge-agent` passes (node:test).

**Step 5 — API contract doc (finding 2).**
File `docs/API_CONTRACTS.md`: after line 123 (`- ok`) add `- stale_candidates — only with action created: up to 20 live records sharing filename, quick_hash and file_size at other paths; the bridge verifies each on disk and may call retire-stale-asset (see below)`. Insert a new `### POST /agent/retire-stale-asset` section before `### POST /agent/check-changed` (line 125) per D4.
Gate: the two route names appear in the doc; `grep -n "retire-stale-asset\|stale_candidates" docs/API_CONTRACTS.md` shows both.

**Step 6 — Quirk doc.** `docs/KNOWN_QUIRKS.md:1309` per D4.
Gate: sentence present; no other section touched.

**Step 7 — PR, CI, merge, deploy.**
Commit as Albert's verified identity, staging only the files above. PR title `fix(ingest): revive writes a history row; bridge logs retirement refusals; document stale-record routes (#678)`, body `Closes #678` with the four findings mapped. `bin/ai-pr-wait <pr>` in the background; merge when required checks pass (reviews advisory). After merge confirm: `deploy-supabase.yml` run success (edge changed), `publish-bridge-agent.yml` run success and GHCR `:stable` tagged with the new version (`gh run view` log line "Bridge Agent version: 1.16.2x").
Gate: both runs green for the merge SHA.

**Step 8 — Live proof and close.**
The edge change is live immediately after deploy; the bridge change is live on the NAS only after a later update (D5). Proof for finding 1 needs a retired record whose file returns:
1. Reuse the #681 fixture (`Decor/Generic Decor/Unused/_ai_test_681/...`, see that plan; the PDF name must contain a PDF keyword such as `tech pack` or it will never ingest). After #681's move has retired record A (marker row present), move the file back to A's path and let a scan ingest it.
2. Read-only DB check (`mcp__supabase__execute_sql`): `select old_relative_path, new_relative_path, detected_at from public.asset_path_history where asset_id = '<A>' order by detected_at desc limit 3` → newest row has `old_relative_path` starting `retired-stale-duplicate:` and `new_relative_path` equal to A's path; `assets.is_deleted = false`.
3. If #681 is already closed and its fixture removed, create a two-copy fixture the same way (copy a small real tech-pack PDF to two new folders under `Decor/Generic Decor/Unused/_ai_test_678/{a,b}/`, scan, delete copy `b`, scan → retirement, restore `b`, scan → revive). Remove fixtures at the end; the records they created can stay soft-deleted (purge is not needed).
4. Finding 4 proof is the bridge unit test plus, after the next NAS update, one `Stale record kept by server` log line if any refusal occurs; it is informational, so the unit test suffices to close.
Post the evidence (SHA, run ids, the history rows, EST time) on #678 signed with `$AI_GH_SIGNATURE`, close. If the live revive proof cannot be done the same day (scan still running), leave `- [ ] live proof: revive history row` on #678 and say so in the closing note; do not open another issue.

### Adversarial cases (trust boundary: agent-supplied ids/paths reach DB writes)

| Input | Hostile case | Test |
|---|---|---|
| last history `new_relative_path` | `null` / missing row | `revivalFromHistory returns null when there is no history` |
| last history `new_relative_path` | a normal path (move) | `does not revive after a normal move row` |
| last history `new_relative_path` | `retired-stale-duplicate:` with empty survivor id | `revives on the marker even with an empty survivor id` (still a marker; server wrote it) |
| last history `new_relative_path` | `RETIRED-STALE-DUPLICATE:x` (case) | `marker match is case-sensitive` (locks existing behaviour; server writes lowercase) |
| sequence | retire → return → purge → return | `a revive row supersedes the marker so a later purge is not undone` (pure test over the row sequence: feed the helper the newest row after each step) |
| bridge `retire` result | `{ retired: false, reason: "hash_mismatch" }` | `reports the server's refusal reason` |
| bridge `retire` result | `{ retired: false }` with no reason | `reports unknown when the server gives no reason` |
| bridge `retire` | throws (network) | existing `keeps the record on any error other than ENOENT` still passes |

## 10. Tests required

`supabase/functions/_shared/stale-asset-retirement.test.ts` (vitest, root "edge-functions" project):
- `revivalFromHistory returns null when there is no history`
- `does not revive after a normal move row`
- `returns a history row whose old path is the marker and new path is the incoming path`
- `revives on the marker even with an empty survivor id`
- `marker match is case-sensitive`
- `a revive row supersedes the marker so a later purge is not undone`

`apps/bridge-agent/src/stale-record-retirement.test.ts` (node:test):
- `reports the server's refusal reason`
- `reports unknown when the server gives no reason`
- Existing four tests remain green.

Suites: root `npm run lint && npm run typecheck && npm run test`; `npm test --prefix apps/bridge-agent`; `npm run build`. Windows-agent and worker suites untouched but run in CI.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; the AI merges; never push to `main`. Reviews advisory; lean required checks.
- No DB DDL in this repo; none needed. `shared-db-guard.yml` fails any migration file here.
- Never treat `quick_hash` as unique (`AGENTS.md:234`); this plan does not touch identity checks.
- Bridge version bump in the same commit as any bridge change (`docs/deployment.md:268`). **Ordering with #705:** both plans bump `apps/bridge-agent/package.json`. Merge whichever PR is ready first; rebase the other and bump once more. Never leave two merged commits with the same version.
- Do not request the NAS agent update during a running scan or the PDF rescan; #681 owns updates (coordinator handoff `HANDOFF.d/2026-11-03T2242Z-hetz-claude-dam-open-work-coordinator.md` §5: "Run it once only").
- The revive row must be inserted before the asset update; never after (see Step 3 reasoning).
- Do not modify the bridge self-updater (memory `project_bridge_self_updater.md`).
- `bin/ai-pr-wait <pr>` in background; no sleep loops. Sign GitHub posts with `$AI_GH_SIGNATURE`. Times in EST.
- Albert is never asked to click or type; the NAS fixture work is done by the AI over SSH alias `edgesynology1` (read-only, no sudo, `scp` disabled — copy with `cp` on the NAS, i.e. inside an SSH session, from an existing tech-pack PDF).
- Live proof stays on #678 as a checklist item if not completed; no new issue.

## 12. Access and environment

- `gh` authenticated on hetz. Commit identity: Albert's verified (`git var GIT_COMMITTER_IDENT`).
- Supabase MCP `execute_sql` read-only against `https://qsllyeztdwjgirsysgai.supabase.co` (works; confirmed 4:46 PM EST). psql fallback: 1Password vault `vibe_coding`, item "Supabase DB Password - shared POP database", via `op run`.
- NAS: `ssh edgesynology1`. Share root `/volume1/mac`; library paths are relative to it (`Decor/...`). Long reads follow the `synology-long-running-operations` skill.
- Bridge logs: `docker logs` on the NAS needs sudo (memory `feedback_nas_sudo_block_ritual.md`); the Settings → Agents page shows `last_error` only. For finding 4 rely on the unit test.
- Local: `npm ci` at root; `npm ci --prefix apps/bridge-agent && npm test --prefix apps/bridge-agent`.
- Work in a dedicated worktree.

## 13. Definition of done, risks, open questions

Done when:
- [ ] One merged PR with `Closes #678` containing Steps 2-6.
- [ ] Tests in §10 exist by name; "CI" green on the merge SHA.
- [ ] `deploy-supabase.yml` success; `publish-bridge-agent.yml` success with the bumped version in its log.
- [ ] Live proof of the revive history row posted on #678 (or the checklist item left on #678 with the reason).
- [ ] #681 told (one comment) that the published `:stable` carries refusal logging, so its next agent update needs no extra step.
- [ ] This plan's STATUS rows cite artifacts; the handoff file's STATUS updated.

Risks and rollback: the extra insert on revive adds one write to a rare path; failure returns 500 to the agent, which already contains per-file errors. Rollback is a revert PR; no data cleanup needed (extra history rows are inert). Bridge bump without NAS update has no runtime effect.

Open questions: O1, O2 (§8). Nothing for Albert.

## Self-audit

1. **Executable without questions?** Yes: §5 pins each finding to today's lines, §8 D1-D6 fix the design, §9 gives code and gates per step, §10 names tests, §12 names access by location, §9 Step 8 says exactly how to obtain the live fixture (including the PDF-keyword trap).
2. **All background and dead ends?** Yes: §3 explains the truncated finding 4 and how it was reconstructed, §6 the root cause and the no-harness convention, §7 five rejected approaches, §11 the #705 version-bump collision and the "one agent update" rule from the coordinator handoff.
3. **Goal clear for judgment calls?** Yes: §1 states "purged stays purged; contract documented; decision tested; refusals visible" with the goal-wins rule; an implementer who finds the history insert impossible in order can still satisfy the invariant by any row that is not a marker.
