---
summary: Issue #566 plan: Admin UI: pick app roles (viewer/designer/licensing/sales) per user. Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-566
---

# Plan: Admin UI: pick app roles (viewer/designer/licensing/sales) per user (u2giants/popdam3#566)
Issue: https://github.com/u2giants/popdam3/issues/566
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

Parent plan (do not duplicate its STATUS): [plan_user_permissions_designflow_cutover.md](../../plan_user_permissions_designflow_cutover.md) — DesignFlow PLM becomes the single source of truth for users/roles; this picker becomes a frontend to it in its Phase 3 step 7. That plan's Phases 1-2 (DesignFlow API + UI) are ⬜ open with no update since 2026-10-28; nothing here starts them.

## STATUS — read this first

| Step | State | Evidence / notes |
|---|---|---|
| 0. Picker shipped to production (both Users cards) | ✅ done 2026-10-28 (prior sessions) | PRs #568 (3213c444), #569 (50d83682); RPC-level proof in issue comment of 2026-10-28; this plan does not re-do it |
| 1. Confirm the live build still carries the picker | ⬜ open | — |
| 2. Component test for the picker (none exists) | ⬜ open | — |
| 3. UI-level live proof with the administrator tester (render + change + revert on a test account) | ⬜ open | — |
| 4. Post the 11 role-less staff for Albert's one-message decision | ⬜ open | — |
| 5. Apply Albert's answers through the picker; record on the issue | ⬜ open | — |
| 6. Close #566 with evidence; leave the DesignFlow retarget to the parent plan | ⬜ open | — |

Where a fresh session starts: Step 1. The code is live; only proof, a test, and the staff-role decision remain.

## 1. Ultimate goal

An administrator can set any staff member's app role (Viewer, Designer,
Licensing, Sales, Administrator, or none) from the PopDAM Settings screen, and
the change takes effect immediately in every POP app that reads that role.
Albert's words (2026-10-27): "i want to be able to pick roles on a
user-by-user basis in the ui." The business reason: staff without an app role
see empty Styles/Master Data/customer screens (see §6), and today 11 signed-in
employees are in that state.

Longer term (owner ruling 2026-10-28, locked in the parent plan) this picker
is a frontend to DesignFlow; nothing in this plan may build a second write
path or pre-empt that.

If a step conflicts with this goal, the goal wins — stop and flag it on #566.

## 2. What this application is

PopDAM / PopSG — repo u2giants/popdam3, branch `main`, React + Vite, one
Docker image serving dam.designflow.app (PopDAM) and sg.designflow.app
(PopSG); Coolify app `qxj8a0j3tpa9lq4q5rs6pezy` on VPS `hetz`. Shared
Supabase project `qsllyeztdwjgirsysgai` (Virginia) holds users and roles in
the `app` schema (`app.profile`, `app.user_role`), written only through
administrator-gated RPCs that live in popcre/shared-db
(`api.crm_admin_user_directory`, `api.crm_admin_set_user_roles`, migration
20261026155023).

## 3. What triggered this work

