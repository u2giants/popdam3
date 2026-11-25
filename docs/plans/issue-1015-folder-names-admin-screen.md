---
summary: Plan for #1015, #1008, #1013 — fix the Folder Names admin screen (Settings → File Health): admin-only, shows needs-attention folders, typed report, safe paging, honest wording, test coverage. Read its STATUS first.
kind: plan
status: open
read-when: changing src/components/settings/FolderGuardTab.tsx or supabase/functions/_shared/folder-rules/guard.mjs
---

# Plan: Folder Names admin screen fixes — u2giants/popdam3#1015, #1008, #1013

Issues covered (review findings on merged PRs of folder shortening #963, Phase 6):
- https://github.com/u2giants/popdam3/issues/1008 — PR #1006 "live folder-name guard"
- https://github.com/u2giants/popdam3/issues/1013 — PR #1010 "parallel scan to fit edge time limit"
- https://github.com/u2giants/popdam3/issues/1015 — PR #1014 "run the check in the browser"

Parent plan (do not rewrite; STATUS first): [`plan_folder_shortening_snapshot_restore.md`](../../plan_folder_shortening_snapshot_restore.md) Phase 6
Shares the rule engine with: [issue-1310 plan](issue-1310-folder-rename-engine-and-executor.md) (its step 2 wires `guard.test.mjs` into CI; do not duplicate)
Handoff: [HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md](../../HANDOFF.d/2026-11-25T2055Z-al8960ofc-claude-folder-names-plans.md)
Written 2026-11-25 (3:55 PM EST) by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence |
|---|------|-------|----------|
| 1 | Re-confirm findings; mark moot ones | ⬜ open | |
| 2 | Admin-only screen and menu entry | ⬜ open | |
| 3 | Typed report; show needs-attention list | ⬜ open | |
| 4 | Engine: no-op aliases; system folders excluded from counts | ⬜ open | |
| 5 | Paging: shared LIKE escape, root from rules, cap and cancel | ⬜ open | |
| 6 | Wording | ⬜ open | |
| 7 | Tests | ⬜ open | |
| 8 | PR, CI, merge, deploy check, screenshot proof, close issues | ⬜ open | |

**Where a fresh session starts:** step 1.

---

## 1. The ultimate goal

Settings → File Health → Folder Names is Albert's on-demand check that no new folder breaks the agreed naming rules or makes a file path too long for Windows. It must be **accurate** (no false "rule-breaking" rows, no hidden needs-attention folders, counts that mean what they say), **admin-only** like the rest of the folder project, and **solid** (doesn't hammer the database, fails cleanly). It never renames anything.

**If a step conflicts with this goal, the goal wins — stop and flag it on #1015.**

## 2. What this application is

