# FIX — `public` schema anonymous-access lockdown (shared-db)

**Written:** 2026-07-30. **Status of the security work itself: COMPLETE and live on production.**
**What is left:** five prioritised follow-ups, none of them emergencies. See §6.

> **Read §7 before you push any migration to production.** There is one specific trap
> (`20260729120000`) that will abort a production apply if you promote it in the wrong order.

This file is self-contained. You do not need the chat session that produced it. It assumes
you know SQL and Postgres but know **nothing** about this business, these apps, or what was
tried and rejected.

---

## 1. What this application is

`u2giants/shared-db` is the **canonical repository for one Supabase Postgres database shared
by four applications** owned by POP Creations (a licensed-merchandise design business). It
holds no application code — only `supabase/migrations/*.sql`, docs, and helper scripts. Its
entire contents are mirrored into a `shared-db/` folder inside each consumer repo on every
push to `main`.

| App | Repo | What it is | Status |
|---|---|---|---|
| **PopDAM** | `u2giants/popdam3` | Digital asset manager, `dam.designflow.app` | live |
| **PopCRM** | `u2giants/popcrm-web` | CRM | live |
| **Poppim** | `u2giants/poppim-web` | Product information manager, `pm.designflow.app` | in development |
| **DesignFlow PLM** | `popcre/designflow-*` (6 repos) | Product lifecycle management | live |

Supabase projects:

- **production** `qsllyeztdwjgirsysgai`
- **preview** `rjyboqwcdzcocqgmsyel` (Supabase branch `shared-db-schema-rehearsal`) — a
  **persistent clone of production including real data**. Treat its data and credentials as
  production-sensitive. It is the mandatory rehearsal target.

Because one database serves four apps, a bad migration breaks all four at once. `AGENTS.md`
is the operating contract: branch + PR + timestamped migration + preview-first, never edit a
landed migration, and production is applied deliberately and narrowly.

**Who the owner is:** Albert Hazan. He is **not a programmer** — he is the business owner and
you are his entire engineering department. Report in plain business English with evidence
(commit SHA, PR URL, HTTP status). Do not ask him to run commands; ask for the access you
need and do it yourself.

### The concept this whole document turns on

Every Supabase app ships a key called the **anon key** inside its browser JavaScript. It is
**not a secret** — anyone can read it out of a page in seconds. The entire security model
assumes it is *useless on its own*: holding it makes you the Postgres role `anon`, which is
supposed to be able to do nothing until a user logs in (at which point requests run as
`authenticated`).

This session found that assumption was false in two independent ways.

---

## 2. What we set out to do this session, and why

**Trigger.** A report that `public.sync_clickup_tasks(jsonb, text)` — a `SECURITY DEFINER`
importer owned by `postgres` that writes `pim.product`, `ingest.raw_record` and
`ingest.sync_run` — was callable by anyone holding only the anon key. Its migrations had
written `revoke all on function ... from public;` and assumed that locked it.

**Business goal.** Ensure nobody on the internet can read POP's data or run its importers
without logging in.

**Technical objective as originally scoped.** Author a forward migration revoking
`anon`/`authenticated` EXECUTE on that function, verify on preview, then sweep the repo for
the same pattern.

**How the scope legitimately grew.** The sweep found the pattern was near-universal (88 of
99 `SECURITY DEFINER` functions in `public`), and an independent review then correctly
pointed out that the *same trust boundary* was also broken one layer down, at table/view
read access — where the actual customer-data exposure was.

---

## 3. Current state — what is true right now

### 3.1 Everything below is merged to `main` AND applied to production

