---
summary: Issue #565 plan: admin-api invite-user rejects service-role callers (uuid 'system'). Read its STATUS first.
kind: plan
status: open
read-when: implementing or planning issue work for issue-565
---

# Plan: admin-api invite-user rejects service-role callers (uuid 'system') (u2giants/popdam3#565)
Issue: https://github.com/u2giants/popdam3/issues/565
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

Related: [plan_user_permissions_designflow_cutover.md](../../plan_user_permissions_designflow_cutover.md) — its Phase 1 step 4 mentions "invitation handling (currently per-app `public.invitations`)" as something the shared-db lane includes eventually, but no step of that plan has started and it does not change this edge function. This fix is independent and does not pre-empt it.

## STATUS — read this first

| Step | State | Evidence / notes |
|---|---|---|
| 1. Add a pure `actorIdOrNull` helper + tests | ⬜ open | — |
| 2. Use it in `invite-user` (the reported bug) and `set-user-apps` (same bug, same file) | ⬜ open | — |
| 3. Replace the seven inline `userId === "system" ? null : userId` copies | ⬜ open | optional, see §8 |
| 4. PR → CI → merge → edge deploy verified | ⬜ open | — |
| 5. Live proof with the service key against production, cleanup, close | ⬜ open | — |

Where a fresh session starts: Step 1. Bug confirmed still present on main (`supabase/functions/admin-api/index.ts:491`), not fixed anywhere.

## 1. Ultimate goal

A server-side process (the Railway worker, an AI drill, any caller holding the
Supabase service key) can invite a user through the same admin-api
`invite-user` action an administrator uses in the browser, instead of failing
with a database error and forcing whoever is testing to hand-insert
invitation rows. Nobody has to work around the invite path again.

If a step conflicts with this goal, the goal wins — stop and flag it on #565.

## 2. What this application is

PopDAM / PopSG (repo u2giants/popdam3, branch `main`) — internal digital
asset manager; Supabase edge functions in Deno under `supabase/functions/`,
deployed to project `qsllyeztdwjgirsysgai` (Virginia) by
`.github/workflows/deploy-supabase.yml` on any `supabase/functions/**` change
merged to `main` (redeploys every function, `--no-verify-jwt`). `admin-api`
is the action-routed admin backend; the browser calls it with the user's JWT
(`src/hooks/useAdminApi.ts`); server processes call it with the service key,
which the shared auth helper maps to the sentinel user id `"system"`
(`supabase/functions/_shared/admin-auth.ts:69-95`; KNOWN_QUIRKS §6 explains
why this bypass exists).

Email/password sign-ups are invitation-gated: the `handle_new_user` trigger
on `auth.users` refuses sign-up unless a `public.invitations` row exists for
the email (memory `project_popsg_tester_login`). So `invite-user` is the
sanctioned way to create any non-SSO account, including AI tester accounts.

## 3. What triggered this work

