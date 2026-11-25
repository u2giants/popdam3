---
summary: Issue #830 plan: admin-api set-user-apps still writes the service-role sentinel "system" into a uuid column. Read its STATUS first.
kind: plan
status: open
read-when: implementing issue #830, or touching granted_by / invited_by in admin-api
---

# Plan: admin-api `set-user-apps` rejects service-role callers (u2giants/popdam3#830)

Issue: https://github.com/u2giants/popdam3/issues/830
Handoff: [HANDOFF.d/2026-11-25T2056Z-al8960ofc-claude-plans-master-data-shared-data-invites.md](../../HANDOFF.d/2026-11-25T2056Z-al8960ofc-claude-plans-master-data-shared-data-invites.md)
Predecessor plan (same bug class, mostly delivered): [issue-565-invite-user-service-role.md](issue-565-invite-user-service-role.md)
Written 2026-11-25 3:56 PM EST by Claude (plan only; nothing implemented).

## STATUS — read this first

| Step | State | Evidence / notes |
|---|---|---|
| 1. Fix `granted_by` in `handleSetUserApps` | ⬜ open | Still `granted_by: _userId` at `supabase/functions/admin-api/index.ts:527` on `origin/main` 787c20b8 |
| 2. Extend the source-contract test (both sites, CRLF-safe) | ⬜ open | `src/test/invite-user-service-role.test.ts` guards only `invited_by` and does not normalize CRLF |
| 3. PR → CI → merge → edge deploy verified | ⬜ open | — |
| 4. Live proof with the service key, cleanup, close #830 | ⬜ open | — |

Where a fresh session starts: Step 1.

## 1. Ultimate goal

Any server-side process that holds the Supabase service key (the Railway worker,
an AI drill, an admin script) can change which apps a user may open through the
same admin API a human administrator uses, and the change is stored. Today that
call fails with a database error, so automated access changes are impossible and
an operator has to do them by hand. **If a step conflicts with this goal, the
goal wins — stop and flag it.**

## 2. What this application is

PopDAM (`u2giants/popdam3`) is POP Creations' internal digital asset manager:
React web app at `https://dam.designflow.app`, backed by the shared Supabase
project `qsllyeztdwjgirsysgai`. `supabase/functions/admin-api/index.ts` is one
Deno edge function with many routes (`action` in the JSON body). Routes are
authorized in `supabase/functions/_shared/admin-auth.ts`: a JWT caller gets its
real user uuid; a caller presenting the service-role key gets the sentinel
string `"system"` as its user id. Edge functions deploy on merge to `main` via
`.github/workflows/deploy-supabase.yml`.

## 3. What triggered this work

The advisory AI reviewer on PR #829 (fix for #565, merged) found that the sibling
route `set-user-apps` has the identical bug: `handleSetUserApps` inserts
`app_access.granted_by = _userId`, and `granted_by` is a `uuid` column, so a
service-role call fails with HTTP 500 `invalid input syntax for type uuid:
"system"`. Its fix PR #831 was closed unmerged; the fixer then deferred. The
review also asked that the test guard both sites and normalize CRLF.

Reproduce (read-only reasoning; do not run against production before the fix):
`POST /functions/v1/admin-api` with `Authorization: Bearer <service key>` and
body `{"action":"set-user-apps","user_id":"<uuid>","apps":["dam"]}` for a user
missing an app → 500 with the uuid error.

## 4. Scope

In: the `granted_by` value in `handleSetUserApps`; the source-contract test; live
proof.

NOT in this plan: the optional `actorIdOrNull` helper refactor of the other
inline copies (issue-565 plan Step 3 — optional, leave it); changing
authorization; schema changes to `app_access` or `invitations`; the
DesignFlow permissions cutover (`plan_user_permissions_designflow_cutover.md`).

## 5. Current state of the code (origin/main 787c20b8)

