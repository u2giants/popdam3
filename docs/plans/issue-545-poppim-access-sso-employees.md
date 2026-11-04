# Plan: PopPIM access missing for @popcre.com employees; revoked personal-login sessions blocking PopDAM search (u2giants/popdam3#545)
Issue: https://github.com/u2giants/popdam3/issues/545
Handoff: [HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md](../../HANDOFF.d/2026-11-04T2145Z-hetz-claude-issue-plans.md)
Written 2026-11-04 by Claude (plan only; no implementation started).

Related plan (read its STATUS first; do not duplicate it):
[plan_user_permissions_designflow_cutover.md](../../plan_user_permissions_designflow_cutover.md)
— DesignFlow becomes the single writer of roles/app access (master issue
popcre/designflow-backend#250). This plan covers only what #545 still owes.

## STATUS — read this first

| Step | State | Evidence / notes |
|---|---|---|
| 0. Record the reconciliation with the DesignFlow sole-writer contract on #250 and #545 | ⬜ open | |
| 1. Re-measure live state (read-only): who lacks `pm`, revoked logins with live sessions, personal logins holding access | ⬜ open | |
| 2. Grant `pm` to the employees hired since 2026-10-27 (production data write, gated) | ⬜ open | |
| 3. shared-db: signup hook grants `pm` to Microsoft-SSO @popcre.com users | ⬜ open | claim-first on the existing shared-db lane; `shared-db-change` skill |
| 4. Repeat sign-out of the revoked login `7f7699e8-…` if it has live sessions again | ⬜ open | covered by the 2026-10-27 owner authorization |
| 5. Personal (non-SSO) logins that still hold app access: report; owner decides | ⬜ open | business question for Albert |
| 6. Docs: `docs/AUTHENTICATION.md` provisioning text; access record for step 2 | ⬜ open | |
| 7. Live proof + close #545 | ⬜ open | employee confirmation relayed by Albert |

**Where a fresh session starts:** step 0 then step 1. Already DONE on this issue (do not
redo): the 2026-10-27 `pm` grant to 24 SSO employees (record
`docs/access-records/2026-10-27-poppim-pm-access-all-employees.md`, PR #558, `1549c634`);
the forced sign-out of two revoked personal logins (2026-10-27 4:22 PM EDT); the
per-user role picker (#566, PR #568); owner decisions 1–3 of 2026-10-27. Still OPEN per
the 2026-11-04 scope comment: 3 newer hires lack `pm`; the signup hook still grants only
`crm` + `dam`; one revoked login may reconnect; 4 personal logins still hold access;
employee live proof.

---

## 1. The ultimate goal (plain business English)

Every POP Creations employee who signs in with their company Microsoft login must be
able to open PopDAM and PopPIM and use search and filters — on their first day,
without anyone granting access by hand — and old personal (Gmail-style) logins must
not keep working after the company moved to Microsoft sign-in. Owner rule (Albert
Hazan, verbatim, 2026-10-27): "all users that login using microsoft SSO and have an
@popcre.com email address should have access to popdam and poppim". And:
"no PopPIM for the two staff without Microsoft login".

**If a step conflicts with this goal, the goal wins — stop and flag it.**

## 2. What this application is

PopDAM / PopSG (`u2giants/popdam3`, https://dam.designflow.app, https://sg.designflow.app),
PopPIM (`u2giants/poppim-web`) and PopCRM share one Supabase backend (project
`qsllyeztdwjgirsysgai`). Login is Supabase Auth with Microsoft/Azure SSO for staff
(`docs/AUTHENTICATION.md`). Authorization has three axes (`docs/AUTHENTICATION.md`
→ "Authorization: three axes"): PopDAM-local `public.user_roles` / `public.app_access`,
and the shared `app.profile` → `app.app_access` (apps `dam, crm, pm, plm, admin`) →
`app.user_role` (tiers `administrator, sales, licensing, designer, viewer, vendor`).
PopPIM gates on `app.has_app_access('pm')`; PopDAM's search/filter RPCs gate on `dam`.
First-login provisioning is the shared signup hook `app.handle_new_auth_user()`
(trigger `on_auth_user_created` on `auth.users`), canonical in `popcre/shared-db`
(current body: `shared-db/supabase/migrations/20261007171252_popdam_dam_access_on_signup_prod.sql:109–162`
in this repo's read-only mirror).

## 3. What triggered this work

2026-10-27: a designer reported PopDAM search and filter dropdowns empty, and staff had
no PopPIM access. Diagnosis (issue body): nothing was revoked — her browser held a
pre-SSO personal login whose access was removed 2026-07-26 but whose sessions kept
refreshing; PopPIM had never been granted to employees (the 2026-10-07 fleet grant #185
covered `dam` only); 8 employees had no app role. Fixes executed that day are listed
above. The 2026-11-04 review (comment on #545) re-scoped what remains:

> Live Nov 4: 25 of 28 SSO staff have both apps; 3 hires since Oct 27 lack PopPIM because
> the signup hook grants only crm and dam. To do: grant the 3; add pm to the hook,
> reconciled with the DesignFlow sole-writer contract; repeat sign-out of revoked login
> 7f7699e8; review 4 personal logins with access. Role-less staff moved to #566.
> 'Banned' is not the test: the Oct 27 ruling chose sign-out.

and: "Owner ruling of 2026-10-28 makes DesignFlow the single source for users and roles
(popcre/designflow-backend#250). The proposed signup-hook follow-up must be rechecked
against that plan."

## 4. Scope

**In:** steps 0–7 above: the reconciliation note, the 3 grants, the hook change (via
shared-db), the repeat sign-out if needed, the personal-login review, docs, live proof.

**NOT in this plan:**
- Role tiers for role-less staff (moved to #566; per-user picker shipped).
- Any DesignFlow admin API/UI work (plan_user_permissions_designflow_cutover.md Phases 1–4;
  popcre/designflow-backend PR #252 merged to develop 2026-10-29).
- Changing how anyone logs in (Microsoft SSO stays).
- Banning (`banned_until`) any login — explicitly NOT the chosen remedy (2026-10-27 ruling: sign-out).
- `pm` for the two password-only @popcre.com staff (owner decision 2: no).
- Retiring the PopDAM-local `public.*` axes (cutover plan §8 OPEN item).

## 5. Current state (verified 2026-11-04 at `01fcfc34`, plus issue/live notes)

- Signup hook (`20261007171252…sql:109–162`): upserts `app.profile`; grants `crm` to
  everyone; grants `dam` when `lower(email) ~ '^[^@]+@popcre[.]com$'` (domain-only, no
  provider check); grants `administrator` to the two owner addresses. **No `pm` grant.**
  No later migration in the mirror redefines `app.handle_new_auth_user()` (grep over
  `shared-db/supabase/migrations/` after 20261007171252 finds none).
- DesignFlow sole-writer contract (cutover plan §8, LOCKED 2026-10-28): "DesignFlow
  backend is the only writer of the existing `app.*` role/access rows … through its own
  API … `app.profile` creation stays with the Supabase Auth signup hook." The hook's
  existing `crm`/`dam` grants predate and were not retired by that contract; DesignFlow's
  Phase-1 API (`/api/app-access`, PR #252) is on `develop`, production proof pending
  (popcre/designflow-backend plan_open-issues-2026-11.md step 1).
- Access records: `docs/access-records/2026-10-07-popdam-dam-access-all-employees.md`,
  `docs/access-records/2026-10-27-poppim-pm-access-all-employees.md` (the model for step 2,
  including rollback SQL and the guard list).
- `docs/AUTHENTICATION.md:11` still says new Azure users are "auto-provisioned with the
  `user` role and `popdam` app access" (the PopDAM-local axis only) — incomplete after
  #185 and will be wrong after step 3.
- `docs/popdam-access-provisioning.md` is referenced by the cutover plan but does not
  exist in this worktree (do not create it; the authority doc is `docs/AUTHENTICATION.md`).
- Live counts are from 2026-11-04 (issue comment) and must be re-measured in step 1.

## 6. Key findings and root cause

- New hires lack PopPIM because provisioning is "hook + manual fleet grants"; every
  app added after the hook was written needs its own fleet grant and hook change
  (#185 for `dam`, #545 for `pm`). Until DesignFlow owns provisioning end-to-end, the
  hook is the only automatic path.
- The owner rule is SSO-conditioned ("login using microsoft SSO"), and decision 2
  denies PopPIM to password-only @popcre.com staff. The existing `dam` grant keys on
  the domain only. The `pm` grant must therefore ALSO check the provider:
  `new.raw_app_meta_data->>'provider' = 'azure'` (that is the value the hook already
  stores into `app.profile.provider`). `auth.identities` was the authoritative SSO signal
  in the Oct 27 grant; at signup time the hook sees `raw_app_meta_data.provider`.
- Reconciliation with the sole-writer contract: the hook performs first-login
  provisioning (bootstrap), not administration; the contract explicitly leaves
  `app.profile` creation with the hook and did not retire the hook's `crm`/`dam` grants.
  Adding `pm` is the same class of bootstrap write. DesignFlow remains the only
  *administrative* writer (grant/revoke after signup). This is the position to record in
  step 0; if the DesignFlow lane disagrees, that is advice — the owner rule still stands.
- "Sign-out" = delete `auth.sessions` + `auth.refresh_tokens` rows for the login; the
  login can authenticate again (identity preserved per the 2026-07-26 ruling), so
  recurrence is expected and the 2026-10-27 recurrence note says the same authorization
  covers another sign-out.

## 7. Approaches considered and REJECTED

- **Ban the revoked logins (`banned_until` 2099).** Rejected by the 2026-10-27 ruling
  (sign-out chosen; identities preserved).
- **Grant `pm` on domain only (like `dam`).** Rejected: contradicts owner decision 2
  (password-only staff get no PopPIM).
- **Wait for DesignFlow Phases 1–4 and let it provision new hires.** Rejected: that is
  months away; the owner rule is in force now and every new hire is blocked.
- **Grant the 3 by hand without a record / gate.** Rejected: production data write;
  the 2026-10-27 record format, guards and rollback are the required pattern.
- **Retire the hook's grants now and move them to DesignFlow.** Rejected: outside this
  issue; cutover plan Phase 4.

## 8. Design decisions

- **LOCKED (owner, 2026-10-27):** SSO @popcre.com staff get PopDAM and PopPIM; the two
  password-only staff get no PopPIM; revoked personal logins are signed out, not banned;
  role tiers are chosen per user in the UI (#566).
- **LOCKED (cutover plan, 2026-10-28):** DesignFlow is the administrative sole writer of
  `app.user_role`/`app.app_access`; `app.profile` creation stays with the hook.
- **LOCKED (this plan, from the two above):** the hook's `pm` grant is conditioned on
  provider `azure` AND domain `popcre.com`, `on conflict do nothing` (keeps an admin's
  earlier revocation), and is a bootstrap write — recorded on #250 as compatible with
  the contract.
- **OPEN (owner, step 5):** which of the 4 personal logins that still hold app access
  should keep it. Criterion for the AI: report each as "has an @popcre.com SSO
  counterpart: yes/no" and "last sign-in" — never decide, never delete.
- **OPEN (implementer):** whether step 2's grant and step 3's hook change ship as one
  shared-db PR (hook) + one popdam3 record PR, or whether the 3 grants are left to the
  hook by having those users sign out/in. Criterion: the hook fires only on INSERT into
  `auth.users`, so existing users never re-trigger it — the 3 grants MUST be an explicit
  data write (step 2).

## 9. The plan — ordered steps

### Step 0 — Record the reconciliation (no code)
- Post one signed comment on popcre/designflow-backend#250 and one on #545: "Signup
  hook adds `pm` for azure + popcre.com at first login (bootstrap), per the 2026-10-27
  owner rule; DesignFlow stays the sole administrative writer; the hook's grants are
  retired in cutover Phase 4." Link this plan.
- Gate: both comments posted with `$AI_GH_SIGNATURE`.

### Step 1 — Re-measure (read-only, production)
- Queries (app schema is not PostgREST-exposed; use the Management API query endpoint or
  the pooler, §12):
  - SSO employees lacking `pm`: profiles with `provider='azure'`, email domain
    `popcre.com`, active, with active `dam` and no active `pm` row.
  - Revoked personal logins with live sessions: for the two UUIDs recorded on #545
    (`385fda19-…`, `7f7699e8-…`), `count(*) from auth.sessions` and `auth.refresh_tokens where revoked = false`.
  - Personal (non-popcre.com, non-azure) logins holding any active `app.app_access` row.
- Record counts only (UUID prefixes allowed, no emails) on #545 with the EST time.
- Gate: the comment shows the three numbers; the step-2 target list is held in the
  session, not posted.

### Step 2 — Grant `pm` to the newer hires (production data write)
- Follow `docs/access-records/2026-10-27-poppim-pm-access-all-employees.md` exactly:
  declare `ai-task-gates` class `production` (read the gate output; it may route to a
  dockerized rehearsal first); build the script with in-transaction guards (expected
  population = exactly N from step 1; every grantee azure-by-identity and holding
  active `dam`; non-`pm` invariance; service accounts excluded; count-asserted
  rollback); `granted_by_profile_id` = the owner profile id used on 2026-10-27.
- Post-write verification under one grantee's claims: `app.has_explicit_app_access('pm')`
  = true; PopPIM picker view returns rows.
- Write `docs/access-records/2026-11-<dd>-poppim-pm-access-new-hires.md` (same sections
  as the Oct 27 record; UUIDs/usernames as that record does, no passwords) and PR it to
  `main`.
- Gate: exact-set readback = N; record merged; evidence on #545.
- Note: no human approval is requested; reviews are advisory (owner ruling 2026-10-29).

### Step 3 — Signup hook grants `pm` (shared-db, claim-first)
- In canonical `/worksp/shared-db` (own worktree, branch), load the `shared-db-change`
  skill; claim `app.handle_new_auth_user()` on the existing shared-db lane for this issue
  (search shared-db issues for "handle_new_auth_user" / #545; if none exists, the claim
  goes on the shared-db issue the skill tells you to use — never a second popdam3 issue).
- New timestamped migration, derived from `20261007171252` byte-for-byte except:
  `v_pm_app app.app_name := 'pm';` and, after the `dam` block:
  ```sql
  -- PopPIM for Microsoft-SSO POP Creations employees (owner rule, u2giants/popdam3#545).
  if lower(new.email) ~ ('^[^@]+' || '@' || 'popcre[.]com$')
     and new.raw_app_meta_data->>'provider' = 'azure' then
    insert into app.app_access (profile_id, app) values (v_profile_id, v_pm_app)
    on conflict (profile_id, app) do nothing;
  end if;
  ```
  Keep the full preflight block (add the `pm` enum-label assertion next to the `dam`
  one) and update the `comment on function`.
- Preview rehearsal: insert a fake azure popcre.com user into preview `auth.users` →
  expect `crm`, `dam`, `pm`; a fake `email`-provider popcre.com user → `crm`, `dam`, no
  `pm`; a gmail azure user → `crm` only. Then PR → merge → shared-db's automatic
  promotion workflow (no manual production command). Sync the vendored mirror here
  (`chore: sync shared-db @ …` pattern in git log).
- Gate: production `pg_get_functiondef('app.handle_new_auth_user()')` contains the `pm`
  branch; preview rehearsal results posted on the shared-db lane and linked from #545.

### Step 4 — Repeat sign-out (only if step 1 shows live sessions)
- Authorization on file (Albert, verbatim, 2026-10-27): "i authorize force-signing out
  the two old personal logins still actively used today." The recurrence note on #545
  states the same decision covers another sign-out. Re-pin guards to the exact UUID
  (provider `email` for `7f7699e8-…`, `google` for `385fda19-…`), delete sessions +
  refresh tokens inside one transaction with count assertions, no `banned_until`, no
  `auth.users` change. Gate class `production`.
- Gate: 0 sessions / 0 tokens for the target; `auth.users` row intact; evidence on #545.

### Step 5 — Personal logins still holding access (report → owner)
- For each of the (4) logins from step 1: SSO counterpart exists? last sign-in (EST)?
  which apps? Post a table keyed by UUID prefix on #545. Ask Albert ONE question in the
  session: which of these should keep access. Execute his answer as a step-4-style
  sign-out (plus soft revocation of `app.app_access` via `revoked_at`, count-asserted)
  for those he removes.
- Gate: Albert's answer quoted verbatim on #545; actions executed with evidence.

### Step 6 — Docs
- `docs/AUTHENTICATION.md:11`: replace the sentence with: new Azure users bypass
  invitations; the shared hook provisions `app.profile` + `crm` + (`dam` for popcre.com)
  + (`pm` for azure popcre.com); the PopDAM-local trigger provisions `public.*` `user`
  role and `popdam` app access. Add a dated line under "Production auth provisioning
  notes" pointing at the new migration and this issue.
- Gate: doc PR merged with the step-2 record.

### Step 7 — Live proof and close
- AI-side proof: under one new hire's claims (session-injection pattern from memory
  `project_popsg_tester_login`) PopDAM search RPC returns rows and PopPIM opens.
- Employee confirmation: the `- [ ] live proof` item on #545 names the designer
  confirming search/filters and PopPIM with her Microsoft login. Ask Albert to relay her
  confirmation (a business confirmation, not a click). Tick the item, close #545.
- Gate: #545 closed; all STATUS rows cite artifacts.

Adversarial cases (trust boundary: signup-hook inputs from Supabase Auth):

| Input | Hostile case | Test (preview rehearsal / migration preflight) |
|---|---|---|
| `new.email` | `evil@popcre.com.attacker.io`, `x@sub.popcre.com`, upper-case | `hook.pm_grant_domain_exact_match` — regex is anchored, lower-cased |
| `raw_app_meta_data.provider` | `email`, `google`, null | `hook.pm_grant_requires_azure` — no `pm` row |
| re-signup of an existing profile | admin had revoked `pm` | `hook.pm_grant_respects_revocation` — `on conflict do nothing` leaves `revoked_at` |
| enum label `pm` missing on target | migration would break signups | preflight raises before `create or replace` |
| step-2 population drift | a 4th hire appears between measure and write | in-transaction exact-count guard aborts |

## 10. Tests required

- shared-db: the three rehearsal cases above, recorded as the lane's rehearsal evidence
  (shared-db `supabase/tests/` pattern if the skill requires a committed test).
- popdam3: no app code changes; `npm run test` stays green on the docs/record PR.

## 11. Constraints, standing rules, gotchas

- Shared DB structure (the hook) changes ONLY in `popcre/shared-db`, claim-first,
  `shared-db-change` skill, preview first, automatic promotion; never from this repo
  (`shared-db-guard.yml`).
- Production data writes (steps 2, 4, 5): `ai-task-gates` class `production`; recoverable
  first (count-asserted rollback in the record); never ad-hoc SQL without the record.
- Never write to `auth.users` columns; sign-out only deletes sessions/tokens.
- Never put a person's credentials, emails, or private data in this plan or the handoff;
  the issue and access records carry UUIDs/usernames as they already do.
- Never ask Albert to click, type, or create a credential; the only owner questions are
  business-meaning (step 5, step 7 relay).
- "Thirty minutes without progress is broken" — applies to the shared-db promotion;
  escalate on the lane, do not re-run production commands.
- Sign GitHub posts with `$AI_GH_SIGNATURE`; EST times.

## 12. Access and environment

- Production DB (read and gated writes): 1Password `vibe_coding` "Supabase DB Password -
  shared POP database", pooler `aws-1-us-east-1.pooler.supabase.com:6543`, user
  `postgres.qsllyeztdwjgirsysgai`; or Management API with "Supabase CLI Personal Access
  Token". The `app` and `auth` schemas are not PostgREST-exposed.
- Canonical shared-db checkout: `/worksp/shared-db` (landing-only; make a worktree).
- Tester logins for proof: 1Password `vibe_coding` "DAM AI tester login - PopDAM
  (administrator, …)" and the per-role PopSG/DAM items (memory
  `project_popsg_tester_login`); PopPIM: "poppim-production-ai-test" lane item.
- `gh` authenticated for `u2giants/popdam3`, `popcre/shared-db`, `popcre/designflow-backend`.

## 13. Definition of done, risks, open questions

Done when: step-2 record merged and readback exact; hook migration promoted and verified
in production; revoked login shows 0 sessions (if it had any); owner's step-5 answer
executed; docs updated; AI-side proof and the employee's relayed confirmation on #545;
`- [x] live proof`; #545 closed; cutover plan §5 updated to mention the hook's `pm`
grant (so Phase 4 retires it knowingly).

Risks: the hook runs on every signup — a broken body aborts ALL logins (hence the
preflight and preview rehearsal, LOCKED pattern from 20261007171252). A wrong provider
string (`azure` vs `microsoft`) silently grants nothing — verify the literal against an
existing azure `app.profile.provider` value in step 1. Rollback: re-apply the previous
function body (20261007171252) via a new shared-db migration; soft-revoke step-2 rows
with the record's count-asserted SQL.

Open questions (business): step 5 (which personal logins keep access). None technical.

## Self-audit

1. **Executable by a fresh session without questions?** Yes — §5/§9 give the exact
   migration lines, SQL shape, guard list and record template; §12 gives every access
   location; the only questions left are the owner's (§8 OPEN, step 5/7).
2. **All background carried?** Yes — §3 quotes the owner rules and the Nov 4 re-scope,
   §6 explains the provider-vs-domain nuance and the sole-writer reconciliation, §7
   lists the rejected ban/domain-only/wait-for-DesignFlow options.
3. **Goal clear enough to steer by?** Yes — §1 states the day-one-access outcome and the
   no-personal-logins outcome with the goal-wins instruction.
