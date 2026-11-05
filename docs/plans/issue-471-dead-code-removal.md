# Plan: Audit backlog: dead code and duplication (u2giants/popdam3#471)
Issue: https://github.com/u2giants/popdam3/issues/471
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS

| # | Step | State | Evidence / notes |
|---|------|-------|------------------|
| 0 | Land PR #713 (five dead files) onto `main` | ✅ done | merged 2026-11-04 5:12 PM EST as `2287f1b5`; its file list deletes all five. §5 describes the pre-merge state |
| 1 | Worktree + branch from post-#713 `main` | ⬜ open | |
| 2 | Delete `supabase/functions/_shared/types.ts` | implemented | zero importers |
| 3 | Delete `apps/bridge-agent/src/constants.ts` | implemented | zero importers |
| 4 | Retire `sync-external` edge function (source, config, test, deployed copy) | ⬜ open | caller removed by #713; stub remains |
| 5 | Retire `classify-erp-categories` admin-api route and its `OP_ACTIONS` entry | ⬜ open | handler returns 400 unconditionally |
| 6 | Retire helper-api `POST /logs` and helper `sendLog` | ⬜ open | `sendLog` has no callers; route stores nothing |
| 7 | Doc sweep (`docs/audit-2026-10-21.md`, `docs/ADMIN_OPERATIONS.md`, `docs/INFRASTRUCTURE.md`, `docs/architecture.md`, `docs/ERP_ENRICHMENT_PLAN.md`, `docs/POPDAM_HELPER.md`) | ⬜ open | |
| 8 | PR, CI, merge, deploy verification | ⬜ open | |
| 9 | Live proof on #471 and close | ⬜ open | `- [ ] live proof` stays on #471 until §13 proof exists |

