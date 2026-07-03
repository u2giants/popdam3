# CRM Auth Profile Email Link Verification — 2026-07-03

## Context

Some CRM users could not complete Microsoft SSO. Supabase redirected back to
`https://crm.designflow.app/` with:

```text
error=server_error
error_code=unexpected_failure
error_description=Database error saving new user
```

Production `app.handle_new_auth_user()` was installed on `auth.users` insert, but
it only upserted `app.profile` by `auth_user_id`. Imported/pre-seeded
`app.profile` rows can already have a unique `email` and a null `auth_user_id`;
first SSO login for those emails tried to insert a second profile row and could
violate `app.profile.email`.

A follow-up report showed the same callback error for `adweck@popcre.com`.
Production inspection found that CRM profile already had `auth_user_id` set, but
the linked Auth user email was different because of an older Google login. The
first migration did not cover this stale cross-email link, so first Microsoft SSO
for `adweck@popcre.com` could still collide on `app.profile.email`.

## Change

Migration:

```text
supabase/migrations/20260703172500_fix_crm_auth_profile_email_link.sql
```

The migration replaces `app.handle_new_auth_user()` so it:

- updates an existing `app.profile` where `email = new.email` and
  `auth_user_id is null`,
- falls back to the previous insert/upsert-by-`auth_user_id` behavior,
- still grants `app.app_access('crm')`,
- still grants the owner email the `administrator` role.

Follow-up migration:

```text
supabase/migrations/20260703220000_fix_crm_auth_profile_mismatched_email_relink.sql
```

This second migration keeps the same behavior and additionally relinks a matching
CRM profile when its current `auth_user_id` points at an Auth user whose email is
different from the CRM profile email.

Affected app: CRM (`popcrm-web`). The function lives in the shared Supabase
backend, so the behavior can affect any future app that relies on this same
profile provisioning trigger.

## Verification

Production inspection before the migration:

- Trigger `on_auth_user_created` existed on `auth.users` and executed
  `app.handle_new_auth_user`.
- `app.handle_new_auth_user()` did not link existing profiles by email.
- Four `app.profile` rows had non-null `email` and null `auth_user_id`.

Checks before applying:

- `scripts/check-sql.sh` passed.
- `supabase db push --dry-run` against production showed only
  `20260703172500_fix_crm_auth_profile_email_link.sql`.
- `supabase db lint --linked` reported pre-existing unrelated issues in public
  functions (`claim_tiff_jobs`, `rebuild_style_groups_batch`,
  `infer_path_attrs`, `resolve_sku_files_used_fuzzy`); no issue was specific to
  this migration.

Preview:

- Applied the migration to preview with the non-pooling preview database URL.
- Verified the migration was recorded in `supabase_migrations.schema_migrations`.
- Verified `pg_get_functiondef('app.handle_new_auth_user()')` contains the
  email-link branch.
- In a rollbacked transaction, temporarily attached the CRM trigger function to
  `auth.users`, inserted a pre-seeded profile and matching auth user, and
  confirmed `app.profile.auth_user_id` was linked.

Production:

- Applied the migration to project `qsllyeztdwjgirsysgai`.
- Verified the migration was recorded in `supabase_migrations.schema_migrations`.
- Verified the live function contains the email-link branch.
- In a rollbacked transaction, inserted a pre-seeded profile and matching auth
  user and confirmed `app.profile.auth_user_id` was linked.

Follow-up mismatched-email verification:

- Production scan found exactly one CRM profile whose `app.profile.email`
  differed from its linked `auth.users.email`: `adweck@popcre.com`.
- Production scan found zero broken `auth_user_id` foreign-key links, zero
  duplicate `app.profile.email` rows, and zero same-email Auth users that
  conflicted with CRM profiles.
- `scripts/check-sql.sh` passed for
  `20260703220000_fix_crm_auth_profile_mismatched_email_relink.sql`.
- Production and preview dry-runs each showed only
  `20260703220000_fix_crm_auth_profile_mismatched_email_relink.sql`.
- Applied the second migration to preview and production.
- In a rollbacked preview transaction, simulated a CRM profile linked to an
  older Auth user with a different email, inserted a new Azure Auth user with
  the CRM email, and confirmed the profile relinked to the new Auth user.
- In a rollbacked production transaction for `adweck@popcre.com`, inserted a new
  Azure Auth user and confirmed the CRM profile relinked to the inserted Auth
  user.

App-side UX:

- `popcrm-web` commit `8b043b6` makes the login page render Supabase OAuth
  callback errors instead of silently leaving them in the URL.
- GitHub Actions build/deploy completed and Coolify served commit `8b043b6`.
- `popcrm-web` commit `e2d8d45` moves OAuth callback error handling to the app
  gate so the error is visible even when the browser already has an active CRM
  session and routes into the main app instead of mounting the login page.

## Follow-up / Watchouts

- The four currently unlinked pre-seeded profiles were intentionally not
  backfilled in this session. They should link automatically the next time those
  users complete Microsoft SSO.
- If Microsoft SSO still returns `Database error saving new user`, check for a
  different trigger on `auth.users`, additional profile uniqueness conflicts, a
  missing `app.profile.auth_user_id`, or an `app.profile.auth_user_id` linked to
  an Auth user with a different email.
- Preview branch trigger state differed from production during verification:
  preview's existing `on_auth_user_created` pointed at legacy
  `app.handle_new_user`, while production had the CRM
  `app.handle_new_auth_user` trigger. The migration updates the function body;
  it does not alter trigger attachment.