- `supabase/functions/admin-api/index.ts:391` — `invite-user` already maps the
  sentinel: `invited_by: userId === "system" ? null : userId` (from #829).
- `supabase/functions/admin-api/index.ts:503` — `handleSetUserApps(body, _userId)`;
  `:527` builds `{ user_id, app, granted_by: _userId }` — **the bug**.
- `:2019` dispatches `set-user-apps` with the route's `userId`.
- `src/test/invite-user-service-role.test.ts` — reads the source without CRLF
  normalization, asserts only the `invited_by` form.

## 6. Key findings

- `app_access.granted_by` is nullable uuid (`docs/SCHEMA.md` §3.9), so `null` is
  the correct stored value for a non-human actor — the same convention as the
  nine existing `=== "system" ? null :` sites in admin-api.
- Service-role callers are already authorized (`_shared/admin-auth.ts`); this is
  a stored-value fix, not an access change.
- Nothing in `src/` reads `granted_by`.

## 7. Approaches rejected

- Store a fixed "system user" uuid: invents a fake person and pollutes audit data; rejected in the #565 plan.
- Change the column to text: a shared-db schema change for a one-line app bug; rejected.
- PR #831 as-is: closed unmerged by its author flow; re-do the fix fresh on current `main` rather than reviving the stale branch.

## 8. Decisions

Locked: store `null` for the `"system"` sentinel; JWT callers keep their uuid;
use the inline ternary (matches siblings). Open: none.

## 9. Steps

### Step 1 — fix the value (`helper-ok`: one exact edit)
Edit `supabase/functions/admin-api/index.ts:527` to
`granted_by: _userId === "system" ? null : _userId`. Rename the parameter from
`_userId` to `userId` only if the linter flags the underscore as "unused" (it is
now used); otherwise leave it.
Done when: `grep -n 'granted_by: _userId,\|granted_by: _userId }' supabase/functions/admin-api/index.ts` prints nothing.
Stop-and-ask: if line 527 no longer matches (main moved), bring the new location back to the lead.

### Step 2 — test (`helper-ok`: exact assertions given)
In `src/test/invite-user-service-role.test.ts`: normalize with
`.replace(/\r\n/g, "\n")` after reading; add a second `it(...)` that slices
`async function handleSetUserApps` to the next `async function` and asserts it
contains `granted_by: _userId === "system" ? null : _userId` (or the renamed
form) and does not contain `granted_by: _userId }`.
Done when: `npx vitest run src/test/invite-user-service-role.test.ts` passes, and fails if Step 1 is reverted.
Stop-and-ask: any other test file failing.

### Step 3 — land (`lead-only`: merge decision)
Branch from `origin/main`, PR referencing `Fixes #830`, required checks green, AI merges. Confirm `deploy-supabase.yml` run for the merge SHA succeeded.

### Step 4 — live proof (`lead-only`: production write judgment)
With the service key from 1Password (`vibe_coding`, the PopDAM Supabase service-role item — look up by title "Supabase", never paste the value), call `set-user-apps` for a dedicated test user only (create none if none exists; use the AI drill test account named in `docs/AUTHENTICATION.md` if present, else report `Blocked —`). Expect 200; read back `app_access` rows: new row has `granted_by IS NULL`. Restore the user's original app set the same way. Comment the evidence on #830, signed, and close it.

## 10. Tests

`src/test/invite-user-service-role.test.ts` (both cases). Must stay green: `npm test` (vitest), `npm run lint`, `npx tsc --noEmit`.

## 11. Constraints and gotchas

Feature branch + PR, never push to `main`. No schema change. Source-contract tests must normalize CRLF (repo quirk 2026-10-19). Do not touch other routes.

## 12. Access

`gh` authenticated as `u2giants`; service key in 1Password vault `vibe_coding` (location only). Local: `npm ci && npm test`.

## 13. Done, risks, open questions

Done: Steps 1–4, edge deploy run green for the merge SHA, #830 closed with signed evidence, this STATUS updated. Risk: minimal; rollback is reverting the one line. Open: none.

## Self-audit (2026-11-25)

1. A fresh session can execute it without asking: yes — §5 gives the exact line, §9 the exact edit, assertions and gates, §12 secret location.
2. Background carried: yes — §3/§6 explain the sentinel, §7 the rejected options and PR #831's fate.
3. Goal clear enough to steer: yes — §1 states the business result; §8 locks the only design choice.

## Lead launch prompt

```text
Implement docs/plans/issue-830-set-user-apps-service-role.md in u2giants/popdam3. Read its STATUS first.
You (lead) do Steps 3 and 4 and verify everything. Hand Steps 1 and 2 to your helper.
Your helper is your own tool's smaller model — Haiku (high effort) for Claude Opus, Luna (high) for Sol, GLM Flash for GLM MAX, Mimo Flash for Mimo Pro. Never a full-strength model.
Rules: https://github.com/popcre/ai-devops/blob/main/templates/system/model-tier-delegation.md
The helper returns finished work or an evidenced blocker, makes no design decisions, never merges or posts, asks you when a stop-and-ask trigger fires, and is taken back after 30 minutes stuck.
Run the Step 1 grep and Step 2 test yourself before opening the PR.
```
