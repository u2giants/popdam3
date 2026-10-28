---
issue: 250
status: OPEN
owner: mimo/user-admin-dflow-phase1 (successor: any session; claim-first for the DB half)
---

# Phase 0 DONE — Phase 1 next: DesignFlow becomes the sole writer of user roles/app access

All file references are GitHub URLs. Verified state at 2026-10-28 2:20 PM EDT
(2026-10-28T18:20Z). Machine: edge-dev. Session: MiMo.

This file supersedes `HANDOFF.d/2026-10-28T15Z-hetz-zcode-user-permissions-dflow-plan.md`
(the predecessor plan handoff — its three "exact next actions" were all executed
this session; that file is retired in the same PR as this one, and its dead ends
are carried forward in §4/§7 below).

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**Instruct the next session to put the whole business-question list to Albert in
ONE message before starting work — not one at a time.**

### Blocking — nothing. Phase 1 can start without Albert.

### A wrong guess is recoverable (answer with one word; recommendation given)

- **Do the three legacy access axes (`public.profiles` / `public.user_roles` /
  `public.app_access`) fold into the canonical DesignFlow-managed model, or stay
  as DAM-internal chrome?** Recommendation: **fold** — make them read-only
  legacy after Phase 3 and stop all new writes to them (the plan already forbids
  the three-axis trap for new writes). Blocks: Phase-1 migration scope (whether
  a small legacy-axes retirement belongs in it) and the Phase-4 docs rewrite.
  A successor may proceed on the recommendation if Albert does not answer; the
  choice only affects cleanup timing, not correctness.

### Not part of this workstream, nobody on it

- None discovered. (Eight staff with no role set — see §9 — is delegated
  already: roles are picked per user in the Settings UI by any administrator,
  per the settled policy below. Not an owner question.)

### Already settled — do NOT re-ask (dates are 2026-10-28 unless noted)

- **Ownership contract is LOCKED: (a) sole-writer on the existing `app.*` rows.**
  DesignFlow is the only writer of `app.user_role` + `app.app_access`
  (semantics of shared-db migration 20261026155023); `app.profile` row creation
  stays with the Supabase Auth signup hook. Evidence and reasoning:
  https://github.com/popcre/designflow-backend/issues/250 (comment of 2026-10-28,
  "Phase-1 ownership contract — DECIDED AND LOCKED"). Recorded in the plan §8:
  https://github.com/u2giants/popdam3/blob/main/plan_user_permissions_designflow_cutover.md
