# `public` schema EXECUTE audit — anon-reachable SECURITY DEFINER functions

**Date:** 2026-07-29
**Environment audited:** preview branch `rjyboqwcdzcocqgmsyel`
**Fixed by:** `supabase/migrations/20260729120000_lock_down_public_security_definer_execute.sql`
**Production (`qsllyeztdwjgirsysgai`):** **NOT applied.** Requires Albert to name the
project and the action explicitly. See "Production promotion" at the bottom.

---

## 1. What the problem was, in plain terms

Anyone on the internet holding nothing but the project's **anon key** — the key that
ships in the browser bundle of every one of our apps, and is not a secret — could call
database functions that run as the `postgres` superuser and bypass every row-level
security policy.

The specific function that triggered this audit, `public.sync_clickup_tasks`, writes to
`pim.product`, `ingest.raw_record` and `ingest.sync_run`. An anonymous caller could have
run the ClickUp importer against our shared database.

It was not one function. **88 of the 99 SECURITY DEFINER functions in `public` were
reachable by `anon`**, including `public.execute_readonly_query(text)` — a function that
executes caller-supplied SQL as `postgres`.

## 2. Why the existing code looked correct but was not

Migrations across this repo wrote what looks like a lockdown:

```sql
revoke all on function public.f(...) from public;
grant execute on function public.f(...) to service_role;
```

`revoke ... from public` removes only the **PUBLIC pseudo-role**. It does not touch
explicit grants held by named roles.

On hosted Supabase, role `postgres` carries default privileges for schema `public` that
grant EXECUTE to `anon`, `authenticated` and `service_role` on every function **at the
moment it is created**:

```text
pg_default_acl (schema 'public', grantor 'postgres') =
  postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
```

So the real ACL on `public.sync_clickup_tasks` after that "lockdown" was:

```text
postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
```

`public` is PostgREST-exposed (`pgrst.db_schemas` = `public, graphql_public, api, crm,
pim, core, app`), so the function was live at `POST /rest/v1/rpc/sync_clickup_tasks`.

`pim.sync_clickup_tasks` was never affected — non-`public` schemas have no such default
ACL. The exposure was specific to the `public` wrapper.

### Why no test caught it

Local and stock-Postgres testing **cannot** catch this. A local Postgres has no `anon` or
`authenticated` role, no Supabase default ACLs, and no PostgREST. Every local check of
these migrations passes. This bug class is only observable against a hosted project.

## 3. Two distinct patterns were found

| Pattern | Count | Meaning |
|---|---|---|
| `PUBLIC_NOT_REVOKED` | 73 | No revoke at all. PUBLIC still held EXECUTE, and anon inherits through PUBLIC. |
| `PUBLIC_REVOKED_ONLY` | 15 | The exact reported pattern — `revoke ... from public` written, anon/authenticated grants left behind. |

The reported pattern was the *smaller* of the two problems.

## 4. What the fix does

### 4.1 One-time remediation

- Revoked EXECUTE from **PUBLIC and `anon`** on every callable SECURITY DEFINER function
  in `public` (65 functions), minus the allowlist in §5.
- Revoked EXECUTE from **`authenticated`** as well on the 13 functions whose own
  migrations declared `grant execute ... to service_role` and nothing else — i.e. where
  the author's stated intent was already service-role-only:

  `advise_dam_search_query_indexes`, `claim_dam_search_embedding_documents`,
  `execute_readonly_query`, `get_dam_search_embedding_status`,
  `get_dam_search_performance_stats`, `get_pdf_rich_extraction_hashes`,
  `mark_dam_search_embedding_error`, `record_failed_sync_run`,
  `refresh_style_guide_file_tag_cache`, `sync_clickup_tasks`, `sync_coldlion_vendors`,
  `upsert_dam_search_embedding`, `upsert_pdf_rich_extraction`.

Trigger and event-trigger functions were left alone: they are not directly callable and
PostgREST does not expose them.

### 4.2 Root cause — and why the obvious fix does not work

