# Plan: Check library filters for non-admin users (u2giants/popdam3#709)
Issue: https://github.com/u2giants/popdam3/issues/709
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

## STATUS — read this first

| Step | State | Evidence / notes |
|---|---|---|
| 1. Reproduce live with a non-admin login (viewer tester) | ⬜ open | — |
| 2. Move the action→auth-level map into the pure policy module | ⬜ open | — |
| 3. Add `get-filter-options` to the user-accessible set | ⬜ open | — |
| 4. Unit tests for the policy map | ⬜ open | — |
| 5. Frontend: surface a failed filter-options load instead of silent empty lists | ⬜ open | — |
| 6. PR → CI → merge → edge deploy → frontend deploy | ⬜ open | — |
| 7. Live proof as non-admin + admin, note on #709, close | ⬜ open | — |

Where a fresh session starts: Step 1. Nothing has been implemented; the issue was found by code reading only (its own words: "not verified live").

## 1. Ultimate goal

Every signed-in PopDAM user, not only administrators, sees the Licensor and
Property filter lists on the Library page populated with the licensors and
properties that actually have artwork. Today the code reading says a
non-administrator is refused that list by the backend, so the filter boxes may
be empty for most of the team (the people who browse the most). When this is
done, an ordinary user and an administrator see the same filter choices.

If a step conflicts with this goal, the goal wins — stop and flag it on #709.

## 2. What this application is