2026-10-28 PopSG semantic-search drills (issue #107, comment 6461895625,
"Defects found" #1): calling admin-api `invite-user` with the service key
returned `{"ok":false,"error":"invalid input syntax for type uuid: \"system\""}`.
The tester was provisioned by inserting the invitation row directly plus an
auth-admin create. Issue #565 was opened the same night. On 2026-11-04 an
issue review re-confirmed the bug on main 522e5722 and recommended the
one-line fix (the second comment corrects an earlier note: the cutover plan
does not move invites).

Reproduce (read-only until Step 5): `POST https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/admin-api`
with `Authorization: Bearer <service key>` and body
`{"action":"invite-user","email":"<throwaway>@popcre.com","role":"user","apps":["popdam"]}`
→ HTTP 500 with the uuid error. Note: it also sends a Brevo email on success,
so use a mailbox you control or a clearly fake-but-valid address and revoke
right after.

## 4. Scope

**In:** `invite-user` writing `invited_by = null` for service-role callers;
the identical latent bug in `set-user-apps` (`granted_by`); a tested pure
helper; live proof.

**NOT in this plan:**
- Any change to who may call `invite-user` (stays admin-only + service role).
- The invitations data model, the signup trigger, Brevo templates, or
  `send-invite-email`.
- Moving invitations to DesignFlow (parent plan, not started).
- Recording a non-null "system" actor id (there is no system profile row;
  siblings already use null).
- DB schema changes (none needed: `invitations.invited_by` and
  `app_access.granted_by` are already nullable —
  `src/integrations/supabase/types.ts:2111` and `:385`).

## 5. Current state of the code (verified on main 01fcfc34, 2026-11-04)

- Bug: `supabase/functions/admin-api/index.ts:489-493`
  `.insert({ email, role: roleStr, invited_by: userId, apps })` inside
  `handleInviteUser(body, userId)` (446-512), dispatched at 2095-2096 after
  `authenticateAdmin` (admin-only tier; service role passes through
  `requireAdmin` at admin-auth.ts:157).
- Same latent bug: `handleSetUserApps` at `index.ts:603-630`, line 624
  `granted_by: _userId` (param is deliberately underscored, so nobody looked).
- Correct siblings that map the sentinel: `index.ts:1405`, `:1493`;
  `_shared/admin-handlers/agent-handlers.ts:726`;
  `_shared/admin-handlers/erp-browse-handlers.ts:193,203,213,234,243` — nine
  hand-written copies of `userId === "system" ? null : userId`.
- Sentinel origin: `_shared/admin-auth.ts:84,93` returns
  `{ userId: "system", via: "service_role" }`.
- Pure, vitest-covered policy module: `_shared/auth-policy.ts` (import-free;
  tests in `src/test/auth-policy.test.ts`). `admin-utils.ts` is NOT
  import-free (imports `./http.ts`, `./service-client.ts`), so a helper there
  cannot be unit-tested under vitest.
- No worker/script in this repo calls `invite-user` (`grep -rn invite-user apps scripts bin` is empty); the only callers are the Settings UI (`src/pages/settings/UsersAndInvitations.tsx:217-226`, `src/components/settings/UsersTab.tsx`) and ad-hoc drills.
- Nothing committed, branched or deployed for this issue.

## 6. Key findings

- Root cause: the service-role sentinel is a string, not a uuid, and the
  invite path is the one admin-only write that never learned to null it.
- The drill's workaround (direct row insert + auth admin create) works but
  skips the duplicate-pending check (`index.ts:474-484`) and the email, which
  is exactly the drift the goal forbids.
- Because `handleInviteUser` lives inside the 2,393-line `index.ts` (Deno-only
  imports), it cannot be unit-tested from vitest; the testable piece is the
  helper. Extracting the whole handler into `_shared/admin-handlers/` with a
  fake-db test (pattern: `sg-nas-handlers.test.ts`) is possible but is a
  larger move than this one-liner warrants (§7).

## 7. Approaches considered and rejected

- **Give the service role a real "system" profile uuid** so `invited_by` is
  never null. Rejected: needs a shared-db row and a convention every app
  would have to honour; siblings already settled on null.
- **Reject service-role callers for `invite-user` with a clear 403.**
  Rejected: contradicts the goal (drills and the worker should be able to
  invite); the issue reporter's own correction says the fix is the one-liner.
- **Extract `handleInviteUser` to `_shared/admin-handlers/invitation-handlers.ts`
  with a fake-db vitest** now. Rejected for this issue: fine refactor, but
  it moves 120 lines and the Brevo import to fix one field; do it if the
  handler is touched again for a feature.
- **Leave `set-user-apps` alone because nobody reported it.** Rejected: same
  bug, same file, same fix, zero risk; fixing one and not the other is the
  kind of drift KNOWN_QUIRKS already complains about for admin checks.

## 8. Design decisions

- **LOCKED:** service-role writes record `null` for the actor column
  (matches the nine existing sites).
- **LOCKED:** the helper lives in `_shared/auth-policy.ts` (import-free) so
  it is vitest-tested; name `actorIdOrNull(userId: string): string | null`
  returning `null` for `"system"` and otherwise the id unchanged.
- **OPEN (implementer, recommended yes):** Step 3 replacing the seven other
  inline copies with the helper. Criterion: purely mechanical, same PR, no
  behaviour change; skip only if the diff review budget is tight — then open
  no new issue, just note it on #565.

## 9. The plan

### Step 1 — Helper + tests
`supabase/functions/_shared/auth-policy.ts`: add
```ts
/** Service-role callers carry the sentinel "system"; actor columns are uuid, so store null. */
export function actorIdOrNull(userId: string): string | null {
  return userId === "system" ? null : userId;
}
```
`src/test/auth-policy.test.ts`: `describe("actorIdOrNull")`:
- "maps the service-role sentinel to null"
- "passes a real uuid through unchanged"
- "does not treat look-alikes as the sentinel" (`"System"`, `" system"`, `""` → returned as-is, since only the exact sentinel is minted by admin-auth.ts:84,93)
Gate: `npm run test -- auth-policy` passes; file still has zero `import` lines.

### Step 2 — Fix the two write sites
`supabase/functions/admin-api/index.ts`: import `actorIdOrNull` from
`../_shared/auth-policy.ts` (add to the existing `_shared` imports near line
2-23); change line 491 to `invited_by: actorIdOrNull(userId)`; change line
624 to `granted_by: actorIdOrNull(_userId)` (rename the param to `userId`
while there). Behaviour: a browser admin's invite still records their uuid;
a service-key invite records null and succeeds; the pending/accepted
duplicate checks and the Brevo send/rollback (494-511) are untouched.
Gate: `npm run typecheck && npm run lint` green;
`grep -n "invited_by: userId\|granted_by: _userId" supabase/functions/admin-api/index.ts` returns nothing.

### Step 3 — (optional, recommended) de-duplicate the sentinel checks
Replace the seven `userId === "system" ? null : userId` copies listed in §5
with `actorIdOrNull(userId)` (import the helper in `agent-handlers.ts` and
`erp-browse-handlers.ts`). No behaviour change.
Gate: `grep -rn '=== "system"' supabase/functions` shows only
`auth-policy.ts` (and `grid-ai-handler.ts:38`, which is a chat `role: "system"`, unrelated — leave it).

### Step 4 — Land it
Branch `fix/565-invite-user-service-role` from `main` in a fresh worktree;
commit as Albert's verified identity; PR to `main` referencing `#565`;
`bin/ai-pr-wait <pr>` in the background; merge on green (AI merges). Then
`gh run list --workflow deploy-supabase.yml -L 3` → the run for the merge SHA
must be green and its log must show `Deploying function: admin-api`.
Gate: deploy run green for the merge SHA.

### Step 5 — Live proof, cleanup, close
With the production service key (1Password, §12) via `op run` so the value
never appears in output:
1. `invite-user` for a throwaway `+` address on a mailbox the AI controls or
   `ai-invite-proof-<date>@popcre.com` with `role: "user"`, `apps: ["popdam"]`
   → expect 200 `{ok:true, invitation:{…}}`; read back with `list-invites`
   and confirm `invited_by` is `null`.
2. `set-user-apps` for the viewer tester's `auth_user_id` with its current
   app list (read it first from `list-users`) → 200; re-read; `granted_by`
   null is not returned by `list-users`, so confirm through psql/Management
   API read of `public.app_access` for that user (read-only query).
3. `revoke-invite` the proof invitation (admin-api action, 2099) so no
   pending row is left; confirm `list-invites` no longer shows it.
4. Post on #565: request/response status lines (no keys), merge SHA, deploy
   run id, times in EST, signed with `$AI_GH_SIGNATURE`; close the issue.
   Also tick nothing on #107 (not this plan's issue) but add a one-line
   cross-reference comment there that defect #1 is fixed.
Gate: issue closed with evidence; no leftover invitation row; STATUS updated.

Adversarial cases (trust boundary: request body + caller identity):

| Input | Hostile case | Test / proof |
|---|---|---|
| caller id | `"system"` sentinel | "maps the service-role sentinel to null" + Step 5.1 live |
| caller id | sentinel look-alike (`"System"`, padded) | "does not treat look-alikes as the sentinel" (they are never minted; if one reached the DB it would fail the uuid cast loudly, which is correct) |
| caller id | real uuid | "passes a real uuid through unchanged" + browser invite still records the admin (Step 5 optional: one UI invite by the admin tester, then revoke) |
| `email` | malformed / uppercase | existing regex + lowercasing (index.ts:453-460); unchanged, no new test |
| `apps` | invalid app names | existing filter (464-472); unchanged |
| duplicate invite | pending/accepted exists | existing checks (474-484); Step 5.1 re-run the same email once → expect "already pending" before revoking |
| Brevo failure | email send fails | existing rollback deletes the row (505-509); unchanged |

## 10. Tests required

- New: three `actorIdOrNull` cases in `src/test/auth-policy.test.ts`.
- Stay green: `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run build`, plus the worker and windows-agent suites CI runs.
- No Deno test exists for `index.ts`; the deploy workflow is its type gate.

## 11. Constraints and gotchas

- Feature branch + PR to `main`; AI merges; never push to `main`.
- No DB change in this repo; none needed (columns already nullable).
- `auth-policy.ts` must stay import-free (vitest loads it directly).
- Never print the service key; use `op run` with an `op://vibe_coding/...`
  reference in env only; redact anything that leaks on this machine.
- Production DB is read-only by default: the only production writes here are
  through the deployed admin-api actions (invite, revoke, set-user-apps on a
  test account), which is the feature under proof. No direct SQL writes.
- Do not invite a real employee for the proof; use a throwaway address and
  revoke it. Never create a credential for Albert to use.
- `deploy-supabase.yml` redeploys all functions; expected.
- Times in EST; sign posts with `$AI_GH_SIGNATURE`; reviews advisory only.

## 12. Access and environment

- Service key: 1Password vault `vibe_coding` item "Supabase Runtime Keys -
  shared POP database (production)" (new-format `sb_secret` field; admin-api
  accepts it via `isServiceRoleToken`, and the legacy JWT via
  `allowVerifiedLegacyServiceRole`). Memory
  `project_service_role_key_mismatch` explains false 401s if the wrong class
  is used.