The obvious fix is:

```sql
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
```

**This is necessary but not sufficient, and that was proved on preview rather than
assumed.** After running it, the stored default ACL reads
`postgres=X/postgres | service_role=X/postgres` with no PUBLIC entry — yet a function
created immediately afterwards still lands with:

```text
=X/postgres | postgres=X/postgres | service_role=X/postgres
```

The leading `=X/` is PUBLIC, from PostgreSQL's own hardwired "functions are EXECUTE-able
by PUBLIC" default, which survives the ALTER. Adding
`revoke execute on functions from public` to the default privileges does **not** remove it
either — verified: the stored row is unchanged and the next function still gets `=X/`.
Since `anon` is a member of PUBLIC, `has_function_privilege('anon', ...)` stays true.

**Had we stopped at the ALTER, the hole would have looked closed while remaining open.**

There is also a second default-ACL row we do not control, granted by `supabase_admin`,
still listing `anon` and `authenticated`.

So the durable guard is an **event trigger**,
`lock_down_new_public_function_execute_trg`, which revokes EXECUTE from PUBLIC and `anon`
on every function **or procedure** created in `public`. (Procedure coverage was added in
`20260729180000`; the first version filtered on `CREATE FUNCTION` only, which would have
left a SECURITY DEFINER procedure in `public` exposed. There are none on production today,
so this was a latent trap rather than a live hole.)

This follows the same approach as `public.rls_auto_enable()`, which forces RLS on new
public tables for the same "the platform default is wrong for us" reason. Note that only
`rls_auto_enable`'s *function body* is in this repo — its event-trigger registration was
created out of band, so treat it as a precedent in spirit rather than a fully auditable one.

The migration ends by creating a throwaway function and asserting `anon` cannot reach it.
That assertion is what caught the incomplete first version of this fix.

**Deliberately narrow:** the trigger revokes PUBLIC and `anon` only, never
`authenticated`. `create or replace function` reports the `CREATE FUNCTION` tag and
preserves the existing ACL, so a migration that merely patches a function body would
otherwise silently strip that function's `authenticated` grant and break a logged-in app
screen. `ALTER FUNCTION` is not covered because it never widens an ACL.

## 5. Left reachable by `anon`

**Resolved by the follow-up migration
`20260729180000_revoke_anon_execute_style_tracker_and_cover_procedures.sql`.** Read this
section together with §5.1 below.

Immediately after `20260729120000`, five **SECURITY DEFINER** functions were still
`anon`-EXECUTE-able:

| Function | Why | Status |
|---|---|---|
| `has_role` | Called from inside RLS policies. `anon` holds SELECT on `public` tables, so those policies genuinely evaluate as `anon`. Removing EXECUTE turns an empty result set into a hard `42501` error across every app. | **Kept, permanently** |
| `has_app_access` | Same. | **Kept, permanently** |
| `refresh_style_tracker_item_bridge` | A migration explicitly ran `grant execute ... to anon, authenticated, service_role`. | **anon revoked** in `20260729180000` |
| `search_style_tracker_link_candidates` | Same explicit `anon` grant. | **anon revoked** in `20260729180000` |
| `upsert_style_tracker_value_resolution` | Same explicit `anon` grant. | **anon revoked** in `20260729180000` |

The `20260729120000` allowlist names **six** functions, one more than the five above:
`get_dam_material_facets` is also `anon`-reachable but is **SECURITY INVOKER**, so it was
never in scope for that migration (the sweep filters on `prosecdef`). Listing it was
harmless but redundant. It is deliberately left alone: an invoker-rights function runs as
the caller and is still subject to RLS.

### 5.1 Why the last three had to go, and why revoking them is safe