PopDAM (repo u2giants/popdam3, branch `main`, React + Vite frontend, Supabase
edge functions in Deno, shared Supabase project `qsllyeztdwjgirsysgai`) is the
internal digital-asset manager for licensed artwork. The Library page
(`src/pages/Index.tsx`, route `/library`, live at https://dam.designflow.app)
is the main browsing screen; its left filter sidebar
(`src/components/library/FilterSidebar.tsx`) offers Licensor and Property
dropdowns. PopSG (sg.designflow.app) is the same image in style-guide mode and
renders a different library page (`PopSGLibraryPage`), so this issue is
PopDAM-only (`src/App.tsx:70`).

Frontend deploys: PR merged to `main` → `.github/workflows/publish-frontend.yml`
→ GHCR → Coolify app `qxj8a0j3tpa9lq4q5rs6pezy`. Edge functions deploy via
`.github/workflows/deploy-supabase.yml` whenever `supabase/functions/**`
changes on `main` (it redeploys every function directory, lines 63-85).

## 3. What triggered this work

Issue #709 (opened 2026-11-04 by an AI issue review): `get-filter-options` is
not in `USER_ACCESSIBLE_ACTIONS`, so the admin-api treats it as admin-only, yet
the Library page requests it for everyone. A supporting live observation
already exists: the 2026-10-28 PopSG drill (issue #107, comment 6461895625)
logged, as a fresh `user`-role tester, "only expected known-quirk 403s on
admin-api probes for a user-role account" — i.e. admin-api 403s for
non-admins are real in production.

Reproduce: sign in as a non-admin (viewer tester, §12), open `/library`, open
the Licensor dropdown. Expected bug: no options; network tab shows
`POST /functions/v1/admin-api` with `{"action":"get-filter-options"}`
returning 403 `{"ok":false,"error":"Forbidden: admin role required"}`.

## 4. Scope

**In:** letting any authenticated user call `get-filter-options`; a unit-tested
home for the "which actions need which auth level" map; making the frontend
show a failure rather than silently empty lists; live proof.

**NOT in this plan:**
- Rewriting `handleGetFilterOptions` (N+1 count loop at
  `supabase/functions/_shared/admin-handlers/agent-handlers.ts:1366-1393`) —
  slow but correct; separate issue if it becomes a problem.
- Any other admin-api action's auth level (`list-users`, `get-config`, etc.).
- The `app`-schema role axis (users without an `app.user_role` see empty
  `core.*` data — that is #566 / the DesignFlow cutover, not this).
- PopSG library page.
- DB schema changes (none needed; and none are ever made in this repo).

## 5. Current state of the code (verified on main 01fcfc34, 2026-11-04)

- Auth-level dispatch (lines as of `e037dd7a`: 2059-2063, action case 2136): `supabase/functions/admin-api/index.ts:2046-2050`
  picks `authenticateDesignerOrAdmin` if the action is in
  `DESIGNER_OR_ADMIN_ACTIONS` (line 188), else `authenticateUser` if in
  `USER_ACCESSIBLE_ACTIONS` (lines 173-180: `sync-group-tags`,
  `refresh-group-metadata`, `add-scoped-tag`, `remove-scoped-tag`,
  `review-scoped-tag`, `fetch-thumbnail-by-url`), else `authenticateAdmin`.
  `get-filter-options` is in neither set → admin-only.
- Handler: `handleGetFilterOptions` at
  `supabase/functions/_shared/admin-handlers/agent-handlers.ts:1354-1400`,
  imported at `admin-api/index.ts:38`, dispatched at `index.ts:2123-2124`.
  Uses `serviceClient()` (bypasses RLS) and returns only licensor/property
  `id`, `name`, `licensor_id`, `asset_count` for rows with assets.
- Frontend hook: `useFilterOptions` at `src/hooks/useAssets.ts:602-615`
  calls `call("get-filter-options", …)` via `useAdminApi`
  (`src/hooks/useAdminApi.ts`), which throws on non-2xx. The hook ignores the
  error and returns `licensors: []`, `properties: []` — a 403 is
  indistinguishable from "no data".
- Consumer: `src/pages/Index.tsx:83` → props into `FilterSidebar.tsx:16,478,541`.
- Admin check itself: `supabase/functions/_shared/admin-auth.ts` (`requireAdmin`,
  reads `public.user_roles` for role `admin`); pure helpers in
  `_shared/auth-policy.ts` (import-free, tested by `src/test/auth-policy.test.ts`).
- Existing Index test mocks `useFilterOptions` as empty:
  `src/test/library-group-count.test.tsx:19-23`.
- Nothing is committed, branched or deployed for this issue.

## 6. Key findings

- The bug is almost certainly real: nothing between `Index.tsx` and the edge
  function special-cases non-admins; `authenticateAdmin` → `requireAdmin`
  returns 403 `not_admin` for a `user`-role JWT (admin-auth.ts:168-172,
  index.ts:166-168).
- It is masked by the hook swallowing errors (`useAssets.ts:611-613`), which is
  why nobody reported empty dropdowns as an error — they just look empty.
- Data exposure is not a concern: the handler returns licensor/property names
  and counts, which every user already sees on asset cards and in search facets
  (`useFilterCounts`, `usePathFacets` are plain RPCs with the user's JWT).
- The "user-accessible" set is a plain `Set` literal inside a 2,393-line Deno
  file with no Deno toolchain locally (`admin-auth.ts` header comment: "There
  is no local Deno toolchain, so this file's type gate is the deploy
  workflow"). A test can only cover it if the map moves to the import-free
  `auth-policy.ts`, which vitest already loads.

## 7. Approaches considered and rejected

- **Call `core.licensor` / `core.property` directly from the browser with the
  user's JWT** (skip admin-api). Rejected: `core.*` is RLS-gated on the
  `app`-schema role axis; the ~11+ users with no `app.user_role` (memory:
  permission layers; #566) would get empty lists again by a different route.
- **Check `app.has_app_access('dam')` for this action** (like
  `authenticateDesignerOrAdmin`). Rejected for now: adds a per-call RPC for a
  harmless list, and the same role-less users would be refused. Can be
  revisited if a `vendor`-type external role ever gets a login.
- **Return `[]` from the handler on 403 instead of fixing auth.** Rejected:
  symptom suppression.
- **Make `useFilterOptions` retry**. Rejected: 403 is not transient.

## 8. Design decisions

- **LOCKED:** `get-filter-options` becomes available to every authenticated
  caller (same tier as `fetch-thumbnail-by-url`). Admin-only data is not
  involved.
- **LOCKED:** the action→auth-level map moves into `_shared/auth-policy.ts` as
  pure data + one pure function so it is unit-tested; `index.ts` consumes it.
  Keep the three tiers exactly as today (no action changes tier except
  `get-filter-options`).
- **OPEN (implementer's call):** how the frontend shows a failed load — a small
  inline "Couldn't load filter options" line in the sidebar vs. a `toast`.
  Criterion: must not block browsing; a one-line inline note near the Licensor
  box is preferred because toasts vanish.

## 9. The plan

### Step 1 — Reproduce live (non-admin)
Use the viewer tester (§12) via the password-grant + session-injection recipe
(memory `project_popsg_tester_login`; Playwright MCP). Load
`https://dam.designflow.app/library`, open the Licensor combobox, capture
the `admin-api` response for `get-filter-options`. Also run the same with the
administrator tester to record the expected populated list (count of
licensors returned).
Gate: you'll know it reproduced when the non-admin call returns HTTP 403
`Forbidden: admin role required` and the dropdown is empty while the admin
call returns ≥1 licensor. If the non-admin call returns 200 with data, stop:
post the evidence on #709, close it as not-a-bug, and skip the rest.
Save raw evidence under `$TMPDIR/issue-709/` (never commit).

### Step 2 — Extract the policy map (pure module)
In `supabase/functions/_shared/auth-policy.ts` (keep it import-free!) add:
```ts
export type AdminApiAuthLevel = "admin" | "user" | "designer_or_admin";
export const USER_ACCESSIBLE_ACTIONS: ReadonlySet<string> = new Set([...the six today..., "get-filter-options"]);
export const DESIGNER_OR_ADMIN_ACTIONS: ReadonlySet<string> = new Set([...the four today...]);
export function adminApiAuthLevel(action: string): AdminApiAuthLevel
```
Precedence must match `index.ts:2046-2050`: designer-or-admin first, then
user, else admin. Then in `admin-api/index.ts` delete the two local `Set`
literals (lines 173-180 and 188-193), import the two sets + function from
`../_shared/auth-policy.ts` (extend the existing import at line 2 / add one),
and rewrite the dispatch at 2046-2050 to `switch (adminApiAuthLevel(action))`.
Keep the owner-ruling comment block (lines 182-186) next to the import.
Gate: `npm run typecheck && npm run lint` green; `grep -n "new Set(\[" supabase/functions/admin-api/index.ts` no longer shows the two auth sets.

### Step 3 — Add the action
Covered by Step 2's set literal. Gate: `adminApiAuthLevel("get-filter-options") === "user"` in the test from Step 4.

### Step 4 — Tests
Extend `src/test/auth-policy.test.ts` with a `describe("adminApiAuthLevel")`:
- "get-filter-options is open to any authenticated user"
- "the six pre-existing user actions keep their tier" (loop over the list)
- "sibling-image actions require designer or admin" (the four)
- "an unknown action defaults to admin" (`"list-users"`, `"set-config"`, `""`)
- "designer tier wins over user tier if an action were in both" (construct via the function on an action present in both sets is impossible with constants — instead assert the two sets are disjoint).
Gate: `npm run test -- auth-policy` passes.

### Step 5 — Frontend: stop hiding the failure
`src/hooks/useAssets.ts:602-615`: also return `error` (and `isError`) from
`useQuery`; set `retry: false` (403 never heals). In `src/pages/Index.tsx:83`
pass `filterOptionsError` down; in `FilterSidebar.tsx` (near the licensor
combobox, ~line 881) render a muted one-liner "Couldn't load licensor and
property filters" when the error is set and both lists are empty. Admins and
users see the same message if the backend fails.
Add `src/test/filter-options-error.test.tsx` (pattern:
`library-group-count.test.tsx` mocks; render `FilterSidebar` directly with
`licensors: []`, `properties: []`, `filterOptionsError: new Error("[403] Forbidden")`)
— "shows a filter-load failure instead of silently empty lists" and "shows no
failure line when lists loaded". Update `library-group-count.test.tsx:20` mock
only if the hook's return shape change breaks it (it spreads whatever is
returned; adding fields is safe).
Gate: both new tests pass; `npm run test` green.

### Step 6 — Land it
Branch `fix/709-filter-options-user-access` from `main` in a fresh worktree;
commit as Albert's verified identity (`git var GIT_COMMITTER_IDENT`); PR to
`main` referencing `#709`; `bin/ai-pr-wait <pr>` in the background; merge
when CI is green (AI merges). Then confirm `deploy-supabase.yml` ran for the
merge commit (`gh run list --workflow deploy-supabase.yml -L 3`) and
`publish-frontend.yml` → Coolify picked up the new image (the app header
build stamp shows the merge SHA; `src/test/app-header-build-stamp.test.ts`
documents the stamp).
Gate: both workflows green for the merge SHA; live `admin-api` responds 200 to
the viewer tester for `get-filter-options`.

### Step 7 — Live proof and close
Repeat Step 1 with the viewer tester: dropdown lists the same licensor count
as the admin. Screenshot the open Licensor dropdown (no settings pages).
Post on #709: before/after status codes, licensor count parity, merge SHA,
deploy run ids, signed with `$AI_GH_SIGNATURE`; tick both checklist boxes;
close the issue. Update this plan's STATUS rows with artifacts.
Gate: issue closed with evidence; STATUS cites PR, SHA, run ids.

Adversarial cases (trust boundary: the action string comes from the request
body, `index.ts:2042`):

| Input | Hostile case | Test |
|---|---|---|
| `action` | unknown / empty string | "an unknown action defaults to admin" |
| `action` | case variant `Get-Filter-Options` | add row: "action names are case-sensitive (variant stays admin)" |
| `action` in both tiers | privilege confusion | "user and designer action sets are disjoint" |
| bearer token | service-role key | unchanged path (`authenticateUser` → `system`); no new test, covered by existing `isServiceRoleToken` tests |
| `licensor_id` body field | non-string | handler already coerces to null (agent-handlers.ts:1356); no change |

## 10. Tests required

- New: the `adminApiAuthLevel` describe block in `src/test/auth-policy.test.ts`
  (5-6 cases above) and `src/test/filter-options-error.test.tsx` (2 cases).
- Stay green: `npm run lint`, `npm run typecheck`, `npm run test` (root
  vitest: `src/**` jsdom project + `supabase/functions/**` node project),
  `npm run build`; worker and windows-agent suites are untouched but run in
  CI.

## 11. Constraints and gotchas

- Feature branch + PR to `main`; never push to `main`. AI merges.
- No DB change anywhere in this repo; none is needed here.
- `auth-policy.ts` must stay import-free or vitest stops loading it
  (header comment, lines 5-9). Put the sets there, not in `admin-auth.ts`.
- There is no local Deno; the edge function's only type gate is the deploy
  workflow, so run the deploy and read the run log, don't assume.
- `deploy-supabase.yml` redeploys ALL functions when any file under
  `supabase/functions/` changes; that is expected.
- `admin-api` is deployed with `--no-verify-jwt`; auth is entirely the code
  you are changing (KNOWN_QUIRKS §4). Do not weaken any other tier.
- Non-admin UI checks: use the viewer tester, never a real employee; never
  screenshot Settings pages (NAS password renders there).
- Time quotes in EST; sign GitHub posts with `$AI_GH_SIGNATURE`.
- Reviews are advisory; never wait on one. Required checks are lean.

## 12. Access and environment

- Repo worktree per task under `/worksp/popdam/.claude/worktrees/`; this plan
  was written from `claude/github-issues-implementation-plans-09bb39`.
- `gh` is authenticated for u2giants; Supabase MCP targets project
  `qsllyeztdwjgirsysgai` (Virginia; the default MCP may point at old Ohio —
  memory `project_supabase_virginia_cutover`).
- Test logins (1Password vault `vibe_coding`): viewer item
  `mbspkosvp2rf25qxhqufipxqca`, administrator item
  `7s5uzpbjenka4fpvrqogh44bre` (fields `username`, `password`,
  `auth_user_id`, `login_url`); anon key for the password grant in item
  `3hhxwrljnaq2tykxi7hplq5ryi` field `SUPABASE_PUBLISHABLE_KEY`. Incident log
  (2026-10-27) says tester passwords were stale at that time; the 2026-10-28
  #566 proof used the administrator tester, so probe first — if
  `invalid_credentials`, reset the tester password yourself through the
  Supabase auth admin API with the service key from item "Supabase Runtime
  Keys - shared POP database (production)" and update the 1Password item
  (load `secrets-to-1password`). Never ask Albert for a credential.
- Local run: `npm ci && npm run dev` (Vite); edge functions cannot run locally
  (no Deno) — verify on production after deploy.

## 13. Definition of done, risks, open questions

Done when: Step 1 evidence recorded; code + tests merged to `main`; CI,
`deploy-supabase.yml` and `publish-frontend.yml` green for the merge SHA;
viewer tester sees populated Licensor/Property lists live with the same
count as the admin; #709 closed with signed evidence and both boxes ticked;
this plan's STATUS updated; handoff row updated.

Risks: moving the sets could accidentally drop an action from a tier (the
"six pre-existing" and "four sibling" tests pin them); a broken edge deploy
leaves all functions on the previous version (deploy workflow fails loudly —
rerun after fix). Rollback: revert the PR; functions redeploy automatically.

Open: none business-meaning. Technical open item (§8) is the frontend error
presentation.

## Self-audit

1. Could a fresh session execute this without asking? Yes — §5 gives exact
   file:line for every touch point, §9 gives per-step edits and gates, §12
   gives logins by vault item id and the stale-password recovery path, and
   Step 1 includes the "not a bug" exit.
2. Is all background carried? Yes — §3 cites the live 403 observation from
   the #107 drill, §6 explains why the bug was masked, §7 records the three
   rejected routes (direct `core.*` reads, app-access check, retries).
3. Is the goal clear enough to steer by? Yes — §1 states the user-visible
   outcome (non-admins see the same filter lists as admins) and the
   goal-wins rule; the §8 LOCKED decisions keep the fix minimal.