| PR | Squash SHA | What it did | Production |
|---|---|---|---|
| [#316](https://github.com/u2giants/shared-db/pull/316) | `5e23389` | `20260729120000` — lock down EXECUTE on `public` SECURITY DEFINER functions | **NOT applied — by design, see §7** |
| [#318](https://github.com/u2giants/shared-db/pull/318) | `d803809` | `20260729180000` — revoke `anon` on 3 style-tracker functions; extend event trigger to procedures | applied |
| [#319](https://github.com/u2giants/shared-db/pull/319) | `5b4f15a` | `20260729130000` — production-safe re-issue of the `#316` sweep | applied |
| [#320](https://github.com/u2giants/shared-db/pull/320) | `a43e7f8` | docs: record the EXECUTE lockdown live on production | n/a (docs) |
| [#326](https://github.com/u2giants/shared-db/pull/326) | `35e8dee` | `20260729210000` — close anonymous **READ** leaks (`style_groups` policy + 3 RLS-bypassing views) | applied |
| [#327](https://github.com/u2giants/shared-db/pull/327) | `c537165` | docs: record the anon-read lockdown live on production | n/a (docs) |
| [#332](https://github.com/u2giants/shared-db/pull/332) | `86b43fed` | `AGENTS.md` §10.2 standing rule; link both audits; correct a stale hazard note | n/a (docs) |

Working tree is clean; nothing is uncommitted or unpushed. CI green on `86b43fed`
(`verify=success`), and the `Sync shared-db to consumers` workflow succeeded, so `AGENTS.md`
§10.2 is mirrored into all consumer repos.

### 3.2 Verified end state on production (`qsllyeztdwjgirsysgai`)

**Function layer.** The only `SECURITY DEFINER` routines in `public` still reachable by
`anon` are `has_role` and `has_app_access`. Both are deliberate and permanent — they are
called from inside ~237 RLS policies, and because `anon` holds SELECT on `public` tables
those policies genuinely evaluate as `anon`. Removing EXECUTE would convert empty result
sets into hard `42501` errors across every app. Both return booleans from a self-check and
leak nothing.

Numbers from the production apply: **64** routines had PUBLIC+`anon` EXECUTE revoked; **12**
also had `authenticated` revoked (those whose own migrations declared `service_role` as the
sole intended grantee); **3** style-tracker functions had `anon` revoked.

**Read layer.** Four objects were readable by any anonymous internet caller. All closed:

| Object | Rows that were exposed | What was in it |
|---|---|---|
| `public.style_tracker_rows_with_bridge` (view) | 15,534 | SKUs, customers, licensors, designers, royalties, licence status |
| `public.style_groups` (table) | 10,589 | SKUs, folder paths, licensors, properties, `customer`, designer/freelancer names |
| `public.sg_archive_usage` (view) | 760 | Licensor names, style-guide folders, activity dates |
| `public.style_tracker_audit_log_with_user` (view) | 345 | Full change history **including staff email addresses** |

~27,000 rows total. **Read-only — nothing was writable anonymously.** Access logs were
**not** reviewed, so there is no evidence either way about whether anyone used it; do not
claim otherwise.

**Independently re-verified with the real production anon key after the fix:**

```text
GET /rest/v1/style_groups                      -> 200, Content-Range */0   (empty)
GET /rest/v1/style_tracker_rows_with_bridge    -> 401 42501 permission denied for view
GET /rest/v1/style_tracker_audit_log_with_user -> 401 42501 permission denied for view
GET /rest/v1/sg_archive_usage                  -> 401 42501 permission denied for view
POST /rest/v1/rpc/execute_readonly_query       -> 401 42501 permission denied for function
POST /rest/v1/rpc/upsert_style_tracker_value_resolution -> 401 42501 permission denied
```

**The apps were not broken.** Verified at the database level with RLS enforced
(`set local role authenticated`): `style_groups` still returns all **10,589** rows to
`authenticated`, and all three views remain granted to `authenticated` and `service_role`.
The `style_groups` SELECT policy is now scoped `roles = {authenticated}`.

**Guard installed.** Event trigger `lock_down_new_public_function_execute_trg` is present and
enabled on both environments; it fires on `CREATE FUNCTION` / `CREATE PROCEDURE` in `public`
and revokes EXECUTE from PUBLIC and `anon`.

### 3.3 Known-open, deliberately

`public.admin_config` still returns **exactly one row** to `anon` (verified via HTTP:
`Content-Range: 0-0/1`, the `SCAN_REQUEST` row). This is an intentional, narrowly-scoped
policy — `anon can read SCAN_REQUEST for Realtime watcher`, `USING (key = 'SCAN_REQUEST')` —
that the PopDAM scanner depends on. It does expose some internal user ids. Changing it means
changing how the scanner authenticates, which is a product decision for Albert, not a bug
fix. See §6 item 4.

---

## 4. Everything we tried that did NOT work — READ THIS SECTION

These are the expensive lessons. Each cost real time or was caught only by an assertion.

1. **`revoke all on function ... from public` does not lock a function down.** It removes
   only the PUBLIC pseudo-role. On hosted Supabase, role `postgres` carries default
   privileges for schema `public` that grant EXECUTE to `anon`, `authenticated` and
   `service_role` **at creation time**, and those explicit grants survive the revoke:
   `pg_default_acl` (schema `public`, grantor `postgres`) =
   `postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres`.
   This is why ~40 migrations in this repo *look* like they lock functions down and do not.

2. **`ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ... FROM anon, authenticated` is NOT
   sufficient on its own — this was the near-miss of the session.** After running it the
   stored default ACL reads `postgres=X/postgres | service_role=X/postgres` with no PUBLIC
   entry, and it *looks* fixed. But a function created immediately afterwards still lands
   with `=X/postgres | postgres=X/postgres | service_role=X/postgres`. The leading `=X/` is
   PUBLIC, from PostgreSQL's own hardwired "functions are EXECUTE-able by PUBLIC" default,
   which survives the ALTER. `anon` is a member of PUBLIC, so it still has EXECUTE.
   **Adding `revoke execute on functions from public` to the default privileges does not fix
   it either** — verified: the stored row is unchanged and the next function still gets `=X/`.
   Had we stopped here the hole would have looked closed while being wide open. This is why
   the event trigger exists. It was caught only because the migration creates a throwaway
   function and asserts `anon` cannot reach it.

3. **Do NOT widen the event trigger to also revoke `authenticated`.** `create or replace
   function` reports the `CREATE FUNCTION` tag and preserves the existing ACL, so a future
   migration that merely patches a function body would silently strip that function's
   `authenticated` grant and break a logged-in app screen. The anon-only scope is
   deliberate. `ALTER FUNCTION` is not covered for the same reason — it never widens an ACL.

4. **Do NOT set `security_invoker = true` on the three fixed views.** It looks like the
   textbook fix and it would quietly *reduce what logged-in staff can see*:
   `style_tracker_audit_log_with_user` joins `profiles`, whose RLS limits a non-admin to
   their own row, so `changed_by_email` would become NULL for everyone else's entries;
   `style_tracker_rows_with_bridge` joins `core.customer/licensor/creative_designer/factory`,
   whose RLS requires an `app` role. Revoking the `anon` grant instead cannot affect
   `authenticated` or `service_role` at all.

5. **Regex/catalog queries are not adequate for finding these leaks.** A `pg_policies`
   regex hunting for permissive policies found **1 of the 4** real leaks. The other three
   were a different mechanism entirely (views without `security_invoker`, which run as owner
   `postgres` — a `BYPASSRLS` role — and have no RLS of their own, so the GRANT is the only
   guard). The reliable method is to enumerate **every** anon-privileged relation and probe
   each with the real anon key. Proof the mechanism differs: base table `style_tracker_rows`
   correctly returns **0** rows to anon while the view over it returned **15,534**.

6. **`has_function_privilege('anon', ...)` returning true does not mean anon can call it.**
   A cross-schema sweep flagged writer functions in `plm` and helpers in `app` as
   anon-executable. They are **not reachable**: `anon` holds schema `USAGE` on **`public`
   only** (verified across `public/app/plm/api/crm/pim/core/ingest/dam`), and `plm` is not in
   `pgrst.db_schemas` either. Do not "fix" these — verify reachability end-to-end before
   acting on a privilege bit.

7. **`supabase db push --dry-run` under-reports pending migrations.** On production it
   listed **11**; the true number was **15**. It only lists migrations sorting *before* the
   remote maximum version. Trusting it would have hidden the `20260729120000` blocker
   entirely. Always diff every local filename prefix against every
   `supabase_migrations.schema_migrations` row.

8. **A hard-coded object name made `20260729120000` unusable on production.** Its step 4
   does `revoke execute on function public.sync_clickup_tasks(jsonb, text) ...`, but that
   function does not exist on production. `revoke` on a missing function raises
   `undefined_function` and would have aborted the entire apply. **Lesson: privilege/lockdown
   migrations must be catalog-driven and must never hard-code object names**, so they are
   portable across environments that are not in identical states.

9. **Duplicate migration version `20260728160000` blocked pushes four times.** Two files
   shared that version, so the CLI matched the ledger row to one and retried the other
   forever, failing on `schema_migrations_pkey`. **This is now RESOLVED** by a separate
   session (verified: 373 files, 373 unique version prefixes, no orphan ledger rows). Noted
   only so older references to the workaround make sense.

10. **A `[Y/n]` prompt makes `supabase db push` look hung.** It auto-accepts without a TTY
    but blocks long enough to trip a 2-minute tool timeout. Run it backgrounded.

---

## 5. Root causes and key findings

**Two independent root causes, one shared trust boundary (`anon` = anyone on the internet).**

**Cause A — function EXECUTE grants.** Supabase's `public`-schema default ACL grants
`anon`/`authenticated` EXECUTE on every new function, and `revoke ... from public` does not
touch it. `public` is PostgREST-exposed (`pgrst.db_schemas = public, graphql_public, api,
crm, pim, core, app`), so every affected function was live at `POST /rest/v1/rpc/<name>`.
Because these are `SECURITY DEFINER` functions owned by `postgres`, they bypass RLS entirely.
Two sub-patterns: **73** functions never revoked PUBLIC at all; **15** matched the reported
"revoke from public only" pattern — i.e. the reported pattern was the smaller half.

Worst single instance: **`public.execute_readonly_query(text)`** — executes caller-supplied
SQL as `postgres`, and was anon-callable. See §6 item 1; it is **not defined in any
migration**.

**Cause B — RLS defeated two different ways.**
- `public.style_groups` had a policy *named* `"Authenticated users can read style_groups"`
  written with **no `TO` clause**, which defaults to the PUBLIC pseudo-role that `anon`
  belongs to. It granted precisely what its own name forbade, while reading as correct.
- Three **views** were created without `security_invoker = true`. A view owned by `postgres`
  (`BYPASSRLS`) executes as owner and defeats the RLS of its base tables, and a view has no
  RLS of its own — so the GRANT is the only guard, and Supabase's default ACL had granted
  `anon` SELECT at creation.

**Why no test caught any of this.** Local/stock-Postgres testing **cannot** reproduce it:
there is no `anon` or `authenticated` role, no Supabase default ACLs, and no PostgREST. Every
local check of the original migrations passes. This bug class is only observable against a
hosted project. Treat `scripts/check-sql.sh` and local replay as necessary but not
sufficient for anything privilege-related.

**Sweep coverage, so the negative result is trustworthy:** 53 anon-privileged relations in
`public` were each probed with a real anon key — 4 leaking, 49 clear. All 48 tables had RLS
**enabled** (so no anon-granted table has RLS off), and 46 returned count `0`, including
`profiles`, `user_roles`, `app_access`, `invitations`, `helper_tokens`,
`agent_registrations`, `assets`, `erp_items_raw`, `prod_order_headers_raw`,
`style_tracker_rows`. Several carry `USING (true)` policies scoped correctly `TO
authenticated` — `style_groups` was the only one missing the `TO`. Of 5 views, the 3 without
`security_invoker` leaked and the 2 with it returned `401`, which is what proved the
mechanism rather than guessing it. 2 materialized views: `anon` holds no privilege (recorded
explicitly because matviews also ignore RLS).

**Independent review.** `.ai/reviews/20260729-public-execute-lockdown-glm.md` (GLM 5.2)
reviewed stage one and predicted the table-layer bug class before it was found. Two of its
warnings were tested and **refuted** — worth knowing so nobody re-opens them:
- It expected a "time-bomb" whereby `sync_clickup_tasks` would be `authenticated`-reachable
  the day it is created on production. Simulated exactly (create SECURITY DEFINER function,
  `revoke all from public`, `grant to service_role`): result was
  `postgres=X | service_role=X`, with `anon=false` **and `authenticated=false`**. The default
  privileges change plus the migration's own revoke already close it.
- It suggested a `prokind='f'`-only filter was a live risk; there are no `SECURITY DEFINER`
  procedures in `public` on production, so it was latent. Covered anyway.

---

## 6. Exact next steps

None of these is an emergency. The critical exposure is closed and proven. Do them in this
order; each is independent, so stopping after any one is fine.

### 1. Reconcile `public.execute_readonly_query(text)` — highest value

**Why:** it executes caller-supplied SQL as `postgres`. It is locked to `service_role` today,
but it is **defined in no migration in this repo**, so nobody can audit it, and any future
caller that passes user input into it is a full database compromise.

1. Capture its live definition and ACL from production, read-only:
   `select pg_get_functiondef(oid), proacl from pg_proc where proname='execute_readonly_query';`
2. Find callers across `u2giants/popdam3`, `popcrm-web`, `poppim-web` and the six
   `popcre/designflow-*` repos (`gh search code`, or a shallow clone — see §8 for the code
   search rate limit).
3. If nothing legitimately calls it: author a forward migration dropping it. If something
   does: commit its definition as an additive baseline migration so it is auditable, and
   record the caller in `docs/security/public-schema-execute-audit.md`.

**You'll know it worked when** the function either no longer exists on preview and production,
or its definition exists in `supabase/migrations/` with its caller documented — and
`select 1 from pg_proc where proname='execute_readonly_query'` matches your intent in both
environments.

### 2. Build a regression alarm

**Why the event trigger is not enough:** it fires only on `CREATE FUNCTION`/`CREATE
PROCEDURE`. It does **not** catch a later `grant execute ... to anon` on an existing
function, an `ALTER FUNCTION ... SECURITY DEFINER`, the trigger itself being dropped or
disabled, a new anon-readable table or view, or anything outside `public`. Its own failures
are `raise warning` only — visible in the Postgres log and nowhere else. Nothing currently
tests the **effective privileges**.

1. Add a versioned SQL check in `shared-db` that asserts, with **no schema filter**, that the
   only `anon`-reachable `SECURITY DEFINER` routines are `has_role` and `has_app_access`, and
   that no `public` table/view returns rows to `anon` except `admin_config`.
2. Add an anon-key canary: `POST /rest/v1/rpc/execute_readonly_query` (or its successor)
   must return `401`. A `200` is the loudest possible signal.
3. Schedule it. **`shared-db` has no scheduler** — the runner (credentials, schedule,
   webhook) must live in an app repo's edge functions or `pg_cron`. On failure it must
   **push** to Albert (Slack/email webhook); he will not check a dashboard.

**You'll know it worked when** you deliberately grant `anon` EXECUTE on a throwaway `public`
function on **preview** and the alarm fires within its interval — then revoke it.

### 3. Triage the ~50 `authenticated`-reachable `SECURITY DEFINER` functions in `public`

**Why it is lower priority:** the attacker must be a logged-in POP employee, so the harm is
lateral privilege escalation, not an internet breach. **Why it is not zero:** several are
writers running as `postgres`.

Rank by damage — writers and anything passing arguments into dynamic SQL first, read-only
facet/search functions last. For each, `rg "rpc/<name>"` / `.rpc('<name>'` across the app
repos and sort into: **browser caller → keep**; **server-only → revoke `authenticated`,
grant `service_role`**; **no caller → investigate before touching**. Work in batches of
5–10, one migration per batch, and **gate every batch** on a preview click-through of the
affected screens plus a 24-hour production log watch for `permission denied for function`.
That gating is the only thing that makes this safe on a database serving four live apps.

**You'll know each batch worked when** preview screens still function, 24 hours pass with no
`permission denied for function` in production logs, and the audit query in
`docs/security/public-schema-execute-audit.md` §7 shows the batch no longer
`authenticated`-reachable.

### 4. Decide what to do about `admin_config` — needs Albert, not engineering

Present the trade-off in plain English: one row (`SCAN_REQUEST`) is readable anonymously by
design so the PopDAM realtime watcher can see scan status; it exposes internal user ids;
closing it means changing how the scanner authenticates. **Do not change it unilaterally** —
it is intentional and something depends on it.

**You'll know it worked when** Albert has explicitly chosen leave-as-is or re-architect, and
the decision is dated in `docs/security/public-schema-anon-read-audit.md`.

### 5. Capture out-of-band objects into baseline migrations

The 2-arg `public.has_role(uuid, app_role)` / `public.has_app_access(uuid, app_name)` and the
`rls_auto_enable` **event-trigger registration** exist in the database but in no migration.
Additive baseline only (`pg_get_functiondef` / `pg_event_trigger` dumped from production,
committed as a new file). Never edit the live objects. Auditability, not a live risk.

**You'll know it worked when** every object referenced by the two security audit docs is
defined somewhere in `supabase/migrations/`.

---

## 7. Constraints and gotchas in force

### THE ONE THAT WILL BITE YOU: `20260729120000` is still pending on production

It hard-codes `revoke execute on function public.sync_clickup_tasks(jsonb, text)`. That
function **does not exist on production** — it is created by
`20260728174500_clickup_incremental_task_import_reissue.sql`, itself still pending.

- **Promote `20260729120000` WITH or AFTER the ClickUp migrations. Never before.** Out of
  order, the apply aborts with `undefined_function` and nothing else in that migration runs.
- Because `20260728174500` sorts *before* `20260729120000`, a normal ordered apply is
  already correct — the risk is only if you bound a checkout to `20260729120000` alone.
- **Nothing is exposed meanwhile:** `20260729130000` is the applied, catalog-driven,
  production-safe equivalent. `20260729120000` will replay as an idempotent no-op.

### Standing rules (non-negotiable)

- **All schema changes are authored here, in `shared-db`, as a NEW timestamped migration.**
  Never edit a landed migration. Never add app-repo inline migrations. Never run direct
  `ALTER`/`CREATE`/`DROP` against the shared database.
- **Preview first, always.** Rehearse on `rjyboqwcdzcocqgmsyel`, verify the real objects (not
  just `schema_migrations`), then promote.
- **Production requires Albert naming the exact resource and action in the current chat.**
  "Fix the database" is not authorisation.
- `shared-db` uses branch + PR, and the AI merges its own PR after CI is green.
- Commit identity must be `Albert Hazan <u2giants@users.noreply.github.com>`. Check
  `git var GIT_COMMITTER_IDENT` before your first commit in an unfamiliar checkout.
- Work in a dedicated `git worktree`. Several AI sessions churn this repo concurrently; the
  shared checkout's branch and untracked files shift between turns.
- No band-aids. No silent failures — every fallback must alert loudly.

### Production promotion procedure (AGENTS.md §5) — do not shortcut it

Production currently has **~15 pending migrations belonging to other workstreams** (ColdLion
phases, `core_style_guide_axis`, `db_data_admin_tree_plm_division_names`, the ClickUp
reissue, `20260729120000`).

- **NEVER run `supabase db push --include-all` against the full repo set** — it would promote
  all of them.
- Use a bounded temp checkout: `git worktree add --detach <tmp> origin/main`, delete **only
  the pending files you are not promoting** (never the already-applied ones), dry-run,
  confirm it names *exactly* your file, then push. `--include-all` is safe **only** inside a
  verified bounded checkout.
- If the CLI suggests `supabase migration repair --status reverted ...`, **do not run it.**
  Those versions are another workstream's applied, working rehearsal; repairing them deletes
  their ledger rows while the objects remain, breaking their next push.
- Preview holds `20260728181500_clickup_incremental_task_import_fixes.sql` from **unmerged
  PR #311**, which is not on `main`. Preview pushes abort with "Remote migration versions not
  found in local" until you add it to your bounded checkout:
  `git show 41b087a:supabase/migrations/20260728181500_clickup_incremental_task_import_fixes.sql`.

### Writing privilege migrations after this session

`AGENTS.md` **§10.2** is now the canonical standing rule — read it. Summary: a new function in
`public` is reachable by nobody but `postgres` and `service_role` unless your migration
grants it explicitly, because of the event trigger and the changed default privileges. Always
write the grant:

```sql
revoke execute on function public.f(...) from public, anon, authenticated;
grant  execute on function public.f(...) to service_role;   -- and/or authenticated
```

Make privilege migrations **catalog-driven, never hard-coding object names** (see §4 item 8),
and **make them assert their own outcome** so they fail loudly instead of landing a false
sense of security. `create or replace` re-strips `anon`, so a genuinely anon-callable
function must be re-granted *after* the create. When adding a view over an RLS-protected
table, either set `security_invoker = true` or revoke `anon`/PUBLIC explicitly — and verify
with the anon key.

---

## 8. Access and environment

Authenticated CLIs on Albert's machines: `gh`, `gcloud`, `az`, `supabase`, `vercel`, `op`
(1Password). Verify with a real call before claiming a capability is missing. MCP servers
available include `supabase` and `1password`.

**Secrets live in 1Password, vault `vibe_coding`. Never write values into files, docs or
commits.** Serialise `op` calls — never fan them out in parallel. Item titles contain spaces
and parentheses, so they cannot be used as `op://` references; use `op item get`:

```bash
op item get "Supabase CLI Personal Access Token" --vault vibe_coding --fields label=SUPABASE_ACCESS_TOKEN --reveal
op item get "Supabase DB Password - shared POP database" --vault vibe_coding --fields label=password --reveal
op item get "Supabase Preview Branch Credentials - shared POP database (shared-db-schema-rehearsal)" --vault vibe_coding --fields label=POSTGRES_URL --reveal
```

**`psql` is NOT installed on these Windows machines.** Query with Node + the `pg` package. A
working harness pattern (reads a `.sql` file, prints JSON, `PGURL` from env):

```js
const client = new pg.Client({ connectionString: process.env.PGURL, ssl: { rejectUnauthorized: false } });
```

Production connection string (use the **pooler**; direct IPv6 fails from these hosts):

```text
postgresql://postgres.qsllyeztdwjgirsysgai:<urlencoded-password>@aws-1-us-east-1.pooler.supabase.com:6543/postgres
```

Environment quirks that cost time:

- **PowerShell's `Invoke-WebRequest` rejects a `Range: 0-0` header** ("The format of value
  '0-0' is invalid"). Use `curl` for `Prefer: count=exact` row-count queries.
- The Supabase management API returns transient **502**s. Back off ~60 s and retry rather
  than concluding failure.
- `gh search code` is limited to **10 queries/minute** and fails with HTTP 403 rate-limit
  errors that can look like "no results found". Always validate a zero-result search with a
  control term you know exists. `--owner` filtering has behaved inconsistently — prefer
  unfiltered searches and filter the results yourself.
- Production anon key (publishable, safe to use for verification; or fetch fresh via the
  `supabase` MCP `get_publishable_keys`): project URL
  `https://qsllyeztdwjgirsysgai.supabase.co`.

---

## 9. Open questions and risks

**Decisions made, dated 2026-07-29/30 — do not silently contradict these:**

1. **`has_role` / `has_app_access` stay `anon`-executable, permanently.** ~237 RLS policies
   call them and `anon` holds SELECT on `public` tables, so revoking EXECUTE would turn empty
   result sets into hard `42501` errors app-wide. They return booleans and leak nothing.
2. **The event trigger revokes `anon`/PUBLIC only, never `authenticated`** — see §4 item 3.
3. **The three views were fixed by revoking `anon`, not by `security_invoker = true`** — see
   §4 item 4.
4. **`20260729120000` was re-issued as `20260729130000` rather than edited.** Editing a
   landed migration is forbidden and would diverge preview from `main`; promoting the ClickUp
   migrations first would have coupled a security fix to another workstream's deferred
   feature work. The original is not stranded — it replays as an idempotent no-op.
5. **`admin_config`'s single anon-readable row was left in place** as intentional and
   depended upon; changing it is Albert's product decision.

**Open questions:**

- Who, if anyone, legitimately calls `execute_readonly_query`? Unknown. §6 item 1.
- Were any of the leaks ever actually exploited? **Unknown and unexamined** — access logs
  were not reviewed. Do not assert either way. If Albert needs certainty, Supabase log
  retention is the place to look, and sooner is better.
- Are `anon`'s table **write** grants (167 privilege rows across `public`/`storage`/
  `realtime`) all correctly RLS-gated? The read side was proven clean by probing, and no
  anon-granted table has RLS off, but writes were **not** probed — deliberately, to avoid
  writing to production. Assess on **preview**, where writing is safe.

**Risks:**

- **Highest residual risk is the absence of an alarm (§6 item 2).** Nothing would tell anyone
  if this regressed; the first sign would be an incident.
- Step 3's batches can break a live app screen. The preview click-through plus 24-hour log
  watch is the mitigation — do not skip it to move faster.
- This database's permissions have accumulated faster than anyone audited them: a request to
  "lock one function" ended up uncovering a ~27,000-row customer-data leak two layers away.
  Assume more exists in layers nobody has probed yet, and prefer end-to-end probing over
  catalog reasoning.

---

## Reference

- `AGENTS.md` §5 (production promotion), §10.2 (the new standing rule)
- `docs/security/public-schema-execute-audit.md` — function layer; includes the re-runnable
  audit query (§7) and what was deliberately left alone
- `docs/security/public-schema-anon-read-audit.md` — table/view layer
- `.ai/reviews/20260729-public-execute-lockdown-glm.md` — independent GLM 5.2 review