Issue #545 (revoked personal logins blocking search; PopPIM access missing)
exposed that many employees had no app role; Albert asked for a per-user
picker instead of a blanket tier. The picker was built and deployed on
2026-10-28 (PR #568 put it in the component PopSG renders; PR #569 mirrored it
into the component PopDAM renders). On 2026-11-04 an issue review found: no
role change recorded since the 2026-10-28 proof; 11 SSO staff still have no
role (including 8 from #545); the human-glance live-proof box is still open.

## 4. Scope

**In:** verifying the shipped picker (live build, UI-level proof with a test
account), one component test, getting the 11 role-less staff assigned through
the picker once Albert names their roles, closing #566.

**NOT in this plan:**
- Retargeting the picker to DesignFlow (parent plan Phase 3 step 7; its
  Phases 1-2 are prerequisites and are not started).
- Extracting the two duplicate Users components into one (parent plan §6
  recommends it at retarget time; doing it now is churn on code that will move).
- Any shared-db change (none needed; the RPCs exist).
- The legacy `public.user_roles` admin flag or `public.app_access` toggles
  (already in the same card; untouched).
- Invitations (#565 has its own plan).
- Choosing roles for real staff without Albert (business-meaning).

## 5. Current state of the code (verified on main 01fcfc34, 2026-11-04)

- PopDAM card: `src/pages/settings/UsersAndInvitations.tsx` — `ROLE_OPTIONS`
  16-22; directory query `crm_admin_user_directory` 61-76 (hidden when the
  RPC is refused: `retry: false`, picker only renders when `staffRoles` has
  a matching email, 162); `handleSetRole` → `crm_admin_set_user_roles`
  (`p_profile_id`, `p_roles: role ? [role] : []`) 80-101; `<select>` with
  "No role" + five options + disabled "Multiple (…)" 162-185. Mounted at
  `src/pages/SettingsPage.tsx:101` (General tab, Active Users card).
- PopSG card: `src/components/settings/UsersTab.tsx` — same code (diff limited
  to an equivalent `onChange` expression at its line ~169). Mounted at
  `src/pages/popsg/PopSGSettingsPage.tsx:1331`.
- Gate in the UI: Settings is admin-only via `src/hooks/useIsAdmin.ts`
  (`public.user_roles.role = 'admin'`); the RPC additionally requires the
  caller's `app` role to be `administrator` (shared-db 20261026155023). A
  PopDAM admin who lacks the `administrator` app role sees the card without
  the dropdown (by design, comment at 58-60).
- Tests: none for either Users component (`ls src/test | grep -i user` is empty).
- Issue checklist: `- [x] RPC path live-verified`, `- [ ] live proof: first
  human glance … dropdown renders`.

## 6. Key findings

- Three permission axes across two schemas (docs/AUTHENTICATION.md:122-154;
  memory `project_popdam_permission_layers`): `public.user_roles`
  (admin|user), `public.app_access` (popdam|styleguides), and the `app`
  schema role that gates every `core.*`/`api.*`/`dam.*` object. The picker
  edits only the third. Provisioning one axis never provisions another.
- Role vocab: `administrator, sales, licensing, designer, viewer, vendor`
  (`app.app_role`); the picker offers the first five; `vendor` is deliberately
  absent (external parties).
- Picking a role replaces the current role (single-role set); "No role"
  clears it; the RPC refuses demoting the last administrator and refuses
  self-demotion (2026-10-28 proof on the issue).
- The 2026-10-28 handoff (`HANDOFF.d/2026-10-28T1820Z-edge-dev-mimo-user-admin-dflow-phase1.md` §0)
  states that assigning roles to the role-less staff "is delegated already:
  roles are picked per user in the Settings UI by any administrator… Not an
  owner question." That settles WHO does it (an administrator, not DesignFlow
  work) but not WHICH role each named employee gets — that is business
  meaning and goes to Albert in one message (§9 Step 4).
- The `app` schema is not reachable through PostgREST; read it via the
  Management API or psql (memory `project_secret_access_paths`), or through
  the `api.crm_admin_user_directory` RPC with an administrator session.

## 7. Approaches considered and rejected

- **Build a popdam-owned RPC or admin-api action to write `app.user_role`**
  (the issue's original wording). Rejected 2026-10-28: shared-db #4811 already
  provided the gated RPCs; claim #4949 / PR #4950 were closed as superseded.
- **Blanket-grant a tier to every role-less employee** (#545's question).
  Rejected by Albert: per-user picking.
- **Default the 11 role-less staff to `viewer` now, ask later.** Rejected:
  which role a named employee holds is a business decision; a wrong guess
  silently widens or narrows access to customer/Master Data screens.
- **Merge the two Users components now.** Rejected (see §4).
- **Treat the `- [ ] live proof` box as closable by the RPC proof.** Rejected:
  the box explicitly asks for the rendered dropdown; the AI can do that glance
  with a browser, so do it.

## 8. Design decisions

- **LOCKED (owner, 2026-10-27):** per-user role picking in the UI.
- **LOCKED (owner, 2026-10-28, parent plan §8):** DesignFlow is the eventual
  authority; this picker is a frontend-in-waiting; do not add write paths.
- **LOCKED:** writes go through `api.crm_admin_set_user_roles` with the
  admin's own session; no service-role shortcuts.
- **OPEN (business, Albert):** which role each of the 11 role-less employees
  receives. Recommendation to put to him: Designer for art staff, Viewer for
  everyone else, with the named list; he answers one word per name.
- **OPEN (implementer):** whether the component test renders the PopDAM card
  only or both; criterion: one shared test helper, two one-line `it`s is
  fine; do not refactor the components to make them testable.

## 9. The plan

### Step 1 — Confirm the live build carries the picker
`curl -s https://dam.designflow.app/` → fetch the SettingsPage chunk named in
the HTML/manifest and `grep -c "No role"`; repeat for
`https://sg.designflow.app/`. Compare the deployed build stamp with
`git log -1 --format=%H origin/main`.
Gate: both chunks contain "No role" and the five option labels; the deployed
SHA is ≥ 50d83682 on `main`'s history (`git merge-base --is-ancestor 50d83682 <deployed-sha>`).

### Step 2 — Component test (new file `src/test/users-role-picker.test.tsx`)
Mock `@/integrations/supabase/client` so `auth.getSession()` returns a session
and `.schema("api").rpc()` resolves a directory of two staff (one with
`roles: ["viewer"]`, one with `roles: []`) and records `crm_admin_set_user_roles`
calls; mock `@/hooks/useAdminApi` `call("list-users")` to return the same
two emails; mock `@/contexts/ImpersonationContext` and `react-router-dom`
`useNavigate` (pattern: `src/test/library-group-count.test.tsx` and
`search-access-notice.test.tsx`). Wrap in a real `QueryClientProvider`.
Tests, by behavior:
- "renders a role dropdown per staff user with the current role selected"
- "picking Designer calls crm_admin_set_user_roles with that single role"
- "choosing No role sends an empty role list"
- "hides the dropdown when the directory RPC is refused" (rpc returns `error`)
- "shows a disabled Multiple option for a user holding two roles"
Gate: `npm run test -- users-role-picker` passes; lint/typecheck green.
Land via branch `test/566-role-picker` → PR → `bin/ai-pr-wait` → merge (AI
merges). This is test-only; no deploy verification beyond CI.

### Step 3 — UI-level live proof (closes the open checklist box)
Use the administrator tester (§12) with the session-injection recipe and
Playwright. Open `https://dam.designflow.app/settings` (General tab → Active
Users). Locate the viewer tester's row (its email is in the viewer item's
`username`). Record: dropdown present with current value; change to
Designer; wait for the success toast; reload; dropdown shows Designer; change
back to Viewer; reload; shows Viewer. Confirm in the DB via
`api.crm_admin_user_directory` (same admin session) after each change.
**Takes effect live (the issue's wording; the 2026-10-28 proof read the directory only):** with the viewer tester's own session, call admin-api `get-sibling-scan-by-folder` at each stage. It is gated by `app.has_any_role(designer, administrator)` (`supabase/functions/admin-api/index.ts:211`): expect 403 as Viewer, non-403 as Designer, 403 again after reverting, without the tester re-signing in. If a stale token keeps the old result, that is a finding to report, not to retry around.
**Do not screenshot the PopSG Settings page** (NAS password renders in the
Setup tab); on PopDAM crop the screenshot to the Active Users card only, and
only rows for test accounts — no employee emails in the image.
Gate: three directory reads show viewer → designer → viewer for the test
account, and the viewer tester's own calls return 403 → non-403 → 403; cropped screenshot saved under `$TMPDIR/issue-566/`; post the
sequence (times in EST) on #566 signed with `$AI_GH_SIGNATURE`; tick the
`- [ ] live proof` box.

### Step 4 — Put the role-less staff list to Albert (one message)
Query the directory (admin session) for active profiles with `roles = []`;
expect 11. Post on #566 a comment listing them by name/email with the
recommendation from §8, and ask Albert one question: the role for each. Do
not assign anything yet. In the session reply, carry it as `You —` in Still
open.
Gate: comment posted; the list count matches the live query.

### Step 5 — Apply Albert's answers
For each name he answers, set the role through the picker (Step 3 recipe) —
the UI path, so the proof is of the real feature. Reload and verify via the
directory. Post the before/after table (names only, no ids) on #566.
Gate: directory shows 0 role-less active staff among the names answered;
any name he skips stays listed as `You —`.

### Step 6 — Close
Close #566 with: PR #568/#569 SHAs, test PR SHA, live-proof comment link,
staff assignment comment link. Update this plan's STATUS and the handoff row.
Leave on the issue one line: "Retarget to DesignFlow tracked in
plan_user_permissions_designflow_cutover.md Phase 3 step 7 (popcre/designflow-backend#250)".
Gate: issue closed; parent plan untouched except, if useful, a one-line
note in its Phase 3 step 7 that the picker has UI-level proof.

Adversarial cases (the picker takes admin input that changes other people's
access):

| Input | Hostile case | Test / proof |
|---|---|---|
| role value from `<select>` | value outside the five options (DOM tampering) | RPC enum rejects; Step 2 test "picking Designer…" asserts only enum values are sent; live: RPC error surfaces as toast |
| target user | last administrator demoted | RPC invariant (2026-10-28 proof "self-demotion refused"); re-run in Step 3 on the admin tester's own row → expect toast error, role unchanged |
| caller | PopDAM admin without `administrator` app role | Step 2 "hides the dropdown when the directory RPC is refused" |
| caller | no session / expired | directory query returns `[]`, picker hidden (code 64-66); Step 2 covers via mocked null session (add `it`: "renders no picker without a session") |
| concurrent edits | two admins change the same user | server-side advisory lock in 20261026155023; out of scope to test here |

## 10. Tests required

- New `src/test/users-role-picker.test.tsx` (6 cases listed in Step 2 and the
  table).
- Stay green: `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run build`; worker and windows-agent suites unchanged.

## 11. Constraints and gotchas

- Feature branch + PR to `main`; AI merges; never push to `main`.
- No DB structure changes in this repo; none are needed. Role data changes
  happen only through the picker/RPC with an administrator session — never
  by direct SQL on production (production DB is read-only by default).
- Never touch `auth.users` writes without owner authorization (parent plan §11).
- Business decision (which role per employee) is Albert's; never guess it.
- Two duplicate components: any code change must land in BOTH
  `UsersAndInvitations.tsx` and `UsersTab.tsx` (PR #568's misplacement is the
  precedent). This plan changes neither.
- PII: do not paste employee emails into screenshots; names on the issue are
  acceptable (the issue is in a private repo), ids are not needed.
- Do not screenshot PopSG Settings (plaintext NAS password on the Setup tab).
- Times in EST; sign posts with `$AI_GH_SIGNATURE`; reviews advisory only.

## 12. Access and environment

- Admin tester: 1Password vault `vibe_coding` item `7s5uzpbjenka4fpvrqogh44bre`
  (`ai-admin@designflow.app`; has `public` admin + app `administrator` — used
  for the 2026-10-28 proof). Viewer tester: item `mbspkosvp2rf25qxhqufipxqca`.
  Anon key for password grant: item `3hhxwrljnaq2tykxi7hplq5ryi` field
  `SUPABASE_PUBLISHABLE_KEY`. If a password is stale (`invalid_credentials`,
  noted 2026-10-27 in docs/incident-log.md), reset it yourself via the auth
  admin API using item "Supabase Runtime Keys - shared POP database
  (production)" and update the 1Password item (`secrets-to-1password`).
- Session injection recipe: memory `project_popsg_tester_login` (password
  grant → `localStorage["sb-popdam-auth-token"]`).
- Directory read outside the browser: `POST /rest/v1/rpc/crm_admin_user_directory`
  with `Accept-Profile: api` and the admin tester's access token.
- Repo: fresh worktree from `main`; `gh` authenticated as u2giants.

## 13. Definition of done, risks, open questions

Done when: live build verified (Step 1); test PR merged with CI green;
UI-level proof posted and box ticked; role-less staff list posted and, for
every name Albert answered, assigned via the UI and verified; #566 closed
with links; STATUS + handoff updated.

Risks: tester passwords stale (recover per §12); an admin tester without the
`administrator` app role would hide the picker (check the directory first —
the 2026-10-28 proof says it has it); role change on a real employee is
immediately live — only act on Albert's explicit answer and record the
previous state so it can be reverted through the same picker.

Open: Albert's per-name role answers (business). Everything else is
technical and decided.

## Self-audit

1. Could a fresh session execute this without asking? Yes — §5 pins the
   shipped code by file:line, §9 gives exact proof mechanics, test cases and
   gates, §12 names every login by vault item id; the only question left is
   the business one, which Step 4 scripts as a single message to Albert.
2. Is all background carried? Yes — §3 gives the history (#545 → #568/#569 →
   ruling), §6 the three-axis trap and the handoff's "not an owner question"
   nuance, §7 the superseded shared-db claim and the rejected blanket grant.
3. Is the goal clear enough to steer by? Yes — §1 quotes Albert and ties it to
   the empty-screens problem, and marks DesignFlow as the eventual authority so
   an implementer will not add a write path.