`upsert_style_tracker_value_resolution` is SECURITY DEFINER and **writes**: it upserts
`plm.style_tracker_value_resolution` and rewrites `plm.style_tracker_item_bridge`,
including `creative_designer_id` and flipping `match_status` to matched/verified. Granted
to `anon`, an unauthenticated caller could link tracker rows to arbitrary entities and mark
them verified — **unauthenticated data tampering**, confirmed live on production
2026-07-29. `refresh_style_tracker_item_bridge` allowed an anonymous full bridge rebuild
(resource abuse); `search_style_tracker_link_candidates` disclosed customer/licensor ids
and names.

Revoking `anon` does **not** break the app. All three are called from PopDAM's
`src/pages/StylesPage.tsx` (`u2giants/popdam3`) — a browser page **behind login**. A
logged-in user authenticates as `authenticated`, not `anon`. Their production ACLs carried
both grants, so removing `anon` leaves the logged-in path intact. `20260729180000`
re-asserts `authenticated` and `service_role` explicitly and asserts the app path survived.

### 5.2 The event trigger can strip an `anon` grant on replace

The trigger revokes PUBLIC/`anon` on every `CREATE FUNCTION`, and
`create or replace function` reports that tag while preserving the ACL. So if a future
migration ever needs a function to be genuinely anon-callable, it must **re-grant after
the create** — a body-patch alone will silently drop the `anon` grant. That is the
intended bias (fail closed, not open), but it needs to be known. `authenticated` is not
affected, by design.

## 6. Not changed: `authenticated` on app-facing functions

Roughly 50 SECURITY DEFINER functions in `public` remain EXECUTE-able by
`authenticated` — DAM search and facet functions, style-guide tagging actions, and
similar. These plausibly have real browser callers in PopDAM/PopPIM. Revoking them
without tracing each caller would break app screens, so they were left alone.

This is a smaller risk than the anon exposure: `authenticated` means a real, logged-in POP
user. It is still worth an audit pass that traces actual callers per function — that
requires app-repo work and is out of scope here.

## 7. How to re-run this audit

```sql
select n.nspname||'.'||p.proname as fn,
       array_to_string(p.proacl::text[], ' | ') as acl,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_type t on t.oid = p.prorettype
where n.nspname = 'public'
  and p.prosecdef
  and t.typname not in ('trigger','event_trigger')
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by 1;
```

Expected result after **both** migrations: **only `has_role` and `has_app_access`.**
(Between `20260729120000` and `20260729180000` the expected result was the five SECURITY
DEFINER functions in §5.)

Figures quoted in this document — "88 of 99", "237 policies", "62 tables", the
`pgrst.db_schemas` list — are **live measurements** taken from the hosted preview branch on
2026-07-29, not values derivable from this repo. Re-measure rather than trusting them;
production differs from preview (production had 87 of 88 exposed, and 64 functions were in
scope for the revoke there).

End-to-end check with the anon key (this is the proof that matters):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$SUPABASE_URL/rest/v1/rpc/sync_clickup_tasks" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"p_snapshot":{"tasks":[]},"p_mode":"incremental"}'
```

Verified on preview 2026-07-29: **401**, body
`{"code":"42501","message":"permission denied for function sync_clickup_tasks"}`.
Before the migration this call would have executed the importer.

## 8. Guidance for future migrations

When you create a function in `public`, **state the grant explicitly**:

```sql
create or replace function public.f(...) ... security definer as $$ ... $$;

revoke execute on function public.f(...) from public, anon, authenticated;
grant  execute on function public.f(...) to service_role;   -- or authenticated, as intended
```

Never rely on `revoke ... from public` alone, and never assume a function is private
because no migration granted it — on hosted Supabase the platform grants it for you.

## 9. Production promotion

This migration is applied to **preview only**.

Promoting it to production (`qsllyeztdwjgirsysgai`) will revoke `anon` EXECUTE on ~65
functions and `authenticated` EXECUTE on 13. The anon revocations are safe by
construction. The 13 `authenticated` revocations are safe **if** those functions are
genuinely only called by service-role workers, which their own migrations assert.

Production has not been audited by this session — run the §7 query against production
first, since its function set may differ from preview.

**Do not apply to production without Albert naming the project and the action.**
