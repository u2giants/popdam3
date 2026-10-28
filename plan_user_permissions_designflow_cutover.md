# Plan: consolidate user/permissions/roles into DesignFlow PLM (single source of truth)

**Tracking:** master issue popcre/designflow-backend#250 (created
with the owner ruling verbatim). Consumer issues: u2giants/popdam3#566 (DAM
picker — now a frontend-in-waiting), CRM admin settings (#4811 lane),
PopPIM consumer issue TBD.
**Handoff:** `HANDOFF.d/2026-10-28T15Z-hetz-zcode-user-permissions-dflow-plan.md`

## STATUS — read this first

| Step | State | Evidence / next session starts here |
|---|---|---|
| 0. Ruling recorded + DesignFlow + PopPIM/CRM inventory | ✅ done 2026-10-28 | Ruling §6.33 + application-map row: popcre/shared-db#4967; inventories (auth/roles/service shape, settings surfaces) posted on popcre/designflow-backend#250 (comments of 2026-10-28) |
| 1. Ownership contract decision (sole-writer vs sync) | ✅ done 2026-10-28 — LOCKED | **(a) sole-writer on the existing `app.*` rows** (DesignFlow-only writer of `app.user_role` + `app.app_access`, adopting 20261026155023 semantics; `app.profile` creation stays with the Supabase Auth signup hook). Recorded on popcre/designflow-backend#250 with the Phase-0 evidence |
| 2. DesignFlow canonical model + admin API | ⬜ open | Depends on 1 (now unblocked). First steps: shared-db grant for the DesignFlow runtime role to write `app.user_role`/`app.app_access` (production runtime currently reads only `dflow_prod`), populate the `users.app_profile_id` bridge, then the admin API (directory / set-roles / set-app-access / status, `administrator`-gated, audit history) adopting the 20261026155023 semantics |
| 3. DesignFlow admin UI for users/roles | ⬜ open | Depends on 2. Note (Phase 0): dflow-frontend already has *Manage users* (`src/app/pages/manage_users/`) and *Roles & Access* (`src/app/pages/roles_access/`) — extend with the cross-app role + app-access picker; do not rebuild |
| 4. App cutovers (DAM, CRM, PIM settings → dflow frontends) | ⬜ open | Depends on 3. Phase-0 shape: DAM/PopSG repoint the existing picker; CRM repoint its read-only directory dialog into a user card; PIM builds the card into SettingsPage placeholder cards (findings on popcre/designflow-backend#250) |
| 5. Decommission duplicate write paths + docs rewrite | ⬜ open | Depends on 4 |

A fresh session starts at Phase 0 and must re-read this plan (not memory).

## 1. Ultimate goal

One place — DesignFlow PLM — holds every user's identity, app permissions, and
roles for all POP applications (CRM, PopPIM, PopDAM, PopSG). Today, management
surfaces are scattered: each app's Settings has its own user area writing to
shared tables through different RPCs. When this is done: an admin changes a
person's role or app access once, in DesignFlow, and every app reflects it;
each app's own Settings screen still shows user info but is only a frontend to
DesignFlow's functionality. If any step in this plan conflicts with that goal,
the goal wins — stop and flag it.

Owner ruling (Albert Hazan, verbatim from his chat, 2026-10-28): "this should
be pulled from the roles set in designflow plm. there should be one place that
holds all the user data/permissions/roles. transfer over user settings in all
apps (crm, Poppim, DAM) to designflow's. Keep user info in the settings of
each app, but it's just a frontend to the true user permissions/roles
functionality in dflow"

## 2. What the applications are

- **DesignFlow PLM** — popcre/designflow-backend (+ frontend, item-master,
  bff, data-syncing). The licensing/product system the ruling names as the
  canonical owner. Runs behind Coolify/auth TBD (Phase 0 inventories this).
- **PopDAM / PopSG** — u2giants/popdam3; one React app, two hostnames
  (dam./sg.designflow.app), Coolify on VPS `hetz`. This repo.
- **PopCRM** — u2giants/popcrm-web. **PopPIM** — u2giants/poppim-web.
- **Shared backend** — Supabase project `qsllyeztdwjgirsysgai`, canonical
  schema in popcre/shared-db. All four app families' RLS reads role rows from
  here TODAY (verified 2026-10-27/28).

## 3. What triggered this work

Albert's 2026-10-28 ruling above, after the 2026-10-27/28 sequence: PopDAM
search outage traced to a stale personal login (#545), fleet PopPIM grants
issued by hand via SQL, a per-user role picker shipped in PopDAM (#566/PR
#568/#569) on top of the CRM admin settings lane's RPCs (shared-db
20261026155023, #4811) — which made it obvious that user administration was
growing per-app instead of living in one place.

## 4. Scope

**In:** DesignFlow canonical user/permission/role model + admin API + admin
UI; migration of the existing user data; converting CRM/PopPIM/PopDAM/PopSG
settings screens into frontends to it; retiring the per-app write paths;
updating the companywide docs (shared-db application map, provisioning docs).

**NOT in this plan:** changing how anyone LOGS IN (Microsoft SSO via Supabase
Auth stays; DesignFlow becomes the authority for authorization data, not
necessarily authentication); migrating business data (customers, items);
per-app feature permissions beyond the existing `app.app_role` tiers and
`app.app_access` apps; DesignFlow's own product features.

## 5. Current state of the code (verified 2026-10-27/28, this session)

- **The physical store is already single:** `app.profile`, `app.user_role`,
  `app.app_access` in the shared Supabase DB (shared-db 20260621150815).
  RLS everywhere evaluates `app.has_role` / `app.has_any_role` /
  `app.has_app_access` against these tables (20260621151155:285-349,
  20260723223000). Verified live under real user claims.
- **Management surfaces (all writing the same tables):**
  - CRM: popcrm-web admin Settings (shared-db #4811, migration
    20261026155023): `api.crm_admin_user_directory`,
    `api.crm_admin_set_user_roles`, `set_app_access`, `set_user_status`,
    role list, access history; browser admin JWT, `administrator`-gated,
    last-admin invariant with advisory lock.
  - PopDAM: Settings → General → Active Users picker (PR #568/#569, live
    2026-10-28) calling the SAME CRM RPCs from
    `src/pages/settings/UsersAndInvitations.tsx` (DAM) and
    `src/components/settings/UsersTab.tsx` (PopSG renders this one).
  - PopPIM: no user UI found this session (verify in Phase 0).
  - Legacy per-app axes: `public.profiles`/`public.user_roles`/
    `public.app_access` (PopDAM login gate, admin chrome; the signup hook
    `app.handle_new_auth_user` auto-grants crm+dam; provisioning doc
    docs/popdam-access-provisioning.md documents all three axes).
- **Auth:** Microsoft SSO (azure) via Supabase Auth for staff; 24 SSO
  employees hold `pm` (granted 2026-10-27, #545); `designflow` app family
  shares the same backend (shared-db AGENTS: "CRM, DAM, PM/PIM, and PLM").
- **Not started:** any DesignFlow-side user administration (Phase 0 confirms).

## 6. Key findings and root cause

- The RLS model is DB-local by design: policies call `app.has_any_role(...)`
  at query time. **Any canonical DesignFlow store must materialize into
  `app.*` tables (or replace them) or every app's row-level security breaks.**
  This is the central constraint of the whole migration.
- Roles tiers today: `administrator, sales, licensing, designer, viewer,
  vendor` (`app.app_role`); apps: `dam, crm, pm, plm, admin` (`app.app_name`).
- The just-shipped RPC lane already implements every hard part once:
  directory, single-role set, last-admin invariant, revoked-history
  preservation, audit listing (20261026155023 + this session's live proof on
  #566). DesignFlow can adopt/own these semantics instead of reinventing.
- Duplicate near-identical Users components exist across apps (e.g. PopDAM has
  TWO: `UsersAndInvitations.tsx` rendered on DAM, `UsersTab.tsx` rendered on
  PopSG — the PR #568 misplacement proved it). Any "frontend to dflow" work
  should extract ONE shared users-frontend component per app family, not
  patch duplicates.

## 7. Approaches considered and REJECTED

- **Each app keeps its own user store, synced from DesignFlow.** Rejected by
  the ruling (one place, not N copies with sync).
- **Apps call DesignFlow's API directly from RLS policies per query.**
  Rejected: RLS is DB-local; per-row HTTP to another service is a latency and
  failure-mode non-starter at 140k+ assets.
- **Replace Supabase Auth / move login to DesignFlow.** Out of scope (ruling
  is about permission/role authority, not login method; revisit only if
  Albert extends it).
- **Keep growing per-app admin lanes (status quo).** Rejected by the ruling;
  also operationally proven messy within 48 hours (#4811 then #566 both built
  UIs over the same RPCs).

## 8. Design decisions

- **LOCKED:** DesignFlow PLM is the canonical authority for
  users/permissions/roles; app Settings screens become frontends; login stays
  Supabase Auth (Microsoft SSO).
- **LOCKED:** RLS keeps evaluating against shared-DB tables — so DesignFlow's
  authority must land in `app.profile`/`app.user_role`/`app.app_access`
  (whether by owning writes to them or syncing into them is the OPEN
  contract question).
- **DECIDED 2026-10-28 — LOCKED (Phase 0 evidence, recorded on popcre/designflow-backend#250): (a) sole-writer.** DesignFlow backend is the only writer of the existing `app.*` role/access rows (`app.user_role`, `app.app_access`) through its own API, adopting the 20261026155023 semantics (directory, single-role set, last-administrator invariant, revoked-history preservation). `app.profile` row creation stays with the Supabase Auth signup hook; DesignFlow may update profile attributes. Rejected (b): Phase 0 showed DesignFlow's platform does not require its own store — it already co-resides on `qsllyeztdwjgirsysgai` (schema `dflow_prod` since 2026-10-17) with shipped `users.app_profile_id` / `Roles.app_role_id` bridges, and (b) would add a sync path with a stale-roles outage failure mode. DesignFlow's own `users`/`Roles`/`user_roles` store stays for PLM-internal features (out of scope, §4); the integer-PK↔UUID mapping runs through `users.app_profile_id`.
- **OPEN:** whether per-app `public.*` legacy axes fold into the canonical
  model or stay as DAM-internal chrome (provisioning doc's three-axis trap
  must not survive the migration for NEW writes).

## 9. The plan — phases and steps

### Phase 0 — Ruling recorded + inventory (no product code)
1. Add the verbatim ruling to popcre/shared-db `docs/owner-rulings.md` and a
   "user administration lives in DesignFlow" row to
   `docs/business-rules/application-map.md` (docs PR, shared-db review lane).
   Gate: PR merged.
2. Inventory DesignFlow backend/frontend auth + any existing user model
   (popcre/designflow-backend; worktree; read-only). Deliverable: short
   findings doc in the master issue naming where DesignFlow auth lives today,
   whether it has any roles store, and its service shape. Gate: findings
   posted; contract decision (§8) made and recorded in the issue.
3. Inventory PopPIM + CRM settings surfaces (screens, RPCs used). Gate:
   findings appended.

### Phase 1 — Canonical model + DesignFlow admin API
4. shared-db claim-first lane: whatever Phase-1 decision requires (either
   re-homing the 20261026155023 RPC semantics under a DesignFlow-owned
   service/schema, or new sync functions + DesignFlow store). Includes
   invitation handling (currently per-app `public.invitations`).
   Gate: migration merged + promoted to production; dockerized rehearsal of
   grant/revoke/invariant like #566's.
5. DesignFlow backend: admin API for directory + set-roles + set-app-access +
   status, `administrator`-gated, audit history. Gate: live API proof with an
   admin tester login (pattern: #566 live proof), tests named in Phase-1 PR.

### Phase 2 — DesignFlow admin UI
6. DesignFlow frontend: user management screen (list, role picker, app
   access, status, access history). Gate: visual proof (screenshot) + a role
   change made in the UI reflected in another app's RLS within the same
   session.

### Phase 3 — App cutovers (one PR per app; each independently shippable)
7. PopDAM/PopSG: point `UsersAndInvitations.tsx` + `UsersTab.tsx` (extract one
   component) at the DesignFlow API; keep read display; writes go to dflow.
   Gate: CI green, deployed, role change via DAM Settings still works (now
   through dflow), PopSG equivalent visually verified.
8. PopCRM: same for its admin Settings. Gate: CRM admin changes a role; PopPIM
   picker reflects it.
9. PopPIM: settings user card as dflow frontend (or link-out if PIM has no
   settings surface — Phase 0 finding decides). Gate per Phase-0 shape.

### Phase 4 — Retire duplicates + docs
10. shared-db: revoke/retire per-app admin write paths that dflow replaced
    (e.g. `api.crm_admin_set_user_roles` execution for non-dflow callers)
    behind the same review lane. Gate: retired-path probe returns refusal
    while dflow path still works.
11. Rewrite docs: shared-db application map + `docs/popdam-access-provisioning.md`
    (three-axis doc becomes "axes are dflow-managed"), app AGENTS pointers.
    Gate: docs PR merged; doc-safety pass.

**Adversarial cases (trust boundary — every external input, hostile case, test):**

| Input | Hostile case | Test |
|---|---|---|
| dflow set-role call | caller not administrator | API refuses (unit + live probe like #566) |
| set-role on last admin | fleet lockout | invariant refusal (contract test, replay 20261026155023 pattern) |
| concurrent role writes | two writers race | advisory-lock serialization test (docker rehearsal) |
| app frontend session | expired/foreign-app token | picker hides/errors safely (component test + live) |
| sync path (if §8 b chosen) | dflow outage | stale-roles fail-closed test; alerting gate |
| invitation creation | duplicate/grant escalation | shared-db contract test |

## 10. Tests required

- shared-db: contract/rehearsal suite for the canonical write path (mirror of
  this session's `.rpc-tests` pattern; committed under `supabase/tests/`).
- DesignFlow backend: unit tests per admin endpoint (authz, invariant, audit).
- Each app frontend: component test that the settings card renders from dflow
  data and that a failed dflow call degrades to read-only (pattern: PopDAM
  `UsersAndInvitations` session-gated query tests).
- Existing suites stay green: `npm run typecheck`, `npm run lint`, `vitest`
  (popdam), CRM/PIM equivalents, shared-db `scripts/check-sql.sh`.

## 11. Constraints, standing rules, gotchas

- All DB structure changes ONLY via popcre/shared-db claim-first lane
  (branch + PR + review + preview + promotion). Never app-repo migrations.
- shared-db is the one repo requiring AI review; observation-week send with
  `--detach`, read with `ai-review outcome`.
- Production DB writes need `ai-task-gates check --before database` with a
  lifecycle-recorded final-check APPROVE (mode matters: plan-review does NOT
  satisfy the database gate — discovered the hard way 2026-10-27).
- Never touch `auth.users` writes without explicit owner authorization
  (2026-10-27 precedent).
- PII: shared-db repo files reference people by UUID (§6.14); email↔UUID
  mappings live in app repos' records.
- The `dam` schema is not PostgREST-exposed; `app` tables aren't either —
  only `api`/`core`/`public` RPCs are callable (verified live 2026-10-28).
- UI work: verify visually; two duplicate Users components in popdam (see §6).

## 12. Access and environment

- Supabase prod: project `qsllyeztdwjgirsysgai`; DB password 1Password vault
  `vibe_coding` item "Supabase DB Password - shared POP database"; pooler
  `aws-1-us-east-1.pooler.supabase.com:6543` user
  `postgres.qsllyeztdwjgirsysgai`.
- Admin tester: 1Password `vibe_coding` "DAM AI tester login - PopDAM
  (administrator, dam.designflow.app, production)".
- DesignFlow repos: popcre/designflow-backend (-frontend, -item-master,
  -bff, -data-syncing); "DesignFlow production DB secret approval gate" item
  exists in the vault — Phase 0 maps which env it guards.
- Apps deploy: popdam via PR→main→GHCR→Coolify (auto on merge); Railway
  worker auto; edge functions via deploy-supabase.yml.

## 13. Definition of done + risks

Done when: one role/permission change made in DesignFlow reflects in
CRM+PopPIM+PopDAM/PopSG with no per-app write paths left; adversarial table
rows all name passing tests; docs rewritten; live proof recorded on the
master issue (screenshot of dflow UI + an app reflecting the change);
per-phase STATUS rows cite artifacts.

Risks: RLS/latency if contract §8(b) chosen; dflow becoming a single point of
failure for admin writes (mitigate: dflow down ⇒ apps read-only, never
lockout — RLS keeps last-known roles); scope creep into authentication
(resist — locked out); three-axis legacy confusion during transition (mitigate:
phase order retires writes before docs claim singularity).

Open questions: §8 contract choice; PopPIM's existing surface (Phase 0);
whether `public.*` axes fold in (Phase 1).

---

**Self-audit (mandatory gate):**
1. Fresh session executable without questions? Yes — §5 carries the verified
   current state with file names, §9 names files/gates per step, §12 gives
   access locations; the one unknown (dflow internals) is itself Phase-0 step
   2 with a deliverable, so the plan handles it structurally rather than
   assuming.
2. All background carried? Yes — ruling verbatim (§1), rejected approaches
   (§7), locked/open decisions (§8), this week's sequence that triggered it
   (§3), and the hard-won gate/mode lessons (§11).
3. Goal clear enough to steer by? Yes — §1 states the end state in business
   terms with the "goal wins" instruction; Phase gates are phrased as
   observable outcomes, not tasks.