- Viewer tester (for `set-user-apps` proof): item `mbspkosvp2rf25qxhqufipxqca`
  field `auth_user_id`. Admin tester: item `7s5uzpbjenka4fpvrqogh44bre`.
- Read-only DB check: psql via pooler
  `aws-1-us-east-1.pooler.supabase.com:6543`, user
  `postgres.qsllyeztdwjgirsysgai`, password item "Supabase DB Password -
  shared POP database" (memory `project_secret_access_paths`).
- Function URL: `https://qsllyeztdwjgirsysgai.supabase.co/functions/v1/admin-api`.
- `gh` authenticated as u2giants; fresh worktree from `main`.

## 13. Definition of done, risks, open questions

Done when: helper + tests merged; both write sites fixed (and optionally the
seven copies); CI and `deploy-supabase.yml` green for the merge SHA; live
service-key invite returns 200 with `invited_by = null`; proof invitation
revoked; #565 closed with signed evidence; #107 cross-referenced; STATUS and
handoff updated.

Risks: a failed edge deploy leaves the old `admin-api` live (the workflow
fails loudly; rerun); the proof sends one Brevo email to a throwaway
address (acceptable); forgetting to revoke the proof invite leaves a pending
row that blocks a future invite for that address (Step 5.3 is the guard).
Rollback: revert the PR; functions redeploy.

Open questions: none business-meaning. Technical: Step 3 (optional
de-duplication) per §8.

## Self-audit

1. Could a fresh session execute this without asking? Yes — §5 names every
   line to change and every sibling site, §9 gives the exact helper code,
   test names, grep gates, deploy verification and a cleanup step; §12 names
   every secret by vault item and the exact function URL.
2. Is all background carried? Yes — §3 cites the drill comment with the
   verbatim error and the workaround, §6 explains why the handler cannot be
   unit-tested directly, §7 records the four rejected routes including the
   bigger extraction and the "just refuse service role" option.
3. Is the goal clear enough to steer by? Yes — §1 states that server-side
   callers must be able to invite through the same path as admins, which
   decides every judgment call (null actor, no 403, fix the sibling too).
