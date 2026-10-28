---
issue: 250
status: OPEN
owner: zcode (this session's successor — any session; claim-first)
---

# Open plan: consolidate user/permissions/roles into DesignFlow PLM

All file references are GitHub URLs. Verified state at 2026-10-28 ~11:30 AM EDT.

## 1. What this is and why

Albert ruled (verbatim, his chat, 2026-10-28): "this should be pulled from the
roles set in designflow plm. there should be one place that holds all the user
data/permissions/roles. transfer over user settings in all apps (crm, Poppim,
DAM) to designflow's. Keep user info in the settings of each app, but it's just
a frontend to the true user permissions/roles functionality in dflow"

DesignFlow PLM becomes the single source of truth for users, permissions, and
roles across CRM, PopPIM, PopDAM/PopSG. Each app's Settings keeps a user card
that is only a frontend to DesignFlow.

## 2. The plan document (read FIRST — its STATUS table is authoritative)

https://github.com/u2giants/popdam3/blob/main/plan_user_permissions_designflow_cutover.md

Master issue (phase checkboxes + ruling):
https://github.com/popcre/designflow-backend/issues/250

## 3. What is already DONE (verified)

- PopPIM (`pm`) access granted to all 24 Microsoft-SSO @popcre.com employees,
  2026-10-27 3:07 PM EDT; record:
  https://github.com/u2giants/popdam3/blob/main/docs/access-records/2026-10-27-poppim-pm-access-all-employees.md
  (PR #558, commit 1549c634). Issue https://github.com/u2giants/popdam3/issues/545
  carries full evidence; live-proof checkbox still open.
- Two revoked personal logins force-signed-out 2026-10-27 4:22 PM EDT (owner
  authorized; 81 tokens / 5 sessions; record on #545).
- Per-user role picker LIVE on both sites: dam.designflow.app and
  sg.designflow.app → Settings → General tab → Active Users card (PRs
  https://github.com/u2giants/popdam3/pull/568 and
  https://github.com/u2giants/popdam3/pull/569, deployed and live-verified
  2026-10-28). It calls the existing administrator-gated shared RPCs
  `api.crm_admin_user_directory` / `api.crm_admin_set_user_roles`
  (shared-db migration 20261026155023, issue
  https://github.com/popcre/shared-db/issues/4811).
- Implementation plan + this handoff merged (PR
  https://github.com/u2giants/popdam3/pull/571).

## 4. Owner decisions already made (do not re-ask)

- Role tier per user is picked in the UI (not a blanket tier).
- mcardoso@popcre.com and vbarot@popcre.com get NO PopPIM (no Microsoft SSO
  identity).
- Sign-out authorization for revoked logins is given case-by-case by Albert.

## 5. Exact next actions (Phase 0 of the plan)

1. Record the ruling verbatim in
   https://github.com/popcre/shared-db/blob/main/docs/owner-rulings.md and add
   a "user administration lives in DesignFlow" row to
   https://github.com/popcre/shared-db/blob/main/docs/business-rules/application-map.md
   (docs PR, shared-db review lane).
2. Inventory DesignFlow backend/frontend auth + any existing user model
   (popcre/designflow-backend, read-only) and post findings on
   https://github.com/popcre/designflow-backend/issues/250.
3. Inventory PopPIM/CRM settings surfaces; then decide the Phase-1 ownership
   contract (sole-writer vs owned-store+sync) and record it on #250.

## 6. What we tried that did NOT work (mandatory reading)

- Do NOT put admin RPCs in the `app` schema: `app` tables/functions are not
  reliably PostgREST-callable; the working pattern is `api`-schema
  security-definer functions (proved by 20261026155023 and live calls).
- A plan-review APPROVE does NOT satisfy `ai-task-gates check --before
  database` — only final-check/security-review modes bind (cost hours on
  2026-10-27).
- The popdam repo has TWO near-duplicate Users components:
  src/pages/settings/UsersAndInvitations.tsx (rendered on dam) and
  src/components/settings/UsersTab.tsx (rendered on sg). PR #568 initially
  edited only the second — always check which one renders where.
- Blanket role-tier grants were rejected by the reviewer as ask-first; Albert
  then chose per-user UI picking instead.

## 7. Facts that may be stale by the time you read this

- Live checkers/bundle names verified 2026-10-28 ~10:40 AM EDT.
- shared-db main tip and max migration version move hourly; re-fetch.
- The 8 role-less staff (amanoel, asilva, ftello, jmelho, umeka, vavouac,
  yzhou, zcalderon) still show "No role" until someone sets them.

## 8. Access (locations only, never values)

- Supabase prod DB: 1Password vault `vibe_coding`, item "Supabase DB Password -
  shared POP database"; pooler aws-1-us-east-1.pooler.supabase.com:5432/6543,
  user postgres.qsllyeztdwjgirsysgai.
- Admin tester: vault `vibe_coding`, item "DAM AI tester login - PopDAM
  (administrator, dam.designflow.app, production)".
- DesignFlow prod secret gate: vault item "DesignFlow production DB secret
  approval gate".

## 9. Standing constraints

- DB structure only via popcre/shared-db claim-first lane (branch, PR, review,
  preview, promotion). shared-db is the one repo requiring AI review
  (observation week: send --detach, read ai-review outcome).
- Production DB writes need `ai-task-gates check --before database` with a
  lifecycle-recorded final-check APPROVE.
- No auth.users writes without Albert's explicit authorization.
- shared-db repo files: UUID-only person references (PII ruling §6.14).
