# HANDOFF — shared-db current state

## DB Data Admin — non-SSO tester login (DONE — 2026-07-23)

Status: **done.** Owner approved "gate to data-dev only" on 2026-07-23. Shipped in
PR #195 (`3d3c434`); tester user created; flag live on data-dev; credential stored in
1Password as **"DB Data Admin AI tester login (data-dev.designflow.app) - non-SSO"**.

### What exists now

| Piece | State |
|---|---|
| `allowPasswordLogin` flag (`config.ts`, `nginx.conf`, `App.tsx`) | Merged in #195. Strict opt-in: only `true` / `"true"` enables it. |
| Coolify env `DB_DATA_ADMIN_ALLOW_PASSWORD_LOGIN=true` | Set on app `v6z1sveur7e32dub1dp3ao4v` (`db-data-admin-development`) **only**. |
| Tester auth user | `ai-tester@data-dev.designflow.app`, auth id `0a55652c-260e-41ac-aa8a-18636bcfab6b`, profile `098e5791-101b-4cf3-8a9e-8efccc2040d7`, Administrator granted. |
| Invitation row | `public.invitations` id `f9b1301f-c1af-421e-8ad0-5c7c896c067e` (required — see gate below). |
| Credential | 1Password vault `vibe_coding`, item `agk4gstcwazitt76evs5r2agvi`. |

Verified: `https://data-dev.designflow.app/config.js` shows `allowPasswordLogin: 'true'`;
the login page renders "Internal testing sign-in" **alongside** (not replacing) the
Microsoft button on build `3d3c434`; password grant returns an access token.
Production `data.designflow.app` has no server running and never received the flag.

### The invitation gate — READ THIS BEFORE RECREATING THE USER

`public.handle_new_user` (trigger on `auth.users`) makes **email/password signup
invitation-only**; only provider `azure` / `authentik` bypasses it. Creating an
email/password user without an invitation row fails with HTTP 500
`{"code":"P0001","message":"Access denied: no valid invitation found for …"}`.
**This is a deliberate guardrail — do not disable or edit the trigger.** Insert an
invitation first:

```sql
insert into public.invitations (email, role, apps)
values ('<email>', 'user', array['popdam']::public.app_name[]);
```

then create the user via the Auth Admin API with `email_confirm: true`, then insert the
`app.user_role` administrator row (the trigger only auto-grants admin to
`u2giants@gmail.com` / `albert@popcre.com`).

### How an AI session should use this credential

Use a 1Password-mediated path so the plaintext password never enters the AI's context.
Two that work:

1. **Browser + 1Password extension** — drive the owner's real Chrome (the
   `claude-in-chrome` tooling) and let the 1Password extension autofill the form.
2. **Programmatic session injection (best for automation)** — exchange the credential
   for a session token with the plaintext redacted, then drive the authenticated app:

   ```
   POST https://rjyboqwcdzcocqgmsyel.supabase.co/auth/v1/token?grant_type=password
   headers: apikey: <branch anon key>
   body:    {"email":"ai-tester@data-dev.designflow.app","password":"<op:// reference>"}
   ```

   Run it through `op_run` with the password supplied as an `op://` reference so the
   value is redacted from the transcript. Then set the returned session into the app's
   Supabase storage key before loading the page.

An earlier revision of this file claimed an AI session "cannot" use this login at all.
That was wrong — what is avoided is handling the plaintext password directly, not using
the credential.

### Original goal (kept for context)

Albert asked for "internal (non-SSO) credentials to `https://data-dev.designflow.app`
for testing purposes," stored in 1Password, so an AI session can log in and drive the UI
(the Multi Filter work shipped this session could not be visually verified for exactly
this reason).

### Why it had to be gated — read before changing it

1. **The app is Microsoft-SSO only.** `apps/db-data-admin/src/App.tsx` offers a single
   auth path: `supabase.auth.signInWithOAuth({ provider: 'azure' })`. There is **no**
   email/password form. A password user therefore cannot log in through the UI until the
   app gains a `signInWithPassword` form — this is an app **code** change, not just a
   user record.
2. **That code change would also reach production.** `data.designflow.app` (production)
   and `data-dev.designflow.app` (development) are built from the **same** codebase and
   the same GHCR image; only the injected `/config.js` differs (see `nginx.conf` →
   `DB_DATA_ADMIN_*` env). Adding a password form without an explicit environment gate
   would open a non-SSO door on **production** DB Data Admin.
3. **data-dev is NOT a throwaway sandbox.** It points at Supabase preview branch
   `rjyboqwcdzcocqgmsyel` (`shared-db-schema-rehearsal`), which the 1Password item
   "Supabase Preview Branch Credentials - shared POP database" documents as a
   *persistent production clone (`with_data=true`)* whose data is
   **"production-sensitive."** DB Data Admin can edit and **merge** records. A password
   credential with an Administrator grant there is effectively production-grade access.

### The design that was built (owner-approved)

- Add an email/password sign-in form **gated behind an explicit runtime flag**
  (e.g. `DB_DATA_ADMIN_ALLOW_PASSWORD_LOGIN`, surfaced through `/config.js` and
  `readConfig()`), set **only** on the data-dev Coolify application. Production stays
  SSO-only and the form never renders there.
- Enable the email provider on branch `rjyboqwcdzcocqgmsyel` only.
- Create one tester user with a long generated password, grant it Administrator, and
  store it in 1Password vault `vibe_coding` with full usage notes.

#### Exact Administrator grant chain (verified against migrations, 2026-07-23)

A Supabase auth user alone is **not** enough — every `db_data_admin_*` RPC ultimately
calls `app.has_role('administrator')`, which resolves through three tables. All of these
rows must exist or the app renders its "Access denied" screen:

1. `auth.users` — the tester user (created via the Admin API with the branch
   service-role key, `email_confirm: true`).
2. `app.profile` — a row with `auth_user_id = <that user's id>` **and
   `status = 'active'`**. `app.current_profile_id()` (`20260621150815_app_core.sql:351`)
   returns nothing without both, and every role check then fails.
3. `app.user_role` — a row joining that `profile_id` to `app.role` where
   `slug = 'administrator'`, with **`revoked_at is null`**
   (`app.has_role`, `20260621150815_app_core.sql:365`).

Definitions: `app.profile` and `app.user_role` in
`supabase/migrations/20260621150815_app_core.sql:12`; the `administrator` role is seeded
at `:340`; the `app.app_role` enum is in `20260621150714_foundation.sql:19`.

Per the shared-db rule, any DDL stays migration-authored — but this is **row data on a
preview branch**, so insert it directly there; do **not** add a migration that seeds a
tester account, and never create this user on production `qsllyeztdwjgirsysgai`.

#### Verification gate (do not report done without these)

1. `GET /config.js` on data-dev shows the password-login flag enabled, and production's
   `/config.js` does **not**.
2. Sign in at `https://data-dev.designflow.app` with the stored credentials and confirm
   the Customers grid renders — not the "Access denied" panel.
3. Confirm the same build on `data.designflow.app` still shows **only** the
   "Sign in with Microsoft" button.

### Access status

Access is **available** — no new credentials need to be requested:
- Preview branch service-role key + Postgres URL: 1Password →
  *"Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)"*.
- Supabase management PAT: 1Password → *"Supabase CLI Personal Access Token"*.
- Note: `rjyboqwcdzcocqgmsyel` is a **branch**, so it does **not** appear in
  `GET https://api.supabase.com/v1/projects`. Do not conclude the token is wrong —
  list branches instead.

### If you need to change this

Never set `DB_DATA_ADMIN_ALLOW_PASSWORD_LOGIN` on the production Coolify app. To revoke
the tester instead of deleting it, set `revoked_at` on its `app.user_role` row, or unset
the Coolify variable and redeploy to remove the form entirely.

## Stage 0 — Safe DAM core licensor/property cutover (ACTIVE — local revision in worktree; not committed/applied)

Date: 2026-07-23 (revised implementation)
Repo: `u2giants/shared-db`
Worktree: `C:\repos\shared-db-worktrees\dam-core-taxonomy-safe-cutover-stage0`
Branch: `fix/dam-core-taxonomy-safe-cutover-stage0` (one commit behind main `a90846c` DB Data Admin domain reservation — do not overwrite that commit; port accepted changes onto a fresh `codex/*` branch after review)

**Stage 0 is NOT “repo-side done for production” until unit tests pass and a
later session lands the branch.** This coding pass revises an unacceptable
first draft: DDL must be migration-authored; the Node tool is DML-only.

### 1. What this application is

PopDAM is POP Creations’ internal digital-asset library (`dam.designflow.app`).
PopSG is its licensor style-guide mode (`sg.designflow.app`). Both apps, plus
CRM and PM/PIM, share one hosted Supabase Postgres project:

| Env | Project ref |
|---|---|
| Production | `qsllyeztdwjgirsysgai` |
| Preview (`shared-db-schema-rehearsal`) | `rjyboqwcdzcocqgmsyel` |

PopSG reads `style_guide_folders` and `style_guide_file_groups` through
PostgREST. Canonical taxonomy identity lives in `core.licensor` /
`core.property`. Legacy DAM tables `public.licensors` / `public.properties`
still exist for the character catalog only.

This repository (`u2giants/shared-db`) is the **only** place schema/DDL for
that shared database may be authored. Consumer apps must not invent migrations.
AGENTS.md: every DDL change is a new timestamped file under
`supabase/migrations/` — never ad-hoc Node-executed ALTER/CREATE/DROP/VALIDATE.

### 2. What we set out to do this session, and why

**Business goal:** finish moving PopDAM asset/style-group licensor+property
foreign keys onto the shared canonical `core.*` rows so every app agrees on
identity — without taking the Data API down again.

**Trigger:** production application of
`supabase/migrations/20260723113000_dam_core_licensor_property_cutover.sql`
timed out after 10 minutes, rolled back, and caused project-wide PostgREST
503 / `PGRST002` while the long transaction was open.

**Stage 0 technical objective (revised):**

- **DDL in migrations only** — bridge versions between `112900` and unsafe
  `113000`: drop legacy FKs → residual gate → finalize core FKs/view → ledger
  barrier.
- **Node tool = DML only** — read-only preflight/evidence + bounded residual
  batches; no schema DDL phases on the apply path.
- **Honest ledger order** — do not edit/rename/delete applied `113000`; do not
  repair `113000` before the equivalent end-state exists; barrier blocks linear
  push into re-running unsafe `113000` until that version is already in the
  ledger (preview already has it; production uses owner-approved repair
  **after** verification).
- Partial-resume fix: `COALESCE(existing valid core licensor, mapped legacy)`.
- Hard-fail unmapped **and** ambiguous licensors; property missing/ambiguous →
  NULL; durable text untouched.
- Lock safety: `lock_timeout` + `statement_timeout` per DML txn; advisory lock;
  forward-progress abort; transaction-safe trigger disable/enable.
- Dry-run: live query when `DATABASE_URL` set; offline never pretends counts are
  operational proof.

Later Licensor→Property authority stages remain **out of scope**.

### 3. Current state — what is true right now

**Production database**

- Ledger has `20260723112900` only among the taxonomy trio.
- Ledger does **not** have `20260723113000` or `20260723113100`.
- Canonical FK cutover is **not** applied (legacy targets after rollback).
- PopSG recovered after `notify pgrst` reload on 2026-07-23.

**Preview database**

- `20260723113000` **is** applied and verified (85,481 / 42,700 links, five
  core FKs, `dam_character_catalog`). File must not be edited/renamed/deleted.
- New bridge migrations `112910`–`112940` are **not yet applied** on preview
  (local worktree only). When landed, use out-of-order / `--include-all` so
  versions between already-applied ones can run; each is idempotent and the
  barrier passes because `113000` is already in the ledger.

**Repository (this worktree — uncommitted local revision)**

| Path | Status |
|---|---|
| `supabase/migrations/20260723112910_dam_core_taxonomy_drop_legacy_fks.sql` | **New** — idempotent drop of legacy-targeted FKs only |
| `supabase/migrations/20260723112920_dam_core_taxonomy_backfill_gate.sql` | **New** — refuses while residual non-core ids remain |
| `supabase/migrations/20260723112930_dam_core_taxonomy_finalize_core_fks.sql` | **New** — five core FKs + view; no bulk DML |
| `supabase/migrations/20260723112940_dam_core_taxonomy_ledger_barrier.sql` | **New** — refuses until `113000` is in ledger |
| `tools/dam-core-taxonomy-safe-cutover.mjs` | **Revised** — DML-only apply path |
| `tools/dam-core-taxonomy-safe-cutover.test.mjs` | **Revised** — DDL absence, partial-resume, gate/barrier, locks, progress |
| `scripts/dam-core-taxonomy-safe-cutover/README.md` | **Revised** — multi-pass db push + ownership split |
| `docs/app-migration-notes/popdam-core-licensor-property-20260723.md` | **Revised** |
| `supabase/migrations/20260723113000_*.sql` | **Unchanged** |
| Commit / push / PR / remote DB | **Not done** (explicit session boundary) |

**Dependent PopDAM app code:** must not deploy until production cutover +
verification + honest ledger.

### 4. Everything we tried that did NOT work