**Where a fresh session starts:** Step 1 (#713 is merged). Duplicate-code work is NOT here; it is `docs/plans/issue-708-remove-duplicated-code.md`.

---

## 1. The ultimate goal

PopDAM carries files and HTTP routes that nothing calls any more. Each one costs a reader time ("is this live?"), hides real behaviour behind dead branches, and in two cases (`sync-external`, `classify-erp-categories`) still answers HTTP requests with a canned error that looks like a broken feature. When this plan is done, every file and route listed on issue #471 is either gone from `main` and from the deployed services, or has been re-verified as live and struck from the issue with the reason written down.

Nothing a user can see changes. No data changes. No database schema changes.

**If a step conflicts with this goal, the goal wins — stop and flag it.** Concretely: if deleting something turns out to break a real caller (a test fails, a grep finds an importer, a live request hits the route), do not force the deletion; mark that item "still live" on the issue with the evidence and move on.

## 2. What this application is

PopDAM is POP Creations' digital asset manager (PopDAM at https://dam.designflow.app) with a sibling style-guide app (PopSG at https://sg.designflow.app) in the same repository. Stack: Vite + React + TypeScript frontend (`src/`), Supabase (Postgres + edge functions in `supabase/functions/`, project `qsllyeztdwjgirsysgai`, Virginia), a Railway worker (`apps/worker/`), a Synology NAS bridge agent (`apps/bridge-agent/`, Docker image `ghcr.io/u2giants/popdam-bridge:stable` on host `edgesynology1`), a Windows render agent (`apps/windows-agent/`), and an Electron helper (`apps/popdam-helper/`). Repo `u2giants/popdam3`, default branch `main`, developed on the production VPS `hetz`. Read `AGENTS.md` first; it routes to everything else.

## 3. What triggered this work

The 2026-10-21 full-codebase audit (PR #458, written up in `docs/audit-2026-10-21.md`) listed dead files, retired stubs and duplicated code. Issue #471 tracks the dead-code half; the duplicates were split to #708 on 2026-11-04. A re-verification on 2026-11-04 (comment on #471 by chat `996090b1`) opened PR #713, which deletes five of the files and rewrites the audit doc. The issue body says the remaining scope is "dead-code removal in one PR; `sync-external` goes with the #468 UI removal" — and #713 already removes that UI (the `TaxonomySourceEditor` in `src/components/settings/ApisTab.tsx`, including the only `fetch` to `/functions/v1/sync-external` at `ApisTab.tsx:204` on today's `main`).

## 4. Scope

**In:**
- Merge/land #713 if it is still open (Step 0).
- Delete the four remaining dead items and the two retired stubs named in §5.
- Update the docs that describe them.
- One PR.

**NOT in this plan:**
- The issue's "Baseline observations" (full-run test flakiness, disk at 97–100%): the issue scope dropped them; disk is now 75%.
- Any duplicate consolidation (`nas-config` queries, search helpers, retry helpers, pairing-code generators, bridge/Windows agent module drift, `UsersAndInvitations` vs `UsersTab`). That is issue #708 → `docs/plans/issue-708-remove-duplicated-code.md`.
- The #468 security items (`browse_dir` containment, `claim-render` identity, helper deep links) — #713 carries those; do not reopen them here.
- #469 (correctness) and #470 (efficiency) items.
- Any `shared-db` change. None is needed; if one appears to be, stop (it would mean the item is not dead).
- Bridge/Windows agent releases. Deleting `apps/bridge-agent/src/constants.ts` changes no runtime behaviour, so no version bump is required for it; the bridge update that #713 needs is tracked on #681, not here.
- Removing the `helper_logs` idea from the roadmap. The route is deleted because it stores nothing; a future log store would be a new feature with its own issue.

## 5. Current state of the code (verified 2026-11-04 on worktree tip `01fcfc34`, which contains `origin/main` `4409e2d3`)

### Deleted by open PR #713 (still PRESENT on `main`)
| File | Lines | Importers on `main` |
|------|-------|---------------------|
| `src/hooks/use-mobile.tsx` | 19 | none |
| `src/pages/LandingPage.tsx` | 78 | none |
| `src/components/library/ScanMonitorBanner.tsx` | 162 | none |
| `supabase/functions/_shared/erp-mapper.ts` | 190 | none |
| `supabase/functions/_shared/mg-codes.ts` | 275 | none |

PR #713 (`claude/audit-backlog-fixes`): state OPEN, `mergeable: MERGEABLE`, checks `lint-test-build: SUCCESS`, `deno-fmt: SUCCESS`, `forbid-shared-db-bypass: SUCCESS`, `verify: SUCCESS`, `guard: SUCCESS`, `Entire Gates: NEUTRAL`. Its diff shows `deleted file mode` for exactly those five paths plus the `ApisTab.tsx` hunk that removes `TaxonomySourceEditor` and the `sync-external` fetch. It also rewrites `docs/audit-2026-10-21.md` lines 79–170 into a "Re-verification 2026-11-04" section that lists the remaining items of this plan as "still open".

### Still present and dead (not touched by #713)
- `supabase/functions/_shared/types.ts` (85 lines). `grep -rn "_shared/types" supabase/functions` returns no importer. Header comment says it mirrors `OperationState` in `src/hooks/usePersistentOperation.ts`; that hook does not import it.
- `apps/bridge-agent/src/constants.ts` (59 lines). `grep -rn "constants" apps/bridge-agent/src | grep import` returns nothing. (The `@shared/constants` imports you will see in `apps/popdam-helper/` are a different file, `apps/popdam-helper/src/shared/constants.ts`, documented at `docs/POPDAM_HELPER.md:75` — do NOT delete that one.)

### Retired stubs still answering requests
- `supabase/functions/sync-external/index.ts` (13 lines): returns HTTP 410 for every POST ("This taxonomy sync is retired…"). Registered in `supabase/config.toml:15` (`[functions.sync-external]`). Only caller on `main`: `src/components/settings/ApisTab.tsx:204` — removed by #713. A contract test pins the stub: `src/test/core-licensor-property-contract.test.ts:19-24` ("retires the legacy PopDAM taxonomy writer loudly") reads the file and expects `"core.licensor and core.property"`, `"410"`, and no `.upsert(`. It is deployed to the Supabase project (the deploy workflow `.github/workflows/deploy-supabase.yml` deploys on `supabase/functions/**` changes; it never deletes).
- `classify-erp-categories`: `supabase/functions/admin-api/index.ts:2229-2230` routes to `handleClassifyErpCategories` in `supabase/functions/_shared/admin-handlers/erp-handlers.ts:171-176`, which unconditionally returns 400 "AI classification runs in the background worker. Use the persistent operation (Start button) instead". The real work is the worker op `erp-classify` (`apps/worker/src/operation-loop.ts:632`, `apps/worker/src/handlers/erp.ts`), started from `src/components/settings/erp-enrichment/EnrichmentControls.tsx:17` via `usePersistentOperation("erp-classify")`. No frontend code calls the admin-api action name (`grep -rn "classify-erp-categories" src` → none). `supabase/functions/_shared/operation-constants.ts:215` maps `"erp-classify": "classify-erp-categories"` inside `OP_ACTIONS` (line 203); `OP_ACTIONS` has no readers outside its own definition (`grep -rn OP_ACTIONS supabase/functions` → only the definition). Docs still describe the route as live: `docs/ADMIN_OPERATIONS.md:346`, `docs/INFRASTRUCTURE.md:205`, `docs/architecture.md:90`, `docs/ERP_ENRICHMENT_PLAN.md:114`.
- helper-api `POST /logs`: `supabase/functions/helper-api/index.ts:738` routes to `handleLogs` at `:684-691`, which authenticates then returns `{ ok: true }` without storing anything (comment: "future: helper_logs table"). Header comment at `:16`. Client side: `apps/popdam-helper/src/main/damClient.ts:223-225` defines `sendLog`, and `grep -rn sendLog apps/popdam-helper/src` finds no caller besides the definition.

### Already on `main`, nothing to do
Nothing on the #471 list is already removed on `main`; everything either waits on #713 or on this plan.

## 6. Key findings

1. `#713` is the gate. Doing this plan on a branch cut before #713 lands would conflict in `docs/audit-2026-10-21.md` and `ApisTab.tsx`. Hence Step 0.
2. The `sync-external` stub is intentionally loud (410 with an explanatory message) because a July 2026 decision moved licensor/property master data to shared-db (`core.licensor`, `core.property`); the test at `src/test/core-licensor-property-contract.test.ts:19-24` exists to stop anyone resurrecting a PopDAM-side writer. Deleting the function must keep that protection: the test flips from "stub exists and says 410" to "no `sync-external` function directory exists and no source references it".
3. Deleting an edge function's source does not undeploy it. The deployed `sync-external` will keep returning 410 until deleted with the Supabase CLI. Leaving it is harmless but is exactly the drift the audit complains about; §9 Step 4 deletes it.
4. The `classify-erp-categories` name is used for two different things: the admin-api route (dead) and the `OP_ACTIONS` value (also dead — the map has no readers). The worker op `erp-classify` is live and must not be touched.
5. `apps/bridge-agent/src/constants.ts` says it is "documented in docs/WORKER_LOGIC.md"; `grep -n constants.ts docs/WORKER_LOGIC.md` finds nothing, so no doc edit is needed for it.
6. Edge-function unit tests run under root `vitest` (`vitest.config.ts` project `edge-functions`, include `supabase/functions/**/*.{test,spec}.ts`); there is no Deno test step. `deno fmt --check` runs in `.github/workflows/edge-functions-format.yml` and is advisory (`|| true`).

## 7. Approaches considered and rejected

- **Delete everything in one branch now, before #713 merges.** Rejected: guaranteed merge conflicts in `docs/audit-2026-10-21.md` and `ApisTab.tsx`; #713 is green and only needs merging.
- **Keep `sync-external` deployed as a tombstone forever.** Rejected: the issue scope says it goes with the UI removal, and a deployed function with no source is undiscoverable drift. The contract test keeps the "never resurrect" guarantee without the stub.
- **Replace `handleLogs` with a real `helper_logs` table.** Rejected: that is a feature needing a shared-db table and an owner; nobody asked for it. The helper never calls `sendLog` anyway.
- **Delete `OP_ACTIONS` entirely.** Open (not rejected): it has no readers. The plan removes only the dead entry (Step 5) and leaves a note; removing the whole map is a one-line follow-up the implementer may do in the same PR if `npm run typecheck` and `npm test` stay green (decision OPEN in §8).
- **Bump bridge agent version for `constants.ts` deletion.** Rejected: unused file, no runtime change; the NAS applies updates only on request (`AGENTS.md` line 438) and #681 already owns the next bridge update.

## 8. Design decisions

- **LOCKED (2026-11-04):** one PR, no behaviour change, no schema change. Branch from post-#713 `main`.
- **LOCKED (2026-11-04):** `sync-external` is removed from source, `supabase/config.toml`, and the deployed project; the contract test is rewritten to assert absence (§10).
- **LOCKED:** the worker op `erp-classify` and its UI start button stay untouched.
- **LOCKED:** `apps/popdam-helper/src/shared/constants.ts` is not the dead file and is not touched.
- **OPEN:** whether to delete the whole `OP_ACTIONS` map in `operation-constants.ts:203-220` or just the `erp-classify` row. Criterion: if `grep -rn OP_ACTIONS src supabase apps` still shows only the definition, delete the map; otherwise delete the row.
- **OPEN:** whether to keep the header comment line `supabase/functions/helper-api/index.ts:16` as a "removed 2026-11" note or drop it. Prefer dropping; the git history is the record.

## 9. The plan

### Step 0 — Land PR #713
- `gh pr view 713 --json state,mergedAt,mergeable,statusCheckRollup`. If OPEN and green: merge it (`gh pr merge 713 --squash --delete-branch`), then `git fetch origin main`.
- Gate: `git show origin/main --stat | grep -c "use-mobile\|LandingPage\|ScanMonitorBanner\|erp-mapper\|mg-codes"` is non-zero on the merge commit, and `test ! -f src/hooks/use-mobile.tsx` after checkout of `origin/main`.
- If #713 has a conflict or red check that is not a lean required check, fix it on its branch first; do not fold its content into this plan's PR.

### Step 1 — Worktree and branch
- `git worktree add ../popdam-471 -b claude/471-dead-code origin/main` (own worktree; canonical checkout is landing-only).
- Gate: `git log -1 --oneline` shows the #713 merge commit or later.

### Step 2 — Delete `supabase/functions/_shared/types.ts`
- `git rm supabase/functions/_shared/types.ts`.
- Gate: `npm run typecheck` green; `grep -rn "_shared/types" supabase src apps` empty; `npm test` green (edge-functions project included).

### Step 3 — Delete `apps/bridge-agent/src/constants.ts`
- `git rm apps/bridge-agent/src/constants.ts`.
- Gate: `npm ci --prefix apps/bridge-agent && npm run build --prefix apps/bridge-agent && npm test --prefix apps/bridge-agent` green (build runs `tsc`; an unused file cannot break it, the build proves nothing imported it).

### Step 4 — Retire `sync-external`
4a. `git rm -r supabase/functions/sync-external`.
4b. Remove the `[functions.sync-external]` block at `supabase/config.toml:15` (check the lines under it; remove the whole block, typically `verify_jwt = …`).
4c. Rewrite `src/test/core-licensor-property-contract.test.ts:19-24` — see §10 for the exact test.
4d. Delete the deployed function: `supabase functions delete sync-external --project-ref qsllyeztdwjgirsysgai`, with the access token loaded from 1Password (`vibe_coding` vault, the item `scripts/verify-supabase-deploy-target.sh` / `deploy-supabase.yml` use as `SUPABASE_ACCESS_TOKEN`; load the `secrets-to-1password` skill and `op run`, never paste the value). Run `bash scripts/verify-supabase-deploy-target.sh configured` first so the project ref is the Virginia project, not the retired Ohio one (memory: `project_supabase_virginia_cutover`). Class: `deployment` — declare it with `ai-task-gates` before running.
- Gate: `curl -s -o /dev/null -w '%{http_code}' -X POST https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/sync-external` returns `404` (not `410`); `grep -rn "sync-external" src supabase apps .github` returns only the rewritten test.

### Step 5 — Retire `classify-erp-categories`
5a. `supabase/functions/admin-api/index.ts:72`: drop `handleClassifyErpCategories` from the import. `:2229-2230`: delete the `case`.
5b. `supabase/functions/_shared/admin-handlers/erp-handlers.ts:169-176`: delete the route comment and `handleClassifyErpCategories`.
5c. `supabase/functions/_shared/operation-constants.ts:215`: delete the `"erp-classify": "classify-erp-categories"` row (or the whole `OP_ACTIONS` map per §8 OPEN decision).
5d. Add the admin-api test in §10 (unknown action returns 400 "Unknown action" or whatever the existing default branch returns — read the `default:` case near `admin-api/index.ts:2240+` first and assert that exact behaviour).
- Gate: `npm run typecheck && npm test` green; `grep -rn "classify-erp-categories" src supabase apps` empty; ERP enrichment UI still shows the Classify start button (`EnrichmentControls.tsx:17` untouched).

### Step 6 — Retire helper-api `/logs`
6a. `supabase/functions/helper-api/index.ts`: delete `handleLogs` (`:684-691`), the route line `:738`, and the header line `:16`.
6b. `apps/popdam-helper/src/main/damClient.ts:223-225`: delete `sendLog`.
- Gate: `npm run typecheck` (root) green; helper compiles: `npm ci --prefix apps/popdam-helper && npm run typecheck --prefix apps/popdam-helper` (check its `package.json` for the exact script name; if only `build` exists, run `build`). `grep -rn "sendLog\|\"/logs\"" apps/popdam-helper/src supabase/functions/helper-api` empty.

### Step 7 — Docs
- `docs/audit-2026-10-21.md` "Still open" paragraph (post-#713 wording): remove `sync-external`, `_shared/types.ts`, `bridge constants.ts`, `helper-api /logs` from the still-open list and add one line "Dead-code retirement finished in PR #<this PR> (2026-11-xx)".
- `docs/ADMIN_OPERATIONS.md:346` section `### classify-erp-categories`: delete it, or replace with one sentence pointing at the `erp-classify` worker op.
- `docs/INFRASTRUCTURE.md:205`: change "apply-erp-enrichment, classify-erp-categories" to "apply-erp-enrichment".
- `docs/architecture.md:90` and `docs/ERP_ENRICHMENT_PLAN.md:114`: describe the real trigger (`usePersistentOperation("erp-classify")` → `BULK_OPERATIONS` → worker `operation-loop.ts` `erp-classify`).
- `docs/POPDAM_HELPER.md`: grep for `sendLog` / `/logs`; remove if mentioned.
- Gate: `grep -rn "classify-erp-categories\|sync-external\|helper-api.*logs\|_shared/types.ts\|bridge-agent/src/constants.ts" docs AGENTS.md` returns only the audit doc history line.

### Step 8 — PR, CI, merge
- Commit as Albert's verified identity (check `git var GIT_COMMITTER_IDENT`; worktrees do not inherit — memory `project_git_commit_identity`). Stage only the files above.
- Push, `gh pr create --base main` with body "Closes #471 dead-code items; refs #468", signed with `$AI_GH_SIGNATURE`, ending with the attribution line in force.
- `bin/ai-pr-wait <pr>` in the background; rerun on exit 2. Reviews are advisory; do not wait on them.
- Merge (squash). Gate: `gh pr view <pr> --json mergedAt` non-null; `.github/workflows/deploy-supabase.yml` run for the merge commit succeeded (it deploys `admin-api` and `helper-api` changes); `publish-frontend.yml` run succeeded and Coolify app `qxj8a0j3tpa9lq4q5rs6pezy` reports the merge SHA.

### Step 9 — Live proof and close
- Proof list to post on #471 (same issue, never a new one):
  - `curl` of `sync-external` → 404 (Step 4 gate output).
  - `curl -s -X POST https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/admin-api -H 'Authorization: Bearer <admin JWT from a test login>' -d '{"action":"classify-erp-categories"}'` → the "unknown action" response, not the old 400 text. Use the PopDAM admin tester login from 1Password (`vibe_coding`, item named in `docs/1password.md`; memory `project_popsg_tester_login`).
  - Settings → ERP Enrichment on https://dam.designflow.app still starts a classify run (screenshot of the running op).
  - helper-api: `curl -s -X POST …/functions/v1/helper-api/logs -H 'Authorization: Bearer <same JWT>'` → 404.
- Tick the `- [ ] live proof` item on #471 with those outputs and close the issue, signed.

## 10. Tests required

- Rewrite `src/test/core-licensor-property-contract.test.ts` test "retires the legacy PopDAM taxonomy writer loudly" → rename to **"has no PopDAM-side taxonomy writer"**: assert `existsSync("supabase/functions/sync-external")` is false, assert `supabase/config.toml` does not contain `sync-external`, and keep the existing assertions on `ai-tagging-shared.ts` (lines 26-30) unchanged. The point of the test — nobody re-adds a PopDAM writer for `core.licensor`/`core.property` — must stay in the test's name and a comment.
- New edge-function test `supabase/functions/admin-api/retired-actions.test.ts` (vitest, node env): **"classify-erp-categories is not a routable action"** — read `admin-api/index.ts` as text and assert it contains neither `"classify-erp-categories"` nor `handleClassifyErpCategories`; and **"erp-classify stays a worker operation"** — assert `apps/worker/src/operation-loop.ts` contains `case "erp-classify"`. (Text-contract tests are the repo's existing pattern for edge functions; see `core-licensor-property-contract.test.ts`.)
- New test in the same file: **"helper-api has no /logs route"** — assert `helper-api/index.ts` does not contain `"/logs"`.
- Existing suites that must stay green: root `npm run lint && npm run typecheck && npm test`; `apps/worker` build+test; `apps/windows-agent` test; `apps/bridge-agent` build+test; root `npm run build`.

No trust-boundary input is added or changed by this plan (only removals), so no adversarial-cases table applies — N/A.

## 11. Constraints, standing rules, gotchas

- Feature branch + PR to `main`; never push to `main`. The AI merges; Albert does not.
- No `shared-db` change. None needed. If a step seems to need one, the item is not dead — stop.
- Production is read-only by default; Step 4d (deleting a deployed edge function) is a `deployment`-class action: declare with `ai-task-gates`, use the Virginia project only, prove with the 404 curl.
- Secrets only via 1Password `vibe_coding` and `op run`; never in chat, commit, or logs.
- Do not touch `apps/popdam-helper/src/shared/constants.ts` or anything under `src/common/` in the agents (generated by `packages/agent-common/sync.mjs`, gitignored).
- Worktrees do not inherit the commit identity; verify before the first commit.
- `deno fmt --check` is advisory but run `deno fmt supabase/functions` locally if Deno is installed so the check stays quiet.
- Sign every GitHub post with `$AI_GH_SIGNATURE`.
- Wait on CI with `bin/ai-pr-wait` in the background; no sleep loops.
- Times to humans in EST (`TZ=America/New_York date`).

## 12. Access and environment

- Machine: `hetz`. Repo at `/worksp/popdam` (canonical, landing-only) — create your own worktree.
- `gh` is authenticated as `u2giants`. Supabase MCP (`mcp__supabase__execute_sql`) is read-only-capable against project `qsllyeztdwjgirsysgai`; the Supabase CLI needs `SUPABASE_ACCESS_TOKEN` from 1Password.
- Test logins: `docs/1password.md`; PopDAM admin tester item in vault `vibe_coding` (title only; never the value).
- Local run: `npm ci && npm run dev` (frontend), `npm run build --prefix apps/worker`, agents per their `package.json`.
- CI: `.github/workflows/ci.yml` ("CI"): root lint/typecheck/test, worker build/test, windows-agent test, root build.
- Deploys after merge: Railway worker auto; frontend via `publish-frontend.yml` → GHCR → Coolify `qxj8a0j3tpa9lq4q5rs6pezy`; edge functions via `deploy-supabase.yml`; helper via `publish-popdam-helper.yml` (release, unsigned, only on a version bump — none needed here).

## 13. Definition of done, risks, open questions

Done when:
- [ ] #713 merged; five dead files absent on `main`.
- [ ] `types.ts`, bridge `constants.ts`, `sync-external` (source + config + deployed), `classify-erp-categories` route + `OP_ACTIONS` row, helper-api `/logs` + `sendLog` all absent on `main`.
- [ ] Tests in §10 added and green; CI green on the PR; PR merged.
- [ ] `deploy-supabase.yml` and `publish-frontend.yml` runs for the merge SHA succeeded; Coolify shows that SHA.
- [ ] Live proof outputs posted on #471; `- [ ] live proof` ticked; issue closed with signature.
- [ ] `docs/audit-2026-10-21.md` and the four ERP/infra docs updated in the same PR; this plan's STATUS table updated by whoever executes it.

Risks:
- A hidden caller of `sync-external` outside this repo (e.g. a DesignFlow job). Mitigation: the function has returned 410 since 2026-07-23 with no reported complaint; after deletion a caller gets 404 instead — same practical outcome. Rollback: `git revert` the PR and redeploy the function from the restored source.
- Deleting the deployed function against the wrong project. Mitigation: `scripts/verify-supabase-deploy-target.sh configured` before the CLI call.
- helper build breaks if `sendLog` is referenced from a file grep missed (e.g. a renderer bundle). Mitigation: helper typecheck/build in Step 6 gate.

Open questions: none that are business-meaning. The two OPEN engineering decisions are in §8 with their criteria.

## Self-audit

1. **Could a brand-new session execute this without asking anything?** Yes. §5 gives every file:line, §9 gives the exact commands and gates per step, §10 names each test by behaviour, §12 says where credentials live and how CI/deploys run, and Step 0 tells it how to decide where to start.
2. **Does it carry every piece of background and what was ruled out?** Yes. §3 and §6 explain the #713 dependency and the "loud 410" history; §7 lists the five rejected alternatives with reasons; §8 separates locked from open decisions with criteria.
3. **Is the goal clear enough to steer by if a step is wrong?** Yes. §1 states the goal (gone or re-verified live, no user-visible change) and the concrete rule for a conflict: never force a deletion that has a real caller; record it on the issue instead.

Execution: source retirement prepared for legacy taxonomy writer, canned classification route, no-op Helper logs and their unused client. Active worker classification remains. Live deployed-function retirement and admin unknown-action proof remain open on #471. No bridge runtime/version change.