- **Roles are picked per user in the UI, not a blanket tier** (Albert, prior session).
- **mcardoso and vbarot get no PopPIM** (no Microsoft SSO identity). Emails live
  in app-repo records only; shared-db files reference people by UUID (PII ruling
  https://github.com/popcre/shared-db/blob/main/docs/owner-rulings.md §6.14).
- **Sign-outs of revoked logins need case-by-case approval from Albert** (prior session).
- **Login does not move:** Microsoft SSO via Supabase Auth stays. The ruling is
  about who OWNS authorization data, not authentication. Never write `auth.users`
  without Albert's explicit authorization (2026-10-27 precedent).
- **The owner ruling itself** (verbatim, Albert's chat, 2026-10-28) is recorded
  as §6.33: https://github.com/popcre/shared-db/blob/main/docs/owner-rulings.md

## 1. What this application is

POP Creations runs four application families on one shared Supabase project
(`qsllyeztdwjgirsysgai`): **PopCRM** (https://github.com/u2giants/popcrm-web),
**PopPIM / PM** (https://github.com/u2giants/poppim-web), **PopDAM / PopSG**
(one React app, two hostnames dam./sg.designflow.app, https://github.com/u2giants/popdam3),
and **DesignFlow PLM** (the licensing/product system: six `popcre/designflow-*`
repos — backend, frontend, bff, item-master, tracking, data-syncing; live at
alsand.designflow.app sandbox, GCP Cloud Run + Cloud Build, GCP project
`lithe-breaker-323913`). All four families' row-level security already reads one
physical user store: `app.profile` / `app.user_role` / `app.app_access` in the
shared Supabase DB. Login is Microsoft SSO via Supabase Auth for all browser apps.
DesignFlow's own runtime database (schemas `dflow`/`dflow_prod`) also lives on the
same Supabase project since 2026-10-17.

## 2. What we set out to do this session, and why

Albert ruled (verbatim, 2026-10-28): "this should be pulled from the roles set in
designflow plm. there should be one place that holds all the user
data/permissions/roles. transfer over user settings in all apps (crm, Poppim, DAM)
to designflow's. Keep user info in the settings of each app, but it's just a
frontend to the true user permissions/roles functionality in dflow".

The task: execute **Phase 0** of the cutover plan (record the ruling in shared-db
docs; inventory DesignFlow backend/frontend; inventory PopPIM/CRM settings
surfaces; decide + record the Phase-1 ownership contract), update the plan STATUS
table, then continue into **Phase 1**. Master issue:
https://github.com/popcre/designflow-backend/issues/250 . Plan (read its STATUS
table first):
https://github.com/u2giants/popdam3/blob/main/plan_user_permissions_designflow_cutover.md

## 3. Current state — what is true right now

**Phase 0 is COMPLETE and verified. Phase 1 is NOT STARTED** (only read-only
investigation happened; no shared-db claim, no migration file, no DesignFlow
code change).

Artifacts (all merged/posted):

1. **Ruling recorded.** shared-db PR https://github.com/popcre/shared-db/pull/4967
   MERGED 2026-10-28 12:36 PM EDT (merge commit
   https://github.com/popcre/shared-db/commit/39501956aece0c8a00cf341f9a0b8f90149bc1e7):
   `docs/owner-rulings.md` §6.33 (verbatim ruling + effect) and the
   "user administration lives in DesignFlow" row in
   `docs/business-rules/application-map.md`.
2. **DesignFlow inventory** posted on #250 (comment 6474541599):
   https://github.com/popcre/designflow-backend/issues/250#issuecomment-6474541599
   — key facts: DesignFlow has its OWN auth (Azure AD → `POST /auth/azure` →
   self-signed RS256 JWT) and its OWN substantial roles store (`users`,
   hierarchical `Roles`, `user_roles`, legacy `Roles`/`RolePermissions`/
   `UIElements`) with a working admin UI ("Manage users", "Roles & Access") and
   admin API (`PUT /users/:id/roles` etc.). Its production runtime
   (`designflow_prod_backend_runtime`, schema `dflow_prod`) co-resides on
   `qsllyeztdwjgirsysgai` but "does not read plm, core, or app". Shipped-but-
   unpopulated identity bridges: `users.app_profile_id → app.profile`,
   `Roles.app_role_id → app.role`.
3. **PopPIM + PopCRM inventory** posted on #250 (comment 6474551719):
   https://github.com/popcre/designflow-backend/issues/250#issuecomment-6474551719
   — PopPIM has NO user-management UI (Settings placeholder cards only; admin
   gate is a client regex on role name); PopCRM has one read-only "Impersonate /
   view as" directory dialog (RPC `api.crm_admin_user_list`); NEITHER writes
   roles/access; both apps' generated types predate migration 20261026155023.
   Only PopDAM/PopSG has a live user admin UI today (the per-user role picker).
4. **Phase-1 ownership contract DECIDED and LOCKED** in the same #250 comment:
   (a) sole-writer on `app.user_role` + `app.app_access` via DesignFlow's admin
   API, adopting the 20261026155023 semantics (directory, single-role set,
   last-administrator invariant, revoked-history preservation); `app.profile`
   creation stays with the signup hook. Rejected (b) owned-store+materialization:
   the platform does not require a separate store (co-residence + bridges
   already shipped) and (b) adds a stale-roles sync failure mode.
5. **Plan STATUS updated** (steps 0–1 ✅ with artifact citations, §8 marked
   DECIDED/LOCKED): popdam3 PR https://github.com/u2giants/popdam3/pull/574
   MERGED 2026-10-28 12:43 PM EDT (merge commit
   https://github.com/u2giants/popdam3/commit/a3303b43fb787b7dad35d0b213bb2bf08dd123a2).

**Phase-1 design sketch (this session's analysis — NOT reviewed, the successor
must validate it with the assigned reviewer before authoring):** the existing
`api.crm_admin_*` functions are security-definer, gated by
`coalesce(app.has_role('administrator'), false)`, which resolves the caller via
`app.current_profile_id()` (JWT-derived — see
https://github.com/popcre/shared-db/blob/main/supabase/migrations/20260621150815_app_core.sql#L365-L381),
and they set `v_actor := app.current_profile_id()` for the self-revoke guard and
`granted_by_profile_id`. A DesignFlow service connection has no JWT, so the
minimal re-home is: (i) extend each write function's gate to also accept a
trusted service caller (DesignFlow runtime role), (ii) add an optional actor
parameter (fallback to `app.current_profile_id()`), (iii) when called by the
service, REQUIRE the named actor to actually hold the active `administrator`
grant in `app.user_role` (so DesignFlow cannot skip its own admin gate), (iv)
grant EXECUTE to the DesignFlow runtime role, (v) leave every invariant
(unknown slugs, self-revoke, last-administrator, advisory lock
`api.crm_admin_access_invariant`, revoked-history soft grants) exactly as-is.
Phase 4 then retires the `authenticated` grants so only DesignFlow can call.
Functions to touch (exact-object claim list):
`api.crm_admin_role_list`, `api.crm_admin_user_directory`,
`api.crm_admin_set_user_roles`, `api.crm_admin_set_app_access`,
`api.crm_admin_set_user_status`, `api.crm_admin_access_history`. Do NOT touch
`api.crm_admin_assign_departments` / `api.crm_admin_department_assignments`
(CRM-organization scope, not user roles). Source migration to read first:
https://github.com/popcre/shared-db/blob/main/supabase/migrations/20261026155023_crm_admin_settings_rpcs.sql

**Not started:** Phase 1 DB migration, DesignFlow admin API for cross-app
roles/access, Phase 2 UI work, app cutovers (Phase 3), write-path retirement
(Phase 4). Nothing was applied to preview or to production this session (no
migration exists).

## 4. Everything we tried that did NOT work (mandatory reading)

1. **`ai-review muse diff-review --detach` on the shared-db docs PR was REFUSED
   before starting** (`ai-review: no reviewer was started`): the gate said
   `"review" is not a gate for a "prose" change in popcre/shared-db.
   Required gates for this class: <none>`. Do not try to route docs-only
   shared-db PRs through the reviewer rotation; the documents-only lane is the
   review lane there. (Full log under
   `~/.local/state/ai-devops/review-detached/d20261028T162309-98322-14208.log`
   on edge-dev.)
2. **Entire Gates (external `entire.com` review-trail GitHub App) failed** on
   both PRs with "Approvals: failed — No reviewers have approved this trail"
   (e.g. https://entire.com/gh/popcre/-/trails/68/changes/shared-db/59). No
   Entire account or credential exists in the `vibe_coding` vault, and no tool
   can approve a trail. Crucially, **it is NOT a required status check** (the
   shared-db branch-protection required list does not include it; popdam3 has no
   branch protection at all) and **shared-db#4967 merged through the normal
   merge queue with Entire Gates red**. The predecessor session parked PR #4916
   over this gate — that is no longer necessary; let the check fail and merge on
   the real checks. (If a future PR is ejected from the merge queue, verify WHICH
   check failed before blaming Entire.)
3. **First merge-queue attempt ejected PR #4967** (`removed_from_merge_queue` at
   2026-10-28 12:27 PM EDT). Cause was NOT the docs and NOT Entire: the
   `Database Contract Tests` job "Start an empty ephemeral database" failed with
   `failed to bind host port for 0.0.0.0:54322 ... address already in use` — a
   hosted-runner Docker flake whose own error text says "NOT a fault in the
   change under review". Fix: re-enqueue (`gh pr merge <n> --auto`) and the next
   queue run passes.
4. **`bash scripts/check-sql.sh` on Windows resolves `bash` to WSL** ("Windows
   Subsystem for Linux has no installed distributions"). Use the Git Bash
   explicitly: `"C:\Program Files\Git\bin\bash.exe" scripts/check-sql.sh` —
   passes (exit 0) for this docs-only change with 0 added migrations.
5. **`gh pr merge --squash` on a merge-queue repo** returns "The merge strategy
   for main is set by the merge queue". Use `gh pr merge <n> --auto` (no
   strategy flag) to enter/observe the queue. Also `gh pr view --json merged` is
   invalid — use `mergedAt`.
6. **`rg` with a Windows glob in the path** (`...\migrations\*.sql`) fails with
   an IO error; use `rg -g "*.sql" <dir>` instead.
7. **`ai-shared-db-closeout-check` returned `ok:false "GitHub request timed out"`**
   several times at closeout (2026-10-28 ~2:20 PM EDT). The tool fails closed on
   unreadable APIs by design; retry before interpreting. If it still fails, the
   wrap-up must report the check as blocked, never as passed. This session never
   issued any claim or stage operation (no `manage-migration-author-lanes` claim,
   no preview/merge/production stage), so the expected result is zero owned
   reservations.

## 5. Root causes and key findings

- **DesignFlow already has a full users/roles/admin stack of its own** (integer-PK
  `users` table read by 14+ services; hierarchical role tree hardcoded in
  `helpers/roleResolver.js`; admin UI at `apps/admin/users` + `apps/admin/roles`).
  "One place" therefore means DesignFlow gains authority over the CROSS-APP rows
  (`app.user_role`, `app.app_access`), while its PLM-internal role model stays
  (out of scope per plan §4). Do not attempt to merge `dflow.users` into
  `app.profile` — explicitly out of scope in the Supabase cutover plan
  (https://github.com/popcre/designflow-backend/blob/sandbox-albert/shared-db/docs/designflow-cloudsql-to-supabase-plan.md).
- **The DB gate must stay in the functions.** The `20261026155023` functions
  carry the last-administrator invariant, self-revoke guard, unknown-slug
  rejection and the `pg_advisory_xact_lock(hashtext('api.crm_admin_access_invariant'))`
  serialization. Any DesignFlow write path must go through them (or a re-home
  that keeps those bodies) — reimplementing them in JavaScript would give the
  fleet two drifting copies of the invariant.
- **RLS is DB-local and non-negotiable** (plan §8 LOCKED): every app's policies
  call `app.has_role` / `app.has_app_access` against `app.*` at query time. Any
  authority DesignFlow builds must land in those rows; per-row HTTP to another
  service from RLS is a non-starter at 140k+ assets.
- **`app.has_role` has a JWT escape hatch** — it also returns true when the
  required role is in `app.jwt_role_names()` (JWT app_metadata). The
  `20261026155023` last-admin check deliberately counts only database grants
  ("Fail closed: counts database grants only"). Keep that distinction when
  touching these functions.
- **popdam3 has TWO near-duplicate Users components**: `src/pages/settings/
  UsersAndInvitations.tsx` renders on DAM, `src/components/settings/UsersTab.tsx`
  renders on PopSG (PR #568 initially edited only the second). Always verify
  which renders where before editing (Phase 3 will extract ONE shared component).
- **The `api` schema is the working RPC home.** `app` schema tables/functions are
  not PostgREST-exposed; browser clients call `api.*` security-definer functions
  gated to `authenticated`. DesignFlow connects over plain Postgres (Sequelize),
  so it needs grants + a trusted-caller gate path, not PostgREST exposure.
- **shared-db docs-only PRs merge fast**: `Documents-only merge authorization`
  passes in seconds ("Prose-only head verified under the
  coordination/production-freeze mutex"), `ai-task-gates check --before ship`
  says `ship may start for effective class "prose"` and does not inspect the PR
  itself ("not checked by this tool: repository-branch-and-pr").

## 6. Exact next steps (Phase 1 — in order)

1. **shared-db claim-first lane — DB half.** Create ONE shared-db work issue for
   the Phase-1 structural change with `route: claim-first`, linking
   https://github.com/popcre/designflow-backend/issues/250 as the application
   need (do not open per-phase tickets; do not reuse an unrelated issue). Claim
   the exact objects listed in §3. Declare `SHARED_DB_AUTHOR_ENGINE=mimo`
   (lane tooling refuses without it). Reserve the migration version via
   `scripts/manage-migration-author-lanes.mjs` in a fresh worktree cut from
   `origin/main` (worktree-only rule). *You'll know it worked when* the issue
   shows the object claim and the lane tool returns a reserved version.
2. **Author the migration** per the §3 sketch (gate extension + optional actor
   parameter + service grants; invariants untouched; additive only;
   `-- derived-from: none` header line). Run `"C:\Program Files\Git\bin\bash.exe"
   scripts/check-sql.sh` and the repo test commands. *You'll know it worked when*
   check-sql.sh exits 0 and the contract tests pass locally.
3. **Review → merge → preview → promotion** through the normal shared-db lane
   (observation week: `ai-review <muse|deepseek> <mode> --detach --implementer
   mimo`, then `ai-review outcome <id>`; reviewer must differ from the
   implementer engine). `ai-task-gates check --before database` needs a
   lifecycle-recorded **final-check** APPROVE — a plan-review APPROVE does NOT
   bind it. Include the dockerized grant/revoke/invariant rehearsal the way
   popdam3#566 did. *You'll know it worked when* the migration is promoted to
   production and the rehearsal evidence is attached to the issue.
4. **DesignFlow admin API (designflow-backend, branch `sandbox-albert`).**
   Directory / set-roles / set-app-access / status endpoints behind the
   `administrator` gate with audit history, calling the re-homed functions with
   the acting admin's profile id. Unit tests per endpoint (authz, invariant,
   audit). Note: pushing `sandbox-albert` auto-deploys to
   https://alsand.designflow.app via Cloud Build. *You'll know it worked when* a
   live API call with an administrator login changes a role and the change is
   visible through `app.user_role`.
5. **Phase 2** (DesignFlow admin UI: extend the existing *Manage users* screen
   with the cross-app role + app-access picker — do not rebuild), then **Phase 3**
   app cutovers (DAM/SG repoint the picker; CRM repoint its directory dialog;
   PIM build into the Settings placeholder cards), then **Phase 4** (retire
   `authenticated` execution of the write RPCs; rewrite
   `docs/popdam-access-provisioning.md` and the application map). All per the
   plan's gates:
   https://github.com/u2giants/popdam3/blob/main/plan_user_permissions_designflow_cutover.md
6. **Deferred small docs item:** the header of
   https://github.com/popcre/shared-db/blob/main/docs/owner-rulings.md says
   "add one index line to `AGENTS.md`" when adding a ruling; this session added
   only the Index row inside owner-rulings.md itself (recent rulings 6.28–6.32
   did the same — the AGENTS.md "one line each" list is curated, not
   exhaustive). If a future session wants strict conformity, add a §6.33 line to
   AGENTS.md's ruling list — but note AGENTS.md is classified as a rulebook (not
   prose), so that edit forces the full CI path on whatever PR carries it.

## 7. Constraints and gotchas in force

- **DB structure changes ONLY via popcre/shared-db claim-first lane** (branch,
  PR, review, preview, promotion). Reviewer must differ from implementer
  (`ai-review --implementer mimo`; muse + deepseek in rotation).
- **`ai-task-gates check --before database` requires a lifecycle-recorded
  final-check APPROVE.** A plan-review APPROVE does NOT bind the database gate
  (learned 2026-10-27 the hard way).
- **Never write `auth.users`** without Albert's explicit authorization.
- **shared-db files reference people by UUID only** (PII ruling §6.14); email↔UUID
  mappings live in app repos' records.
- **popdam3 has TWO Users components** — `UsersAndInvitations.tsx` (DAM) and
  `UsersTab.tsx` (PopSG). Verify which renders where before editing.
- **App tables are NOT PostgREST-exposed**; admin functions live in the `api`
  schema (security definer, gated).
- **shared-db worktree-only:** every session works in its own `git worktree` cut
  from `origin/main`; the shared checkout is for reading and fetch only.
- **Observation week (window file #1948):** send reviews with `--detach`, read
  with `ai-review outcome`; never retry a failed/skipped reviewer this session;
  log reviewer failures with `ai-reviewer-issue`.
- **Docs-only shared-db PRs merge promptly through the merge queue** (§5 +
  §6.24); never `--admin`. The Entire Gates external check is not required —
  see §4.2.
- **dflow repos (the six `popcre/designflow-*`):** work ONLY on
  `sandbox-albert`, pull from `develop`, never touch `main`, never merge PRs
  there (Uma, `devopswithkube`, reviews them). AG-Grid work follows
  `search_docs` in the AG-Grid MCP (theming API only). Commit author must be
  `Albert Hazan <u2giants@users.noreply.github.com>`.
- **Do not assume dflow is on Supabase** — it is, since 2026-10-17, but only via
  its own `dflow`/`dflow_prod` schemas and its own runtime user; it does not
  read `plm`/`core`/`app` yet.

## 8. Access and environment

- Supabase prod: project `qsllyeztdwjgirsysgai`; DB password is 1Password vault
  `vibe_coding`, item "Supabase DB Password - shared POP database" (pooler
  `aws-1-us-east-1.pooler.supabase.com:6543`, user
  `postgres.qsllyeztdwjgirsysgai`). Never put values in chat/files.
- Admin tester: vault `vibe_coding`, item "DAM AI tester login - PopDAM
  (administrator, dam.designflow.app, production)" — for live proofs on DAM/SG.
- DesignFlow prod secret gate: vault `vibe_coding`, item "DesignFlow production
  DB secret approval gate".
- `gh` CLI is authenticated on edge-dev. Toolkit commands
  (`ai-task-gates`, `ai-review`, `ai-shared-db-closeout-check`,
  `ai-housekeeping`) are installed under the user's local bin.
- Shared-db main tip was `a995e6791` and max migrations
  `20261028130227_master_data_autoflow_prefill.sql`,
  `20261028143646_dam_image_embed_stale_covering_indexes.sql` at
  2026-10-28 2:20 PM EDT — both move hourly; re-fetch before relying on them.
- This session's shared-db worktree (`.claude/worktrees/250-user-admin-dflow-docs`,
  branch `mimo/250-user-admin-dflow-docs`) and popdam3 worktree
  (branch `mimo/250-plan-status-update`, `mimo/250-phase1-handoff`) were retired
  at closeout after their PRs merged — see the closing report.

## 9. Open questions and risks

- **`public.*` legacy axes** — fold in or keep as DAM-internal chrome (§0 item;
  recommendation: fold, read-only after Phase 3).
- **Service-caller gate design** (§3 sketch) is unreviewed. Risks: a trusted-
  caller bypass that skips the administrator check (mitigated by re-checking the
  named actor's grant inside the function); `session_user` vs `current_user`
  semantics inside `SECURITY DEFINER` functions (verify which identifier the
  gate can trust before writing the SQL).
- **Two role vocabularies** will coexist in DesignFlow's admin UI after Phase 2:
  the PLM-internal role tree (super/category/leaf) and the cross-app
  `app.app_role` tier (administrator/sales/licensing/designer/viewer/vendor).
  Phase 2 UI must label them distinctly; the ruling's "roles set in designflow
  plm" refers to the cross-app tier that RLS consumes.
- **Eight staff still show "No role"** (amanoel, asilva, ftello, jmelho, umeka,
  vavouac, yzhou, zcalderon — names as recorded in app-repo records) until an
  administrator sets them in the existing DAM/SG picker. Operational, not a
  blocker.
- **Entire Gates** keeps failing on PRs that pick up a trail; nobody has an
  account (§4.2). If Entire ever becomes a required check, this workstream is
  blocked until Albert provisions an approver.
- **Concurrent sessions are active in these repos** (a popdam3 checkout sits on
  `fix/dam-search-concept-and-rank` with untracked review-brief files; many
  shared-db worktrees belong to other sessions). Never tidy files you did not
  create.

## Part (b) — sub-agent blocks (this session dispatched two read-only explorers)

### Agent: explore-1 (read-only inventory, DesignFlow auth/roles)
- **Asked to do:** inventory designflow-backend/frontend/bff: where auth lives,
  whether a roles store exists, service shape, Supabase touchpoints, admin API,
  friction for the ownership contract.
- **Actually did:** read-only exploration; no writes. Produced the findings
  posted verbatim (condensed) on
  https://github.com/popcre/designflow-backend/issues/250#issuecomment-6474541599 .
- **Found:** Azure-AD→JWT auth with its own `users`/`Roles`/`user_roles` store;
  existing Manage-users/Roles admin UI and API; `dflow_prod` on the shared
  Supabase project since 2026-10-17 with unpopulated `app_profile_id`/
  `app_role_id` bridges; production runtime does not read `plm`/`core`/`app`;
  `dflow.users` deeply embedded (14+ services).
- **PR / branch:** none (read-only).
- **Worktree:** finished (nothing to clean).
- **Deliberately did NOT do:** no evaluation of DesignFlow's internal role-tree
  semantics vs `app.app_role` mapping (Phase-2 UI concern); did not query the
  live database.

### Agent: explore-2 (read-only inventory, PopPIM/PopCRM settings)
- **Asked to do:** inventory poppim-web and popcrm-web settings/user surfaces,
  RPCs read/written, login/session handling, invitation flows, direct writes to
  user tables.
- **Actually did:** read-only exploration; no writes. Findings posted on
  https://github.com/popcre/designflow-backend/issues/250#issuecomment-6474551719 .
- **Found:** PopPIM has no user UI (Settings placeholder cards; regex admin
  gate); PopCRM has only a read-only impersonation directory
  (`api.crm_admin_user_list`); neither writes roles/access; both types files
  predate 20261026155023; no invitation UIs.
- **PR / branch:** none (read-only).
- **Worktree:** finished (nothing to clean).
- **Deliberately did NOT do:** did not inspect the embedded `shared-db/` test
  fixtures beyond noting they seed user rows (those are DB-side tests, not app
  write paths).

---

## Self-audit (handoff-writer gate)

1. **Could a brand-new developer pick up with no questions?** Yes — §1 orients,
   §3 carries every artifact with GitHub URLs, §4 lists every dead end, §6 gives
   ordered steps with verification gates.
2. **As effective as this session right now?** Yes — §5 carries the non-obvious
   findings (gate mechanics, RLS constraint, dual role vocabularies, two Users
   components) that took this session real time; §3's design sketch transfers
   the in-progress thinking.
3. **Every relevant detail included?** Yes — background (§1–2), state (§3),
   failures (§4), findings (§5), next actions with gates (§6), constraints
   (§7), access (§8), risks (§9), owner decisions consolidated (§0), sub-agent
   work (part b).
4. **Does §0 show every business decision and no technical approval?** Yes — the
   sweep of §1–9 found one business-recoverable item (public.* axes, §9/§0) and
   no others; everything technical is routed to a reviewer, an issue, or
   `Blocked —` (Entire Gates). Already-settled decisions are listed so they are
   not re-asked.