1. **Re-run unchanged `20260723113000` on production** — timed out, rolled
   back, PostgREST 503/PGRST002. **Do not retry.**

2. **Wait for PostgREST to self-heal** — required explicit `notify pgrst`
   reload. Recovery only, not a migration strategy.

3. **Edit / replace / empty-out `20260723113000`** — illegal (applied on
   preview).

4. **Silent `migration repair --status applied 20260723113000` before
   end-state** — **Forbidden.** Repair only after verified equivalent end-state
   + explicit owner approval for that metadata action.

5. **First-draft Node tool executing DDL (drop FKs / finalize) on apply** —
   violates AGENTS.md migration discipline. **Rejected.** DDL moved into
   `112910` / `112920` / `112930` / `112940`; tool is DML-only.

6. **Partial-resume mapping joining licensor map only on `row.licensor_id`** —
   if licensor was already a valid `core.licensor` UUID and property still
   legacy, map miss nulled **both**. Fixed with COALESCE in pure functions and
   every asset/style_group DML query.

7. **Illustrative dry-run residual counts presented as operational proof** —
   offline dry-run now prints architecture/SQL only with
   `operationalCounts: null`. Live evidence requires `DATABASE_URL`.

8. **Trust withdrawn “production promotion succeeded” docs** — superseded.

### 5. Root causes and key findings

- **Outage root cause:** one migration held DDL + ~85k rewrites long enough that
  PostgREST could not rebuild its schema cache globally.
- **Safe architecture (revised):**
  - Migrations own short DDL and gates (`112910`–`112940`).
  - Node tool owns residual DML only, with advisory lock, timeouts, and
    forward-progress checks.
  - Barrier owns honest refusal to reach unsafe `113000` until that version is
    already recorded applied (never via SQL writes to the ledger).
- **Mapping:** code aliases `DS→DY` / `WWE→WW`; hard-fail unmapped/ambiguous
  licensors; property code-then-name; missing/ambiguous property → NULL;
  durable text untouched; COALESCE preserves partial core ids.
- **Multi-pass production workflow:** push `112910` → DML tool → push
  `112920`+`112930` → barrier refuses → verify → owner repair `113000` → push
  barrier + `113100`. Preview uses `--include-all` for out-of-order bridge
  inserts; barrier passes immediately because `113000` is already applied.

### 6. Exact next steps

1. **Local gates (this worktree, before claiming Stage 0 repo-side complete):**
   ```bash
   node --test tools/dam-core-taxonomy-safe-cutover.test.mjs
   bash scripts/check-sql.sh
   ```
   Gate: all node tests pass; check-sql static pass.

2. **Land on a fresh branch after review** (later session): do not clobber main’s
   `a90846c`. Commit Stage 0 files only → PR → merge. No remote DB from the
   coding-only session.

3. **Preview out-of-order apply** of `112910`–`112940` (`db push --include-all`
   or platform equivalent). Gate: all four apply; barrier passes; tool `--apply`
   is `noop` or residual-clear; five core FKs still present.

4. **Production window (owner-approved):**
   - Pass 1: `db push` applies `112910`; stops at gate `112920`.
   - DML: `node tools/dam-core-taxonomy-safe-cutover.mjs --apply --batch-size=2000`
     with REST probes; abort on PGRST002.
   - Pass 2: `db push` applies `112920`+`112930`; stops at barrier `112940`.
   - Validate: zero residuals, `core_fk_count=5`, view exists; browser PopSG.
   - **Only then**, owner-approved:
     `supabase migration repair --status applied 20260723113000`
   - Pass 3: `db push` applies `112940` + `113100`. Dry-run must not treat
     `113000` as pending work to execute.

5. **Only then** deploy dependent PopDAM taxonomy app code.

6. **Do not start** later authority migrations until steps 3–4 are done.

### 7. Constraints and gotchas in force

- Shared-db branch + PR; AI merges after checklist; preview-first for schema.
- **Never edit applied migrations** (`113000` on preview).
- **Never repair `113000` before equivalent end-state exists.**
- **Never retry `113000` unchanged** on production.
- **Never Node-execute schema DDL** for this cutover.
- **Never write `schema_migrations` from SQL.**
- No consumer-repo DDL; `dam` not in `pgrst.db_schemas`.
- Windows: no `psql` — use Node + `pg` + pooler for apply.
- This coding session: no secrets, no remote DB, no commit/push/PR.

### 8. Access and environment

| Need | Where |
|---|---|
| Supabase CLI PAT | 1Password `vibe_coding` → “Supabase CLI Personal Access Token” |
| Production DB password | 1Password `vibe_coding` → “Supabase DB Password - shared POP database” |
| Preview DB password | 1Password `vibe_coding` → “Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)” |
| Pooler | `aws-1-us-east-1.pooler.supabase.com:6543` |
| CLIs on t16 | `gh`, `gcloud`, `supabase`, `op` (when toggled) |

Stage 0 revision session: **did not** open Supabase or read secrets.

### 9. Open questions and risks

| Item | Notes (dated 2026-07-23) |
|---|---|
| Production maintenance window | Owner-scheduled; not auto-booked. |
| Batch size default 2000 | Override with `--batch-size=`. |
| Repair approval | Only after verified end-state; barrier enforces sequencing. |
| Concurrent main commit `a90846c` | Port Stage 0 onto fresh branch; do not overwrite. |
| Window after `112910` before finalize | FKs briefly absent; resume DML ASAP; never run `113000`. |
| Concurrent DML operators | Advisory lock refuses second apply. |

### Self-audit (Stage 0 handoff)

1. Comprehensive for a brand-new developer? **Yes** — §§1–9 cover app, goal,
   dual-env ledger state, failed approaches (including first-draft DDL tool and
   partial-resume bug), architecture, ordered multi-pass gates, constraints,
   access, risks.
2. Detailed enough to continue without this chat? **Yes** — exact migration
   versions, tool commands, repair timing, preview `--include-all`, and
   `scripts/dam-core-taxonomy-safe-cutover/README.md`.
3. Execution honesty? **Yes** — no remote apply, no commit, no claim that
   production or preview bridge is applied; tests are the local completion gate
   for this revision.

---

## PopSG outage during DAM taxonomy migration — 2026-07-23 (historical incident summary)

The incident narrative that triggered Stage 0 is retained in condensed form.
Prefer the Stage 0 section above for execution.

- PopSG recovered (200/206 + cards) after PostgREST reload signals.
- Production cutover **not** applied; ledger has `112900` only among the trio.
- Unchanged single-transaction migration must not be retried.
- Detail + safe path: `docs/app-migration-notes/popdam-core-licensor-property-20260723.md`.

## Sample Tracking schema — 2026-07-22 update (APPLIED to preview AND production)