PopDAM (repo `u2giants/popdam3`, live at https://dam.designflow.app) is POP Creations' library of design files on a Synology NAS (share `mac`). Paths are stored in Supabase (`public.assets.relative_path`). The web app is React + Vite in `src/`, deployed by Coolify after merge to `main`.

The Folder Names screen:
- `src/components/settings/FolderGuardTab.tsx` (114 lines) reads every live asset path under the design tree in the browser (16 parallel id ranges, 1,000 rows per request), then calls `folderGuard()`.
- `supabase/functions/_shared/folder-rules/guard.mjs` (46 lines, pure JS) builds the folder set, runs `planRenames()` from `core.mjs` (the same engine the rename planner uses), and reports rule-breaking folders, folders with over-length files, and needs-attention folders. Type file `guard.d.mts`.
- Rules: `supabase/functions/_shared/folder-rules/rules.json` (byte-identical copy at `tools/folder-rename/rules.json`).
- Rendered from `src/pages/SettingsPage.tsx:201` under the File Health tab (`:94`, `:187-201`).

History: PR #1006 put the check in an edge function; it hit the edge compute limit; PR #1010 parallelised it; PR #1014 moved it into the browser and deleted the edge handler.

## 3. What triggered this work

Advisory AI reviews of PRs #1006, #1010, #1014 (DeepSeek). The fixer deferred all three.

## 4. Scope

In: the still-present findings in §5.

### NOT in this plan
- Rule changes to `core.mjs` other than the no-op alias guard (step 4) — the rename-rule bugs are in the issue-1310 plan.
- Making it nightly (owner accepted on-demand on 2026-11-13; parent plan Phase 6 row).
- Any renaming from this screen.
- CI wiring of `tools/folder-rename/*.test.mjs` (issue-1310 plan step 2).

## 5. Current state (verified on `main` @ `787c20b8`, 2026-11-25)

Moot (code removed by PR #1014): #1008 `@ts-ignore` in the deleted handler; #1008 stale admin-api comment; #1008 Deno JSON import; #1008 handler test; #1013 handler bucket test (handler gone — but the same bucket math now lives in the browser, see G7). #1015 f1 (`resolveJsonModule`) is moot in effect: CI typecheck on `main` passes (run 45695969527, Typecheck step success).

Still present:
- **G2** (#1008) tests not in CI — covered by issue-1310 step 2.
- **G3** (#1008) `attention`/`attention_total` returned by `guard.mjs:41,44`; `FolderGuardTab.tsx` declares `attention_total` (`:16`) but renders neither.
- **G4** (#1008) `core.mjs:114` `aliasFor` returns the alias even when it equals the name after normalization; `:178-179`, `:186-189` push `customer_alias` unconditionally. 13 of 21 aliases normalize equal to their key (`Dollar General`→`Dollar_General`, `Kohl's`→`Kohls`, `B&N`→`B-N`). Effect: an already-renamed folder (`Dollar_General`) gets a spurious `case_only` attention entry (`core.mjs:310`).
- **G5** (#1008) `FolderGuardTab.tsx:28` escapes only `_` in the LIKE prefix. No shared escape helper in `src/` (a private `escapeLike` exists at `src/lib/order-list.ts:61`).
- **G6** (#1008) `:20` hard-codes `ROOT` while `:28` uses `rules.root`; `:71` says "Checking every file…" but reads only live (`is_deleted = false`) assets.
- **G7** (#1008, #1013) `:30-47` 16 buckets in `Promise.all`, no concurrency cap, no cancel when one fails, no test of the bucket math; each mount pages ~172k rows (cached 5 min by react-query `staleTime`).
- **G8** (#1008) `core.mjs:262` excludes `@eaDir`, `#recycle`, `#snapshot` from renames only; `guard.mjs:11,22-30,36` count them.
- **G10** (#1008) `src/pages/settings/SettingsNav.tsx:56-58` has no "Folder Names" entry.
- **G12** (#1015 f2) `FolderGuardTab.tsx:48` `as Report` over `guard.d.mts:1` `Record<string, unknown>`.
- **G13** (#1015 f3) `SettingsPage.tsx:201` renders `<FolderGuardTab />` for any signed-in user; the old edge handler was admin-only. Pattern to copy: `OlderCopiesSection.tsx:96-97` (`const { isAdmin } = useIsAdmin(); if (!isAdmin) return null;`, hook `src/hooks/useIsAdmin.ts`).

## 6. Key findings

The move into the browser fixed the time limit but quietly dropped the admin gate and kept the type assertion that hides the `attention` field. Signed-in users can already read live `assets` rows (RLS), so the data exposure is small; the issue is that an admin tool, and its 172-request load, became everyone's.

## 7. Approaches considered and REJECTED

- **Back to an edge function**: hit the compute cap twice (PRs #1006, #1010).
- **A database RPC computing the report**: would duplicate the JS rule engine in SQL; two engines drift.
- **Nightly cached snapshot table**: needs a shared-db structure change and a scheduler for an on-demand admin tool; not worth it now.
- **Removing the 16-way split**: sequential paging of ~172 pages is slow; keep parallel but capped at 4.

## 8. Design decisions

Locked: on-demand, admin-only, read-only, same engine as the planner (2026-11-13). Open: concurrency cap value (4 suggested; criterion: report loads in under ~60 s on the office connection and no 5xx in edge/PostgREST logs).

## 9. The plan

**Step 1 — Re-confirm.** Re-check §5 on current `main`; record moot items with evidence in the PR description. `lead-only`. Gate: list in PR.

**Step 2 — Admin-only (G13, G10).** In `FolderGuardTab.tsx` add the `useIsAdmin` gate (render a one-line "Admins only" note for non-admins, and do not run the query: `enabled: isAdmin`). In `SettingsPage.tsx` hide the Folder Names sub-tab for non-admins. Add a "Folder Names" entry under file-health in `SettingsNav.tsx:56-58`, admin-only, matching how that file shows its other entries. `helper-ok`. Stop-and-ask: if `SettingsNav` has no admin-filter pattern. Gate: test "non-admin sees no folder report and runs no query".

**Step 3 — Typed report; show attention (G3, G12).** In `guard.d.mts` declare `export interface GuardReport { … }` with every field `guard.mjs` returns (including `attention: { kind: string; old_path: string; proposed: string; note: string }[]`) and type `folderGuard` to return it. In the tab: `const report: Report = { generated_at, ...folderGuard(...) }` (annotation, no `as`). Render a third card "Needs a person (N)" listing `attention` rows (kind, folder, proposed name) — same table style as the other two. `helper-ok`. Stop-and-ask: if the type no longer matches what `guard.mjs` returns. Gate: `npm run typecheck`; screenshot.

**Step 4 — Engine fixes (G4, G8).** `core.mjs`: push `customer_alias` only when `alias && alias !== name`. `guard.mjs`: filter `inRoot` with the same exclusion list `core.mjs:262` uses — export that list from `core.mjs` (`export const SYSTEM_DIRS = ["@eaDir", "#recycle", "#snapshot"]`) and use it in both places. Run `node tools/folder-rename/plan.mjs` against the frozen listing and confirm `old-to-new.csv` is unchanged (G4 only removes attention rows); commit the regenerated `needs-attention.csv`/`summary.md` if they change, with a line in the PR saying why. Coordinate: if the issue-1310 plan's step 13 is in flight, land this first or rebase onto it. `lead-only` (engine shared with production renames). Gate: tests "already-renamed customer folder is not flagged", "system folders not counted"; CSV diff empty.

**Step 5 — Paging (G5, G6, G7).** Move the private `escapeLike` from `src/lib/order-list.ts:61` to an exported `escapeLikePattern` in `src/lib/` (keep `order-list.ts` using it) and use it for the prefix. Replace `ROOT` with `rules.root + "/"`. Extract the bucket math into an exported `idBuckets(n)` and the loader into `loadPaths(client, prefix, { concurrency })`; run buckets through a small pool of 4; pass an `AbortController` so one failure cancels the rest (`abortSignal(signal)` on each query) and the error is shown once. `helper-ok`. Stop-and-ask: if the supabase client version lacks `abortSignal`. Gate: tests in §10.

**Step 6 — Wording (G6).** "Checking every file…" → "Checking every file PopDAM knows about…"; the summary line says "files in PopDAM (deleted files not included)". `helper-ok`. Gate: screenshot.

**Step 7 — Tests.** See §10. `helper-ok`. Stop-and-ask: if a component test needs a test harness that does not exist (then put the logic tests in `src/test/folder-guard-load.test.ts` and skip the render test). Gate: `npm test` green.

**Step 8 — Land and prove.** Branch `claude/issue-1015-folder-names-screen`, PR to `main` ("Refs #1015 #1008 #1013"), merge when required checks pass. Confirm https://dam.designflow.app serves the merge SHA (`docs/deployment.md` stale-site check). As admin (1Password `vibe_coding`, PopDAM `ai-admin` item) screenshot Settings → File Health → Folder Names with all three cards; as a non-admin test user (if one exists in the same vault; otherwise use the app's impersonation, which `useIsAdmin` honours) screenshot the "Admins only" note. Comment on all three issues with evidence (signed `$AI_GH_SIGNATURE`) and close them. `lead-only`.

## 10. Tests required

- `tools/folder-rename/guard.test.mjs`: "already-renamed customer folder is not flagged" (`…/Cust Adopted/Dollar_General/x.psd` → zero rule-breaking, zero attention); "system folders not counted" (`…/@eaDir/…` path excluded from `files_checked` and `over_length`); "attention rows are returned".
- `src/test/folder-guard-load.test.ts`: `idBuckets(16)` covers `00000000-…` to the end with no gap or overlap; loader pages a bucket with 2,500 rows across 3 requests; one bucket error aborts the others and rejects once; at most 4 requests in flight; LIKE prefix escapes `%`, `_`, `\`.
- `src/test/folder-guard-tab.test.tsx` (if harness exists): non-admin sees no folder report and runs no query.
- Must stay green: `npm test`, `npm run typecheck`, `npm run lint`, `node --test tools/folder-rename/*.test.mjs`.

## 11. Constraints and gotchas

- Never push to protected `main`; AI merges; reviews advisory.
- `core.mjs` is shared with the production rename tool; any change re-checks the frozen CSV (step 4).
- UI work must be verified visually (screenshots).
- No DDL; no new required checks.
- Times to Albert in EST/EDT.

## 12. Access and environment

- `gh` as `u2giants`. Local `npm ci`, `npm run dev`. Admin login 1Password `vibe_coding` → PopDAM `ai-admin`.

## 13. Definition of done, risks, open questions

Done when: STATUS rows ✅; PR merged; site serves the SHA; screenshots posted; #1008, #1013, #1015 closed.
Risks: admin gate mistake hides the screen from Albert — the screenshot proof as admin catches it; rollback = revert PR. Open: concurrency cap (§8).

## Self-audit

1. *Fresh session without questions?* Yes — §2, §5 line refs, §9 files and gates, §12.
2. *Background and rejected options?* Yes — §2 history of three PRs, §6, §7.
3. *Goal clear?* Yes — §1 accurate, admin-only, solid, read-only.

## Lead launch prompt

```
You are the lead for u2giants/popdam3 issues #1015, #1008, #1013. Read AGENTS.md, then docs/plans/issue-1015-folder-names-admin-screen.md (STATUS first).
Do steps 1, 4, 8 yourself. Hand steps 2, 3, 5, 6, 7 to your helper, one at a time, in plan order.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Helper rules: return finished work or an evidenced blocker; no design decisions; no merges, pushes or GitHub posts; bring every stop-and-ask trigger back to you; if stuck 30 minutes, you take the step back.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
You run all tests, review each helper diff, check the frozen CSV is unchanged, and take the screenshots. Update STATUS in the same PR.
```