> ### 2026-07-23 follow-up — completion semantics + office inventory (APPLIED to production)
>
> Two further migrations are merged and **applied to preview AND production on 2026-07-23**:
> - `20260723230000_sample_tracking_completion_semantics.sql` — fixes two verified defects:
>   a sample with **zero movements** used to derive `complete` (now `uninitialized`), and a
>   stop closeout could **mask a remaining balance** and show `complete` while pieces
>   physically remained. Adds the **automatic office-inventory trigger**.
> - `20260723233000_sample_shipment_line_allow_inventory_origin.sql` — lets a shipment line
>   originate from an `*_office_inventory` bucket so parked stock can be **added to a new box**.
>
> **Business rule (confirmed by Albert 2026-07-23):** when pieces ship onward out of an office,
> the remainder is automatically moved into that office's own inventory bucket
> (`terminal/ningbo_office_inventory`, `terminal/nyc_office_inventory`) and leaves the tracking
> flow — pieces stay conserved. Delivered-to-customer is resolved. Inventory stock can be
> withdrawn into a new box (balance-checked). Canonical four-piece end state is now `complete`.
>
> Production apply was **deliberately bounded** to these two migrations using a clean temporary
> checkout, because production is missing **16 unrelated migrations** from other workstreams
> (DB Data Admin write paths, DAM taxonomy cutover, PopSG) — several deliberately unpromoted.
> `supabase db push` refuses to run while those gaps exist; **never** use `--include-all` to
> force it, or you will promote all 16. See "Production migration backlog" below.
>
> Tests: `sample_tracking_completion_semantics.sql`, `sample_tracking_quantity_contract.sql`
> (updated for the new rule), `sample_tracking_office_inventory_withdrawal.sql` — all pass
> against the applied schema.
>
> **Consumer work is NOT done.** The DesignFlow apps still run daily on the legacy scalar model
> and several of their endpoints hard-fail against the live constraints. The adoption plan lives
> in the tracking repo: `popcre/designflow-tracking` →
> [`fix_sample_tracking.md`](https://github.com/popcre/designflow-tracking/blob/sandbox-albert/fix_sample_tracking.md)
> (PR [#26](https://github.com/popcre/designflow-tracking/pull/26), Uma reviews). Shared-db
> copy of the same analysis:
> [`docs/verification/designflow-sample-tracking-consumer-fix-spec-20260723.md`](docs/verification/designflow-sample-tracking-consumer-fix-spec-20260723.md).

The full Sample Tracking schema is merged to `main` and **live on both preview
(`rjyboqwcdzcocqgmsyel`) and production (`qsllyeztdwjgirsysgai`)**. After the
`220000`-timestamp collision was found (PR #168), the whole block was re-timestamped
to a clean contiguous range **`20260722221000`–`20260722221700`** (PRs #168 and #170;
`221700` contract-hardening now sorts last because it ALTERs the tables created at
`221400`/`221500`). It covers the restored `sample_shipment_item` current-membership
table + uniqueness, durable box ownership, shipment intent, immutable/concurrency-safe
quantity movements, local closeouts, durable import audit records, permissions, and
five derived read views. Legacy samples remain explicitly `unknown`; none were
backfilled as quantity one.

**Verified on production 2026-07-22 (read-only):** ledger entries `221000`–`221700`
are all present, and every object exists — tables (`sample_shipment_item`,
`sample_movement`, `sample_import_row`, `sample_box`, `sample_stop_closeout`, …),
functions (`post_sample_movement`, `sample_movement_guard`, …), and the five read
views. Evidence: `docs/verification/sample-tracking-quantity-schema-20260722.md`.

**Trigram-ledger drift — RESOLVED 2026-07-23.** Production's ledger had recorded the
PopSG trigram migration under its **old** version `20260722220000` while on disk the
file is `20260722220800`. That single ledger row was reconciled (`220000` → `220800`,
name unchanged) with Albert's explicit approval; production's ledger now matches the
on-disk filenames exactly (`220800` + `221000`–`221700`, every version equal to its
file prefix), so a future `supabase db push` from `main` sees them all as applied and
re-runs nothing. No schema objects were touched. (The git-integrated `main` preview
branch may still report status `MIGRATIONS_FAILED` — a stale artifact of the original
collision; all objects did land.)

Date: 2026-07-22
Repo: `u2giants/shared-db`
Target branch: `main`; all completed work described here is merged and synchronized unless
a section explicitly says it remains preview-only or pending.

This file is the top-level "where are we" pointer for the next session. It is written
for a developer with **zero** prior context. Read it, then read the linked plan.

---

## 🚧 Production migration backlog — READ BEFORE ANY PRODUCTION APPLY (2026-07-23)

**Production is missing 16 migrations that sit *before* its last applied migration.**
Because of that, `supabase db push` **refuses to run** against production and exits 1 with
*"Found local migration files to be inserted before the last migration on remote database.
Rerun the command with --include-all flag."*

**Do NOT rerun with `--include-all`.** That would promote all 16 at once, and several are
**deliberately unpromoted** — the DB Data Admin write paths (`20260722170000` single-record
updates, `20260722194000`/`194100` merge workflow, `20260722203000`/`203100` licensor tree),
plus the DAM taxonomy cutover (`20260723112910`–`112940`), `dam_customer_hub_wiring`,
`dam_path_facets_by_customer_id`, `plm_import_master_data_preserve_customer_status`, and the
three PopSG migrations. Promoting those is each workstream's decision, in its own window.

**How to apply only your own migration (the bounded technique, used successfully 2026-07-23):**

1. `git worktree add --detach <tmp> origin/main`
2. In that temp checkout, **delete the migration files you are not promoting** (they stay in
   the repo; you are only shrinking the local set the CLI compares against).
3. `supabase link --project-ref qsllyeztdwjgirsysgai --password "$PROD_DB_PASSWORD"`
4. `supabase db push --dry-run` → **confirm it lists only your migrations**, then
   `supabase db push`.
5. Verify the real objects in the database (not just `supabase_migrations.schema_migrations`).
6. Remove the temp worktree.

**Gotcha found the same day:** comparing filenames "greater than the remote's highest version"
is **not** a valid way to compute what is pending — production had gaps far below its maximum.
Always diff the full local file list against every row in `supabase_migrations.schema_migrations`.

**Second gotcha — the ledger can lie.** Preview recorded `20260723233000` as applied while the
constraint it creates was **absent**. Always verify the actual object, and reconcile drift by
re-running the committed migration's (idempotent) SQL.

## Sample Tracking schema — DesignFlow (APPLIED preview + production, 2026-07-22)

The authoritative database implementation plan is
[`fix_sample_tracking_schema.md`](fix_sample_tracking_schema.md). Read it completely before touching
any Sample Tracking table, migration, constraint, view, RLS policy, grant, or legacy data.

### What this work is and why it exists

DesignFlow tracks physical product samples through factories, Ningbo, New York, and customers. One
sample batch may split: a factory can make four pieces; Ningbo can retain one and send three to New
York; New York can retain two and send one to the customer. The legacy scalar quantity/status/office/
box model cannot account for all four pieces simultaneously. The planned design uses immutable
positive movements between normalized typed locations, derived balances, durable box ownership,
explicit shipment intent, local-stop closeout distinct from global completion, and durable import
records.

### Current exact state (2026-07-22 — SCHEMA APPLIED to preview AND production)

- **Whole schema is merged to `main` and live on both preview (`rjyboqwcdzcocqgmsyel`) and
  production (`qsllyeztdwjgirsysgai`).** PRs #164, #166, #168, #170 are all merged. Migrations are
  re-timestamped to the clean contiguous range **`20260722221000`–`20260722221700`** (`221700`
  contract-hardening last, since it ALTERs the `221400`/`221500` tables).
- The originating read-only inventory (gates 1–3) confirmed the §3.2 defect: the restore migration
  `20260721201500_restore_dflow_sample_tracking_tables.sql` had recreated six tables in `dflow` but
  omitted the seventh, `sample_shipment_item`
  ([`docs/verification/sample-tracking-inventory-20260722.md`](docs/verification/sample-tracking-inventory-20260722.md)).
  That table has since been restored (`221000`) with `UNIQUE(sample_id_fk, box_id_fk)` (`221100`),
  which the tracking service itself anticipates (§15 Q1: it uses the table as current box membership,
  failing closed 409 when absent).
- **Production verification, read-only, 2026-07-22:** ledger entries `221000`–`221700` are all
  present and every object exists — tables (`sample_shipment_item`, `sample_movement`,
  `sample_import_row`, `sample_box`, `sample_stop_closeout`, …), functions (`post_sample_movement`,
  `sample_movement_guard`, …), and the five read views. Preview was proven earlier by rolled-back
  transactional rehearsal + the two-connection race test (evidence:
  `docs/verification/sample-tracking-quantity-schema-20260722.md`).
- Legacy samples remain explicitly `unknown`; none were backfilled as quantity one.

### How production got applied (note for the record)

The PR bodies (#164/#166/#168) were written before promotion and say "production still pending";
that wording is now **stale**. As of 2026-07-22 production carries the full `221000`–`221700` block.
No session log in this repo documents exactly when/how it was pushed, but the objects and ledger are
present and consistent. This section supersedes the earlier "not yet applied" claims.

### Trigram-ledger drift — RESOLVED 2026-07-23

Production's ledger had recorded the PopSG trigram migration under its **old** version
`20260722220000` (name `sgf_path_trgm_indexes`) while the on-disk file is `20260722220800`. With
Albert's explicit approval, that single ledger row was reconciled (`UPDATE … set version =
'20260722220800' where version = '20260722220000' and name = 'sgf_path_trgm_indexes'`). Production's
ledger now matches the on-disk filenames exactly (`220800` + `221000`–`221700`, every version equal
to its file prefix), so a future `supabase db push` from `main` sees them all as applied and re-runs
nothing. No schema objects were touched — this was a ledger-row reconciliation only. The
git-integrated `main` preview branch may still show status `MIGRATIONS_FAILED`, a stale artifact of
the original collision.

### Constraints, access, and risks

- All DDL belongs here; consumer repositories receive model/service changes only after shared-db.
- Preview project is `rjyboqwcdzcocqgmsyel`; production is `qsllyeztdwjgirsysgai`. Reconfirm in
  `AGENTS.md` before linking.
- Credentials live in 1Password vault `vibe_coding` under the item names documented in `AGENTS.md`;
  never copy values into files or chat.
- Never assume an unknown legacy sample has quantity one, and never delete duplicate memberships
  with a blind row-number cleanup.

---

## Active workstream — DB Data Admin implementation (updated 2026-07-23)

### 1. What this application is

DB Data Admin is POP Creations' administrator-only control room for shared Customers,
Vendors, Licensors, and Properties. Its canonical code and database migrations live in this
repo. The React/TypeScript frontend is in `apps/db-data-admin/`; the development deployment is
`https://data-dev.designflow.app`; the reserved production URL is
`https://data.designflow.app`. `DB_Data_Admin.md` is the authoritative product and delivery
specification, and `docs/db-data-admin-inventory.md` is the verified implementation inventory.

### 2. What this work set out to do, and why

The project replaces scattered SQL/manual maintenance with one guarded interface while
preserving shared Core identities, per-application status overrides, immutable audit history,
and safe merges. Delivery Steps 1–10 now establish the repository/runtime foundation,
authorization/storage schema, merge coverage, protected reads, extension tables, controlled
Customer Channels, read-only Customer/Vendor grids, guarded single-record editing, and
protected duplicate merges with immutable audit history, and a read-only Licensor → Property
hierarchy with dated reconciliation and loud orphan handling. Production writes remain off.

### 3. Current state

- Repository mirroring excludes top-level `apps/` centrally; all nine consumer sync jobs test
  that boundary. No workstation-specific setup is required.
- PR #127 scaffolded React 19 + TypeScript 6 + Vite 8.1.5, pinned RevoGrid Core 4.23.22,
  Vitest, Playwright, Docker, and CI in `apps/db-data-admin/`.
- PR #129 configured the immutable GitHub Actions → GHCR → Coolify development path.
  `https://data-dev.designflow.app/` returned HTTP 200 and live HTML reported Step 10 merge
  build `39c2af6c704c41c5361fbbe33bcc71a3fe6b1348` on 2026-07-22.
- Microsoft SSO on development was repaired on 2026-07-22. Azure already contained the
  preview callback URI, but preview Supabase could not exchange the returned Microsoft
  code because its Azure credential value was invalid. A dedicated additive Azure
  credential named `supabase-preview-data-admin` now supplies preview Supabase only;
  production authentication was not changed. The frontend now displays OAuth callback
  failures and uses a short commit plus build date instead of the full SHA in the header.
- PR #130 added migrations `20260722002500` through `20260722003500` for explicit admin access,
  immutable audit events, per-profile grid state, CRM/PM/DAM extensions, and controlled
  Customer Channels. All seven are applied and contract-tested on preview
  `rjyboqwcdzcocqgmsyel`; they are intentionally not applied to production.
- Steps 5 and 6 are merged and tested on preview. PR #138 corrected deterministic PLM
  tri-state behavior, protected detail reads, and the Customer list signature; six database
  suites passed. Production stayed unchanged.
- Kimi K3 reviewed the complete plan/repository context and debated the implementation with
  Codex until both explicitly reached consensus: serialized schema/UI PRs, read-only Step 7,
  public RevoGrid templates, explicit cursor loading, lazy details, and no Step 8+ leakage.
- PR #139 delivered Step 7 Customer/Vendor RevoGrid Core views. PR #142 corrected the exact
  saved-view RPC contract and loud optimistic-conflict handling. Main CI passed lint, 10 unit
  tests, build, 3 Chromium tests, image publication, and Coolify deployment. Visual evidence
  is under `docs/verification/db-data-admin-step7-*`.
- Kimi K3 implemented the Step 8 schema/API migration and database contract suite. PR #147
  merged migration `20260722170000_db_data_admin_single_record_updates.sql`: protected
  Customer/Vendor update RPCs, an off-by-default write gate, optimistic concurrency,
  operation-id idempotency, structured expected failures, and immutable audit projections.
  The full preview database suite passed. Kimi's paid CLI quota was exhausted while correcting
  its final test fixture, so Codex completed that correction and the companion frontend.
- PR #148 delivered the Step 8 editor and audit timeline. It permits only curated display name,
  global status, CRM/PM/DAM status, and Customer Channels; every save requires a reason and
  stale records fail loudly. Main CI passed 13 unit tests, 3 Chromium tests, lint, build,
  container publication, and Coolify deployment. Visual evidence is under
  `docs/verification/db-data-admin-step8-*`.
- The `single_record_write` feature gate is enabled only on preview. The Step 8 migration and
  gate were not promoted to production.
- PR #150 delivered the Step 9 database workflow in migrations `20260722194000` and
  `20260722194100`: protected Customer/Vendor previews, exact FK counts, field-level extension
  conflicts, SHA-256 stale-preview protection, ordered advisory locks, explicit resolutions,
  operation-id idempotency, and immutable success/failure audit evidence. All eight rollback-
  safe DB Data Admin suites passed on preview; the final preview dry-run reported no drift.
- PR #151 delivered the merge dialog. It fixes the selected detail record as survivor, requires
  a duplicate, shows the direction and affected counts, requires every conflict choice plus a
  reason and irreversible confirmation, and refreshes the survivor/audit after success. Main
  CI passed 15 unit tests, 4 Chromium tests, lint, build, image publication, and Coolify deploy.
  Visual evidence is `docs/verification/db-data-admin-step9-merge-preview.png`.
- The `merge_execute` feature gate is enabled only on preview. Neither Step 9 migration nor
  merge execution was promoted to production.
- GLM 5.2 implemented Step 10 under Codex supervision. PR #153 added the protected read-only
  hierarchy RPC in migrations `20260722203000` and corrective `20260722203100`; PR #154 added
  the accessible Licensors tab. The contract reads the edge only from
  `core.property.licensor_id`, shows division/type-qualified PLM context, returns every orphan
  separately, and always states that live upstream reconciliation is not claimed. All nine
  rollback-safe DB Data Admin suites passed on preview. Main CI passed 22 unit tests,
  5 Chromium tests, lint, build, container publication, and Coolify deployment. Evidence is
  under `docs/verification/db-data-admin-step10-*` and
  `docs/verification/db-data-admin-licensor-property-tree-20260722.md`.
- A corrective pass over Steps 8–10 (2026-07-22, branch
  `claude/db-data-admin-steps8-10-perfect`) closed gaps against `DB_Data_Admin.md`: the merge
  preview now shows the exact token-covered aliases/source references that move (additive
  preview-first migration `20260722210000`, applied and verified on preview only); the merge dialog shows an accessible
  success receipt with the final survivor and audit/operation ID; merge candidates can be found
  beyond the loaded grid page; the Licensor tree makes every property reachable past the old
  24-item cap via a count-disclosing "show all"; the editor reflects an application's current
  status instead of defaulting to Active; and the stale concurrency-token save failure gained a
  one-click "Reload record" recovery. Dead CSS was removed and class mismatches reconciled.
  Local gates: lint, 29 unit tests, build, 6 Chromium tests, and `scripts/check-sql.sh` all pass;
  all nine rollback-safe DB Data Admin suites pass on preview and its final dry-run is clean.
  Production is unchanged, no previously applied migration was edited, and
  `fix_impl_visual_admin_page.md` remains untouched.
  Full evidence: `docs/verification/db-data-admin-steps8-10-corrections-20260722.md`.
- A same-timestamp collision was discovered immediately after PR #161 merged: the concurrently
  merged DAM migration and the DB Data Admin correction were both named `20260722210000_*`.
  Preview history proved the DB Data Admin migration owned `20260722210000`; the unapplied DAM
  migration was renamed to `20260722210100_dam_customer_hub_wiring.sql`. Preview then exposed and
  corrected generated-column writes, invalid/duplicate alias seeds, and a slow row-by-row asset
  backfill. The optimized distinct-name backfill applied successfully; both DAM and DB Data Admin
  rollback suites pass and the final preview dry-run is clean. Production remains untouched.
- Albert's active preview profile had the Administrator role and now has one explicit,
  non-revoked **preview-only** `admin` access row. It was added only after verifying the
  profile and role. No production grant or production database change was made.
- **Step 11 consumer enforcement is implementation-complete.** PM/PIM, CRM, and DAM picker
  changes are committed, deployed, and visually verified. Shared-db PR #188 (merge
  `437b69a`) added protected, explicit-app-access CRM/PM serving views and closed the two
  newly introduced DAM Customer merge FKs. PR #189 (merge `ade1b17`) records the complete
  evidence in
  `docs/verification/step11-enforcement-ledger-20260723.md`.
- Migrations `20260723223000_protect_app_picker_serving_contracts.sql` and
  `20260723223100_cover_dam_customer_fk_merges.sql` were applied preview-first, then promoted
  through a physically bounded production runner. `app_serving_status_contracts.sql` and
  `db_data_admin_merge_coverage.sql` pass on preview and production. The historical fixture
  assigns an inactive Customer UUID to `public.style_tracker_rows.customer_id` and
  `pim.product.company_id`; the merge fixture proves assignments repoint to the survivor and
  the loser identity remains through `core.company_source_ref` plus `core.customer_alias`.
- PM production visual acceptance passed in `TaskDetailModal`: the Retailer picker is
  populated and contains active-only labels. Evidence:
  `C:\Users\ahazan2\AppData\Local\Temp\codex-step11-browser\pm-task-detail-retailer-picker-final.png`.
  Production had no real inactive Customer assigned to `pim.product`, so no durable business
  row was fabricated merely for a screenshot; rollback-safe SQL proves that path.
- CRM production visual acceptance passed after app commit `66a2ed2`: active `Burlington`
  appears in Command Search, globally inactive `Midwest Marketing Associates, LLC` does not
  appear as a Customer, and a slow email-search group can no longer blank valid Customer
  results. CI built, published, deployed, and verified the commit. Evidence:
  `C:\Users\ahazan2\AppData\Local\Temp\codex-step11-browser\crm-search-active.png` and
  `crm-search-inactive.png`.
- DAM production acceptance passed for Licensed Originally Designed For, Licensed Sample
  Vendor, and Generic Special Customer. The final read contracts accept canonical DAM access
  or the live legacy PopDAM authority while exposing only picker-safe columns. Evidence and
  the failed attempts are in the Step 11 ledger.
- DesignFlow backend PR
  `https://github.com/popcre/designflow-backend/pull/64` is green and production-disabled,
  but remains open with no review. Its two commits add stable Customer/Factory master-data
  exports and an idempotent admin PLM-status operation. **Uma must review and merge it; the AI
  must not merge it.** This is the only formal Step 11 closure gate outside the AI's
  authority.
- Production remains safely read-only for DB Data Admin: `app.db_data_admin_feature_gate`
  is absent, no production `admin` grantee exists, and all six Step 8–10 write/merge/tree
  migration versions remain absent. Bulk operations (Step 12), production delivery
  (Step 13), optional grid consolidation (Step 14), and final superseded-plan removal
  (Step 15) remain.

### 4. What did not work

- The local Windows closeout could not run an `rsync` probe because `rsync` is not installed.
  The permanent answer is the real Ubuntu GitHub matrix test, which passed in all nine consumer
  repositories; do not add workstation setup for this.
- Playwright MCP left `.playwright-mcp/` logs in the repository root. They are generated
  scratch output, now ignored globally; durable screenshots belong under `docs/verification/`.
- The first closeout `npm` verification was mistakenly invoked from the repository root,
  which intentionally has no `package.json`, and returned `ENOENT`. Run frontend commands from
  `apps/db-data-admin/`; this was a working-directory error, not an application defect.
- Earlier handoff text said “PLAN ONLY” after PRs #127/#129/#130 had landed. This section
  supersedes that stale statement and records the actual verified state.
- The first Step 7 browser capture exposed a Customer column filter visually carrying into
  Vendors. Draft/applied filter state is now tab-isolated, and the final Vendor capture proves
  the input is cleared while rows remain visible.
- Mocked browser transport initially hid a saved-view RPC naming mismatch (`p_grid_key` versus
  real `p_entity_type`). Source-contract comparison caught it; PR #142 fixes it with a
  regression test and explicit version-conflict error.
- A synthetic HS256 user JWT made from the stored legacy JWT secret was rejected by current
  Supabase signing (`PGRST301`). Do not repeat that auth test; use real Microsoft SSO or
  current asymmetric signing tooling. The explicit preview grant itself was verified.
- During Kimi's non-interactive run, the Step 8 migration was unexpectedly applied to preview
  as timestamp `20260722170000` despite the prompt requesting no database mutation. Preview
  history was reconciled to the checked-in canonical file, the dry-run then reported no drift,
  and production was never linked or changed. Do not rename or edit that applied migration.
- Kimi's CLI remained blocked by its billing-cycle quota when Step 9 began, so its new read-only
  design check could not run. Codex proceeded from the previously Kimi-reviewed delivery plan.
- The first Step 9 preview test failed because hosted Supabase exposes pgcrypto under the
  `extensions` schema. The applied migration was not edited; corrective migration
  `20260722194100` qualified `extensions.digest`, after which all suites passed.
- GLM's first Step 10 preview execution used unsupported `max(uuid)` cursor aggregation. The
  applied migration was not edited; GLM added `20260722203100` using a deterministic text-cast
  UUID aggregate. The next run found a test-only nonexistent `jsonb_object_field_exists`
  helper; GLM corrected it to the native JSONB `?` operator. All nine suites then passed.
- A normal production `supabase db push --dry-run` from the full repository correctly refused
  because many older gated migrations sit before the production head. Do not respond with an
  unbounded `--include-all`. The successful Step 11 promotion used
  `C:\repos\shared-db-step11-promotion-runner`, whose migration directory physically contained
  the production ledger plus only `20260723223000` and `20260723223100`; its dry-run listed
  exactly those two files.
- The original CRM `crm_customer_picker_list` was `security_invoker=true`. In production this
  both excluded a valid PM/CRM test profile that had explicit app access but no shared role,
  and made bounded CRM `ilike` search exceed PostgREST's statement timeout. The protected
  security-barrier serving views in `20260723223000` fix both without exposing base tables.
- CRM Command Search initially remained stuck on “Searching…” even after the Customer view was
  repaired because `crm_email_routing_queue` independently timed out and `searchCrm` treated
  all four groups as one failure. Commit `66a2ed2` makes groups independent and reports each
  failed group loudly. Do not restore all-or-nothing search loading.
- The production dataset contained no inactive PM Customer assignment suitable for a
  historical-label screenshot. Creating fake durable production business data was rejected;
  preview and production rollback fixtures provide the required proof without persistence.

### 5. Root causes and key findings

- `shared-db` is both the canonical shared schema repo and the correct home for this app, but
  application source must never be mirrored into consumers. The checked-in sync exclusion is
  the automatic boundary.
- Production DesignFlow uses Cloud SQL for PLM Customer/Vendor status. DB Data Admin must use a
  protected DesignFlow operation and mirror the result back; it must not create a competing
  editable Supabase PLM status. See `docs/db-data-admin-inventory.md`.
- Merge engine coverage and the protected Step 9 workflow are complete. Production remains
  protected by the off-by-default database gates and the unpopulated production admin grant.
- App access and shared roles are separate concepts. Picker-safe serving contracts must check
  `app.has_explicit_app_access(<app>)` at the protected view boundary rather than accidentally
  inheriting broad base-table role policies.
- Stable DAM Customer UUIDs added to `public.assets` and `public.style_groups` created two new
  FKs after the earlier merge inventory. Migration `20260723223100` and the coverage suite now
  force `core.merge_customer` to repoint both before deleting a loser.

### 6. Exact next steps

1. Have Uma review and merge DesignFlow backend PR #64 into `develop`; do not self-merge.
   Re-run/confirm `forbid-shared-db-bypass` and the sandbox Cloud Build check after the merge.
   **Pass when** the PR is merged by the authorized reviewer and the sandbox endpoints still
   return stable IDs while production status writes remain disabled.
2. Implement Step 12 from `DB_Data_Admin.md`: bulk preview/count/confirm, mandatory reason,
   per-record audit, partial-failure reporting, and recovery/reactivation. Use a new
   shared-db branch, new migrations, preview dry-run/apply, database tests, frontend unit
   tests, and browser evidence. **Pass when** bulk success, partial failure, retry, audit, and
   reactivation all work on preview without changing production.
3. Prepare Step 13's explicit production manifest. Include only the reviewed DB Data Admin
   write/merge/tree/bulk migrations in a physically bounded runner; never run unrestricted
   `--include-all`. **Pass when** the production dry-run lists exactly the approved versions.
4. In Albert's approved production window, promote the bounded manifest, create only the
   approved explicit `admin` app-access grants, enable the production feature gates, and
   enable the reviewed DesignFlow Customer status path. Vendor PLM writes remain disabled
   until the stable `Factory.id` → `core.factory_source_ref` mapping is reviewed and
   populated. **Pass when** administrator writes/merges/bulk operations audit correctly,
   denied users remain denied, and every consumer picker still passes.
5. Complete the GitHub Actions → GHCR → Coolify production deployment at
   `https://data.designflow.app`. Verify Cloudflare DNS/TLS, Supabase Auth allowlist,
   Microsoft/Entra redirect URI, SSO callback, `/health`, administrator and denied-user
   behavior, and the live build SHA. **Pass when** the production URL serves the approved SHA
   and the full database/application/browser suite passes.
6. Treat Step 14 grid consolidation as optional post-launch product work; migrate an existing
   non-DesignFlow screen only for a real product reason and after parity tests.
7. Execute Step 15 only after every Definition-of-Done item is checked. Reconfirm every unique
   requirement in `fix_impl_visual_admin_page.md`, then delete that file and all inbound
   references in one final PR. **Pass when** the final audit proves nothing unique was lost.

### 7. Constraints and gotchas

Use a new shared-db branch and PR for each serialized schema tranche; preview first, additive
by default. Do not touch the separate ERP relocation objects. Do not seed a production admin
grantee without Albert's approval. Do not expose the `dam` schema through PostgREST. Keep
Licensor/Property read-only in v1. Do not delete `fix_impl_visual_admin_page.md` until every
final completion condition in `DB_Data_Admin.md` has passed.

### 8. Access and environment

GitHub CLI, Supabase CLI, Coolify orchestration, and Microsoft/Entra configuration paths have
been exercised. Database and deployment credentials belong only in the 1Password
`vibe_coding` vault or the documented GitHub/Coolify secret stores; no secret value belongs in
the repo. Preview is `rjyboqwcdzcocqgmsyel`; production is `qsllyeztdwjgirsysgai`.

### 9. Open questions and risks

The production admin-grantee list remains deliberately empty; Albert's explicit grant exists
only on preview. Vendor PLM status cannot ship until PR #64 is reviewed and a one-time stable
Factory-ID mapping populates `core.factory_source_ref`. Coldlion corrected `/vendors` to 97
factory-only records on 2026-07-22, but `core.factory` still requires the separate reconciliation
described in `fix_vendor_reconcile.md`. Production promotion requires an approved window,
formal Step 11 closure, completed Step 12, and an exact bounded manifest.

### DB Data Admin handoff self-audit — 2026-07-23

1. **Could a street-new developer continue without questions? Yes.** Sections 1–3 define the
   application, repositories, URLs, completed delivery steps, exact migration/commit/PR
   evidence, and the one external review gate. Sections 6–9 provide ordered actions,
   verification gates, constraints, access locations, and risks.
2. **Could they continue as effectively as this session? Yes.** Sections 3–5 preserve the
   production/preview boundary, bounded-runner method, live browser findings, failed
   approaches, CRM/PM authorization root cause, and no-fabricated-production-fixture decision.
3. **Are failed attempts and their causes present? Yes.** Section 4 includes the earlier
   implementation failures plus the full-directory production dry-run refusal, CRM view
   timeout, all-or-nothing Command Search failure, and absent historical production fixture.
4. **Is every next step executable and verifiable? Yes.** Every numbered item in Section 6
   identifies the target, authority boundary, action, and an explicit “Pass when” condition.
5. **Are newcomer terms, paths, URLs, and identifiers explained? Yes.** Sections 1, 3, 7, and
   8 define the app, environments, project refs, repositories, migration paths, secret
   locations, production runner, and deployment route.

Final synthesis:

1. **Is `HANDOFF.md` comprehensive enough for a brand-new developer to continue without
   skipping a beat? Yes.** Supported by Sections 1–9 and the dated Step 11 ledger linked in
   Section 3; no gap remains.
2. **Could they continue as well as the current session with all relevant background? Yes.**
   Sections 2–5 contain the goals, history, failures, root causes, and evidence; Sections 6–9
   contain the operational continuation path.
3. **Is every relevant background, goal, outcome, state, failure, decision, constraint, risk,
   next action, and verification fact present? Yes.** Those categories map directly to
   Sections 1–9. The only unfinished external action—Uma's PR #64 review—is explicit rather
   than hidden or treated as AI-authorized.

---

## HTS RAG rulings table — complete in preview and production

### What this application and change are

`u2giants/shared-db` is the migration source of truth for the hosted Supabase database
shared by POP Creations applications. DesignFlow's backend is adding an AI-assisted HTS
classification workflow. When a CBP customs ruling is a useful match, the backend will cache
the public ruling text and classification metadata so later classifications can reuse a fast,
grounded result.

The additive migration
`supabase/migrations/20260721203000_hts_rag_rulings.sql` creates
`public.hts_rag_rulings`. It was merged through
[PR #128](https://github.com/u2giants/shared-db/pull/128) in commit
`be0162221fa3f952118abd6e13142f965fffc50e`. It was promoted to production on
2026-07-21 after the DesignFlow Sequelize model and upsert passed local preview testing.

### Current verified state

- Preview is project `rjyboqwcdzcocqgmsyel`, Supabase branch
  `shared-db-schema-rehearsal`. This persistent preview was rebuilt as a production data clone
  because legacy DAM objects predate replayable repository migration history.
- Preview now reports latest migration `20260721203000`; the table exists there.
- Production project `qsllyeztdwjgirsysgai` reports migration `20260721203000`; the table
  exists there. The production push was bounded to this migration only. Seven newer DB Data
  Admin migrations remained unpromoted by using a clean temporary checkout ending at the
  approved migration.
- The 1Password `vibe_coding` item
  `Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)`
  contains the working preview pooler tuple. Use `DB_HOST`, `DB_USER`, `DB_PASSWORD`,
  `DB_NAME`, and `DB_PORT`; SSL is required. Never copy the password into Git or chat.
- The preview database password was deliberately reset on 2026-07-21 and the matching
  GitHub Actions secret `SUPABASE_DB_PASSWORD_PREVIEW` was updated.
- A Node `pg` connection using the exact 1Password pooler tuple completed transactional
  INSERT, UPDATE, SELECT, and DELETE against `public.hts_rag_rulings`, then rolled back.
  The connected `postgres` role owns the table, has direct CRUD privilege, has
  `BYPASSRLS`, and saw RLS inactive for that session. No test row persisted.
- The deployed DesignFlow services `popcre-albert-core-sandbox` and
  `popcre-albert-core-sandbox2` deliberately remain connected through the canonical
  `*_SANDBOX` GCP secret tuple to shared production Supabase project
  `qsllyeztdwjgirsysgai`. **Do not repoint those secrets to preview.** Preview is only for
  local model/upsert testing and may be rebuilt or reset. The production verification used
  this unchanged GCP sandbox connection tuple and successfully reached the new table.
- Production verification confirmed the expected primary/unique/date/revocation indexes,
  `service_role` CRUD privilege, revoked `anon`/`authenticated` access, enabled non-forced
  RLS, table ownership by `postgres`, JSONB arrays, unique enforcement, and direct CRUD.
  The `set_updated_at` trigger advanced the timestamp across separate committed statements.
  All verification rows were deleted; none remain.

### What failed and why

1. The old preview project had irreconcilable migration history, so it was replaced with
   `rjyboqwcdzcocqgmsyel`. A data clone was required because a schema-only replay could not
   reproduce legacy objects absent from repository migrations.
2. `supabase branches get` displays database passwords as the literal masked value `******`.
   An initial credential refresh mistakenly persisted that placeholder, making pooler login
   fail with PostgreSQL error `28P01`. The preview password was reset through the Supabase
   Management API, then the real value was written directly to 1Password and GitHub Actions
   without printing it.
3. After valid pooler authentication was restored, a direct query showed preview stopped at
   migration `20260717163500` and lacked `hts_rag_rulings`. Running preview dry-run exposed
   eight pending migrations; all eight were applied in repository order. The final migration
   is now `20260721203000`, and the CRUD proof passes.
4. Investigation confirmed deployed sandbox points to production, not preview. This is the
   intended architecture, not a defect: local tests use preview; approved migrations then
   move to production, where deployed sandbox sees them with zero secret changes.

### Exact next steps and verification gates

The shared-db portion is complete. Continue in `popcre/designflow-backend` under its normal
DesignFlow sandbox/Uma-review workflow. **Pass when:** the already preview-tested model and
upsert service are committed, pushed, reviewed, and deployed, then a backend-level smoke test
uses the production table through the unchanged `*_SANDBOX` connection tuple.

### Constraints, access, questions, and risks

- No shared-db production promotion remains for this HTS table.
- This is additive; do not edit the applied migration. Any correction must be a new timestamped
  migration and must follow preview-first workflow.
- `service_role` grants cover API/JWT access. Direct Sequelize pooler access uses the database
  `postgres` role, which was verified to own the table and bypass RLS.
- Authenticated tools exercised this session: `gh`, `gcloud`, `supabase`, and 1Password.
  Runtime secrets remain in 1Password vault `vibe_coding` and GCP Secret Manager; no secret
  value belongs in repository files.
- No open shared-db question remains. Application deployment belongs to the DesignFlow backend
  workflow and must not introduce startup DDL or change database secrets.

---

## 📌 Session 2026-07-20/22 — data/schema work (COMPLETED + OPEN ITEMS)

Full narrative: [`docs/app-migration-notes/session-2026-07-21.md`](docs/app-migration-notes/session-2026-07-21.md).

### Completed + deployed to prod this session (all verified)
- **PLM sync failure-logging** (PR #107) — the host wrapper now writes a committed `status='failed'`
  `ingest.sync_run` row + `systemd OnFailure` alert. **Merged to repo but NOT yet deployed on the hetz
  box** (see OPEN #4).
- **Vendor/factory schema** (PR #102) — `core.factory.display_name`, `core.factory_alias`,
  `core.merge_factory(p_loser, p_survivor, p_alias_loser_name)`. Was merged-but-unapplied; deployed.
- **Item→taxonomy Phase 2a/2b foundation** (PRs #110/#115) — `plm.merch_group_header`,
  `plm.item_import`, `plm.item_import_staging`, `plm.item_import_unresolved`,
  `plm.item_taxonomy_disagreement`, `plm.import_item_master_data(jsonb)`,
  `plm.import_merch_group_headers(jsonb)` + tooling. **`plm.item` is LIVE but 0 rows** — Phase 3 not run.
- **Vendor curation + dedup** (PRs #113/#115/#118) — status seed, 4 not-a-factory purges, directus
  reassignment (33 products + 20 style bridges, 0 orphans), 9 exact-name dup merges.
- **Coldlion `/vendors` wrong-table — RESOLVED.** Coldlion fixed it 2026-07-22: `/vendors` now serves
  **97 factory-only records** (was 539 mixed with freight/gov/bank/courier service-providers).
- **Vendor reconcile EXECUTED** (PRs #140/#141, migration `20260722140000_...`). **`core.factory` is now
  93 rows (91 active / 2 inactive)** — factories only. 418 stale old-feed rows purged; Anthony's
  Warehouse (`ANT001`) re-added **inactive** per Albert (kept, not excluded), mirror relinked; the blank
  `CNWAH` record skipped. Plan: [`fix_vendor_reconcile.md`](fix_vendor_reconcile.md) (marked executed).

### 🔵 OPEN ITEMS — exact next actions (data/schema side)

**OPEN #1 — Refresh the `plm.erp_vendor` mirror to the corrected 97. ✅ DONE 2026-07-22.**
- *Done:* migration `20260722171500_refresh_erp_vendor_mirror_to_corrected_vendors.sql` (PR #145,
  merged, applied to preview then **production**). The live `/vendors` feed was pulled and verified = 97
  (all active) before authoring; the mirror's own 97 *active* rows were already exactly those codes, so
  rather than a risky ad-hoc service-role re-pull, the migration deterministically **deletes the 442
  stale inactive service-provider rows** (guarded: asserts the allowlist = 97 and **aborts if any active
  mirror row falls outside it**) and records a completed `ingest.sync_run` (`mode=mirror_reconcile`).
  `core.factory` and bronze `ingest.raw_record` were untouched.
- *Prod verified:* `plm.erp_vendor` = **97**; `core.factory` unchanged at **93 (91/2)**; ANT001 still
  inactive; 0 factories lost mirror representation; prod sync_run `05d09a73-...` succeeded (before=539,
  deleted=442, after=97).
- *Known benign leftover (small follow-up, folded into OPEN #5):* **8 `core.factory_source_ref` rows**
  are mislabeled `source_system='coldlion'` with **numeric legacy IDs** (415, 99, 147, 403, 244, 457,
  476, 472) that were never real Coldlion vendorCodes. Their old mirror rows were correctly deleted, so
  these refs now point at no mirror row — but every one of the 8 factories still carries its **real**
  Coldlion code (CNJAM, SKPHL, CNHDL, CNRPH, CNDWG, …), which IS mirrored. Harmless; cleanup = either
  delete these duplicate numeric refs or relabel them `source_system='directus'`/`legacy`.

**OPEN #2 — Plan for a RECURRING vendor sync (two mandatory guards). ✅ DONE 2026-07-22 (plan written).**
- *Done:* [`fix_vendor_sync.md`](fix_vendor_sync.md) (PRs #145/#156/#157, merged; GLM-reviewed, review at
  `.ai/reviews/vendor-sync-plan-glm-2026-07-22.md`). Full design for the scheduled vendor sync: **weekly
  cadence on a Supabase Edge Function + scheduled invocation** (NOT the hetz systemd host — that box's PLM
  sync is broken/undeployed, OPEN #4), `ingest.sync_run` accounting with the **PR #107 durable-failure**
  pattern + empty/short-pull guard, **upsert by `(source_system, source_table, source_id)`** (prevents
  re-splitting merged dups / re-adding purged rows), and both mandatory guards:
  1. **Reject blank/nameless** (`CNWAH`, live-confirmed still blank) → loud `plm.vendor_quarantine`
     table + `rows_failed`; never into `core.factory`.
  2. **Persist "not a factory" exclusions** in a durable `plm.vendor_exclusion` table the importer
     consults every run — **seed the 418 purged service-provider codes too** (GLM S1: otherwise "no
     re-add" is only true because today's feed omits them), plus ANT001 and the re-review rulings
     (Buildasign, May Group Deco Sign, `FLGDS`, `INTUF`, Royal Packers, Royal Union). **Status is
     app-owned — set on INSERT only, never overwritten on re-pull.**
  The plan also **flags that the existing `plm.import_coldlion_vendors` VIOLATES guard 2** (it force-sets
  `status='active'` on matched rows) and must be superseded/dropped when the guarded importer is built.
- ⚠️ **Twin bug (record so it's not lost):** `plm.import_coldlion_customers` has the SAME status-clobbering
  flaw (`status='active'`, `is_potential=false` on matched rows). Customers are marked "done" but run on
  this flawed importer — open a twin fix when the guarded vendor importer lands.
- ✅ **Phase A DONE + PROD-VERIFIED 2026-07-22** (migration `20260722213000`, PR #160): `plm.vendor_exclusion`
  (seeded 435 = 434 purged + ANT001), `plm.vendor_quarantine`, guarded `plm.sync_coldlion_vendors` (M1/M2/
  S7/S8 fixes), `public.sync_coldlion_vendors` + `public.record_failed_sync_run` wrappers,
  `api.vendor_{quarantine,exclusion,sync_run}_list`, grants; old `plm.import_coldlion_vendors` dropped.
  `tools/sync-coldlion-vendors.mjs` (+tests). Validated on preview (rolled-back txn: full §7 gate +
  removal-safety). First prod run: `seen=97, inserted=0, updated=95, failed=1 (CNWAH quarantined),
  skipped=1 (ANT001), deleted=0`; `core.factory` unchanged 93 (91/2). The 6 borderline vendors are VALID
  factories (Albert), NOT excluded. **Bounded prod apply** (only 20260722213000; did NOT sweep the
  unrelated `194000`–`210000` migrations, which remain preview/other-workstream).
- 📋 **Phase B NOT built:** the scheduled Edge Function + alerting. First **verify pg_net/Vault are
  actually available** (they are unused in this project); build the overdue/failed-run alert BEFORE
  enabling the schedule. Full spec: `fix_vendor_sync.md` §6/§8.

**OPEN #3 — Item→taxonomy Phase 3+ (backfill then cutover).**
- *What/why:* `plm.item` is built but empty; items are still served from `public.erp_items_current`
  with text licensor/property codes (no FK). Coldlion `/items` is back to HTTP 200 (19,066 items /
  9,533 pages), so Phase 3 is unblocked.
- *Next step:* Phase 3 — run the item sync to backfill `plm.item` via `plm.import_item_master_data`
  (pull `/merchGroupHeaders` for ALL divisions first — the resolver needs the per-division dictionary).
  Then Phase 4 cutover: repoint `api.plm_item_list` from `public.erp_items_current` → `plm.item`, keep
  the legacy pull refreshed through the deprecation window, defer the style-bridge FK repoint to Phase 5.
- *Gate before Phase 4:* row-parity check + grants/RLS on the new `plm.*` tables + an **app-repo grep**
  (`erp_items_current`, `licensor_code`, `property_code`, name-based lookups) in popdam/popcrm/dflow/
  poppim. Full spec + locked decisions: [`fix_item_taxonomy_wiring.md`](fix_item_taxonomy_wiring.md) §7b.

**OPEN #4 — Deploy PR #107 on the hetz box + the upstream PLM 502.**
- *What/why:* the PLM master-data sync (`getLicensorsWithProperties`) has returned HTTP 502 since
  2026-07-08 — licensors/properties can't refresh. PR #107 fixes the silent-failure logging but must be
  deployed where the sync runs.
- *Next step:* on hetz — `cd /worksp/shared-db && git pull && sudo systemctl daemon-reload` (deploys the
  wrapper + `plm-sync-alert.service`). Separately, the upstream 502 is a DesignFlow/Cloud Run problem
  (api.designflow.app), not ours — raise it. *Verify:* force a failed run and confirm a `status='failed'`
  `ingest.sync_run` row + the alert fire.

**OPEN #5 — Residual fuzzy vendor duplicates + mislabeled source-refs (low priority).**
- The fuzzy-dup sheet (`docs/vendor-review/vendor_fuzzy_dupes.csv`) is mostly MOOT now — most of its 69
  pairs were the service-providers Coldlion removed. But a few genuine Chinese-factory dups may remain
  among the clean 93 (Taizhou Meihua / Xianju Fenda variants etc.). Optional: re-run exact + fuzzy
  detection on the 93 and merge any confirmed pairs via `core.merge_factory`.
- *Added 2026-07-22 (from OPEN #1):* clean up the **8 mislabeled `core.factory_source_ref` rows** with
  numeric legacy IDs (415, 99, 147, 403, 244, 457, 476, 472) recorded as `source_system='coldlion'` but
  which were never real Coldlion vendorCodes. Either delete them (each factory keeps its real Coldlion
  code) or relabel `source_system='directus'`/`legacy`. Benign — no factory lost mirror representation.

**OPEN #6 — Carried-forward security item.** Production DB password possibly exposed 2026-07-10; rotation
status unverified. Confirm and close.

> **Cross-workstream note:** the **DB Data Admin** app (its own workstream at the top of this file) is the
> serving/UI layer for these curated Customers/Vendors/Licensors/Properties. The **DesignFlow production
> DB-port incident** (its own section) is a separate infra workstream with its own open steps.

---

## 🔴 DesignFlow production DB-port incident — remediation state 2026-07-20

**Read the comprehensive incident record first:**
[`docs/incidents/20260717-designflow-production-db-port.md`](docs/incidents/20260717-designflow-production-db-port.md).
Detailed GCP source-of-truth and operations live in `popcre/infrastructure`:
`popcre/gcp/live/production-database-safety-plan.md` and
`popcre/gcp/live/production-db-secret-break-glass.md`.

### What happened and why

`fix_connection_pool.md` generalized a sandbox hosted-Supabase pooler design to
production without first inventorying each environment. A later Codex session
changed unsuffixed production `DB_PORT` from Cloud SQL port `5432` to Supabase
pooler port `6543`. Production used the correct Cloud SQL host with the wrong
port and failed. The plan-writing failure mattered as much as the later command:
no provider-by-environment inventory, complete-tuple comparison, production
approval gate, numeric version pin, negative build fixture, startup rejection,
or zero-traffic connection proof stopped the error.

### Correct contract and ownership

- Develop/staging/sandbox: hosted Supabase pooler, `6543`, SSL on, complete
  `_DEV`/`_STAGING`/`_SANDBOX` tuple.
- Production: Cloud SQL, `5432`, SSL off under the current contract, private VPC,
  complete unsuffixed tuple, numeric versions only.
- `shared-db` owns schema/migrations/data contracts. `popcre/infrastructure`
  owns GCP Secret Manager IAM, Cloud Build triggers, Cloud Run bindings, VPC
  routing, and version pins. App repos own startup validation/readiness/tests.
  `ai-devops` owns universal external-state rules and pointers.

### What is complete and live

- Infrastructure PRs #12–#14: machine-readable connection contract; nine
  passing positive/negative fixtures; explicit five-secret substitutions;
  numeric production version pins; four production triggers disabled; sandbox
  secret boundary repaired; critical secret-version alert enabled.
- A deliberate Cloud SQL + `6543` build
  (`c266a112-eaea-4dd9-997a-a7f66ac3d310`) failed in step 0 before image or
  deploy.
- Corrected application commits: Backend `1a28265` PR #62, Item Master
  `1afb25b` PR #37, Tracking `ed2ff6d` PR #25, Data Syncing `a48b8a7` PR #16.
  Combined proof: 109 suites / 741 tests. All four PRs are green, open, and now
  request review from Uma's GitHub user `devopswithkube`.
- Production reused its known images in zero-traffic candidates, proved Cloud
  SQL `10.75.208.4:5432`, SSL off, private VPC, and numeric DB secret version
  `1`, then moved 100% traffic to `core-00010-bof`, `item-00010-ben`,
  `tracking-00010-riv`, and `sync-00007-suh`. `https://designflow.app` returned
  HTTP 200.
- Infrastructure PRs #15–#17 culminated in `9ad06f1`. Terraform applied 24
  additions, zero changes, zero destroys: scoped nonproduction and reserved
  production writers, 20 secret IAM bindings, one nonproduction impersonation
  binding, and critical access-control alert `10443910794556794963`. Final plan:
  no changes.
- Read-only IAM tests prove the nonproduction writer can version `DB_PORT_DEV`
  but not production `DB_PORT`; the production writer has no impersonator.
- 1Password vault `vibe_coding` contains a non-secret recovery note titled
  `DesignFlow production DB secret approval gate`, ID
  `iwmlvzmx3acqknbktnwuu5x5bi`. Runtime values remain in GCP Secret Manager;
  recovery values/notes belong in 1Password, never Git or chat.

### What failed and why

The first hard-gate design planned a project deny policy plus a one-hour PAM
entitlement. Google rejected the temporary `roles/iam.denyAdmin` bootstrap
binding before Terraform apply because Deny Admin can be granted only at
organization level. The project has no parent and the authenticated account
sees no Google Cloud organization. PAM also requires an organization-level
service agent. No temporary role remained, no partial deny/PAM resource was
created, and no secret or workload changed. PR #16 removed the undeployable
resources before safely applying the 24 foundations.

The first acceptance-script run also exposed a PowerShell representation issue:
an empty denied permission response arrived as `null`, not an empty array. PR
#17 fixed null/empty handling. The script now proves the scoped identities, then
intentionally returns `BLOCKED` because Albert's project Owner role still grants
direct secret-version mutation.

### Exact remaining steps and verification gates

1. Create/select the company-controlled Google Cloud organization and move
   `lithe-breaker-323913` beneath it without changing project ID, billing,
   services, data, or secret values. **Pass:** project parent is the intended
   organization and production remains HTTP 200 on the same revisions.
2. Configure organization Deny Admin and Google's PAM service agent through
   infrastructure Terraform. **Pass:** plan contains only intended IAM/PAM
   additions, zero unrelated changes/destroys.
3. Restore the deny policy and one-hour entitlement: Albert requester, Uma
   (`devopswithkube@gmail.com`) sole approver, mandatory reasons, Token Creator
   restricted to the exact production break-glass writer. **Pass:**
   `Test-DbSecretGuardrails.ps1` reports every check passed instead of the
   intentional Owner blocker.
4. Conduct a no-secret-change request/approve/expire exercise. **Pass:** Albert
   cannot impersonate before/after; can during the approved window; both alerts
   identify the actors; no secret version is added.
5. Uma reviews the four application PRs. **Pass:** Uma—not an AI—merges approved
   changes to `develop`. Production continues using Cloud SQL/`5432`; these PRs
   add safe pool/readiness behavior, not a provider migration.

### Non-negotiable constraints

Do not self-approve, make Albert a deny exception, create a service-account key,
grant standing production impersonation, put database values in GitHub inputs,
re-enable production triggers early, or follow the historical production steps
inside `fix_connection_pool.md`. Unsuffixed secrets are production-only and no
schema task or sandbox task implicitly authorizes touching them.

---

## 🟠 Two live outages found 2026-07-19 — `/items` + alerting FIXED; PLM upstream 502 still open

Both were discovered while answering a documentation question. **Neither has been repaired,
and neither is alerting.** They are the highest-priority items in this file.

### Outage 1 — the PLM master-data sync has been dead since 2026-07-08

**What is broken.** `tools/sync-plm-master-data.mjs` runs nightly at 03:30 via
`systemd/plm-sync.timer` on the `hetz` VPS. It pulls licensor/property master data from
DesignFlow PLM and loads it through `plm.import_master_data()` into `core.licensor` /
`core.property`. Its last successful run was **2026-07-08**. As of 2026-07-19 that is
**11 days stale**.

**Why it is broken.** The upstream endpoint is down:

```
GET https://api.designflow.app/api/item_master/lib/getLicensorsWithProperties
→ HTTP 502 after ~31 seconds  (retried; consistent)
```

The ~31s latency before the 502 looks like the origin timing out rather than a bad key or a
gateway rejection. The API key at
`op://vibe_coding/DesignFlow PLM Canonical Master Data API/api_key` was used and is not
implicated — a bad key returns a fast 401/403, not a slow 502.

**Why nobody noticed — this is the more serious bug.** `ingest.sync_run` holds 15 runs for
`source_system='designflow_plm'` and **every single one has `status='succeeded'`**. There
are zero failure rows. The sync did not record an error; it simply stopped appearing.
Verify with:

```sql
select now()::date as today, max(started_at)::date as last_sync,
       (now()::date - max(started_at)::date) as days_since,
       count(*) filter (where status <> 'succeeded') as non_success_runs
from ingest.sync_run where source_system='designflow_plm';
```

This violates the house "no silent failures" rule. **A failed run must write a row with
`status <> 'succeeded'` and a populated `error` column, and must alert.** Fixing the
alerting matters more than fixing the outage — the outage is visible once alerting exists.

> **UPDATE 2026-07-20 — the alerting half is FIXED (PR #107, merged).** Root cause found:
> `plm.import_master_data()` set `status='failed'` then re-raised, so the aborted
> transaction rolled the failed row back; and the 502 fails in `fetchJson()` before the
> import transaction even starts — so failed runs left **no** row (not a false success).
> The host wrapper (`tools/sync-plm-master-data.mjs`) now writes a **committed**
> `status='failed'` row (separate transaction) capturing error + stage, and
> `systemd/plm-sync.service` gained `OnFailure=plm-sync-alert.service` (journal +
> `/home/ai/plm-sync-failures.log`). Unit tests in `tools/sync-plm-master-data.test.mjs`.
> **Remaining:** (a) the upstream 502 itself is still unfixed — the sync still cannot pull;
> (b) the fix must be deployed on the `hetz` sync box (`cd /worksp/shared-db && git pull &&
> sudo systemctl daemon-reload`) before it takes effect there.

**A second thing to look at while you are in there.** Every historical run recorded
`rows_seen=560, rows_inserted=560, rows_updated=0`. A daily reconciling sync that has
*never once* recorded an update strongly suggests wholesale re-insert rather than
reconciliation. Worth understanding before trusting the loader.

**Where to start.** Check whether `api.designflow.app` is up at all, then the Cloud Run
service behind it. Note DesignFlow runs on **Cloud SQL, not Supabase** — do not go looking
for this in the Supabase dashboard.

### Outage 2 — Coldlion `GET /items` returns a server-side 500

```
GET http://x5.coldlion.com/EhpApi/items?companyCode=EDGEHOME&divisionCode=CW001&size=5
→ 500  {"exception":"java.lang.NullPointerException","path":"/EhpApi/items"}
```

Reproduced with and without `divisionCode`, with `modifiedFrom`, with `merchGroup05`, and at
several page sizes. **It is server-side and unconditional.** It was working 2026-07-15 per
`docs/coldlion-erp-api-reference.md`, so it broke within four days.

> **UPDATE 2026-07-20 — FIXED upstream.** `GET /items` now returns **HTTP 200** (verified
> live: 19,066 items across 9,533 pages, `size=2&page=0`). The NullPointerException is gone.
> This **unblocks the item→taxonomy wiring** (Phase 2+ of `fix_schema_for_api.md`), which is
> now the active build (see the new item→taxonomy plan referenced below).

Every other read endpoint was verified healthy the same day — `/customers`, `/vendors`,
`/inventory`, `/merchGroupHeaders`, `/merchGroupDetails`, `/seasons`, `/itemDetails` all
200. (`/salespersons` returns 400 without extra params; that is a parameter issue, not an
outage.)

**Impact.** `/items` is the only endpoint carrying `hasImage` and the `merchGroup01–14`
pointers on each item. It also blocks the co-occurrence approach described in
`docs/merch-group-taxonomy-architecture.md` §10.2. **This is Coldlion's server, not ours —
it likely needs to be raised with them rather than fixed here.**

---

## Merch-group taxonomy — now fully documented (2026-07-19)

**Read [`docs/merch-group-taxonomy-architecture.md`](docs/merch-group-taxonomy-architecture.md)
before touching anything named licensor, property, big theme, little theme, style guide, art
type, art source, artist, age group, or `mgTypeCode`.** It was written from live Coldlion API
calls, live Supabase queries, and a full read of all six `popcre/designflow-*` repos.
Shipped in [PR #103](https://github.com/u2giants/shared-db/pull/103).

**The short version.** Coldlion owns the *vocabulary*, DesignFlow owns the *relationships*,
Supabase is a downstream mirror of both. Coldlion does have explicit licensors and properties
(22 and 258 in CW001) — what it lacks is any link between them and any active/inactive flag.

**Three rules that cause real damage when ignored:**

1. `mgTypeCode` has **no fixed meaning**. `05` is Licensor in CW001/SP001 but "Big Theme" in
   EH001 and "Product Line" in EP001. Resolve through `(divisionCode, mgTypeCode) → mgTypeDesc`.
2. Coldlion has **no hierarchy and no active flag**. Both are DesignFlow-owned. A direct
   Coldlion sync cannot reproduce either, and would resurrect dead licenses.
3. Codes are unique **only within `(division, mgTypeCode)`**. `FR` is a licensor in our DB and
   a *property* in Coldlion. Never look up by `mg_code` alone.

### Corrections this made to earlier docs

Prior documentation was wrong on two points, both now fixed in-place:

- `coldlion-erp-to-supabase-field-mapping.md` said "Coldlion has no explicit licensor." It
  does. The gap is the relationship, not the entity.
- Several docs stated `merchGroup05 = licensor` / `merchGroup06 = property` flatly. True for
  two of four divisions only.
- The "partial licensor import (37 PLM vs 20 core)" was **not** partial. 37 staging rows hold
  20 distinct codes; `core.licensor`'s `unique nulls not distinct (code)` deliberately
  collapses the division dimension. Nothing is dropped.

### Open decision that needs a human — `FR` / FRIENDS TV

`core.licensor` carries `FR` = FRIENDS TV (1 property), from `plm.licensor_import` id 199,
division 1. **Coldlion has no `FR` licensor** in either licensed division — there, `FR` is a
*property* meaning "1ST ORDER TROOPER."

Because the ETL has no delete or tombstone path, either it was created directly in PLM or it
was removed from Coldlion after an earlier sync. **The data cannot distinguish these.** It is
the only licensor in our canonical table with no upstream ERP anchor. Someone who knows the
licensing history needs to decide whether it stays.

### Open design question — the division collapse

`core.licensor` merges POP Lic and Spruce Lic into one row per code. That is correct if a
licensor is a company (Disney is Disney). It is **wrong the moment division 9 is imported**,
because MG05 there means "Big Theme," not "Licensor." Decide before importing EH001.

### What was NOT done

- Neither outage fixed (see above).
- **15 defects catalogued in §9 of the taxonomy doc are documented, not fixed.** Notable:
  a `vendor`-role authorization gap letting external vendors create/soft-delete taxonomy;
  a dedup key including `mg_desc` so renames create duplicate rows; the merch-group *header*
  sync hard-coded to `divisionCode=EH001` so the CW001/SP001 definitions are never fetched.
- The co-occurrence approach for deriving the hierarchy from Coldlion alone is **untested** —
  `/items` was down.

### Gotchas that cost time this session

- **The six `designflow-*` repos are at `C:\repos\dflow\designflow-*`**, not siblings of
  `shared-db`. All on branch `sandbox-albert`.
- **Do not route Coldlion calls through `bash` on Windows.** A bare `bash` resolves to WSL,
  which does not inherit injected env, so the API key arrives empty and Coldlion answers
  `400 Missing request header 'X-API-Key'` — which looks like a broken tool but is not. Use
  `op_run` with `shell: powershell` and `$env:VAR`.
- **`cmd.exe` cannot expand `%%VAR%%` loops** outside a batch file. Use PowerShell for any
  loop over divisions or type codes.
- `/merchGroupDetails` returns a **plain JSON array**, not the paged `{content:[...]}`
  envelope most Coldlion endpoints use. Parsers written for the envelope will break.

---

## RETRACTED workstream — DesignFlow database connection architecture

> **STOP — the remainder of this section is an incident artifact, not a current
> implementation guide.** It incorrectly generalized the sandbox hosted-Supabase
> connection to production, which remains on Cloud SQL. A Codex session then
> changed the unsuffixed production `DB_PORT` from `5432` to `6543` and broke the
> live site. Do not merge any historical PR head based on this section's old
> evidence, do not follow the production steps below, and do not mutate
> unsuffixed GCP DB secrets. The current PR heads have since been revalidated and
> are assigned to Uma; the authoritative current state is at the top of this
> handoff and in the incident record.

### What this is

DesignFlow is POP Creations' product-lifecycle-management system used by staff to manage RFQs,
items, licensing/tracking, and ERP synchronization. Its Angular frontend and BFF call four Node.js
/ Express / Sequelize services (Core Backend, Item Master, Tracking, and Data Syncing), deployed
to Google Cloud Run. The app repos are the six `popcre/designflow-*` repositories under
`C:/repos/dflow`; their sandbox branches serve `https://sandbox-albert.designflow.app`. All four
services share application data governed by this `u2giants/shared-db` repo, but
their database provider is environment-specific: sandbox/develop/staging use
hosted Supabase while production uses Cloud SQL.

The durable portion separates schema control from runtime connections:
shared-db migrations own all DDL, and applications use small validated
per-process pools. Supavisor transaction mode applies to hosted-Supabase
nonproduction environments; production remains Cloud SQL.

### What we set out to do, and why

Implement [`fix_connection_pool.md`](fix_connection_pool.md) v3.0: move Core's legacy startup
DDL under shared-db ownership, use transaction pooling for Cloud Run, bound and validate every
client pool, gate traffic on readiness, label connections, and drain owned connections cleanly.

### Current state

Schema, code, automated tests, transaction-mode compatibility, and sandbox acceptance are
complete. Uma's normal PR review/merge and post-merge production verification remain.

- Migration `20260717163500_reconcile_dflow_backend_startup_contract.sql` was checked,
  dry-run/applied to preview, proven compatible with the old Core boot, merged in shared-db PR
  [#97](https://github.com/u2giants/shared-db/pull/97), applied to production by successful run
  `29611459054`, and audited live. Merge SHA: `293fd90697bb0a0024e196d6b4a2da2e298dbd15`.
- App heads are pushed on `sandbox-albert`: Item Master `bca5f16`
  ([PR #37](https://github.com/popcre/designflow-item-master/pull/37)), Tracking `a14afc1`
  ([PR #25](https://github.com/popcre/designflow-tracking/pull/25)), Data Syncing `509c010`
  ([PR #16](https://github.com/popcre/designflow-data-syncing/pull/16)), and Core `b4a015a`
  ([PR #62](https://github.com/popcre/designflow-backend/pull/62)). Uma has not merged them;
  the AI must not merge DesignFlow PRs.
- All four full unit suites passed: 693 tests. Preview port-6543 checks passed for all four
  services, including a real Sequelize transaction.
- Historical incident evidence includes an unsafe unsuffixed `DB_PORT` version
  containing `6543`; do not use it. Production is pinned to numeric version `1`
  and Cloud SQL/`5432`. The four corrected sandbox builds use the complete
  `_SANDBOX` tuple and deployed ready transaction-mode revisions. Each emitted a validated application name and
  `db_ready` before HTTP listen. Login, token, Item Library, and Tracking checks returned 200;
  logs had zero acquire-timeout, ceiling, or startup-fatal matches.
- Exact builds, revisions, and timings are in
  [`docs/verification/supabase-pooler-idle-connection-drop-20260623.md`](docs/verification/supabase-pooler-idle-connection-drop-20260623.md).

### Everything tried that did not work

- `api.sandbox-albert.designflow.app` did not resolve from this machine. The deployed smoke test
  used the canonical public Cloud Run BFF URL instead; all checks passed. This was a DNS-name
  issue, not an application failure.
- A local preview `supabase db push --dry-run` listed ten migrations because preview lagged
  production. The GitHub preview workflow applied the backlog plus reconciliation cleanly. No
  applied migration was edited.
- Cloud Run rejected two attempts to change `DB_PORT` from a secret reference to
  a literal in the same revision. The later unsuffixed secret-version approach
  was not a safe atomic solution—it crossed the environment boundary and caused
  the production outage. The corrected route uses `_SANDBOX` outside production
  and keeps production on its pinned unsuffixed Cloud SQL tuple.

### Root causes and key findings

- Core boot previously launched `sequelize.sync()` plus 43 unawaited DDL/data statements against
  its max-5 pool. That block is gone and a regression test prevents its return.
- Session-mode clients unnecessarily reserved database backends across idle Cloud Run sessions.
  Transaction mode now shares backends only while queries/transactions are active.
- Live preview/production audit found every expected Core model table, column, and index already
  present, no lowercase orphan, and no pending factory-country backfill. The migration therefore
  reconciles/asserts canonical state without a destructive drop.
- All services now use validated max-5/min-0 pools, bounded deadlines, application labels,
  readiness gates, ceiling-aware retry, and graceful owned-pool shutdown. The code audit found no
  prepared statements or session-local features that would require session affinity.

### Exact next steps

1. Uma (`devopswithkube`) reviews the four corrected PRs already assigned to
   her. **Pass when** Uma merges each to `develop`; the AI does not merge them.
2. Watch each normal production deployment. **Pass when** the latest revision is ready, carries
   its production application name, and logs `db_ready` before HTTP listen.
3. Run production login, token, Item Library, and Tracking smoke checks. **Pass when** all return
   200 and logs contain no acquire timeout, ceiling, startup fatal, forced shutdown, or relevant
   5xx.
4. Review Cloud SQL/Cloud Run connection telemetry after real production
   traffic. **Pass when** backend/client pressure stays within platform capacity
   and pool snapshots show no sustained waiters.
5. Complete the organization-backed IAM Deny + PAM gate described at the top of
   this handoff. **Pass when** the read-only acceptance script fully passes and
   an approval/expiry exercise changes no secret value.

### Constraints and gotchas

Keep transaction mode for hosted-Supabase nonproduction traffic, and keep the
current Cloud SQL production provider unless a separate migration is explicitly
approved. Pool max 5/min 0, idle 10s, evict 5s, keep-alive, and BFF normal
timeout 30s remain the guarded application settings. Never add app-repo/startup
DDL, broad session termination, unbounded pools, or session-local features
without an architecture review.

### Access and environment

`gh`, `gcloud`, `supabase`, and `op` were exercised successfully on this Windows machine.
Secrets and the test login are in 1Password vault `vibe_coding`; no value was logged or
committed. shared-db is on `main`; DesignFlow repos are on `sandbox-albert`. Preview ref:
`xjcyeuvzkhtzsheknaiu`; production ref: `qsllyeztdwjgirsysgai`; Cloud project:
`lithe-breaker-323913`, region `us-east4`.

### Open questions and risks

Open risks are (1) Albert's project Owner role retains direct secret-version
mutation until organization-backed Deny/PAM is active, and (2) a future feature
could silently depend on session affinity (prepared statements, temp tables,
session `SET`, advisory locks, LISTEN/NOTIFY, or cross-request state). Such a
feature must trigger an explicit connection-architecture review. No schema
rollback is needed: the reconciliation migration is additive/assertive.

---

## Active workstream — ERP mirror relocation (`fix_schema_for_api.md`)

### What this is
The Coldlion ERP data (items + production orders) is pulled from an external API and
mirrored into this database. Today the mirror sits in seven `public.*` tables with an
`erp_*` / `prod_order_*` name prefix — the legacy PopDAM location. We are relocating it
into the database's designed layers: raw pulls → `ingest.*`, typed authoritative mirror →
`plm.*`, browser/read contracts → `api.*`. This mirrors the already-proven customer path
(`plm.customer_import` → `plm.import_master_data()` → `core.customer` → `api.crm_customer_list`).

**The complete, detailed, 5-phase plan is [`fix_schema_for_api.md`](fix_schema_for_api.md)
(repo root).** It contains: exact current state (tables, row counts, columns, every inbound
dependency), what is correct vs. incorrect about the current design, the target design and
why, and the phase-by-phase migration with reversibility and risk notes. **Do not start ERP
schema work without reading it, and continue the phases in order.**

**The drill-down for the item→taxonomy resolver (Phases 2–4) is
[`fix_item_taxonomy_wiring.md`](fix_item_taxonomy_wiring.md) (repo root).** This is the "items
aren't joined to the taxonomy" fix: `erp_items_current` stores `licensor_code`/`property_code`
as text with no FK, while the correct FK table `plm.item` exists but is empty. The plan is under
Kimi-K3 review → Codex implementation as of 2026-07-20 (now unblocked because `/items` returns 200
again). It carries the `(division, mg_type, code)` composite-key rule and the lapsed-license guard.

### Status
| Phase | State |
|---|---|
| 1 — Serving layer (`api.plm_item_list` + repoint `style_tracker_rows_with_bridge`) | ✅ **DONE, live in production 2026-07-15** |
| 2 — Stand up `ingest.*` + `plm.item_import` / `plm.production_order_import` + resolver (additive, no cutover) | ⏳ not started |
| 3 — Dual-write + backfill items (**first phase that touches live data**) | ⏳ not started |
| 4 — Cutover reads + repoint bridge FK to `plm.item` | ⏳ not started |
| 5 — Retire legacy `public.erp_*`/`prod_order_*` + build prod-orders native | ⏳ not started |

### Phase 1 — what shipped (done)
- Migration `supabase/migrations/20260715193000_erp_phase1_api_plm_item_list.sql`, PR
  [#70](https://github.com/u2giants/shared-db/pull/70) (merged), applied to preview then
  production (prod apply run 29445431196, success).
- Added `api.plm_item_list` (`security_invoker` view over `public.erp_items_current`,
  `external_id` exposed as `source_id`). Repointed `public.style_tracker_rows_with_bridge`
  to read ERP columns through it. **No behavior change** — pure decoupling.
- **Intentionally NOT done:** `plm.refresh_style_tracker_item_bridge()` still reads
  `public.erp_items_current` directly (it writes the physical ERP `id` into FK
  `plm.style_tracker_item_bridge.erp_item_id`; a view buys no decoupling). It moves in Phase 4.
- Evidence: [`docs/verification/erp-phase1-api-plm-item-list-20260715.md`](docs/verification/erp-phase1-api-plm-item-list-20260715.md).

### Next action (Phase 2)
Author a new additive migration creating `plm.item_import` and `plm.production_order_import`
(typed ERP mirrors modeled field-for-field on the existing `plm.customer_import`), confirm
`ingest.raw_record` / `ingest.sync_run` cover the item payload, and write
`plm.import_item_master_data(p_sync_run_id uuid)` modeled on `plm.import_master_data()`.
Additive only — nothing reads the new tables yet. Follow the shared-db protocol below.
**Verification gate for Phase 2:** the new objects exist on preview, `check-sql.sh` passes,
preview dry-run lists only the new migration, and no existing reader changes behavior.

### Open decision that blocks Phase 3 (not Phase 2)
The live item pipeline is **Coldlion → dflow (Cloud SQL + enrichment) → dflow item API →
Supabase** (`source_system = 'designflow'`), **not** a direct Coldlion pull — the raw payload
is DesignFlow's shape, not Coldlion's `CLAPIServerEhp` shape. Phase 3 must choose: keep
sourcing through dflow (free merch-group → licensor/property enrichment) or pull Coldlion
`/items` directly (fresher, no dflow dependency, but re-implement enrichment). This also fixes
the `source_system` label choice. Analysis:
[`docs/coldlion-erp-to-supabase-field-mapping.md`](docs/coldlion-erp-to-supabase-field-mapping.md).

**DECIDED 2026-07-15 — Option B (direct Coldlion).** The full build plan, the item→taxonomy
wiring, and the taxonomy-table de-duplication analysis are in
**[`docs/coldlion-direct-sync-and-taxonomy-plan.md`](docs/coldlion-direct-sync-and-taxonomy-plan.md)**.
Highlights the next session must know:
- Sync becomes a Supabase **Edge Function in shared-db + `pg_cron`** (no Google Cloud), key in
  **Vault**, **data-only (no images — DesignFlow owns images)**, plus a new **weekly full
  reconciliation** to stop silent incremental drift.
- The strict parent-child **taxonomy already exists** in `core.*` (sourced from DesignFlow);
  the real work is wiring items to it with **FKs** (Coldlion `merchGroup05`=licensor,
  `merchGroup06`=property — confirmed). Coldlion does **not** expose the hierarchy.
- ⚠️ **Taxonomy "empty duplicate" cleanup is NOT a blind delete.** The empty snake_case tables
  (`core.merch_group`, `core.product_category/type/subtype`) are the *planned canonical target*
  per [`docs/unified-supabase-schema-map.md`](docs/unified-supabase-schema-map.md), not strays.
  The genuinely-redundant set is the `dflow.*` taxonomy island (0 external FKs), pending a
  Sequelize-model check in the 6 `designflow-*` repos. **Open decisions block build — see
  Part F of the plan.**

---

## Active workstream — Coldlion customer/vendor hub cleanup + extension-table design (2026-07-17)

### What this is
The Coldlion ERP customers (836) and vendors (539) were imported into the shared hubs, then the
**customer** side was de-duplicated and status-curated. `core.customer` is now 859 rows
(**140 active / 12 potential / 707 inactive**) with short `display_name`s, a `core.customer_alias`
table, and `core.merge_customer()`. Status is app-owned (survives Coldlion re-pulls). CRM pickers
now show `display_name` and hide inactive customers.

### Reference docs (read these before continuing)
- **[`DB_Data_Admin.md`](DB_Data_Admin.md)** — **approved 2026-07-21 product and
  implementation plan** for the shared administrator application at
  `https://data.designflow.app`. The application is owned and developed in this repo
  (frontend: `apps/db-data-admin/`) and initially manages Customers, Vendors,
  Licensors, and Properties. It standardizes DB Data Admin on MIT RevoGrid Core with our
  own header filtering — since 2026-07-23 a per-column **Multi Filter (Text + Set)**, see
  [`docs/db-data-admin-column-multi-filter.md`](docs/db-data-admin-column-multi-filter.md).
  DesignFlow keeps AG Grid; PopCRM's custom DataTable
  is legacy and should not become a third shared grid platform. **This plan supersedes the
  older direction below that placed the admin page in PopCRM. Implementation is underway;
  development is live at `https://data-dev.designflow.app`, while production remains gated.**
- **[`docs/coldlion-customer-dedupe-review.md`](docs/coldlion-customer-dedupe-review.md)** — the
  full customer dedup ruling ledger + final state (what merged, statuses, aliases, the Amazon
  1P/3P split, defects found).
- **[`docs/coldlion-customers-vendors-20260715.md`](docs/app-migration-notes/coldlion-customers-vendors-20260715.md)**
  — the import/pipeline app-migration note.
- **[`fix_vendor_review.md`](fix_vendor_review.md)** (repo root) — detailed cold-start handoff to do
  the **vendor** (`core.factory`) equivalent (schema merged; curation pass pending, see Status below).
- **[`fix_impl_visual_admin_page.md`](fix_impl_visual_admin_page.md)** (repo root) — historical
  PopCRM-hosted admin-page proposal. **Do not implement its PopCRM ownership/location.** Its
  database-surface and cutover-safety research may still be useful, but
  [`DB_Data_Admin.md`](DB_Data_Admin.md) is now authoritative for product ownership, URL, grid,
  architecture, and delivery.
- **[`docs/per-app-extension-tables-plan.md`](docs/per-app-extension-tables-plan.md)** —
  implementation plan for per-app extension tables (`crm/pim/dam/plm.customer_ext` etc.) so
  app-specific attributes never bloat the shared `core.*` tables. Decision made 2026-07-17,
  reviewed by Kimi K3.

### Status
- **Customers: DONE + merged** (shared-db PRs #83, #84, #85, #86, #88, #91, #94, #96; all applied
  to prod). CRM picker frontend (`picker-autocomplete-display-name`) is **MERGED** — there is no
  open popcrm-web PR (an earlier note here referencing "popcrm-web PR #3, open" was stale).
- **Vendors: SCHEMA MERGED, curation pending.** **shared-db PR #102 is MERGED** (commit `14da5c5`)
  — `factory.display_name`, `core.factory_alias`, `core.merge_factory` are all live. What remains
  is the **curation pass** (`fix_vendor_review.md` §6 steps 5–7): apply Albert's CSV rulings.
  Rulings received 2026-07-20:
    - `docs/vendor-review/vendor_multicode.csv` — statuses set (Action Printing INACTIVE, MIRAE
      ACTIVE, XIANJU SHAOFENG INACTIVE, XIANJU YINTAI ACTIVE, all "one vendor Y").
    - **"Not a factory" rows → PURGE from `core.factory` entirely:** ABF FREIGHT SYSTEM (205, 206),
      DIGITAL PHOTOGRAPHIC (16, 207), ANTHONY'S WAREHOUSE & DISTRIBUTION (458, ANT001), WALMART
      (369, 459 — actually a customer).
    - `docs/vendor-review/vendor_directus.csv` — **all 6 rows are garbage** (Directus test data:
      Bill, Chloe, Jerome, Lucy, Tom, Wendy Sunway); exclude all from `core.factory`.
  Next action: author one migration doing status-seed + purge, apply preview-first, merge.
  Full spec: [`fix_vendor_review.md`](fix_vendor_review.md).
- **Extension tables: DAM/CRM/PM implemented on preview; PLM uses a separate single-writer path.** Migration
  `20260721143000_dam_master_data_customer_id.sql` creates `dam.customer_ext`,
  `api.dam_customer_list`, the `/styles` “Originally Designed For” canonical Customer FK,
  safe backfill, and audit coverage. Migrations `20260722003000` through `20260722003400`
  add CRM/PM Customer and Vendor extensions plus DAM Vendor on preview. PLM stays Cloud-SQL-owned
  and must use the protected single-writer integration in `docs/db-data-admin-inventory.md`.
- **DB Data Admin: FOUNDATION IMPLEMENTED, FEATURE WORK PENDING.** The scaffold, development
  deployment, SSO routing, and preview-only foundation schema are complete as recorded in the
  dedicated active-workstream section above. Target production URL: `https://data.designflow.app`.
- Frontend "hide inactive" for **poppim-web / popdam3** pickers: not started (same pattern as
  popcrm-web PR #3).

---

## How to ship a shared-db schema change (the sanctioned flow, proven this session)

Full rules in [`AGENTS.md`](AGENTS.md) §4–§9. The mechanics that worked on 2026-07-15:

1. New timestamped file under `supabase/migrations/`. Never edit an applied migration.
2. `bash scripts/check-sql.sh` — needs `rg` on PATH (Git Bash lacks it; a bundled ripgrep
   exists at `.../AppData/Local/OpenAI/Codex/bin/*/rg.exe` — prepend its dir to `PATH`).
3. Branch + PR to `main`. PR CI runs only static SQL checks.
4. Apply to **preview** first, via GitHub Actions:
   `gh workflow run shared-supabase-migrations.yml -r <branch> -f target=preview -f mode=dry-run`
   then `... -f mode=apply`. (There is no auto-apply on merge; apply is always a manual
   `workflow_dispatch`.)
5. Merge PR → `main` (auto-syncs `shared-db/` into all consumer repos).
6. Apply to **production**: `gh workflow run ... -r main -f target=production -f mode=apply`.
7. Verify on production (Supabase MCP is bound to prod `qsllyeztdwjgirsysgai`).

Project refs: preview `xjcyeuvzkhtzsheknaiu`, production `qsllyeztdwjgirsysgai`.

---

## Completed earlier workstream — production schema reconciliation (2026-07-10)

Done and verified. The eight `20260710135*_reconcile_*` migrations are confirmed present in
the **production** `supabase_migrations.schema_migrations` history (checked 2026-07-15), so the
prior handoff's "promote reconciliation to production" loose end is **resolved**. Durable audit
note: [`docs/verification/production-schema-reconciliation-20260710.md`](docs/verification/production-schema-reconciliation-20260710.md).

## Carried-forward security item (verify, then close)

**Production DB password possible exposure.** During the 2026-07-10 reconciliation audit, a
Supabase CLI command printed the production DB password into local tool output (never
committed). It was flagged for rotation. **Status unverified as of 2026-07-15.** Action: check
the 1Password item `Supabase DB Password - shared POP database` (vault `vibe_coding`)
last-changed date; if it predates 2026-07-10, rotate it and update the item. If already rotated
after 2026-07-10, delete this section. Do not rotate the 1Password service-account token.

---

## Documentation completeness self-audit — 2026-07-22

### 1. Could a brand-new developer with no project or session context continue without questions?

**Yes.** The incident section at the top explains the business impact, the exact
Cloud SQL/`5432` versus Supabase/`6543` boundary, why the planning process failed,
which repo owns each layer, every live safeguard, every relevant PR/commit/build/
revision/alert identifier, Uma's two identities, the still-open Owner risk, and
five ordered next steps with explicit pass conditions. It routes to the full
incident record and the two canonical infrastructure documents rather than
requiring chat history.

The customer/vendor section also records the completed DAM customer-reference
migration, the still-pending app extension work, and routes the developer to the
authoritative `DB_Data_Admin.md` implementation plan. That plan contains the
product scope, data ownership rules, security model, audit/merge semantics,
delivery order, verification gates, repository boundaries, and the required
eventual deletion of the superseded visual-admin planning file.

The dedicated DB Data Admin workstream now records the actual post-implementation state:
merged PRs, preview-only migrations, live development SHA, failed attempts, exact next steps,
security/deployment boundaries, and remaining production risks. It replaces the stale
“plan only” statement that would otherwise send a fresh developer backward.

### 2. Could that developer continue as effectively as the current session?

**Yes.** They have the implementation evidence (9 infrastructure fixtures; 109
suites / 741 tests; deliberate failed build; zero-traffic production revisions;
24-resource IAM apply; zero-drift plan; HTTP 200), the exact identities and
scopes of both writer service accounts, the 1Password note identifier, the
current PR-review owner, and the precise organization/PAM/Deny acceptance test.
They also know which tempting shortcuts are forbidden and why the hard gate was
not forced through a standalone project.

For DB Data Admin, they also have the decisions reviewed by Kimi K3, the completed
first prerequisite (the centralized mirror excludes and purges top-level `apps/`,
with an automated boundary check on every consumer sync), and
an ordered implementation sequence that distinguishes completed schema work
from planned work.

### 3. Is every relevant detail needed for flawless execution present?

**Yes, after revision.** The first audit found and corrected four gaps: the
handoff still described all environments as hosted Supabase, still treated the
unsafe unsuffixed version as a valid atomic transition, omitted the 24 live IAM
resources and alert evidence, and did not explain the Deny Admin/PAM
organization constraint. The current top section and linked incident/runbook now
include background, goal, intended outcome, current live state, failed attempts,
root causes, ownership, constraints, risks, access boundaries, exact next
actions, and a verification gate for every remaining action. No secret value is
present.

### Sample Tracking workstream self-audit (2026-07-22)

1. **Is this handoff comprehensive enough for a brand-new developer with no project knowledge or
   chat context? Yes.** The active Sample Tracking section explains the application and four-piece
   split scenario, names the authoritative plan, states the exact plan-only status, identifies the
   omitted table and concurrent-insert defect, and gives the first verification gate. The linked
   plan's Sections 1–4 provide complete background and decisions.
2. **Could that developer continue as effectively as the originating session? Yes.** The handoff
   preserves both failed publication paths and the eventual clean GitHub path; the plan's Sections
   5–13 preserve the data contract, conservation rules, tenancy, legacy policy, migration sequence,
   preview procedure, tests, rollback, and observability knowledge.
3. **Is every relevant detail needed for flawless execution present? Yes.** The plan's Section 14
   gives ordered next steps with a success gate for each; Sections 15–16 preserve open decisions and
   definition of done; the handoff names environments, the exact restore migration and runtime
   error, access location without secret values, and explicitly distinguishes a merged plan from
   authorization to mutate preview or production.
